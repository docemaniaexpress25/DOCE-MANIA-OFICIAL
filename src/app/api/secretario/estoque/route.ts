import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

/**
 * BLOCO 19 — ESTOQUE DO SECRETARIO (somente quantidade).
 *
 * POST /api/secretario/estoque
 *   { updates: [{ id, estoquePrincipal }] }   (1..200 itens)
 *   -> exige token de sessao com perfil SECRETARIO ou ADMIN
 *   -> WHITELIST: atualiza SOMENTE products.estoque_principal.
 *      Preco, custo, nome, ativo, fiscal etc. NUNCA passam por aqui —
 *      mesmo que alguém manipule o front, o servidor ignora qualquer
 *      outro campo.
 *
 * O secretario nao pode mexer em precos/custo nem em mais nada (pedido do dono),
 * por isso a escrita dele NAO usa o productService do browser (anon) e sim
 * esta rota com guard de perfil e whitelist de coluna.
 */

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json(
      { ok: false, error: 'Servidor nao configurado: defina SUPABASE_SERVICE_ROLE_KEY na Vercel.' },
      { status: 503 }
    );
  }

  // Guard de perfil: SECRETARIO (e ADMIN, para nao travar o dono) — mais nada.
  const session = sessionFromRequest(req);
  if (!session || (session.perfil !== 'SECRETARIO' && session.perfil !== 'ADMIN')) {
    return NextResponse.json({ ok: false, error: 'Sem permissao para ajustar o estoque.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const raw = Array.isArray(body?.updates)
      ? body.updates
      : body?.id
        ? [{ id: body.id, estoquePrincipal: body.estoquePrincipal }]
        : null;
    if (!raw || raw.length === 0 || raw.length > 200) {
      return NextResponse.json({ ok: false, error: 'Nada para atualizar.' }, { status: 400 });
    }

    const clean: { id: string; qtd: number }[] = [];
    for (const u of raw) {
      const id = String(u?.id || '').trim();
      const q = Number(u?.estoquePrincipal);
      if (!id || !Number.isFinite(q) || !Number.isInteger(q) || q < 0 || q > 999999999) {
        return NextResponse.json({ ok: false, error: 'Quantidade invalida.' }, { status: 400 });
      }
      clean.push({ id, qtd: q });
    }

    const supabase = getServiceClient();
    // WHITELIST DE COLUNA: unica escrita possivel e estoque_principal.
    const results = await Promise.all(
      clean.map(({ id, qtd }) =>
        supabase.from('products').update({ estoque_principal: qtd }).eq('id', id).select('id').single()
      )
    );
    const falhas = results.filter(r => r.error);
    if (falhas.length > 0 && falhas.length === results.length) {
      console.error('[api/secretario/estoque] falha ao salvar:', falhas[0].error?.message);
      return NextResponse.json({ ok: false, error: 'Erro ao salvar o estoque. Tente novamente.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, atualizados: results.length - falhas.length });
  } catch (e: any) {
    console.error('[api/secretario/estoque] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Falha de conexao. Tente novamente.' }, { status: 500 });
  }
}
