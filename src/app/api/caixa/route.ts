import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest, isAdminSession } from '@/lib/session';
import { registrarPagamentoCaixa, type CaixaMetodo, type CaixaOrigem } from '@/lib/caixaLedger';

/**
 * BLOCO 118 — CAIXA: FECHAMENTO PERSISTIDO + LEDGER DE PAGAMENTOS
 *
 * GET  /api/caixa                      [ADMIN | SECRETARIO | VENDEDOR]
 *   Caixa corrente (aberto) + histórico de fechamentos:
 *   { ok, aberto: { desde, pagamentos[], totais{dinheiro,pix,deposito,total} },
 *          historico: [{id, fechadoEm, fechadoPorNome, totais, qtde, observacao}] }
 *   Pagamentos NÃO trazem a foto inline — o <img> busca por GET /api/caixa/foto?id=.
 *
 * POST /api/caixa                      body { acao: 'REGISTRAR' | 'FECHAR' }
 *   REGISTRAR [ADMIN | SECRETARIO | VENDEDOR]:
 *     { origem, metodo, valor, saleId?, cliente?, vendedor?, comprovante?, detalhe? }
 *     Grava 1 linha no ledger (dataURL de comprovante vai ao Storage). Idempotente
 *     por venda+método+valor ainda abertos. Usado pelo PDV (venda à vista) e pelo
 *     recebimento manual de contas a receber (fluxos server-side têm gancho direto).
 *   FECHAR [ADMIN]:
 *     { observacao? } — cria o snapshot em caixa_fechamentos_geral (totais + jsonb dos
 *     pagamentos) e prende os pagamentos abertos (fechamento_id = id). O caixa
 *     volta a zerar (novo período).
 *
 * SQL: sql/bloco118_caixa_fechamento.sql (tabelas + RLS fechada, service_role only).
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 503 amigável quando o SQL do bloco 118 ainda não rodou. */
function sqlFaltando(e: any) {
  const msg = String(e?.message || '');
  const code = String(e?.code || '');
  return code === '42P01' || code === 'PGRST205' || /caixa_pagamentos|caixa_fechamentos_geral|does not exist|schema cache/i.test(msg);
}

