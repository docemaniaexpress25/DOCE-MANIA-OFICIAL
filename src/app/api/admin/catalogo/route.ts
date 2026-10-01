import { NextRequest, NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/session';
import { devBridge, getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';

/**
 * GESTAO DO CATALOGO DO PORTAL (Bloco 17) — status para a aba do admin.
 *
 * GET /api/admin/catalogo   (Bearer session ADMIN obrigatoria)
 *
 * Responde o estado dos campos do Bloco 15 no Supabase (products.imagem e
 * products.unidades_por_caixa) para a aba saber se FOTO/CAIXA ja podem
 * salvar de verdade — e se existe product_order (ordem do PDV) aplicada.
 * Renomear/reordenar NAO dependem deste SQL (colunas de sempre).
 */

export async function GET(request: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    // Preview local sem service key: repassa para o deploy de producao (Bloco 12)
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, erro: 'Indisponivel no preview local.' }, { status: 503 });
  }
  if (!isAdminSession(request)) {
    return NextResponse.json({ ok: false, erro: 'Sessao invalida.' }, { status: 401 });
  }

  try {
    const supabase = getServiceClient();

    // Probe do Bloco 15: coluna inexistente = PostgREST devolve erro (PGRST204)
    let bloco15ok = false;
    try {
      const { error } = await supabase
        .from('products')
        .select('id, imagem, unidades_por_caixa')
        .limit(1);
      bloco15ok = !error;
      if (error) console.error('[api/admin/catalogo] probe bloco15:', error.message);
    } catch {
      bloco15ok = false;
    }

    let totalEmOrdem = 0;
    try {
      const { data: cfg } = await supabase
        .from('app_settings')
        .select('product_order')
        .eq('id', 'global_settings')
        .maybeSingle();
      const ordem = (cfg as any)?.product_order;
      totalEmOrdem = Array.isArray(ordem) ? ordem.length : 0;
    } catch { /* settings opcional */ }

    return NextResponse.json({ ok: true, bloco15ok, totalEmOrdem });
  } catch (e: any) {
    console.error('[api/admin/catalogo] erro:', e?.message);
    return NextResponse.json({ ok: false, erro: 'Erro interno' }, { status: 500 });
  }
}
