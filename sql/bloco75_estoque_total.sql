-- ============================================================
-- BLOCO 75 — ESTOQUE TOTAL (novo fluxo do estoque, regra do dono)
-- ============================================================
-- FLUXO NOVO:
--   ENTRADA: toda mercadoria entra no ESTOQUE TOTAL (estoque_principal).
--            Acabou a pergunta "COM NF ou SEM NF?" na entrada.
--   VENDA COM CUPOM:        baixa o Total + soma o contador ESTOQUE 2 (estoque_semnf).
--   VENDA COM NF-e/NFC-e:   baixa o Total + soma o contador ESTOQUE 1 (estoque_nota).
--   Estoque 1 e Estoque 2 viram CONTADORES AUTOMATICOS de saida (editaveis
--   pelo admin para correcao). A conta sempre fecha:
--     Estoque Total = (tudo que entrou) - (estoque 1) - (estoque 2)
--
-- BACKUP: este script cria products_backup_bloco75 com os saldos de ANTES.
-- ROLLBACK: bloqueado no fim do arquivo — so rodar se precisar restaurar.
-- ============================================================

-- ---------- 1) BACKUP DE SEGURANCA (snapshot dos saldos de hoje) ----------
DROP TABLE IF EXISTS products_backup_bloco75;
CREATE TABLE products_backup_bloco75 AS
SELECT
  id,
  nome,
  estoque_principal,
  estoque_nota,
  estoque_semnf,
  estoque_van,
  NOW() AS backup_em
FROM products;

-- ---------- 2) MIGRACAO: tudo soma no ESTOQUE TOTAL (nada se perde) ----------
UPDATE products SET
  estoque_principal = COALESCE(estoque_principal, 0)
                    + COALESCE(estoque_nota, 0)
                    + COALESCE(estoque_semnf, 0);

UPDATE products SET
  estoque_nota  = 0,  -- recomeca como contador de saidas COM NF (estoque 1)
  estoque_semnf = 0;  -- recomeca como contador de saidas SEM NF / cupom (estoque 2)

-- Conferencia (opcional): soma do backup = soma migrada
-- SELECT (SELECT COALESCE(SUM(estoque_principal+estoque_nota+estoque_semnf),0) FROM products_backup_bloco75) AS antes,
--        (SELECT COALESCE(SUM(estoque_principal),0) FROM products) AS depois;

-- ============================================================
-- 3) ROLLBACK (SO RODAR SE DER PROBLEMA — restaura os saldos de antes)
-- ============================================================
-- UPDATE products p SET
--   estoque_principal = b.estoque_principal,
--   estoque_nota      = b.estoque_nota,
--   estoque_semnf     = b.estoque_semnf
-- FROM products_backup_bloco75 b
-- WHERE p.id = b.id;
