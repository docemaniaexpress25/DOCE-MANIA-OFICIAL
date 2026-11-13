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
  HOOKS_DO_APP,
  isEventoDoApp,
  FocusHookEvent,
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

/**
 * BLOCO 117: todos os gatilhos do app (url = /api/focus/webhook, evento entre
 * nfe / nfce / nfce_contingencia — doc docs/webhooks: cada gatilho monitora
 * UM evento, por isso sao TRES apontando para a mesma URL).
 */
function hooksDoApp(hooks: FocusNotaResultado[]): FocusNotaResultado[] {
  return hooks.filter(
    (h) => isEventoDoApp(h.event) && String(h.url || '').includes(WEBHOOK_PATH)
  );
}

/** Eventos ja instalados (so os que estao no HOOKS_DO_APP). */
function eventosInstalados(hooks: FocusNotaResultado[]): string[] {
  return hooksDoApp(hooks)
    .map((h) => String(h.event || ''))
    .filter((e, i, arr) => (HOOKS_DO_APP as readonly string[]).includes(e) && arr.indexOf(e) === i);
}

/** CNPJ do emitente no gatilho: app_settings SOBRESCREVE env (igual no payload). */
async function cnpjDoGatilho(): Promise<string> {
  const { lerErpConfig } = await import('@/lib/erpConfig');
  const erp = await lerErpConfig();
  return (erp.emitente.cnpj || process.env.FOCUS_NFE_CNPJ || '').replace(/\D/g, '');
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

  // BLOCO 116/117: gatilhos de status na Focus (se token configurado, pergunta la)
  let focoWebhook: { url: string; instalado: boolean; id: string; eventos: string[]; segredoConfigurado: boolean; erro: string } = {
    url: `${origin}${WEBHOOK_PATH}`,
    instalado: false,
    id: '',
    eventos: [],
    segredoConfigurado: !!segredoWebhook(),
    erro: '',
  };
  if (isFocusConfigured()) {
    const lista = await listarWebhooksFocus();
    if (lista.ok && Array.isArray(lista.data)) {
      const meus = hooksDoApp(lista.data as FocusNotaResultado[]);
      if (meus.length > 0) {
        focoWebhook.instalado = true;
        focoWebhook.id = String(meus[0].id || '');
        focoWebhook.url = String(meus[0].url || focoWebhook.url);
        focoWebhook.eventos = eventosInstalados(lista.data as FocusNotaResultado[]);
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
    const meus = hooksDoApp(lista.data as FocusNotaResultado[]);

    if (body.acao === 'REMOVER_WEBHOOK') {
      if (meus.length === 0) return NextResponse.json({ ok: true, jaRemovido: true });
      let removidos = 0;
      let falha = '';
      for (const h of meus) {
        if (!h.id) continue;
        const del = await excluirWebhookFocus(String(h.id));
        if (!del.ok || 'erro' in del.data) {
          falha = 'erro' in del.data ? String((del.data as { erro?: string }).erro) : `HTTP ${del.status}`;
        } else removidos++;
      }
      if (removidos === 0 && falha) return BAD(502, `Focus recusou a exclusao do gatilho: ${falha}`);
      return NextResponse.json({ ok: true, removidos, removido: true });
    }

    // INSTALAR_WEBHOOK — BLOCO 117: garante os TRES eventos (idempotente).
    // Ja instalados ficam de pe; so cria os que faltam (doc docs/webhooks).
    const segredo = segredoWebhook();
    if (!segredo) {
      return BAD(503, 'Defina FOCUS_WEBHOOK_SECRET (ou CRON_SECRET) na Vercel antes de instalar o webhook.');
    }
    const cnpjEmit = await cnpjDoGatilho();
    const jaTemos = new Set(meus.map((h) => String(h.event || '')));
    const faltam = (HOOKS_DO_APP as readonly string[]).filter((ev) => !jaTemos.has(ev));
    const criados: string[] = [];
    const falhas: string[] = [];
    for (const ev of faltam) {
      const r = await criarWebhookFocus({
        url: `${origin2}${WEBHOOK_PATH}`,
        segredo,
        authorizationHeader: 'x-dm-token',
        cnpj: cnpjEmit,
        event: ev as FocusHookEvent,
      });
      if (!r.ok || !r.data || 'erro' in r.data) {
        const erro = 'erro' in r.data ? String((r.data as { erro?: string }).erro) : `HTTP ${r.status}`;
        falhas.push(`${ev}: ${erro}`);
      } else criados.push(ev);
    }
    if (criados.length === 0 && falhas.length > 0 && meus.length === 0) {
      return BAD(502, `Focus recusou a criacao do webhook: ${falhas.join('; ')}`);
    }
    return NextResponse.json({
      ok: criados.length > 0 || meus.length > 0,
      jaInstalado: meus.length > 0,
      criados,
      eventos: [...new Set([...meus.map((h) => String(h.event || '')), ...criados])],
      falhas,
      hook: meus.length > 0
        ? { id: String(meus[0].id || ''), url: String(meus[0].url || '') }
        : { id: '', url: `${origin2}${WEBHOOK_PATH}` },
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
