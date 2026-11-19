import { getServiceClient } from '@/lib/serverSupabase';

/**
 * BLOCO 199 — BOLETO DUPLICO (regra do dono, EXCLUSIVO rota 5 / Deivid):
 * baixa da PARCELA paga, compartilhada por quem escuta o Inter:
 *   - webhook /api/webhooks/inter (tempo real)
 *   - cron /api/boletos-sync (rede de segurança)
 *   - POST /api/boletos acao CONSULTAR/EMITIR_TODAS (consulta manual)
 *
 * Regras da baixa da parcela (a venda fica ÚNICA — muda só a COBRANÇA):
 *   1. Marca a PARCELA como RECEBIDO (guard contra corrida: update com
 *      status != 'RECEBIDO' — quem perder o update sai sem somar nada);
 *   2. valor_pago da venda = soma das parcelas RECEBIDO (nunca acima do total);
 *   3. Log no detalhe_pagamento ("BOLETO 1/2 RECEBIDO...");
 *   4. Se TODAS as parcelas estão RECEBIDO: venda fecha PAGO (valor_pago =
 *      total, status_pagamento='PAGO', comissões DISPONIVEL) — a trigger
 *      trg_baixa_boleto_caixa (SQL 167) baixa no CAIXA com essa atualização,
 *      exatamente como no boleto único.
 *
 * Degradacao graciosa: tabelas/colunas ausentes = warn e segue (nunca
 * derruba o fluxo do boleto único).
 */

type Db = ReturnType<typeof getServiceClient>;

export interface ParcelaRow {
  id: string;
  sale_id: string;
  seq: number;
  valor: number;
  vencimento: string;
  doc: string | null;
  cep: string | null;
  status: string;
  codigo: string | null;
  seu_numero: string | null;
  linha: string | null;
  barras: string | null;
  pix: string | null;
  erro: string | null;
}

export const PARCELA_COLS = 'id, sale_id, seq, valor, vencimento, doc, cep, status, codigo, seu_numero, linha, barras, pix, erro';

const carimboSp = () =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());

/**
 * Espelha o estado da cobrança do Inter NA PARCELA (status/linha/barras/pix).
 * A_RECEBER com vencimento passado vira ATRASADO (venda ainda em aberto).
 * Pago NÃO é tratado aqui — passe por baixarParcelaPaga().
 */
export async function espelharParcelaInter(
  db: Db,
  parcela: ParcelaRow,
  cob: { status: string; linhaDigitavel: string; codigoBarras: string; pixCopiaECola: string; vencimento: string },
  hoje: string
): Promise<void> {
  const jaRecebida = parcela.status === 'RECEBIDO' || parcela.status === 'MARCADO_RECEBIDO';
  let statusFinal = cob.status;
  if (!jaRecebida && cob.status === 'A_RECEBER' && cob.vencimento && String(cob.vencimento) < hoje) {
    statusFinal = 'ATRASADO';
  }
  try {
    await db.from('sales_boletos').update({
      status: statusFinal,
      linha: cob.linhaDigitavel || parcela.linha || null,
      barras: cob.codigoBarras || parcela.barras || null,
      pix: cob.pixCopiaECola || parcela.pix || null,
      erro: statusFinal === 'FALHA_EMISSAO' ? 'Falha na emissao no Inter' : null,
    }).eq('id', parcela.id);
  } catch (e: unknown) {
    console.warn('[baixa-boleto] espelho da parcela falhou:', (e as Error).message);
  }
}

/**
 * BAIXA a parcela paga (idempotente e à prova de corrida — webhook, cron e
 * consulta manual podem chegar juntos que só um soma).
 * Devolve true quando esta chamada fez a baixa (false = já estava baixada).
 */
