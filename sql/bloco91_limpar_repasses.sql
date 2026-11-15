-- ============================================================================
-- BLOCO 91 — LIMPAR HISTÓRICO DE REPASSES + PREPARAR O PAGAMENTO PELO APP
-- (meta do dono: começar a pagar pelo sistema segunda-feira, 09/11/2026)
-- Rodar no SQL Editor do Supabase (produção). Pode copiar e colar inteiro.
--
-- O QUE FAZ:
--   PASSO 1: cria as colunas do RECIBO (aceitado/aceite_em — Bloco 15 que
--            nunca rodou). Sem elas o botão "DAR RECIBO" do vendedor falha.
--   PASSO 2: backup completo de commission_payment_logs
--   PASSO 3: APAGA o histórico de repasses (a partir de segunda, zero limpo)
--   PASSO 4: conferência depois
--
-- GARANTIAS (o que este SQL NÃO MEXE):
--   • commissions — nem é citada. O que o Bloco 90 zerou permanece zerado;
--     A_RECEBER (a prazo) segue intacta e vira Disponível sozinha quando o
--     cliente pagar a venda.
--   • sales — nem é citada. CONTAS A RECEBER é calculada das vendas:
--     IMPOSSÍVEL afetar.
--   • seller_expenses (despesas dos vendedores): intacto.
--   • Tudo que for apagado fica no backup (restaurar no fim do arquivo).
--
-- ⚠️ RODE UMA VEZ SÓ. Se rodar de novo depois de segunda, apaga também os
--    repasses novos (sempre fica backup da última execução).
-- ============================================================================

-- ============================================================================
-- PASSO 1 — RECIBO PRONTO (colunas que faltavam; idempotente — pode rodar 2x)
-- ============================================================================
ALTER TABLE commission_payment_logs
  ADD COLUMN IF NOT EXISTS aceitado boolean NOT NULL DEFAULT false;
ALTER TABLE commission_payment_logs
  ADD COLUMN IF NOT EXISTS aceite_em timestamptz;

-- Histórico antigo = repasse que o dono JÁ ENTREGOU em mãos → marca recebido
-- (se um dia for restaurado, não volta como recibo pendente)
UPDATE commission_payment_logs SET aceitado = true;

-- ============================================================================
-- PASSO 2 — BACKUP (espelho completo, já com as colunas novas)
-- ============================================================================
DROP TABLE IF EXISTS backup_commission_payment_logs_bloco91;
CREATE TABLE backup_commission_payment_logs_bloco91 AS
SELECT * FROM commission_payment_logs;

-- ============================================================================
-- PASSO 3 — APAGAR O HISTÓRICO DE REPASSES
-- ============================================================================
BEGIN;
DELETE FROM commission_payment_logs;
COMMIT;

-- ============================================================================
-- PASSO 4 — CONFERIR DEPOIS
--   qtde = 0 (histórico limpo)
-- ============================================================================
SELECT count(*) AS qtde,
       COALESCE(round(sum(valor_pago)::numeric, 2), 0) AS total_repassado
FROM commission_payment_logs;

-- Conferência extra — comissões não foram tocadas (deve bater com o Bloco 90):
--   A_RECEBER intacta / DISPONIVEL e PAGO zerados
SELECT status, count(*) AS qtde,
       round(sum(valor_comissao)::numeric, 2) AS total_comissao
FROM commissions
GROUP BY status ORDER BY status;

-- ----------------------------------------------------------------------------
-- OPCIONAL — limpar também os avisos antigos "Comissão Liberada" da caixa de
-- mensagens dos vendedores (senão eles ainda veem os avisos antigos no app).
-- DESCOMENTE se quiser:
--
-- DELETE FROM system_messages WHERE type = 'COMMISSION_CONFIRMATION';
-- ----------------------------------------------------------------------------

-- ============================================================================
-- RESTAURAR (só se precisar — devolve o histórico exatamente como era):
--
-- INSERT INTO commission_payment_logs
-- SELECT * FROM backup_commission_payment_logs_bloco91;
-- ============================================================================
