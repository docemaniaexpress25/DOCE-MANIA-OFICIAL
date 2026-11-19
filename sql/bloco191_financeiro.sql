-- =====================================================================
-- BLOCO 191 (regra do dono): PORTAL FINANCEIRO — CUSTOS DA EMPRESA
-- =====================================================================
-- Custos lançados pelo admin (saídas de dinheiro da empresa que não são
-- despesa de vendedor nem comissão): compra de mercadoria, frete,
-- aluguel, energia, salários, impostos etc. Entram no balanço geral do
-- Portal Financeiro (/financeiro) junto de despesas dos vendedores,
-- comissões pagas e faturamento.
--
-- RLS ligado SEM policy = só service_role (as API routes do app).
-- Rodar no SQL Editor do Supabase. Idempotente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS custos_empresa (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao   text NOT NULL,
  categoria   text NOT NULL DEFAULT 'OUTROS',   -- MERCADORIA | FRETE | ALUGUEL | ENERGIA | AGUA | INTERNET | SALARIOS | IMPOSTOS | MANUTENCAO | OUTROS
  valor       numeric(14,2) NOT NULL,
  data        timestamptz NOT NULL DEFAULT now(),
  criado_por  uuid,                             -- app_users.id do admin que lançou
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custos_empresa_data_idx ON custos_empresa (data DESC);

ALTER TABLE custos_empresa ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE custos_empresa IS 'BLOCO 191: custos lançados pelo admin no Portal Financeiro — entram no balanço geral como SAÍDA.';
