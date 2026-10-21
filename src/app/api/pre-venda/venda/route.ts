import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { comissaoPvDeItens } from '@/lib/comissaoPv';
import { hasModoVendaColumn, hasEstoquesNotaColumns } from '@/lib/serverSchema';

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
    // BLOCO 27 (ROTA 2): pagoNaVisita = cliente JA PAGOU na visita (a vista no
    // wizard) — o pedido nasce PAGO e a entrega nao cobra nada.
    const pagoNaVisita = (body as any).pagoNaVisita === true && condicao === 'AVISTA';
    const formasValidas = condicao === 'APRAZO' ? ['DINHEIRO', 'PIX', 'BOLETO', 'CHEQUE'] : ['DINHEIRO', 'PIX'];
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

    // ---------- BLOCO 29 (ROTA 2): modo do atendimento ----------
    // NFE | NFCE -> pedido usa o ESTOQUE COM NF | CUPOM -> ESTOQUE SEM NF.
    // Gravado em sales.modo_nota (quando o SQL do bloco 29 ja rodou) e a baixa
    // da entrega cai na coluna certa (baixar_estoque_principal v2).
    const modoRaw = String((body as any).modo || '').toUpperCase();
    const modo = ['NFE', 'NFCE', 'CUPOM'].includes(modoRaw) ? modoRaw : null;
    const [temModoVenda, temEstoquesNota] = await Promise.all([hasModoVendaColumn(), hasEstoquesNotaColumns()]);

    const etiquetaCond = condicao === 'APRAZO' ? 'A PRAZO' : 'A VISTA';

    // BLOCO 27/29: intencao de nota gravada no detalhe (escritorio enxerga).
    // Com modo do atendimento (rota 2), o modo manda; sem modo, notaIntencao legada.
    const notaIntencaoRaw = modo ?? String((body as any).notaIntencao || '').toUpperCase();
    const notaTxt = notaIntencaoRaw === 'NFE'
      ? ' | COM NOTA: NF-e'
      : notaIntencaoRaw === 'NFCE'
        ? ` | COM NOTA: NFC-e${(body as any).nfcCpf ? ` (CPF ${String((body as any).nfcCpf).slice(0, 20)})` : ''}`
        : '';

    const formaLabel = forma === 'PIX' ? 'PIX' : forma === 'BOLETO' ? 'BOLETO' : forma === 'CHEQUE' ? 'CHEQUE' : 'DINHEIRO';

    const basePayload: any = pagoNaVisita
      ? {
          vendedor_id: session.sub,
          client_id: clientId,
          valor_total: valorTotal,
          valor_pago: valorTotal,
          metodo_pagamento: forma === 'PIX' ? 'PIX' : 'DINHEIRO',
          detalhe_pagamento: `PAGO NA VISITA pelo vendedor (${formaLabel}) — entrega sem cobranca${notaTxt}`,
          status_pagamento: 'PAGO',
          data_venda: new Date().toISOString(),
          tipo_venda: 'PRE_VENDA',
          entrega_status: 'PENDENTE',
        }
      : {
          vendedor_id: session.sub,
          client_id: clientId,
          valor_total: valorTotal,
          valor_pago: 0,
          metodo_pagamento: 'A_PRAZO',
          detalhe_pagamento: `PRE-VENDA — cobrar ${forma} na entrega (${etiquetaCond})${notaTxt}`,
          status_pagamento: 'PENDENTE',
          data_venda: new Date().toISOString(),
          data_vencimento: vencimentoIso,
          tipo_venda: 'PRE_VENDA',
          entrega_status: 'PENDENTE',
        };
    // Bloco 13 (colunas podem nao existir antes do SQL rodado)
    const bloco13 = { trocas };
    // BLOCO 29: modo do atendimento na venda (quando a coluna existe)
    if (modo && temModoVenda) (basePayload as any).modo_nota = modo;
    let payload = { ...basePayload, ...bloco13 };

    // BLOCO 40: devolve modo_nota junto (o cupom do "Pedido Registrado!" mostra
    // o documento certo sem depender so do fallback do detalhe)
    const SEL_COLS = `id, valor_total, valor_pago, metodo_pagamento, detalhe_pagamento, status_pagamento, data_venda, data_vencimento, tipo_venda, entrega_status, trocas${temModoVenda ? ', modo_nota' : ''}`;

    // BLOCO 40: 'as unknown as Promise<any>' — select dinamico (modo_nota so
    // quando a coluna existe); o parser de tipos do supabase-js so infere com
    // string literal e cairia em GenericStringError
    let { data: sale, error: saleErr } = await (supabase
      .from('sales')
      .insert(payload)
      .select(SEL_COLS)
      .single() as unknown as Promise<any>);

    if (saleErr && /trocas|modo_nota/i.test(saleErr.message || '')) {
      const semColunas: any = { ...basePayload };
      if (/modo_nota/i.test(saleErr.message || '')) delete (semColunas as any).modo_nota; else delete (semColunas as any).trocas;
      ({ data: sale, error: saleErr } = await supabase
        .from('sales')
        .insert(semColunas)
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

    // ---------- AVISO de estoque (nao bloqueia o pedido) ----------
    // BLOCO 29: rota 2 com modo compara a coluna do modo (estoque_nota/semnf);
    // sem modo/SQL = regra legada (estoque_principal).
    const avisos: { produto: string; solicitado: number; disponivel: number }[] = [];
    try {
      const prodIds = [...new Set(itens.map(i => i.produtoId))];
      const usaModo = !!(modo && temEstoquesNota);
      const colAviso = usaModo ? (modo === 'CUPOM' ? 'estoque_semnf' : 'estoque_nota') : 'estoque_principal';
      const { data: prods } = await supabase
        .from('products').select(`id, nome, ${colAviso}`).in('id', prodIds);
      const map: Record<string, any> = {};
      (prods || []).forEach((p: any) => { map[p.id] = p; });
      for (const i of itens) {
        const p = map[i.produtoId];
        const disp = Number(p?.[colAviso] ?? 0);
        if (p && i.quantidade > disp) {
          avisos.push({ produto: p.nome || 'Produto', solicitado: i.quantidade, disponivel: disp });
        }
      }
    } catch { /* aviso e best-effort */ }

    // ---------- BLOCO 21: PREVISAO da comissao de PRE-VENDA ----------
    // Mesma regra que GERA a comissao na entrega (lib/comissaoPv): % de
    // PRE-VENDA do produto; sem o campo, % pronta entrega x taxa padrao.
    // A tela "Pedido Registrado!" mostra ESTE valor (antes o browser
    // recalculava com a % de PRONTA ENTREGA — errado).
    let comissaoPrevista: number | undefined;
    try {
      const prev = await comissaoPvDeItens(supabase, itens.map(i => ({ produto_id: i.produtoId, quantidade: i.quantidade, preco_venda: i.precoVenda })));
      if (isFinite(prev) && prev > 0) comissaoPrevista = prev;
    } catch { /* previsao e best-effort: nunca bloqueia o pedido */ }

    return NextResponse.json({ ok: true, sale, comissaoPrevista, avisos: avisos.length > 0 ? avisos : undefined });
  } catch (e: any) {
    console.error('[api/pre-venda/venda] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro ao registrar o pedido. Tente novamente.', detalhe: e?.message }, { status: 500 });
  }
}
