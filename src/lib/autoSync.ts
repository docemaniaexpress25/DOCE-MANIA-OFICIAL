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
 * BLOCO 231 — POR QUE ESTE AUTO-SYNC FICOU PESADO (e o GERAR do dono ficou
 * lento): os blocos 226/228 acrescentaram órfãos e a varredura de vendas
 * excluídas (coleção de cobranças — a chamada mais pesada da API do Inter)
 * a TODA rodada. De hora em hora o sync virava uma maratona de chamadas que
 * disputava o GERAR na tela (caso real 27/11 13:07: cron das 13:00 + GERAR
 * das 13:07 = 3 minutos de "Gerando no Inter..."). Agora o auto-sync roda a
 * rodada LEVE (só boletos/parcelas, fatias pequenas e rotativas, cedendo a
 * vez à emissão) e a varredura pesada ficou no cron 3x/dia + botão do admin.
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
        // BLOCO 231: sem opts.pesada = rodada LEVE (fila curta/rotativa,
        // sem órfãos/varredura de excluídas, cedendo ao GERAR do dono).
        const r: ResumoSync = await executarSyncBoletos();
        console.log('[auto-sync] rodada horaria:', r.motivo || `${r.processadas} consultada(s), ${r.baixadas} baixada(s) em ${r.duracaoMs ?? 0}ms`);
      } catch (e: unknown) {
        console.warn('[auto-sync] falhou:', (e as Error)?.message);
      }
    });
  } catch (e: unknown) {
    console.warn('[auto-sync] agendamento falhou:', (e as Error)?.message);
  }
}
