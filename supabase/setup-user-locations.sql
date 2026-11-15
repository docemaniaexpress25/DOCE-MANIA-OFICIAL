-- ============================================================
-- Tabela user_locations + RLS
-- Execute este SQL no Supabase SQL Editor:
-- https://eyjhqjrczzpfthsddlpg.supabase.co/project/default/sql
-- ============================================================

-- 1. Apagar tabela antiga (se existir) e recriar corretamente
DROP TABLE IF EXISTS public.user_locations CASCADE;

-- 2. Criar tabela com user_id como TEXT (match com o id da tabela users do app)
CREATE TABLE public.user_locations (
  user_id TEXT PRIMARY KEY,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Habilitar RLS
ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;

-- 4. Qualquer usuario autenticado pode LER todas as localizacoes
--    (o admin precisa ver a dos vendedores)
CREATE POLICY "Authenticated can read all locations"
  ON public.user_locations
  FOR SELECT
  TO authenticated
  USING (true);

-- 5. Qualquer usuario autenticado pode INSERIR (cada um salva a propria)
CREATE POLICY "Authenticated can insert locations"
  ON public.user_locations
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 6. Qualquer usuario autenticado pode ATUALIZAR (upsert precisa disso)
CREATE POLICY "Authenticated can update locations"
  ON public.user_locations
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
