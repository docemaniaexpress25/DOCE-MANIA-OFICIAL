-- ============================================================================
-- BLOCO 184 — ORDEM MANUAL DAS NOTAS (kanban no Portal de Notas /notas)
-- ---------------------------------------------------------------------------
-- O portal agora guarda a ORDEM que o dono arrasta no kanban (XMLs batidos
-- fora do app entram fora de ordem). A ordem é um ARRAY de ids guardado na
-- linha global de app_settings (mesma casa de client_order/catalogo_order).
--
-- RODAR NO SUPABASE (SQL Editor). IDEMPOTENTE — pode rodar mais de uma vez.
-- Sem isso, o portal funciona normal (só não salva a ordem arrastada).
-- ============================================================================

-- 1) Coluna nova na linha global de configurações
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS notas_ordem jsonb DEFAULT '[]'::jsonb;

-- 2) Garante a linha global (o portal salva nela)
INSERT INTO app_settings (id) VALUES ('global_settings') ON CONFLICT (id) DO NOTHING;

-- 3) Conferência (deve mostrar 0 até o dono arrastar o kanban)
SELECT id, jsonb_array_length(COALESCE(notas_ordem, '[]'::jsonb)) AS ids_na_ordem_manual
FROM app_settings WHERE id = 'global_settings';
