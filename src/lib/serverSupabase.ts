import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase SERVER-SIDE com service_role key.
 * NUNCA importar em componentes client — a service role key
 * bypassa RLS e deve existir apenas em API routes.
 */
let cached: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SERVER_SUPABASE_NAO_CONFIGURADO');
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Mensagem amigavel para exibir quando o servidor nao tem as env vars */
export function isServerSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
