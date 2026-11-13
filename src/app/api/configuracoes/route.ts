import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { lerErpConfig, salvarErpConfig, fonteEmitente, ErpConfig } from '@/lib/erpConfig';
import {
  isFocusConfigured,
  getFocusConfig,
  listarWebhooksFocus,
  criarWebhookFocus,
  excluirWebhookFocus,
  FocusNotaResultado,
} from '@/lib/focusNfe';
import { isInterConfigured } from '@/lib/interBoleto';

/**
 * BLOCO 108 — CONFIGURACOES ERP (tela "ERP Fiscal & Automações").
 *
 * GET  /api/configuracoes  [ADMIN]
 *      -> status de tudo (Focus/Inter configurados?) + erp_config (switches
 *         + emitente) + URL do webhook do Inter p/ cadastrar no banco
 *         + BLOCO 116: status do webhook da Focus (gatilho event=nfe, criado
 *         pela própria API /v2/hooks — atualizacao de status em tempo real).
 *
 * POST /api/configuracoes  [ADMIN]
 *      { nfeAutoPe?, cupomDuploNfc?, boletoAutoAReceber?, emitente? {...} }
 *      -> merge no app_settings.erp_config (jsonb). Emitente gravado aqui
 *         SOBRESCREVE as env vars no payload da Focus (sem deploy).
 *
 *      { acao: 'INSTALAR_WEBHOOK' }  -> cria o gatilho na Focus (POST /v2/hooks,
 *         event 'nfe') apontando para /api/focus/webhook com o segredo de
 *         FOCUS_WEBHOOK_SECRET (fallback CRON_SECRET). Idempotente.
 *      { acao: 'REMOVER_WEBHOOK' }   -> exclui o gatilho criado pelo app.
 *
 * Pix chave: segue no card proprio do AdminDashboard (app_settings.pix_chave_entrega).
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });

const WEBHOOK_PATH = '/api/focus/webhook';

/** Hook do app (event 'nfe' apontando p/ /api/focus/webhook) — null se nao existe. */
function hookDoApp(hooks: FocusNotaResultado[]): FocusNotaResultado | null {
  return (
    hooks.find(
      (h) => String(h.event || '') === 'nfe' && String(h.url || '').includes(WEBHOOK_PATH)
    ) || null
  );
}

/** Segredo usado na instalacao do webhook (mesma fonte validada no handler). */
function segredoWebhook(): string {
  return process.env.FOCUS_WEBHOOK_SECRET || process.env.CRON_SECRET || '';
}

export async function GET(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');
  if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin acessa as configuracoes ERP.');

  const db = getServiceClient();
  const erp = await lerErpConfig(db);
  const fonte = await fonteEmitente(db);
  const cfgFocus = getFocusConfig();

  const origin = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  // BLOCO 116: gatilho de status na Focus (se token configurado, pergunta la)
  let focoWebhook: { url: string; instalado: boolean; id: string; segredoConfigurado: boolean; erro: string } = {
    url: `${origin}${WEBHOOK_PATH}`,
    instalado: false,
    id: '',
    segredoConfigurado: !!segredoWebhook(),
    erro: '',
  };
  if (isFocusConfigured()) {
    const lista = await listarWebhooksFocus();
    if (lista.ok && Array.isArray(lista.data)) {
      const meu = hookDoApp(lista.data as FocusNotaResultado[]);
      if (meu) {
        focoWebhook.instalado = true;
        focoWebhook.id = String(meu.id || '');
        focoWebhook.url = String(meu.url || focoWebhook.url);
      }
    } else {
      focoWebhook.erro =
        'erro' in lista.data ? String((lista.data as { erro?: string }).erro || 'Falha ao listar gatilhos') : 'Falha ao listar gatilhos';
    }
  }

  return NextResponse.json({
    ok: true,
    fiscal: {
      focusConfigurado: isFocusConfigured(),
      ambiente: cfgFocus.ambiente,
      emitente: erp.emitente,
      emitenteFonte: fonte,
    },
    focoWebhook,
    boleto: {
      interConfigurado: isInterConfigured(),
      autoBoletoAReceber: erp.boletoAutoAReceber,
      webhookUrl: `${origin}/api/webhooks/inter`,
    },
    geral: {
      nfeAutoPe: erp.nfeAutoPe,
      cupomDuploNfc: erp.cupomDuploNfc,
    },
  });
}

