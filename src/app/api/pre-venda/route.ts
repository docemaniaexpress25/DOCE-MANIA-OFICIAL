import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { sessionFromRequest, isAdminSession } from '@/lib/session';
import { hasEntregaTables, hasBoletoFotoColumn } from '@/lib/serverSchema';

/**
 * PRÉ-VENDA / ROTAS DE ENTREGA (estilo Shopee)
 *
 * GET  /api/pre-venda            -> rota de HOJE do usuario logado + paradas
 *                                  (vendedor pre-venda)
 * GET  /api/pre-venda?all=1      -> [ADMIN/ENTREGADOR] todas as rotas de hoje + pendentes
 * GET  /api/pre-venda?config=1   -> [ADMIN] % da comissao de pre-venda
 * POST /api/pre-venda            -> acoes:
 *   { acao: 'GERAR_ROTA', vendedorId? }  finaliza o dia e monta a rota ordenada
 *       (vendedor: propria rota; admin/entregador: pode indicar vendedorId;
 *        admin sem vendedorId gera para TODOS com pendentes)
 *       Regeneravel enquanto NENHUMA entrega estiver confirmada.
 *   { acao: 'INICIAR_ROTA', lat?, lng? }            sai para entrega
 *   { acao: 'ENTREGUE', saleId, pagamento, valorRecebido?, foto?, lat?, lng? }
 *       DINHEIRO/PIX aceitam PARCIAL (valorRecebido < restante -> PENDENTE);
 *       PIX e BOLETO EXIGEM foto (comprovante/boleto); geram comissao do
 *       vendedor (taxa propria da pre-venda) proporcional ao recebido.
 *   { acao: 'FALHOU', saleId, motivo, lat?, lng? }  nao entregue (ausente/recusou/...)
 *   { acao: 'REABRIR', saleId }                     devolve a parada para a fila
 *   { acao: 'EXCLUIR_VENDA', saleId }               vendedor ate 11h59 do dia;
 *                                                    admin a qualquer hora
 *   { acao: 'SET_CONFIG', comissaoPct }             [ADMIN] taxa da pre-venda
 *
 * Fluxo de status:
 *   sale.entrega_status: PENDENTE -> EM_ROTA -> ENTREGUE | FALHOU
 *   rota.status:         GERADA  -> EM_ROTA -> CONCLUIDA
 *   Tudo roda via service_role; tabelas entrega_rotas/entrega_eventos ficam
 *   FECHADAS para anon/authenticated (RLS, padrao do projeto).
 *
 * DINHEIRO: a venda pre-venda so entra na receita/caixa/comissao QUANDO a
 * entrega e confirmada com pagamento aqui (nunca no registro do pedido).
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

const SALE_COLS = 'id, vendedor_id, client_id, valor_total, valor_pago, metodo_pagamento, detalhe_pagamento, status_pagamento, entrega_status, entrega_seq, route_id, data_venda';
const CLIENT_COLS = 'id, nome_fantasia, endereco, bairro, telefone, localizacao, pin_localizacao';

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Carimbo pt-BR (America/Sao_Paulo) compativel com o parser do portal do cliente:
 *  "12/02/2025 14:33" -> o portal le " | 12/02/2025 14:33: R$ 50.00 (DINHEIRO)" */
function carimboAgora(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

/** Hora atual em Sao Paulo como HH:MM (para a janela de exclusao ate 11h59) */
function horaAgoraSP(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

// ---------------- CONFIG (taxa da comissao de pre-venda) ----------------
// app_config (Bloco 7): chave/valor. Se a tabela ainda nao existir, usa 50.
const COMISSAO_PV_DEFAULT = 50;

async function getComissaoPvPct(supabase: any): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('app_config').select('valor').eq('chave', 'comissao_pre_venda_pct').maybeSingle();
    if (error) return COMISSAO_PV_DEFAULT;
    const v = Number(data?.valor);
    return isFinite(v) && v > 0 && v <= 100 ? v : COMISSAO_PV_DEFAULT;
  } catch {
    return COMISSAO_PV_DEFAULT;
  }
}

/**
 * Comissao de PRE-VENDA: criada SOMENTE na entrega confirmada com pagamento.
 * Base = comissao normal dos produtos (comissao_percentual) x taxa da
 * pre-venda (app_config.comissao_pre_venda_pct, %). Valor proporcional ao
 * recebido no evento (parciais geram comissao parcial).
 */
