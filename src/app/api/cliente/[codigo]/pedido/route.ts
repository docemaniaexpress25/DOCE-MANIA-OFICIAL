import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sendPushToAll } from '@/lib/pushSender';

/**
 * POST /api/cliente/[codigo]/pedido
 * PEDIDO ONLINE — o cliente mesmo monta o carrinho no catalogo do estoque
 * central e envia. O pedido nasce como PRE_VENDA dentro do sistema:
 *
 * - tipo_venda='PRE_VENDA', entrega_status='PENDENTE', status_pagamento='PENDENTE'
 *   -> cai direto na FILA (separacao do secretario + entregas do entregador),
 *      igual aos pedidos dos vendedores. NAO baixa estoque aqui (baixa na entrega).
 * - preco = tabela do estoque central (products.preco_venda) — o cliente nao
 *   manda preco, evita bagunca.
 * - vendedor_id = vendedor ATIVO da ROTA do cliente (a carteira segue a rota);
 *   fallback: primeiro vendedor ativo.
 * - detalhe 'PEDIDO PORTAL' + obs do cliente em trocas (imprime no cupom).
 * - Aviso por push para a empresa (sendPushToAll).
 * - Regra do dono: cliente com debito em aberto nao pede pelo catalogo.
 */

interface ItemPayload { produtoId?: string; quantidade?: number; }

