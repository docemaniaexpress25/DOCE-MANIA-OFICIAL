-- ============================================================================
-- BLOCO 98: VALOR DAS TROCAS EM PRECO DE CUSTO (regra do dono)
-- "as vezes essas trocas nao sao trocadas pelos mesmos produtos — entao
--  precisa escrever quanto valem em reais PRECO DE CUSTO. A gente devolve
--  itens que fecham esse valor de custo."
-- Coluna informativa (nao entra no total da venda — desconto por troca
-- continua sendo sales.trocas / campo "Desconto" do PDV).
-- ============================================================================
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS trocas_valor numeric(12,2);

-- Conferencia:
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'sales' AND column_name = 'trocas_valor';
--
-- Rollback: ALTER TABLE public.sales DROP COLUMN IF EXISTS trocas_valor;
-- (O app degrada graciosamente sem a coluna: o campo some e nada quebra.)
