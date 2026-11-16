-- ============================================================
-- BLOCO 157 — CÓDIGO DO PRODUTO ESPECIAL GB (sobe na NF desses clientes)
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar 2x).
-- ============================================================
--
-- Regra do dono: já existe o PREÇO ESPECIAL GB (products.preco_especial_gb,
-- Bloco 70) que vence o preço normal no PDV do cliente ESPECIAL GB. Agora a
-- NOTA desses clientes também sobe com o CÓDIGO ESPECIAL: quando a NF-e/NFC-e
-- é emitida para um cliente marcado ESPECIAL GB, cada item sai com o
-- products.codigo_especial_gb no campo codigo_produto (no lugar do código
-- interno do Bloco 145).
--
-- Produto SEM código especial GB (vazio): a nota segue o código interno
-- normal — nada muda. Cliente NORMAL: nada muda.
--
-- O app usa este nome de coluna exatamente (não renomear):
--   products.codigo_especial_gb  (texto, até 60 caracteres)
--
-- Enquanto o SQL não rodar, o app salva/funciona SEM o campo (fallback
-- silencioso, sondas do serverSchema) — deploy seguro antes/depois.

alter table products add column if not exists codigo_especial_gb text;

-- Comentário no banco (opcional, ajuda quem for conferir depois):
comment on column products.codigo_especial_gb is 'BLOCO 157: codigo que sobe na NF-e/NFC-e quando a venda e para cliente ESPECIAL GB. Vazio = usa o codigo interno (products.codigo).';

-- Conferência (deve retornar a coluna):
-- select column_name, data_type from information_schema.columns
--  where table_name = 'products' and column_name = 'codigo_especial_gb';
