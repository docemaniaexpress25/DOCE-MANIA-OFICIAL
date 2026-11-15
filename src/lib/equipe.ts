/**
 * BLOCO 118 — EQUIPE: regras de exceção da casa.
 *
 * DAVID (ROTA 5) — comissão DESATIVADA (pedido do dono):
 *   "a tela financeiro do app no logim de vendedor nao precisa aparecer para
 *    o vendedor da rota 5 david, tbm nao precisa calcular comissao e pagamento
 *    de comissoes para ele"
 *   - Sem aba Financeiro no app dele (VendedorDashboard).
 *   - Sem card dele no acerto de Comissões do admin.
 *   - APIs recusam liberar/pagar comissão para ele (403).
 *   - SQL 118 descarta no banco qualquer comissão nova dele (trigger).
 *   - O CAIXA (Fechamento de Caixa) vale para TODOS, inclusive ele.
 *
 * Casamento por id (à prova de renome) + fallback pelo nome (se o dono
 * recriar o usuário, o nome dele sempre começa com "David").
 * Lib sem dependências — funciona em componente client e em rota de API.
 */

export const DAVID_USER_ID = '7c989927-a148-479c-bf00-11f35bfa66b0'; // David - R5 (produção)

/** True quando o registro (id/nome) aponta para o vendedor David (rota 5). */
export function isDavidVendedor(
  u: { id?: string | null; nome?: string | null } | null | undefined
): boolean {
  if (!u) return false;
  if (String(u.id || '') === DAVID_USER_ID) return true;
  return isDavidNome(u.nome);
}

/** True quando o NOME pertence ao David (usado quando só há o nome no servidor). */
export function isDavidNome(nome: string | null | undefined): boolean {
  return /^david/i.test(String(nome || '').trim());
}
