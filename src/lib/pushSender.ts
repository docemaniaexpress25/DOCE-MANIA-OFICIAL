import webpush from 'web-push';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';

/**
 * Envia push notification para todos os dispositivos registrados
 * (tabela push_tokens). Usado por /api/send-push e pelas rotas
 * que precisam avisar o admin (ex.: comprovante do portal).
 */

const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
}

export async function sendPushToAll(msg: PushMessage): Promise<{ sent: number; failed: number }> {
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY || !isServerSupabaseConfigured()) {
    return { sent: 0, failed: 0 };
  }

  try {
    webpush.setVapidDetails('mailto:contato@docemania.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const supabase = getServiceClient();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('endpoint, keys_auth, keys_p256dh')
      .gte('updated_at', since);

    return await enviarParaTokens(supabase, tokens || [], payloadDe(msg));
  } catch (err: any) {
    console.error('[pushSender] erro:', err?.message);
    return { sent: 0, failed: 0 };
  }
}

/**
 * Bloco 14: push direcionado a UM usuário (ex.: avisar o vendedor da venda
 * quando a entrega é confirmada). Só alcança tokens registrados com user_id
 * (o app grava o usuário no login).
 */
export async function sendPushToUser(userId: string, msg: PushMessage): Promise<{ sent: number; failed: number }> {
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY || !isServerSupabaseConfigured() || !userId) {
    return { sent: 0, failed: 0 };
  }

  try {
    webpush.setVapidDetails('mailto:contato@docemania.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const supabase = getServiceClient();
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('endpoint, keys_auth, keys_p256dh')
      .eq('user_id', userId)
      .gte('updated_at', since);

    if (!tokens || tokens.length === 0) return { sent: 0, failed: 0 };
    return await enviarParaTokens(supabase, tokens, payloadDe(msg));
  } catch (err: any) {
    console.error('[pushSender][user] erro:', err?.message);
    return { sent: 0, failed: 0 };
  }
}

function payloadDe(msg: PushMessage): string {
  return JSON.stringify({ title: msg.title, body: msg.body, icon: '/logo.svg', url: msg.url || '/' });
}

async function enviarParaTokens(supabase: any, tokens: any[], payload: string): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const token of tokens) {
    try {
      const subscription = {
        endpoint: token.endpoint,
        keys: { auth: token.keys_auth, p256dh: token.keys_p256dh },
      };
      await webpush.sendNotification(subscription as any, payload);
      sent++;
    } catch (err: any) {
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await supabase.from('push_tokens').delete().eq('endpoint', token.endpoint);
      }
      failed++;
    }
  }

  return { sent, failed };
}
