import { NextRequest, NextResponse } from 'next/server';
import { compare } from 'bcryptjs';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { createSessionToken, sessionFromRequest } from '@/lib/session';
import {
  hasNotaColumns,
  hasModoVendaColumn,
  hasEntregaTables,
  hasBoletoColumns,
  hasNotaEmitidaEm,
  hasEstoqueBaixadoColumn,
} from '@/lib/serverSchema';
import { presencaArquivos, listarMetasAvulsas, NotaAvulsaMeta } from '@/lib/focusArquivos';
import { createShareToken } from '@/lib/shareLinks';

/**
 * BLOCO 140 — PORTAL DE NOTAS (admin, fora do app) — administração completa
 * das notas de SAÍDA (NF-e / NFC-e): lista horizontal com DANFE (PDF), XML,
 * cliente, vendedor, data, valor e pagamento; e ações EDITAR / CLONAR.
 * EMITIR / CONSULTAR / CANCELAR reutilizam /api/notas (o token deste portal
 * nasce com perfil ADMIN — a rota fiscal já aceita).
 *
 * POST /api/notas-admin  { acao: 'AUTH', pin }              -> token ADMIN
 *                        { acao: 'EDITAR', saleId, patch }  -> metodo/detalhe do registro
 *                        { acao: 'CLONAR', saleId }         -> nova venda igual (sem nota)
 * GET  /api/notas-admin?acao=lista                        -> todas as notas (mais recentes primeiro)
 * GET  /api/notas-admin?acao=detalhe&id=...               -> venda + itens + cliente (ver o que foi pedido)
 *
 * AUTH: mesmo modelo do /api/login — o PIN é comparado com bcrypt contra os
 * usuarios ADMIN ativos (pin_hash). Nunca devolve hash. Rate limit em memória.
 *
 * Segurança: todas as ações (exceto AUTH) exigem sessão ADMIN válida (Bearer).
 * O XML/PDF autorizado pela SEFAZ NUNCA muda por aqui — o portal administra o
 * REGISTRO interno (pagamento/detalhe) e a vida da nota (emitir/consultar/
 * cancelar/clonar), igual a SEFAZ permite.
 */

const BAD = (status: number, erro: string) =>
  NextResponse.json({ ok: false, erro }, { status });

// ---------- rate limit do AUTH (mesmo padrao do /api/login) ----------
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

