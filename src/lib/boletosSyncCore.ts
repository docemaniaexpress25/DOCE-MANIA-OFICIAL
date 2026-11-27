import { getServiceClient } from '@/lib/serverSupabase';
import { hasBoletoColumns, hasSalesBoletosTable } from '@/lib/serverSchema';
// BLOCO 228 (regra do dono): listarCobrancas alimenta a VARREDURA de boletos
// órfãos de vendas EXCLUÍDAS (cobrança viva no Inter cuja venda já foi apagada
// daqui — cancela sozinho para o cliente nunca pagar venda que não existe).
import { isInterConfigured, recuperarCobranca, interpretarCobranca, cancelarCobranca, listarCobrancas, type CobrancaColecaoItem } from '@/lib/interBoleto';
import { espelharParcelaInter, baixarParcelaPaga, type ParcelaRow } from '@/lib/baixaBoleto';
// BLOCO 221: aviso aos admins a cada baixa ("toda baixa a gente seja comunicado")
// BLOCO 226: avisos do AUTO-DESTRAVAMENTO e da cobranca ORFA do Inter
import { avisarBaixaBoleto, nomeClienteDaVenda, avisarBoletoAutoDestravado, avisarBoletoOrfao } from '@/lib/notificacoes';

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
  /** BLOCO 226: boletos/parcelas presas em EM_PROCESSAMENTO liberadas sozinhas. */
  destravadas?: number;
  /** BLOCO 226: cobrancas orfas do Inter resolvidas nesta rodada. */
  orfaos?: number;
  /** BLOCO 228: cobrancas de vendas EXCLUIDAS canceladas nesta varredura. */
  orfaosExcluidas?: number;
  falhas?: Array<{ id: string; erro: string }>;
  motivo?: string;
}

const carimboCurto = () =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());

