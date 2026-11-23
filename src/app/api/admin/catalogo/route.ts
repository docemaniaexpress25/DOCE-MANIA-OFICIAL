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
 * (colunas de sempre).
 *
 * POST /api/admin/catalogo { acao: 'BUSCAR_IMAGENS' }   [ADMIN]
 *   BLOCO 206 (regra do dono): completa as IMAGENS dos produtos SEM foto
 *   buscando na INTERNET (servico de busca de imagens do SDK, re-hospedadas
 *   em OSS — links estaveis). Processa ate 4 produtos POR CHAMADA (cada busca
 *   demora alguns segundos); o botao mostra quantos faltam e o dono clica
 *   de novo ate zerar. A foto entra em products.imagem (vira a foto da
 *   familia no portal). Produto com foto NAO e tocado.
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

    return NextResponse.json({ ok: true, bloco15ok, obsOk, vinculosOk, totalEmOrdem });
  } catch (e: any) {
    console.error('[api/admin/catalogo] erro:', e?.message);
    return NextResponse.json({ ok: false, erro: 'Erro interno' }, { status: 500 });
  }
}

const POR_RODADA = 4;

/** Limpa tamanho/abreviação do nome para a busca ficar on-topic ("Ruffles 115g" -> "Ruffles"). */
function nomeParaBusca(nome: string): string {
  const limpo = String(nome || '')
    .replace(/\s*\d+(?:[.,]\d+)?\s*(g|gr|ml|l|kg|un|unds?|x)\s*$/i, '')
    .replace(/\s*\d+(?:[.,]\d+)?\s*(g|gr|ml|l|kg|un|unds?|x)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo || String(nome || 'produto');
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
  if (String(body.acao || '') !== 'BUSCAR_IMAGENS') {
    return NextResponse.json({ ok: false, erro: 'Acao desconhecida.' }, { status: 400 });
  }

  try {
    const supabase = getServiceClient();
    const { data: todos } = await supabase.from('products').select('id, nome, imagem, ativo').limit(2000);
    const semFoto = ((todos || []) as Record<string, unknown>[])
      .filter((p) => p.ativo !== false && !String(p.imagem || '').trim())
      .slice(0, POR_RODADA);

    const resultados: { id: string; nome: string; ok: boolean; url?: string; motivo?: string }[] = [];
    if (semFoto.length > 0) {
      const ZAI = (await import('z-ai-web-dev-sdk')).default;
      const zai = await ZAI.create();
      for (const p of semFoto) {
        const nome = String(p.nome || 'Produto');
        const query = `${nomeParaBusca(nome)} produto embalagem`;
        try {
          const r = await zai.images.search.create({ query, count: 3, gl: 'us', rank: false });
          const url = String((r?.results || [])[0]?.original_url || '');
          if (r?.success && url) {
            const { error: eUpd } = await supabase.from('products').update({ imagem: url }).eq('id', p.id);
            if (eUpd) resultados.push({ id: String(p.id), nome, ok: false, motivo: eUpd.message });
            else resultados.push({ id: String(p.id), nome, ok: true, url });
          } else {
            resultados.push({ id: String(p.id), nome, ok: false, motivo: r?.error || 'busca sem resultado' });
          }
        } catch (e: unknown) {
          resultados.push({ id: String(p.id), nome, ok: false, motivo: e instanceof Error ? e.message : 'falha na busca' });
        }
      }
    }

    // quantos ainda faltam (depois desta rodada)
    let faltam = 0;
    try {
      const { data: depois } = await supabase.from('products').select('id, imagem, ativo').limit(2000);
      faltam = ((depois || []) as Record<string, unknown>[]).filter((p) => p.ativo !== false && !String(p.imagem || '').trim()).length;
    } catch { /* contagem best-effort */ }

    return NextResponse.json({
      ok: true,
      processados: resultados.length,
      achados: resultados.filter((r) => r.ok).length,
      faltam,
      resultados,
    });
  } catch (e: unknown) {
    console.error('[api/admin/catalogo] BUSCAR_IMAGENS erro:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, erro: 'Erro na busca de imagens' }, { status: 500 });
  }
}
