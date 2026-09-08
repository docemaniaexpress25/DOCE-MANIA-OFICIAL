import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { sessionFromRequest, isAdminSession } from '@/lib/session';
import { hasEntregaTables } from '@/lib/serverSchema';

/**
 * PRÉ-VENDA / ROTAS DE ENTREGA (estilo Shopee)
 *
 * GET  /api/pre-venda            -> rota de HOJE do usuario logado + paradas
 *                                  (entregador/vendedor pre-venda)
 * GET  /api/pre-venda?all=1      -> [ADMIN] todas as rotas de hoje + pendentes
 * POST /api/pre-venda            -> acoes:
 *   { acao: 'GERAR_ROTA' }                          finaliza o dia de pre-venda e monta a rota ordenada
 *   { acao: 'INICIAR_ROTA', lat?, lng? }            sai para entrega
 *   { acao: 'ENTREGUE', saleId, pagamento, lat?, lng? }  confirma parada (pagamento: DINHEIRO|PIX|JA_PAGO|NAO_PAGO)
 *   { acao: 'FALHOU', saleId, motivo, lat?, lng? }  nao entregue (ausente/recusou/...)
 *   { acao: 'REABRIR', saleId }                     devolve a parada para a fila
 *
 * Fluxo de status:
 *   sale.entrega_status: PENDENTE -> EM_ROTA -> ENTREGUE | FALHOU
 *   rota.status:         GERADA  -> EM_ROTA -> CONCLUIDA
 *   Tudo roda via service_role; tabelas entrega_rotas/entrega_eventos ficam
 *   FECHADAS para anon/authenticated (RLS, padrao do projeto).
 */

const TZ = 'America/Sao_Paulo';
const OFF = '-03:00'; // SP sem horario de verao desde 2019

function todayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function dayRangeIso(): { start: string; end: string } {
  const d = todayStr();
  return { start: new Date(`${d}T00:00:00${OFF}`).toISOString(), end: new Date(`${d}T23:59:59.999${OFF}`).toISOString() };
}

const SALE_COLS = 'id, vendedor_id, client_id, valor_total, valor_pago, metodo_pagamento, status_pagamento, entrega_status, entrega_seq, route_id, data_venda';
const CLIENT_COLS = 'id, nome_fantasia, endereco, bairro, telefone, localizacao, pin_localizacao';

async function fetchParadas(supabase: any, routeId: string) {
  const { data: salesRows, error } = await supabase
    .from('sales')
    .select(SALE_COLS)
    .eq('route_id', routeId)
    .order('entrega_seq', { ascending: true });
  if (error) throw error;
  return salesRows || [];
}

async function enrichParadas(supabase: any, salesRows: any[]) {
  if (salesRows.length === 0) return [];
  const clientIds = [...new Set(salesRows.map((s: any) => s.client_id).filter(Boolean))];
  const saleIds = salesRows.map((s: any) => s.id);

  const [clientsRes, itemsRes, eventsRes] = await Promise.all([
    supabase.from('clients').select(CLIENT_COLS).in('id', clientIds),
    supabase.from('sale_items').select('sale_id, produto_id, quantidade').in('sale_id', saleIds),
    supabase.from('entrega_eventos').select('sale_id, status, motivo, criado_em').in('sale_id', saleIds).order('criado_em', { ascending: true }),
  ]);

  const clientMap: Record<string, any> = {};
  (clientsRes.data || []).forEach((c: any) => { clientMap[c.id] = c; });

  // Nomes dos produtos
  const prodIds = [...new Set((itemsRes.data || []).map((i: any) => i.produto_id))];
  const prodMap: Record<string, string> = {};
  if (prodIds.length > 0) {
    const { data: prods } = await supabase.from('products').select('id, nome').in('id', prodIds);
    (prods || []).forEach((p: any) => { prodMap[p.id] = p.nome; });
  }

  const itemsBySale: Record<string, any[]> = {};
  (itemsRes.data || []).forEach((i: any) => {
    (itemsBySale[i.sale_id] = itemsBySale[i.sale_id] || []).push({
      nome: prodMap[i.produto_id] || 'Produto',
      produtoId: i.produto_id,
      quantidade: i.quantidade,
    });
  });

  const eventsBySale: Record<string, any[]> = {};
  (eventsRes.data || []).forEach((e: any) => {
    (eventsBySale[e.sale_id] = eventsBySale[e.sale_id] || []).push({ status: e.status, motivo: e.motivo, criado_em: e.criado_em });
  });

  return salesRows.map((s: any) => {
    const c = clientMap[s.client_id] || {};
    let lat: number | null = null, lng: number | null = null;
    if (c.localizacao && typeof c.localizacao.lat === 'number') { lat = c.localizacao.lat; lng = c.localizacao.lng; }
    else if (c.pin_localizacao && c.pin_localizacao.includes(',')) {
      const [a, b] = String(c.pin_localizacao).split(',').map((x: string) => parseFloat(x.trim()));
      if (isFinite(a) && isFinite(b)) { lat = a; lng = b; }
    }
    return {
      saleId: s.id,
      seq: s.entrega_seq,
      entregaStatus: s.entrega_status,
      valorTotal: Number(s.valor_total),
      valorPago: Number(s.valor_pago || 0),
      statusPagamento: s.status_pagamento,
      motivo: null as string | null,
      cliente: {
        id: s.client_id,
        nome: c.nome_fantasia || 'Cliente',
        endereco: c.endereco || '',
        bairro: c.bairro || '',
        telefone: c.telefone || '',
        lat, lng,
      },
      itens: itemsBySale[s.id] || [],
      eventos: eventsBySale[s.id] || [],
    };
  });
}

