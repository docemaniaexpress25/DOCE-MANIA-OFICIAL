import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { sessionFromRequest, isAdminSession } from '@/lib/session';
import { hasBoletoFotoColumn } from '@/lib/serverSchema';

/**
 * GET /api/pre-venda/foto?saleId=...
 * Devolve a foto do boleto entregue (base64) de um pedido de pre-venda.
 * Acesso: dono da rota ou admin. A foto vem sob demanda (fora da listagem)
 * para nao estourar o payload.
 */
export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Sessao expirada. Entre novamente.' }, { status: 401 });

  try {
    const saleId = new URL(req.url).searchParams.get('saleId') || '';
    if (!saleId) return NextResponse.json({ error: 'saleId obrigatoria.' }, { status: 400 });

    if (!(await hasBoletoFotoColumn())) {
      return NextResponse.json({ error: 'Migracao pendente (Bloco 6).' }, { status: 503 });
    }

    const supabase = getServiceClient();
    const { data: sale } = await supabase.from('sales').select('id, route_id').eq('id', saleId).maybeSingle();
    if (!sale?.route_id) return NextResponse.json({ error: 'Pedido sem rota.' }, { status: 404 });

    const { data: rota } = await supabase.from('entrega_rotas').select('vendedor_id').eq('id', sale.route_id).maybeSingle();
    if (!rota) return NextResponse.json({ error: 'Rota nao encontrada.' }, { status: 404 });
    // Dono da rota, admin ou ENTREGADOR
    if (!isAdminSession(req) && session.perfil !== 'ENTREGADOR' && rota.vendedor_id !== session.sub) {
      return NextResponse.json({ error: 'Sem acesso a esta foto.' }, { status: 403 });
    }

    const { data: ev } = await supabase
      .from('entrega_eventos')
      .select('foto, criado_em')
      .eq('sale_id', saleId)
      .not('foto', 'is', null)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!ev?.foto) return NextResponse.json({ error: 'Sem foto anexada.' }, { status: 404 });
    return NextResponse.json({ foto: ev.foto });
  } catch (e: any) {
    console.error('[api/pre-venda/foto] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao buscar foto.' }, { status: 500 });
  }
}
