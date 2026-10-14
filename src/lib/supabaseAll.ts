import { supabase } from '@/lib/supabaseClient';

/**
 * BLOCO 20 — LEITURA COMPLETA DE TABELAS (anti-corte de 1000 linhas).
 *
 * O PostgREST/Supabase devolve no MAXIMO 1000 linhas por request (max-rows
 * do servidor). Sem paginacao, quando a tabela passa de 1000 linhas as
 * linhas fora do primeiro bloco SOMEM do app em silencio.
 *
 * Aconteceu em 01/10/2026: sales chegou a 1005 e as vendas mais novas
 * "desapareceram" do historico, relatorios e contas a receber (ex.:
 * Mio Mercato R$ 569,78 entregue e invisivel). commissions estava em 999
 * — uma venda antes de comissoes sumirem do acerto do vendedor.
 *
 * fetchAllPages percorre a tabela em blocos de 1000 (.range) com ordenacao
 * estavel (id unico como desempate) ate a pagina vir incompleta.
 * Leitura pura — nao altera escritas nem o formato dos dados.
 *
 * BLOCO 30 — CORRECAO CRITICA (vendas do dia/semana/mes/total + dividas zeradas):
 * antes este helper ENGOLEVA o erro (console.error + break) e devolvia o que
 * tinha — em erro de coluna inexistente (ex.: sales.modo_nota do Bloco 29 antes
 * do SQL), a 1a pagina ja falhava e ele devolvia ARRAY VAZIO como se fosse
 * dado. Os fallbacks dos services (try/catch) NUNCA disparavam porque nenhuma
 * excecao era lancada: o app exibia vendas/dividas zeradas em silencio.
 * Agora o erro e LANCADO — os services chamadores ja tem try/catch com
 * fallback dedicado e passam a funcionar de verdade.
 */

const PAGE_SIZE = 1000; // limite do servidor PostgREST
const MAX_PAGES = 30;    // trava de seguranca (30k linhas)

export async function fetchAllPages<T = any>(
  table: string,
  select: string,
  opts?: { orderCol?: string; ascending?: boolean; tiebreak?: boolean }
): Promise<T[]> {
  const { orderCol, ascending = true, tiebreak = true } = opts || {};
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    let q = supabase.from(table).select(select);
    if (orderCol) q = q.order(orderCol, { ascending });
    if (tiebreak) q = q.order('id', { ascending: true });
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) {
      // BLOCO 30: LANCA — engolir aqui escondia falhas de coluna/RLS/rede e
      // devolvia [] (ou parcial) como se fosse dado real, matando os fallbacks.
      console.error(`[fetchAllPages] erro em ${table} (pagina ${page}):`, error.message);
      throw new Error(error.message || `Erro ao ler ${table}`);
    }
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}
