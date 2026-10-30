/**
 * BLOCO 71 — REGRA DO DONO: CLIENTE ESPECIAL GB SÓ NAS ROTAS LIBERADAS
 *
 * O seletor "NORMAL x ESPECIAL GB" (e o flag cliente_especial_gb) só existe
 * dentro da Rota 3 (Edipo Pena) e da Rota 4 (Gil Pantoja).
 * Em qualquer outra rota: a opção nem aparece no cadastro/edição e o cliente
 * é sempre NORMAL — guarda aplicada na UI (Admin + Vendedor), nos payloads
 * e na camada de dados (clientService).
 *
 * Para liberar/alterar rotas no futuro: mexa APENAS nesta lista.
 */
export const ROTAS_CLIENTE_GB = ['ROTA_03', 'ROTA_04'] as const;

/** A rota informada pode ter cliente ESPECIAL GB? (fora da lista = sempre NORMAL) */
export function podeClienteEspecialGB(rota?: string | null): boolean {
  return !!rota && (ROTAS_CLIENTE_GB as readonly string[]).includes(rota);
}
