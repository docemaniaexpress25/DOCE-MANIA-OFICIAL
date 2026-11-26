import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasBoletoColumns } from '@/lib/serverSchema';
import { isInterConfigured, consultarWebhookInter } from '@/lib/interBoleto';

/**
 * BLOCO 220 — PAINEL DA BAIXA AUTOMATICA (admin/secretario).
 *
 * Responde, numa unica chamada, tudo que o admin precisa para VER onde/como a
 * baixa de boletos acontece e se a automacao esta saudavel:
 *
 *   GET /api/webhooks/inter-painel
 *   -> {
 *        ok, configurado,                       credenciais INTER_* no ambiente
 *        webhook:  { cadastrado, url, criacao, atualizacao, erro, semCredenciais },
 *        filaAberta: n,                         boletos em aberto monitorados pelo sync
 *        ultimoSync: { em, resultado } | null,  ultimo evento origem CRON (webhook_logs)
 *        frequencia: { webhook: texto, sync: texto }  (cron da Vercel, vercel.json)
 *      }
 *
 * Fontes: API do Inter (GET /cobranca/v3/cobrancas/webhook — estado REAL do
 * cadastro, mTLS) + webhook_logs (SQL 167) + sales. Degradacao graciosa:
 * tabela/colunas ausentes nao quebram o painel.
 */

const STATUS_ABERTOS = ['EM_PROCESSAMENTO', 'A_RECEBER', 'ATRASADO'];

export async function GET(req: NextRequest) {
  // BLOCO 220: ponte de dev (Bloco 12) — no preview sem service key, repassa
  // para a producao (que tem credenciais do Inter) e o painel funciona 100%.
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (session.perfil !== 'ADMIN' && session.perfil !== 'SECRETARIO') {
    return NextResponse.json({ ok: false, error: 'Somente admin/secretario veem o painel da automacao.' }, { status: 403 });
  }

  const db = getServiceClient();

  // 1. Estado REAL do webhook no Inter (consulta mTLS — 404 = nunca cadastrado)
  const webhook = await consultarWebhookInter();

  // 2. Quantos boletos em aberto o sync monitora (fila do boletos-sync)
  let filaAberta: number | null = null;
  if (await hasBoletoColumns()) {
    try {
      const { count, error } = await db
        .from('sales')
        .select('id', { count: 'exact', head: true })
        .in('inter_boleto_status', STATUS_ABERTOS);
      if (!error) filaAberta = count ?? 0;
    } catch { /* schema antigo — painel segue */ }
  }

  // 3. Ultima execucao do sync diario (origem CRON no log de eventos)
  let ultimoSync: { em: string; resultado: string; processado: boolean } | null = null;
  try {
    const { data } = await db
      .from('webhook_logs')
      .select('criado_em, resultado, processado')
      .eq('origem', 'CRON')
      .order('criado_em', { ascending: false })
      .limit(1);
    const row = (data || [])[0] as Record<string, unknown> | undefined;
    if (row) {
      ultimoSync = {
        em: String(row.criado_em || ''),
        resultado: String(row.resultado || ''),
        processado: !!row.processado,
      };
    }
  } catch { /* SQL 167 pendente — painel segue */ }

  return NextResponse.json({
    ok: true,
    configurado: isInterConfigured(),
    webhook,
    filaAberta,
    ultimoSync,
    // BLOCO 220: frequencias reais — webhook = tempo real; sync = cron Vercel
    // (vercel.json: "0 10 * * *" = 10h UTC = 07h Brasilia) + botao manual.
    frequencia: {
      webhook: 'Tempo real — o Inter avisa o app na hora do pagamento (retries em 20/30/60/120 min se falhar)',
      sync: 'Rede de seguranca: 1x por dia as 07h (Brasilia) via cron da Vercel + botao "Sincronizar agora"',
    },
  });
}
