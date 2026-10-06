/**
 * REGRA ÚNICA das comissões — padrão definido pelo dono (Bloco 23):
 *
 *   "O padrão das comissões de pronta entrega e pré-venda são SEMPRE as
 *    que estão estipuladas dentro da lista de produtos no estoque central.
 *    Se tiver comissão pronta entrega 9%, essa será a comissão de pronta
 *    entrega daquele produto. O mesmo vale para pré-venda. Se não tiver
 *    preenchido, vale 10% para pronta entrega e 5% para pré-venda."
 *
 *   comissão pronta entrega = campo comissao_percentual do produto;
 *                             vazio  -> 10% (COMISSAO_PE_DEFAULT)
 *   comissão pré-venda      = campo comissao_pv_percentual do produto;
 *                             vazio  ->  5% (COMISSAO_PV_DEFAULT)
 *   comissão (R$)           = Σ (quantidade × preco_venda × pct / 100)
 *
 * Esta lib é usada em TODOS os lugares que precisam concordar:
 *   1. /api/pre-venda  (ação ENTREGUE)  -> GERA a comissão na entrega;
 *   2. /api/pre-venda/venda (POST)      -> devolve a PREVISÃO da tela
 *      "Pedido Registrado!" do PDV;
 *   3. productService.insertProduct     -> grava o padrão quando o dono
 *      deixa o campo vazio.
 *
 * Somente servidor (API routes) — usa o cliente Supabase de serviço.
 */

/** Padrão quando o produto NÃO tem comissão de PRONTA ENTREGA preenchida. */
export const COMISSAO_PE_DEFAULT = 10;

/** Padrão quando o produto NÃO tem comissão de PRÉ-VENDA preenchida. */
export const COMISSAO_PV_DEFAULT = 5;

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** % de comissão de PRONTA ENTREGA de um produto (vazio = 10). */
export function pctPeDeProduto(comissaoPercentual: number | null | undefined): number {
  const v = Number(comissaoPercentual);
  if (comissaoPercentual === null || comissaoPercentual === undefined || !isFinite(v)) {
    return COMISSAO_PE_DEFAULT;
  }
  return v;
}

/** % de comissão de PRÉ-VENDA de um produto (vazio = 5). */
export function pctPvDeProduto(comissaoPvPercentual: number | null | undefined): number {
  const v = Number(comissaoPvPercentual);
  if (comissaoPvPercentual === null || comissaoPvPercentual === undefined || !isFinite(v)) {
    return COMISSAO_PV_DEFAULT;
  }
  return v;
}

/**
 * Comissão de PRÉ-VENDA de um conjunto de itens (R$).
 * itens: [{ produto_id, quantidade, preco_venda }]
 * Se a coluna comissao_pv_percentual ainda não existir (SQL 14 pendente),
 * degrada para o padrão sem falhar.
 */
export async function comissaoPvDeItens(supabase: any, itens: any[]): Promise<number> {
  const prodIds = [...new Set(itens.map((i: any) => i.produto_id).filter(Boolean))];
  if (prodIds.length === 0) return 0;

  const pctPV: Record<string, number | null> = {};
  let colOk = true;
  try {
    const r = await supabase.from('products').select('id, comissao_pv_percentual').in('id', prodIds);
    if (r.error) colOk = false;
    else {
      (r.data || []).forEach((p: any) => {
        pctPV[p.id] = (p.comissao_pv_percentual === null || p.comissao_pv_percentual === undefined) ? null : Number(p.comissao_pv_percentual);
      });
    }
  } catch {
    colOk = false;
  }
  // Sem a coluna (SQL 14 pendente) tudo usa o padrão — regra do dono.

  let cheia = 0;
  itens.forEach((i: any) => {
    const pct = pctPvDeProduto(pctPV[i.produto_id]);
    cheia += Number(i.quantidade || 0) * Number(i.preco_venda || 0) * (pct / 100);
  });
  return round2(cheia);
}
