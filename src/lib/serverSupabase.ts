import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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

// ============================================================
// PONTE DE DESENVOLVIMENTO (Bloco 12)
//
// Problema: o preview local (sandbox) nao tem a SUPABASE_SERVICE_ROLE_KEY
// (segredo que existe so no Vercel). Com ela ausente, /api/users devolvia
// 503 e a TELA DE LOGIN ficava sem a lista de usuarios — "o login nao
// aparece". Valer PIN localmente e impossivel sem a chave.
//
// Solucao: quando o servidor local NAO tem as credenciais, as rotas de API
// repassam a request para o deploy de PRODUCAO (que tem tudo: service key,
// bcrypt e Focus NFe) e devolvem a resposta. O preview fica 100% funcional:
// frontend local + backend de producao.
//
// Seguranca:
// - Nunca ativa em producao (la a service key existe -> isServerSupabaseConfigured
//   = true -> devBridge devolve null; e NODE_ENV=production como dupla trava).
// - Nao expoe segredo algum: apenas encaminha headers do chamador (ex. Bearer)
//   para a API publica de producao — o mesmo que o chamador faria direto.
// - Desligavel com DM_DEV_BRIDGE=off; alvo alteravel com DM_PROD_URL.
// ============================================================

export const DEV_BRIDGE_URL = process.env.DM_PROD_URL || 'https://sistema-doce-mania1.vercel.app';

export async function devBridge(req: Request): Promise<NextResponse | null> {
  if (isServerSupabaseConfigured()) return null;
  if (process.env.NODE_ENV === 'production') return null;
  if (process.env.DM_DEV_BRIDGE === 'off') return null;
  try {
    const url = new URL(req.url);
    const target = `${DEV_BRIDGE_URL}${url.pathname}${url.search}`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const auth = req.headers.get('authorization');
    if (auth) headers['authorization'] = auth;
    const method = req.method.toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? undefined : await req.text();
    const r = await fetch(target, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(45_000),
      cache: 'no-store',
    });
    const text = await r.text();
    return new NextResponse(text, { status: r.status, headers: { 'content-type': 'application/json' } });
  } catch {
    return null; // ponte indisponivel -> a rota segue o caminho normal (503)
  }
}
