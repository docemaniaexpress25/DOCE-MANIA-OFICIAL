import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest, isAdminSession } from '@/lib/session';

/**
 * BLOCO 13: POST /api/sales/trocas  { saleId, trocas }
 * Salva a anotacao de TROCAS do vendedor numa venda (impressa no cupom).
 * - Vendedor: somente na propria venda, e enquanto nao foi entregue/faturada.
 * - Admin: qualquer venda.
 * Coluna sales.trocas (Bloco 13). Se o SQL nao rodou, responde 503 claro.
 */
export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });

  try {
    const body = await req.json();
    const saleId = String(body.saleId || '');
    const trocas = String(body.trocas || '').trim().slice(0, 500) || null;
    if (!saleId) return NextResponse.json({ ok: false, error: 'saleId obrigatorio.' }, { status: 400 });

    const admin = isAdminSession(req);
    const supabase = getServiceClient();
    const { data: sale } = await supabase.from('sales').select('id, vendedor_id, entrega_status').eq('id', saleId).maybeSingle();
    if (!sale) return NextResponse.json({ ok: false, error: 'Venda nao encontrada.' }, { status: 404 });
    if (!admin && sale.vendedor_id !== session.sub) {
      return NextResponse.json({ ok: false, error: 'Venda nao e sua.' }, { status: 403 });
    }
    if (sale.entrega_status === 'ENTREGUE') {
      return NextResponse.json({ ok: false, error: 'Pedido ja entregue — troca nao pode mais mudar.' }, { status: 409 });
    }

    const { error } = await supabase.from('sales').update({ trocas }).eq('id', saleId);
    if (error) {
      if (/trocas/i.test(error.message || '')) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 13 do SQL (coluna trocas).' }, { status: 503 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[api/sales/trocas] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro ao salvar as trocas.' }, { status: 500 });
  }
}
