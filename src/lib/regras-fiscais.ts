/**
 * BLOCO 123 — REGRAS FISCAIS DO DONO (ARMADAS, PORÉM DESLIGADAS).
 *
 * Pedido do dono (verbatim):
 *  1. PRONTA ENTREGA: é obrigatório bater a NF-e ou NFC-e (SEFAZ autorizar) e
 *     gerar o BOLETO quando for a prazo ANTES de finalizar a venda.
 *  2. PRÉ-VENDA: o vendedor NÃO bate NF-e/NFC-e — ele SÓ ESCOLHE o documento
 *     (isso já é o comportamento real do PDV desde o Bloco 122: nada é emitido
 *     no registro). A nota é batida na FILA DE ENTREGA pelo ADMIN
 *     (AcaoFiscalAdmin — Bloco 109 + troca de documento do Bloco 123).
 *  3. O pedido de pré-venda NÃO PODE SER CARREGADO no veículo sem a NF-e/NFC-e
 *     batida (bloqueio no CHECK_CARGA do servidor + banner no sheet de carga).
 *  4. Na fila de entrega o ADMIN pode, mesmo que o vendedor tenha escolhido
 *     NF-e, optar por NFC-e com ou sem CPF — e vice-versa (ação
 *     TROCAR_DOC_FISCAL). O admin tem poder de editar tudo.
 *
 * IMPORTANTE (decisão do dono): essas regras SÓ VALEM VALENDO depois da
 * implantação da API fiscal (credenciais Focus NFe/SEFAZ em produção).
 * ATÉ LÁ: FISCAL_OBRIGATORIO = false -> as funções deste módulo não bloqueiam
 * NADA — o fluxo continua liberado como está hoje.
 *
 * COMO LIGAR (quando a API fiscal estiver implantada):
 *   trocar `export const FISCAL_OBRIGATORIO = false` para `true` abaixo.
 *   Uma única fonte (este arquivo) é usada pelo FRONT (PDV e fila) e pelo
 *   SERVIDOR (/api/pre-venda) — não existe divergência.
 */

/** LIGA/DESLIGA TODAS as regras fiscais deste módulo. false = tudo liberado. */
export const FISCAL_OBRIGATORIO = false;

/** Documento escolhido para a venda (tela 4 do PDV / card da fila). */
export type DocFiscal = 'NFE' | 'NFCE' | 'CUPOM';

/** NF-e e NFC-e exigem emissão na SEFAZ; CUPOM não. */
export function docExigeNota(doc: string | null | undefined): boolean {
  return doc === 'NFE' || doc === 'NFCE';
}

/** "Bater a nota" = SEFAZ AUTORIZOU (nota_status = AUTORIZADA). */
export function notaBatida(notaStatus: string | null | undefined): boolean {
  return String(notaStatus || '').toUpperCase() === 'AUTORIZADA';
}

/**
 * REGRA DA PRÉ-VENDA (3): bloqueia o CARREGAMENTO do pedido sem nota batida.
 * Devolve a mensagem do bloqueio (string) ou null quando pode carregar.
 * Com FISCAL_OBRIGATORIO=false devolve SEMPRE null (liberado).
 */
export function cargaBloqueadaPorNota(
  modoNota: string | null | undefined,
  notaStatus: string | null | undefined,
): string | null {
  if (!FISCAL_OBRIGATORIO) return null;
  if (!docExigeNota(modoNota)) return null; // CUPOM carrega livre
  if (notaBatida(notaStatus)) return null; // nota batida -> pode carregar
  return 'Pedido NÃO pode ser CARREGADO sem a nota batida — o admin emite a NF-e/NFC-e no card (Documento / Emitir NF) e depois carrega.';
}

/**
 * REGRA DA PRONTA ENTREGA (1): pendências que impedem a CONCLUSÃO da venda
 * na tela de sucesso. Devolve lista de pendências (vazia = pode concluir).
 * Com FISCAL_OBRIGATORIO=false devolve SEMPRE [] (liberado).
 *
 * exigeBoleto: já calculado pelo chamador (prazo + saldo em aberto + forma
 * não-cheque). boletoStatus: status reportado pelo BoletoCard —
 * 'INDISPONIVEL' (Inter sem credenciais) não bloqueia, porque não existe
 * forma de gerar o boleto naquele momento.
 */
