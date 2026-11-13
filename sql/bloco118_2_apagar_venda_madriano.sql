-- ============================================================================
-- BLOCO 118.2 — APAGAR A VENDA "M ADRIANO" (teste do caixa de hoje)
-- ============================================================================
-- Venda:  b4a9c988-9cb8-4f93-906d-8e0acfd94f53
-- Cliente: M adriano · R$ 264,26 · DINHEIRO na entrega · origem ENTREGA
-- Criada: 2026-11-13 17:47 UTC · Fechamento 44c6706f (17:58 UTC, so essa venda)
--
-- O que o SQL faz, na ordem:
--   1) CAIXA: apaga o pagamento do ledger (por sale_id, pega qualquer duplicata)
--      e o FECHAMENTO inteiro (ele contem SOMENTE essa venda — se ficasse, o
--      historico continuaria mostrando R$ 264,26 de M adriano para sempre).
--   2) RASTROS: eventos da fila de entrega + comissao da venda + comprovantes
--      do portal ligados a ela (DELETE no-op seguro se nada existir).
--   3) ESTOQUE: devolve a reserva baixada no registro da venda (mesma regra do
--      EXCLUIR do app: so devolve se sales.estoque_baixado = true).
--   4) ITENS + VENDA: o trigger do Kardex grava o ESTORNO de cada item
--      (rastreio fica no Kardex) e a venda sai do sistema.
-- Rodar inteiro no SQL Editor do Supabase.
-- ============================================================================

-- 1) CAIXA (ledger + snapshot do fechamento)
DELETE FROM caixa_pagamentos        WHERE sale_id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53';
DELETE FROM caixa_fechamentos_geral WHERE id = '44c6706f-9e23-4907-a1af-5c560f2659b1';

-- 2) RASTROS da venda
DELETE FROM entrega_eventos     WHERE sale_id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53';
DELETE FROM commissions         WHERE sale_id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53';
DELETE FROM payment_comprovantes WHERE sale_id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53';

-- 3) ESTOQUE: devolve a reserva (antes de apagar os itens — precisa da venda viva para o EXISTS)
UPDATE products p
SET estoque_principal = p.estoque_principal + si.quantidade
FROM sale_items si
WHERE si.sale_id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53'
  AND si.produto_id = p.id
  AND EXISTS (SELECT 1 FROM sales s WHERE s.id = si.sale_id AND s.estoque_baixado IS TRUE);

-- 4) ITENS + VENDA (trigger do Kardex registra o ESTORNO de cada item)
DELETE FROM sale_items WHERE sale_id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53';
DELETE FROM sales      WHERE id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53';

-- CONFERENCIA: deve retornar 0 em todas as linhas
SELECT 'sales' AS tabela, count(*) AS resto FROM sales WHERE id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53'
UNION ALL SELECT 'sale_items', count(*) FROM sale_items WHERE sale_id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53'
UNION ALL SELECT 'caixa_pagamentos', count(*) FROM caixa_pagamentos WHERE sale_id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53'
UNION ALL SELECT 'caixa_fechamentos_geral', count(*) FROM caixa_fechamentos_geral WHERE id = '44c6706f-9e23-4907-a1af-5c560f2659b1'
UNION ALL SELECT 'entrega_eventos', count(*) FROM entrega_eventos WHERE sale_id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53'
UNION ALL SELECT 'commissions', count(*) FROM commissions WHERE sale_id = 'b4a9c988-9cb8-4f93-906d-8e0acfd94f53';
