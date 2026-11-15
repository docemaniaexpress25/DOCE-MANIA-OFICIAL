-- ============================================================================
-- BLOCO 145 — CÓDIGO INTERNO DO PRODUTO (o código que APARECE NA NF)
--
-- Pedido do dono: "EM PRODUTOS CRIE UMA CAIXA QUE SERÁ O CÓDIGO DO PRODUTO!
-- CÓDIGO QUE APARECE NA NF, NÃO ESTAMOS FALANDO DE CÓDIGO EAN E SIM DO
-- CÓDIGO INTERNO."
--
-- O app passa a enviar este código no campo codigo_produto (cProd) da
-- NF-e/NFC-e. NÃO é o EAN (products.ean) — é o código interno de controle.
--
-- ONDE RODAR: Supabase → SQL Editor → New query → colar → RUN.
-- É IDEMPOTENTE: pode rodar quantas vezes quiser.
-- ============================================================================

-- 1) Coluna do código interno (texto livre até 60 chars — limite da SEFAZ p/ cProd)
alter table public.products
  add column if not exists codigo text;

comment on column public.products.codigo is
  'BLOCO 145: código INTERNO do produto (aparece na NF-e/NFC-e como codigo_produto). NÃO é o EAN.';

-- 2) Único: dois produtos não podem ter o mesmo código interno (quando preenchido)
create unique index if not exists products_codigo_uidx
  on public.products (codigo)
  where codigo is not null and codigo <> '';

-- 3) Confere (opcional): deve listar a coluna codigo
--    select column_name from information_schema.columns
--     where table_schema='public' and table_name='products' and column_name='codigo';
