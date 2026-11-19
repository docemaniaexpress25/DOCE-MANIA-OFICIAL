-- =====================================================================
-- BLOCO 189 (regra do dono): CPF DO CLIENTE NO CADASTRO + FREQUÊNCIA
-- DE ATENDIMENTO (semanal / quinzenal / mensal)
-- =====================================================================
-- 1) CPF: todo cliente SEM CNPJ deve ter o CPF no cadastro — é o
--    documento do PAGADOR do boleto a prazo. O PDV (Bloco 187) usa
--    nesta ordem: digitado na venda > CPF do cadastro > CNPJ do
--    cadastro. Rodar no SQL Editor do Supabase (produção). Idempotente.
--
-- 2) FREQUÊNCIA: organização do roteiro —
--      SEMANAL   = aparece toda semana no dia da visita (padrão)
--      QUINZENAL = aparece a cada 2 semanas (a cada 15 dias)
--      MENSAL    = aparece a cada 4 semanas
--    semana_referencia = âncora do ciclo (1-4): em que semana do ciclo
--    o cliente é visitado. Semanal ignora a âncora.
--
-- ANTES do SQL rodar o app funciona igual (colunas ausentes = SEMANAL).
-- =====================================================================

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS cpf text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS frequencia text NOT NULL DEFAULT 'SEMANAL';
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS semana_referencia smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.clients.cpf IS 'BLOCO 189: CPF do cliente pessoa (sem CNPJ) — documento do pagador do boleto a prazo (Bloco 187/189).';
COMMENT ON COLUMN public.clients.frequencia IS 'BLOCO 190: frequência de atendimento — SEMANAL (toda semana), QUINZENAL (a cada 2 semanas), MENSAL (a cada 4 semanas).';
COMMENT ON COLUMN public.clients.semana_referencia IS 'BLOCO 190: âncora do ciclo de frequência (1-4). Quinzenal usa 1|2, mensal usa 1-4. Semanal ignora.';

-- Conferência
SELECT 'clients.cpf' AS coluna, count(*) AS preenchidos FROM clients WHERE cpf IS NOT NULL AND cpf <> ''
UNION ALL
SELECT 'clients.frequencia', count(*) FROM clients WHERE frequencia <> 'SEMANAL';
