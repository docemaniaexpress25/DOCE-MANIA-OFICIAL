import { getServiceClient } from '@/lib/serverSupabase';
import { arquivarNotaCancelada } from '@/lib/focusArquivos';
import { cancelarNota, interpretarResultado, isFocusConfigured, FocusDoc } from '@/lib/focusNfe';

/**
 * BLOCO 192 — CASCATA FISCAL (regras do dono, atualizadas):
 *
 *  REGRA 1 — "SE EU EXCLUIR UMA VENDA QUE TIVER NOTA BATIDA NFC OU NF-e VC
 *  DEVE CANCELAR A NOTA NA HORA":
 *    `cancelarNotaAntesExclusao()` tenta o cancelamento na SEFAZ
 *    (justificativa automática) ANTES de apagar a venda. Cancelou → a nota é
 *    arquivada no Portal como CANCELADO. A SEFAZ recusou (prazo vencido de
 *    30min/24h) → a nota segue ARQUIVADA com o status REAL (AUTORIZADO) e o
 *    chamador avisa o admin para resolver no Portal Fiscal/portal da SEFAZ.
 *
 *  REGRA 2 — "SE EU CANCELAR A NOTA ANTES VC NÃO DEVE EXCLUIR A VENDA PQ DE
 *  REPENTE EU VOU AJUSTAR ALGO":
 *    o cancelamento da nota (/api/notas acao=CANCELAR) NÃO exclui mais a
 *    venda e NÃO mexe em estoque/comissão — a venda fica intacta para o dono
 *    ajustar (e o boleto do Inter continua sendo cancelado junto, regra do
 *    BLOCO 147). O arquivamento no Portal acontece aqui pelo helper
 *    `arquivarNotaDaVenda()`.
 *
 * Falha de qualquer etapa NUNCA sobe exceção — vira mensagem na lista de
 * avisos para o admin resolver manualmente.
 */

/**
 * BLOCO 154 — CONGELA A NOTA DE UMA VENDA NO PORTAL FISCAL (avulsa).
 *
 * Regra do dono: "TODAS as notas geradas pela Focus devem ficar salvas no
 * nosso portal, MESMO QUE EU EXCLUA A VENDA no meu sistema". Chamado:
 *  - no CANCELAMENTO da nota (regra 2 do BLOCO 192) — statusFinal CANCELADO;
 *  - na EXCLUSAO de venda (API pre-venda, BLOCO 192 regra 1) — status conforme
 *    o resultado do cancelamento na SEFAZ.
 *
 * Enriquece a avulsa com cliente (fantasia), vendedor, numero, chave, valor e
 * pagamento da venda original. Falha NUNCA sobe excecao — vira motivo para o
 * chamador avisar o admin (o Portal reimporta depois por ref/chave/backup).
 */
export async function arquivarNotaDaVenda(
  sRow: Record<string, unknown>,
  opts?: { statusFinal?: string },
): Promise<{ ok: boolean; motivo?: string }> {
  const db = getServiceClient();
  const ref = String(sRow.nota_ref || '');
  const tipoNota = String(sRow.nota_tipo || '').toUpperCase();
  if (!ref || (tipoNota !== 'NFCE' && tipoNota !== 'NFE')) return { ok: false, motivo: 'SEM_NOTA' };
  try {
    let clienteNome = '';
    let clienteDoc = '';
    if (String(sRow.client_id || '')) {
      const { data: cRow } = await db.from('clients')
        .select('nome_fantasia, nome, cnpj')
        .eq('id', String(sRow.client_id)).single();
      clienteNome = String(cRow?.nome_fantasia || cRow?.nome || '');
      clienteDoc = String(cRow?.cnpj || '');
    }
    let vendedorNome = '';
    if (String(sRow.vendedor_id || '')) {
      const { data: vRow } = await db.from('app_users')
        .select('nome')
        .eq('id', String(sRow.vendedor_id)).single();
      vendedorNome = String(vRow?.nome || '');
    }
    const st = String(sRow.nota_status || '').toUpperCase();
    // Exclusao preserva o status REAL da nota (a menos que o cancelamento na
    // SEFAZ tenha funcionado — ai o chamador manda statusFinal CANCELADO).
    const statusFinal = opts?.statusFinal
      || (st === 'AUTORIZADA' ? 'AUTORIZADO'
        : st === 'REJEITADA' ? 'REJEITADO'
          : st === 'EMITINDO' ? 'EMITINDO'
            : 'CANCELADO');
    const rA = await arquivarNotaCancelada(
      tipoNota === 'NFCE' ? 'nfce' : 'nfe',
      ref,
      {
        numero: String(sRow.nota_numero || ''),
        chave: String(sRow.nota_chave || ''),
        valor: Number(sRow.valor_total) || 0,
        cliente: clienteNome,
        clienteDoc,
        pagamento: String(sRow.metodo_pagamento || ''),
        vendedor: vendedorNome,
        emitidaEm: String(sRow.nota_emitida_em || ''),
      },
      statusFinal,
    );
    return rA.ok ? { ok: true } : { ok: false, motivo: rA.motivo || 'erro' };
  } catch (eA) {
    return { ok: false, motivo: (eA as Error).message };
  }
}