/** BLOCO 226: minutos desde o ISO local (null quando ausente/invalido). */
function minutosDesde(iso: unknown): number | null {
  if (!iso) return null;
  const t = new Date(String(iso)).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

/**
 * BLOCO 226 — registra a COBRANCA ORFA em webhook_logs (best-effort).
 * Órfã = cobrança viva no Inter que o sistema local já liberou (destravou).
 * O sync vigia cada órfã: se ela sair de EM_PROCESSAMENTO ele CANCELA sozinho
 * (nada de cliente pagar boleto que o sistema nao conhece); se alguém PAGAR,
 * avisa os admins com urgência. Sem SQL novo: usa a webhook_logs (SQL 167).
 */
async function registrarOrfao(
  db: ReturnType<typeof getServiceClient>,
  o: { codigo: string; seuNumero: string; saleId?: string; fonte: string; detalhe: string }
): Promise<void> {
  try {
    const { error } = await db.from('webhook_logs').insert({
      origem: 'ORFAO_INTER',
      evento: { fonte: o.fonte } as any,
      codigo: (o.codigo || '').slice(0, 120) || null,
      seu_numero: (o.seuNumero || '').slice(0, 60) || null,
      sale_id: o.saleId ? String(o.saleId).slice(0, 64) : null,
      resultado: o.detalhe.slice(0, 300),
      processado: false,
    });
    if (error) console.warn('[boletos-sync] orfao nao registrado:', error.message);
  } catch (err: any) {
    console.warn('[boletos-sync] orfao nao registrado:', err?.message);
  }
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
    .select('id, valor_total, valor_pago, status_pagamento, detalhe_pagamento, inter_boleto_status, inter_boleto_codigo, inter_boleto_seu_numero, inter_boleto_vencimento, inter_boleto_em, client_id')
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
  let destravadas = 0; // BLOCO 226
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

      // ===================================================================
      // BLOCO 226 — AUTO-DESTRAVAR (boleto ÚNICO): cobrança ainda presa em
      // EM_PROCESSAMENTO no Inter APÓS 60 MINUTOS da emissão local. Caso
      // Paradouro do Campo: o Inter aceita o POST e NUNCA processa, e o
      // cancelamento é recusado nesse estado — o boleto travava o card para
      // sempre e o dono não conseguia gerar novo. Agora o sync libera SOZINHO:
      //   1. tenta cancelar no Inter (se saiu do processamento, cancela de
      //      verdade e elimina o risco de pagamento em duplicidade);
      //   2. marca FALHA_EMISSAO local com mensagem clara (o card volta a
      //      oferecer GERAR — mesmo efeito do botão DESTRAVAR, sem depender
      //      de admin);
      //   3. registra a cobrança ÓRFÃ para vigilância (processarOrfaos);
      //   4. notifica os admins.
      // ===================================================================
      if (cob.status === 'EM_PROCESSAMENTO') {
        const min = minutosDesde(sale.inter_boleto_em);
        if (min !== null && min >= 60) {
          const cliente = await nomeClienteDaVenda(db, sale.client_id);
          let cancelou = false;
          try {
            const c = await cancelarCobranca(codigo, 'Emissao presa - liberada pelo sistema');
            cancelou = c.ok || c.status === 202;
          } catch { /* Inter recusou (esperado) — segue como órfã vigiada */ }
          await db.from('sales').update({
            inter_boleto_status: 'FALHA_EMISSAO',
            inter_boleto_erro: cancelou
              ? `Emissão ficou ${min} min presa em EM_PROCESSAMENTO no Inter e foi CANCELADA lá pelo sistema em ${carimboCurto()}. Gere um boleto novo.`
              : `Emissão ficou ${min} min presa em EM_PROCESSAMENTO no Inter (cancelamento recusado lá) — boleto liberado pelo sistema em ${carimboCurto()}. Gere um boleto novo.`,
          }).eq('id', saleId);
          await registrarOrfao(db, {
            codigo,
            seuNumero,
            saleId,
            fonte: 'auto-destrava-boleto-unico',
            detalhe: `boleto único destravado automaticamente após ${min} min em EM_PROCESSAMENTO (cancelou no Inter: ${cancelou ? 'sim' : 'nao — Inter recusou'})`,
          });
          destravadas++;
          await logCronEvento(db, { codigo, seuNumero, saleId, resultado: `AUTO-DESTRAVA: emissão presa ${min} min — FALHA_EMISSAO local${cancelou ? ' + cancelada no Inter' : ''}`, processado: true });
          await avisarBoletoAutoDestravado(db, { saleId, codigo, cliente, cancelouNoInter: cancelou, minutosPreso: min });
          continue;
        }
      }

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
    destravadas += sinc.destravadas;
    if (sinc.falhas > 0) falhas.push({ id: 'parcelas', erro: `${sinc.falhas} falha(s) no sync das parcelas` });
  }

  // BLOCO 226: vigia as COBRANÇAS ÓRFÃS (liberadas localmente enquanto vivas
  // no Inter) — cancela sozinho quando processarem, avisa URGENTE se pagarem.
  let orfaos = 0;
  try {
    orfaos = await processarOrfaos(db);
  } catch (e: unknown) {
    console.warn('[boletos-sync] vigilância de órfãos falhou:', (e as Error).message);
  }

  // BLOCO 228: VARREDURA das cobrancas de VENDAS EXCLUIDAS — o caso real do
  // dono ("acabei de excluir uma venda com boleto gerado! o boleto ficou vivo
  // lá"): exclusões antigas e falhas deixaram cobrança VIVA no Inter sem
  // ninguém vigiando. Aqui o Inter é perguntado DIRETO (coleção de cobranças)
  // e toda cobrança viva cuja venda não existe mais é cancelada sozinha.
  let orfaosExcluidas = 0;
  try {
    orfaosExcluidas = await varrerVendasExcluidas(db);
  } catch (e: unknown) {
    console.warn('[boletos-sync] varredura de vendas excluidas falhou:', (e as Error).message);
  }

  return {
    ok: true,
    processadas,
    baixadas,
    destravadas,
    orfaos,
    orfaosExcluidas,
    falhas: falhas.length ? falhas : undefined,
  };
}

