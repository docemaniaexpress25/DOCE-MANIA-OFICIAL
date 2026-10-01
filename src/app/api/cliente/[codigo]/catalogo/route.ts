import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';

/**
 * GET /api/cliente/[codigo]/catalogo
 * Catalogo do PEDIDO ONLINE (o cliente pede sozinho — substitui o link externo).
 *
 * - Autentica pelo portal_code aleatorio (mesmo padrao do portal do cliente).
 * - Produtos do ESTOQUE CENTRAL: ativo=true e estoque_principal > 0.
 * - Preco de tabela = products.preco_venda.
 * - Regra do portal: cliente com debito em aberto NAO pede pelo catalogo
 *   (bloqueado=true + saldoDevedor — a tela mostra a mensagem).
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;

  if (!codigo || codigo.length < 8) {
    return NextResponse.json({ error: 'Codigo invalido' }, { status: 400 });
  }
  if (!isServerSupabaseConfigured()) {
    // Preview local sem service key: repassa para o deploy de producao (Bloco 12)
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return NextResponse.json({ error: 'Pedido online temporariamente indisponivel.' }, { status: 503 });
  }

  try {
    const supabase = getServiceClient();

    // 1. Cliente pelo codigo aleatorio (indice unico)
    const { data: client, error: findErr } = await supabase
      .from('clients')
      .select('id, nome_fantasia, bairro, endereco, ativo, portal_code')
      .eq('portal_code', codigo.toUpperCase())
      .limit(1)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!client) return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 });

    // 2. Regra do dono: quem deve, nao pede pelo catalogo (baixa manual/portal primeiro)
    const { data: vendas } = await supabase
      .from('sales')
      .select('valor_total, valor_pago')
      .eq('client_id', client.id);
    const totalComprado = (vendas || []).reduce((a: number, s: any) => a + Number(s.valor_total || 0), 0);
    const totalPago = (vendas || []).reduce((a: number, s: any) => a + Number(s.valor_pago || 0), 0);
    const saldoDevedor = Math.round((totalComprado - totalPago) * 100) / 100;
    const bloqueado = saldoDevedor > 0.005;

    // 3. Catalogo do estoque central (ativo com estoque)
    // select('*'): imagem/unidades_por_caixa (Bloco 15) entram quando existirem,
    // sem quebrar antes do SQL rodar.
    const { data: prods, error: prodErr } = await supabase
      .from('products')
      .select('*')
      .eq('ativo', true)
      .gt('estoque_principal', 0)
      .order('nome', { ascending: true });
    if (prodErr) throw prodErr;

    // 4. Categorias (para o filtro do passo 1)
    let categorias: { id: string; name: string }[] = [];
    try {
      const { data: cats } = await supabase
        .from('product_categories')
        .select('id, name, display_order')
        .order('display_order', { ascending: true });
      categorias = (cats || []).map((c: any) => ({ id: c.id, name: c.name }));
    } catch { /* categorias opcionais */ }

    const produtos = (prods || []).map((p: any) => ({
      id: p.id as string,
      nome: p.nome as string,
      preco: Number(p.preco_venda || 0),
      estoque: Math.max(0, Number(p.estoque_principal || 0)),
      categoryId: (p.category_id as string) || null,
      // Bloco 15: foto cadastrada sobrepoe a foto do catalogo antigo (resolvida no front)
      imagem: (p.imagem as string) || null,
      unidadesPorCaixa: Math.max(1, Math.floor(Number(p.unidades_por_caixa || 1)) || 1),
      // Bloco 18: observacao escrita pelo dono — o CLIENTE ve no portal
      obs: ((p.obs as string) || '').trim() || null,
    }));

    // ORDEM = MESMA ORDEM DO PDV (app_settings.product_order — usada pelo
    // admin e pelo PDV). Familias do portal herdam a ordem pela 1a variante.
    // Produto fora da lista vai pro fim, mantendo a ordem alfabetica anterior.
    try {
      const { data: cfg } = await supabase
        .from('app_settings')
        .select('product_order')
        .eq('id', 'global_settings')
        .maybeSingle();
      const ordem: string[] = Array.isArray((cfg as any)?.product_order) ? (cfg as any).product_order : [];
      if (ordem.length > 0) {
        const idx = new Map<string, number>(ordem.map((id, i) => [id, i]));
        produtos.sort((a, b) => {
          const ia = idx.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const ib = idx.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return ia - ib;
        });
      }
    } catch { /* sem product_order: segue alfabetico */ }

    return NextResponse.json({
      ok: true,
      client: {
        nomeCompleto: String(client.nome_fantasia || '').trim(),
        bairro: client.bairro || '',
        endereco: client.endereco || '',
      },
      bloqueado,
      saldoDevedor,
      categorias,
      produtos,
    });
  } catch (e: any) {
    console.error('[api/cliente/catalogo] erro:', e?.message);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