/**
 * BLOCO 192 — REGRA 1: cancela a nota na SEFAZ NA HORA quando a venda vai ser
 * excluída. Só tenta quando a nota está AUTORIZADA (batida); REJEITADA/EMITINDO
 * não tem o que cancelar. O arquivamento no Portal acontece sempre:
 *  - cancelou  → CANCELADO;
 *  - recusou/sem Focus → status REAL preservado (aviso para o admin).
 */
export async function cancelarNotaAntesExclusao(
  sRow: Record<string, unknown>,
): Promise<{ canceladaSefaz: boolean; motivo: string; arquivada: boolean; avisoArquivamento?: string }> {
  const ref = String(sRow.nota_ref || '');
  const tipoNota = String(sRow.nota_tipo || '').toUpperCase();
  const status = String(sRow.nota_status || '').toUpperCase();
  if (!ref || (tipoNota !== 'NFCE' && tipoNota !== 'NFE')) {
    return { canceladaSefaz: false, motivo: 'SEM_NOTA', arquivada: false };
  }

  let canceladaSefaz = false;
  let motivo = '';
  if (status === 'AUTORIZADA') {
    if (!isFocusConfigured()) {
      motivo = 'Focus NFe não configurada (FOCUS_NFE_TOKEN) — o cancelamento automático não rodou.';
    } else {
      try {
        const doc: FocusDoc = tipoNota === 'NFCE' ? 'nfce' : 'nfe';
        const rC = await cancelarNota(doc, ref, 'Venda excluida no sistema - cancelamento automatico');
        if (rC.ok && rC.data && !('erro' in rC.data)) {
          const res = interpretarResultado(rC.data as Record<string, unknown>);
          if (res.cancelada) {
            canceladaSefaz = true;
          } else {
            motivo = res.motivo || 'SEFAZ recusou o cancelamento (confira o prazo de 30min/24h).';
          }
        } else {
          motivo = (rC.data as { erro?: string })?.erro || 'Falha ao cancelar na Focus NFe.';
        }
      } catch (eC) {
        motivo = `Falha ao cancelar na SEFAZ (${(eC as Error).message}).`;
      }
    }
  } else {
    motivo = `Nota não está AUTORIZADA (status ${status || 'indefinido'}) — nada a cancelar na SEFAZ.`;
  }

  // Arquiva SEMPRE (best-effort): CANCELADO quando a SEFAZ aceitou, status
  // real preservado quando recusou — a nota nunca some do portal.
  const rA = await arquivarNotaDaVenda(sRow, canceladaSefaz ? { statusFinal: 'CANCELADO' } : undefined);
  return {
    canceladaSefaz,
    motivo,
    arquivada: rA.ok,
    avisoArquivamento: rA.ok ? undefined : `Falha ao arquivar no Portal (${rA.motivo || 'erro'}) — use Portal Fiscal > Buscar TODAS na Focus.`,
  };
}
