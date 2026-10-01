-- ============================================================
-- BLOCO 15 — Foto do produto + unidades por caixa (atacado)
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar 2x).
-- ============================================================
--
-- Por que: o catalogo do portal do cliente (igual ao site de pedidos
-- doce-mania) mostra 1 card por produto com FOTO grande e variantes.
-- Tambem suporta venda por CAIXA no atacado: se o produto vem em caixa
-- com N unidades (ex.: caixa com 12), o portal mostra "3 cx (36 un)"
-- e o pedido cai no sistema ja em UNIDADES prontas para separar.
--
-- O app usa esses nomes de coluna exatamente (nao renomear):
--   products.imagem               -> URL da foto (o catalogo mostra)
--   products.unidades_por_caixa   -> 1 = vende solto (padrao); N = caixa com N
--
-- Sem esse SQL o sistema continua funcionando (as fotos do catalogo
-- antigo aparecem por nome; campo vira 1 = unidade). Este SQL deixa o
-- dono SOBREPOR a foto e definir caixas direto no cadastro do produto.
-- ============================================================

alter table products add column if not exists imagem             text;
alter table products add column if not exists unidades_por_caixa integer default 1;

-- Normaliza caixas invalidas (null/0/negativo = vende solto)
update products set unidades_por_caixa = 1
  where unidades_por_caixa is null or unidades_por_caixa < 1;
