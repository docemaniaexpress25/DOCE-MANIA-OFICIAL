import { NextRequest } from 'next/server';

/**
 * BLOCO 222 — SLOT 2 DO CRON DE BOLETOS (sync mais vezes por dia!).
 *
 * O plano Hobby da Vercel so permite cron 1x por dia POR JOB — mas permite
 * VARIOS jobs, cada um com um path e horario proprios. Esta rota e um
 * apelido do /api/boletos-sync (mesma autorizacao: x-vercel-cron,
 * Bearer CRON_SECRET ou admin logado; mesmo corpo em lib/boletosSyncCore).
 *
 * Horario (vercel.json): 16:00 UTC = 13:00 em Sao Paulo.
 */
export async function GET(req: NextRequest) {
  const { GET: sync } = await import('../route');
  return sync(req);
}
