import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { lerErpConfig, salvarErpConfig, fonteEmitente, ErpConfig } from '@/lib/erpConfig';
import { isFocusConfigured, getFocusConfig } from '@/lib/focusNfe';
import { isInterConfigured } from '@/lib/interBoleto';

/**
 * BLOCO 108 — CONFIGURACOES ERP (tela "ERP Fiscal & Automações").
 *
 * GET  /api/configuracoes  [ADMIN]
 *      -> status de tudo (Focus/Inter configurados?) + erp_config (switches
 *         + emitente) + URL do webhook do Inter p/ cadastrar no banco.
 *
 * POST /api/configuracoes  [ADMIN]
 *      { nfeAutoPe?, cupomDuploNfc?, boletoAutoAReceber?, emitente? {...} }
 *      -> merge no app_settings.erp_config (jsonb). Emitente gravado aqui
 *         SOBRESCREVE as env vars no payload da Focus (sem deploy).
 *
 * Pix chave: segue no card proprio do AdminDashboard (app_settings.pix_chave_entrega).
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });

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

  return NextResponse.json({
    ok: true,
    fiscal: {
      focusConfigurado: isFocusConfigured(),
      ambiente: cfgFocus.ambiente,
      emitente: erp.emitente,
      emitenteFonte: fonte,
    },
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
