import { NextRequest, NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/session';
import { devBridge, getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';

/**
 * GESTAO DO CATALOGO DO PORTAL (Bloco 17) — status para a aba do admin.
 *
 * GET /api/admin/catalogo   (Bearer session ADMIN obrigatoria)
 *
 * Responde o estado das colunas do Bloco 15 no Supabase (products.imagem e
 * products.unidades_por_caixa) e do Bloco 18 (products.obs) para a aba saber
 * se FOTO/CAIXA/OBS ja podem salvar de verdade — e se existe product_order
 * (ordem do PDV) aplicada. Renomear/reordenar NAO dependem deste SQL
 * (colunas de sempre). BLOCO 208: devolve tambem `fotosInternet`, quantos
 * produtos ainda tem foto buscada na internet (BLOCO 206, aposentado).
 *
 * POST /api/admin/catalogo { acao: 'REVERTER_IMAGENS' }   [ADMIN]
 *   BLOCO 208 (pedido do dono): AS FOTOS DA INTERNET ESTAVAM ERRADAS —
 *   limpa de products.imagem APENAS as URLs buscadas na internet pelo
 *   antigo botao COMPLETAR IMAGENS (BLOCO 206, dominio z-cdn.chatglm.cn).
 *   As fotos que o dono enviou pelo celular / colou URL (Supabase Storage
 *   ou qualquer outro dominio) NAO sao tocadas — o catalogo volta
 *   EXATAMENTE ao estado de antes da busca. Idempotente: rodar 2x nao faz
 *   nada na segunda vez (0 linhas).
 */

// BLOCO 208: as fotos buscadas na internet pelo BLOCO 206 foram re-hospedadas
// pelo servico de busca de imagens neste dominio (links estaveis OSS) — e o
// UNICO marcador que garante que a foto veio da busca e nao do upload do dono.
const PREFIXO_FOTO_INTERNET = 'https://z-cdn.chatglm.cn/';

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

    // Probe do Bloco 18: coluna obs (observacao para o cliente no portal)
    let obsOk = false;
    try {
      const { error } = await supabase
        .from('products')
        .select('id, obs')
        .limit(1);
      obsOk = !error;
      if (error) console.error('[api/admin/catalogo] probe obs:', error.message);
    } catch {
      obsOk = false;
    }

    // Probe do Bloco 23: vinculo de familia (products.familia_catalogo)
    // + ordem do portal (app_settings.catalogo_order)
    let vinculosOk = false;
    try {
      const [{ error: errProd }, { error: errCfg }] = await Promise.all([
        supabase.from('products').select('id, familia_catalogo').limit(1),
        supabase.from('app_settings').select('catalogo_order').limit(1),
      ]);
      vinculosOk = !errProd && !errCfg;
      if (errProd) console.error('[api/admin/catalogo] probe familia_catalogo:', errProd.message);
      if (errCfg) console.error('[api/admin/catalogo] probe catalogo_order:', errCfg.message);
    } catch {
      vinculosOk = false;
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

    // BLOCO 208: quantas fotos da internet (BLOCO 206) ainda estao no catalogo
    let fotosInternet = 0;
    try {
      const { data: imgs } = await supabase
        .from('products')
        .select('id, imagem')
        .like('imagem', `${PREFIXO_FOTO_INTERNET}%`)
        .limit(2000);
      fotosInternet = ((imgs || []) as Record<string, unknown>[]).length;
    } catch { /* coluna sem foto / sem acesso — best effort */ }

    return NextResponse.json({ ok: true, bloco15ok, obsOk, vinculosOk, totalEmOrdem, fotosInternet });
  } catch (e: any) {
    console.error('[api/admin/catalogo] erro:', e?.message);
    return NextResponse.json({ ok: false, erro: 'Erro interno' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, erro: 'Indisponivel no preview local.' }, { status: 503 });
  }
  if (!isAdminSession(request)) {
    return NextResponse.json({ ok: false, erro: 'Sessao invalida.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  if (String(body.acao || '') !== 'REVERTER_IMAGENS') {
    return NextResponse.json({ ok: false, erro: 'Acao desconhecida.' }, { status: 400 });
  }

  try {
    const supabase = getServiceClient();

    // 1) Acha TODAS as fotos que vieram da busca de internet (dominio propio).
    //    Foto do dono (Storage do Supabase, data URL ou outro dominio) = intocavel.
    const { data: alvo, error: eSel } = await supabase
      .from('products')
      .select('id, nome, imagem')
      .like('imagem', `${PREFIXO_FOTO_INTERNET}%`)
      .limit(2000);
    if (eSel) {
      console.error('[api/admin/catalogo] REVERTER_IMAGENS select:', eSel.message);
      return NextResponse.json({ ok: false, erro: 'Falha ao localizar as fotos da internet.' }, { status: 500 });
    }

    const linhas = ((alvo || []) as Record<string, unknown>[]).filter((p) => String(p.imagem || '').startsWith(PREFIXO_FOTO_INTERNET));

    // 2) Zera a imagem desses produtos (voltam a ficar como eram: sem foto,
    //    ou com a foto do dono quando ela existia em outra linha da familia).
    let limpas = 0;
    const falhas: { id: string; erro: string }[] = [];
    for (const p of linhas) {
      const { error } = await supabase.from('products').update({ imagem: null }).eq('id', p.id);
      if (error) falhas.push({ id: String(p.id), erro: error.message });
      else limpas++;
    }

    return NextResponse.json({
      ok: true,
      limpas,
      falhas,
      ids: linhas.map((p) => String(p.id)),
      nomes: linhas.map((p) => String(p.nome || '')),
    });
  } catch (e: unknown) {
    console.error('[api/admin/catalogo] REVERTER_IMAGENS erro:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, erro: 'Erro ao reverter as imagens' }, { status: 500 });
  }
}
