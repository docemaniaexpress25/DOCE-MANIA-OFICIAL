import { NextRequest } from 'next/server';

/**
 * BLOCO 222 — SLOT 3 DO CRON DE BOLETOS (sync mais vezes por dia!).
 *
 * Terceira execucao diaria do sync de boletos (veja slot2). Reaproveita a
 * rota /api/boletos-sync inteira (mesma autorizacao x-vercel-cron /
 * CRON_SECRET / admin, mesmo corpo em lib/boletosSyncCore).
 *
 * Horario (vercel.json): 22:00 UTC = 19:00 em Sao Paulo.
 */
export async function GET(req: NextRequest) {
  const { GET: sync } = await import('../route');
  return sync(req);
}