export async function baixarParcelaPaga(
  db: Db,
  parcela: ParcelaRow,
  origem: string
): Promise<boolean> {
  // 1) Guard anti-corrida: só quem ganha o update soma valor_pago.
  const { data: ganhou, error: updErr } = await db
    .from('sales_boletos')
    .update({ status: 'RECEBIDO', pago_em: new Date().toISOString(), erro: null })
    .eq('id', parcela.id)
    .not('status', 'eq', 'RECEBIDO')
    .select('id');
  if (updErr) {
    console.error('[baixa-boleto] update da parcela falhou:', updErr.message);
    return false;
  }
  if (!ganhou || ganhou.length === 0) return false;

  // 2) valor_pago = soma das parcelas RECEBIDO (limitado ao total da venda).
  const { data: todas, error: selErr } = await db
    .from('sales_boletos')
    .select('valor, status')
    .eq('sale_id', parcela.sale_id);
  if (selErr) {
    console.error('[baixa-boleto] leitura das parcelas falhou:', selErr.message);
    return false;
  }
  const somaRecebida = (todas || [])
    .filter((p: Record<string, unknown>) => String(p.status) === 'RECEBIDO' || String(p.status) === 'MARCADO_RECEBIDO')
    .reduce((acc: number, p: Record<string, unknown>) => acc + (Number(p.valor) || 0), 0);

  const { data: sale } = await db
    .from('sales')
    .select('valor_total, valor_pago, status_pagamento, detalhe_pagamento')
    .eq('id', parcela.sale_id)
    .maybeSingle();
  if (!sale) {
    console.error('[baixa-boleto] venda da parcela nao encontrada:', parcela.sale_id);
    return false;
  }
  const total = Number(sale.valor_total) || 0;
  const pagoPrevio = Number(sale.valor_pago) || 0;
  const novoPago = Math.min(total, Math.max(pagoPrevio, Math.round(somaRecebida * 100) / 100));

  // 3) Log no detalhe da venda
  const carimbo = carimboSp();
  const logAnterior = String(sale.detalhe_pagamento || '').trim();
  const totalParcelas = (todas || []).length || 1;
  const logNovo = `${logAnterior ? logAnterior + ' | ' : ''}BOLETO ${parcela.seq}/${totalParcelas} RECEBIDO (Inter) em ${carimbo} — baixa automatica (${origem})`;

  // 4) Todas pagas? Fecha a venda (PAGO) — mesmo efeito do boleto único.
  const todasPagas = (todas || []).length > 0 && (todas || []).every((p: Record<string, unknown>) => String(p.status) === 'RECEBIDO' || String(p.status) === 'MARCADO_RECEBIDO');
  const fechar = todasPagas && String(sale.status_pagamento) !== 'PAGO';

  const patch: Record<string, unknown> = { valor_pago: novoPago, detalhe_pagamento: logNovo };
  if (fechar) {
    patch.status_pagamento = 'PAGO';
    patch.valor_pago = total;
  }
  const { error: saleErr } = await db.from('sales').update(patch).eq('id', parcela.sale_id);
  if (saleErr) {
    console.error('[baixa-boleto] gravacao da venda falhou:', saleErr.message);
    return false;
  }

  // Origem estruturada (best-effort — SQL 172 ausente nao trava)
  try {
    await db.from('sales').update({ baixa_origem: origem, baixa_em: new Date().toISOString() }).eq('id', parcela.sale_id);
  } catch { /* degrada ok */ }

  // Comissão libera só quando a venda FECHA (todas as parcelas pagas)
  if (fechar) {
    try {
      await db.from('commissions').update({ status: 'DISPONIVEL' }).eq('sale_id', parcela.sale_id).eq('status', 'A_RECEBER');
    } catch { /* best-effort */ }
  }
  console.log(`[baixa-boleto] parcela ${parcela.seq} da venda ${parcela.sale_id} baixada (${origem}) — pago R$ ${novoPago.toFixed(2)}${fechar ? ' — VENDA FECHADA' : ' — aguardando demais parcelas'}`);
  return true;
}

/**
 * Procura a PARCELA dona de uma cobrança do Inter (por codigoSolicitacao e,
 * no fallback, pelo seu_numero gravado inteiro). null = não é parcela.
 */
export async function acharParcelaPorCobranca(
  db: Db,
  codigo: string,
  seuNumero: string
): Promise<ParcelaRow | null> {
  try {
    if (codigo) {
      const { data } = await db
        .from('sales_boletos')
        .select(PARCELA_COLS)
        .eq('codigo', codigo)
        .limit(1)
        .maybeSingle();
      if (data) return data as unknown as ParcelaRow;
    }
    if (seuNumero) {
      const { data } = await db
        .from('sales_boletos')
        .select(PARCELA_COLS)
        .eq('seu_numero', seuNumero)
        .limit(1)
        .maybeSingle();
      if (data) return data as unknown as ParcelaRow;
    }
  } catch (e: unknown) {
    // Tabela ainda não existe (SQL 199 pendente): não é parcela mesmo.
    console.warn('[baixa-boleto] busca de parcela falhou (SQL 199 rodado?):', (e as Error).message);
  }
  return null;
}
