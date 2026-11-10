-- ============================================================================
-- BLOCO 99 (regra do dono): "Na tela inicial deixe o card do rota 2 desligado,
-- crie esse liga e desliga no menu usuario"
-- ----------------------------------------------------------------------------
-- O LIGA/DESLIGA ja existe no app (menu Usuarios -> botao Ligado/Desligado).
-- Este SQL serve para DESLIGAR a Rota 2 DIRETO no banco (o card dela fica
-- travado como DESLIGADO na tela inicial e o PIN para de funcionar).
--
-- Rode no Supabase (SQL Editor). Nada de estrutura muda — so o flag `ativo`.
-- ============================================================================

-- 1) DESLIGAR o usuario da Rota 02 (vendedor):
UPDATE app_users
SET ativo = false
WHERE perfil = 'VENDEDOR'
  AND ativo = true
  AND (rota = 'ROTA_02' OR lower(nome) IN ('r2', 'rota 2', 'rota 02'));

-- Conferencia: deve listar o usuario com ativo = false
SELECT id, nome, perfil, rota, ativo
FROM app_users
WHERE perfil = 'VENDEDOR'
  AND (rota = 'ROTA_02' OR lower(nome) IN ('r2', 'rota 2', 'rota 02'));

-- ----------------------------------------------------------------------------
-- ROLLBACK (voltar a ligar):
-- UPDATE app_users SET ativo = true
-- WHERE perfil = 'VENDEDOR'
--   AND (rota = 'ROTA_02' OR lower(nome) IN ('r2', 'rota 2', 'rota 02'));
-- ----------------------------------------------------------------------------
-- Nota: se o nome/rota do usuario da Rota 2 for outro, desligue pelo APP:
-- Admin -> Usuarios -> linha do vendedor -> botao "Desligado".
-- ============================================================================
