-- ============================================================================
-- BLOCO 90 — ZERAR COMISSÕES PAGAS + LIBERADAS (ajuste manual do dono)
-- Rodar no SQL Editor do Supabase (produção). Pode copiar e colar inteiro.
--
-- O QUE FAZ:
--   PASSO 0: conferência ANTES (só SELECT — não mexe em nada)
--   PASSO 1: backup completo de commissions numa tabela espelho
--   PASSO 2: zera valor_comissao/valor_pago SOMENTE de:
--              status = 'PAGO'       -> comissões JÁ PAGAS
--              status = 'DISPONIVEL' -> comissões LIBERADAS (a pagar agora)
--   PASSO 3: conferência DEPOIS
--
-- GARANTIAS (o que este SQL NÃO MEXE):
--   • status = 'A_RECEBER' — comissão A PRAZO / que vai liberar no futuro:
--     NÃO É ZERADA. Continua intacta e vira "Disponível" sozinha quando o
--     cliente pagar a venda (fluxo normal do sistema).
--   • sales (VENDAS) — nem é citada no SQL. A CONTAS A RECEBER é calculada
--     das vendas (status_pagamento PENDENTE), então é IMPOSSÍVEL este SQL
--     afetar contas a receber.
--   • commission_payment_logs — histórico real dos repasses/recipientes: intacto.
--   • seller_expenses (despesas dos vendedores): intacto.
-- ============================================================================

-- ============================================================================
-- PASSO 0 — CONFERIR ANTES (rode e compare com o esperado abaixo)
-- ============================================================================
-- Esperado (conferido na produção em 07/11/2026):
--   A_RECEBER    ~74   ~R$ 4.082,37    <- fica INTACTO (a prazo / futuro)
--   DISPONIVEL   ~346  ~R$ 8.985,99    <- vira 0
--   PAGO         ~946  ~R$ 37.650,10   <- vira 0
SELECT status, count(*) AS qtde,
       round(sum(valor_comissao)::numeric, 2) AS total_comissao,
       round(sum(valor_pago)::numeric, 2) AS total_pago
FROM commissions
GROUP BY status
ORDER BY status;

-- ============================================================================
-- PASSO 1 — BACKUP (espelho completo; é daqui que se restaura qualquer coisa)
-- ============================================================================
DROP TABLE IF EXISTS backup_commissions_bloco90;
CREATE TABLE backup_commissions_bloco90 AS
SELECT * FROM commissions;

-- ============================================================================
-- PASSO 2 — ZERAR (transação: tudo ou nada)
-- ============================================================================
BEGIN;

  -- 2a) PAGAS: zera o valor gerado E o valor pago nelas.
  --     (o histórico real do que foi repassado fica em commission_payment_logs,
  --      que não é tocado)
  UPDATE commissions
     SET valor_comissao = 0,
         valor_pago     = 0
   WHERE UPPER(TRIM(status)) = 'PAGO';

  -- 2b) LIBERADAS (Disponível): zera o valor gerado.
  --     (nelas valor_pago já é 0; ficam com saldo R$ 0,00 — nada a pagar)
  UPDATE commissions
     SET valor_comissao = 0
   WHERE UPPER(TRIM(status)) = 'DISPONIVEL';

COMMIT;

-- ============================================================================
-- PASSO 3 — CONFERIR DEPOIS
--   A_RECEBER tem que continuar com EXATAMENTE os mesmos números do PASSO 0.
--   DISPONIVEL e PAGO devem somar 0.
-- ============================================================================
SELECT status, count(*) AS qtde,
       round(sum(valor_comissao)::numeric, 2) AS total_comissao,
       round(sum(valor_pago)::numeric, 2) AS total_pago
FROM commissions
GROUP BY status
ORDER BY status;

-- Saldo por vendedor depois (Disponível de cada um — deve dar tudo 0,00):
SELECT u.nome,
       round(sum(c.valor_comissao - c.valor_pago)::numeric, 2) AS disponivel
FROM commissions c
LEFT JOIN app_users u ON u.id = c.seller_id
WHERE c.status = 'DISPONIVEL'
GROUP BY u.nome
ORDER BY disponivel DESC;

-- ============================================================================
-- RESTAURAR (só se precisar — devolve valores/status como eram ANTES do bloco 90):
--
-- UPDATE commissions c
--    SET valor_comissao = b.valor_comissao,
--        valor_pago     = b.valor_pago,
--        status         = b.status
--   FROM backup_commissions_bloco90 b
--  WHERE b.id = c.id;
-- ============================================================================
