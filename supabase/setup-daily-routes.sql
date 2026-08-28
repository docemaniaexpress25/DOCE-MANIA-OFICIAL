-- =============================================
-- Tabela: daily_routes
-- Armazena a rota diaria do vendedor com clientes pulados
-- =============================================

-- Remove tabela existente (se houver) e recria
DROP TABLE IF EXISTS public.daily_routes;

CREATE TABLE public.daily_routes (
  vendedor_id TEXT NOT NULL,
  data TEXT NOT NULL,
  client_ids TEXT[] DEFAULT '{}',
  skipped_client_ids TEXT[] DEFAULT '{}',
  PRIMARY KEY (vendedor_id, data)
);

-- RLS: desabilita para qualquer usuario autenticado poder ler/escrever
ALTER TABLE public.daily_routes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "any_auth_read" ON public.daily_routes FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "any_auth_insert" ON public.daily_routes FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "any_auth_update" ON public.daily_routes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "any_auth_upsert" ON public.daily_routes FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
