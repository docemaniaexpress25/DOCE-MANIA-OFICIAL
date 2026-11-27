import { after } from 'next/server';
import { executarSyncBoletos, type ResumoSync } from '@/lib/boletosSyncCore';

/**
 * BLOCO 221 — AUTO-SYNC HORARIO (o dono pediu: "tem como dar o sync no cron
 * mais vezes por dia!").
 *
 * O cron da Vercel roda 1x por dia (plano Hobby so permite 1 invocacao diaria
 * por cron job). Este modulo MULTIPLICA a frequencia SEM depender do plano:
 *
 *   - Todo endpoint de admin que o dono usa no dia a dia (Log de Baixas,
 *     Baixa Automatica/conciliacao, painel do webhook, sino de avisos)
 *     chama `agendarAutoSyncBoletos()`.
 *   - Se a ultima rodada foi ha MAIS de 60 minutos, dispara o MESMO sync do
 *     cron via `after()` (roda depois que a resposta ja saiu — o endpoint
 *     nao fica mais lento).
 *   - Fila vazia = a rodada nao consulta o Inter (nao queima rate limit).
 *
 * Resultado pratico: o sync roda a CADA HORA enquanto o sistema esta em uso,
 * mais o cron diario da Vercel de madrugada e o webhook em tempo real. Com
 * o app aberto, o admin ve o aviso de baixa em minutos; se o callback do
 * Inter se perder, o auto-sync recupera no maximo em 1 hora.
 *
 * O throttle fica em globalThis (por instancia serverless). O sync e
 * IDEMPOTENTE (venda PAGO nunca rebaixa), portanto instancias em paralelo
 * nao causam baixa duplicada — no pior caso consultam o Inter duas vezes.
 */

const JANELA_MS = 60 * 60 * 1000; // 60 minutos entre rodadas

export function agendarAutoSyncBoletos(): void {
  try {
    const g = globalThis as unknown as { __dmAutoSyncUltimo?: number };
    const agora = Date.now();
    const ultimo = Number(g.__dmAutoSyncUltimo || 0);
    if (agora - ultimo < JANELA_MS) return; // dentro da janela de 60 min
    g.__dmAutoSyncUltimo = agora;

    // after() = roda APOS a resposta ter saido (Next 16, estavel). O endpoint
    // que chamou continua rapido; o sync acontece em segundo plano.
    after(async () => {
      try {
        const r: ResumoSync = await executarSyncBoletos();
        console.log('[auto-sync] rodada horaria:', r.motivo || `${r.processadas} consultada(s), ${r.baixadas} baixada(s)`);
      } catch (e: unknown) {
        console.warn('[auto-sync] falhou:', (e as Error)?.message);
      }
    });
  } catch (e: unknown) {
    console.warn('[auto-sync] agendamento falhou:', (e as Error)?.message);
  }
}
