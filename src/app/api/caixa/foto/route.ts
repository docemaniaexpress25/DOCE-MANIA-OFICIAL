import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { resolverFotoSupabase } from '@/lib/fotoStorage';

/**
 * GET /api/caixa/foto?id=<pagamento>  [ADMIN | SECRETARIO | VENDEDOR]
 * BLOCO 118 — comprovante (foto) de um pagamento do caixa.
 * A coluna guarda caminho do Storage (bucket privado) ou dataURL antigo;
 * aqui devolve algo que o <img src> entenda (URL assinada 1h ou dataURL).
 */
export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (!['ADMIN', 'SECRETARIO', 'VENDEDOR'].includes(session.perfil)) {
    return NextResponse.json({ ok: false, error: 'Acesso restrito.' }, { status: 403 });
  }

  try {
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!id) return NextResponse.json({ ok: false, error: 'id obrigatorio.' }, { status: 400 });

    const supabase = getServiceClient();
    const { data: row, error } = await supabase
      .from('caixa_pagamentos')
      .select('comprovante')
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    if (error) {
      const msg = String(error.message || '');
      if (/caixa_pagamentos|does not exist|schema cache/i.test(msg)) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
      }
      throw error;
    }
    const valor = (row as any)?.comprovante as string | null | undefined;
    if (!valor) return NextResponse.json({ ok: false, error: 'Pagamento sem comprovante.' }, { status: 404 });

    const foto = await resolverFotoSupabase(supabase, valor);
    return NextResponse.json({ ok: true, foto });
  } catch (e: any) {
    console.error('[api/caixa/foto][GET] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro ao carregar o comprovante.' }, { status: 500 });
  }
}
