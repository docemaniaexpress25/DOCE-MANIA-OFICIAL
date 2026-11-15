import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { buildPixPayload, generateTxid, lerChavePixEntrega } from '@/lib/pix';

/**
 * BLOCO 100 (regra do dono): GET /api/pix/venda?valor=123.45
 *
 * Gera o BR Code "Pix Copia e Cola" COM O VALOR DA VENDA para o PDV da
 * pronta entrega. O QR e atrelado a CHAVE PIX configurada pelo admin em
 * Configurações (app_settings.pix_chave_entrega) — sem chave válida gravada,
 * cai no padrão do env (PIX_KEY / CPF do dono). O cliente escaneia e o valor
 * já vem preenchido no app do banco — sem digitação.
 *
 * Sessão obrigatória (vendedor/entregador/admin do app).
 */
export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });

  try {
    const valor = Math.round((Number(req.nextUrl.searchParams.get('valor')) || 0) * 100) / 100;
    if (!(valor > 0)) {
      return NextResponse.json({ ok: false, error: 'Valor invalido para o Pix.' }, { status: 400 });
    }

    const supabase = getServiceClient();
    // BLOCO 62/100: chave do recebimento gravada nas Configurações
    const chaveEntrega = await lerChavePixEntrega(supabase);
    const pix = buildPixPayload(valor, generateTxid('PDV'), chaveEntrega);
    const qrDataUrl = await QRCode.toDataURL(pix.payload, {
      margin: 1,
      width: 360,
      errorCorrectionLevel: 'M',
    });

    return NextResponse.json({
      ok: true,
      ...pix,
      qrDataUrl,
      // sinaliza quando NAO ha chave configurada (esta usando o padrao do env)
      chavePadrao: !chaveEntrega,
    });
  } catch (e: any) {
    console.error('[api/pix/venda] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro ao gerar o Pix. Tente novamente.' }, { status: 500 });
  }
}
