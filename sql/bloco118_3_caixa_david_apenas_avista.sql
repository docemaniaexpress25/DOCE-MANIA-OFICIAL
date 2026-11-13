-- ============================================================================
-- BLOCO 118.3 — LIMPEZA DO CAIXA PELA NOVA REGRA (caixa EXCLUSIVO do David R5)
-- ============================================================================
-- REGRA DO DONO: "vendas realizados a prazo deverao entrar no caixa de forma
-- separada de venda a vista... o que me interessa sao as vendas com dinheiro
-- e pix que ele recebe a vista! as vendas a prazo que ele recebe no contas a
-- receber nao precisam constar nessa tela!... somente a rota 5 devera ter
-- caixa."
--
-- Consequencias no ledger:
--   1) Recebimentos de CONTAS A RECEBER (boletos que caem na conta da empresa,
--      pix do portal, recebimentos manuais) NAO sao caixa — saem.
--      Exemplo apontado pelo dono: POSTO MODELO II R$ 3.075,96 (PIX/boleto que
--      caiu na conta) estava no caixa — era a prazo.
--   2) VENDA/ENTREGA de vendedor que NAO e o David (Rota 5) saem — os demais
--      vendedores ganham comissao e nao tem caixa.
--   3) So permanece: venda a vista e entrega cobrada (dinheiro/pix) do DAVID
--      (vendedor nome começando com "David") + ajuste manual.
-- Rodar inteiro no SQL Editor do Supabase.
-- ============================================================================

-- 1) O caso concreto apontado pelo dono (POSTO MODELO II — boleto/PIX na conta)
DELETE FROM caixa_pagamentos WHERE id = '429d478a-513c-4bcc-b8a5-6ecb29c05f6d';

-- 2) Defesa geral: qualquer recebimento/portal (a prazo) aberto sai do caixa
DELETE FROM caixa_pagamentos
WHERE fechamento_id IS NULL AND origem IN ('RECEBIMENTO', 'PORTAL');

-- 3) Defesa geral: VENDA/ENTREGA de vendedor que NAO e o David (caixa exclusivo R5)
DELETE FROM caixa_pagamentos
WHERE fechamento_id IS NULL
  AND origem IN ('VENDA', 'ENTREGA')
  AND (vendedor IS NULL OR vendedor NOT ILIKE 'david%');

-- CONFERENCIA: deve retornar 0 (caixa aberto limpo e na regra nova)
SELECT count(*) AS pagamentos_abertos FROM caixa_pagamentos WHERE fechamento_id IS NULL;
