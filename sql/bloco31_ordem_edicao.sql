-- ============================================================
-- BLOCO 31 — ORDEM DA ROTA PELO ADMIN (setas na fila de entrega)
--            + base para a EDICAO de pedido antes da entrega
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar 2x).
-- ============================================================
--
-- O QUE FAZ:
--  * sales.ordem_entrega = posicao da parada na fila de entrega,
--    definida pelo ADMIN com as setas (cima/baixo) na fila.
--    Gravada no sistema e usada na impressao da lista de rota.
--    NULL = venda sem ordem manual (fila segue P1 -> P2 -> antigo).
--    Novos pedidos (NULL) entram no FIM da ordem manual.
--
--  * A EDICAO do pedido (itens, valores, forma de pagamento) NAO
--    precisa de SQL novo: usa sales + sale_items que ja existem.
-- ============================================================

alter table public.sales add column if not exists ordem_entrega int;

-- Indice leve para a ordenacao da fila com ordem manual ativa
create index if not exists idx_sales_ordem_entrega
  on public.sales (ordem_entrega)
  where ordem_entrega is not null;

-- ============================================================
-- FIM BLOCO 31
-- ============================================================
