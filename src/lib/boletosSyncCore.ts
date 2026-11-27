import { getServiceClient } from '@/lib/serverSupabase';
import { hasBoletoColumns, hasSalesBoletosTable } from '@/lib/serverSchema';
import { isInterConfigured, recuperarCobranca, interpretarCobranca } from '@/lib/interBoleto';
import { espelharParcelaInter, baixarParcelaPaga, type ParcelaRow } from '@/lib/baixaBoleto';
// BLOCO 221: aviso aos admins a cada baixa ("toda baixa a gente seja comunicado")
import { avisarBaixaBoleto, nomeClienteDaVenda } from '@/lib/notificacoes';

/**
 * BLOCO 221 — CORE DA SINCRONIZACAO DE BOLETOS (extraido da rota
 * /api/boletos-sync para o AUTO-SYNC horario poder reutilizar o MESMO
 * trabalho sem duplicar codigo).
 *
 * O webhook do Inter dá a baixa em tempo real, mas se a notificação não
 * chegar (callback mal configurado, timeout, evento perdido) o boleto PAGO
 * ficava "a receber" para sempre. Este sync é a REDE DE SEGURANÇA:
 * reconsulta o Inter e atualiza/baixa sozinho.
 *
 * VARRE: sales com inter_boleto_status IN (EM_PROCESSAMENTO, A_RECEBER,
 * ATRASADO) — max 15 por rodada (rate limit do Inter respeitado; endpoint
 * de token aceita 5 req/min) + parcelas do boleto duplo (sales_boletos).
 * Para cada uma:
 *   - reconsulta a cobranca na API do Inter (verdade na fonte);
 *   - espelha status/linha/pix/erro;
 *   - A_RECEBER com vencimento passado vira ATRASADO;
 *   - RECEBIDO + venda não PAGO = BAIXA (valor_pago = total, PAGO, log no
 *     detalhe, comissão A_RECEBER -> DISPONIVEL, aviso aos admins).
 * Degradacao graciosa total: colunas ausentes ou Inter nao configurado =
 * no-op ok. Idempotente (venda PAGO nunca rebaixa).
 */

const LIMITE = 15;

export interface ResumoSync {
  ok: boolean;
  processadas: number;
  baixadas: number;
  falhas?: Array<{ id: string; erro: string }>;
  motivo?: string;
}

/** Persiste o evento do SYNC em webhook_logs (origem 'CRON'). Best-effort. */
async function logCronEvento(
  db: ReturnType<typeof getServiceClient>,
  e: { codigo?: string; seuNumero?: string; saleId?: string; resultado: string; processado: boolean }
) {
  try {
    const { error } = await db.from('webhook_logs').insert({
      origem: 'CRON',
      evento: { fonte: 'boletos-sync' } as any,
      codigo: (e.codigo || '').slice(0, 120) || null,
      seu_numero: (e.seuNumero || '').slice(0, 60) || null,
      sale_id: e.saleId ? String(e.saleId).slice(0, 64) : null,
      resultado: (e.resultado || '').slice(0, 300),
      processado: e.processado,
    });
    if (error) console.warn('[boletos-sync] log nao persistido:', error.message);
  } catch (err: any) {
    console.warn('[boletos-sync] log nao persistido:', err?.message);
  }
}

/** Marca DE ONDE veio a baixa (origem estruturada). UPDATE separado best-effort. */
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
    if (error) console.warn('[boletos-sync] baixa_origem nao gravada:', error.message);
  } catch (err: any) {
    console.warn('[boletos-sync] baixa_origem nao gravada:', err?.message);
  }
}

/**
 * BLOCO 221 — EXECUTA uma rodada completa do sync (boletos unicos + parcelas).
 * Usada por: cron da Vercel (/api/boletos-sync), botao "Sincronizar agora"
 * do admin e AUTO-SYNC horario (lib/autoSync).
 */