function clearAttempts(ip: string) {
  attempts.delete(ip);
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

// ---------- shape publica da nota (lista/detalhe do portal) ----------
const BASE_COLS = 'id, vendedor_id, client_id, valor_total, valor_pago, metodo_pagamento, detalhe_pagamento, status_pagamento, data_venda';

interface LinhaNota {
  id: string;
  numero: string;
  tipo: string;
  status: string;
  ref: string;
  pdfUrl: string;
  xmlUrl: string;
  erro: string;
  chave: string;
  emitidaEm: string | null;
  valor: number;
  valorPago: number;
  metodo: string;
  detalhe: string;
  statusPagamento: string;
  dataVenda: string;
  modoNota: string;
  cliente: string;
  clienteDoc: string;
  clienteId: string;
  vendedor: string;
  // BLOCO 141: arquivos arquivados NO NOSSO sistema (bucket notas-fiscais)
  pdfLocal: boolean;
  xmlLocal: boolean;
  // nota avulsa (emitida fora do app, importada da Focus pelo BLOCO 141)
  avulsa?: boolean;
  // BLOCO 143: origem da avulsa ('FOCUS' | 'XML') — o portal mostra o badge
  origem?: string;
  // BLOCO 143: boleto bancário (Inter) da venda — aparece nas AÇÕES do portal
  boletoStatus?: string;
  boletoVencimento?: string;
}

function linhaNota(
  s: Record<string, unknown>,
  cliente: { nome?: string; cnpj?: string } | undefined,
  vendedor: string,
  presenca?: { pdf: boolean; xml: boolean; can: boolean },
): LinhaNota {
  return {
    id: String(s.id),
    numero: String(s.nota_numero || ''),
    tipo: String(s.nota_tipo || ''),
    status: String(s.nota_status || 'NAO_EMITIDA'),
    ref: String(s.nota_ref || ''),
    pdfUrl: String(s.nota_pdf_url || ''),
    xmlUrl: String(s.nota_xml_url || ''),
    erro: String(s.nota_erro || ''),
    chave: String(s.nota_chave || ''),
    emitidaEm: (s.nota_emitida_em as string) || null,
    valor: Number(s.valor_total) || 0,
    valorPago: Number(s.valor_pago) || 0,
    metodo: String(s.metodo_pagamento || ''),
    detalhe: String(s.detalhe_pagamento || ''),
    statusPagamento: String(s.status_pagamento || ''),
    dataVenda: String(s.data_venda || ''),
    modoNota: String(s.modo_nota || ''),
    cliente: String(cliente?.nome || 'Cliente'),
    clienteDoc: String(cliente?.cnpj || ''),
    clienteId: String(s.client_id || ''),
    vendedor,
    pdfLocal: !!presenca?.pdf,
    xmlLocal: !!presenca?.xml,
    avulsa: false,
    boletoStatus: String(s.inter_boleto_status || ''),
    boletoVencimento: String(s.inter_boleto_vencimento || ''),
  };
}

/** BLOCO 141: avulsa (fora do app) -> mesma forma da linha da tabela. */
function linhaAvulsa(m: NotaAvulsaMeta, presenca?: { pdf: boolean; xml: boolean; can: boolean }): LinhaNota {
  const autorizada = m.status === 'AUTORIZADO';
  return {
    id: `AVULSA-${m.ref}`,
    numero: m.numero,
    tipo: m.doc,
    status: autorizada ? 'AUTORIZADA' : m.status.startsWith('CANCELADO') ? 'CANCELADA' : m.status || 'AUTORIZADA',
    ref: m.ref,
    pdfUrl: '',
    xmlUrl: '',
    erro: '',
    chave: m.chave,
    emitidaEm: m.dataAutorizacao || m.dataEmissao || null,
    valor: m.valor,
    valorPago: m.valor,
    metodo: m.pagamento,
    detalhe: '',
    statusPagamento: '',
    dataVenda: m.dataEmissao || m.importadoEm,
    modoNota: '',
    cliente: m.cliente || 'CONSUMIDOR NAO IDENTIFICADO',
    clienteDoc: m.clienteDoc,
    clienteId: '',
    vendedor: m.vendedor || (m.origem === 'XML' ? 'XML de terceiro' : '— fora do app —'),
    pdfLocal: !!presenca?.pdf,
    xmlLocal: !!presenca?.xml,
    avulsa: true,
    origem: String(m.origem || 'FOCUS'),
  };
}

async function nomesDe(ids: string[], tabela: 'clients' | 'app_users'): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return map;
  const cols = tabela === 'clients' ? 'id, nome_fantasia, nome, cnpj' : 'id, nome';
  const { data } = await getServiceClient()
    .from(tabela)
    .select(cols as unknown as string)
    .in('id', ids);
  for (const r of ((data || []) as unknown) as Record<string, unknown>[]) map.set(String(r.id), r);
  return map;
}

