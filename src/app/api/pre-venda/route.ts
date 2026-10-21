import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest, isAdminSession } from '@/lib/session';
import { hasEntregaTables, hasBoletoFotoColumn, hasModoVendaColumn, hasCargaCheckColumns } from '@/lib/serverSchema';
import { sendPushToUser } from '@/lib/pushSender';
import QRCode from 'qrcode';
import { buildPixPayload, generateTxid } from '@/lib/pix';
// BLOCO 21: regra ÚNICA da comissão de pré-venda (compartilhada com /api/pre-venda/venda)
import { comissaoPvDeItens, COMISSAO_PV_DEFAULT, round2 } from '@/lib/comissaoPv';

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
const CLIENT_COLS_BASE = 'id, nome_fantasia, endereco, bairro, telefone, cnpj';
// BLOCO 46 (regra do dono): e-mail do cliente vai no rodapé do cupom (envio
// do XML da NF-e). Alguns bancos antigos não têm clients.email — os tiers de
// fetchClientsFlex tentam COM email e degradam para o tier sem email.
const CLIENT_COLS_EMAIL = `${CLIENT_COLS_BASE}, email`;
const CLIENT_COLS_GPS = `${CLIENT_COLS_EMAIL}, localizacao, pin_localizacao`;

/**
 * clients com colunas de GPS flexíveis. Bancos SEM clients.localizacao
 * (Bloco 12 incompleto) rejeitam o select inteiro (42703) — sem isso o mapa
 * de clientes fica vazio e TODA parada aparece como "Cliente" sem endereço,
 * telefone e sem botão de MAPA/ZAP. Tenta a versão completa e degrada.
 */
async function fetchClientsFlex(supabase: any, ids: string[]) {
  if (!ids || ids.length === 0) return { data: [] as any[] };
  // BLOCO 46: tiers COM email primeiro; sem email só no último (banco antigo)
  for (const cols of [CLIENT_COLS_GPS, `${CLIENT_COLS_EMAIL}, pin_localizacao`, CLIENT_COLS_EMAIL, CLIENT_COLS_BASE]) {
    const r = await supabase.from('clients').select(cols).in('id', ids);
    if (!r.error) return r;
  }
  return { data: [] as any[] };
}

// ---------------------------------------------------------------------------
// Colunas uuid (sales.entregador_id, caixa_fechamentos.entregador_id,
// entrega_eventos.user_id) REJEITAM valores nao-UUID ("invalid input syntax
// for type uuid"). O login fixo da base (ENTREGADOR/SECRETARIO, PIN 1234)
// nao tem linha em app_users — o id da sessao e a string "ENTREGADOR", e
// gravar direto derruba a confirmacao de entrega (500 "Erro ao registrar a
// entrega") e o fechamento de caixa.
// Regra do resolver:
//   1. id ja e UUID (usuario real/admin) -> usa o proprio id (nominal);
//   2. pseudo-usuario -> se existir EXATAMENTE 1 usuario real ativo com esse
//      perfil, usa o id dele (a entrega passa a ser nominal automaticamente);
//   3. senao, UUID fixo e estavel do acesso da base (o caixa e o historico
//      ficam agrupados no mesmo "entregador" — nunca mais quebram).
// ---------------------------------------------------------------------------
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ACESSO_FIXO: Record<string, string> = {
  ENTREGADOR: 'e6e10000-0000-4000-8000-00000000e6e1',
  SECRETARIO: 'e6e20000-0000-4000-8000-00000000e6e2',
};
async function resolveEntregadorUuid(supabase: any, userId: string): Promise<string | null> {
  if (!userId) return null;
  if (RE_UUID.test(userId)) return userId;
  const perfil = String(userId).toUpperCase();
  try {
    const { data, error } = await supabase
      .from('app_users').select('id, perfil, ativo').eq('perfil', perfil).eq('ativo', true);
    if (!error && Array.isArray(data)) {
      if (data.length === 1) return data[0].id as string;
      // 2+ usuarios reais: nao da para adivinhar quem esta entregando —
      // mantem o UUID do acesso fixo (sem quebrar; o nominal volta quando
      // entrarem com o login real de um deles).
    }
    // BLOCO 33: ids NAO-uuid (ex. mock E2E 'adminuser') — o toUpperCase do id
    // nao e perfil. Tenta localizar o usuario pelo proprio id.
    const alt = await supabase.from('app_users').select('id, ativo').eq('id', userId).eq('ativo', true).limit(1);
    if (!alt.error && Array.isArray(alt.data) && alt.data.length === 1) return alt.data[0].id as string;
  } catch { /* app_users inacessivel: segue com o UUID fixo */ }
  return UUID_ACESSO_FIXO[perfil] || null;
}

// BLOCO 13: colunas novas da fila continua (podem nao existir antes do SQL)
const FILA_COLS_13 = `${SALE_COLS}, tipo_venda, trocas, prioridade, separado, separado_em, entregador_id, data_vencimento`;

// BLOCO 31: ordem_entrega (posicao da parada definida pelo admin com setas).
// Sonda 1x por processo — pre-SQL a fila segue no formato antigo (sem ordem).
let _temOrdemEntrega: boolean | null = null;
async function hasOrdemEntregaColumn(): Promise<boolean> {
  if (_temOrdemEntrega !== null) return _temOrdemEntrega;
  try {
    const { error } = await getServiceClient().from('sales').select('ordem_entrega').limit(1);
    _temOrdemEntrega = !error;
  } catch { _temOrdemEntrega = false; }
  return _temOrdemEntrega;
}

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

/**
 * BLOCO 14 — interruptores das melhorias (admin liga/desliga em Configuracoes).
 * Colunas melhor_* em app_settings; se o SQL 14 nao rodou, tudo LIGADO.
 */
async function getMelhorias(supabase: any): Promise<{ trocaSeparacao: boolean; pushEntrega: boolean; whatsapp: boolean; bairroCard: boolean; fotoEntrega: boolean; pushFalha: boolean }> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('melhor_troca_separacao, melhor_push_entrega, melhor_whatsapp, melhor_bairro, melhor_foto_entrega, melhor_push_falha')
      .eq('id', 'global_settings')
      .maybeSingle();
    return {
      trocaSeparacao: data?.melhor_troca_separacao !== false,
      pushEntrega: data?.melhor_push_entrega !== false,
      whatsapp: data?.melhor_whatsapp !== false,
      bairroCard: data?.melhor_bairro !== false,
      fotoEntrega: data?.melhor_foto_entrega !== false,
      pushFalha: data?.melhor_push_falha !== false,
    };
  } catch {
    return { trocaSeparacao: true, pushEntrega: true, whatsapp: true, bairroCard: true, fotoEntrega: true, pushFalha: true };
  }
}

/**
 * BLOCO 14 — Comissão de PRE-VENDA: criada/ATUALIZADA sempre na entrega
 * confirmada (qualquer forma de pagamento), com o VALOR CHEIO da venda.
 *   - à vista quitado no aceite  -> DISPONIVEL (vendedor pode receber)
 *   - parcial / boleto / nao pago -> A_RECEBER (entra quando o dinheiro
 *     da venda entrar completo — o recebimento posterior vira DISPONIVEL)
 * Nunca reduz valor de comissão já registrada e nunca trava a entrega.
 */
async function registrarComissaoPreVenda(supabase: any, sale: any, quitada: boolean) {
  try {
    const { data: items } = await supabase
      .from('sale_items').select('produto_id, quantidade, preco_venda').eq('sale_id', sale.id);
    const itens = items || [];
    if (itens.length === 0) return;

    const comissao = await comissaoPvDeItens(supabase, itens);
    if (!(comissao > 0)) return;

    const total = Math.max(Number(sale.valor_total || 0), 0.01);
    const payload = {
      seller_id: sale.vendedor_id,
      valor_comissao: comissao,
      valor_base: round2(Number(sale.valor_total || 0)),
      percentual: round2((comissao / total) * 100),
      status: quitada ? 'DISPONIVEL' : 'A_RECEBER',
    };

    // evita duplicar se a parada for reaberta e re-entregue: atualiza a row
    // (a comissao conta no dia em que a entrega foi EFETIVADA: created_at
    // anda junto com a re-entrega — data de entrega = data da comissao)
    const { data: existente } = await supabase
      .from('commissions').select('id').eq('sale_id', sale.id).limit(1);
    if (existente && existente.length > 0) {
      await supabase.from('commissions')
        .update({ ...payload, created_at: new Date().toISOString() })
        .eq('id', existente[0].id);
    } else {
      await supabase.from('commissions').insert({
        sale_id: sale.id,
        ...payload,
        valor_pago: 0,
        created_at: new Date().toISOString(),
      });
    }
  } catch (e: any) {
    // comissao nunca deve travar a entrega
    console.error('[pre-venda] comissao pre-venda falhou:', e?.message);
  }
}