export function pendenciasFinaProntaEntrega(opts: {
  docEscolhido: string | null | undefined;
  notaStatus?: string | null | undefined;
  exigeBoleto: boolean;
  boletoStatus?: string | null | undefined;
}): string[] {
  if (!FISCAL_OBRIGATORIO) return [];
  const pend: string[] = [];
  if (docExigeNota(opts.docEscolhido) && !notaBatida(opts.notaStatus)) {
    pend.push(
      `${opts.docEscolhido === 'NFE' ? 'NF-e' : 'NFC-e'} obrigatória — emita até a SEFAZ autorizar`,
    );
  }
  if (opts.exigeBoleto && !boletoGeradoOk(opts.boletoStatus)) {
    pend.push('Boleto do prazo obrigatório — gere o boleto no card abaixo');
  }
  return pend;
}

/**
 * Boleto "gerado e válido" para a regra 1: A_RECEBER/ATRASADO/RECEBIDO/
 * MARCADO_RECEBIDO (JÁ existe) e EM_PROCESSAMENTO (Inter está criando).
 * 'INDISPONIVEL' (serviço do Inter fora) NÃO bloqueia — não dá para exigir
 * o que o sistema não consegue emitir no momento.
 */
export function boletoGeradoOk(boletoStatus: string | null | undefined): boolean {
  if (!boletoStatus) return false;
  const s = String(boletoStatus).toUpperCase();
  if (s === 'INDISPONIVEL') return true;
  return ['A_RECEBER', 'ATRASADO', 'RECEBIDO', 'MARCADO_RECEBIDO', 'EM_PROCESSAMENTO'].includes(s);
}

// =====================================================================
// BLOCO 134 — FLUXO "NÃO PODE ESQUECER DE BATER A NOTA" (regra do dono):
// a venda pode ser finalizada sem a nota (hoje é liberado), MAS o app tem
// que lembrar. A INTENÇÃO do documento fica gravada em sales.modo_nota
// (NFE/NFCE/CUPOM) e, nas vendas antigas, no texto do detalhePagamento
// ("COM NOTA: NF-e"). Venda PENDENTE = intenção NFE/NFCE e nota NÃO
// AUTORIZADA (nem EMITINDO — essa está em andamento e já tem fila).
// =====================================================================

/** Intenção fiscal gravada na venda: 'NFE' | 'NFCE' | null (cupom/legado). */
export function intencaoNotaDaVenda(sale: {
  modoNota?: string | null;
  detalhePagamento?: string | null;
}): 'NFE' | 'NFCE' | null {
  const modo = String(sale.modoNota || '').toUpperCase();
  if (modo === 'NFE' || modo === 'NFCE') return modo;
  // Vendas antigas: o documento escolhido fica no detalhe ("COM NOTA: NF-e")
  const d = String(sale.detalhePagamento || '').toUpperCase();
  if (d.includes('COM NOTA: NF-E') || d.includes('COM NOTA: NFE')) return 'NFE';
  if (d.includes('COM NOTA: NFC-E') || d.includes('COM NOTA: NFCE')) return 'NFCE';
  return null;
}

/**
 * BLOCO 135 (regra do dono): o badge NUNCA pode dizer só "NF" — NF-e e NFC-e
 * são documentos DIFERENTES. "onde tem NF 17 deve aparecer NFC 17, pois é NFC
 * e não NFE". Rotulo curto do documento pelo TIPO REAL gravado no banco
 * (sales.nota_tipo): NFC-e -> "NFC", NF-e -> "NF-e", sem tipo -> fallback.
 */
export function rotuloDocumentoNota(
  tipo: string | null | undefined,
  fallback = 'NF',
): string {
  const t = String(tipo || '').toUpperCase();
  if (t === 'NFCE') return 'NFC';
  if (t === 'NFE') return 'NF-e';
  return fallback;
}

/**
 * Venda com NOTA PENDENTE: o documento escolhido (NF-e/NFC-e) ainda não foi
 * autorizado pela SEFAZ e ninguém resolveu. Cupom não entra (não tem nota);
 * EMITINDO também não (SEFAZ está processando — só exige acompanhamento).
 */
export function vendaNotaPendente(sale: {
  modoNota?: string | null;
  detalhePagamento?: string | null;
  notaStatus?: string | null;
}): boolean {
  const intencao = intencaoNotaDaVenda(sale);
  if (!intencao) return false;
  const st = String(sale.notaStatus || '').toUpperCase();
  return st === 'NAO_EMITIDA' || st === 'REJEITADA' || st === '' || st === 'CANCELADA';
}

