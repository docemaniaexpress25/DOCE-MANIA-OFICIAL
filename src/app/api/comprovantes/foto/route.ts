import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { isAdminSession } from '@/lib/session';
import { resolverFotoSupabase } from '@/lib/fotoStorage';

/**
 * GET /api/comprovantes/foto?id=...   [ADMIN]
 * Retorna a foto do comprovante (base64/dataURL) sob demanda,
 * para nao pesar a listagem.
 */
export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ error: 'Servidor nao configurado.' }, { status: 503 });
  }
  if (!isAdminSession(req)) {
    return NextResponse.json({ error: 'Nao autorizado. Faca login novamente.' }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get('id') || '';
  if (!id) return NextResponse.json({ error: 'id obrigatorio' }, { status: 400 });

  try {
    const { data, error } = await getServiceClient()
      .from('payment_comprovantes')
      .select('id, foto')
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Comprovante nao encontrado.' }, { status: 404 });

    // Caminho no Storage -> URL assinada (1h); dataURL (linhas antigas) passa igual.
    return NextResponse.json({ id: data.id, foto: await resolverFotoSupabase(getServiceClient(), data.foto) });
  } catch (e: any) {
    console.error('[api/comprovantes/foto] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao carregar foto.' }, { status: 500 });
  }
}
