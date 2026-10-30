-- ============================================================
-- BLOCO 12 — Campos fiscais de PRODUTO (NF-e/NFC-e) + email do cliente
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar 2x).
-- ============================================================
--
-- Por que: a SEFAZ exige por item da nota: NCM (obrigatorio), CFOP
-- (obrigatorio), unidade comercial, origem da mercadoria; CEST entra
-- para produtos com substituicao tributaria e o EAN (codigo de barras)
-- quando o produto o possui. Com esses campos no cadastro do produto,
-- a nota sai completa e o risco de rejeicao cai quase a zero.
--
-- O app usa esses nomes de coluna exatamente (nao renomear):
--   products.ncm, products.cest, products.cfop, products.ean,
--   products.unidade, products.origem
--   clients.email
-- ============================================================

alter table products add column if not exists ncm     text;
alter table products add column if not exists cest    text;
alter table products add column if not exists cfop    text;
alter table products add column if not exists ean     text;
alter table products add column if not exists unidade text default 'UN';
alter table products add column if not exists origem  text default '0';

alter table clients add column if not exists email text;

-- Sugestoes de preenchimento em massa (opcional — confira antes):
-- update products set cfop = '5102' where cfop is null or cfop = '';
-- update products set unidade = 'UN' where unidade is null or unidade = '';
-- update products set origem = '0'  where origem is null or origem = '';
-- NCM padrao para doces/comestiveis se nao souber o especifico:
-- update products set ncm = '21069090' where ncm is null or ncm = '';
