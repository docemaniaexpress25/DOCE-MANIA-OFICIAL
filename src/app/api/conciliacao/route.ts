import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { isInterConfigured } from '@/lib/interBoleto';
import { hasBoletoColumns, hasSalesBoletosTable } from '@/lib/serverSchema';

/**
 * BLOCO 219 — TELEMETRIA DA BAIXA AUTOMATICA (contas a receber / boletos / Pix)
 *
 * O dono perguntou: "onde e como esta acontecendo a baixa automatica das contas
 * a receber, boletos e Pix? com qual frequencia esta fazendo o sync?"
 *
 * As baixas acontecem em 5 VIAS (todas auditaveis):
 *   1. WEBHOOK INTER  (POST /api/webhooks/inter)      — TEMPO REAL. O Inter
 *      avisa, o app RE-CONSULTA a cobranca na API do Inter (mTLS, verdade na
 *      fonte) e baixa: valor_pago=total, PAGO, baixa_origem='WEBHOOK_INTER'.
 *   2. CRON INTER     (GET /api/boletos-sync)         — REDE DE SEGURANCA,
 *      Vercel Cron "0 10 * * *" = TODO DIA 07:00 (Brasilia). Reconsulta ate
 *      15 boletos unicos + 15 parcelas abertos e baixa sozinho
 *      (baixa_origem='CRON_INTER'). Admin tambem pode disparar na mao.
 *   3. TRIGGER DO CAIXA (SQL 165/167, trg_caixa_david_sales +
 *      trg_baixa_boleto_caixa)                        — TEMPO REAL, dentro do
 *      banco: venda a vista PAGO entra no caixa; venda vira PAGO por QUALQUER
 *      via -> linha BOLETO do caixa ganha pago_em e some da conferencia.
 *   4. PIX PORTAL     (payment_comprovantes + /api/comprovantes/revisar) —
 *      cliente manda comprovante, admin confirma -> baixa_origem='PIX_PORTAL'.
 *   5. MANUAL         (Contas a Receber / PDV)        — baixa_origem='MANUAL'.
 *
 * ESTE ENDPOINT monta o SNAPSHOT que a nova aba CONCILIACAO do admin mostra:
 * filas abertas (boletos unicos, parcelas, boletos pendentes no caixa,
 * comprovantes Pix aguardando revisao), baixas dos ultimos 30 dias por origem,
 * agregado dos eventos webhook_logs por origem nos ultimos 7 dias (prova de
 * vida do webhook vs cron), ultimos eventos em detalhe e o estado da
 * automacao (Inter configurado? CRON_SECRET presente? schema ok?).
 *
 * Autorizacao: SOMENTE sessao ADMIN (leitura — nao altera nada).
 */

