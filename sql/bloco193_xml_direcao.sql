-- =====================================================================
-- BLOCO 193 (regra do dono): BALANÇO DE PRODUTOS — DIREÇÃO DA XML
-- =====================================================================
-- O balanço do Portal de Produtos (/produtos-balanco) separa ENTRADA
-- (XML de fornecedor — Portal de Entradas) de SAÍDA (XML de nota de
-- venda emitida FORA do app por terceiros). A coluna direcao marca cada
-- importação: 'ENTRADA' (padrão, tudo que já existe) | 'SAIDA'.
-- Rodar no SQL Editor do Supabase. Idempotente.
-- =====================================================================

ALTER TABLE public.xml_importacoes ADD COLUMN IF NOT EXISTS direcao text NOT NULL DEFAULT 'ENTRADA';

COMMENT ON COLUMN public.xml_importacoes.direcao IS 'BLOCO 193: ENTRADA = XML de fornecedor (compra); SAIDA = XML de nota de venda emitida fora do app (terceiros) — entra no balanço como saída.';
