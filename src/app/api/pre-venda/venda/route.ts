import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

/**
 * POST /api/pre-venda/venda
 * Cria um PEDIDO de pre-venda (vendedor trabalha com o estoque principal,
 * entrega acontece depois na FILA CONTINUA — Bloco 13).
 *
 * - Exige sessao (Bearer token): o vendedor_id vem SEMPRE da sessao.
 * - NAO baixa a carga da van (diferente do RPC processar_venda_v2).
 * - NAO baixa o estoque principal aqui: a baixa acontece quando a entrega
 *   e confirmada (acao ENTREGUE em /api/pre-venda -> RPC baixar_estoque_principal).
 * - A venda nasce tipo_venda='PRE_VENDA', entrega_status='PENDENTE',
 *   status_pagamento='PENDENTE' (pagamento coletado na entrega).
 *
 * BLOCO 13:
 * - trocas: anotacao livre do vendedor (sai impressa no cupom)
 * - condicao: 'AVISTA' (DINHEIRO|PIX) ou 'APRAZO' (DINHEIRO|PIX|BOLETO)
 *   -> regra do dono: a vista nao tem boleto; a prazo aceita boleto
 * - vencimento: data para a prazo (opcional; default = +7 dias)
 * - avisos: estoque principal insuficiente NAO bloqueia o pedido, mas volta
 *   como aviso para o vendedor conferir.
 */

interface ItemPayload { produtoId?: string; produtoid?: string; quantidade?: number; precoVenda?: number; precovenda?: number; }

const TZ = 'America/Sao_Paulo';
const OFF = '-03:00';

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }

  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  }
  // So VENDEDOR (e admin, se preciso) geram pre-venda. Entregador/secretario nao vendem.
  if (session.perfil === 'ENTREGADOR' || session.perfil === 'SECRETARIO') {
    return NextResponse.json({ ok: false, error: 'Somente vendedores registram pre-vendas.' }, { status: 403 });
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

    // ---------- Forma de pagamento combinada (regra do dono) ----------
    // A VISTA: DINHEIRO | PIX        A PRAZO: DINHEIRO | PIX | BOLETO
    const condicaoRaw = String((body as any).condicao || '').toUpperCase();
    const condicao = condicaoRaw === 'APRAZO' ? 'APRAZO' : 'AVISTA';
    const formasValidas = condicao === 'APRAZO' ? ['DINHEIRO', 'PIX', 'BOLETO'] : ['DINHEIRO', 'PIX'];
    const metodoRaw = String((body as any).formaPagamento ?? (body as any).metodoEntrega ?? '').toUpperCase();
    const forma = formasValidas.includes(metodoRaw) ? metodoRaw : 'DINHEIRO';

    // Vencimento: a prazo usa a data escolhida (default +7 dias); a vista = hoje
    let vencimentoIso: string;
    if (condicao === 'APRAZO') {
      const vRaw = String((body as any).vencimento || '');
      const vDate = vRaw ? new Date(`${vRaw}T23:59:59${OFF}`) : null;
      if (vDate && isFinite(vDate.getTime())) {
        vencimentoIso = vDate.toISOString();
      } else {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        const dStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        vencimentoIso = new Date(`${dStr}T23:59:59${OFF}`).toISOString();
      }
    } else {
      const dayStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      vencimentoIso = new Date(`${dayStr}T23:59:59${OFF}`).toISOString();
    }

    // Trocas: texto livre do vendedor (impresso no cupom)
    const trocas = String((body as any).trocas || '').trim().slice(0, 500) || null;

    const supabase = getServiceClient();

    // Cliente existe?
    const { data: client, error: clientErr } = await supabase
      .from('clients').select('id').eq('id', clientId).limit(1).maybeSingle();
    if (clientErr) throw clientErr;
    if (!client) return NextResponse.json({ ok: false, error: 'Cliente nao encontrado.' }, { status: 404 });

    const etiquetaCond = condicao === 'APRAZO' ? 'A PRAZO' : 'A VISTA';

    const basePayload: any = {
      vendedor_id: session.sub,
      client_id: clientId,
      valor_total: valorTotal,
      valor_pago: 0,
      metodo_pagamento: 'A_PRAZO',
      detalhe_pagamento: `PRE-VENDA — cobrar ${forma} na entrega (${etiquetaCond})`,
      status_pagamento: 'PENDENTE',
      data_venda: new Date().toISOString(),
      data_vencimento: vencimentoIso,
      tipo_venda: 'PRE_VENDA',
      entrega_status: 'PENDENTE',
    };
    // Bloco 13 (colunas podem nao existir antes do SQL rodar)
    const bloco13 = { trocas };
    let payload = { ...basePayload, ...bloco13 };

    let { data: sale, error: saleErr } = await supabase
      .from('sales')
      .insert(payload)
      .select('id, valor_total, valor_pago, metodo_pagamento, detalhe_pagamento, status_pagamento, data_venda, data_vencimento, tipo_venda, entrega_status, trocas')
      .single();

    if (saleErr && /trocas/i.test(saleErr.message || '')) {
      payload = { ...basePayload };
      ({ data: sale, error: saleErr } = await supabase
        .from('sales')
        .insert(payload)
        .select('id, valor_total, valor_pago, metodo_pagamento, detalhe_pagamento, status_pagamento, data_venda, data_vencimento, tipo_venda, entrega_status')
        .single());
    }

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

    // ---------- AVISO de estoque principal (nao bloqueia o pedido) ----------
    const avisos: { produto: string; solicitado: number; disponivel: number }[] = [];
    try {
      const prodIds = [...new Set(itens.map(i => i.produtoId))];
      const { data: prods } = await supabase
        .from('products').select('id, nome, estoque_principal').in('id', prodIds);
      const map: Record<string, any> = {};
      (prods || []).forEach((p: any) => { map[p.id] = p; });
      for (const i of itens) {
        const p = map[i.produtoId];
        const disp = Number(p?.estoque_principal ?? 0);
        if (p && i.quantidade > disp) {
          avisos.push({ produto: p.nome || 'Produto', solicitado: i.quantidade, disponivel: disp });
        }
      }
    } catch { /* aviso e best-effort */ }

    return NextResponse.json({ ok: true, sale, avisos: avisos.length > 0 ? avisos : undefined });
  } catch (e: any) {
    console.error('[api/pre-venda/venda] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro ao registrar o pedido. Tente novamente.', detalhe: e?.message }, { status: 500 });
  }
}