async function carregarVendasComNotas(): Promise<LinhaNota[]> {
  // temBoleto (hasBoletoColumns) também porta a coluna nota_chave — mesma
  // dupla de probes do Bloco 25/141 (a nota_chave chegou junto com o boleto).
  const [temNota, temModo, temEmitida, temBoleto] = await Promise.all([
    hasNotaColumns(),
    hasModoVendaColumn(),
    hasNotaEmitidaEm(),
    hasBoletoColumns(),
  ]);
  if (!temNota) return [];

  const sel = [
    BASE_COLS,
    ', nota_status, nota_tipo, nota_numero, nota_ref, nota_pdf_url, nota_xml_url, nota_erro',
    temEmitida ? ', nota_emitida_em' : '',
    temBoleto ? ', nota_chave' : '',
    temModo ? ', modo_nota' : '',
    temBoleto ? ', inter_boleto_status, inter_boleto_vencimento' : '',
  ].join('');

  // BLOCO 143 (regra do dono): "quando clico em TODAS ele me diz que falta NF
  // a bater, elas ja foram batidas em outro sistema — EXCLUA ISSO! deixe
  // somente o que vc buscou pela API". A lista do portal agora tem SOMENTE
  // documentos fiscais reais: venda com nota_ref gravada (autorizada,
  // cancelada, emitindo ou rejeitada — tudo passou pela API da Focus).
  // Venda sem emissão (NAO_EMITIDA, mera intenção) NÃO entra mais — quem
  // resolve pendência continua com a aba NOTAS PENDENTES do app.
  void temModo;
  let q = getServiceClient().from('sales').select(sel).order('data_venda', { ascending: false }).limit(400);
  q = q.not('nota_ref', 'is', null);
  const { data, error } = await q;
  if (error || !data) return [];

  const rows = (data as unknown) as Record<string, unknown>[];
  const clientes = await nomesDe([...new Set(rows.map(r => String(r.client_id || '')))].filter(Boolean), 'clients');
  const vendedores = await nomesDe([...new Set(rows.map(r => String(r.vendedor_id || '')))].filter(Boolean), 'app_users');
  // BLOCO 141: arquivos arquivados no nosso storage (cache 30s na lib)
  const presenca = await presencaArquivos();
  const rowsLinha = rows.map(r => {
    const c = clientes.get(String(r.client_id || ''));
    const v = vendedores.get(String(r.vendedor_id || ''));
    const nomeCliente = String(c?.nome_fantasia || c?.nome || 'Cliente');
    const ref = String(r.nota_ref || '');
    const doc = String(r.nota_tipo || '').toUpperCase() === 'NFCE' ? 'NFCE' : 'NFE';
    const p = ref ? presenca.get(`${doc}/${ref}`) : undefined;
    return linhaNota(r, { nome: nomeCliente, cnpj: c?.cnpj as string }, String(v?.nome || ''), p);
  });

  // BLOCO 141: notas AVULSAS (emitidas fora do app — importadas da Focus)
  const metas = await listarMetasAvulsas();
  const avulsas = metas.map(m => linhaAvulsa(m, presenca.get(`${m.doc}/${m.ref}`)));

  // REGRA DO DONO ("de cima pra baixo sempre deixaremos a ULTIMA NOTA BATIDA
  // em primeiro lugar"): a lista mistura vendas do app e avulsas (Focus/XML)
  // ordenadas pelo momento em que a nota foi BATIDA na SEFAZ (nota_emitida_em;
  // fallback: data da venda / emissão da avulsa). Antes as avulsas entravam
  // sempre em cima — uma nota velha importada hoje ficava no topo da lista.
  const tudo = [...avulsas, ...rowsLinha];
  const batidaEm = (n: LinhaNota): string => String(n.emitidaEm || n.dataVenda || '');
  tudo.sort((a, b) => batidaEm(b).localeCompare(batidaEm(a)));
  return tudo;
}

