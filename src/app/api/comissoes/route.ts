import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest, isAdminSession } from '@/lib/session';
import { sendPushToUser } from '@/lib/pushSender';

/**
 * BLOCO 14 — COMISSÕES: acerto do admin (simples e à prova de erro).
 *
 * POST { acao: 'PAGAR', vendedorId, total?: true, valor?: number, obs? }  [ADMIN]
 *   Regra fácil de entender:
 *     • "Disponível" = comissões cujo dinheiro JÁ ENTROU (à vista no aceite,
 *       prazo já recebido) menos o que já foi pago nelas.
 *     • Despesas do vendedor descontam do valor a pagar (regra que já existia).
 *     • O acerto consome as comissões DISPONIVEL MAIS ANTIGAS primeiro (FIFO):
 *       cada comissão guarda quanto já foi pago (valor_pago) e vira PAGO
 *       quando não sobra nada nela.
 *   Body: total=true -> paga tudo que está disponível; senão valor=montante.
 *
 * GET ?saldo=1&vendedorId=... -> saldo do próprio vendedor (VENDEDOR) — usado
 *   pela tela do vendedor; admin pode consultar qualquer um.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (!isAdminSession(req)) return NextResponse.json({ ok: false, error: 'Acesso restrito ao admin.' }, { status: 403 });

  try {
    const body = await req.json();
    const acao = String(body.acao || '');
    if (acao !== 'PAGAR') return NextResponse.json({ ok: false, error: 'Acao desconhecida.' }, { status: 400 });

    const vendedorId = String(body.vendedorId || '');
    if (!vendedorId) return NextResponse.json({ ok: false, error: 'vendedorId obrigatorio.' }, { status: 400 });

    const supabase = getServiceClient();

    // Comissões DISPONIVEL do vendedor, mais antigas primeiro (FIFO)
    const { data: rows, error: rowsErr } = await supabase
      .from('commissions')
      .select('id, valor_comissao, valor_pago, created_at')
      .eq('seller_id', vendedorId)
      .eq('status', 'DISPONIVEL')
      .order('created_at', { ascending: true });
    if (rowsErr) {
      const code = (rowsErr as any).code || '';
      if (code === '42703' || /valor_pago/i.test(String(rowsErr.message || ''))) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 14 do SQL (comissoes).' }, { status: 503 });
      }
      throw rowsErr;
    }

    // Saldo por comissão = valor − o que já foi pago nela
    const comSaldo = (r: any) => Math.max(0, round2(Number(r.valor_comissao || 0) - Number(r.valor_pago || 0)));
    const saldoTotal = round2((rows || []).reduce((a: number, r: any) => a + comSaldo(r), 0));

    // Despesas do vendedor descontam do valor a pagar (regra existente)
    const { data: exps } = await supabase
      .from('seller_expenses').select('valor').eq('seller_id', vendedorId);
    const despesas = round2((exps || []).reduce((a: number, e: any) => a + Number(e.valor || 0), 0));

    const aPagarMax = Math.max(0, round2(saldoTotal - despesas));

    // Quanto o admin quer pagar agora?
    let valor: number;
    if (body.total === true) {
      valor = aPagarMax;
    } else {
      valor = round2(Number(body.valor) || 0);
    }
    if (!(valor > 0)) {
      return NextResponse.json({ ok: false, error: 'Nada a pagar: nao ha comissao disponivel suficiente.' }, { status: 400 });
    }
    if (valor > aPagarMax + 0.005) {
      return NextResponse.json({
        ok: false,
        error: `Valor maior que o disponivel. A pagar agora: R$ ${aPagarMax.toFixed(2)} (comissao R$ ${saldoTotal.toFixed(2)} − despesas R$ ${despesas.toFixed(2)}).`,
      }, { status: 400 });
    }

    // Consome comissões (FIFO): o pagamento + as despesas descem nas rows
    let aConsumir = round2(valor + despesas);
    for (const r of rows || []) {
      if (aConsumir <= 0.005) break;
      const saldo = comSaldo(r);
      if (saldo <= 0) continue;
      const uso = Math.min(saldo, aConsumir);
      const novoPago = round2(Number(r.valor_pago || 0) + uso);
      const quitou = novoPago >= Number(r.valor_comissao || 0) - 0.005;
      const upd: any = { valor_pago: novoPago };
      if (quitou) { upd.status = 'PAGO'; upd.paid_at = new Date().toISOString(); }
      const { error: uErr } = await supabase.from('commissions').update(upd).eq('id', r.id);
      if (uErr) throw uErr;
      aConsumir = round2(aConsumir - uso);
    }

    // Histórico do repasse
    const obs = String(body.obs || '').slice(0, 200) || null;
    await supabase.from('commission_payment_logs').insert({
      seller_id: vendedorId,
      valor_pago: valor,
      metodo_pagamento: 'DINHEIRO',
      observacao: obs || `Acerto pelo admin — FIFO + despesas R$ ${despesas.toFixed(2)}`,
      created_at: new Date().toISOString(),
    });

    // Aviso ao vendedor
    try {
      await sendPushToUser(vendedorId, { title: 'Comissão paga 💰', body: `O admin acertou R$ ${valor.toFixed(2)} da sua comissão.`, url: '/' });
      await supabase.from('system_messages').insert({
        vendedor_id: vendedorId,
        titulo: 'Comissão Paga',
        mensagem: `O Admin confirmou seu pagamento de R$ ${valor.toFixed(2)}.`,
        data: new Date().toISOString(),
        lida: false,
        type: 'COMMISSION_CONFIRMATION',
      });
    } catch { /* aviso nunca trava o pagamento */ }

    return NextResponse.json({ ok: true, pago: valor, despesas, saldoAntes: saldoTotal });
  } catch (e: any) {
    console.error('[api/comissoes][POST] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro interno. Tente novamente.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Sessao expirada. Entre novamente.' }, { status: 401 });

  try {
    const url = new URL(req.url);
    if (url.searchParams.get('saldo') !== '1') {
      return NextResponse.json({ error: 'Parametro desconhecido.' }, { status: 400 });
    }
    const alvoId = String(url.searchParams.get('vendedorId') || session.sub);
    // Vendedor só vê o próprio saldo; admin vê de qualquer um
    if (session.perfil === 'VENDEDOR' && alvoId !== session.sub) {
      return NextResponse.json({ error: 'Acesso restrito.' }, { status: 403 });
    }

    const supabase = getServiceClient();
    const { data: rows, error } = await supabase
      .from('commissions')
      .select('valor_comissao, valor_pago, status')
      .eq('seller_id', alvoId);
    if (error) {
      const code = (error as any).code || '';
      if (code === '42703' || /valor_pago/i.test(String(error.message || ''))) {
        return NextResponse.json({ error: 'Banco desatualizado: rode o Bloco 14 do SQL (comissoes).' }, { status: 503 });
      }
      throw error;
    }
    const disp = (rows || []).filter((r: any) => r.status === 'DISPONIVEL')
      .reduce((a: number, r: any) => a + Math.max(0, Number(r.valor_comissao || 0) - Number(r.valor_pago || 0)), 0);
    const aguardando = (rows || []).filter((r: any) => r.status === 'A_RECEBER')
      .reduce((a: number, r: any) => a + Number(r.valor_comissao || 0), 0);

    const { data: exps } = await supabase.from('seller_expenses').select('valor').eq('seller_id', alvoId);
    const despesas = round2((exps || []).reduce((a: number, e: any) => a + Number(e.valor || 0), 0));

    return NextResponse.json({
      disponivel: round2(disp),
      despesas,
      aPagar: round2(Math.max(0, disp - despesas)),
      aguardando: round2(aguardando),
    });
  } catch (e: any) {
    console.error('[api/comissoes][GET] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao carregar saldo.' }, { status: 500 });
  }
}