export async function POST(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');
  if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin altera as configuracoes ERP.');

  const body = await req.json().catch(() => ({}));

  // ---------- BLOCO 116: webhook da Focus (tempo real) ----------
  if (body.acao === 'INSTALAR_WEBHOOK' || body.acao === 'REMOVER_WEBHOOK') {
    if (!isFocusConfigured()) return BAD(503, 'Focus NFe nao configurada (env FOCUS_NFE_TOKEN na Vercel).');
    const origin2 = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

    const lista = await listarWebhooksFocus();
    if (!lista.ok || !Array.isArray(lista.data)) {
      const erro = 'erro' in lista.data ? String((lista.data as { erro?: string }).erro) : `HTTP ${lista.status}`;
      return BAD(502, `Falha ao listar gatilhos na Focus: ${erro}`);
    }
    const meu = hookDoApp(lista.data as FocusNotaResultado[]);

    if (body.acao === 'REMOVER_WEBHOOK') {
      if (!meu) return NextResponse.json({ ok: true, jaRemovido: true });
      if (!meu.id) return BAD(422, 'Gatilho sem id para excluir.');
      const del = await excluirWebhookFocus(String(meu.id));
      if (!del.ok || 'erro' in del.data) {
        const erro = 'erro' in del.data ? String((del.data as { erro?: string }).erro) : `HTTP ${del.status}`;
        return BAD(502, `Focus recusou a exclusao do gatilho: ${erro}`);
      }
      return NextResponse.json({ ok: true, removido: true });
    }

    // INSTALAR_WEBHOOK
    if (meu) {
      return NextResponse.json({
        ok: true,
        jaInstalado: true,
        hook: { id: String(meu.id || ''), url: String(meu.url || '') },
      });
    }
    const segredo = segredoWebhook();
    if (!segredo) {
      return BAD(503, 'Defina FOCUS_WEBHOOK_SECRET (ou CRON_SECRET) na Vercel antes de instalar o webhook.');
    }
    const cnpjEmit = String(process.env.FOCUS_NFE_CNPJ || '').replace(/\D/g, '');
    const r = await criarWebhookFocus({
      url: `${origin2}${WEBHOOK_PATH}`,
      segredo,
      authorizationHeader: 'x-dm-token',
      cnpj: cnpjEmit,
    });
    if (!r.ok || !r.data || 'erro' in r.data) {
      const erro =
        'erro' in r.data ? String((r.data as { erro?: string }).erro) : `HTTP ${r.status}`;
      return BAD(502, `Focus recusou a criacao do webhook: ${erro}`);
    }
    return NextResponse.json({
      ok: true,
      hook: { id: String(r.data.id || ''), url: String(r.data.url || `${origin2}${WEBHOOK_PATH}`) },
    });
  }

  const parcial: Partial<ErpConfig> = {};
  if (typeof body.nfeAutoPe === 'boolean') parcial.nfeAutoPe = body.nfeAutoPe;
  if (typeof body.cupomDuploNfc === 'boolean') parcial.cupomDuploNfc = body.cupomDuploNfc;
  if (typeof body.boletoAutoAReceber === 'boolean') parcial.boletoAutoAReceber = body.boletoAutoAReceber;
  if (body.emitente && typeof body.emitente === 'object') {
    const e = body.emitente as Record<string, unknown>;
    const cnpj = String(e.cnpj || '').replace(/\D/g, '');
    if (cnpj && cnpj.length !== 14) return BAD(422, 'CNPJ do emitente deve ter 14 digitos.');
    parcial.emitente = e as unknown as ErpConfig['emitente'];
  }
  if (Object.keys(parcial).length === 0) return BAD(400, 'Nada para salvar.');

  const r = await salvarErpConfig(parcial);
  if (!r.ok) return BAD(500, `Falha ao salvar: ${r.erro}`);

  return NextResponse.json({ ok: true, config: r.config });
}
