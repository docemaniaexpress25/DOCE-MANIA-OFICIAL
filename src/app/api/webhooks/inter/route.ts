import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/serverSupabase';
import { hasBoletoColumns } from '@/lib/serverSchema';
import { isInterConfigured, recuperarCobranca, interpretarCobranca } from '@/lib/interBoleto';

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
 *
 * Idempotente: venda ja PAGO -> reconhece e nao rebaixa. Responde 200 SEMPRE
 * (Inter reenvia notificacao em caso de erro — 200 reconhecido para o retry).
 */

export async function GET() {
  return NextResponse.json({
    ok: true,
    webhook: 'inter-boleto',
    configurado: isInterConfigured(),
    instrucao: 'Cadastre esta URL no Internet Banking do Inter (Cobranca V3 -> Webhooks). A baixa so acontece apos re-consulta na API do Inter.',
  });
}

export async function POST(req: NextRequest) {
  // 1. Sem credenciais Inter nao ha o que fazer (mas responde 200 p/ o Inter parar de reenviar)
  if (!isInterConfigured()) {
    return NextResponse.json({ ok: false, processado: false, motivo: 'INTER_NAO_CONFIGURADO' });
  }
  if (!(await hasBoletoColumns())) {
    return NextResponse.json({ ok: false, processado: false, motivo: 'SCHEMA_ANTIGO' });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // O Inter pode mandar codigos em varias chaves — acacha todas
  const codigo =
    String(body.codigoSolicitacao || body.codigo || body.codigoSolicitacaoBoleto || '').trim() ||
    String((body.cobranca as Record<string, unknown>)?.codigoSolicitacao || '').trim();

  // seuNumero = DM<saleId> — fallback quando o codigo nao veio no payload
  const seuNumero = String(body.seuNumero || (body.cobranca as Record<string, unknown>)?.seuNumero || '').trim();
  const saleIdPeloSeuNumero = seuNumero.startsWith('DM') ? seuNumero.slice(2) : '';

  if (!codigo && !saleIdPeloSeuNumero) {
    // Notificacao sem identificacao util: reconhece (o Inter manda sempre o mesmo formato
    // por venda; sem codigo nao ha como re-consultar)
    console.warn('[inter-webhook] notificacao sem codigo/seuNumero:', JSON.stringify(body).slice(0, 300));
    return NextResponse.json({ ok: true, processado: false, motivo: 'SEM_CODIGO' });
  }

  const db = getServiceClient();

  // 2. Acha a venda (pelo codigo da cobranca gravado na emissao, senao pelo seuNumero)
  let sale: Record<string, unknown> | null = null;
  if (codigo) {
    const { data } = await db
      .from('sales')
      .select('id, valor_total, valor_pago, status_pagamento, metodo_pagamento, detalhe_pagamento, inter_boleto_codigo, inter_boleto_status')
      .eq('inter_boleto_codigo', codigo)
      .limit(1)
      .maybeSingle();
    sale = (data as Record<string, unknown>) || null;
  }
  if (!sale && saleIdPeloSeuNumero) {
    const { data } = await db
      .from('sales')
      .select('id, valor_total, valor_pago, status_pagamento, metodo_pagamento, detalhe_pagamento, inter_boleto_codigo, inter_boleto_status')
      .eq('id', saleIdPeloSeuNumero)
      .limit(1)
      .maybeSingle();
    sale = (data as Record<string, unknown>) || null;
  }
  if (!sale) {
    console.warn('[inter-webhook] venda nao encontrada p/ codigo', codigo || seuNumero);
    return NextResponse.json({ ok: true, processado: false, motivo: 'VENDA_NAO_ENCONTRADA' });
  }

  // 3. Idempotencia: ja pago nao rebaixa (mas reconfirma status do boleto se ficou pendente)
  if (sale.status_pagamento === 'PAGO') {
    if (sale.inter_boleto_status !== 'RECEBIDO' && codigo) {
      await db.from('sales').update({ inter_boleto_status: 'RECEBIDO' }).eq('id', sale.id as string);
    }
    return NextResponse.json({ ok: true, processado: true, jaPago: true });
  }

  // 4. VERDADE NA FONTE: re-consulta a cobranca na API do Inter (mTLS)
  const codigoConsulta = codigo || String(sale.inter_boleto_codigo || '');
  if (!codigoConsulta) {
    return NextResponse.json({ ok: true, processado: false, motivo: 'SEM_CODIGO_CONSULTA' });
  }
  const r = await recuperarCobranca(codigoConsulta);
  if (!r.ok || !r.data || 'erro' in r.data) {
    console.warn('[inter-webhook] falha re-consultando cobranca', codigoConsulta);
    return NextResponse.json({ ok: true, processado: false, motivo: 'FALHA_CONSULTA_INTER' });
  }
  const cob = interpretarCobranca(r.data as Record<string, unknown>);
  const pago = cob.status === 'RECEBIDO' || (cob.valorRecebido !== null && cob.valorRecebido > 0);

  if (!pago) {
    // Aviso de outro evento (vencido, baixado...): espelha o status do boleto
    if (cob.status && cob.status !== sale.inter_boleto_status) {
      await db.from('sales').update({ inter_boleto_status: cob.status }).eq('id', sale.id as string);
    }
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
    return NextResponse.json({ ok: true, processado: false, motivo: 'FALHA_GRAVACAO' });
  }

  console.log('[inter-webhook] BAIXA AUTOMATICA ok — venda', sale.id, 'R$', valorTotal.toFixed(2));
  return NextResponse.json({ ok: true, processado: true, pago: true, saleId: sale.id, valor: valorTotal });
}
