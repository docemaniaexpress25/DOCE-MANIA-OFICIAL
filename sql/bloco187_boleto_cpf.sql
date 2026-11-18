-- =====================================================================
-- BLOCO 187 (regra do dono): CPF/CNPJ do PAGADOR do boleto a prazo
-- =====================================================================
-- Regra: o vendedor é OBRIGADO a pedir o CPF do cliente para finalizar
-- a venda A PRAZO no BOLETO (cupom/NFC-e). O documento fica gravado na
-- venda e o boleto do Inter nasce SEM pedir CPF de novo (a rota
-- /api/boletos usa sales.boleto_cpf como pagador quando a tela não
-- digitou nada). Cliente que quer NF-e não precisa: usa o CNPJ do
-- cadastro.
--
-- Rodar no SQL Editor do Supabase (produção). Antes do SQL rodar o
-- código funciona mesmo assim (gravar é best-effort; o CPF segue no
-- detalhe_pagamento da venda: "Boleto (pagador: 000.000.000-00)").
-- =====================================================================

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS boleto_cpf text;

COMMENT ON COLUMN public.sales.boleto_cpf IS
  'BLOCO 187: CPF/CNPJ do pagador do boleto a prazo, capturado obrigatoriamente no PDV (tela 6). Usado pela /api/boletos para nascer o boleto do Inter sem pedir documento de novo.';
