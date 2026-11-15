import { NextRequest, NextResponse } from 'next/server';
import { devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { lerErpConfig } from '@/lib/erpConfig';

/**
 * BLOCO 125 — QR DO CATALOGO DO CLIENTE NO CUPOM (flag de leitura GLOBAL).
 *
 * O switch vive no hub "ERP Fiscal & Automações" (POST /api/configuracoes,
 * ADMIN-only, gravado em app_settings.erp_config.qrCatalogoNoCupom).
 * MAS o cupom é impresso por vendedor, entregador, secretario e admin —
 * por isso a LEITURA do flag precisa aceitar qualquer sessão válida.
 * Esta rota devolve SOMENTE o flag (nada de emitente/fiscal, que segue
 * exclusivo do admin na rota pai).
 *
 * GET /api/configuracoes/qr-catalogo  [qualquer sessão]
 *      -> { ok: true, ativo: boolean }   (default LIGADO — regra do dono)
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });

export async function GET(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');

  const erp = await lerErpConfig();
  return NextResponse.json({ ok: true, ativo: erp.qrCatalogoNoCupom !== false });
}
