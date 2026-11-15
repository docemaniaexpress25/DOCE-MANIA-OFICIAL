-- ============================================================
-- BLOCO 70 — CLIENTE ESPECIAL GB + PREÇO ESPECIAL GB
-- Rodar no SQL Editor do Supabase (projeto de produção).
--
-- REGRA:
--   • Cliente NORMAL  → preços de hoje, nada muda
--     (preco_venda / preco_minimo + switch do preço tabela no PDV).
--   • Cliente ESPECIAL GB → cada produto do estoque principal que tiver
--     PREÇO ESPECIAL GB > 0 entra nesse preço no PDV (vence o preço
--     normal e o switch tabela). Produto sem preço GB (0) segue o preço
--     normal.
--   • O vendedor NUNCA pode digitar abaixo do preço GB do item
--     (o preço GB substitui o preço mínimo como piso para esse cliente).
--
-- O que este SQL faz (pode rodar várias vezes, não quebra nada):
--   1. clients.cliente_especial_gb  — boolean, default FALSE (todos os
--      clientes existentes viram NORMAL automaticamente).
--   2. products.preco_especial_gb   — numeric(12,2), default 0 (nenhum
--      produto tem preço GB até o dono cadastrar).
-- ============================================================

alter table public.clients
  add column if not exists cliente_especial_gb boolean not null default false;

alter table public.products
  add column if not exists preco_especial_gb numeric(12,2) not null default 0;

-- ============================================================
-- CONFERÊNCIAS (opcional — rode na aba SQL para conferir depois)
-- ============================================================
-- Clientes marcados como ESPECIAL GB:
--   select id, nome_fantasia from public.clients where cliente_especial_gb order by nome_fantasia;
--
-- Produtos com PREÇO ESPECIAL GB já cadastrado:
--   select id, nome, preco_venda, preco_minimo, preco_especial_gb
--     from public.products where preco_especial_gb > 0 order by nome;
--
-- Produtos que AINDA estão sem preço GB (o dono pode preencher depois):
--   select id, nome, preco_venda, preco_minimo
--     from public.products where coalesce(preco_especial_gb, 0) = 0 order by nome;
