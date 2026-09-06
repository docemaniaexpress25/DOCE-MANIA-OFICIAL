import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';

// Chaves VAPID agora vem de variaveis de ambiente da Vercel
// (a chave privada NUNCA deve ficar no codigo).
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;

// Variavel de ambiente com a URL do Supabase (server-side)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

/**
 * POST /api/send-push
 * Body: { title: string, body: string, url?: string }
 * Busca tokens no Supabase e envia push para todos dispositivos
 */
export async function POST(req: NextRequest) {
  try {
    if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY || !SUPABASE_URL || !isServerSupabaseConfigured()) {
      return NextResponse.json({ error: 'Push nao configurado: defina VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e SUPABASE_SERVICE_ROLE_KEY na Vercel.' }, { status: 503 });
    }
    webpush.setVapidDetails('mailto:contato@docemania.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const { title, body, url } = await req.json();
    if (!title || !body) {
      return NextResponse.json({ error: 'title e body obrigatorios' }, { status: 400 });
    }

    // Buscar tokens ativos no Supabase (service role, server-side)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?select=endpoint,keys_auth,keys_p256dh&updated_at=gte.${new Date(Date.now() - 30*24*60*60*1000).toISOString()}`, {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
        'Content-Type': 'application/json',
      },
    });

    const tokens = await res.json();
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return NextResponse.json({ sent: 0, message: 'Nenhum token ativo' });
    }

    let sent = 0;
    let failed = 0;
    const payload = JSON.stringify({ title, body, icon: '/logo.svg', url: url || '/' });

    for (const token of tokens) {
      try {
        const pushSubscription = {
          endpoint: token.endpoint,
          keys: {
            auth: token.keys_auth,
            p256dh: token.keys_p256dh,
          },
        };

        await webpush.sendNotification(pushSubscription as any, payload);
        sent++;
      } catch (err: any) {
        // Se token expirou (410/404), remover do banco
        if (err.statusCode === 410 || err.statusCode === 404) {
          await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?endpoint=eq.${encodeURIComponent(token.endpoint)}`, {
            method: 'DELETE',
            headers: {
              'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || '',
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
            },
          });
        }
        failed++;
      }
    }

    return NextResponse.json({ sent, failed, total: tokens.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
