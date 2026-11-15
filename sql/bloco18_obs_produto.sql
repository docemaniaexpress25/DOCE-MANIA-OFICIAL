-- ============================================================
-- BLOCO 18 — Observação do produto para o CLIENTE (portal)
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar 2x).
-- ============================================================
--
-- Por que: o dono quer escrever uma OBS em cada produto (ex.: promocao,
-- validade, "leve 3 pague 2") e essa obs SO aparece para o CLIENTE
-- COMPRADOR, no catalogo do pedido online (/pedido/[codigo]).
--
-- NAO aparece no PDV, na fila de separacao nem em mais nada do sistema
-- (o app so le essa coluna no catalogo do portal).
--
-- O app usa esse nome de coluna exatamente (nao renomear):
--   products.obs  -> texto livre (ate 300 caracteres). null/vazio = sem obs.
--
-- Sem esse SQL o sistema continua funcionando (a observacao simplesmente
-- nao salva). Este SQL ativa o campo na hora.
-- ============================================================

alter table products add column if not exists obs text;
