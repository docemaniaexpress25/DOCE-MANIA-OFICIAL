import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { isAdminSession } from '@/lib/session';

/**
 * GET /api/comprovantes/foto?id=...   [ADMIN]
 * Retorna a foto do comprovante (base64/dataURL) sob demanda,
 * para nao pesar a listagem.
 */
export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
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

    return NextResponse.json({ id: data.id, foto: data.foto });
  } catch (e: any) {
    console.error('[api/comprovantes/foto] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao carregar foto.' }, { status: 500 });
  }
}