async function routeSummary(supabase: any, route: any) {
  const paradas = await enrichParadas(supabase, await fetchParadas(supabase, route.id));
  const paradasFmt = paradas.map(p => ({
    ...p,
    motivo: (p.eventos && [...p.eventos].reverse().find(e => e.motivo)?.motivo) || null,
  }));
  let vendedorNome = '';
  if (route.vendedor_id) {
    const { data: u } = await supabase.from('app_users').select('nome').eq('id', route.vendedor_id).limit(1).maybeSingle();
    vendedorNome = u?.nome || '';
  }
  return {
    rota: {
      id: route.id,
      data: route.data,
      status: route.status,
      totalParadas: route.total_paradas,
      criadaEm: route.criada_em,
      iniciadaEm: route.iniciada_em,
      concluidaEm: route.concluida_em,
      vendedorId: route.vendedor_id,
      vendedorNome,
    },
    paradas: paradasFmt,
  };
}

async function pendentesDoDia(supabase: any, vendedorId?: string) {
  const { start, end } = dayRangeIso();
  let q = supabase
    .from('sales')
    .select('id, valor_total')
    .eq('tipo_venda', 'PRE_VENDA')
    .eq('entrega_status', 'PENDENTE')
    .is('route_id', null)
    .gte('data_venda', start)
    .lte('data_venda', end);
  if (vendedorId) q = q.eq('vendedor_id', vendedorId);
  const { data } = await q;
  const rows = data || [];
  return { count: rows.length, valor: rows.reduce((a: number, s: any) => a + Number(s.valor_total || 0), 0) };
}

async function getRotaDeHoje(supabase: any, vendedorId: string) {
  const { data } = await supabase
    .from('entrega_rotas')
    .select('*')
    .eq('vendedor_id', vendedorId)
    .eq('data', todayStr())
    .maybeSingle();
  return data || null;
}

async function logEvento(supabase: any, routeId: string, saleId: string | null, userId: string, status: string, motivo?: string | null, lat?: number | null, lng?: number | null) {
  await supabase.from('entrega_eventos').insert({
    route_id: routeId,
    sale_id: saleId,
    user_id: userId,
    status,
    motivo: motivo || null,
    lat: typeof lat === 'number' ? lat : null,
    lng: typeof lng === 'number' ? lng : null,
  });
}

async function checarConclusao(supabase: any, routeId: string) {
  const { data: rest } = await supabase
    .from('sales')
    .select('id')
    .eq('route_id', routeId)
    .in('entrega_status', ['PENDENTE', 'EM_ROTA']);
  if (!rest || rest.length === 0) {
    await supabase.from('entrega_rotas').update({ status: 'CONCLUIDA', concluida_em: new Date().toISOString() }).eq('id', routeId);
  }
}