async function criarComissaoPreVenda(supabase: any, sale: any, valorBase: number) {
  try {
    if (!(valorBase > 0)) return;
    // evita comissao duplicada se a parada for reaberta e re-entregue
    const { data: existente } = await supabase
      .from('commissions').select('id').eq('sale_id', sale.id).limit(1);
    if (existente && existente.length > 0) return;

    const { data: items } = await supabase
      .from('sale_items').select('produto_id, quantidade, preco_venda').eq('sale_id', sale.id);
    const itens = items || [];
    if (itens.length === 0) return;

    const prodIds = [...new Set(itens.map((i: any) => i.produto_id))];
    const { data: prods } = await supabase
      .from('products').select('id, comissao_percentual').in('id', prodIds);
    const pctMap: Record<string, number> = {};
    (prods || []).forEach((p: any) => { pctMap[p.id] = Number(p.comissao_percentual || 0); });

    const fator = await getComissaoPvPct(supabase);
    let comissaoCheia = 0;
    itens.forEach((i: any) => {
      comissaoCheia += Number(i.quantidade || 0) * Number(i.preco_venda || 0) * ((pctMap[i.produto_id] || 0) / 100);
    });
    const comissao = round2(comissaoCheia * (fator / 100) * (valorBase / Math.max(Number(sale.valor_total), 0.01)));
    if (!(comissao > 0)) return;

    await supabase.from('commissions').insert({
      sale_id: sale.id,
      seller_id: sale.vendedor_id,
      valor_comissao: comissao,
      valor_base: round2(valorBase),
      percentual: round2(valorBase > 0 ? (comissao / valorBase) * 100 : 0),
      status: 'DISPONIVEL',
      created_at: new Date().toISOString(),
    });
  } catch (e: any) {
    // comissao nunca deve travar a entrega
    console.error('[pre-venda] comissao pre-venda falhou:', e?.message);
  }
}

/** Forma de pagamento a cobrar na entrega (gravada pelo pedido: "cobrar X na entrega") */
function formaPgtoDeSale(s: any): string {
  const det = String(s.detalhe_pagamento || '');
  const m = det.match(/cobrar\s+(DINHEIRO|PIX|BOLETO)/i);
  if (m) return m[1].toUpperCase();
  const mp = String(s.metodo_pagamento || '').toUpperCase();
  if (mp === 'DINHEIRO' || mp === 'PIX' || mp === 'BOLETO') return mp;
  return 'DINHEIRO';
}

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

  const [clientsRes, itemsRes, eventsRes, fotosRes] = await Promise.all([
    supabase.from('clients').select(CLIENT_COLS).in('id', clientIds),
    supabase.from('sale_items').select('sale_id, produto_id, quantidade, preco_venda').in('sale_id', saleIds),
    supabase.from('entrega_eventos').select('sale_id, status, motivo, criado_em').in('sale_id', saleIds).order('criado_em', { ascending: true }),
    // Bloco 6: foto do boleto (so consulta se a coluna existir)
    hasBoletoFotoColumn().then(ok =>
      ok ? supabase.from('entrega_eventos').select('sale_id').not('foto', 'is', null).in('sale_id', saleIds)
         : Promise.resolve({ data: [] as any[] })),
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
      precoVenda: Number(i.preco_venda || 0),
    });
  });

  const temFotoSet: Record<string, boolean> = {};
  (fotosRes.data || []).forEach((f: any) => { temFotoSet[f.sale_id] = true; });

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
      formaPgto: formaPgtoDeSale(s),
      temFoto: !!temFotoSet[s.id],
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