/**
 * SINCRONIZACAO DAS PARCELAS (boleto duplo do Deivid/R5).
 * Mesma rede de segurança do boleto único, aplicada às cobranças da tabela
 * sales_boletos: reconsulta o Inter, espelha status, marca ATRASADO por
 * vencimento e baixa a parcela paga (a venda fecha quando TODAS pagarem).
 */
async function sincronizarParcelas(db: ReturnType<typeof getServiceClient>): Promise<{ processadas: number; baixadas: number; destravadas: number; falhas: number }> {
  const LIMITE_PARCELAS = 15;
  const hojeSp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let processadas = 0;
  let baixadas = 0;
  let destravadas = 0; // BLOCO 226
  let falhas = 0;

  const { data: abertas, error } = await db
    .from('sales_boletos')
    .select('id, sale_id, seq, valor, vencimento, status, codigo, seu_numero, linha, barras, pix, erro, emitido_em')
    .in('status', ['EM_PROCESSAMENTO', 'A_RECEBER', 'ATRASADO'])
    .order('vencimento', { ascending: true })
    .limit(LIMITE_PARCELAS);
  if (error) {
    console.warn('[boletos-sync] leitura das parcelas falhou:', error.message);
    return { processadas: 0, baixadas: 0, destravadas: 0, falhas: 1 };
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

      // ===================================================================
      // BLOCO 226 — AUTO-DESTRAVAR (PARCELA): mesma regra do boleto único —
      // parcela presa em EM_PROCESSAMENTO no Inter há 60+ min é liberada
      // sozinha (cancela no Inter quando possível, FALHA_EMISSAO local,
      // órfã registrada, admins avisados). O GERAR volta a aparecer no card
      // sem precisar de admin.
      // ===================================================================
      if (cob.status === 'EM_PROCESSAMENTO') {
        const min = minutosDesde((p as unknown as Record<string, unknown>).emitido_em);
        if (min !== null && min >= 60) {
          let cancelou = false;
          try {
            const c = await cancelarCobranca(p.codigo, 'Emissao presa - liberada pelo sistema');
            cancelou = c.ok || c.status === 202;
          } catch { /* Inter recusou (esperado) — segue como órfã vigiada */ }
          await db.from('sales_boletos').update({
            status: 'FALHA_EMISSAO',
            erro: cancelou
              ? `Emissão ficou ${min} min presa em EM_PROCESSAMENTO no Inter e foi CANCELADA lá pelo sistema em ${carimboCurto()}. Gere o boleto novamente.`
              : `Emissão ficou ${min} min presa em EM_PROCESSAMENTO no Inter (cancelamento recusado lá) — boleto liberado pelo sistema em ${carimboCurto()}. Gere o boleto novamente.`,
          }).eq('id', String(p.id));
          await registrarOrfao(db, {
            codigo: String(p.codigo),
            seuNumero: String(p.seu_numero || ''),
            saleId: String(p.sale_id),
            fonte: 'auto-destrava-parcela',
            detalhe: `parcela ${p.seq} destravada automaticamente após ${min} min em EM_PROCESSAMENTO (cancelou no Inter: ${cancelou ? 'sim' : 'nao — Inter recusou'})`,
          });
          destravadas++;
          await logCronEvento(db, { codigo: p.codigo, seuNumero: p.seu_numero || '', saleId: p.sale_id, resultado: `AUTO-DESTRAVA parcela ${p.seq}: presa ${min} min — FALHA_EMISSAO local${cancelou ? ' + cancelada no Inter' : ''}`, processado: true });
          try {
            const { data: s2 } = await db.from('sales').select('client_id').eq('id', String(p.sale_id)).maybeSingle();
            const cliente = await nomeClienteDaVenda(db, (s2 as Record<string, unknown> | null)?.client_id);
            await avisarBoletoAutoDestravado(db, { saleId: String(p.sale_id), parcelaSeq: p.seq, parcelaTotal: null, codigo: String(p.codigo), cliente, cancelouNoInter: cancelou, minutosPreso: min });
          } catch { /* aviso é best-effort */ }
          continue;
        }
      }

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
  return { processadas, baixadas, destravadas, falhas };
}

// ---------------------------------------------------------------------------
// BLOCO 226 — VIGILÂNCIA DAS COBRANÇAS ÓRFÃS DO INTER.
// Órfã = cobrança viva lá dentro cujo boleto o sistema já liberou (DESTRAVAR
// manual ou auto-destrava). Enquanto EM_PROCESSAMENTO ninguém consegue pagá-la
// (sem linha digitável) — mas SE ela processar um dia, o cliente receberia um
// boleto que o sistema não conhece mais: aqui o sync CANCELA sozinho quando
// ela vira A_RECEBER (o Inter aceita cancelar nesse estado) e avisa URGENTE
// caso alguém já tenha PAGADO. Pendências ficam com processado=false e são
// reavaliadas na próxima rodada. Sem SQL novo (usa a webhook_logs do SQL 167).
// ---------------------------------------------------------------------------
const LIMITE_ORFAOS = 10;

async function processarOrfaos(db: ReturnType<typeof getServiceClient>): Promise<number> {
  let tratados = 0;
  let pendentes: Record<string, unknown>[] = [];
  try {
    const { data, error } = await db
      .from('webhook_logs')
      .select('id, codigo, seu_numero, sale_id, resultado')
      .eq('origem', 'ORFAO_INTER')
      .eq('processado', false)
      .order('criado_em', { ascending: true })
      .limit(LIMITE_ORFAOS);
    if (error) {
      console.warn('[boletos-sync] leitura de órfãos falhou:', error.message);
      return 0;
    }
    pendentes = (data || []) as Record<string, unknown>[];
  } catch {
    return 0; // tabela ausente (SQL 167 pendente) — vigilância degrada ok
  }

  const clienteDaSale = async (saleId: string): Promise<string | null> => {
    if (!saleId) return null;
    try {
      const { data: s } = await db.from('sales').select('client_id').eq('id', saleId).maybeSingle();
      return await nomeClienteDaVenda(db, (s as Record<string, unknown> | null)?.client_id);
    } catch {
      return null;
    }
  };

  for (const o of pendentes) {
    const logId = String(o.id || '');
    const codigo = String(o.codigo || '');
    const saleId = String(o.sale_id || '');
    const baseTxt = String(o.resultado || '').slice(0, 140);
    if (!codigo || !logId) {
      // registro sem codigo não tem o que vigiar — fecha (update é no-op se logId vazio)
      if (logId) {
        await db.from('webhook_logs').update({ processado: true, resultado: `${baseTxt} | sem codigo — fechado` }).eq('id', logId);
      }
      continue;
    }
    const r = await recuperarCobranca(codigo);
    // Órfã deixou de existir no Inter — objetivo alcançado, fecha o registro.
    if (!r.ok && r.status === 404) {
      await db.from('webhook_logs').update({ processado: true, resultado: `${baseTxt} | órfã não existe mais no Inter (404) — fechado` }).eq('id', logId);
      tratados++;
      continue;
    }
    if (!r.ok || !r.data || 'erro' in r.data) continue; // falha de consulta — reavalia na próxima rodada
    const cob = interpretarCobranca(r.data as Record<string, unknown>);
    const situacao = cob.status;

    // PAGA: o caso grave — cliente pagou cobrança que o sistema não conhece.
    const pagaInter = situacao === 'RECEBIDO' || situacao === 'MARCADO_RECEBIDO' || (cob.valorRecebido !== null && cob.valorRecebido > 0);
    if (pagaInter) {
      const cliente = await clienteDaSale(saleId);
      await avisarBoletoOrfao(db, { codigo, situacao, saleId: saleId || null, cliente, valor: cob.valorRecebido, paga: true });
      await logCronEvento(db, { codigo, seuNumero: String(o.seu_numero || ''), saleId: saleId || undefined, resultado: `ORFÃ PAGA pelo cliente R$ ${Number(cob.valorRecebido || 0).toFixed(2)} — aviso urgente aos admins`, processado: true });
      await db.from('webhook_logs').update({ processado: true, resultado: `${baseTxt} | órfã PAGA — admin avisado` }).eq('id', logId);
      tratados++;
      continue;
    }

    // Já morta lá dentro (cancelada pelo humano do Inter, expirada...) — fecha.
    if (['CANCELADO', 'EXPIRADO', 'REJEITADO', 'FALHA_EMISSAO'].includes(situacao)) {
      await db.from('webhook_logs').update({ processado: true, resultado: `${baseTxt} | órfã morreu no Inter (${situacao}) — fechado` }).eq('id', logId);
      tratados++;
      continue;
    }

    // EM_PROCESSAMENTO / A_RECEBER / ATRASADO: cancelar no Inter (A_RECEBER
    // é o estado em que o Inter ACEITA o cancelamento — risco eliminado).
    const c = await cancelarCobranca(codigo, 'Cobranca sobrando - cancelada pelo sistema');
    const cancelou = c.ok || c.status === 202;
    if (cancelou) {
      const cliente = await clienteDaSale(saleId);
      await avisarBoletoOrfao(db, { codigo, situacao, saleId: saleId || null, cliente, valor: cob.valor, cancelada: true });
      await logCronEvento(db, { codigo, seuNumero: String(o.seu_numero || ''), saleId: saleId || undefined, resultado: `ORFÃ cancelada no Inter (estava ${situacao}) — risco de pagamento duplicado eliminado`, processado: true });
      await db.from('webhook_logs').update({ processado: true, resultado: `${baseTxt} | órfã CANCELADA no Inter (estava ${situacao})` }).eq('id', logId);
      tratados++;
    }
    // Recusado de novo (EM_PROCESSAMENTO): segue pendente — próxima rodada
    // tenta de novo até o Inter processar ou matar a cobrança.
  }
  return tratados;
}

// ---------------------------------------------------------------------------
// BLOCO 228 — VARREDURA DE COBRANCAS DE VENDAS EXCLUIDAS (regra do dono:
// "acabei de excluir uma venda com boleto gerado! o sistema deve cancelar
// esse boleto!"). O cancelamento NA HORA da exclusao agora existe (lib/
// cascataCancelamento -> cancelarBoletosAntesExclusao), mas exclusoes antigas
// e falhas deixaram cobrancas VIVAS no Inter sem venda de origem. Aqui o sync
// pergunta ao Inter (colecao de cobrancas, janela de vencimento larga) e
// cancela sozinho toda cobranca viva cuja venda nao existe mais no sistema:
//   - viva e cancelavel -> cancelada (202/ok) — risco eliminado;
//   - recusada (EM_PROCESSAMENTO) -> ORFA registrada — o vigilante cancela
//     quando sair do processamento (Bloco 226);
//   - PAGA pelo cliente -> aviso URGENTE aos admins (dinheiro de venda que
//     nao existe — ajuste manual/reembolso);
//   - 404/ja morta -> nada a fazer.
// Casamento por seuNumero: boleto unico = "DM" + 9 chars do sale_id sem
// hifens; parcela = "DM" + 8 chars + "-P<seq>" (seuNumeroParcela). O sistema
// so cancela cobrancas com o selo DM — cobranca emitida fora do app (outro
// canal, portal do Inter) fica FORA do alcance: nunca cancela coisa alheia.
// ---------------------------------------------------------------------------
const JANELA_VARREDURA_DIAS = 120;
const LIMITE_VARREDURA_RODADA = 8;

async function varrerVendasExcluidas(db: ReturnType<typeof getServiceClient>): Promise<number> {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const tHoje = new Date(`${hoje}T12:00:00Z`).getTime();
  const ini = new Date(tHoje - JANELA_VARREDURA_DIAS * 86400000).toISOString().slice(0, 10);
  const fim = new Date(tHoje + JANELA_VARREDURA_DIAS * 86400000).toISOString().slice(0, 10);
  const r = await listarCobrancas({ dataInicial: ini, dataFinal: fim, size: 500, maxPaginas: 2 });
  if (!r.ok || r.itens.length === 0) {
    // BLOCO 228: transparente — se a pergunta ao Inter falhar (token/rate
    // limit), o sync REGISTRA a falha em vez de passar silencioso por "0".
    if (!r.ok) {
      await logCronEvento(db, { resultado: `varredura de vendas excluidas NAO completou: ${String(r.erro || 'falha').slice(0, 160)} — proxima rodada tenta de novo`, processado: false });
    }
    return 0;
  }

  // selos DM de TODAS as vendas vivas (os 2 formatos: boleto unico 9 chars,
  // parcela 8 chars) — cobranca cujo selo esta aqui tem venda de origem.
  const vivos = new Set<string>();
  const { data: ids, error: errIds } = await db.from('sales').select('id').limit(200000);
  if (errIds) return 0;
  for (const row of (ids || []) as Array<{ id: string }>) {
    const hex = String(row.id || '').replace(/-/g, '').toUpperCase();
    vivos.add(`DM${hex.slice(0, 9)}`);
    vivos.add(`DM${hex.slice(0, 8)}`);
  }

  const vivas = ['EM_PROCESSAMENTO', 'A_RECEBER', 'ATRASADO'];
  let canceladas = 0;
  let tratadas = 0;
  for (const item of r.itens as CobrancaColecaoItem[]) {
    if (tratadas >= LIMITE_VARREDURA_RODADA) break;
    const m = String(item.seuNumero || '').toUpperCase().match(/^DM([0-9A-Z]{8,9})/);
    if (!m) continue; // sem selo DM — emitida fora do app, nao mexe
    if (vivos.has(`DM${m[1]}`)) continue; // venda existe — nao e orfa
    const situacao = String(item.situacao || '').toUpperCase();
    // DINHEIRO REAL: cliente pagou cobranca de venda que foi excluida
    if (['RECEBIDO', 'MARCADO_RECEBIDO'].includes(situacao)) {
      tratadas++;
      try {
        await avisarBoletoOrfao(db, { codigo: item.codigo, situacao, saleId: null, cliente: item.pagadorNome || null, valor: item.valor, paga: true });
        await logCronEvento(db, { codigo: item.codigo, seuNumero: item.seuNumero, resultado: `ORFA de venda EXCLUIDA foi PAGA pelo cliente R$ ${Number(item.valor || 0).toFixed(2)} (${item.pagadorNome || 'pagador'}) — AJUSTE MANUAL/reembolso necessario`, processado: true });
      } catch { /* best-effort */ }
      continue;
    }
    if (!vivas.includes(situacao)) continue; // ja morta (CANCELADO/EXPIRADO/...) — nada a fazer
    // ja registrada como orfa pendente? o vigilante (Bloco 226) cuida — nao duplica
    const { data: dup } = await db.from('webhook_logs')
      .select('id').eq('origem', 'ORFAO_INTER').eq('processado', false).eq('codigo', item.codigo.slice(0, 120)).limit(1);
    if (dup && dup.length > 0) continue;
    try {
      const c = await cancelarCobranca(item.codigo, 'Venda excluida - cancelamento automatico');
      if (c.ok || c.status === 202 || c.status === 404) {
        canceladas++;
        tratadas++;
        try {
          await avisarBoletoOrfao(db, { codigo: item.codigo, situacao, saleId: null, cliente: item.pagadorNome || null, valor: item.valor, cancelada: true });
        } catch { /* aviso best-effort */ }
        await logCronEvento(db, { codigo: item.codigo, seuNumero: item.seuNumero, resultado: `ORFA de venda EXCLUIDA cancelada no Inter (estava ${situacao}) — cliente nunca paga venda que nao existe mais`, processado: true });
        continue;
      }
      // recusada agora (EM_PROCESSAMENTO) — registra ORFA: o vigilante cancela
      // sozinho assim que sair do processamento
      await registrarOrfao(db, {
        codigo: item.codigo,
        seuNumero: String(item.seuNumero || ''),
        fonte: 'varredura-venda-excluida',
        detalhe: `cobranca de venda EXCLUIDA segue viva no Inter (${situacao}; cancelamento recusado nesta rodada) — cancela sozinho quando sair do processamento`,
      });
      tratadas++;
    } catch { /* falha de rede/token — proxima rodada tenta de novo */ }
  }
  return canceladas;
}