export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Sessao expirada. Entre novamente.' }, { status: 401 });

  try {
    const supabase = getServiceClient();
    const url = new URL(req.url);
    const all = url.searchParams.get('all') === '1';

    // Bloco 5 ainda nao rodou: responde vazio + flag para a UI avisar,
    // em vez de 500 (a aba Entregas nao pode derrubar o resto do app).
    if (!(await hasEntregaTables())) {
      return NextResponse.json({
        hoje: todayStr(), rotas: [], rota: null, paradas: [],
        pendentes: { count: 0, valor: 0 }, migracaoPendente: true,
      });
    }

    if (all) {
      if (!isAdminSession(req)) return NextResponse.json({ error: 'Acesso restrito ao admin.' }, { status: 403 });
      const { data: rotas } = await supabase
        .from('entrega_rotas')
        .select('*')
        .eq('data', todayStr())
        .order('criada_em', { ascending: true });
      const resumo: any[] = [];
      for (const r of rotas || []) resumo.push(await routeSummary(supabase, r));
      const pendentes = await pendentesDoDia(supabase);
      return NextResponse.json({ hoje: todayStr(), rotas: resumo, pendentes });
    }

    const rota = await getRotaDeHoje(supabase, session.sub);
    const pendentes = await pendentesDoDia(supabase, session.sub);
    if (!rota) return NextResponse.json({ hoje: todayStr(), rota: null, paradas: [], pendentes });
    const resumo = await routeSummary(supabase, rota);
    return NextResponse.json({ hoje: todayStr(), ...resumo, pendentes });
  } catch (e: any) {
    console.error('[api/pre-venda][GET] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao carregar entregas.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  const admin = isAdminSession(req);

  try {
    if (!(await hasEntregaTables())) {
      return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 5 do SQL (pre-venda).' }, { status: 503 });
    }

    const body = await req.json();
    const acao = String(body.acao || '');
    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lng = typeof body.lng === 'number' ? body.lng : null;
    const supabase = getServiceClient();
    const userId = session.sub;

    // ---------- GERAR_ROTA: finaliza o dia de pre-venda e monta a rota ----------
    if (acao === 'GERAR_ROTA') {
      const { start, end } = dayRangeIso();
      const { data: vendas, error: vErr } = await supabase
        .from('sales')
        .select(`${SALE_COLS}`)
        .eq('vendedor_id', userId)
        .eq('tipo_venda', 'PRE_VENDA')
        .eq('entrega_status', 'PENDENTE')
        .is('route_id', null)
        .gte('data_venda', start).lte('data_venda', end)
        .order('data_venda', { ascending: true });
      if (vErr) {
        if ((vErr as any).code === '42703' || (vErr as any).code === '42P01') {
          return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 5 do SQL.' }, { status: 503 });
        }
        throw vErr;
      }
      if (!vendas || vendas.length === 0) {
        return NextResponse.json({ ok: false, error: 'Nenhum pedido de pre-venda pendente hoje.' }, { status: 400 });
      }

      const existente = await getRotaDeHoje(supabase, userId);
      if (existente && existente.status !== 'GERADA') {
        return NextResponse.json({ ok: false, error: 'A rota de hoje ja foi iniciada e nao pode ser regenerada.' }, { status: 409 });
      }

      // Ordem das paradas: 1) ordem do roteiro do dia (daily_routes),
      // 2) cadastro do cliente (ordem), 3) hora do pedido.
      const clientIds = [...new Set(vendas.map((v: any) => v.client_id))];
      const { data: clientsRows } = await supabase.from('clients').select('id, ordem').in('id', clientIds);
      const ordemMap: Record<string, number> = {};
      (clientsRows || []).forEach((c: any) => { ordemMap[c.id] = Number(c.ordem || 9999); });
      const { data: dr } = await supabase
        .from('daily_routes')
        .select('client_ids')
        .eq('vendedor_id', userId)
        .eq('data', todayStr())
        .maybeSingle();
      const roteiroIdx: Record<string, number> = {};
      ((dr?.client_ids as string[]) || []).forEach((cid, i) => { roteiroIdx[cid] = i; });
      const rank = (cid: string) => (cid in roteiroIdx) ? roteiroIdx[cid] : 10_000 + (ordemMap[cid] ?? 9999);
      const ordenadas = [...vendas].sort((a: any, b: any) =>
        (rank(a.client_id) - rank(b.client_id))
        || new Date(a.data_venda).getTime() - new Date(b.data_venda).getTime());

      let routeId: string;
      if (existente) {
        routeId = existente.id;
      } else {
        const { data: novaRota, error: rotaErr } = await supabase
          .from('entrega_rotas')
          .insert({ vendedor_id: userId, data: todayStr(), status: 'GERADA', total_paradas: ordenadas.length })
          .select('id').single();
        if (rotaErr) throw rotaErr;
        routeId = novaRota.id;
      }

      for (let i = 0; i < ordenadas.length; i++) {
        const { error: upErr } = await supabase
          .from('sales')
          .update({ route_id: routeId, entrega_seq: i + 1 })
          .eq('id', ordenadas[i].id);
        if (upErr) throw upErr;
      }
      await supabase.from('entrega_rotas').update({ total_paradas: ordenadas.length }).eq('id', routeId);
      await logEvento(supabase, routeId, null, userId, 'ROTA_GERADA');

      const rota = await getRotaDeHoje(supabase, userId);
      const resumo = await routeSummary(supabase, rota);
      return NextResponse.json({ ok: true, ...resumo });
    }

    // ---------- INICIAR_ROTA ----------
    if (acao === 'INICIAR_ROTA') {
      const rota = await getRotaDeHoje(supabase, userId);
      if (!rota) return NextResponse.json({ ok: false, error: 'Gere a rota primeiro (finalizar dia).' }, { status: 400 });
      if (rota.status !== 'GERADA') return NextResponse.json({ ok: false, error: 'Rota ja iniciada.' }, { status: 409 });

      await supabase.from('entrega_rotas').update({ status: 'EM_ROTA', iniciada_em: new Date().toISOString() }).eq('id', rota.id);
      await supabase.from('sales').update({ entrega_status: 'EM_ROTA' }).eq('route_id', rota.id).in('entrega_status', ['PENDENTE']);
      await logEvento(supabase, rota.id, null, userId, 'EM_ROTA', 'Rota iniciada', lat, lng);
      const resumo = await routeSummary(supabase, { ...rota, status: 'EM_ROTA' });
      return NextResponse.json({ ok: true, ...resumo });
    }

    // ---------- Acoes por parada ----------
    const saleId = String(body.saleId || '');
    if (!saleId) return NextResponse.json({ ok: false, error: 'saleId obrigatoria.' }, { status: 400 });

    const { data: sale } = await supabase.from('sales').select(`${SALE_COLS}`).eq('id', saleId).maybeSingle();
    if (!sale || !sale.route_id) return NextResponse.json({ ok: false, error: 'Pedido sem rota.' }, { status: 404 });
    const rotaRes = await supabase.from('entrega_rotas').select('*').eq('id', sale.route_id).maybeSingle();
    const rota = rotaRes.data;
    if (!rota) return NextResponse.json({ ok: false, error: 'Rota nao encontrada.' }, { status: 404 });
    // Dono da rota ou admin
    if (!admin && rota.vendedor_id !== userId) {
      return NextResponse.json({ ok: false, error: 'Esta rota pertence a outro vendedor.' }, { status: 403 });
    }

    if (acao === 'ENTREGUE') {
      if (sale.entrega_status === 'ENTREGUE') return NextResponse.json({ ok: false, error: 'Parada ja entregue.' }, { status: 409 });
      const pagamento = String(body.pagamento || 'DINHEIRO');
      const updates: any = { entrega_status: 'ENTREGUE' };
      if (pagamento === 'DINHEIRO' || pagamento === 'PIX') {
        updates.valor_pago = Number(sale.valor_total);
        updates.status_pagamento = 'PAGO';
        updates.metodo_pagamento = pagamento;
        updates.detalhe_pagamento = `PRE-VENDA — recebido na entrega (${pagamento})`;
      } else if (pagamento === 'JA_PAGO') {
        updates.valor_pago = Number(sale.valor_total);
        updates.status_pagamento = 'PAGO';
      } // NAO_PAGO: mantem PENDENTE para cobrar depois
      const { error: upErr } = await supabase.from('sales').update(updates).eq('id', saleId);
      if (upErr) throw upErr;

      // Baixa do estoque principal (entregou = saiu do estoque central)
      try { await supabase.rpc('baixar_estoque_principal', { p_sale_id: saleId }); } catch (e) {
        console.error('[pre-venda] baixa estoque falhou:', (e as any)?.message);
      }

      await logEvento(supabase, rota.id, saleId, userId, 'ENTREGUE', pagamento === 'NAO_PAGO' ? 'Entregue sem pagamento' : `Pagamento: ${pagamento}`, lat, lng);
      await checarConclusao(supabase, rota.id);
      return NextResponse.json({ ok: true });
    }

    if (acao === 'FALHOU') {
      if (sale.entrega_status === 'ENTREGUE') return NextResponse.json({ ok: false, error: 'Parada ja entregue.' }, { status: 409 });
      const motivo = String(body.motivo || 'Nao entregue').slice(0, 140);
      const { error: upErr } = await supabase.from('sales').update({ entrega_status: 'FALHOU' }).eq('id', saleId);
      if (upErr) throw upErr;
      await logEvento(supabase, rota.id, saleId, userId, 'FALHOU', motivo, lat, lng);
      await checarConclusao(supabase, rota.id);
      return NextResponse.json({ ok: true });
    }

    if (acao === 'REABRIR') {
      if (rota.status !== 'EM_ROTA') return NextResponse.json({ ok: false, error: 'Rota nao esta em andamento.' }, { status: 409 });
      const { error: upErr } = await supabase.from('sales').update({ entrega_status: 'EM_ROTA' }).eq('id', saleId);
      if (upErr) throw upErr;
      await supabase.from('entrega_rotas').update({ status: 'EM_ROTA', concluida_em: null }).eq('id', rota.id);
      await logEvento(supabase, rota.id, saleId, userId, 'EM_ROTA', 'Parada reaberta', lat, lng);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'Acao desconhecida.' }, { status: 400 });
  } catch (e: any) {
    console.error('[api/pre-venda][POST] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro interno. Tente novamente.' }, { status: 500 });
  }
}
