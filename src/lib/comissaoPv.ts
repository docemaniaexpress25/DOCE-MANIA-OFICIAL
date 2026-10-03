/**
 * BLOCO 21 — REGRA ÚNICA da comissão de PRÉ-VENDA (origem: Bloco 14).
 *
 * Regra do dono: a comissão de pré-venda é definida DENTRO DE CADA PRODUTO
 * (campo próprio, igual a pronta entrega tem o seu):
 *   pct do produto = products.comissao_pv_percentual  (% de PRÉ-VENDA)
 *   se vazio       = products.comissao_percentual × taxaPV / 100
 *                    (taxaPV = app_config.comissao_pre_venda_pct, padrão 50)
 *   comissão       = Σ (quantidade × preco_venda × pct / 100)
 *
 * Esta função é usada em DOIS lugares que PRECISAM concordar:
 *   1. /api/pre-venda  (ação ENTREGUE)  -> GERA a comissão na entrega;
 *   2. /api/pre-venda/venda (POST)      -> devolve a PREVISÃO que aparece na
 *      tela "Pedido Registrado!" do PDV.
 * Antes do Bloco 21 a tela do PDV recalculava no browser com a % de PRONTA
 * ENTREGA — valor errado. Agora o valor mostrado é o mesmo que o servidor
 * grava na entrega (fonte única).
 *
 * Somente servidor (API routes) — usa o cliente Supabase de serviço.
 */

export const COMISSAO_PV_DEFAULT = 50;

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Taxa padrão da pré-venda (app_config.comissao_pre_venda_pct). Sem a tabela, usa 50. */
export async function getComissaoPvPct(supabase: any): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('app_config').select('valor').eq('chave', 'comissao_pre_venda_pct').maybeSingle();
    if (error) return COMISSAO_PV_DEFAULT;
    const v = Number(data?.valor);
    return isFinite(v) && v > 0 && v <= 100 ? v : COMISSAO_PV_DEFAULT;
  } catch {
    return COMISSAO_PV_DEFAULT;
  }
}

/**
 * Comissão de PRÉ-VENDA de um conjunto de itens.
 * itens: [{ produto_id, quantidade, preco_venda }]
 * Se a coluna comissao_pv_percentual ainda não existir (SQL 14 pendente),
 * degrada para a regra antiga sem falhar.
 */
export async function comissaoPvDeItens(supabase: any, itens: any[]): Promise<number> {
  const prodIds = [...new Set(itens.map((i: any) => i.produto_id).filter(Boolean))];
  if (prodIds.length === 0) return 0;

  const pctPE: Record<string, number> = {};
  const pctPV: Record<string, number | null> = {};
  let colOk = true;
  try {
    const r = await supabase.from('products').select('id, comissao_percentual, comissao_pv_percentual').in('id', prodIds);
    if (r.error) colOk = false;
    else {
      (r.data || []).forEach((p: any) => {
        pctPE[p.id] = Number(p.comissao_percentual || 0);
        pctPV[p.id] = (p.comissao_pv_percentual === null || p.comissao_pv_percentual === undefined) ? null : Number(p.comissao_pv_percentual);
      });
    }
  } catch {
    colOk = false;
  }
  if (!colOk) {
    const { data: prods } = await supabase.from('products').select('id, comissao_percentual').in('id', prodIds);
    (prods || []).forEach((p: any) => {
      pctPE[p.id] = Number(p.comissao_percentual || 0);
      pctPV[p.id] = null;
    });
  }

  const fator = await getComissaoPvPct(supabase);
  let cheia = 0;
  itens.forEach((i: any) => {
    const pv = pctPV[i.produto_id];
    const pct = (pv !== null && pv !== undefined) ? pv : (pctPE[i.produto_id] || 0) * (fator / 100);
    cheia += Number(i.quantidade || 0) * Number(i.preco_venda || 0) * (pct / 100);
  });
  return round2(cheia);
}