/** Aviso ao vendedor (push + mensagem no app) — Bloco 14 */
async function avisarVendedor(supabase: any, vendedorId: string | null | undefined, clientId: string | null | undefined, title: string, corpo: string) {
  try {
    if (!vendedorId) return;
    let nomeCli = 'cliente';
    if (clientId) {
      const { data: cli } = await supabase.from('clients').select('nome_fantasia').eq('id', clientId).maybeSingle();
      nomeCli = cli?.nome_fantasia || nomeCli;
    }
    await sendPushToUser(vendedorId, { title, body: `${nomeCli} — ${corpo}`, url: '/' });
    await supabase.from('system_messages').insert({
      vendedor_id: vendedorId,
      titulo: title,
      mensagem: `${nomeCli}: ${corpo}`,
      data: new Date().toISOString(),
      lida: false,
    });
  } catch (e: any) {
    console.error('[pre-venda] aviso vendedor falhou:', e?.message);
  }
}

/** Forma de pagamento a cobrar na entrega (gravada pelo pedido: "cobrar X na entrega")
 *  BLOCO 27: pedido PAGO NA VISITA (a vista do wizard ROTA 2) -> PAGO_VISITA
 *  (o entregador NÃO cobra nada — só entrega). */
function formaPgtoDeSale(s: any): string {
  const det = String(s.detalhe_pagamento || '');
  if (/PAGO NA VISITA/i.test(det)) return 'PAGO_VISITA';
  const m = det.match(/cobrar\s+(DINHEIRO|PIX|BOLETO|CHEQUE)/i);
  if (m) return m[1].toUpperCase();
  const mp = String(s.metodo_pagamento || '').toUpperCase();
  if (mp === 'DINHEIRO' || mp === 'PIX' || mp === 'BOLETO') return mp;
  return 'DINHEIRO';
}

/** BLOCO 40: sales.modo_nota entra no select SO quando a coluna existe
 *  (sonda em cache — pre-SQL o select inteiro quebraria 42703 e a fila sumiria). */
async function salesColsComModo(): Promise<string> {
  const temModo = await hasModoVendaColumn();
  return temModo ? 'modo_nota' : '';
}

