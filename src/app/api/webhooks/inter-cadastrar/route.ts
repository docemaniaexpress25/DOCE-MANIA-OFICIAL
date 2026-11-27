import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { cadastrarWebhookInter, consultarWebhookInter, excluirWebhookInter, type WebhookInterEstado } from '@/lib/interBoleto';

/**
 * BLOCO 220 — CADASTRO DO WEBHOOK DIRETO NA API DO INTER (só admin).
 *
 * A resposta ao problema do dono: "não acho a função no Internet Banking".
 * Ela NÃO EXISTE — a doc oficial do Inter ("Como configurar um webhook?") manda
 * criar o webhook PELA API da Cobrança V3 (PUT /cobranca/v3/cobrancas/webhook,
 * escopo boleto-cobranca.write + certificado mTLS da aplicação). Este endpoint
 * faz isso sozinho usando as credenciais INTER_* já configuradas na Vercel:
 *
 *   POST /api/webhooks/inter-cadastrar
 *   body: { acao: 'CADASTRAR', url: 'https://<app>/api/webhooks/inter' }
 *       | { acao: 'EXCLUIR' }
 *   -> { ok, acao, webhook: WebhookInterEstado }
 *
 * Cada ação é auditada em webhook_logs (origem 'CONFIG').
 */

async function logAcao(
  db: ReturnType<typeof getServiceClient>,
  e: { acao: string; resultado: string; processado: boolean }
) {
  try {
    const { error } = await db.from('webhook_logs').insert({
      origem: 'CONFIG',
      evento: { fonte: 'inter-cadastrar', acao: e.acao } as any,
      resultado: (e.resultado || '').slice(0, 300),
      processado: e.processado,
    });
    if (error) console.warn('[inter-cadastrar] log nao persistido:', error.message);
  } catch (err: any) {
    // SQL 167 pendente — a acao principal nao depende do log
    console.warn('[inter-cadastrar] log nao persistido:', err?.message);
  }
}

export async function POST(req: NextRequest) {
  // BLOCO 220: ponte de dev (Bloco 12) — o preview local tambem cadastra no
  // Inter de verdade (o backend de producao tem o certificado mTLS).
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (session.perfil !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Somente admin gerencia o webhook do Inter.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const acao = String(body.acao || '').toUpperCase();
  const url = String(body.url || '').trim();
  const db = getServiceClient();

  if (acao !== 'CADASTRAR' && acao !== 'EXCLUIR') {
    return NextResponse.json({ ok: false, error: 'Acao invalida (CADASTRAR ou EXCLUIR).' }, { status: 400 });
  }

  let estado: WebhookInterEstado | null = null;
  if (acao === 'CADASTRAR') {
    if (!url) {
      return NextResponse.json({ ok: false, error: 'Informe a URL do webhook (ex.: https://sistema-doce-mania1.vercel.app/api/webhooks/inter).' }, { status: 400 });
    }
    estado = await cadastrarWebhookInter(url);
    await logAcao(db, {
      acao,
      resultado: estado.ok && estado.cadastrado
        ? `Webhook cadastrado no Inter: ${estado.url || url}`
        : `FALHA ao cadastrar webhook (${url}): ${estado.erro}`,
      processado: estado.ok && estado.cadastrado,
    });
    if (!estado.ok || !estado.cadastrado) {
      return NextResponse.json({
        ok: false,
        error: estado.erro || 'O Inter recusou o cadastro do webhook.',
        webhook: estado,
      }, { status: 502 });
    }
  } else {
    const r = await excluirWebhookInter();
    await logAcao(db, {
      acao,
      resultado: r.ok ? 'Webhook removido do Inter' : `FALHA ao remover webhook: ${r.erro}`,
      processado: r.ok,
    });
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: r.erro || 'Falha ao remover o webhook.' }, { status: 502 });
    }
    estado = await consultarWebhookInter();
  }

  return NextResponse.json({ ok: true, acao, webhook: estado });
}
