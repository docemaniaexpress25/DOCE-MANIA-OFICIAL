import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasBoletoFotoColumn } from '@/lib/serverSchema';

/**
 * GET /api/pre-venda/foto
 *  - ?saleId=...        -> { foto } (base64) da entrega (comprovante/boleto)
 *  - ?saleIds=a,b,c...  -> { temFoto: { [saleId]: true } } (mapa p/ listagem)
 *
 * Acesso: admin, ENTREGADOR, dono da ROTA ou vendedor que FEZ a venda
 * (a foto do a prazo entregue precisa ser vista por quem tem a cobranca,
 * mesmo que o cliente tenha mudado de rota depois).
 * A foto vem sob demanda (fora da listagem) para nao estourar o payload.
 */

/** Autorizado se: admin, entregador, dono da rota ou vendedor da venda. */
function podeVer(
  perfil: string,
  sub: string,
  sale: { vendedor_id?: string | null } | null,
  rotaVendedorId?: string | null
): boolean {
  if (perfil === 'ADMIN' || perfil === 'ENTREGADOR') return true;
  if (rotaVendedorId && rotaVendedorId === sub) return true;
  if (sale?.vendedor_id && sale.vendedor_id === sub) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Sessao expirada. Entre novamente.' }, { status: 401 });

  try {
    const url = new URL(req.url);
    const saleId = url.searchParams.get('saleId') || '';
    const saleIdsParam = url.searchParams.get('saleIds') || '';

    if (!(await hasBoletoFotoColumn())) {
      return NextResponse.json({ error: 'Migracao pendente (Bloco 6).' }, { status: 503 });
    }

    const supabase = getServiceClient();

    // ---------- MODO LOTE: mapa temFoto para listagens ----------
    if (!saleId && saleIdsParam) {
      const ids = [...new Set(saleIdsParam.split(',').map(s => s.trim()).filter(Boolean))].slice(0, 300);
      if (ids.length === 0) return NextResponse.json({ temFoto: {} });

      const { data: salesRows } = await supabase
        .from('sales')
        .select('id, route_id, vendedor_id')
        .in('id', ids);

      const rotaIds = [...new Set((salesRows || []).map((s: any) => s.route_id).filter(Boolean))];
      const rotaMap: Record<string, string> = {};
      if (rotaIds.length > 0) {
        const { data: rotas } = await supabase.from('entrega_rotas').select('id, vendedor_id').in('id', rotaIds);
        (rotas || []).forEach((r: any) => { rotaMap[r.id] = r.vendedor_id; });
      }

      const permitidos = (salesRows || [])
        .filter((s: any) => podeVer(session.perfil, session.sub, s, rotaMap[s.route_id]))
        .map((s: any) => s.id);

      const temFoto: Record<string, boolean> = {};
      if (permitidos.length > 0) {
        const { data: fotos } = await supabase
          .from('entrega_eventos')
          .select('sale_id')
          .in('sale_id', permitidos)
          .not('foto', 'is', null);
        (fotos || []).forEach((f: any) => { temFoto[f.sale_id] = true; });
      }
      return NextResponse.json({ temFoto });
    }

    // ---------- MODO UNITARIO: devolve a foto ----------
    if (!saleId) return NextResponse.json({ error: 'saleId obrigatoria.' }, { status: 400 });

    const { data: sale } = await supabase.from('sales').select('id, route_id, vendedor_id').eq('id', saleId).maybeSingle();
    if (!sale) return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });

    let rotaVendedorId: string | null = null;
    if (sale.route_id) {
      const { data: rota } = await supabase.from('entrega_rotas').select('vendedor_id').eq('id', sale.route_id).maybeSingle();
      rotaVendedorId = rota?.vendedor_id ?? null;
    }
    if (!podeVer(session.perfil, session.sub, sale, rotaVendedorId)) {
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
