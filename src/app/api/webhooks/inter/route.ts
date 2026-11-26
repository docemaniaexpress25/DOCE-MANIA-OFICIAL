import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/serverSupabase';
import { hasBoletoColumns, hasSalesBoletosTable } from '@/lib/serverSchema';
import { isInterConfigured, recuperarCobranca, interpretarCobranca } from '@/lib/interBoleto';
// BLOCO 199: baixa da PARCELA do boleto duplo (rota 5) compartilhada com o cron
import { acharParcelaPorCobranca, espelharParcelaInter, baixarParcelaPaga, type ParcelaRow } from '@/lib/baixaBoleto';
// BLOCO 221: aviso aos admins a cada baixa ("toda baixa a gente seja comunicado")
import { avisarBaixaBoleto, nomeClienteDaVenda } from '@/lib/notificacoes';

/**
 * BLOCO 108 — WEBHOOK DO INTER: baixa AUTOMATICA do boleto pago.
 *
 * O dono cadastra esta URL no Internet Banking/API do Inter (Cobranca V3):
 *   https://<app>/api/webhooks/inter
 *
 * SEGURANCA (regra do ERP — nunca confiar no payload): o Inter avisa que
 * ALGO mudou; o app RE-CONSULTA a cobranca direto na API do Inter (mTLS)
 * antes de dar a baixa. Payload mentiroso nao move um centavo.
 *
 * O que faz quando a cobranca esta RECEBIDA:
 *   1. sales.inter_boleto_status = 'RECEBIDO' (+ data)
 *   2. sales.valor_pago = valor_total (o boleto nasce com o SALDO da venda)
 *   3. sales.status_pagamento = 'PAGO'  -> some do CONTAS A RECEBER
 *   4. registra o evento no historico da venda (detalhe_pagamento)
 *   5. BLOCO 167: a TRIGGER trg_baixa_boleto_caixa (SQL 167) reage ao UPDATE
 *      acima e da a BAIXA no CAIXA (linha BOLETO ganha pago_em) — o boleto
 *      pendente "zera" da conferência do caixa na hora.
 *
 * BLOCO 167 — LOG DE PAGAMENTOS/RECEBIMENTOS: TODO evento recebido (pago,
 * aviso de outro status, erro, payload sem codigo) é gravado em webhook_logs
 * e aparece no app: Configurações > ERP Fiscal & Automações > Boletos >
 * "Log de eventos do webhook" (GET /api/webhooks/inter-log, admin).
 *
 * Idempotente: venda ja PAGO -> reconhece e nao rebaixa. Responde 200 SEMPRE
 * (Inter reenvia notificacao em caso de erro — 200 reconhecido para o retry).
 */

/** BLOCO 167: persiste o evento em webhook_logs (best-effort — nunca trava). */
async function logEvento(
  db: ReturnType<typeof getServiceClient>,
  e: { evento: unknown; codigo?: string; seuNumero?: string; saleId?: string | null; resultado: string; processado: boolean; origem?: string }
) {
  try {
    const { error } = await db.from('webhook_logs').insert({
      origem: e.origem || 'INTER',
      evento: (e.evento ?? null) as any,
      codigo: (e.codigo || '').slice(0, 120) || null,
      seu_numero: (e.seuNumero || '').slice(0, 60) || null,
      sale_id: e.saleId ? String(e.saleId).slice(0, 64) : null,
      resultado: (e.resultado || '').slice(0, 300),
      processado: e.processado,
    });
    if (error) console.warn('[inter-webhook] log nao persistido:', error.message);
  } catch (err: any) {
    // SQL 167 ainda nao rodou (tabela nao existe) — webhook segue funcionando.
    console.warn('[inter-webhook] log nao persistido:', err?.message);
  }
}

/**
 * BLOCO 172: marca DE ONDE veio a baixa (origem estruturada p/ o log de
 * pagamentos do app). UPDATE SEPARADO best-effort — se o SQL 172 ainda nao
 * rodou (colunas ausentes), NAO quebra a baixa que ja aconteceu acima.
 */
