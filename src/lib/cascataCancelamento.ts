import { getServiceClient } from '@/lib/serverSupabase';
import { hasBoletoColumns, hasSalesBoletosTable } from '@/lib/serverSchema';
import { arquivarNotaCancelada } from '@/lib/focusArquivos';
import { cancelarNota, interpretarResultado, isFocusConfigured, FocusDoc } from '@/lib/focusNfe';
// BLOCO 228 (regra do dono): excluir venda com boleto gerado CANCELA o boleto
// do Inter NA HORA — boleto único + parcelas da divisão (Bloco 199).
import { isInterConfigured, cancelarCobranca } from '@/lib/interBoleto';

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

// ---------------------------------------------------------------------------
// BLOCO 228 (regra do dono) — "acabei de excluir uma venda com boleto gerado!
// o sistema deve cancelar esse boleto!": a EXCLUSAO da venda agora cancela
// TAMBEM as cobrancas do Inter (boleto unico + parcelas do boleto duplo).
//
//  REGRA 3 — exclusao de venda cancela os boletos do Inter NA HORA:
//   - cobranca viva -> cancelarCobranca() no Inter (202 = aceito assincrono);
//   - recusada (ex.: EM_PROCESSAMENTO) -> registrada como ORFA no webhook_logs
//     (ORFAO_INTER) e o sync vigia: cancela sozinho quando sair do
//     processamento e avisa URGENTE se alguem pagar (rede do BLOCO 226);
//   - inexistente no Inter (404) -> nada a cancelar lá;
//   - RECEBIDO/MARCADO_RECEBIDO = DINHEIRO REAL: NUNCA cancelado, o aviso
//     informa o admin (a venda foi paga de verdade).
// O estado local (colunas inter_boleto_* + parcelas) é zerado logo antes da
// venda ser apagada — assim a exclusao nunca quebra por FK de parcelas e, se
// a exclusao falhar depois, a venda fica limpa para gerar boleto novo.
// ---------------------------------------------------------------------------
export interface ResumoBoletosExclusao {
  canceladasNoInter: number;
  orfasVigiadas: number;
  jaMortas: number;
  /** BLOCO 228: cobrancas RECEBIDAS (dinheiro real) — jamais canceladas. */
  dinheiroReal: number;
  /** Aviso combinado para o admin (vazio quando nada a informar). */
  aviso: string;
}

/** Registra a ORFA de venda excluida em webhook_logs (best-effort, sem SQL novo). */
async function registrarOrfaExclusao(
  db: ReturnType<typeof getServiceClient>,
  c: { codigo: string; seuNumero: string; rotulo: string },
  detalhe: string,
): Promise<void> {
  try {
    await db.from('webhook_logs').insert({
      origem: 'ORFAO_INTER',
      evento: { fonte: 'exclusao-venda' },
      codigo: c.codigo.slice(0, 120),
      seu_numero: (c.seuNumero || '').slice(0, 60) || null,
      resultado: `boleto da venda EXCLUIDA (${c.rotulo}) segue vivo no Inter — ${detalhe}; sync vigia: cancela sozinho quando sair do processamento e avisa se alguem pagar`,
      processado: false,
    });
  } catch { /* webhook_logs ausente (SQL 167 pendente) — best-effort */ }
}

