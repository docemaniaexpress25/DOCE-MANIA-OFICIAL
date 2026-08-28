-- ============================================================
-- Tabela push_tokens + RLS
-- Execute no Supabase SQL Editor
-- https://eyjhqjrczzpfthsddlpg.supabase.co/project/default/sql
-- ============================================================

-- 1. Criar tabela
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  keys_auth TEXT,
  keys_p256dh TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Habilitar RLS
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- 3. Qualquer usuario autenticado pode gerenciar tokens
--    (todos os usuarios precisam ler/escrever tokens)
CREATE POLICY "Authenticated can manage push tokens"
  ON public.push_tokens
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4. Limpar tokens antigos (mais de 30 dias sem atualizar)
CREATE OR REPLACE FUNCTION clean_old_push_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM public.push_tokens WHERE updated_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql;