export async function GET(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session || session.perfil !== 'ADMIN') {
    return NextResponse.json({ ok: false, erro: 'Somente admin.' }, { status: 401 });
  }

  const db = getServiceClient();
  const agora = new Date();
  const corte30 = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const corte7 = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // ---------- CONFIG (o que precisa estar de pe para a baixa automatica funcionar)
  const [boletosOk, parcelasOk] = await Promise.all([hasBoletoColumns(), hasSalesBoletosTable()]);
  const config = {
    interConfigurado: isInterConfigured(),
    cronSecretPresente: !!process.env.CRON_SECRET,
    schemaBoletosOk: boletosOk,
    parcelasOk,
  };

  // ---------- FILA 1: boletos UNICOS abertos (sales.inter_boleto_*)
  const filas = {
    boletosUnicos: [] as Array<{ status: string; qtde: number; total: number }>,
    parcelas: [] as Array<{ status: string; qtde: number; total: number }>,
    caixaBoletosPendentes: { qtde: 0, total: 0 },
    comprovantesPendentes: { qtde: 0, total: 0, maisAntiga: null as string | null },
  };
  const somaPorStatus = (rows: Array<Record<string, unknown>>, campo: string, campoValor: string) => {
    const m = new Map<string, { qtde: number; total: number }>();
    for (const r of rows) {
      const s = String(r[campo] || '?');
      const e = m.get(s) || { qtde: 0, total: 0 };
      e.qtde++; e.total += Number(r[campoValor]) || 0;
      m.set(s, e);
    }
    return [...m.entries()].map(([status, v]) => ({ status, ...v }));
  };

  try {
    const { data } = await db
      .from('sales')
      .select('inter_boleto_status, valor_total')
      .in('inter_boleto_status', ['EM_PROCESSAMENTO', 'A_RECEBER', 'ATRASADO'])
      .limit(1000);
    filas.boletosUnicos = somaPorStatus((data || []) as Array<Record<string, unknown>>, 'inter_boleto_status', 'valor_total');
  } catch (e: unknown) {
    console.warn('[conciliacao] fila boletos unicos falhou:', (e as Error).message);
  }

  // ---------- FILA 2: PARCELAS abertas (sales_boletos — boleto duplo R5)
  try {
    const { data } = await db
      .from('sales_boletos')
      .select('status, valor')
      .in('status', ['EM_PROCESSAMENTO', 'A_RECEBER', 'ATRASADO', 'FALHA_EMISSAO'])
      .limit(1000);
    filas.parcelas = somaPorStatus((data || []) as Array<Record<string, unknown>>, 'status', 'valor');
  } catch (e: unknown) {
    console.warn('[conciliacao] fila parcelas falhou:', (e as Error).message);
  }

  // ---------- FILA 3: linhas BOLETO pendentes no CAIXA (aguardando a trigger 167)
  try {
    const { data } = await db
      .from('caixa_pagamentos')
      .select('valor')
      .eq('metodo', 'BOLETO')
      .is('pago_em', null)
      .limit(1000);
    const rows = (data || []) as Array<{ valor: number }>;
    filas.caixaBoletosPendentes = {
      qtde: rows.length,
      total: rows.reduce((a, r) => a + (Number(r.valor) || 0), 0),
    };
  } catch (e: unknown) {
    console.warn('[conciliacao] caixa boletos falhou:', (e as Error).message);
  }

  // ---------- FILA 4: comprovantes Pix do PORTAL aguardando revisao
  try {
    const { data } = await db
      .from('payment_comprovantes')
      .select('valor, created_at')
      .eq('status', 'PENDENTE')
      .order('created_at', { ascending: true })
      .limit(500);
    const rows = (data || []) as Array<{ valor: number; created_at: string }>;
    filas.comprovantesPendentes = {
      qtde: rows.length,
      total: rows.reduce((a, r) => a + (Number(r.valor) || 0), 0),
      maisAntiga: rows[0]?.created_at || null,
    };
  } catch (e: unknown) {
    console.warn('[conciliacao] comprovantes falhou:', (e as Error).message);
  }

  // ---------- BAIXAS dos ultimos 30 dias POR ORIGEM (a prova do que funcionou)
  const baixas30d: Array<{ origem: string; qtde: number; total: number }> = [];
  try {
    const { data } = await db
      .from('sales')
      .select('baixa_origem, valor_total')
      .not('baixa_origem', 'is', null)
      .gte('baixa_em', corte30)
      .limit(2000);
    const m = new Map<string, { qtde: number; total: number }>();
    for (const r of (data || []) as Array<Record<string, unknown>>) {
      const o = String(r.baixa_origem || 'MANUAL');
      const e = m.get(o) || { qtde: 0, total: 0 };
      e.qtde++; e.total += Number(r.valor_total) || 0;
      m.set(o, e);
    }
    baixas30d.push(...[...m.entries()].map(([origem, v]) => ({ origem, ...v })).sort((a, b) => b.qtde - a.qtde));
  } catch (e: unknown) {
    console.warn('[conciliacao] baixas 30d falhou:', (e as Error).message);
  }

  // ---------- Prova de VIDA: eventos webhook_logs por origem (ultimos 7 dias)
  const origem7d: Array<{ origem: string; qtde: number; ultima: string | null }> = [];
  try {
    const { data } = await db
      .from('webhook_logs')
      .select('origem, criado_em')
      .gte('criado_em', corte7)
      .limit(2000);
    const m = new Map<string, { qtde: number; ultima: string | null }>();
    for (const r of (data || []) as Array<{ origem: string; criado_em: string }>) {
      const o = String(r.origem || 'INTER');
      const e = m.get(o) || { qtde: 0, ultima: null };
      e.qtde++;
      if (!e.ultima || r.criado_em > e.ultima) e.ultima = r.criado_em;
      m.set(o, e);
    }
    origem7d.push(...[...m.entries()].map(([origem, v]) => ({ origem, ...v })).sort((a, b) => b.qtde - a.qtde));
  } catch (e: unknown) {
    console.warn('[conciliacao] origem 7d falhou:', (e as Error).message);
  }

  // ---------- Ultimos 30 eventos em DETALHE (o que o Inter/cron falou agora)
  let log: Array<Record<string, unknown>> = [];
  try {
    const { data } = await db
      .from('webhook_logs')
      .select('criado_em, origem, resultado, processado, codigo, seu_numero, sale_id')
      .order('criado_em', { ascending: false })
      .limit(30);
    log = (data || []) as Array<Record<string, unknown>>;
  } catch (e: unknown) {
    console.warn('[conciliacao] log falhou:', (e as Error).message);
  }

  return NextResponse.json({
    ok: true,
    agora: agora.toISOString(),
    // frequencias reais agendadas na Vercel (vercel.json) — espelhadas na UI
    crons: {
      boletosSync: { schedule: '0 10 * * *', rotulo: 'Todo dia 07:00 (Brasília)', limite: '15 boletos + 15 parcelas por rodada' },
      notasSync: { schedule: '0 12 * * *', rotulo: 'Todo dia 09:00 (Brasília)', limite: 'status fiscal das notas' },
    },
    config,
    filas,
    baixas30d,
    origem7d,
    log,
  });
}