async function marcarBaixaOrigem(
  db: ReturnType<typeof getServiceClient>,
  saleId: string,
  origem: string
) {
  try {
    const { error } = await db
      .from('sales')
      .update({ baixa_origem: origem, baixa_em: new Date().toISOString() })
      .eq('id', saleId);
    if (error) console.warn('[inter-webhook] baixa_origem nao gravada:', error.message);
  } catch (err: any) {
    console.warn('[inter-webhook] baixa_origem nao gravada:', err?.message);
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    webhook: 'inter-boleto',
    configurado: isInterConfigured(),
    instrucao: 'BLOCO 220: o cadastro e feito PELA API do Inter (PUT /cobranca/v3/cobrancas/webhook) — o app cadastra sozinho em Configuracoes > Boletos > "Ativar baixa automatica". O Internet Banking nao tem tela para webhooks.',
    log: 'Eventos em /api/webhooks/inter-log (admin) e no app: Configuracoes > ERP Fiscal > Boletos.',
  });
}

/**
 * BLOCO 199 — notificação de PARCELA (boleto duplo do Deivid/R5).
 * Mesma disciplina do boleto único: re-consulta o Inter antes de baixar,
 * baixa a PARCELA (valor parcial na venda) e fecha a venda PAGO só quando
 * TODAS as parcelas pagarem (lib/baixaBoleto).
 */
async function processarNotificacaoParcela(
  db: ReturnType<typeof getServiceClient>,
  body: Record<string, unknown>,
  parcela: ParcelaRow,
  codigo: string,
  seuNumero: string
) {
  const log = (resultado: string, processado: boolean) =>
    logEvento(db, { evento: body, codigo, seuNumero, saleId: String(parcela.sale_id), resultado, processado });

  // Idempotência: parcela já recebida — reconhece e não rebaixa
  if (parcela.status === 'RECEBIDO' || parcela.status === 'MARCADO_RECEBIDO') {
    await log(`JA_PAGO — boleto ${parcela.seq} já baixado (R$ ${Number(parcela.valor).toFixed(2)})`, true);
    return NextResponse.json({ ok: true, processado: true, jaPago: true, parcela: parcela.seq });
  }

  // VERDADE NA FONTE: re-consulta a cobranca na API do Inter (mTLS)
  const codigoConsulta = codigo || String(parcela.codigo || '');
  if (!codigoConsulta) {
    await log('SEM_CODIGO_CONSULTA (parcela)', false);
    return NextResponse.json({ ok: true, processado: false, motivo: 'SEM_CODIGO_CONSULTA' });
  }
  const r = await recuperarCobranca(codigoConsulta);
  if (!r.ok || !r.data || 'erro' in r.data) {
    console.warn('[inter-webhook] falha re-consultando parcela', codigoConsulta);
    await log(`FALHA_CONSULTA_INTER parcela ${parcela.seq} (codigo ${codigoConsulta}) — reenvio fará nova tentativa`, false);
    return NextResponse.json({ ok: true, processado: false, motivo: 'FALHA_CONSULTA_INTER' });
  }
  const cob = interpretarCobranca(r.data as Record<string, unknown>);

  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await espelharParcelaInter(db, parcela, cob, hoje);

  const pago = cob.status === 'RECEBIDO' || cob.status === 'MARCADO_RECEBIDO' || (cob.valorRecebido !== null && cob.valorRecebido > 0);
  if (!pago) {
    await log(`PARCELA ${parcela.seq} — STATUS ${cob.status} — ainda não paga`, true);
    return NextResponse.json({ ok: true, processado: true, pago: false, status: cob.status, parcela: parcela.seq });
  }

  const baixou = await baixarParcelaPaga(db, parcela, 'WEBHOOK_INTER');
  await log(baixou
    ? `PARCELA ${parcela.seq} PAGA — baixa automatica R$ ${Number(parcela.valor).toFixed(2)} (fecha quando as ${'duas'} pagarem)`
    : `PARCELA ${parcela.seq} paga — baixa já feita por outra via`, true);
  return NextResponse.json({ ok: true, processado: true, pago: true, parcela: parcela.seq, baixou });
}