export async function GET(req: NextRequest) {
  // Preview/bridge primeiro (padrao do projeto): no sandbox quem responde e a producao.
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponivel.');
  }
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Entre com o PIN novamente.');
  if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin acessa este portal.');

  const db = getServiceClient();
  const acao = req.nextUrl.searchParams.get('acao') || 'lista';

  // ---------- LISTA ----------
  if (acao === 'lista') {
    const notas = await carregarVendasComNotas();
    return NextResponse.json({ ok: true, notas });
  }

  // ---------- LINKS DE COMPARTILHAMENTO (WhatsApp — BLOCO 146) ----------
  // Gera links assinados + expirantes (7 dias) do DANFE/XML para ENVIAR AO
  // CLIENTE: não expõem a sessão do admin — só baixam o arquivo daquela nota.
  if (acao === 'links') {
    const id = req.nextUrl.searchParams.get('id') || '';
    const refParam = req.nextUrl.searchParams.get('ref') || '';
    const docParam = (req.nextUrl.searchParams.get('doc') || '').toLowerCase();
    const origem = req.nextUrl.origin;
    const fazer = (t: { saleId?: string; ref?: string; doc?: 'nfe' | 'nfce' }): Record<string, string> => {
      const tok = createShareToken(t);
      const q = `token=${encodeURIComponent(tok)}`;
      return {
        pdf: `${origem}/api/notas-compartilhar?${q}&tipo=pdf`,
        xml: `${origem}/api/notas-compartilhar?${q}&tipo=xml`,
      };
    };
    if (id) {
      const { data: sale, error } = await db.from('sales').select('id, nota_ref, nota_tipo').eq('id', id).single();
      if (error || !sale) return BAD(404, 'Venda nao encontrada.');
      if (!String(sale.nota_ref || '')) return BAD(422, 'Esta venda ainda nao tem nota emitida — nada para compartilhar.');
      return NextResponse.json({ ok: true, links: fazer({ saleId: id }) });
    }
    if (refParam && (docParam === 'nfe' || docParam === 'nfce')) {
      const doc: 'nfe' | 'nfce' = docParam === 'nfce' ? 'nfce' : 'nfe';
      return NextResponse.json({ ok: true, links: fazer({ ref: refParam, doc }) });
    }
    return BAD(400, 'Parametros ausentes (id ou ref+doc).');
  }

  // ---------- DETALHE (venda + itens + cliente — "o que foi pedido") ----------
  if (acao === 'detalhe') {
    const id = req.nextUrl.searchParams.get('id') || '';
    if (!id) return BAD(400, 'Parametro ausente (id).');

    const [temNota, temModo, temEmitida, temChave] = await Promise.all([
      hasNotaColumns(),
      hasModoVendaColumn(),
      hasNotaEmitidaEm(),
      hasBoletoColumns(),
    ]);
    const sel = [
      BASE_COLS,
      temNota ? ', nota_status, nota_tipo, nota_numero, nota_ref, nota_pdf_url, nota_xml_url, nota_erro' : '',
      temEmitida ? ', nota_emitida_em' : '',
      temChave ? ', nota_chave' : '',
      temModo ? ', modo_nota' : '',
    ].join('');
    const { data: sale, error } = await db.from('sales').select(sel as unknown as string).eq('id', id).single();
    if (error || !sale) return BAD(404, 'Venda nao encontrada.');
    const s = (sale as unknown) as Record<string, unknown>;

    const [{ data: client }, { data: items }] = await Promise.all([
      db.from('clients').select('id, nome_fantasia, nome, cnpj, razao_social, inscricao_estadual, telefone, endereco, bairro, endereco_numero, endereco_cep, endereco_municipio, endereco_uf, email').eq('id', String(s.client_id || '')).single(),
      db.from('sale_items').select('produto_id, quantidade, preco_venda').eq('sale_id', id),
    ]);

    const itens = ((items || []) as unknown) as Record<string, unknown>[];
    const prodIds = [...new Set(itens.map(i => String(i.produto_id || '')))].filter(Boolean);
    const { data: prods } = prodIds.length > 0
      ? await db.from('products').select('id, nome').in('id', prodIds)
      : { data: [] as Record<string, unknown>[] | null };
    const prodMap = new Map((((prods || []) as unknown) as Record<string, unknown>[]).map(p => [String(p.id), String(p.nome || 'Produto')]));

    const vendedores = await nomesDe(s.vendedor_id ? [String(s.vendedor_id)] : [], 'app_users');
    const nota = temNota
      ? linhaNota(s, { nome: String(client?.nome_fantasia || client?.nome || ''), cnpj: client?.cnpj as string }, String(vendedores.get(String(s.vendedor_id || ''))?.nome || ''))
      : null;

    return NextResponse.json({
      ok: true,
      nota,
      cliente: client || null,
      itens: itens.map(i => ({
        produto: prodMap.get(String(i.produto_id || '')) || 'Produto',
        quantidade: Number(i.quantidade) || 0,
        preco: Number(i.preco_venda) || 0,
      })),
    });
  }

  return BAD(400, `Acao desconhecida: ${acao}`);
}

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponivel.');
  }

  const body = await req.json().catch(() => ({}));
  const acao = String(body.acao || '');

  // ---------- AUTH (PIN do admin — igual tela de login do app) ----------
  if (acao === 'AUTH') {
    const ip = clientIp(req);
    if (!checkRateLimit(ip)) return BAD(429, 'Muitas tentativas. Aguarde alguns minutos.');

    const pin = String(body.pin || '').trim();
    if (!/^\d{4,8}$/.test(pin)) return BAD(400, 'PIN invalido.');

    const { data: admins, error } = await getServiceClient()
      .from('app_users')
      .select('id, nome, perfil, ativo, pin_hash')
      .eq('perfil', 'ADMIN')
      .eq('ativo', true);

    if (error || !admins || admins.length === 0) {
      return BAD(401, 'PIN incorreto. Tente novamente.');
    }

    for (const u of admins as unknown as { id: string; nome: string; pin_hash: string }[]) {
      if (!u.pin_hash) continue;
      if (await compare(pin, u.pin_hash)) {
        clearAttempts(ip);
        return NextResponse.json({
          ok: true,
          token: createSessionToken(u.id, 'ADMIN'),
          nome: u.nome || 'Admin',
        });
      }
    }
    return BAD(401, 'PIN incorreto. Tente novamente.');
  }

  // A partir daqui: sessao ADMIN obrigatoria (o token do portal nasce ADMIN).
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Entre com o PIN novamente.');
  if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin acessa este portal.');

  const db = getServiceClient();

  // ---------- EDITAR (registro interno — pagamento; o XML fiscal nao muda) ----------
  if (acao === 'EDITAR') {
    const saleId = String(body.saleId || '');
    if (!saleId) return BAD(400, 'Parametro ausente (saleId).');

    const patch: Record<string, unknown> = {};
    if (typeof body.metodoPagamento === 'string' && body.metodoPagamento.trim()) {
      const m = body.metodoPagamento.trim().toUpperCase();
      if (!['DINHEIRO', 'PIX', 'BOLETO', 'CHEQUE', 'A_PRAZO'].includes(m)) {
        return BAD(422, 'Forma de pagamento invalida.');
      }
      patch.metodo_pagamento = m;
    }
    if (typeof body.detalhe === 'string') {
      patch.detalhe_pagamento = body.detalhe.trim().slice(0, 500) || null;
    }
    if (Object.keys(patch).length === 0) return BAD(422, 'Nada para editar.');

    const { data: upd, error } = await db
      .from('sales')
      .update(patch)
      .eq('id', saleId)
      .select('id, metodo_pagamento, detalhe_pagamento')
      .single();
    if (error || !upd) return BAD(404, 'Venda nao encontrada (ou falha ao salvar).');
    return NextResponse.json({ ok: true, venda: upd as Record<string, unknown> });
  }

  // ---------- CLONAR (copia a venda p/ emitir o documento fiscal de novo) ----------
  if (acao === 'CLONAR') {
    const saleId = String(body.saleId || '');
    if (!saleId) return BAD(400, 'Parametro ausente (saleId).');

    const [temNota, temModo, temEntrega, temBaixado, temEmitida] = await Promise.all([
      hasNotaColumns(),
      hasModoVendaColumn(),
      hasEntregaTables(),
      hasEstoqueBaixadoColumn(),
      hasNotaEmitidaEm(),
    ]);

    const sel = [
      BASE_COLS,
      temNota ? ', nota_status, nota_tipo, nota_numero' : '',
      temModo ? ', modo_nota' : '',
      temEntrega ? ', tipo_venda' : '',
    ].join('');
    const { data: orig, error: origErr } = await db.from('sales').select(sel as unknown as string).eq('id', saleId).single();
    if (origErr || !orig) return BAD(404, 'Venda original nao encontrada.');
    const o = (orig as unknown) as Record<string, unknown>;

    const { data: itemsOrig } = await db.from('sale_items').select('produto_id, quantidade, preco_venda').eq('sale_id', saleId);
    const itens = ((itemsOrig || []) as unknown) as Record<string, unknown>[];
    if (itens.length === 0) return BAD(422, 'Venda sem itens — nao e possivel clonar.');

    const origCurta = String(saleId).slice(0, 8).toUpperCase();
    const detalheOrigem = String(o.detalhe_pagamento || '').slice(0, 380);

    const payload: Record<string, unknown> = {
      vendedor_id: o.vendedor_id || session.sub,
      client_id: o.client_id,
      valor_total: o.valor_total,
      valor_pago: o.valor_pago,
      metodo_pagamento: o.metodo_pagamento,
      status_pagamento: o.status_pagamento,
      detalhe_pagamento: `CLONE DO PEDIDO ${origCurta} (portal de notas) — ${detalheOrigem}`.slice(0, 500),
      data_venda: new Date().toISOString(),
    };
    if (temEntrega) {
      payload.tipo_venda = 'PRONTA'; // venda direta — NAO entra na fila de entrega
      if (o.data_vencimento) payload.data_vencimento = o.data_vencimento;
    }
    if (temBaixado) payload.estoque_baixado = true; // a copia NAO baixa estoque de novo
    if (temModo) {
      const modoOrig = String(o.modo_nota || '').toUpperCase();
      payload.modo_nota = ['NFE', 'NFCE'].includes(modoOrig)
        ? modoOrig
        : String(o.nota_tipo || '').toUpperCase() === 'NFE' ? 'NFE' : 'NFCE';
    }
    if (temNota) {
      payload.nota_status = 'NAO_EMITIDA';
      payload.nota_tipo = o.nota_tipo || null;
      payload.nota_numero = null;
      payload.nota_ref = null;
      payload.nota_pdf_url = null;
      payload.nota_xml_url = null;
      payload.nota_erro = null;
      if (temEmitida) payload.nota_emitida_em = null;
    }

    let nova: Record<string, unknown> | null = null;
    let novaErr: { message?: string } | null = null;
    {
      const r = await db.from('sales').insert(payload).select('id, valor_total, detalhe_pagamento').single();
      nova = (r.data as unknown) as Record<string, unknown> | null;
      novaErr = (r.error as unknown) as { message?: string } | null;
    }
    // Coluna que ainda nao existe no banco: tira e tenta de novo (padrao do projeto;
    // o supabase-js diz "Could not find the 'x' column of 'sales' in the schema cache")
    if (novaErr && novaErr.message) {
      const m = /'([a-z_]+)' column of/.exec(novaErr.message) || /column "([a-z_]+)" of relation/.exec(novaErr.message);
      const col = m?.[1];
      if (col && col in payload) {
        delete payload[col];
        const r = await db.from('sales').insert(payload).select('id, valor_total, detalhe_pagamento').single();
        nova = (r.data as unknown) as Record<string, unknown> | null;
        novaErr = (r.error as unknown) as { message?: string } | null;
      }
    }
    if (novaErr || !nova) {
      return BAD(500, `Falha ao clonar: ${novaErr?.message || 'erro desconhecido'}`);
    }

    const rows = itens.map(i => ({
      sale_id: nova!.id,
      produto_id: i.produto_id,
      // LEGADO: a tabela real tem product_id NOT NULL (mesma regra da pre-venda)
      product_id: i.produto_id,
      quantidade: i.quantidade,
      preco_venda: i.preco_venda,
    }));
    const { error: itensErr } = await db.from('sale_items').insert(rows);
    if (itensErr) {
      // Nao deixa pedido orfao sem itens no banco
      await db.from('sales').delete().eq('id', String(nova!.id));
      return BAD(500, `Falha ao gravar os itens da copia: ${itensErr.message}`);
    }

    return NextResponse.json({
      ok: true,
      nova: { id: String(nova!.id), valorTotal: Number(nova!.valor_total) || 0 },
      aviso: 'Copia criada como venda pendente no app — emita a NF pela aba NOTAS PENDENTES (o portal lista só notas já emitidas).',
    });
  }

  return BAD(400, `Acao desconhecida: ${acao}`);
}
