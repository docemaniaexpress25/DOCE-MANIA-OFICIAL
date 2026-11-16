import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasBoletoColumns } from '@/lib/serverSchema';
import { isInterConfigured, recuperarCobranca, interpretarCobranca } from '@/lib/interBoleto';

/**
 * BLOCO 145 — SINCRONIZACAO AUTOMATICA DE BOLETOS (cron da Vercel).
 *
 * O webhook do Inter dá a baixa em tempo real, mas se a notificação não
 * chegar (Internet Banking mal configurado, timeout, evento perdido) o
 * boleto PAGO ficava "a receber" para sempre. Este cron é a REDE DE
 * SEGURANÇA (mesmo modelo do /api/notas-sync): reconsulta o Inter e
 * atualiza/baixa sozinho.
 *
 * GET /api/boletos-sync  (sem sessao!)
 *   Autorizacao: header `Authorization: Bearer ${CRON_SECRET}` — a Vercel
 *   Cron envia esse header automaticamente quando a env CRON_SECRET existe.
 *   ADMIN logado tambem pode chamar ("sincronizar agora").
 *
 * VARRE: sales com inter_boleto_status IN (EM_PROCESSAMENTO, A_RECEBER,
 * ATRASADO) — max 15 por rodada (rate limit do Inter respeitado; endpoint
 * de token aceita 5 req/min). Para cada uma:
 *   - reconsulta a cobranca na API do Inter (verdade na fonte);
 *   - espelha status/linha/pix/erro na venda;
 *   - A_RECEBER com vencimento passado vira ATRASADO;
 *   - RECEBIDO + venda não PAGO = BAIXA (valor_pago = total, PAGO, log no
 *     detalhe + comissão A_RECEBER -> DISPONIVEL).
 * Degradacao graciosa total: colunas ausentes ou Inter nao configurado =
 * no-op ok. Idempotente (venda PAGO nunca rebaixa).
 */

const LIMITE = 15;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET || '';
  const viaCron = !!secret && auth === `Bearer ${secret}`;
  const session = sessionFromRequest(req);
  const viaAdmin = session?.perfil === 'ADMIN';
  if (!viaCron && !viaAdmin) {
    return NextResponse.json({ ok: false, erro: 'Nao autorizado (cron ou admin).' }, { status: 401 });
  }

  if (!(await hasBoletoColumns())) {
    return NextResponse.json({ ok: true, processadas: 0, motivo: 'SCHEMA_ANTIGO' });
  }
  if (!isInterConfigured()) {
    return NextResponse.json({ ok: true, processadas: 0, motivo: 'INTER_NAO_CONFIGURADO' });
  }

  const db = getServiceClient();
  const { data: abertos, error } = await db
    .from('sales')
    .select('id, valor_total, valor_pago, status_pagamento, detalhe_pagamento, inter_boleto_status, inter_boleto_codigo, inter_boleto_vencimento')
    .in('inter_boleto_status', ['EM_PROCESSAMENTO', 'A_RECEBER', 'ATRASADO'])
    .limit(LIMITE);

  if (error) {
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }
  const fila = (abertos || []) as Record<string, unknown>[];
  if (fila.length === 0) {
    return NextResponse.json({ ok: true, processadas: 0, motivo: 'NADA_ABERTO' });
  }

  let processadas = 0;
  let baixadas = 0;
  const falhas: Array<{ id: string; erro: string }> = [];
  const hojeSp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  for (const sale of fila) {
    const saleId = String(sale.id);
    const codigo = String(sale.inter_boleto_codigo || '');
    if (!codigo) continue;
    try {
      const r = await recuperarCobranca(codigo);
      if (!r.ok || !r.data || 'erro' in r.data) {
        falhas.push({ id: saleId, erro: 'consulta falhou' });
        continue;
      }
      const cob = interpretarCobranca(r.data as Record<string, unknown>);
      processadas++;

      const vencido = !!String(cob.vencimento || '') && String(cob.vencimento) < hojeSp;
      const statusFinal = cob.status === 'A_RECEBER' && vencido && sale.status_pagamento !== 'PAGO'
        ? 'ATRASADO'
        : cob.status;

      const patch: Record<string, unknown> = {
        inter_boleto_status: statusFinal,
        inter_boleto_linha: cob.linhaDigitavel || null,
        inter_boleto_barras: cob.codigoBarras || null,
        inter_boleto_pix: cob.pixCopiaECola || null,
        inter_boleto_erro: statusFinal === 'FALHA_EMISSAO' ? 'Falha na emissao no Inter' : null,
      };

      const pagoInter = cob.status === 'RECEBIDO' || cob.status === 'MARCADO_RECEBIDO' || (cob.valorRecebido !== null && cob.valorRecebido > 0);
      if (pagoInter && sale.status_pagamento !== 'PAGO') {
        const valorTotal = Number(sale.valor_total) || 0;
        const carimbo = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date());
        const logAnterior = String(sale.detalhe_pagamento || '').trim();
        patch.valor_pago = valorTotal;
        patch.status_pagamento = 'PAGO';
        patch.inter_boleto_status = 'RECEBIDO';
        patch.detalhe_pagamento = `${logAnterior ? logAnterior + ' | ' : ''}BOLETO RECEBIDO (Inter) em ${carimbo} — baixa automatica (sync)`;
        baixadas++;
      }
      await db.from('sales').update(patch).eq('id', saleId);
      if (pagoInter) {
        try {
          await db.from('commissions').update({ status: 'DISPONIVEL' }).eq('sale_id', saleId).eq('status', 'A_RECEBER');
        } catch { /* best-effort */ }
      }
    } catch (e: unknown) {
      falhas.push({ id: saleId, erro: e instanceof Error ? e.message : 'erro' });
    }
  }

  return NextResponse.json({ ok: true, processadas, baixadas, falhas: falhas.length ? falhas : undefined });
}
