-- ============================================================
-- BLOCO 27 — ROTA 2 (novo fluxo de venda em teste)
-- Flag POR VENDEDOR: app_users.rota2 = true -> vendedor usa o
-- wizard guiado de venda. Demais perfis intocados.
-- Idempotente: pode rodar quantas vezes quiser.
-- Rodar no Supabase -> SQL Editor.
-- ============================================================

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS rota2 boolean DEFAULT false;

-- Nenhum vendedor ligado por padrao: o admin liga no
-- Admin > Usuarios > editar vendedor > switch "ROTA 2".
