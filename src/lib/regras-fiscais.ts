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