export async function executarSyncBoletos(): Promise<ResumoSync> {
  if (!(await hasBoletoColumns())) {
    return { ok: true, processadas: 0, baixadas: 0, motivo: 'SCHEMA_ANTIGO' };
  }
  if (!isInterConfigured()) {
    return { ok: true, processadas: 0, baixadas: 0, motivo: 'INTER_NAO_CONFIGURADO' };
  }

  const db = getServiceClient();
  const { data: abertos, error } = await db
    .from('sales')
    .select('id, valor_total, valor_pago, status_pagamento, detalhe_pagamento, inter_boleto_status, inter_boleto_codigo, inter_boleto_seu_numero, inter_boleto_vencimento, client_id')
    .in('inter_boleto_status', ['EM_PROCESSAMENTO', 'A_RECEBER', 'ATRASADO'])
    .limit(LIMITE);

  if (error) {
    return { ok: false, processadas: 0, baixadas: 0, motivo: error.message };
  }
  const fila = (abertos || []) as Record<string, unknown>[];
  if (fila.length === 0) {
    return { ok: true, processadas: 0, baixadas: 0, motivo: 'NADA_ABERTO' };
  }

  let processadas = 0;
  let baixadas = 0;
  const falhas: Array<{ id: string; erro: string }> = [];
  const hojeSp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  for (const sale of fila) {
    const saleId = String(sale.id);
    const codigo = String(sale.inter_boleto_codigo || '');
    const seuNumero = String((sale as any).inter_boleto_seu_numero || '');
    if (!codigo) continue;
    try {
      const r = await recuperarCobranca(codigo);
      // BLOCO 222 (auto-reparo): 404 = o Inter NAO conhece essa cobranca — a
      // emissao nunca completou lá (rede caiu depois do POST, etc). Antes a
      // venda ficava EM_PROCESSAMENTO PARA SEMPRE ("boleto nao gera"); agora
      // marca FALHA_EMISSAO e o card volta a oferecer GERAR/REEMITIR.
      if (!r.ok && r.status === 404) {
        await db.from('sales').update({
          inter_boleto_status: 'FALHA_EMISSAO',
          inter_boleto_erro: 'Cobranca nao encontrada no Inter (404) — emita o boleto novamente.',
        }).eq('id', saleId);
        await logCronEvento(db, { codigo, seuNumero, saleId, resultado: 'CRON — cobranca nao existe no Inter (404): marcada FALHA_EMISSAO para reemitir', processado: true });
        continue;
      }
      if (!r.ok || !r.data || 'erro' in r.data) {
        falhas.push({ id: saleId, erro: 'consulta falhou' });
        await logCronEvento(db, { codigo, seuNumero, saleId, resultado: `CRON — falha re-consultando cobranca ${codigo.slice(0, 18)}`, processado: false });
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
        // O cron também fica visível no log de eventos (origem CRON)
        // e marca a origem estruturada da baixa (CRON_INTER).
        await logCronEvento(db, { codigo, seuNumero, saleId, resultado: `BOLETO PAGO (via sync) — baixa automatica R$ ${valorTotal.toFixed(2)} (contas a receber + caixa)`, processado: true });
        // BLOCO 221: AVISO aos admins ("toda baixa a gente seja comunicado")
        const cliente = await nomeClienteDaVenda(db, sale.client_id);
        await avisarBaixaBoleto(db, { saleId, valor: valorTotal, origem: 'CRON_INTER', cliente });
      }
      await db.from('sales').update(patch).eq('id', saleId);
      if (pagoInter) {
        if (sale.status_pagamento !== 'PAGO') await marcarBaixaOrigem(db, saleId, 'CRON_INTER');
        try {
          await db.from('commissions').update({ status: 'DISPONIVEL' }).eq('sale_id', saleId).eq('status', 'A_RECEBER');
        } catch { /* best-effort */ }
      }
    } catch (e: unknown) {
      falhas.push({ id: saleId, erro: e instanceof Error ? e.message : 'erro' });
    }
  }

  // Segunda varredura — PARCELAS do boleto duplo (rota 5).
  // Degradacao graciosa: tabela ausente (SQL 199 pendente) não afeta o sync
  // das vendas acima.
  if (await hasSalesBoletosTable()) {
    const sinc = await sincronizarParcelas(db);
    processadas += sinc.processadas;
    baixadas += sinc.baixadas;
    if (sinc.falhas > 0) falhas.push({ id: 'parcelas', erro: `${sinc.falhas} falha(s) no sync das parcelas` });
  }

  return { ok: true, processadas, baixadas, falhas: falhas.length ? falhas : undefined };
}

