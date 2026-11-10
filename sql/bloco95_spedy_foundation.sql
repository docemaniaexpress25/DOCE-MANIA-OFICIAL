-- ============================================================================
-- BLOCO 95 — FUNDAÇÃO FISCAL SPEDY (07/11/2026)
-- Dono: "decidimos integrar nosso sistema com a speedy! ... prepare nosso app
--        para receber essa integração"
--
-- O que este SQL cria (idempotente — pode rodar quantas vezes quiser):
--   1. spedy_webhook_events  -> log bruto de TODAS as entregas de webhook da
--      Spedy (dedup pela PK = id da entrega; auditoria completa; a API já
--      está publicada no Vercel e grava aqui).
--   2. notas_recebidas       -> espelho das COMPRAS (NF-e contra nosso CNPJ,
--      Distribuição DFe feito pela Spedy): resumo -> manifestação -> XML
--      completo (isComplete) -> entrada no estoque (fase seguinte).
--   3. Colunas fiscais em products (se ainda não existirem): NCM, CEST, CSOSN,
--      origem, EAN, unidade fiscal, peso — base do cadastro fiscal (Fase 1).
--
-- NÃO MEXE em: sales (colunas nota_* do Bloco 10 já existem), estoque central,
-- comissões, contas a receber. Nada no app muda de comportamento: o webhook
-- só PROCESSA com SPEDY_ENABLED=1 (ligamos na virada, com o dono).
--
-- Segurança (padrão do projeto): tabelas nascem com RLS ON e SEM policies —
-- anon/authenticated não leem nem escrevem; a API usa SUPABASE_SERVICE_ROLE_KEY
-- (service_role bypassa RLS). XML/PDF das notas ficam na Spedy (download
-- público), o espelho guarda chave de acesso + status + XML quando baixado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LOG DE WEBHOOKS (dedup pela PK; payload bruto jsonb para auditoria)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spedy_webhook_events (
  id           uuid PRIMARY KEY,          -- id da entrega (webhook-id / corpo.id)
  event        text NOT NULL,             -- invoice.status_changed, inbound_invoice.* ...
  payload      jsonb NOT NULL,            -- envelope completo { id, event, data }
  recebido_em  timestamptz NOT NULL DEFAULT now(),
  processado   boolean NOT NULL DEFAULT false,
  acao         text
);

-- Consulta rápida por tipo/evento no painel do fiscal (fase seguinte):
CREATE INDEX IF NOT EXISTS idx_spedy_events_event
  ON spedy_webhook_events (event, recebido_em DESC);

ALTER TABLE spedy_webhook_events ENABLE ROW LEVEL SECURITY;
-- Sem policies: só service_role (padrão do projeto — Bloco 13).

-- ---------------------------------------------------------------------------
-- 2. NOTAS RECEBIDAS (compras — espelho da Distribuição DFe via Spedy)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notas_recebidas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spedy_id           text UNIQUE,         -- id da inbound-product-invoice na Spedy
  chave_acesso       text UNIQUE,         -- chave de acesso NF-e (44 dígitos)
  modelo             text DEFAULT '55',
  emissor_cnpj       text,
  emissor_nome       text,
  emissor_uf         text,
  numero             text,
  serie              text,
  valor_total        numeric(14,2),
  qtd_itens          integer,
  data_emissao       timestamptz,
  is_complete        boolean DEFAULT false,   -- false = só resumo; true = XML completo
  manifestacao       text,                    -- science | confirmation | unknown_operation | declined
  status_sefaz       text,                    -- autorizada, cancelada (cancelamento pelo emissor)...
  xml                text,                    -- XML autorizado (baixado após isComplete=true)
  danfe_url          text,                    -- PDF gerado pela Spedy sob demanda
  processado_entrada boolean DEFAULT false,   -- true após entrada no estoque central (Fase 2)
  erro_matching      text,                    -- itens não reconhecidos (fila manual)
  recebido_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notas_recebidas_chave
  ON notas_recebidas (chave_acesso);
CREATE INDEX IF NOT EXISTS idx_notas_recebidas_pend
  ON notas_recebidas (processado_entrada, recebido_em DESC);

ALTER TABLE notas_recebidas ENABLE ROW LEVEL SECURITY;
-- Sem policies: só service_role.

-- ---------------------------------------------------------------------------
-- 3. CAMPOS FISCAIS DO PRODUTO (cadastro fiscal — Fase 1; idempotente)
--    products já tem algumas colunas fiscais do Bloco 10/77 — ADD COLUMN
--    IF NOT EXISTS garante tudo que a emissão Spedy precisa.
-- ---------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS ncm            varchar(8);   -- validado IBGE na UI
ALTER TABLE products ADD COLUMN IF NOT EXISTS cest           varchar(10);  -- substituição tributária
ALTER TABLE products ADD COLUMN IF NOT EXISTS csosn          varchar(4);   -- 101/102/400/500 (Simples)
ALTER TABLE products ADD COLUMN IF NOT EXISTS origem         varchar(2);   -- 0 nacional, 1 estrangeira...
ALTER TABLE products ADD COLUMN IF NOT EXISTS ean            varchar(14);  -- GTIN (matching da compra!)
ALTER TABLE products ADD COLUMN IF NOT EXISTS unidade_fiscal varchar(6);   -- UN, KG, CX...
ALTER TABLE products ADD COLUMN IF NOT EXISTS peso_kg        numeric(10,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS st_entrada     boolean DEFAULT false; -- entrou com ST (CST 60) -> CSOSN 500
ALTER TABLE products ADD COLUMN IF NOT EXISTS cfop_padrao    integer;      -- 5102 default (app monta)
ALTER TABLE products ADD COLUMN IF NOT EXISTS spedy_product_id text;      -- id do produto espelhado na Spedy

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (rodar depois e comparar):
--   SELECT count(*) FROM spedy_webhook_events;
--   SELECT count(*) FROM notas_recebidas;
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='products' AND column_name IN ('ncm','cest','csosn','ean','st_entrada');
--   -- RLS fechada:
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('spedy_webhook_events','notas_recebidas');
-- RESTAURAR (se necessário):
--   DROP TABLE IF EXISTS notas_recebidas;
--   DROP TABLE IF EXISTS spedy_webhook_events;
--   (colunas de products não precisam restaurar — ADD COLUMN não altera dados)
-- ============================================================================
