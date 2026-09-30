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
 *   Body: total=true -> libera tudo que está disponível; senão valor=montante.
 *
 * POST { acao: 'RECIBO' }  [VENDEDOR/ADMIN]
 *   Fluxo novo do dono: o admin LIBERA a comissão e o VENDEDOR dá o ACEITE
 *   (recibo) confirmando que recebeu. Marca os repasses liberados e ainda
 *   não confirmados como aceitados (aceitado=true + aceite_em).
 *   PRE-REQUISITO: SQL do Bloco 15 (colunas aceitado/aceite_em).
 *
 * GET ?saldo=1&vendedorId=... -> saldo do próprio vendedor (VENDEDOR) — usado
 *   pela tela do vendedor; admin pode consultar qualquer um.
 *   Resposta inclui liberadoPendente = valor liberado pelo admin e ainda sem
 *   recibo do vendedor (o que aparece no botão "DAR RECIBO").
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

  try {
    const body = await req.json();
    const acao = String(body.acao || '');

    // ---------- RECIBO: o vendedor confirma que recebeu o valor liberado ----------
    if (acao === 'RECIBO') {
      // Vendedor dá o recibo DO PRÓPRIO valor (admin também pode, sem efeito prático).
      const supabase = getServiceClient();
      const { data: upd, error: rErr } = await supabase
        .from('commission_payment_logs')
        .update({ aceitado: true, aceite_em: new Date().toISOString() })
        .eq('seller_id', session.sub)
        .eq('aceitado', false)
        .select('id');
      if (rErr) {
        const code = (rErr as any).code || '';
        if (code === '42703' || code === 'PGRST204' || /aceitado/i.test(String(rErr.message || ''))) {
          return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 15 (recibo de comissao).' }, { status: 503 });
        }
        throw rErr;
      }
      return NextResponse.json({ ok: true, recibos: (upd || []).length });
    }

    // ---------- PAGAR (liberar): somente admin ----------
    if (acao !== 'PAGAR') return NextResponse.json({ ok: false, error: 'Acao desconhecida.' }, { status: 400 });
    if (!isAdminSession(req)) return NextResponse.json({ ok: false, error: 'Acesso restrito ao admin.' }, { status: 403 });

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

    // Quanto o admin quer liberar agora?
    let valor: number;
    if (body.total === true) {
      valor = aPagarMax;
    } else {
      valor = round2(Number(body.valor) || 0);
    }
    if (!(valor > 0)) {
      return NextResponse.json({ ok: false, error: 'Nada a liberar: nao ha comissao disponivel suficiente.' }, { status: 400 });
    }
    if (valor > aPagarMax + 0.005) {
      return NextResponse.json({
        ok: false,
        error: `Valor maior que o disponivel. A liberar agora: R$ ${aPagarMax.toFixed(2)} (comissao R$ ${saldoTotal.toFixed(2)} − despesas R$ ${despesas.toFixed(2)}).`,
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

    // Histórico do repasse (liberação). aceitado=false = aguardando o recibo
    // do vendedor. Se o SQL do Bloco 15 ainda nao rodou, grava sem a coluna
    // (o sistema continua funcionando; so o recibo fica indisponível).
    const obs = String(body.obs || '').slice(0, 200) || null;
    const logPayload: any = {
      seller_id: vendedorId,
      valor_pago: valor,
      metodo_pagamento: 'DINHEIRO',
      observacao: obs || `Comissao liberada pelo admin — FIFO + despesas R$ ${despesas.toFixed(2)}`,
      created_at: new Date().toISOString(),
      aceitado: false,
    };
    let { error: logErr } = await supabase.from('commission_payment_logs').insert(logPayload);
    if (logErr && (logErr.code === '42703' || logErr.code === 'PGRST204' || /aceitado/i.test(String(logErr.message || '')))) {
      const semAceite = { ...logPayload };
      delete semAceite.aceitado;
      delete semAceite.aceite_em;
      ({ error: logErr } = await supabase.from('commission_payment_logs').insert(semAceite));
    }
    if (logErr) throw logErr;

    // Aviso ao vendedor: liberou -> vendedor precisa DAR O RECIBO no app
    try {
      await sendPushToUser(vendedorId, { title: 'Comissão liberada 💰', body: `O admin liberou R$ ${valor.toFixed(2)}. Abra o Financeiro e de o RECIBO.`, url: '/' });
      await supabase.from('system_messages').insert({
        seller_id: vendedorId,
        titulo: 'Comissão Liberada',
        mensagem: `O Admin liberou R$ ${valor.toFixed(2)}. Confirme o recebimento com o botao DAR RECIBO no Financeiro.`,
        created_at: new Date().toISOString(),
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

    // Liberado pelo admin e ainda SEM recibo do vendedor (botao "DAR RECIBO").
    // Se o SQL do Bloco 15 nao rodou, a coluna aceitado nao existe -> sem recibo.
    let liberadoPendente = 0;
    let sqlReciboPendente = false;
    try {
      const { data: pend, error: pErr } = await supabase
        .from('commission_payment_logs')
        .select('valor_pago')
        .eq('seller_id', alvoId)
        .eq('aceitado', false);
      if (pErr) throw pErr;
      liberadoPendente = round2((pend || []).reduce((a: number, l: any) => a + Number(l.valor_pago || 0), 0));
    } catch {
      sqlReciboPendente = true;
    }

    return NextResponse.json({
      disponivel: round2(disp),
      despesas,
      aPagar: round2(Math.max(0, disp - despesas)),
      aguardando: round2(aguardando),
      liberadoPendente,
      sqlReciboPendente,
    });
  } catch (e: any) {
    console.error('[api/comissoes][GET] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao carregar saldo.' }, { status: 500 });
  }
}