export async function POST(req: NextRequest) {
  // BLOCO 220 — O CALLBACK DO INTER E UM ARRAY. A spec oficial (referencia
  // cobranca-bolepix, "Callback payload samples") envia
  //   [ { codigoSolicitacao, seuNumero, situacao, valorTotalRecebido, ... } ]
  // Antes o body era tratado como OBJETO: body.codigoSolicitacao dava undefined
  // quando o Inter mandava o array real e o evento caia em SEM_CODIGO (a baixa
  // automatica nao rodava na primeira notificacao). Agora normaliza e processa
  // evento a evento (o validador do portal do desenvolvedor tambem manda array).
  const payload = (await req.json().catch(() => null)) as unknown;
  const eventos: Record<string, unknown>[] = Array.isArray(payload)
    ? payload.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    : payload && typeof payload === 'object'
      ? [payload as Record<string, unknown>]
      : [];

  const db = getServiceClient();

  if (eventos.length === 0) {
    await logEvento(db, { evento: (payload ?? {}) as unknown, resultado: 'PAYLOAD_VAZIO — callback sem conteudo JSON valido', processado: false });
    return NextResponse.json({ ok: true, processado: false, motivo: 'PAYLOAD_VAZIO' });
  }
  if (eventos.length === 1) return processarEvento(db, eventos[0]);
  // Varios eventos: processa em sequencia e devolve a lista (o Inter so le o
  // HTTP 200 — a resposta detalhada serve para o log/admin e para o validador).
  const detalhes: Record<string, unknown>[] = [];
  for (const ev of eventos.slice(0, 20)) {
    const r = await processarEvento(db, ev);
    detalhes.push(await r.json().catch(() => ({})));
  }
  return NextResponse.json({ ok: true, eventos: eventos.length, detalhes });
}