async function fetchParadas(supabase: any, routeId: string) {
  // BLOCO 40: modo_nota entra quando a coluna existe (tipo de documento no cupom)
  const modoCol = await salesColsComModo();
  const { data: salesRows, error } = await supabase
    .from('sales')
    .select(`${SALE_COLS}${modoCol ? `, ${modoCol}` : ''}`)
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
    fetchClientsFlex(supabase, clientIds),
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
      condicao: /A PRAZO/i.test(String(s.detalhe_pagamento || '')) ? 'APRAZO' : 'AVISTA',
      // BLOCO 40 (regra do dono): dados REAIS da venda para o cupom — tipo do
      // documento (NF-e/NFC-e) e forma de pagamento. Sem isso o Cupom.tsx
      // reconstruia o detalhe do zero e a escolha "COM NOTA" se perdia.
      detalhePagamento: s.detalhe_pagamento || null,
      metodoPagamento: s.metodo_pagamento || null,
      modoNota: s.modo_nota || null,
      temFoto: !!temFotoSet[s.id],
      motivo: null as string | null,
      cliente: {
        id: s.client_id,
        nome: c.nome_fantasia || 'Cliente',
        endereco: c.endereco || '',
        bairro: c.bairro || '',
        telefone: c.telefone || '',
        // BLOCO 40: CNPJ para o rodape do cupom NF-e ("NF-e: <cnpj>")
        cnpj: c.cnpj || null,
        // BLOCO 46: e-mail para o rodape do cupom (envio do XML)
        email: c.email || null,
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

// ============================================================================
// BLOCO 13 — FILA CONTINUA
// ============================================================================

/** logEvento tolerante: nunca bloqueia a acao principal por falha de log */
async function logEventoSeguro(supabase: any, routeId: string | null, saleId: string | null, userId: string, status: string, motivo?: string | null, lat?: number | null, lng?: number | null, foto?: string | null) {
  try {
    const userUuid = await resolveEntregadorUuid(supabase, userId);
    const row: any = { route_id: routeId, sale_id: saleId, user_id: userUuid, status, motivo: motivo || null, lat: typeof lat === 'number' ? lat : null, lng: typeof lng === 'number' ? lng : null };
    if (!userUuid) delete row.user_id;
    if (foto && (await hasBoletoFotoColumn())) row.foto = foto;
    try {
      await supabase.from('entrega_eventos').insert(row);
    } catch (e: any) {
      // route_id pode ser NOT NULL em bancos antigos: tenta sem rota
      if (routeId === null) {
        const { route_id: _drop, ...semRota } = row;
        try { await supabase.from('entrega_eventos').insert(semRota); } catch { /* ignora */ }
      } else { throw e; }
    }
  } catch (e: any) {
    console.error('[pre-venda] logEvento falhou (nao bloqueia):', e?.message);
  }
}

/** Update de venda tolerante: se as colunas do Bloco 13 nao existem, refaz sem elas */
async function updateSaleFlex(supabase: any, saleId: string, payload: Record<string, unknown>): Promise<{ ok: boolean; sem13: boolean; erro?: string }> {
  const { error } = await supabase.from('sales').update(payload).eq('id', saleId);
  if (!error) return { ok: true, sem13: false };
  const msg = String(error.message || '');
  if (/trocas|prioridade|separado|entregador_id/i.test(msg)) {
    const flex = { ...payload };
    delete flex.trocas; delete flex.prioridade; delete flex.separado; delete flex.separado_em; delete flex.entregador_id;
    // Se sobrar algo de verdade (ex.: entrega_status), aplica sem as colunas novas.
    // Se NAO sobrar nada, o update seria vazio = sucesso falso. Exige o SQL.
    if (Object.keys(flex).length === 0) {
      return { ok: false, sem13: true, erro: 'Banco desatualizado: rode o Bloco 13 do SQL.' };
    }
    const { error: err2 } = await supabase.from('sales').update(flex).eq('id', saleId);
    if (!err2) return { ok: true, sem13: true };
    return { ok: false, sem13: true, erro: err2.message };
  }
  // CHECK legado em sales.metodo_pagamento: so aceita DINHEIRO/PIX/A_PRAZO.
  // Se o update for rejeitado por constraint com metodo fora disso (ex.:
  // BOLETO gravado por codigo antigo), refaz com A_PRAZO — a forma real
  // continua registrada no detalhe_pagamento (a fila parseia de lá).
  if (/violat|check constraint/i.test(error.message || '') && payload.metodo_pagamento && !['DINHEIRO', 'PIX', 'A_PRAZO'].includes(String(payload.metodo_pagamento))) {
    const flex2 = { ...payload, metodo_pagamento: 'A_PRAZO' };
    const { error: err3 } = await supabase.from('sales').update(flex2).eq('id', saleId);
    if (!err3) return { ok: true, sem13: false };
    return { ok: false, sem13: false, erro: err3.message };
  }
  return { ok: false, sem13: false, erro: error.message };
}

/** Monta o item da fila (formato UI) a partir das rows de sales */
async function enrichFila(supabase: any, salesRows: any[]) {
  if (salesRows.length === 0) return [];
  const clientIds = [...new Set(salesRows.map((s: any) => s.client_id).filter(Boolean))];
  const saleIds = salesRows.map((s: any) => s.id);
  const vendedorIds = [...new Set(salesRows.map((s: any) => s.vendedor_id).filter(Boolean))];

  const [clientsRes, itemsRes, usersRes, fotosRes] = await Promise.all([
    fetchClientsFlex(supabase, clientIds),
    supabase.from('sale_items').select('sale_id, produto_id, quantidade, preco_venda').in('sale_id', saleIds),
    vendedorIds.length > 0 ? supabase.from('app_users').select('id, nome').in('id', vendedorIds) : Promise.resolve({ data: [] }),
    hasBoletoFotoColumn().then(ok =>
      ok ? supabase.from('entrega_eventos').select('sale_id').not('foto', 'is', null).in('sale_id', saleIds)
         : Promise.resolve({ data: [] as any[] })),
  ]);

  const clientMap: Record<string, any> = {};
  (clientsRes.data || []).forEach((c: any) => { clientMap[c.id] = c; });
  const userMap: Record<string, string> = {};
  (usersRes.data || []).forEach((u: any) => { userMap[u.id] = u.nome; });

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

  return salesRows.map((s: any) => {
    const c = clientMap[s.client_id] || {};
    let lat: number | null = null, lng: number | null = null;
    if (c.localizacao && typeof c.localizacao.lat === 'number') { lat = c.localizacao.lat; lng = c.localizacao.lng; }
    else if (c.pin_localizacao && c.pin_localizacao.includes(',')) {
      const [a, b] = String(c.pin_localizacao).split(',').map((x: string) => parseFloat(x.trim()));
      if (isFinite(a) && isFinite(b)) { lat = a; lng = b; }
    }
    const det = String(s.detalhe_pagamento || '');
    const condicao = /A PRAZO/i.test(det) ? 'APRAZO' : 'AVISTA';
    return {
      saleId: s.id,
      numero: `PV-${String(s.id).replace(/-/g, '').slice(-6).toUpperCase()}`,
      dataVenda: s.data_venda,
      entregaStatus: s.entrega_status,
      valorTotal: Number(s.valor_total),
      valorPago: Number(s.valor_pago || 0),
      statusPagamento: s.status_pagamento,
      formaPgto: formaPgtoDeSale(s),
      condicao,
      // BLOCO 40 (regra do dono): dados REAIS da venda para o cupom — o Cupom
      // mostra o tipo do documento escolhido (NF-e/NFC-e + CPF) e a forma de
      // pagamento real. Antes o front reconstruia o detalhe sem a nota.
      detalhePagamento: det || null,
      metodoPagamento: s.metodo_pagamento || null,
      modoNota: s.modo_nota || null,
      trocas: s.trocas ?? null,
      prioridade: typeof s.prioridade === 'number' ? s.prioridade : 0,
      // BLOCO 31: posicao manual da rota (definida pelo admin com setas)
      ordemEntrega: typeof s.ordem_entrega === 'number' ? s.ordem_entrega : undefined,
      separado: !!s.separado,
      separadoEm: s.separado_em ?? null,
      // BLOCO 58: check de carga do admin — timestamp de quando o pedido foi
      // carregado no veiculo (null = ainda nao carregado). Bancos sem a
      // coluna (SQL 58 pendente) vêm undefined = null = nao carregado.
      carregadoEm: s.carga_confirmada_em ?? null,
      vendedorId: s.vendedor_id,
      vendedorNome: userMap[s.vendedor_id] || '',
      temFoto: !!temFotoSet[s.id],
      dataVencimento: s.data_vencimento ?? null,
      cliente: {
        id: s.client_id,
        nome: c.nome_fantasia || 'Cliente',
        endereco: c.endereco || '',
        bairro: c.bairro || '',
        telefone: c.telefone || '',
        // BLOCO 40: CNPJ para o rodape do cupom NF-e ("NF-e: <cnpj>")
        cnpj: c.cnpj || null,
        // BLOCO 46: e-mail para o rodape do cupom (envio do XML)
        email: c.email || null,
        lat, lng,
      },
      itens: itemsBySale[s.id] || [],
    };
  });
}

/** GET ?fila=1 — a fila viva: pendentes (P1 -> P2 -> mais antigo) + falhados + entregues de hoje */
async function getFila(supabase: any, userId: string, perfil: string) {
  const { start, end } = dayRangeIso();
  const proprio = perfil === 'VENDEDOR';
  // BLOCO 31: ordem_entrega entra nas colunas SO se o SQL ja rodou (sonda)
  const temOrdem = await hasOrdemEntregaColumn();
  // BLOCO 40: modo_nota idem (tipo do documento no cupom da fila/pedidos)
  const modoCol = await salesColsComModo();
  // BLOCO 58: check de carga (pedido carregado no veiculo) — entra SO quando o SQL rodou
  const temCarga = await hasCargaCheckColumns();
  const filaCols = `${FILA_COLS_13}${temOrdem ? ', ordem_entrega' : ''}${modoCol ? `, ${modoCol}` : ''}${temCarga ? ', carga_confirmada_em' : ''}`;

  // ---- Fila ativa: PENDENTE/EM_ROTA (inclui legado) — qualquer dia (fila viva) ----
  let qAtiva = supabase
    .from('sales')
    .select(filaCols)
    .eq('tipo_venda', 'PRE_VENDA')
    .in('entrega_status', ['PENDENTE', 'EM_ROTA'])
    .order('data_venda', { ascending: true });
  if (proprio) qAtiva = qAtiva.eq('vendedor_id', userId);
  const { data: ativas, error: ativaErr } = await qAtiva;

  // Bloco 13 nao rodou: refaz sem as colunas novas
  let sem13 = false;
  let ativasRows = ativas;
  if (ativaErr && /trocas|prioridade|separado|entregador_id/i.test(String(ativaErr.message || ''))) {
    sem13 = true;
    let q2 = supabase
      .from('sales')
      .select(SALE_COLS)
      .eq('tipo_venda', 'PRE_VENDA')
      .in('entrega_status', ['PENDENTE', 'EM_ROTA'])
      .order('data_venda', { ascending: true });
    if (proprio) q2 = q2.eq('vendedor_id', userId);
    const { data } = await q2;
    ativasRows = data;
  } else if (ativaErr) {
    throw ativaErr;
  }

  // ---- Falhados (ultimos 7 dias) ----
  const dias7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  let qFal = supabase
    .from('sales')
    .select(filaCols)
    .eq('tipo_venda', 'PRE_VENDA')
    .eq('entrega_status', 'FALHOU')
    .gte('data_venda', dias7)
    .order('data_venda', { ascending: false });
  if (proprio) qFal = qFal.eq('vendedor_id', userId);
  const { data: falhados } = await qFal;

  // ---- Entregues HOJE (para o resumo/transparencia) ----
  let qEnt = supabase
    .from('sales')
    .select(filaCols)
    .eq('tipo_venda', 'PRE_VENDA')
    .eq('entrega_status', 'ENTREGUE')
    .gte('data_venda', dias7)
    .order('data_venda', { ascending: false });
  if (proprio) qEnt = qEnt.eq('vendedor_id', userId);
  const { data: entreguesRows } = await qEnt;
  // entregues hoje = data_venda em qualquer dia, mas o evento ENTREGUE de hoje:
  // simplificacao segura: usamos os eventos de hoje para filtrar
  const { data: evHoje } = await supabase
    .from('entrega_eventos')
    .select('sale_id, status, motivo, criado_em')
    .eq('status', 'ENTREGUE')
    .gte('criado_em', start).lte('criado_em', end);
  const entreguesHojeIds = new Set((evHoje || []).map((e: any) => e.sale_id));
  const entreguesHoje = (entreguesRows || []).filter((s: any) => entreguesHojeIds.has(s.id));

  const fila = await enrichFila(supabase, ativasRows || []);
  // BLOCO 31: se o admin ja definiu ordem manual (setas), ela MANDA —
  // pedidos novos (sem ordem) entram no fim da fila, por antiguidade.
  if (fila.some((f: any) => typeof f.ordemEntrega === 'number' && f.ordemEntrega > 0)) {
    fila.sort((a: any, b: any) =>
      ((typeof a.ordemEntrega === 'number' ? a.ordemEntrega : 1e9) - (typeof b.ordemEntrega === 'number' ? b.ordemEntrega : 1e9)) ||
      (new Date(a.dataVenda).getTime() - new Date(b.dataVenda).getTime()));
  } else {
    fila.sort((a: any, b: any) => (a.prioridade - b.prioridade) || (new Date(a.dataVenda).getTime() - new Date(b.dataVenda).getTime()));
  }

  // Extrai valor do recebimento do motivo ("R$ 12,34" ou "R$ 12.34")
  const valorDeMotivo = (m: string | null): number => {
    const s = String(m || '');
    const mm = s.match(/R\$ ?([\d.]+),(\d{2})/) || s.match(/R\$ ?([\d]+\.[\d]{2})/);
    if (!mm) return 0;
    return Number(mm[0].replace(/[R$\s]/g, '').replace(',', '.'));
  };

  // Parte um motivo de entrega em {dinheiro, pix} — cobre o pagamento MISTO
  // ("Pagamento misto: dinheiro R$ 50.00 + pix R$ 50.00") e as formas simples.
  const partesDeMotivo = (m: string | null): { din: number; pix: number } => {
    const s = String(m || '');
    if (!/R\$/.test(s)) return { din: 0, pix: 0 };
    if (/\bmisto\b/i.test(s)) {
      const low = s.toLowerCase();
      const iDin = low.indexOf('dinheiro');
      const iPix = low.indexOf('pix');
      let din = 0, pix = 0;
      if (iDin >= 0) { const seg = iPix > iDin ? s.slice(iDin, iPix) : s.slice(iDin); din = valorDeMotivo(seg); }
      if (iPix >= 0) { const seg = iDin >= 0 && iDin > iPix ? s.slice(iPix, iDin) : s.slice(iPix); pix = valorDeMotivo(seg); }
      return { din, pix };
    }
    const v = valorDeMotivo(s);
    if (!v) return { din: 0, pix: 0 };
    if (/pix/i.test(s)) return { din: 0, pix: v };
    if (/dinheiro/i.test(s)) return { din: v, pix: 0 };
    return { din: 0, pix: 0 };
  };

  // BLOCO 58 (regra do dono): o caixa de entregas NAO zera sozinho a
  // meia-noite — o valor em aberto ACUMULA desde o ULTIMO fechamento de caixa
  // e so recomeca quando o admin clica no botao "Fechar caixa". Sem nenhum
  // fechamento anterior, considera os ultimos 60 dias (teto de egress — nunca
  // escaneia o historico inteiro).
  let desdeCaixaIso: string | null = null;
  try {
    const { data: ultimoFech } = await supabase
      .from('caixa_fechamentos')
      .select('criado_em')
      .order('criado_em', { ascending: false })
      .limit(1);
    desdeCaixaIso = ultimoFech && ultimoFech[0]?.criado_em ? String(ultimoFech[0].criado_em) : null;
  } catch { /* tabela antiga: segue sem limite de fechamento */ }
  const desdeCaixa = desdeCaixaIso || new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
  const { data: evCaixa } = await supabase
    .from('entrega_eventos')
    .select('sale_id, status, motivo, criado_em')
    .eq('status', 'ENTREGUE')
    .gte('criado_em', desdeCaixa);

  // Caixa EM ABERTO (dinheiro/pix recebidos desde o ultimo fechamento) —
  // estimativa a partir dos eventos de entrega
  let dinheiroHoje = 0, pixHoje = 0;
  for (const e of evCaixa || []) {
    const { din, pix } = partesDeMotivo(e.motivo);
    dinheiroHoje = round2(dinheiroHoje + din);
    pixHoje = round2(pixHoje + pix);
  }

  // Resumo legivel do recebimento de uma entrega (para a conferencia do admin)
  const resumoDeMotivo = (m: string): string => {
    const s = String(m || '');
    if (/\bmisto\b/i.test(s)) return 'Dinheiro + Pix';
    if (/dinheiro/i.test(s)) return 'Dinheiro';
    if (/pix/i.test(s)) return 'Pix';
    if (/JA_PAGO/i.test(s)) return 'Ja havia pago';
    if (/boleto/i.test(s)) return 'Boleto entregue';
    if (/a prazo/i.test(s)) return 'A prazo — vendedor cobra';
    if (/sem pagamento/i.test(s)) return 'Sem cobranca (a receber)';
    return 'Sem cobranca';
  };

  const filaFmt = fila.map((p: any) => ({
    ...p,
    motivo: null,
  }));

  const entreguesHojeEnr = await enrichFila(supabase, entreguesHoje);
  const nomePorSale: Record<string, string> = {};
  for (const p of entreguesHojeEnr) nomePorSale[String(p.saleId)] = p.cliente?.nome || 'Cliente';

  // CONFERENCIA DO DIA (admin): o que o SISTEMA registrou de recebimento por
  // entregador hoje — para bater com o dinheiro que o entregador traz da rua,
  // entrega por entrega (o entregador pode chegar a qualquer momento).
  let conferencia: any = null;
  if (perfil === 'ADMIN') {
    const evMotivosPorSale: Record<string, string[]> = {};
    for (const e of evHoje || []) {
      (evMotivosPorSale[String(e.sale_id)] ||= []).push(String(e.motivo || ''));
    }
    const grupos: Record<string, { entregadorId: string; nome: string; dinheiro: number; pix: number; qtdEntregas: number; vendas: any[] }> = {};
    for (const s of entreguesHoje || []) {
      const motivos = evMotivosPorSale[String(s.id)] || [];
      let din = 0, pix = 0;
      for (const m of motivos) {
        const p = partesDeMotivo(m);
        din = round2(din + p.din);
        pix = round2(pix + p.pix);
      }
      const entKey = String(s.entregador_id || 'SEM_ENTREGADOR');
      const g = (grupos[entKey] ||= { entregadorId: entKey, nome: '', dinheiro: 0, pix: 0, qtdEntregas: 0, vendas: [] });
      g.dinheiro = round2(g.dinheiro + din);
      g.pix = round2(g.pix + pix);
      g.qtdEntregas += 1;
      g.vendas.push({
        saleId: s.id,
        cliente: nomePorSale[String(s.id)] || 'Cliente',
        valorTotal: Number(s.valor_total || 0),
        valorPago: Number(s.valor_pago || 0),
        recebimento: motivos.length ? resumoDeMotivo(motivos[motivos.length - 1]) : 'Sem cobranca',
      });
    }
    const ids = Object.keys(grupos).filter(k => k !== 'SEM_ENTREGADOR');
    if (ids.length > 0) {
      const { data: usrs } = await supabase.from('app_users').select('id, nome').in('id', ids);
      (usrs || []).forEach((u: any) => { if (grupos[u.id]) grupos[u.id].nome = u.nome; });
    }
    if (grupos['SEM_ENTREGADOR']) grupos['SEM_ENTREGADOR'].nome = 'Entregador (registro antigo)';
    conferencia = { porEntregador: Object.values(grupos).sort((a: any, b: any) => b.qtdEntregas - a.qtdEntregas) };
  }

  return {
    hoje: todayStr(),
    fila: filaFmt,
    falhados: await enrichFila(supabase, falhados || []),
    entreguesHoje: entreguesHojeEnr,
    resumo: {
      naFila: filaFmt.length,
      valorFila: round2(filaFmt.reduce((a: number, p: any) => a + p.valorTotal, 0)),
      atrasados: filaFmt.filter((p: any) => (Date.now() - new Date(p.dataVenda).getTime()) > 24 * 3600 * 1000).length,
      separados: filaFmt.filter((p: any) => p.separado).length,
      entreguesHoje: entreguesHoje.length,
      valorEntregueHoje: round2(entreguesHoje.reduce((a: number, s: any) => a + Number(s.valor_total || 0), 0)),
      falhados: (falhados || []).length,
    },
    caixa: { dinheiroHoje, pixHoje, desde: desdeCaixaIso },
    ...(conferencia ? { conferencia } : {}),
    sem13,
  };
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
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Sessao expirada. Entre novamente.' }, { status: 401 });

  try {
    const supabase = getServiceClient();
    const url = new URL(req.url);
    const all = url.searchParams.get('all') === '1';

    // Padrão da comissão de pre-venda (somente admin) — Bloco 23: fixo 5
    if (url.searchParams.get('config') === '1') {
      if (!isAdminSession(req)) return NextResponse.json({ error: 'Acesso restrito ao admin.' }, { status: 403 });
      return NextResponse.json({ comissaoPct: COMISSAO_PV_DEFAULT });
    }

    // ---------- BLOCO 31: produtos para o editor de pedido (admin) ----------
    // Leve: colunas explicitas, so ativos — 1 request quando o modal abre.
    if (url.searchParams.get('produtos') === '1') {
      if (!isAdminSession(req)) return NextResponse.json({ error: 'Acesso restrito ao admin.' }, { status: 403 });
      const { data, error } = await supabase
        .from('products')
        .select('id, nome, preco_venda, preco_minimo')
        .eq('ativo', true)
        .order('nome', { ascending: true });
      if (error) return NextResponse.json({ error: 'Erro ao carregar produtos.' }, { status: 500 });
      return NextResponse.json({ ok: true, produtos: (data || []).map((p: any) => ({ id: p.id, nome: p.nome || 'Produto', precoVenda: Number(p.preco_venda || 0), precoMinimo: Number(p.preco_minimo || 0) })) });
    }

    // Bloco 5 ainda nao rodou: responde vazio + flag para a UI avisar,
    // em vez de 500 (a aba Entregas nao pode derrubar o resto do app).
    if (!(await hasEntregaTables())) {
      return NextResponse.json({
        hoje: todayStr(), rotas: [], rota: null, paradas: [],
        pendentes: { count: 0, valor: 0 }, migracaoPendente: true,
      });
    }

    // ---------- BLOCO 13: fila continua ----------
    if (url.searchParams.get('fila') === '1') {
      const fila = await getFila(supabase, session.sub, session.perfil);

      // Caixa do dia: entregador ve o dele; admin ve todos + status de confirmacao
      if (url.searchParams.get('caixa') === '1') {
        if (session.perfil === 'ENTREGADOR') {
          const { data: fech } = await supabase
            .from('caixa_fechamentos')
            .select('*')
            .eq('entregador_id', session.sub)
            .eq('data', todayStr())
            .maybeSingle();
          return NextResponse.json({ ...fila, meuFechamento: fech || null });
        }
        if (session.perfil === 'ADMIN') {
          const { data: fechs } = await supabase
            .from('caixa_fechamentos')
            .select('*')
            .eq('data', todayStr())
            .order('criado_em', { ascending: false });
          return NextResponse.json({ ...fila, fechamentosHoje: fechs || [] });
        }
      }
      return NextResponse.json(fila);
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
    const bridged = await devBridge(req);
    if (bridged) return bridged;
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
    // BLOCO 23: obsoleto — o padrao da PV agora e FIXO (5%) e a comissao de
    // cada produto manda (lib/comissaoPv). Mantido por compatibilidade:
    // responde ok sem gravar, para nunca travar um cliente antigo.
    if (acao === 'SET_CONFIG') {
      if (!admin) return NextResponse.json({ ok: false, error: 'Acesso restrito ao admin.' }, { status: 403 });
      return NextResponse.json({ ok: true, comissaoPct: COMISSAO_PV_DEFAULT, aviso: 'Padrao fixo a partir do Bloco 23 — comissao por produto manda.' });
    }

    // ---------- ORDEM_ENTREGA (BLOCO 31: admin define a ordem da rota com setas) ----------
    // Recebe a fila inteira reordenada [{ saleId, ordem }] (1..N). A ordem fica
    // gravada em sales.ordem_entrega e manda na fila e na impressao da lista.
    // (ANTES do guard de saleId: a acao manda a fila inteira, nao uma venda)
    if (acao === 'ORDEM_ENTREGA') {
      if (!admin) return NextResponse.json({ ok: false, error: 'Somente o admin define a ordem da rota.' }, { status: 403 });
      if (!(await hasOrdemEntregaColumn())) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 31 do SQL (ordem_entrega).' }, { status: 503 });
      }
      const ordens = Array.isArray(body.ordens) ? body.ordens : [];
      if (ordens.length === 0 || ordens.length > 500) {
        return NextResponse.json({ ok: false, error: 'Lista de ordem invalida.' }, { status: 400 });
      }
      const ids = ordens.map((o: any) => String(o.saleId || '')).filter(Boolean);
      const { data: entregues } = await supabase.from('sales').select('id').in('id', ids).eq('entrega_status', 'ENTREGUE');
      if (entregues && entregues.length > 0) {
        return NextResponse.json({ ok: false, error: 'Ha pedido ja entregue na lista — recarregue a fila.' }, { status: 409 });
      }
      // BLOCO 32 (velocidade): antes gravava UM update POR VEZ em sequencia —
      // com 30 paradas eram 30 round-trips (5-15s) e as setas travavam.
      // Agora: updates EM PARALELO (Promise.allSettled) + o cliente manda so
      // o DELTA (pares que mudaram) -> 1-2 round-trips, resposta em ~200ms.
      // Egress igual de baixo: payload de 1 int por venda.
      const resultados = await Promise.allSettled(
        ordens.map((o: any) => {
          const ordem = Math.max(1, Math.min(9999, Number(o.ordem || 0)));
          if (!o.saleId) return Promise.resolve({ error: null });
          return supabase.from('sales').update({ ordem_entrega: ordem }).eq('id', String(o.saleId));
        })
      );
      const falha = resultados.find(r => r.status === 'rejected' || (r.status === 'fulfilled' && (r.value as any)?.error));
      if (falha) {
        const msg = falha.status === 'rejected' ? String(falha.reason || '') : String((falha.value as any)?.error?.message || '');
        return NextResponse.json({ ok: false, error: msg || 'Erro ao gravar a ordem.' }, { status: 500 });
      }
      // BLOCO 59: log de auditoria NAO bloqueia a resposta (o admin ve o toast
      // na hora; se o log falhar, nao afeta a ordem gravada).
      logEventoSeguro(supabase, null, null, userId, 'ORDEM_ENTREGA', `Ordem da rota definida pelo admin (${ordens.length} paradas)`).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    // ---------- CHECK_CARGA (BLOCO 58: admin marca o pedido CARREGADO no veiculo) ----------
    // Na fila podera haver pedidos carregados e outros ainda nao — o check
    // mostra quantos estao no veiculo e qual esta carregado.
    if (acao === 'CHECK_CARGA') {
      if (!admin) return NextResponse.json({ ok: false, error: 'Somente o admin marca a carga.' }, { status: 403 });
      const saleIdCarga = String(body.saleId || '');
      if (!saleIdCarga) return NextResponse.json({ ok: false, error: 'saleId obrigatoria.' }, { status: 400 });
      if (!(await hasCargaCheckColumns())) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 58 do SQL (check de carga).' }, { status: 503 });
      }
      const carregado = !!body.carregado;
      // carga_confirmada_por e uuid: resolve pseudo-usuarios (login fixo) para
      // um uuid real/fixo — senao o update inteiro quebraria com 22P02.
      const porUuid = carregado ? await resolveEntregadorUuid(supabase, userId) : null;
      const payload: Record<string, unknown> = carregado
        ? { carga_confirmada_em: new Date().toISOString(), ...(porUuid ? { carga_confirmada_por: porUuid } : {}) }
        : { carga_confirmada_em: null, carga_confirmada_por: null };
      const { error: cargaErr } = await supabase.from('sales').update(payload).eq('id', saleIdCarga);
      const codeCarga = (cargaErr as any)?.code || '';
      if (cargaErr && (codeCarga === '42P01' || codeCarga === '42501' || codeCarga === 'PGRST204' || codeCarga === '42703' || codeCarga === '22P02')) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 58 do SQL (check de carga).' }, { status: 503 });
      }
      if (cargaErr) throw cargaErr;
      await logEventoSeguro(supabase, null, saleIdCarga, userId, carregado ? 'CARGA_OK' : 'CARGA_REMOVIDA', carregado ? 'Pedido carregado no veiculo (check do admin)' : 'Check de carga removido pelo admin');
      return NextResponse.json({ ok: true, carregado });
    }

    // ---------- FECHAR_CAIXA (BLOCO 33: SOMENTE O ADMIN fecha o caixa) ----------
    // ANTES do guard de saleId: esta acao nao tem venda associada. Antes o
    // entregador fechava e o guard "saleId obrigatoria" engolia o POST (bug
    // reportado pelo dono) — e a regra mudou: quem fecha e o ADMIN.
    // O fechamento do admin ja NASCE CONFIRMADO (quem digitou o dinheiro e o admin).
    if (acao === 'FECHAR_CAIXA') {
      if (!admin) return NextResponse.json({ ok: false, error: 'Somente o admin fecha o caixa.' }, { status: 403 });
      const valorDinheiro = round2(Number(body.valorDinheiro) || 0);
      const valorPix = round2(Number(body.valorPix) || 0);
      const qtdEntregas = Math.max(0, Math.floor(Number(body.qtdEntregas) || 0));
      const obs = String(body.obs || '').slice(0, 300) || null;
      // entregador alvo: uuid do seletor (grupos da conferencia). Sem uuid
      // (legado), tenta resolver pelo proprio usuario e depois pelo perfil.
      let entUuid = await resolveEntregadorUuid(supabase, String(body.entregadorId || ''));
      if (!entUuid) entUuid = await resolveEntregadorUuid(supabase, userId);
      if (!entUuid) {
        return NextResponse.json({ ok: false, error: 'Nao foi possivel identificar o entregador do caixa. Crie um usuario Entregador real no menu Usuarios.' }, { status: 400 });
      }
      const { error: caixaErr } = await supabase
        .from('caixa_fechamentos')
        .upsert({
          entregador_id: entUuid,
          data: todayStr(),
          valor_dinheiro: valorDinheiro,
          valor_pix: valorPix,
          qtd_entregas: qtdEntregas,
          obs,
          confirmado: true,
          confirmado_por: userId,
          confirmado_em: new Date().toISOString(),
        }, { onConflict: 'entregador_id,data' });
      const code = (caixaErr as any)?.code || '';
      if (caixaErr && (code === '42P01' || code === '42501' || code === 'PGRST204' || code === '42703')) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 13 do SQL (caixa_fechamentos).' }, { status: 503 });
      }
      if (caixaErr) throw caixaErr;
      await logEventoSeguro(supabase, null, null, userId, 'CAIXA_FECHADO', `Admin fechou o caixa — Dinheiro: R$ ${valorDinheiro.toFixed(2)} · Pix: R$ ${valorPix.toFixed(2)} · ${qtdEntregas} entregas`);
      return NextResponse.json({ ok: true });
    }

    // ---------- CONFIRMAR_CAIXA (fechamentos antigos que nasceram nao confirmados) ----------
    if (acao === 'CONFIRMAR_CAIXA') {
      if (!admin) return NextResponse.json({ ok: false, error: 'Acesso restrito ao admin.' }, { status: 403 });
      const caixaId = String(body.caixaId || '');
      if (!caixaId) return NextResponse.json({ ok: false, error: 'caixaId obrigatorio.' }, { status: 400 });
      const { error: confErr } = await supabase
        .from('caixa_fechamentos')
        .update({ confirmado: true, confirmado_por: userId, confirmado_em: new Date().toISOString() })
        .eq('id', caixaId);
      const code = (confErr as any)?.code || '';
      if (confErr && (code === '42P01' || code === '42501' || code === 'PGRST204' || code === '42703')) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o Bloco 13 do SQL (caixa_fechamentos).' }, { status: 503 });
      }
      if (confErr) throw confErr;
      return NextResponse.json({ ok: true });
    }

    // ---------- Acoes por parada ----------
    const saleId = String(body.saleId || '');
    if (!saleId) return NextResponse.json({ ok: false, error: 'saleId obrigatoria.' }, { status: 400 });

    const { data: sale } = await supabase.from('sales').select(`${FILA_COLS_13}`).eq('id', saleId).maybeSingle();

    // Fallback sem colunas do Bloco 13 (inclui tipo_venda para os guards)
    let saleRow: any = sale;
    if (!saleRow) {
      const alt = await supabase.from('sales').select(`${SALE_COLS}, tipo_venda`).eq('id', saleId).maybeSingle();
      saleRow = alt.data;
    }
    if (!saleRow) return NextResponse.json({ ok: false, error: 'Pedido nao encontrado.' }, { status: 404 });
    const venda13 = saleRow.tipo_venda === 'PRE_VENDA';

    // ---------- EDITAR_TROCAS (BLOCO 14: secretário ajusta as trocas no card) ----------
    // Caso de uso: faltou um item -> troca por outro do mesmo valor -> o cupom
    // precisa refletir a troca real que o cliente vai receber.
    if (acao === 'EDITAR_TROCAS') {
      if (!admin && session.perfil !== 'SECRETARIO') {
        return NextResponse.json({ ok: false, error: 'Somente o secretário da base ou o admin ajustam as trocas.' }, { status: 403 });
      }
      if (saleRow.entrega_status === 'ENTREGUE') {
        return NextResponse.json({ ok: false, error: 'Pedido ja entregue.' }, { status: 409 });
      }
      const melhorias = await getMelhorias(supabase);
      if (!melhorias.trocaSeparacao) {
        return NextResponse.json({ ok: false, error: 'Recurso desligado nas Configuracoes.' }, { status: 400 });
      }
      const trocas = String(body.trocas ?? '').slice(0, 500).trim();
      const r = await updateSaleFlex(supabase, saleId, { trocas: trocas || null });
      if (!r.ok) {
        return NextResponse.json({ ok: false, error: r.erro || 'Banco desatualizado: rode o Bloco 13 do SQL.' }, { status: r.sem13 ? 503 : 500 });
      }
      await logEventoSeguro(supabase, saleRow.route_id || null, saleId, userId, 'TROCAS', trocas ? `Trocas ajustadas: ${trocas}` : 'Trocas removidas');
      return NextResponse.json({ ok: true });
    }

    // ---------- SEPARAR / DESFAZER_SEPARADO (secretario da base + admin) ----------
    if (acao === 'SEPARAR' || acao === 'DESFAZER_SEPARADO') {
      if (!admin && session.perfil !== 'SECRETARIO') {
        return NextResponse.json({ ok: false, error: 'Somente o secretário da base ou o admin marcam separação.' }, { status: 403 });
      }
      if (!venda13) return NextResponse.json({ ok: false, error: 'Pedido invalido.' }, { status: 400 });
      if (saleRow.entrega_status === 'ENTREGUE') return NextResponse.json({ ok: false, error: 'Pedido ja entregue.' }, { status: 409 });
      const separar = acao === 'SEPARAR';
      const r = await updateSaleFlex(supabase, saleId, separar
        ? { separado: true, separado_em: new Date().toISOString() }
        : { separado: false, separado_em: null });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.sem13 ? 'Banco desatualizado: rode o Bloco 13 do SQL.' : (r.erro || 'Erro ao atualizar.') }, { status: r.sem13 ? 503 : 500 });
      await logEventoSeguro(supabase, saleRow.route_id || null, saleId, userId, separar ? 'SEPARADO' : 'SEPARACAO_DESFEITA', separar ? 'Pedido separado na base' : 'Separação desfeita');
      return NextResponse.json({ ok: true });
    }

    // ---------- PRIORIDADE (P1/P2/normal — admin e entregador) ----------
    if (acao === 'PRIORIDADE') {
      if (!admin && session.perfil !== 'ENTREGADOR') {
        return NextResponse.json({ ok: false, error: 'Somente admin ou entregador mudam a prioridade.' }, { status: 403 });
      }
      if (!venda13) return NextResponse.json({ ok: false, error: 'Pedido invalido.' }, { status: 400 });
      const prioridade = Number(body.prioridade);
      if (![0, 1, 2].includes(prioridade)) return NextResponse.json({ ok: false, error: 'Prioridade invalida (0, 1 ou 2).' }, { status: 400 });
      if (saleRow.entrega_status === 'ENTREGUE') return NextResponse.json({ ok: false, error: 'Pedido ja entregue.' }, { status: 409 });
      const r = await updateSaleFlex(supabase, saleId, { prioridade });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.sem13 ? 'Banco desatualizado: rode o Bloco 13 do SQL.' : (r.erro || 'Erro ao atualizar.') }, { status: r.sem13 ? 503 : 500 });
      const label = prioridade === 1 ? 'PRIORIDADE 1' : prioridade === 2 ? 'PRIORIDADE 2' : 'prioridade normal';
      await logEventoSeguro(supabase, saleRow.route_id || null, saleId, userId, 'PRIORIDADE', `Definido: ${label}`);
      return NextResponse.json({ ok: true, prioridade });
    }

    // ---------- EDITAR_PEDIDO (BLOCO 31: admin edita o pedido antes da entrega) ----------
    // Itens (qtd/preco/adicionar/remover), condicao e forma de pagamento.
    // Somente PRE_VENDA nao entregue — o estoque da pre-venda baixa na
    // entrega, entao editar antes nao mexe no estoque (trigger inofensivo).
    // Comissao: nasce na entrega com o valor do pedido editado (sem ajuste aqui).
    if (acao === 'EDITAR_PEDIDO') {
      if (!admin) return NextResponse.json({ ok: false, error: 'Somente o admin edita pedidos.' }, { status: 403 });
      if (saleRow.entrega_status === 'ENTREGUE') {
        return NextResponse.json({ ok: false, error: 'Pedido ja entregue — nao pode mais ser editado.' }, { status: 409 });
      }
      if (saleRow.tipo_venda !== 'PRE_VENDA') {
        return NextResponse.json({ ok: false, error: 'Edicao disponivel apenas para pre-venda.' }, { status: 400 });
      }
      const rawItens = Array.isArray(body.itens) ? body.itens : [];
      const itens = rawItens
        .map((i: any) => ({ produtoId: String(i.produtoId || ''), quantidade: Number(i.quantidade || 0), precoVenda: Number(i.precoVenda ?? 0) }))
        .filter((i: any) => i.produtoId && i.quantidade > 0 && i.precoVenda >= 0);
      if (itens.length === 0) return NextResponse.json({ ok: false, error: 'Pedido precisa de pelo menos 1 item.' }, { status: 400 });

      // Produtos existem?
      const pids = [...new Set(itens.map((i: any) => i.produtoId))];
      const { data: prods, error: perr } = await supabase.from('products').select('id, nome, preco_venda').in('id', pids);
      if (perr) return NextResponse.json({ ok: false, error: perr.message }, { status: 500 });
      if (!prods || prods.length !== pids.length) {
        return NextResponse.json({ ok: false, error: 'Produto invalido no pedido.' }, { status: 400 });
      }

      const valorTotal = round2(itens.reduce((a: number, i: any) => a + i.quantidade * i.precoVenda, 0));

      // Pagamento no MESMO formato da API de venda (a fila parseia do detalhe)
      const condicao = String(body.condicao || '').toUpperCase() === 'APRAZO' ? 'APRAZO' : 'AVISTA';
      const pagoNaVisita = body.pagoNaVisita === true && condicao === 'AVISTA';
      const formasValidas = condicao === 'APRAZO' ? ['DINHEIRO', 'PIX', 'BOLETO', 'CHEQUE'] : ['DINHEIRO', 'PIX'];
      const formaRaw = String(body.formaPagamento || '').toUpperCase();
      const forma = (formasValidas.includes(formaRaw) ? formaRaw : 'DINHEIRO') as string;
      const formaLabel = forma === 'PIX' ? 'PIX' : forma === 'BOLETO' ? 'BOLETO' : forma === 'CHEQUE' ? 'CHEQUE' : 'DINHEIRO';
      // Preserva a intencao de nota gravada no detalhe (" | COM NOTA: ...")
      const notaM = String(saleRow.detalhe_pagamento || '').match(/ \| COM NOTA:[\s\S]*/);
      const notaTxt = notaM ? notaM[0] : '';
      const etiquetaCond = condicao === 'APRAZO' ? 'A PRAZO' : 'A VISTA';
      let vencimentoIso: string | null = null;
      if (condicao === 'APRAZO') {
        const vRaw = String(body.vencimento || '');
        const vDate = vRaw ? new Date(`${vRaw}T23:59:59${OFF}`) : null;
        if (vDate && isFinite(vDate.getTime())) {
          vencimentoIso = vDate.toISOString();
        } else {
          const d = new Date();
          d.setDate(d.getDate() + 7);
          const dStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
          vencimentoIso = new Date(`${dStr}T23:59:59${OFF}`).toISOString();
        }
      }
      const upd: Record<string, unknown> = pagoNaVisita
        ? {
            valor_total: valorTotal, valor_pago: valorTotal,
            metodo_pagamento: forma === 'PIX' ? 'PIX' : 'DINHEIRO',
            detalhe_pagamento: `PAGO NA VISITA pelo vendedor (${formaLabel}) — entrega sem cobranca${notaTxt}`,
            status_pagamento: 'PAGO', data_vencimento: null,
          }
        : {
            valor_total: valorTotal, valor_pago: 0,
            metodo_pagamento: 'A_PRAZO',
            detalhe_pagamento: `PRE-VENDA — cobrar ${forma} na entrega (${etiquetaCond})${notaTxt}`,
            status_pagamento: 'PENDENTE', data_vencimento: vencimentoIso,
          };

      // 1) atualiza a venda (itens intactos se falhar)
      const r = await updateSaleFlex(supabase, saleId, upd);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.erro || 'Erro ao atualizar o pedido.' }, { status: 500 });

      // 2) substitui os itens (rollback manual: re-insere os antigos se falhar)
      const { data: antigos } = await supabase.from('sale_items').select('produto_id, product_id, quantidade, preco_venda').eq('sale_id', saleId);
      const { error: delErr } = await supabase.from('sale_items').delete().eq('sale_id', saleId);
      if (delErr) return NextResponse.json({ ok: false, error: 'Falha ao substituir itens: ' + delErr.message }, { status: 500 });
      const { error: insErr } = await supabase.from('sale_items').insert(
        itens.map((i: any) => ({ sale_id: saleId, produto_id: i.produtoId, product_id: i.produtoId, quantidade: i.quantidade, preco_venda: i.precoVenda }))
      );
      if (insErr) {
        if (antigos && antigos.length > 0) {
          await supabase.from('sale_items').insert(
            antigos.map((a: any) => ({ sale_id: saleId, produto_id: a.produto_id, product_id: a.product_id || a.produto_id, quantidade: a.quantidade, preco_venda: a.preco_venda }))
          );
        }
        return NextResponse.json({ ok: false, error: 'Falha ao gravar itens — pedido anterior restaurado.' }, { status: 500 });
      }

      await logEventoSeguro(supabase, saleRow.route_id || null, saleId, userId, 'PEDIDO_EDITADO', `Pedido editado pelo admin: ${itens.length} itens, total R$ ${valorTotal.toFixed(2)}`);
      return NextResponse.json({ ok: true, valorTotal });
    }

    // ---------- EXCLUIR_VENDA ----------
    // Vendedor: somente o proprio pedido, registrado HOJE, ate as 11h59
    // (America/Sao_Paulo) e sem entrega confirmada. Admin: a qualquer hora.
    // A venda sai da rota de entrega (ou da fila de pendentes).
    if (acao === 'EXCLUIR_VENDA') {
      if (saleRow.entrega_status === 'ENTREGUE') {
        return NextResponse.json({ ok: false, error: 'Pedido ja entregue — exclusao indisponivel.' }, { status: 409 });
      }
      if (!admin) {
        if (session.perfil === 'ENTREGADOR') {
          return NextResponse.json({ ok: false, error: 'Entregador nao pode excluir pedidos.' }, { status: 403 });
        }
        if (saleRow.vendedor_id !== userId) {
          return NextResponse.json({ ok: false, error: 'Este pedido nao e seu.' }, { status: 403 });
        }
        const vendido = new Date(saleRow.data_venda);
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
      if (saleRow.route_id) {
        const { count } = await supabase
          .from('sales')
          .select('id', { count: 'exact', head: true })
          .eq('route_id', saleRow.route_id);
        await supabase.from('entrega_rotas').update({ total_paradas: count || 0 }).eq('id', saleRow.route_id);
        await logEvento(supabase, saleRow.route_id, null, userId, 'PEDIDO_EXCLUIDO', 'Pedido excluido da rota', lat, lng);
      }
      return NextResponse.json({ ok: true });
    }

    // ============================================================================
    // BLOCO 13: ENTREGUE / FALHOU / REABRIR — FILA CONTINUA (sem rota obrigatória)
    // REGRA DO DONO: vendedor NUNCA entrega — somente ENTREGADOR (e o admin).
    // ============================================================================
    const podeEntregar = admin || session.perfil === 'ENTREGADOR';
    if (acao === 'ENTREGUE' || acao === 'FALHOU' || acao === 'REABRIR') {
      if (!podeEntregar) {
        return NextResponse.json({ ok: false, error: 'Somente o ENTREGADOR confirma entregas. O vendedor nao entrega.' }, { status: 403 });
      }
    }
    const rotaIdRef = saleRow.route_id || null;

    if (acao === 'ENTREGUE') {
      if (saleRow.entrega_status === 'ENTREGUE') return NextResponse.json({ ok: false, error: 'Parada ja entregue.' }, { status: 409 });
      const pagamento = String(body.pagamento || 'DINHEIRO').toUpperCase();
      if (!['DINHEIRO', 'PIX', 'BOLETO', 'JA_PAGO', 'NAO_PAGO', 'MISTO'].includes(pagamento)) {
        return NextResponse.json({ ok: false, error: 'Forma de pagamento invalida.' }, { status: 400 });
      }

      // REGRA DO DONO: venda A PRAZO o ENTREGADOR NAO recebe dinheiro — o
      // VENDEDOR recebe na proxima visita. Entrega a prazo = foto, sem cobranca.
      const condAprezo = /A PRAZO/i.test(String(saleRow.detalhe_pagamento || ''));
      if (condAprezo && ['DINHEIRO', 'PIX', 'MISTO', 'JA_PAGO'].includes(pagamento)) {
        return NextResponse.json({ ok: false, error: 'Venda A PRAZO: o entregador nao cobra. O vendedor recebe na proxima visita — confirme a entrega apenas com a foto.' }, { status: 400 });
      }

      const total = Number(saleRow.valor_total || 0);
      const jaPago = Number(saleRow.valor_pago || 0);
      const restante = Math.max(0, round2(total - jaPago));

      // FOTO OBRIGATORIA: Pix (comprovante) e Boleto (documento) — regra do fluxo.
      const foto = typeof body.foto === 'string' && body.foto.startsWith('data:image') ? body.foto : null;
      if ((pagamento === 'PIX' || pagamento === 'BOLETO' || (condAprezo && pagamento === 'NAO_PAGO')) && !foto) {
        return NextResponse.json({
          ok: false,
          error: pagamento === 'PIX' ? 'Foto do comprovante Pix obrigatoria.' : pagamento === 'BOLETO' ? 'Foto do boleto obrigatoria.' : 'Foto da entrega obrigatoria (venda a prazo).',
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

      // PAGAMENTO MISTO (ex.: combinou a vista em dinheiro, mas na entrega o
      // cliente quer pagar metade em dinheiro e metade no Pix): o entregador
      // registra as duas partes e o sistema soma — a parte do Pix exige foto
      // do comprovante, igual ao Pix puro.
      let mistoDin = 0, mistoPix = 0;
      if (pagamento === 'MISTO') {
        mistoDin = round2(Number(body.valorDinheiro) || 0);
        mistoPix = round2(Number(body.valorPix) || 0);
        if (mistoDin < 0 || mistoPix < 0 || (mistoDin <= 0 && mistoPix <= 0)) {
          return NextResponse.json({ ok: false, error: 'Informe quanto recebeu em dinheiro e/ou no Pix.' }, { status: 400 });
        }
        if (round2(mistoDin + mistoPix) > restante + 0.005) {
          return NextResponse.json({ ok: false, error: `A soma (R$ ${(mistoDin + mistoPix).toFixed(2)}) passou do saldo de R$ ${restante.toFixed(2)}.` }, { status: 400 });
        }
        if (mistoPix > 0 && !foto) {
          return NextResponse.json({ ok: false, error: 'Foto do comprovante Pix obrigatoria (parte paga no Pix).' }, { status: 400 });
        }
        recebido = round2(mistoDin + mistoPix);
      }

      const updates: any = { entrega_status: 'ENTREGUE' };
      // REGRA DO DONO: a pre-venda so e EFETIVADA na entrega (aceite do
      // entregador ou do admin). A data da venda passa a ser a data da
      // entrega — e por essa data que a venda e a comissao entram no dia
      // ("o vendedor recebe a comissao das entregas efetivadas naquele dia").
      if (saleRow.tipo_venda === 'PRE_VENDA') {
        updates.data_venda = new Date().toISOString();
      }
      if (session.perfil === 'ENTREGADOR') {
        // sales.entregador_id e uuid: o login fixo "ENTREGADOR" nao e UUID —
        // gravar direto derruba o update e a entrega nunca é registrada.
        const entUuid = await resolveEntregadorUuid(supabase, userId);
        if (entUuid) updates.entregador_id = entUuid;
      }
      let eventoMotivo = '';
      const eventoFoto: string | null = foto;
      const stamp = carimboAgora();
      const detAtual = String(saleRow.detalhe_pagamento || 'PRE-VENDA');
      // BLOCO 22: a comissao so e gerada DEPOIS que o update da venda CONFIRMA
      // (antes ficava ANTES — se o update falhasse, a comissao existia mas a
      // venda nunca era marcada como entregue: "comissao caiu, venda nao caiu").
      let comissaoQuitada = false;

      if (pagamento === 'DINHEIRO' || pagamento === 'PIX' || pagamento === 'MISTO') {
        // Dinheiro/Pix/Misto: baixa o recebido (total ou PARCIAL) e cria a
        // comissao do vendedor AGORA — e aqui que a pre-venda entra no financeiro.
        const novoPago = round2(jaPago + recebido);
        const quitada = novoPago >= total - 0.005;
        updates.valor_pago = novoPago;
        updates.status_pagamento = quitada ? 'PAGO' : 'PENDENTE';
        // CHECK legado: metodo so aceita DINHEIRO/PIX/A_PRAZO — no misto grava
        // pela parte em dinheiro (a forma real completa fica no detalhe).
        updates.metodo_pagamento = pagamento === 'PIX' || (pagamento === 'MISTO' && mistoDin <= 0) ? 'PIX' : 'DINHEIRO';
        // Log no formato que o portal do cliente parseia (historico de recebimentos)
        updates.detalhe_pagamento = pagamento === 'MISTO'
          ? `${detAtual} | ${stamp}: R$ ${mistoDin.toFixed(2)} (dinheiro) + R$ ${mistoPix.toFixed(2)} (pix)${quitada ? '' : ' — parcial'}`
          : `${detAtual} | ${stamp}: R$ ${recebido.toFixed(2)} (${pagamento}${quitada ? '' : ' — parcial'})`;
        // Motivo SEMPRE com o valor explicito (o caixa do dia soma a partir dele)
        eventoMotivo = pagamento === 'MISTO'
          ? `Pagamento misto: dinheiro R$ ${mistoDin.toFixed(2)} + pix R$ ${mistoPix.toFixed(2)}`
          : quitada
            ? (pagamento === 'PIX' ? `Pagamento: PIX — R$ ${recebido.toFixed(2)} (comprovante foto)` : `Pagamento: dinheiro — R$ ${recebido.toFixed(2)}`)
            : `Pagamento parcial (${pagamento === 'PIX' ? 'pix' : 'dinheiro'}): R$ ${recebido.toFixed(2)} de R$ ${restante.toFixed(2)}`;
        comissaoQuitada = quitada;
      } else if (pagamento === 'BOLETO') {
        // Boleto entregue: entrega concluida, pagamento segue PENDENTE ate
        // o admin confirmar a compensacao. Foto do boleto obrigatoria.
        // ATENCAO: o banco legado tem CHECK em sales.metodo_pagamento (so
        // aceita DINHEIRO/PIX/A_PRAZO) — gravar 'BOLETO' viola a constraint e
        // DERRUBA o registro da entrega (500). Grava A_PRAZO (boleto e
        // cobranca a prazo); a forma real fica no detalhe_pagamento ("cobrar
        // BOLETO na entrega" + "boleto entregue"), que a fila parseia e mostra
        // o chip "Boleto" normalmente.
        updates.metodo_pagamento = 'A_PRAZO';
        updates.detalhe_pagamento = `${detAtual} | ${stamp}: boleto entregue (foto anexada)`;
        eventoMotivo = 'Boleto entregue — foto anexada (aguardando compensacao)';
        // BLOCO 14: comissão nasce A_RECEBER — só entra quando o boleto for pago
      } else if (pagamento === 'JA_PAGO') {
        updates.valor_pago = total;
        updates.status_pagamento = 'PAGO';
        updates.detalhe_pagamento = `${detAtual} | ${stamp}: R$ ${restante.toFixed(2)} (JA_PAGO)`;
        eventoMotivo = `Entregue — cliente ja havia pago (R$ ${restante.toFixed(2)})`;
        comissaoQuitada = true;
      } else {
        // NAO_PAGO: mantem PENDENTE para cobrar depois. NAO mexe em
        // metodo_pagamento — a venda a prazo continua listada no Contas a
        // Receber (admin e vendedor veem o saldo).
        updates.detalhe_pagamento = condAprezo
          ? `${detAtual} | ${stamp}: entrega a prazo${foto ? ' (foto anexada)' : ''} — cobranca com o vendedor`
          : `${detAtual} | ${stamp}: entregue sem pagamento`;
        eventoMotivo = condAprezo
          ? 'Entrega a prazo — sem cobranca (vendedor recebe na proxima visita)'
          : 'Entregue sem pagamento (a receber)';
        // BLOCO 14: comissão nasce A_RECEBER — entra quando o cliente pagar
      }

      const r = await updateSaleFlex(supabase, saleId, updates);
      if (!r.ok) {
        return NextResponse.json({ ok: false, error: 'Erro ao registrar a entrega. Tente novamente.' }, { status: 500 });
      }

      // BLOCO 22: comissão APÓS a confirmação da entrega — a comissão nunca
      // existe sem a venda entregue (idempotente: re-entrega atualiza a row).
      await registrarComissaoPreVenda(supabase, saleRow, comissaoQuitada);

      // Baixa do estoque principal (entregou = saiu do estoque central)
      try { await supabase.rpc('baixar_estoque_principal', { p_sale_id: saleId }); } catch (e) {
        console.error('[pre-venda] baixa estoque falhou:', (e as any)?.message);
      }

      await logEventoSeguro(supabase, rotaIdRef, saleId, userId, 'ENTREGUE', eventoMotivo, lat, lng, eventoFoto);
      if (rotaIdRef) await checarConclusao(supabase, rotaIdRef);

      // BLOCO 14: avisa o VENDEDOR da venda (interruptor nas Configuracoes)
      try {
        const melhorias = await getMelhorias(supabase);
        if (melhorias.pushEntrega) {
          const recebidoTxt = pagamento === 'BOLETO' ? 'boleto entregue (aguardando compensacao)'
            : pagamento === 'NAO_PAGO' ? (condAprezo ? `entregue a prazo — receba R$ ${restante.toFixed(2)} do cliente na proxima visita` : 'entregue — valor a receber')
            : pagamento === 'JA_PAGO' ? `entregue — R$ ${restante.toFixed(2)} (ja pago)`
            : pagamento === 'MISTO' ? `entregue — R$ ${recebido.toFixed(2)} recebidos (dinheiro + pix)`
            : `entregue — R$ ${recebido.toFixed(2)} recebidos`;
          const liberada = updates.status_pagamento === 'PAGO';
          await avisarVendedor(supabase, saleRow.vendedor_id, saleRow.client_id, 'Venda entregue \u2705', `${recebidoTxt}. Comissao ${liberada ? 'LIBERADA' : 'aguardando pagamento completo'}.`);
        }
      } catch { /* nunca trava a entrega */ }

      return NextResponse.json({ ok: true });
    }

    if (acao === 'FALHOU') {
      if (saleRow.entrega_status === 'ENTREGUE') return NextResponse.json({ ok: false, error: 'Parada ja entregue.' }, { status: 409 });
      const motivo = String(body.motivo || 'Nao entregue').slice(0, 140);
      const { error: upErr } = await supabase.from('sales').update({ entrega_status: 'FALHOU' }).eq('id', saleId);
      if (upErr) throw upErr;
      await logEventoSeguro(supabase, rotaIdRef, saleId, userId, 'FALHOU', motivo, lat, lng);
      if (rotaIdRef) await checarConclusao(supabase, rotaIdRef);

      // BLOCO 14: avisa o VENDEDOR que a entrega falhou (interruptor)
      try {
        const melhorias = await getMelhorias(supabase);
        if (melhorias.pushFalha) {
          await avisarVendedor(supabase, saleRow.vendedor_id, saleRow.client_id, 'Entrega nao realizada \u26a0\ufe0f', `nao entregue (${motivo}). Vale ligar pro cliente combinar.`);
        }
      } catch { /* nunca trava */ }

      return NextResponse.json({ ok: true });
    }

    if (acao === 'REABRIR') {
      // Fila continua: o pedido falhado VOLTA para a fila (PENDENTE) — nada se perde.
      const { error: upErr } = await supabase.from('sales').update({ entrega_status: 'PENDENTE' }).eq('id', saleId);
      if (upErr) throw upErr;
      await logEventoSeguro(supabase, rotaIdRef, saleId, userId, 'REABERTO', 'Pedido voltou para a fila', lat, lng);
      return NextResponse.json({ ok: true });
    }

    // ---------- PIX_QRCODE (QR Code do Pix na entrega — estilo portal) ----------
    if (acao === 'PIX_QRCODE') {
      if (session.perfil !== 'ADMIN' && session.perfil !== 'ENTREGADOR') {
        return NextResponse.json({ ok: false, error: 'Acesso restrito.' }, { status: 403 });
      }
      const qrSaleId = String(body.saleId || '');
      if (!qrSaleId) return NextResponse.json({ ok: false, error: 'saleId obrigatorio.' }, { status: 400 });
      const { data: qrSale } = await supabase
        .from('sales')
        .select('id, valor_total, valor_pago')
        .eq('id', qrSaleId)
        .limit(1)
        .maybeSingle();
      if (!qrSale) return NextResponse.json({ ok: false, error: 'Venda nao encontrada.' }, { status: 404 });
      const qrRestante = round2(Number(qrSale.valor_total || 0) - Number(qrSale.valor_pago || 0));
      if (qrRestante <= 0) {
        return NextResponse.json({ ok: false, error: 'Esta venda nao tem saldo em aberto.' }, { status: 400 });
      }
      let qrValor = round2(Number(body.valor) || 0);
      if (qrValor <= 0) qrValor = qrRestante;
      if (qrValor > qrRestante) {
        return NextResponse.json({ ok: false, error: `Valor maior que o saldo em aberto (R$ ${qrRestante.toFixed(2)}).` }, { status: 400 });
      }
      const pix = buildPixPayload(qrValor, generateTxid('DM'));
      const qrDataUrl = await QRCode.toDataURL(pix.payload, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
      return NextResponse.json({ ok: true, ...pix, qrDataUrl, valor: qrValor });
    }

    // BLOCO 33: FECHAR_CAIXA e CONFIRMAR_CAIXA foram movidos para ANTES do
    // guard de saleId (nao sao acoes por venda) e agora o caixa e fechado
    // SOMENTE pelo admin (regra do dono).

    return NextResponse.json({ ok: false, error: 'Acao desconhecida.' }, { status: 400 });
  } catch (e: any) {
    console.error('[api/pre-venda][POST] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro interno. Tente novamente.' }, { status: 500 });
  }
}
