-- ============================================================================
-- BLOCO 80 — CUSTO MÉDIO CONGELADO POR VENDA (sale_items.custo_unitario)
-- Rodar no SQL Editor do Supabase (produção). Pode copiar e colar inteiro.
--
-- O QUE FAZ (3 passos):
--   1) Cria a coluna custo_unitario em sale_items.
--   2) BACKFILL: preenche TODO o histórico com o preço de custo médio
--      cadastrado HOJE — a conta dos meses anteriores trava com esse valor.
--   3) GATILHO: toda venda NOVA grava sozinha o custo do momento.
--      Depois disso, mudar o preço de custo de um produto NÃO muda mais
--      o passado: cada venda fica com o custo médio da época dela.
--      A conta vira número permanente, auditável, de verdade.
--
-- SEGURO: não apaga nem altera dados existentes (só adiciona coluna +
-- gatilho). O painel "Lucro por Rota" começa a usar o custo congelado
-- automaticamente (enquanto o SQL não roda, usa o cadastrado hoje).
-- ============================================================================

-- 1) Coluna nova ------------------------------------------------------------
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS custo_unitario numeric(12,4);

-- 2) BACKFILL do histórico --------------------------------------------------
UPDATE sale_items si
SET custo_unitario = p.preco_custo
FROM products p
WHERE p.id = COALESCE(si.produto_id, si.product_id)
  AND si.custo_unitario IS NULL
  AND p.preco_custo IS NOT NULL;

-- 3) GATILHO: congela o custo no INSERT de cada item de venda ----------------
--    (vale para QUALQUER origem: RPC processar_venda_v2, pré-venda, insert
--    direto — é no banco, então nada escapa)
CREATE OR REPLACE FUNCTION setar_custo_unitario_venda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.custo_unitario IS NULL THEN
    SELECT p.preco_custo INTO NEW.custo_unitario
    FROM products p
    WHERE p.id = COALESCE(NEW.produto_id, NEW.product_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custo_unitario_sale_items ON sale_items;
CREATE TRIGGER trg_custo_unitario_sale_items
BEFORE INSERT ON sale_items
FOR EACH ROW
EXECUTE FUNCTION setar_custo_unitario_venda();

-- ============================================================================
-- CONFERÊNCIA (opcional — rode depois para validar):
--
-- A) Itens ainda sem custo (deve dar 0, a menos que haja produto sem
--    preco_custo cadastrado):
--   SELECT count(*) FROM sale_items si
--   JOIN products p ON p.id = COALESCE(si.produto_id, si.product_id)
--   WHERE si.custo_unitario IS NULL AND p.preco_custo IS NOT NULL;
--
-- B) Ver o custo congelado de uma venda recente:
--   SELECT si.sale_id, si.quantidade, si.custo_unitario, p.nome
--   FROM sale_items si JOIN products p ON p.id = si.produto_id
--   ORDER BY si.created_at DESC LIMIT 10;
-- ============================================================================
