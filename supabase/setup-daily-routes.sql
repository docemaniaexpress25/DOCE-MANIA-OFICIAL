-- ============================================================
-- Tabela: daily_routes (rota diaria do vendedor + clientes pulados)
--
-- IMPORTANTE: este SQL NAO derruba mais a tabela (antes usava
-- DROP TABLE e apagava as rotas salvas). So ajusta permissoes.
--
-- PADRAO DO PROJETO (igual user_locations):
-- A tabela fica FECHADA para anon/authenticated. O app usa login
-- proprio (nunca Supabase Auth), entao todo acesso do browser eh
-- anon — e as policies antigas "TO authenticated" faziam o upsert
-- do vendedor falhar com 42501 em silencio ("Erro ao salvar rota
-- diaria" no console).
-- O acesso agora eh EXCLUSIVAMENTE pela API /api/daily-route
-- (service_role, que bypassa RLS).
--
-- Execute no Supabase SQL Editor — pode rodar quantas vezes quiser.
-- ============================================================

-- 1. Criar tabela se ainda nao existir (nao mexe se ja existir)
CREATE TABLE IF NOT EXISTS public.daily_routes (
  vendedor_id TEXT NOT NULL,
  data TEXT NOT NULL,
  client_ids TEXT[] DEFAULT '{}',
  skipped_client_ids TEXT[] DEFAULT '{}',
  PRIMARY KEY (vendedor_id, data)
);

-- 2. Garantir RLS ativa
ALTER TABLE public.daily_routes ENABLE ROW LEVEL SECURITY;

-- 3. Remover policies antigas (qualquer nome que exista)
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'daily_routes'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.daily_routes', p.policyname);
  END LOOP;
END $$;

-- 4. Revogar todo acesso direto de anon e authenticated
REVOKE ALL ON public.daily_routes FROM anon, authenticated;
