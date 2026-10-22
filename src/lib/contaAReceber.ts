import { Sale } from './types';

/**
 * BLOCO 22 — REGRA ÚNICA de "conta a receber" / "venda realizada".
 *
 * Antes: o sistema julgava "a prazo" pelo metodo_pagamento gravado na venda.
 * Como toda pre-venda nasce com metodo_pagamento='A_PRAZO' (o pagamento é
 * cobrado na entrega), varias vendas FINALIZADAS (pagas depois pelo vendedor,
 * ou entregues com "cliente ja pagou") continuavam aparecendo como "A PRAZO"
 * para sempre — inflando o cartao "A Prazo" em Vendas Realizadas, os
 * Relatorios e o Contas a Receber.
 *
 * Regra nova (mais verdadeira):
 *  - CONTA A RECEBER = venda JA ENTREGUE (ou pronta-entrega, que nao passa
 *    pela fila) com SALDO EM ABERTO. Nao importa o metodo gravado.
 *  - Pre-venda ainda na fila/rota NAO e conta a receber (ainda nao foi
 *    entregue) e NAO aparece em "Vendas Realizadas" (cai em Vendas no dia
 *    da entrega — regra do dono do Bloco 14).
 */

const EPS = 0.005;

/** Saldo em aberto da venda (total - pago). */
export const saldoAberto = (s: Sale): number =>
  Math.max(0, (s.valorTotal ?? 0) - (s.valorPago ?? 0));

/** Venda entregue — ou pronta-entrega (que nao passa pela fila de entregas). */
export const vendaEntregue = (s: Sale): boolean => {
  const es = s.entregaStatus;
  return es === undefined || es === null || es === 'ENTREGUE';
};

/** Pre-venda que ainda nao saiu para entrega / ainda esta na fila. */
export const preVendaNaFila = (s: Sale): boolean =>
  s.tipoVenda === 'PRE_VENDA' &&
  (s.entregaStatus === 'PENDENTE' || s.entregaStatus === 'EM_ROTA');

/** CONTA A RECEBER: entregue (ou pronta-entrega) com saldo em aberto. */
export const ehContaAReceber = (s: Sale): boolean =>
  vendaEntregue(s) && saldoAberto(s) > EPS;