/** Forma de pagamento pretendida pelo cliente (informativa — o pagamento real e combinado na entrega) */
const FORMAS_OK = new Set(['PIX', 'DINHEIRO']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  if (!codigo || codigo.length < 8) {
    return NextResponse.json({ ok: false, error: 'Codigo invalido' }, { status: 400 });
  }
  if (!isServerSupabaseConfigured()) {
    // Preview local sem service key: repassa para o deploy de producao (Bloco 12)
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, error: 'Pedido online temporariamente indisponivel.' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const rawItens: ItemPayload[] = Array.isArray(body?.itens) ? body.itens : [];
    const obs = String(body?.observacoes || '').trim().slice(0, 500) || null;
    // Site de pedidos: o cliente escolhe Pix/Dinheiro na hora do envio (como o site antigo)
    const formaPretendida = FORMAS_OK.has(String(body?.formaPagamento || '').toUpperCase())
      ? String(body?.formaPagamento).toUpperCase() : null;

    const itens = rawItens
      .map(i => ({ produtoId: String(i.produtoId || ''), quantidade: Math.floor(Number(i.quantidade || 0)) }))
      .filter(i => i.produtoId && i.quantidade > 0 && i.quantidade <= 999);
    if (itens.length === 0) {
      return NextResponse.json({ ok: false, error: 'Seu carrinho esta vazio.' }, { status: 400 });
    }

    const supabase = getServiceClient();

    // 1. Cliente pelo portal_code
    const { data: client, error: findErr } = await supabase
      .from('clients')
      .select('id, nome_fantasia, rota, ativo, portal_code')
      .eq('portal_code', codigo.toUpperCase())
      .limit(1)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!client) return NextResponse.json({ ok: false, error: 'Cliente nao encontrado.' }, { status: 404 });
    if (client.ativo === false) {
      return NextResponse.json({ ok: false, error: 'Cadastro inativo. Fale com a Doce Mania.' }, { status: 403 });
    }

    // 2. Regra do portal: cliente com debito nao pede pelo catalogo
    const { data: vendas } = await supabase
      .from('sales')
      .select('valor_total, valor_pago')
      .eq('client_id', client.id);
    const totalComprado = (vendas || []).reduce((a: number, s: any) => a + Number(s.valor_total || 0), 0);
    const totalPago = (vendas || []).reduce((a: number, s: any) => a + Number(s.valor_pago || 0), 0);
    const saldoDevedor = Math.round((totalComprado - totalPago) * 100) / 100;
    if (saldoDevedor > 0.005) {
      return NextResponse.json({
        ok: false,
        error: `Pedido bloqueado: existe um saldo de R$ ${saldoDevedor.toFixed(2)} em aberto. Quite pelo portal ou fale com o vendedor.`,
      }, { status: 403 });
    }

    // 3. Produtos reais (preco/estoque SEMPRE do banco — cliente nao manda preco)
    const prodIds = [...new Set(itens.map(i => i.produtoId))];
    const { data: prods } = await supabase
      .from('products')
      .select('id, nome, preco_venda, estoque_principal, ativo')
      .in('id', prodIds);
    const prodMap: Record<string, any> = {};
    (prods || []).forEach((p: any) => { prodMap[p.id] = p; });

    const itensOk: { produtoId: string; quantidade: number; precoVenda: number; nome: string }[] = [];
    const problemas: string[] = [];
    for (const i of itens) {
      const p = prodMap[i.produtoId];
      if (!p || p.ativo === false) {
        problemas.push(`Produto indisponivel no catalogo.`);
        continue;
      }
      const disp = Math.max(0, Number(p.estoque_principal || 0));
      if (i.quantidade > disp) {
        problemas.push(`${p.nome}: so ha ${disp} em estoque.`);
        continue;
      }
      itensOk.push({ produtoId: p.id, quantidade: i.quantidade, precoVenda: Number(p.preco_venda || 0), nome: p.nome });
    }
    if (itensOk.length === 0) {
      return NextResponse.json({ ok: false, error: problemas[0] || 'Nenhum item valido no pedido.' }, { status: 400 });
    }

    const total = Math.round(itensOk.reduce((a, i) => a + i.quantidade * i.precoVenda, 0) * 100) / 100;
    if (!(total > 0)) {
      return NextResponse.json({ ok: false, error: 'Valor do pedido invalido.' }, { status: 400 });
    }

    // BLOCO 23 — regra do dono: o cliente pede pelo catalogo na ordem que ele
    // arruma, mas o pedido e MONTADO na ORDEM DO PDV (app_settings.product_order)
    // — cupom, separacao e atendimento saem sempre no padrao da casa.
    try {
      const { data: cfg } = await supabase
        .from('app_settings')
        .select('product_order')
        .eq('id', 'global_settings')
        .maybeSingle();
      const ordemPdv: string[] = Array.isArray((cfg as any)?.product_order) ? (cfg as any).product_order : [];
      if (ordemPdv.length > 0) {
        const idx = new Map<string, number>(ordemPdv.map((id, i) => [id, i]));
        itensOk.sort((a, b) => {
          const ia = idx.get(a.produtoId) ?? Number.MAX_SAFE_INTEGER;
          const ib = idx.get(b.produtoId) ?? Number.MAX_SAFE_INTEGER;
          return ia - ib;
        });
      }
    } catch { /* sem ordem salva: segue a ordem do carrinho */ }

    // 4. Vendedor responsavel: da ROTA do cliente (fallback: primeiro vendedor ativo)
    let vendedorId: string | null = null;
    const rota = String((client as any).rota || '');
    if (rota) {
      const { data: daRota } = await supabase
        .from('app_users')
        .select('id')
        .eq('perfil', 'VENDEDOR')
        .eq('ativo', true)
        .eq('rota', rota)
        .limit(1);
      if (daRota && daRota.length > 0) vendedorId = daRota[0].id;
    }
    if (!vendedorId) {
      const { data: qualquer } = await supabase
        .from('app_users')
        .select('id')
        .eq('perfil', 'VENDEDOR')
        .eq('ativo', true)
        .limit(1);
      if (qualquer && qualquer.length > 0) vendedorId = qualquer[0].id;
    }
    if (!vendedorId) {
      return NextResponse.json({ ok: false, error: 'Nenhum vendedor cadastrado para receber o pedido. Fale com a Doce Mania.' }, { status: 503 });
    }

    // 5. Grava o PEDIDO (nasce como pre-venda na fila do sistema)
    const d7 = new Date();
    d7.setDate(d7.getDate() + 7);
    const detalhe = formaPretendida
      ? `PEDIDO PORTAL — cliente pretende pagar com ${formaPretendida === 'PIX' ? 'PIX' : 'DINHEIRO'} — combinar na entrega`
      : 'PEDIDO PORTAL — combinar pagamento na entrega';
    const basePayload: any = {
      vendedor_id: vendedorId,
      client_id: client.id,
      valor_total: total,
      valor_pago: 0,
      metodo_pagamento: 'A_PRAZO',
      detalhe_pagamento: detalhe,
      status_pagamento: 'PENDENTE',
      data_venda: new Date().toISOString(),
      data_vencimento: d7.toISOString(),
      tipo_venda: 'PRE_VENDA',
      entrega_status: 'PENDENTE',
      trocas: obs,
    };

    let { data: sale, error: saleErr } = await supabase
      .from('sales')
      .insert(basePayload)
      .select('id, valor_total')
      .single();
    if (saleErr && /trocas/i.test(String(saleErr.message || ''))) {
      const semTrocas = { ...basePayload };
      delete semTrocas.trocas;
      ({ data: sale, error: saleErr } = await supabase
        .from('sales')
        .insert(semTrocas)
        .select('id, valor_total')
        .single());
    }
    if (saleErr || !sale) {
      console.error('[api/cliente/pedido] insert sales falhou:', (saleErr as any)?.code, saleErr?.message);
      return NextResponse.json({ ok: false, error: 'Nao foi possivel gravar o pedido. Tente de novo.' }, { status: 500 });
    }

    // 6. Itens (product_id duplicado: coluna legado NOT NULL)
    const itemsRows = itensOk.map(i => ({
      sale_id: sale.id,
      produto_id: i.produtoId,
      product_id: i.produtoId,
      quantidade: i.quantidade,
      preco_venda: i.precoVenda,
    }));
    const { error: itemsErr } = await supabase.from('sale_items').insert(itemsRows);
    if (itemsErr) {
      console.error('[api/cliente/pedido] insert sale_items falhou:', itemsErr.code, itemsErr.message);
      await supabase.from('sales').delete().eq('id', sale.id);
      return NextResponse.json({ ok: false, error: 'Nao foi possivel gravar os itens. Tente de novo.' }, { status: 500 });
    }

    // 7. Aviso para a empresa (push de todos os dispositivos)
    const nomeCliente = String(client.nome_fantasia || '').trim();
    try {
      await sendPushToAll({
        title: 'Novo pedido pelo portal 🛒',
        body: `${nomeCliente} — R$ ${total.toFixed(2)} (${itensOk.length} produto(s)). Ja esta na fila!`,
        url: '/',
      });
    } catch { /* push nunca trava o pedido */ }

    return NextResponse.json({
      ok: true,
      pedidoId: sale.id,
      total,
      avisos: problemas.length > 0 ? problemas : undefined,
    });
  } catch (e: any) {
    console.error('[api/cliente/pedido] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro interno. Tente novamente.' }, { status: 500 });
  }
}