export async function cancelarBoletosAntesExclusao(saleId: string): Promise<ResumoBoletosExclusao> {
  const res: ResumoBoletosExclusao = { canceladasNoInter: 0, orfasVigiadas: 0, jaMortas: 0, dinheiroReal: 0, aviso: '' };
  try {
    if (!(await hasBoletoColumns())) return res; // schema antigo — sem boletos
    const db = getServiceClient();
    const { data: sB } = await db.from('sales')
      .select('inter_boleto_status, inter_boleto_codigo, inter_boleto_seu_numero')
      .eq('id', saleId).maybeSingle();
    const cobrancas: Array<{ codigo: string; seuNumero: string; status: string; rotulo: string }> = [];
    const codUnico = String((sB as Record<string, unknown> | null)?.inter_boleto_codigo || '');
    if (codUnico) {
      cobrancas.push({
        codigo: codUnico,
        seuNumero: String((sB as Record<string, unknown>)?.inter_boleto_seu_numero || ''),
        status: String((sB as Record<string, unknown>)?.inter_boleto_status || '').toUpperCase(),
        rotulo: 'boleto único',
      });
    }
    if (await hasSalesBoletosTable()) {
      const { data: pl } = await db.from('sales_boletos')
        .select('seq, status, codigo, seu_numero').eq('sale_id', saleId);
      for (const p of (pl || []) as Record<string, unknown>[]) {
        const cd = String(p.codigo || '');
        if (!cd) continue;
        cobrancas.push({
          codigo: cd,
          seuNumero: String(p.seu_numero || ''),
          status: String(p.status || '').toUpperCase(),
          rotulo: `parcela ${Number(p.seq) || '?'}`,
        });
      }
    }
    if (cobrancas.length === 0) return res; // venda sem boleto vivo — nada a fazer

    const mortos = ['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO', 'NAO_GERADO', 'REJEITADO'];
    const avisos: string[] = [];
    for (const c of cobrancas) {
      // DINHEIRO REAL: boleto já pago NUNCA é cancelado — o admin precisa saber.
      if (['RECEBIDO', 'MARCADO_RECEBIDO'].includes(c.status)) {
        res.dinheiroReal++;
        avisos.push(`${c.rotulo} já RECEBIDO (dinheiro real) — NÃO cancelado no Inter.`);
        continue;
      }
      if (mortos.includes(c.status)) { res.jaMortas++; continue; }
      if (!isInterConfigured()) {
        res.orfasVigiadas++;
        await registrarOrfaExclusao(db, c, 'Inter não configurado no servidor');
        continue;
      }
      try {
        const r = await cancelarCobranca(c.codigo, 'Venda excluida - cancelamento automatico');
        // 202 = cancelamento assíncrono aceito; 404 = a cobrança nem existe mais lá
        if (r.ok || r.status === 202 || r.status === 404) { res.canceladasNoInter++; continue; }
        res.orfasVigiadas++;
        await registrarOrfaExclusao(db, c, `cancelamento recusado pelo Inter (${String(r.erro || 'erro').slice(0, 120)})`);
      } catch (eC) {
        res.orfasVigiadas++;
        await registrarOrfaExclusao(db, c, `falha de conexão com o Inter (${String((eC as Error).message).slice(0, 100)})`);
      }
    }
    // Limpa o estado local do boleto (a venda é apagada na sequência; se a
    // exclusão falhar depois, a venda fica limpa para gerar boleto de novo).
    await db.from('sales').update({
      inter_boleto_status: 'NAO_GERADO',
      inter_boleto_codigo: null,
      inter_boleto_seu_numero: null,
      inter_boleto_linha: null,
      inter_boleto_barras: null,
      inter_boleto_pix: null,
      inter_boleto_erro: null,
      inter_boleto_valor: null,
      inter_boleto_vencimento: null,
      inter_boleto_em: null,
    }).eq('id', saleId);
    if (await hasSalesBoletosTable()) {
      await db.from('sales_boletos').delete().eq('sale_id', saleId);
    }
    if (res.canceladasNoInter > 0) {
      avisos.push(`${res.canceladasNoInter} boleto(s) CANCELADO(S) no Inter na hora da exclusão.`);
    }
    if (res.orfasVigiadas > 0) {
      avisos.push(`${res.orfasVigiadas} cobrança(s) ficaram vivas no Inter (cancelamento recusado lá) — o sistema vigia e cancela sozinho quando sair do processamento.`);
    }
    res.aviso = avisos.join(' ');
    return res;
  } catch (e) {
    res.aviso = `Atenção: falhou o cancelamento automático dos boletos do Inter (${String((e as Error).message).slice(0, 100)}) — confira no Portal Fiscal > Ações > Boleto.`;
    return res;
  }
}