/**
 * SINCRONIZACAO DAS PARCELAS (boleto duplo do Deivid/R5).
 * Mesma rede de segurança do boleto único, aplicada às cobranças da tabela
 * sales_boletos: reconsulta o Inter, espelha status, marca ATRASADO por
 * vencimento e baixa a parcela paga (a venda fecha quando TODAS pagarem).
 */
async function sincronizarParcelas(db: ReturnType<typeof getServiceClient>): Promise<{ processadas: number; baixadas: number; falhas: number }> {
  const LIMITE_PARCELAS = 15;
  const hojeSp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let processadas = 0;
  let baixadas = 0;
  let falhas = 0;

  const { data: abertas, error } = await db
    .from('sales_boletos')
    .select('id, sale_id, seq, valor, vencimento, status, codigo, seu_numero, linha, barras, pix, erro')
    .in('status', ['EM_PROCESSAMENTO', 'A_RECEBER', 'ATRASADO'])
    .order('vencimento', { ascending: true })
    .limit(LIMITE_PARCELAS);
  if (error) {
    console.warn('[boletos-sync] leitura das parcelas falhou:', error.message);
    return { processadas: 0, baixadas: 0, falhas: 1 };
  }
  for (const p of (abertas || []) as unknown as ParcelaRow[]) {
    if (!p.codigo) continue;
    try {
      const r = await recuperarCobranca(p.codigo);
      // BLOCO 222 (auto-reparo da PARCELA): mesmo 404 do boleto unico — sem
      // isso a parcela ficava "Gerando no Inter..." para sempre e travava a
      // venda do boleto duplo (rota 5).
      if (!r.ok && r.status === 404) {
        await db.from('sales_boletos').update({
          status: 'FALHA_EMISSAO',
          erro: 'Cobranca nao encontrada no Inter (404) — gere o boleto novamente.',
        }).eq('id', String(p.id));
        await logCronEvento(db, { codigo: p.codigo, seuNumero: p.seu_numero || '', saleId: p.sale_id, resultado: `CRON parcela ${p.seq} — nao existe no Inter (404): FALHA_EMISSAO para reemitir`, processado: true });
        continue;
      }
      if (!r.ok || !r.data || 'erro' in r.data) {
        falhas++;
        await logCronEvento(db, { codigo: p.codigo, seuNumero: p.seu_numero || '', saleId: p.sale_id, resultado: `CRON parcela ${p.seq} — falha re-consultando ${p.codigo.slice(0, 18)}`, processado: false });
        continue;
      }
      const cob = interpretarCobranca(r.data as Record<string, unknown>);
      processadas++;
      await espelharParcelaInter(db, p, cob, hojeSp);
      const pagoInter = cob.status === 'RECEBIDO' || cob.status === 'MARCADO_RECEBIDO' || (cob.valorRecebido !== null && cob.valorRecebido > 0);
      if (pagoInter) {
        const baixou = await baixarParcelaPaga(db, p, 'CRON_INTER');
        if (baixou) baixadas++;
        await logCronEvento(db, { codigo: p.codigo, seuNumero: p.seu_numero || '', saleId: p.sale_id, resultado: `PARCELA ${p.seq} PAGA (via sync) — baixa automatica R$ ${Number(p.valor).toFixed(2)}`, processado: true });
      } else {
        await logCronEvento(db, { codigo: p.codigo, seuNumero: p.seu_numero || '', saleId: p.sale_id, resultado: `CRON parcela ${p.seq} — STATUS ${cob.status}`, processado: true });
      }
    } catch (e: unknown) {
      falhas++;
      console.warn('[boletos-sync] parcela', p.seq, 'falhou:', (e as Error).message);
    }
  }
  return { processadas, baixadas, falhas };
}