/** BLOCO 220: processa UM evento do callback (antes era o corpo do POST). */
async function processarEvento(db: ReturnType<typeof getServiceClient>, body: Record<string, unknown>) {
  // O Inter pode mandar codigos em varias chaves — acacha todas
  const codigo =
    String(body.codigoSolicitacao || body.codigo || body.codigoSolicitacaoBoleto || '').trim() ||
    String((body.cobranca as Record<string, unknown>)?.codigoSolicitacao || '').trim();

  // seuNumero = DM<saleId> — fallback quando o codigo nao veio no payload
  const seuNumero = String(body.seuNumero || (body.cobranca as Record<string, unknown>)?.seuNumero || '').trim();
  const saleIdPeloSeuNumero = seuNumero.startsWith('DM') ? seuNumero.slice(2) : '';

  // 1. Sem credenciais Inter nao ha o que fazer (mas responde 200 p/ o Inter parar de reenviar)
  if (!isInterConfigured()) {
    await logEvento(db, { evento: body, codigo, seuNumero, resultado: 'INTER_NAO_CONFIGURADO — defina INTER_CLIENT_ID/SECRET e o certificado na Vercel', processado: false });
    return NextResponse.json({ ok: false, processado: false, motivo: 'INTER_NAO_CONFIGURADO' });
  }
  if (!(await hasBoletoColumns())) {
    await logEvento(db, { evento: body, codigo, seuNumero, resultado: 'SCHEMA_ANTIGO — rode o SQL do bloco 25', processado: false });
    return NextResponse.json({ ok: false, processado: false, motivo: 'SCHEMA_ANTIGO' });
  }

  if (!codigo && !saleIdPeloSeuNumero) {
    // Notificacao sem identificacao util: reconhece (o Inter manda sempre o mesmo formato
    // por venda; sem codigo nao ha como re-consultar)
    console.warn('[inter-webhook] notificacao sem codigo/seuNumero:', JSON.stringify(body).slice(0, 300));
    await logEvento(db, { evento: body, resultado: 'SEM_CODIGO — payload sem codigoSolicitacao/seuNumero', processado: false });
    return NextResponse.json({ ok: true, processado: false, motivo: 'SEM_CODIGO' });
  }

  // 1.5 BLOCO 199 (boleto duplo rota 5): a notificação pode ser da PARCELA —
  // tenta localizar em sales_boletos (por codigo, fallback seu_numero) e,
  // achando, processa por lá (baixa parcial; a venda fecha quando todas pagarem).
  if (await hasSalesBoletosTable()) {
    const parcela = await acharParcelaPorCobranca(db, codigo, seuNumero);
    if (parcela) return processarNotificacaoParcela(db, body, parcela, codigo, seuNumero);
  }

  // 2. Acha a venda (pelo codigo da cobranca gravado na emissao, senao pelo seuNumero)
  // BLOCO 221: client_id entra no select para o aviso de baixa levar o nome do cliente.
  const SALES_COLS = 'id, valor_total, valor_pago, status_pagamento, metodo_pagamento, detalhe_pagamento, inter_boleto_codigo, inter_boleto_seu_numero, inter_boleto_status, client_id';
  let sale: Record<string, unknown> | null = null;
  if (codigo) {
    const { data } = await db
      .from('sales')
      .select(SALES_COLS)
      .eq('inter_boleto_codigo', codigo)
      .limit(1)
      .maybeSingle();
    sale = (data as Record<string, unknown>) || null;
  }
  if (!sale && seuNumero) {
    // BLOCO 172 — FIX: o seuNumero gravado na emissao é TRUNCADO (DM + 9 chars
    // do UUID, ex. DMDBB1E53EE) — o fallback antigo buscava .eq('id', truncado)
    // e NUNCA casava. O casamento correto é pelo campo gravado na emissao
    // (cobre o seuNumero normal e as reemissoes DM...-r2/r3).
    const { data: porSeuNumero } = await db
      .from('sales')
      .select(SALES_COLS)
      .eq('inter_boleto_seu_numero', seuNumero)
      .limit(1)
      .maybeSingle();
    sale = (porSeuNumero as Record<string, unknown>) || null;
  }
  if (!sale && saleIdPeloSeuNumero && /^[0-9a-f-]{36}$/i.test(saleIdPeloSeuNumero)) {
    // fallback final: seuNumero completo tipo DM<uuid> (nao existe hoje, mas
    // protege contra mudanca de formato) — so aceita UUID real.
    const { data } = await db
      .from('sales')
      .select(SALES_COLS)
      .eq('id', saleIdPeloSeuNumero)
      .limit(1)
      .maybeSingle();
    sale = (data as Record<string, unknown>) || null;
  }
  if (!sale) {
    console.warn('[inter-webhook] venda nao encontrada p/ codigo', codigo || seuNumero);
    await logEvento(db, { evento: body, codigo, seuNumero, resultado: 'VENDA_NAO_ENCONTRADA — boleto emitido FORA do app? Boletos gerados direto no Internet Banking nao tem venda vinculada: baixar manual no Contas a Receber', processado: false });
    return NextResponse.json({ ok: true, processado: false, motivo: 'VENDA_NAO_ENCONTRADA' });
  }

  // 3. Idempotencia: ja pago nao rebaixa (mas reconfirma status do boleto se ficou pendente)
  if (sale.status_pagamento === 'PAGO') {
    if (sale.inter_boleto_status !== 'RECEBIDO' && codigo) {
      await db.from('sales').update({ inter_boleto_status: 'RECEBIDO' }).eq('id', sale.id as string);
    }
    await logEvento(db, { evento: body, codigo, seuNumero, saleId: String(sale.id), resultado: `JA_PAGO — baixa já havia sido feita (R$ ${Number(sale.valor_total).toFixed(2)})`, processado: true });
    return NextResponse.json({ ok: true, processado: true, jaPago: true });
  }

  // 4. VERDADE NA FONTE: re-consulta a cobranca na API do Inter (mTLS)
  const codigoConsulta = codigo || String(sale.inter_boleto_codigo || '');
  if (!codigoConsulta) {
    await logEvento(db, { evento: body, codigo, seuNumero, saleId: String(sale.id), resultado: 'SEM_CODIGO_CONSULTA', processado: false });
    return NextResponse.json({ ok: true, processado: false, motivo: 'SEM_CODIGO_CONSULTA' });
  }
  const r = await recuperarCobranca(codigoConsulta);
  if (!r.ok || !r.data || 'erro' in r.data) {
    console.warn('[inter-webhook] falha re-consultando cobranca', codigoConsulta);
    await logEvento(db, { evento: body, codigo, seuNumero, saleId: String(sale.id), resultado: `FALHA_CONSULTA_INTER (codigo ${codigoConsulta}) — reenvio do Inter fará novo tentativo`, processado: false });
    return NextResponse.json({ ok: true, processado: false, motivo: 'FALHA_CONSULTA_INTER' });
  }
  const cob = interpretarCobranca(r.data as Record<string, unknown>);
  const pago = cob.status === 'RECEBIDO' || (cob.valorRecebido !== null && cob.valorRecebido > 0);

  if (!pago) {
    // Aviso de outro evento (vencido, baixado...): espelha o status do boleto
    if (cob.status && cob.status !== sale.inter_boleto_status) {
      await db.from('sales').update({ inter_boleto_status: cob.status }).eq('id', sale.id as string);
    }
    await logEvento(db, { evento: body, codigo, seuNumero, saleId: String(sale.id), resultado: `STATUS ${cob.status} — ainda não pago`, processado: true });
    return NextResponse.json({ ok: true, processado: true, pago: false, status: cob.status });
  }

  // 5. BAIXA NO CONTAS A RECEBER (a venda deixa de estar em aberto)
  const valorTotal = Number(sale.valor_total) || 0;
  const carimbo = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  const logAnterior = String(sale.detalhe_pagamento || '').trim();
  const logNovo = `${logAnterior ? logAnterior + ' | ' : ''}BOLETO RECEBIDO (Inter) em ${carimbo} — baixa automatica (webhook)`;

  const { error } = await db
    .from('sales')
    .update({
      valor_pago: valorTotal,
      status_pagamento: 'PAGO',
      inter_boleto_status: 'RECEBIDO',
      detalhe_pagamento: logNovo,
    })
    .eq('id', sale.id as string);

  if (error) {
    console.error('[inter-webhook] falha gravando baixa:', error.message);
    await logEvento(db, { evento: body, codigo, seuNumero, saleId: String(sale.id), resultado: `FALHA_GRAVACAO — ${error.message}`, processado: false });
    return NextResponse.json({ ok: true, processado: false, motivo: 'FALHA_GRAVACAO' });
  }

  // BLOCO 172: origem da baixa (best-effort — não trava se SQL 172 faltar).
  await marcarBaixaOrigem(db, String(sale.id), 'WEBHOOK_INTER');

  // BLOCO 221: AVISO aos admins — "toda baixa a gente seja comunicado". O aviso
  // fica na tabela notificacoes e aparece no sino do app (persistente) + o
  // realtime de sales ja toca o alerta sonoro na hora. Best-effort.
  const clienteWebhook = await nomeClienteDaVenda(db, sale.client_id);
  await avisarBaixaBoleto(db, { saleId: String(sale.id), valor: valorTotal, origem: 'WEBHOOK_INTER', cliente: clienteWebhook });

  // BLOCO 167: a trigger trg_baixa_boleto_caixa (SQL 167) já deu a baixa no
  // CAIXA (pago_em) como reação ao UPDATE acima — nada extra a fazer aqui.
  console.log('[inter-webhook] BAIXA AUTOMATICA ok — venda', sale.id, 'R$', valorTotal.toFixed(2));
  await logEvento(db, { evento: body, codigo, seuNumero, saleId: String(sale.id), resultado: `BOLETO PAGO — baixa automatica R$ ${valorTotal.toFixed(2)} (contas a receber + caixa)`, processado: true });
  return NextResponse.json({ ok: true, processado: true, pago: true, saleId: sale.id, valor: valorTotal });
}
