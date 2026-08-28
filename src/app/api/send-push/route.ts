import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';

const VAPID_PRIVATE_KEY = 'AMC5odbxYgKB0wl9XEAeYZTg_C35CM4rMq__NEUmwv0';
const VAPID_PUBLIC_KEY = 'BK6v9AgRkhRVvHVeU8qpORoMybYJ41KHxhpluV2PIG-awhUIJxcMBOhnGNzNEhKPo_VNl6YrdQPa3DcOmvYAh60';

webpush.setVapidDetails(
  'mailto:contato@docemania.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Variavel de ambiente com a URL do Supabase (server-side)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://eyjhqjrczzpfthsddlpg.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * POST /api/send-push
 * Body: { title: string, body: string, url?: string }
 * Busca tokens no Supabase e envia push para todos dispositivos
 */
export async function POST(req: NextRequest) {
  try {
    const { title, body, url } = await req.json();
    if (!title || !body) {
      return NextResponse.json({ error: 'title e body obrigatorios' }, { status: 400 });
    }

    // Buscar tokens ativos no Supabase
    const res = await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?select=endpoint,keys_auth,keys_p256dh&updated_at=gte.${new Date(Date.now() - 30*24*60*60*1000).toISOString()}`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY || '',
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
            headers: { 'apikey': SUPABASE_ANON_KEY || '' },
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
