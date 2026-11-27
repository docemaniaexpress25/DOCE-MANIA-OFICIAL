import { NextRequest, NextResponse } from 'next/server';
import { sessionFromRequest } from '@/lib/session';
// BLOCO 221: a logica do sync migrou para lib/boletosSyncCore — a mesma
// rodada agora e usada pelo cron da Vercel, pelo botao "Sincronizar agora"
// e pelo AUTO-SYNC horario (lib/autoSync).

/**
 * BLOCO 145 — SINCRONIZACAO AUTOMATICA DE BOLETOS (cron da Vercel).
 * BLOCO 221 — agora tambem acionado pelo auto-sync horario do app.
 *
 * GET /api/boletos-sync  (sem sessao!)
 *   Autorizacao (BLOCO 222):
 *   a) header `Authorization: Bearer ${CRON_SECRET}` — a Vercel Cron envia
 *      esse header automaticamente QUANDO a env CRON_SECRET existe;
 *   b) header `x-vercel-cron: 1` — a Vercel SEMPRE marca as invocacoes do
 *      proprio cron com esse header, mesmo sem CRON_SECRET configurada.
 *      Sem isso, se o dono nao criou a CRON_SECRET, o cron tomava 401 e o
 *      sync NUNCA rodava (boletos travados em EM_PROCESSAMENTO para sempre,
 *      com webhook_logs vazia — diagnosticado em producao).
 *      Seguranca: o endpoint e idempotente e so reconsulta cobrancas do
 *      PROPRIO Inter, portanto um header forjado no maximo causa uma
 *      sincronizacao extra — sem risco de baixa duplicada.
 *   c) ADMIN logado tambem pode chamar ("sincronizar agora").
 *
 * VARRE: sales com inter_boleto_status IN (EM_PROCESSAMENTO, A_RECEBER,
 * ATRASADO) — max 15 por rodada (rate limit do Inter respeitado; endpoint
 * de token aceita 5 req/min). Para cada uma:
 *   - reconsulta a cobranca na API do Inter (verdade na fonte);
 *   - espelha status/linha/pix/erro na venda;
 *   - A_RECEBER com vencimento passado vira ATRASADO;
 *   - RECEBIDO + venda não PAGO = BAIXA (valor_pago = total, PAGO, log no
 *     detalhe + comissão A_RECEBER -> DISPONIVEL + aviso aos admins).
 * Degradacao graciosa total: colunas ausentes ou Inter nao configurado =
 * no-op ok. Idempotente (venda PAGO nunca rebaixa).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET || '';
  const viaCronSecret = !!secret && auth === `Bearer ${secret}`;
  // BLOCO 222: o cron da Vercel SEMPRE envia x-vercel-cron — autoriza mesmo
  // sem CRON_SECRET (causa raiz do sync que nunca rodou em producao).
  const viaCronHeader = req.headers.get('x-vercel-cron') === '1';
  const session = sessionFromRequest(req);
  const viaAdmin = session?.perfil === 'ADMIN';
  if (!viaCronSecret && !viaCronHeader && !viaAdmin) {
    return NextResponse.json({ ok: false, erro: 'Nao autorizado (cron ou admin).' }, { status: 401 });
  }

  // BLOCO 221: o corpo do sync vive em lib/boletosSyncCore (executarSyncBoletos).
  const { executarSyncBoletos } = await import('@/lib/boletosSyncCore');
  const r = await executarSyncBoletos();
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
