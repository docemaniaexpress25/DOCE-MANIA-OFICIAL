/**
 * BLOCO 184 — ORDEM MANUAL (kanban) — helpers PUROS compartilhados entre o
 * Portal de Notas (/notas: ordenar as notas quando os XML batidos fora do app
 * sobem fora de ordem) e o ROTEIRO SEMANAL do vendedor (VendedorDashboard,
 * BLOCO 188: ordenar a sequência de visitas do dia — grava no client_order e
 * vale também para a Rota do Dia). Sem React, sem rede — testável por QA
 * (mesmo padrão do motor notaEspecial dos blocos 182/183).
 */

/** Momento da batida da nota (emissão > data da venda) — mesma régua do servidor. */
export function batidaDe(nota: { emitidaEm?: string | null; dataVenda?: string | null }): string {
  return String(nota.emitidaEm || nota.dataVenda || '');
}

/**
 * Comparador de notas: ORDEM MANUAL primeiro (índice no array salvo em
 * app_settings.notas_ordem); quem não está na ordem manual vem depois pela
 * régua do dono (última batida em primeiro lugar — Bloco 146).
 */
export function criarComparadorNotas<T extends { id: string; emitidaEm?: string | null; dataVenda?: string | null }>(ordemNotas: string[]) {
  const pos = new Map(ordemNotas.map((id, i) => [id, i]));
  return (a: T, b: T): number => {
    const pa = pos.get(a.id);
    const pb = pos.get(b.id);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return batidaDe(b).localeCompare(batidaDe(a));
  };
}

/**
 * Reordena por SLOTS: os ids visíveis trocam de posição ENTRE SI e cada um
 * cai no slot que JÁ OCUPAVA na lista base — quem não está visível (outro
 * filtro no portal, outro dia/outro vendedor na rota) NUNCA sai do lugar.
 *
 * @param idsBase lista completa atual (ordem global coerente)
 * @param idsVisiveis os ids que aparecem na tela, NA ORDEM ATUAL deles
 * @param novaOrdemVisiveis os MESMOS ids na nova ordem (pós-arrasto)
 * @returns a nova lista base completa — ou null quando algo não fecha
 *          (filtro/lista mudou no meio do arrasto: não faz nada, nunca corrompe)
 */
export function reordenarSlots(idsBase: string[], idsVisiveis: string[], novaOrdemVisiveis: string[]): string[] | null {
  if (idsVisiveis.length !== novaOrdemVisiveis.length) return null;
  const visivelSet = new Set(idsVisiveis);
  for (const id of novaOrdemVisiveis) {
    if (!visivelSet.has(id)) return null; // id estranho na ordem nova — recusa
  }
  const slots: number[] = [];
  idsBase.forEach((id, i) => { if (visivelSet.has(id)) slots.push(i); });
  if (slots.length !== idsVisiveis.length) return null; // visível fora da base — recusa
  const novo = [...idsBase];
  slots.forEach((slot, k) => { novo[slot] = novaOrdemVisiveis[k]; });
  return novo;
}