async function logEvento(supabase: any, routeId: string, saleId: string | null, userId: string, status: string, motivo?: string | null, lat?: number | null, lng?: number | null, foto?: string | null) {
  const row: any = {
    route_id: routeId,
    sale_id: saleId,
    user_id: userId,
    status,
    motivo: motivo || null,
    lat: typeof lat === 'number' ? lat : null,
    lng: typeof lng === 'number' ? lng : null,
  };
  if (foto && (await hasBoletoFotoColumn())) row.foto = foto;
  await supabase.from('entrega_eventos').insert(row);
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

/**
 * Gera (ou REGERA) a rota de HOJE de um vendedor.
 * Regeneracao: permitida enquanto NENHUMA entrega da rota estiver registrada
 * (ENTREGUE/FALHOU). Remonta a ordem com as paradas ainda pendentes.
 */
async function gerarRotaParaVendedor(supabase: any, vendedorId: string, solicitanteId: string): Promise<{ ok: boolean; erro?: string; status?: number; resumo?: any }> {
  const { start, end } = dayRangeIso();
  const { data: vendas, error: vErr } = await supabase
    .from('sales')
    .select(`${SALE_COLS}`)
    .eq('vendedor_id', vendedorId)
    .eq('tipo_venda', 'PRE_VENDA')
    .eq('entrega_status', 'PENDENTE')
    .is('route_id', null)
    .gte('data_venda', start).lte('data_venda', end)
    .order('data_venda', { ascending: true });
  if (vErr) {
    const code = (vErr as any).code || '';
    if (code === '42703' || code === '42P01') {
      return { ok: false, erro: 'Banco desatualizado: rode o Bloco 5 do SQL.', status: 503 };
    }
    throw vErr;
  }
  if (!vendas || vendas.length === 0) {
    return { ok: false, erro: 'Nenhum pedido de pre-venda pendente hoje.', status: 400 };
  }

  const existente = await getRotaDeHoje(supabase, vendedorId);
  if (existente) {
    // Regeneracao so enquanto a rota nao tiver movimento real
    const { data: movimentadas } = await supabase
      .from('sales')
      .select('id')
      .eq('route_id', existente.id)
      .in('entrega_status', ['ENTREGUE', 'FALHOU'])
      .limit(1);
    if (movimentadas && movimentadas.length > 0) {
      return { ok: false, erro: 'A rota de hoje ja tem entregas registradas e nao pode mais mudar (exclusao somente pelo admin).', status: 409 };
    }
    // Solta as paradas antigas (nenhuma confirmada) e volta a rota para GERADA
    await supabase.from('sales').update({ route_id: null, entrega_seq: null }).eq('route_id', existente.id);
    await supabase.from('entrega_rotas').update({ status: 'GERADA', iniciada_em: null, concluida_em: null }).eq('id', existente.id);
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
    .eq('vendedor_id', vendedorId)
    .eq('data', todayStr())
    .maybeSingle();
  const roteiroIdx: Record<string, number> = {};
  ((dr?.client_ids as string[]) || []).forEach((cid: string, i: number) => { roteiroIdx[cid] = i; });
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
      .insert({ vendedor_id: vendedorId, data: todayStr(), status: 'GERADA', total_paradas: ordenadas.length })
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
  await logEvento(supabase, routeId, null, solicitanteId, 'ROTA_GERADA');

  const rota = await getRotaDeHoje(supabase, vendedorId);
  const resumo = await routeSummary(supabase, rota);
  return { ok: true, resumo };
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

    // Config da taxa de comissao de pre-venda (somente admin)
    if (url.searchParams.get('config') === '1') {
      if (!isAdminSession(req)) return NextResponse.json({ error: 'Acesso restrito ao admin.' }, { status: 403 });
      return NextResponse.json({ comissaoPct: await getComissaoPvPct(supabase) });
    }

    // Bloco 5 ainda nao rodou: responde vazio + flag para a UI avisar,
    // em vez de 500 (a aba Entregas nao pode derrubar o resto do app).
    if (!(await hasEntregaTables())) {
      return NextResponse.json({
        hoje: todayStr(), rotas: [], rota: null, paradas: [],
        pendentes: { count: 0, valor: 0 }, migracaoPendente: true,
      });
    }

    if (all) {
      // ADMIN e ENTREGADOR veem todas as rotas (o entregador entrega tudo,
      // separado por vendedor); demais perfis: restrito.
      if (!isAdminSession(req) && session.perfil !== 'ENTREGADOR') {
        return NextResponse.json({ error: 'Acesso restrito ao admin.' }, { status: 403 });
      }
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
      const alvoId = String(body.vendedorId || '');
      // Vendedor: gera a propria rota. Admin/ENTREGADOR: podem gerar de um
      // vendedor especifico (vendedorId) ou, com vendedorId vazio, de TODOS
      // os vendedores com pedidos pendentes hoje (finalizar o dia geral).
      if (admin || session.perfil === 'ENTREGADOR') {
        if (alvoId) {
          const r = await gerarRotaParaVendedor(supabase, alvoId, userId);
          if (!r.ok) return NextResponse.json({ ok: false, error: r.erro }, { status: r.status || 400 });
          return NextResponse.json({ ok: true, ...(r.resumo || {}) });
        }
        const { start, end } = dayRangeIso();
        const { data: pend } = await supabase
          .from('sales')
          .select('vendedor_id')
          .eq('tipo_venda', 'PRE_VENDA')
          .eq('entrega_status', 'PENDENTE')
          .is('route_id', null)
          .gte('data_venda', start).lte('data_venda', end);
        const ids = [...new Set((pend || []).map((p: any) => p.vendedor_id))];
        if (ids.length === 0) {
          return NextResponse.json({ ok: false, error: 'Nenhum pedido de pre-venda pendente hoje.' }, { status: 400 });
        }
        const resultados: any[] = [];
        for (const vid of ids) {
          try {
            const r = await gerarRotaParaVendedor(supabase, vid, userId);
            resultados.push({ vendedorId: vid, ok: r.ok, erro: r.erro || null });
          } catch (e: any) {
            resultados.push({ vendedorId: vid, ok: false, erro: e?.message || 'Erro' });
          }
        }
        return NextResponse.json({ ok: true, resultados, geradas: resultados.filter(r => r.ok).length });
      }
      const r = await gerarRotaParaVendedor(supabase, userId, userId);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.erro }, { status: r.status || 400 });
      return NextResponse.json({ ok: true, ...(r.resumo || {}) });
    }

    // ---------- INICIAR_ROTA ----------
    if (acao === 'INICIAR_ROTA') {
      // Admin/ENTREGADOR podem iniciar uma rota especifica (rotaId);
      // o vendedor inicia a propria.
      let rota: any = null;
      const rotaIdAlvo = String(body.rotaId || '');
      if (rotaIdAlvo && (admin || session.perfil === 'ENTREGADOR')) {
        const resRota = await supabase.from('entrega_rotas').select('*').eq('id', rotaIdAlvo).maybeSingle();
        rota = resRota.data;
      } else {
        rota = await getRotaDeHoje(supabase, userId);
      }
      if (!rota) return NextResponse.json({ ok: false, error: 'Gere a rota primeiro (finalizar dia).' }, { status: 400 });
      if (rota.status !== 'GERADA') return NextResponse.json({ ok: false, error: 'Rota ja iniciada.' }, { status: 409 });

      await supabase.from('entrega_rotas').update({ status: 'EM_ROTA', iniciada_em: new Date().toISOString() }).eq('id', rota.id);
      await supabase.from('sales').update({ entrega_status: 'EM_ROTA' }).eq('route_id', rota.id).in('entrega_status', ['PENDENTE']);
      await logEvento(supabase, rota.id, null, userId, 'EM_ROTA', 'Rota iniciada', lat, lng);
      const resumo = await routeSummary(supabase, { ...rota, status: 'EM_ROTA' });
      return NextResponse.json({ ok: true, ...resumo });
    }

    // ---------- SET_CONFIG: taxa da comissao de pre-venda (admin) ----------
    // (antes do gate de saleId — esta acao nao precisa de venda)
    if (acao === 'SET_CONFIG') {
      if (!admin) return NextResponse.json({ ok: false, error: 'Acesso restrito ao admin.' }, { status: 403 });
      const pct = Number(body.comissaoPct);
      if (!isFinite(pct) || pct <= 0 || pct > 100) {
        return NextResponse.json({ ok: false, error: 'Informe um percentual entre 1 e 100.' }, { status: 400 });
      }
      const { error: cfgErr } = await supabase
        .from('app_config')
        .upsert({ chave: 'comissao_pre_venda_pct', valor: String(pct), updated_at: new Date().toISOString() }, { onConflict: 'chave' });
      if (cfgErr) {
        const code = (cfgErr as any).code || '';
        if (code === '42P01' || code === '42501') {
          return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 7 do SQL (tabela app_config).' }, { status: 503 });
        }
        throw cfgErr;
      }
      return NextResponse.json({ ok: true, comissaoPct: pct });
    }

    // ---------- Acoes por parada ----------
    const saleId = String(body.saleId || '');
    if (!saleId) return NextResponse.json({ ok: false, error: 'saleId obrigatoria.' }, { status: 400 });

    const { data: sale } = await supabase.from('sales').select(`${SALE_COLS}`).eq('id', saleId).maybeSingle();
    if (!sale) return NextResponse.json({ ok: false, error: 'Pedido nao encontrado.' }, { status: 404 });

    // ---------- EXCLUIR_VENDA ----------
    // Vendedor: somente o proprio pedido, registrado HOJE, ate as 11h59
    // (America/Sao_Paulo) e sem entrega confirmada. Admin: a qualquer hora.
    // A venda sai da rota de entrega (ou da fila de pendentes).
    if (acao === 'EXCLUIR_VENDA') {
      if (sale.entrega_status === 'ENTREGUE') {
        return NextResponse.json({ ok: false, error: 'Pedido ja entregue — exclusao indisponivel.' }, { status: 409 });
      }
      if (!admin) {
        if (session.perfil === 'ENTREGADOR') {
          return NextResponse.json({ ok: false, error: 'Entregador nao pode excluir pedidos.' }, { status: 403 });
        }
        if (sale.vendedor_id !== userId) {
          return NextResponse.json({ ok: false, error: 'Este pedido nao e seu.' }, { status: 403 });
        }
        const vendido = new Date(sale.data_venda);
        const { start, end } = dayRangeIso();
        if (vendido.getTime() < new Date(start).getTime() || vendido.getTime() > new Date(end).getTime()) {
          return NextResponse.json({ ok: false, error: 'So e possivel excluir pedidos registrados hoje.' }, { status: 403 });
        }
        const [hh, mm] = horaAgoraSP().split(':').map(Number);
        if (hh > 11 || (hh === 11 && mm > 59)) {
          return NextResponse.json({ ok: false, error: 'Prazo de exclusao expirou (ate 11:59). Solicite ao administrador.' }, { status: 403 });
        }
      }
      // limpa o rastro na ordem certa (eventos -> itens -> venda)
      await supabase.from('entrega_eventos').delete().eq('sale_id', saleId);
      await supabase.from('sale_items').delete().eq('sale_id', saleId);
      const { error: delErr } = await supabase.from('sales').delete().eq('id', saleId);
      if (delErr) {
        const code = (delErr as any).code || '';
        if (code === '23503') {
          return NextResponse.json({ ok: false, error: 'Nao foi possivel excluir: ha registros vinculados (comissao/pagamento). Estorne primeiro.' }, { status: 409 });
        }
        throw delErr;
      }
      if (sale.route_id) {
        const { count } = await supabase
          .from('sales')
          .select('id', { count: 'exact', head: true })
          .eq('route_id', sale.route_id);
        await supabase.from('entrega_rotas').update({ total_paradas: count || 0 }).eq('id', sale.route_id);
        await logEvento(supabase, sale.route_id, null, userId, 'PEDIDO_EXCLUIDO', 'Pedido excluido da rota', lat, lng);
      }
      return NextResponse.json({ ok: true });
    }

    if (!sale.route_id) return NextResponse.json({ ok: false, error: 'Pedido sem rota.' }, { status: 404 });
    const rotaRes = await supabase.from('entrega_rotas').select('*').eq('id', sale.route_id).maybeSingle();
    const rota = rotaRes.data;
    if (!rota) return NextResponse.json({ ok: false, error: 'Rota nao encontrada.' }, { status: 404 });
    // Dono da rota, admin ou ENTREGADOR (o entregador entrega todas as rotas)
    if (!admin && session.perfil !== 'ENTREGADOR' && rota.vendedor_id !== userId) {
      return NextResponse.json({ ok: false, error: 'Esta rota pertence a outro vendedor.' }, { status: 403 });
    }

    if (acao === 'ENTREGUE') {
      if (sale.entrega_status === 'ENTREGUE') return NextResponse.json({ ok: false, error: 'Parada ja entregue.' }, { status: 409 });
      const pagamento = String(body.pagamento || 'DINHEIRO').toUpperCase();
      if (!['DINHEIRO', 'PIX', 'BOLETO', 'JA_PAGO', 'NAO_PAGO'].includes(pagamento)) {
        return NextResponse.json({ ok: false, error: 'Forma de pagamento invalida.' }, { status: 400 });
      }

      const total = Number(sale.valor_total || 0);
      const jaPago = Number(sale.valor_pago || 0);
      const restante = Math.max(0, round2(total - jaPago));

      // FOTO OBRIGATORIA: Pix (comprovante) e Boleto (documento) — regra do fluxo.
      const foto = typeof body.foto === 'string' && body.foto.startsWith('data:image') ? body.foto : null;
      if ((pagamento === 'PIX' || pagamento === 'BOLETO') && !foto) {
        return NextResponse.json({
          ok: false,
          error: pagamento === 'PIX' ? 'Foto do comprovante Pix obrigatoria.' : 'Foto do boleto obrigatoria.',
        }, { status: 400 });
      }
      if (foto) {
        if (foto.length > 3_500_000) {
          return NextResponse.json({ ok: false, error: 'Foto muito grande. Tente novamente.' }, { status: 400 });
        }
        if (!(await hasBoletoFotoColumn())) {
          return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 7 do SQL (coluna de foto).' }, { status: 503 });
        }
      }

      // Valor recebido (DINHEIRO/PIX): total por padrao; suporta PARCIAL.
      let recebido = restante;
      if (pagamento === 'DINHEIRO' || pagamento === 'PIX') {
        const r = Number(body.valorRecebido);
        if (isFinite(r) && r > 0) recebido = round2(r);
        if (recebido > restante) recebido = restante; // troco e tratado na tela
      }

      const updates: any = { entrega_status: 'ENTREGUE' };
      let eventoMotivo = '';
      const eventoFoto: string | null = foto;
      const stamp = carimboAgora();
      const detAtual = String(sale.detalhe_pagamento || 'PRE-VENDA');

      if (pagamento === 'DINHEIRO' || pagamento === 'PIX') {
        // Dinheiro/Pix: baixa o recebido (total ou PARCIAL) e cria a comissao
        // do vendedor AGORA — e aqui que a pre-venda entra no financeiro.
        const novoPago = round2(jaPago + recebido);
        const quitada = novoPago >= total - 0.005;
        updates.valor_pago = novoPago;
        updates.status_pagamento = quitada ? 'PAGO' : 'PENDENTE';
        updates.metodo_pagamento = pagamento;
        // Log no formato que o portal do cliente parseia (historico de recebimentos)
        updates.detalhe_pagamento = `${detAtual} | ${stamp}: R$ ${recebido.toFixed(2)} (${pagamento}${quitada ? '' : ' — parcial'})`;
        eventoMotivo = quitada
          ? (pagamento === 'PIX' ? 'Pagamento: PIX confirmado (com foto)' : 'Pagamento: dinheiro confirmado')
          : `Pagamento parcial: R$ ${recebido.toFixed(2)} de R$ ${restante.toFixed(2)}`;
        await criarComissaoPreVenda(supabase, sale, recebido);
      } else if (pagamento === 'BOLETO') {
        // Boleto entregue: entrega concluida, pagamento segue PENDENTE ate
        // o admin confirmar a compensacao. Foto do boleto obrigatoria.
        updates.metodo_pagamento = 'BOLETO';
        updates.detalhe_pagamento = `${detAtual} | ${stamp}: boleto entregue (foto anexada)`;
        eventoMotivo = 'Boleto entregue — foto anexada (aguardando compensacao)';
      } else if (pagamento === 'JA_PAGO') {
        updates.valor_pago = total;
        updates.status_pagamento = 'PAGO';
        updates.detalhe_pagamento = `${detAtual} | ${stamp}: R$ ${restante.toFixed(2)} (JA_PAGO)`;
        eventoMotivo = 'Entregue — cliente ja havia pago';
        await criarComissaoPreVenda(supabase, sale, restante);
      } else {
        // NAO_PAGO: mantem PENDENTE para cobrar depois
        updates.detalhe_pagamento = `${detAtual} | ${stamp}: entregue sem pagamento`;
        eventoMotivo = 'Entregue sem pagamento';
      }

      const { error: upErr } = await supabase.from('sales').update(updates).eq('id', saleId);
      if (upErr) throw upErr;

      // Baixa do estoque principal (entregou = saiu do estoque central)
      try { await supabase.rpc('baixar_estoque_principal', { p_sale_id: saleId }); } catch (e) {
        console.error('[pre-venda] baixa estoque falhou:', (e as any)?.message);
      }

      await logEvento(supabase, rota.id, saleId, userId, 'ENTREGUE', eventoMotivo, lat, lng, eventoFoto);
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