export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (!['ADMIN', 'SECRETARIO', 'VENDEDOR'].includes(session.perfil)) {
    return NextResponse.json({ ok: false, error: 'Acesso restrito.' }, { status: 403 });
  }

  const supabase = getServiceClient();
  try {
    // Ledger do caixa ABERTO (fechamento_id null)
    const { data: rows, error: rowsErr } = await supabase
      .from('caixa_pagamentos')
      .select('id, criado_em, origem, sale_id, cliente, vendedor, metodo, valor, comprovante, detalhe, usuario_nome')
      .is('fechamento_id', null)
      .order('criado_em', { ascending: true })
      .limit(600);
    if (rowsErr && sqlFaltando(rowsErr)) {
      return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
    }
    if (rowsErr) throw rowsErr;

    const pags = (rows || []) as any[];
    const totais = { dinheiro: 0, pix: 0, deposito: 0, total: 0 };
    for (const p of pags) {
      const v = Number(p.valor || 0);
      const m = String(p.metodo || '').toUpperCase();
      if (m === 'DINHEIRO') totais.dinheiro += v;
      else if (m === 'PIX') totais.pix += v;
      else if (m === 'DEPOSITO') totais.deposito += v;
      totais.total += v;
    }
    totais.dinheiro = round2(totais.dinheiro);
    totais.pix = round2(totais.pix);
    totais.deposito = round2(totais.deposito);
    totais.total = round2(totais.total);

    // Último fechamento = início da janela do caixa corrente
    const { data: ultimo } = await supabase
      .from('caixa_fechamentos_geral')
      .select('fechado_em')
      .order('fechado_em', { ascending: false })
      .limit(1);

    // Histórico (sem o jsonb pesado)
    const { data: hist, error: histErr } = await supabase
      .from('caixa_fechamentos_geral')
      .select('id, fechado_em, fechado_por_nome, total_dinheiro, total_pix, total_deposito, total_geral, qtde_pagamentos, observacao')
      .order('fechado_em', { ascending: false })
      .limit(60);
    if (histErr && sqlFaltando(histErr)) {
      return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      aberto: {
        desde: ultimo?.[0]?.fechado_em || null,
        pagamentos: pags.map((p) => ({
          id: p.id,
          criadoEm: p.criado_em,
          origem: p.origem,
          saleId: p.sale_id,
          cliente: p.cliente,
          vendedor: p.vendedor,
          metodo: p.metodo,
          valor: Number(p.valor || 0),
          temComprovante: !!p.comprovante,
          detalhe: p.detalhe,
          usuarioNome: p.usuario_nome,
        })),
        totais,
      },
      historico: (hist || []).map((f: any) => ({
        id: f.id,
        fechadoEm: f.fechado_em,
        fechadoPorNome: f.fechado_por_nome,
        totais: {
          dinheiro: Number(f.total_dinheiro || 0),
          pix: Number(f.total_pix || 0),
          deposito: Number(f.total_deposito || 0),
          total: Number(f.total_geral || 0),
        },
        qtdePagamentos: Number(f.qtde_pagamentos || 0),
        observacao: f.observacao,
      })),
    });
  } catch (e: any) {
    console.error('[api/caixa][GET] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro ao carregar o caixa.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (!['ADMIN', 'SECRETARIO', 'VENDEDOR'].includes(session.perfil)) {
    return NextResponse.json({ ok: false, error: 'Acesso restrito.' }, { status: 403 });
  }

  const supabase = getServiceClient();
  try {
    const body = await req.json();
    const acao = String(body.acao || '').toUpperCase();

    // ---------------- REGISTRAR (ledger) ----------------
    if (acao === 'REGISTRAR') {
      const metodo = String(body.metodo || '').toUpperCase() as CaixaMetodo;
      if (!['DINHEIRO', 'PIX', 'DEPOSITO'].includes(metodo)) {
        return NextResponse.json({ ok: false, error: 'Metodo invalido (DINHEIRO/PIX/DEPOSITO).' }, { status: 400 });
      }
      const valor = Number(body.valor || 0);
      if (!(valor > 0)) {
        return NextResponse.json({ ok: false, error: 'Valor invalido.' }, { status: 400 });
      }
      const origem = String(body.origem || 'AJUSTE').toUpperCase() as CaixaOrigem;
      if (!['VENDA', 'ENTREGA', 'RECEBIMENTO', 'PORTAL', 'AJUSTE'].includes(origem)) {
        return NextResponse.json({ ok: false, error: 'Origem invalida.' }, { status: 400 });
      }
      const comprovante =
        typeof body.comprovante === 'string' && body.comprovante.startsWith('data:image') && body.comprovante.length > 3_500_000
          ? null
          : typeof body.comprovante === 'string'
            ? body.comprovante
            : null;

      // Nome de quem registrou (só tem o id na sessão)
      let usuarioNome: string | null = null;
      if (session.sub && !/^(ADMIN|ENTREGADOR|SECRETARIO)$/.test(session.sub)) {
        const { data: u } = await supabase.from('app_users').select('nome').eq('id', session.sub).limit(1).maybeSingle();
        usuarioNome = (u as any)?.nome || null;
      }

      const r = await registrarPagamentoCaixa(supabase, {
        origem,
        metodo,
        valor,
        saleId: body.saleId ? String(body.saleId) : null,
        cliente: body.cliente ? String(body.cliente) : null,
        vendedor: body.vendedor ? String(body.vendedor) : null,
        comprovante,
        detalhe: body.detalhe ? String(body.detalhe) : null,
        usuarioId: session.sub,
        usuarioNome,
      });
      if (!r.ok) {
        if (sqlFaltando({ message: r.erro })) {
          return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
        }
        return NextResponse.json({ ok: false, error: 'Nao foi possivel registrar no caixa.' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, id: r.id });
    }

    // ---------------- FECHAR (snapshot) — ADMIN ----------------
    if (acao === 'FECHAR') {
      if (!isAdminSession(req)) {
        return NextResponse.json({ ok: false, error: 'Somente o admin fecha o caixa.' }, { status: 403 });
      }

      const { data: rows, error: rowsErr } = await supabase
        .from('caixa_pagamentos')
        .select('id, criado_em, origem, sale_id, cliente, vendedor, metodo, valor, detalhe, usuario_nome')
        .is('fechamento_id', null)
        .order('criado_em', { ascending: true });
      if (rowsErr && sqlFaltando(rowsErr)) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
      }
      if (rowsErr) throw rowsErr;

      const pags = (rows || []) as any[];
      const totais = { dinheiro: 0, pix: 0, deposito: 0, total: 0 };
      for (const p of pags) {
        const v = Number(p.valor || 0);
        const m = String(p.metodo || '').toUpperCase();
        if (m === 'DINHEIRO') totais.dinheiro += v;
        else if (m === 'PIX') totais.pix += v;
        else if (m === 'DEPOSITO') totais.deposito += v;
        totais.total += v;
      }
      totais.dinheiro = round2(totais.dinheiro);
      totais.pix = round2(totais.pix);
      totais.deposito = round2(totais.deposito);
      totais.total = round2(totais.total);

      // Nome do admin que fecha
      let nomeAdmin: string | null = null;
      if (session.sub && !/^ADMIN$/.test(session.sub)) {
        const { data: u } = await supabase.from('app_users').select('nome').eq('id', session.sub).limit(1).maybeSingle();
        nomeAdmin = (u as any)?.nome || null;
      }

      const observacao = String(body.observacao || '').slice(0, 300) || null;
      const janelaInicio = pags.length > 0 ? pags[0].criado_em : null;

      const { data: fech, error: fErr } = await supabase
        .from('caixa_fechamentos_geral')
        .insert({
          janela_inicio: janelaInicio,
          fechado_por_id: session.sub,
          fechado_por_nome: nomeAdmin,
          total_dinheiro: totais.dinheiro,
          total_pix: totais.pix,
          total_deposito: totais.deposito,
          total_geral: totais.total,
          qtde_pagamentos: pags.length,
          observacao,
          // Snapshot de rastreio (sem foto — a foto real fica no ledger; o pid liga os dois)
          pagamentos: pags.map((p) => ({
            pid: p.id,
            criado_em: p.criado_em,
            origem: p.origem,
            sale_id: p.sale_id,
            cliente: p.cliente,
            vendedor: p.vendedor,
            metodo: p.metodo,
            valor: Number(p.valor || 0),
            detalhe: p.detalhe,
            usuario_nome: p.usuario_nome,
          })),
        })
        .select('id, fechado_em, total_geral')
        .single();
      if (fErr && sqlFaltando(fErr)) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
      }
      if (fErr) throw fErr;

      // Prende os pagamentos abertos neste fechamento (rastreio imutável)
      const { error: upErr } = await supabase
        .from('caixa_pagamentos')
        .update({ fechamento_id: fech.id })
        .is('fechamento_id', null);
      if (upErr) throw upErr;

      return NextResponse.json({
        ok: true,
        fechamento: {
          id: fech.id,
          fechadoEm: fech.fechado_em,
          totalGeral: Number(fech.total_geral || 0),
          qtde: pags.length,
        },
      });
    }

    return NextResponse.json({ ok: false, error: 'Acao desconhecida.' }, { status: 400 });
  } catch (e: any) {
    console.error('[api/caixa][POST] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro no caixa. Tente novamente.' }, { status: 500 });
  }
}
