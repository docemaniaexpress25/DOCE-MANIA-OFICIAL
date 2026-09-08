import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

/**
 * POST /api/pre-venda/venda
 * Cria um PEDIDO de pre-venda (vendedor trabalha com o estoque principal,
 * entrega acontece depois na rota do dia).
 *
 * - Exige sessao (Bearer token): o vendedor_id vem SEMPRE da sessao.
 * - NAO baixa a carga da van (diferente do RPC processar_venda_v2).
 * - NAO baixa o estoque principal aqui: a baixa acontece quando a entrega
 *   e confirmada (acao ENTREGUE em /api/pre-venda -> RPC baixar_estoque_principal).
 * - A venda nasce tipo_venda='PRE_VENDA', entrega_status='PENDENTE',
 *   status_pagamento='PENDENTE' (pagamento coletado na entrega).
 */

interface ItemPayload { produtoId?: string; produtoid?: string; quantidade?: number; precoVenda?: number; precovenda?: number; }

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }

  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const clientId = String(body.clientId || '');
    const rawItens: ItemPayload[] = Array.isArray(body.itens) ? body.itens : [];
    const valorTotal = Number(body.valorTotal);

    if (!clientId || rawItens.length === 0) {
      return NextResponse.json({ ok: false, error: 'Pedido vazio.' }, { status: 400 });
    }
    if (!isFinite(valorTotal) || valorTotal <= 0) {
      return NextResponse.json({ ok: false, error: 'Valor total invalido.' }, { status: 400 });
    }

    const itens = rawItens.map(i => ({
      produtoId: String(i.produtoId || i.produtoid || ''),
      quantidade: Number(i.quantidade || 0),
      precoVenda: Number(i.precoVenda ?? i.precovenda ?? 0),
    })).filter(i => i.produtoId && i.quantidade > 0 && i.precoVenda >= 0);

    if (itens.length === 0) {
      return NextResponse.json({ ok: false, error: 'Itens do pedido invalidos.' }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Forma de pagamento que o CLIENTE escolheu para o entregador cobrar
    const metodoRaw = String((body as any).metodoEntrega || '').toUpperCase();
    const metodoEntrega = ['DINHEIRO', 'PIX', 'BOLETO'].includes(metodoRaw) ? metodoRaw : 'DINHEIRO';

    // Cliente existe?
    const { data: client, error: clientErr } = await supabase
      .from('clients').select('id').eq('id', clientId).limit(1).maybeSingle();
    if (clientErr) throw clientErr;
    if (!client) return NextResponse.json({ ok: false, error: 'Cliente nao encontrado.' }, { status: 404 });

    // Pre-venda e para entrega no mesmo dia: vencimento = hoje 23:59 (America/Sao_Paulo)
    const dayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const vencimentoIso = new Date(`${dayStr}T23:59:59-03:00`).toISOString();

    const { data: sale, error: saleErr } = await supabase
      .from('sales')
      .insert({
        vendedor_id: session.sub,
        client_id: clientId,
        valor_total: valorTotal,
        valor_pago: 0,
        metodo_pagamento: 'A_PRAZO',
        detalhe_pagamento: `PRE-VENDA — cobrar ${metodoEntrega} na entrega`,
        status_pagamento: 'PENDENTE',
        data_venda: new Date().toISOString(),
        data_vencimento: vencimentoIso,
        tipo_venda: 'PRE_VENDA',
        entrega_status: 'PENDENTE',
      })
      .select('id, valor_total, valor_pago, metodo_pagamento, detalhe_pagamento, status_pagamento, data_venda, data_vencimento, tipo_venda, entrega_status')
      .single();

    if (saleErr || !sale) {
      const code = (saleErr as any)?.code || '';
      console.error('[api/pre-venda/venda] insert sales falhou:', code, saleErr?.message);
      // Colunas do Bloco 5 ainda nao rodadas?
      if (code === '42703' || code === 'PGRST204') {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 5 do SQL (colunas de pre-venda).' }, { status: 503 });
      }
      // Falha de FK: cliente ou vendedor inexistente
      if (code === '23503') {
        return NextResponse.json({ ok: false, error: 'Registro invalido (cliente/vendedor nao encontrado). Atualize a tela e tente de novo.', detalhe: saleErr?.message }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: 'Erro ao gravar o pedido no banco.', detalhe: saleErr?.message }, { status: 500 });
    }

    const itemsRows = itens.map(i => ({
      sale_id: sale.id,
      produto_id: i.produtoId,
      // LEGADO: a tabela real tem product_id NOT NULL (o RPC processar_venda_v2
      // sempre preencheu as duas). Sem isso o insert dos itens falha (23502)
      // e o pedido fica orfao.
      product_id: i.produtoId,
      quantidade: i.quantidade,
      preco_venda: i.precoVenda,
    }));
    const { error: itemsErr } = await supabase.from('sale_items').insert(itemsRows);
    if (itemsErr) {
      // Nao deixa pedido orfao sem itens no banco
      console.error('[api/pre-venda/venda] insert sale_items falhou:', itemsErr.code, itemsErr.message);
      await supabase.from('sales').delete().eq('id', sale.id);
      return NextResponse.json({ ok: false, error: 'Erro ao gravar os itens do pedido.', detalhe: itemsErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sale });
  } catch (e: any) {
    console.error('[api/pre-venda/venda] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro ao registrar o pedido. Tente novamente.', detalhe: e?.message }, { status: 500 });
  }
}
