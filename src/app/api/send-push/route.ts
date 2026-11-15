import { NextRequest, NextResponse } from 'next/server';
import { sendPushToAll } from '@/lib/pushSender';

/**
 * POST /api/send-push
 * Body: { title: string, body: string, url?: string }
 * Envia push para todos os dispositivos registrados (push_tokens).
 */
export async function POST(req: NextRequest) {
  try {
    const { title, body, url } = await req.json();
    if (!title || !body) {
      return NextResponse.json({ error: 'title e body obrigatorios' }, { status: 400 });
    }

    const result = await sendPushToAll({ title, body, url });
    if (result.sent === 0 && result.failed === 0) {
      return NextResponse.json({ sent: 0, message: 'Push nao configurado ou nenhum token ativo' });
    }
    return NextResponse.json({ sent: result.sent, failed: result.failed });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