// =====================================================================
// BLOCO 142 — PRAZO SEFAZ DE CANCELAMENTO DE NOTA (regra da SEFAZ):
//   NFC-e (modelo 65): até 30 MINUTOS após a autorização;
//   NF-e  (modelo 55): até 24 HORAS após a autorização.
// Passado o prazo, o evento de cancelamento é RECUSADO pela SEFAZ —
// os botões de cancelar ficam INATIVOS/SOMEM (portal /notas, Vendas
// Realizadas e Janela Fiscal). Fonte ÚNICA usada pelo front e pelo
// servidor (/api/notas acao CANCELAR) para nunca divergir.
// =====================================================================

export const PRAZO_CANCELAMENTO_MINUTOS: Record<'NFE' | 'NFCE', number> = {
  NFE: 24 * 60, // 24 horas
  NFCE: 30,     // 30 minutos
};

export interface PrazoCancelamento {
  /** true = a SEFAZ ainda aceita o evento de cancelamento */
  dentroDoPrazo: boolean;
  /** true = prazo vencido — o botão de cancelar deve ficar inativo/sumir */
  expirado: boolean;
  /** milissegundos restantes (0 quando expirado) */
  msRestantes: number;
  /** texto humanizado do que resta: "29min", "23h 12min", "45s" */
  textoRestante: string;
  /** rótulo do prazo total: "30 minutos" / "24 horas" */
  prazoLabel: string;
  /** instante ISO em que o prazo vence — null quando sem base confiável */
  expiraEm: string | null;
}

/**
 * Calcula o prazo de cancelamento de UMA nota.
 * - `emitidaEm`: data de autorização (sales.nota_emitida_em) — fonte real.
 * - `fallbackData`: data da venda, usada SÓ para exibição quando a data de
 *   autorização não existe (vendas antigas). A emissão acontece DEPOIS da
 *   venda, então o fallback subestima o tempo passado — direção segura:
 *   pior caso o botão aparece e a SEFAZ recusa com a mensagem oficial.
 */
export function prazoCancelamentoNota(opts: {
  tipo?: string | null;
  status?: string | null;
  emitidaEm?: string | Date | null;
  fallbackData?: string | Date | null;
  agora?: Date;
}): PrazoCancelamento {
  const tipo = String(opts.tipo || '').toUpperCase();
  const prazoMin = tipo === 'NFCE' ? PRAZO_CANCELAMENTO_MINUTOS.NFCE : PRAZO_CANCELAMENTO_MINUTOS.NFE;
  const prazoLabel = prazoMin >= 60
    ? `${Math.round(prazoMin / 60)} horas`
    : `${prazoMin} minutos`;

  const bruta = opts.emitidaEm || opts.fallbackData;
  const base = bruta ? new Date(bruta as string | Date) : null;
  const valida = !!base && !isNaN(base.getTime());
  const agora = opts.agora || new Date();

  const expira = valida ? new Date((base as Date).getTime() + prazoMin * 60 * 1000) : null;
  const msRestantes = expira ? Math.max(0, expira.getTime() - agora.getTime()) : 0;

  let textoRestante = '—';
  if (expira) {
    if (msRestantes <= 0) textoRestante = 'prazo vencido';
    else if (msRestantes < 60_000) textoRestante = `${Math.ceil(msRestantes / 1000)}s`;
    else if (msRestantes < 3_600_000) textoRestante = `${Math.floor(msRestantes / 60_000)}min`;
    else textoRestante = `${Math.floor(msRestantes / 3_600_000)}h ${Math.floor((msRestantes % 3_600_000) / 60_000)}min`;
  }

  return {
    dentroDoPrazo: !expira || msRestantes > 0,
    expirado: !!expira && msRestantes <= 0,
    msRestantes,
    textoRestante,
    prazoLabel,
    expiraEm: expira ? expira.toISOString() : null,
  };
}

/** A nota pode ser cancelada (status autorizada/emitindo, dentro do prazo)? */
export function notaCancelavel(opts: {
  status?: string | null;
  tipo?: string | null;
  emitidaEm?: string | Date | null;
  fallbackData?: string | Date | null;
  agora?: Date;
}): boolean {
  const st = String(opts.status || '').toUpperCase();
  if (st !== 'AUTORIZADA' && st !== 'EMITINDO') return false;
  return prazoCancelamentoNota(opts).dentroDoPrazo;
}
