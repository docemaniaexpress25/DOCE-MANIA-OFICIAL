import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { buildPixPayload, generateTxid, PIX_NAME, PIX_CITY } from '@/lib/pix';

/**
 * POST /api/cliente/[codigo]/pix
 * Body: { saleId: string }
 *
 * Portal do cliente: gera o BR Code (Pix Copia e Cola) para pagar
 * o saldo restante de uma venda pendente. O codigo vem com o valor
 * exato da divida embutido e um txid unico — sem digitar nada.
 *
 * Seguranca: o codigo na URL e o portal_code aleatorio do cliente;
 * a venda precisa pertencer a esse cliente.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;

  if (!codigo || codigo.length < 8) {
    return NextResponse.json({ error: 'Codigo invalido' }, { status: 400 });
  }
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Portal temporariamente indisponivel.' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const saleId = String(body?.saleId || '');
    if (!saleId) {
      return NextResponse.json({ error: 'Venda nao informada.' }, { status: 400 });
    }

    const supabase = getServiceClient();

    // 1. Cliente pelo portal_code (indice unico)
    const { data: client, error: findErr } = await supabase
      .from('clients')
      .select('id, nome_fantasia')
      .eq('portal_code', codigo.toUpperCase())
      .limit(1)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!client) return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 });

    // 2. Venda pendente do cliente
    const { data: sale, error: saleErr } = await supabase
      .from('sales')
      .select('id, client_id, valor_total, valor_pago, status_pagamento')
      .eq('id', saleId)
      .limit(1)
      .maybeSingle();
    if (saleErr) throw saleErr;
    if (!sale || sale.client_id !== client.id) {
      return NextResponse.json({ error: 'Venda nao encontrada para este cliente.' }, { status: 404 });
    }
    if (sale.status_pagamento !== 'PENDENTE') {
      return NextResponse.json({ error: 'Esta venda ja esta paga.' }, { status: 400 });
    }

    const restante = Math.round((Number(sale.valor_total || 0) - Number(sale.valor_pago || 0)) * 100) / 100;
    if (restante <= 0) {
      return NextResponse.json({ error: 'Nao ha saldo em aberto nesta venda.' }, { status: 400 });
    }

    // 3. BR Code com o valor exato da divida
    const txid = generateTxid();
    const pix = buildPixPayload(restante, txid);
    const qrDataUrl = await QRCode.toDataURL(pix.payload, {
      margin: 1,
      width: 360,
      errorCorrectionLevel: 'M',
    });

    return NextResponse.json({
      ...pix,
      qrDataUrl,
      cliente: client.nome_fantasia,
      saleId: sale.id,
    });
  } catch (e: any) {
    console.error('[api/cliente/pix] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao gerar o Pix. Tente novamente.' }, { status: 500 });
  }
}
