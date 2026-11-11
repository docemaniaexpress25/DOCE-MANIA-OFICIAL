import { NextRequest, NextResponse } from 'next/server';
import { devBridge, getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { isAdminSession } from '@/lib/session';
import { sugerirProduto } from '@/lib/xmlCompra';
import { hasXmlCestColumn, hasXmlEntradaColumn } from '@/lib/serverSchema';

/**
 * FILA DE PRODUTOS VINDOS DA XML (Bloco 95) — sincronizar os itens das notas
 * de compra com o catalogo que JA EXISTE, sem quebrar nada do fluxo atual.
 *
 * GET /api/xml-importacao/itens?status=PENDENTE|VINCULADO|CRIADO|IGNORADO|TODOS&limit=200   [ADMIN]
 *   Devolve os itens da fila com o nome do emitente/data da nota de origem
 *   e a SUGESTAO de produto do catalogo (match por EAN exato ou similaridade
 *   de nome — a decisao final e sempre do dono).
 *
 * POST /api/xml-importacao/itens                                                            [ADMIN]
 *   { acao: 'VINCULAR',  itemId, produtoId }        — liga o item ao produto
 *     existente e COMPLETA o cadastro fiscal do produto onde estiver vazio
 *     (ncm/ean/unidade/origem/cest) — nunca sobrescreve valor ja preenchido.
 *   { acao: 'CRIAR',     itemId, produto: { nome, precoVenda, precoCusto?, unidade? } }
 *                                                    — cria produto novo no
 *     catalogo (ativo, estoque 0 — entrada de estoque e outro fluxo) com os
 *     dados fiscais da XML e marca o item CRIADO.
 *   { acao: 'IGNORAR',   itemId }                    — item descartado.
 *   { acao: 'REABRIR',   itemId }                    — volta pra fila.
 *   { acao: 'VINCULAR_SUGESTOES' }                   — aplica VINCULAR a TODOS
 *     os itens pendentes com sugestao de score >= 0.9 (lote).
 *   { acao: 'ENTRADA_ESTOQUE', itemId }              — BLOCO 95.1: transforma o
 *     item vinculado em ENTRADA no estoque central via RPC do kardex (bloco
 *     108): quantidade da nota, custo = valor unitario da nota, origem 'XML'.
 *     Carimba entrada_estoque_em para nao deixar entrar 2x.
 *   { acao: 'ENTRADA_LOTE' }                         — entrada de TODOS os
 *     itens vinculados/criados que ainda nao entraram (nota inteira 1 clique).
 */

const BAD = (status: number, erro: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, erro, ...extra }, { status });

let probeCache: { ok: boolean; at: number } | null = null;
async function hasXmlTables(): Promise<boolean> {
  const now = Date.now();
  if (probeCache && now - probeCache.at < 30_000) return probeCache.ok;
  try {
    const { error } = await getServiceClient().from('xml_importacoes').select('id').limit(1);
    const ok = !error;
    probeCache = { ok, at: now };
    return ok;
  } catch {
    return probeCache?.ok ?? false;
  }
}

interface ItemFila {
  id: string;
  importacaoId: string;
  emitNome: string;
  dataEmissao: string;
  chave: string;
  cProd: string;
  cEAN: string;
  xProd: string;
  ncm: string;
  cest: string | null;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  cstIcms: string;
  status: string;
  produtoId: string | null;
  produtoNome: string | null;
  entradaEstoqueEm: string | null;
  sugestao: { produtoId: string; nome: string; score: number } | null;
}

async function carregarFila(status: string, limit: number): Promise<ItemFila[] | { erro: string }> {
  const supabase = getServiceClient();
  // BLOCO 95.1: colunas novas entram no select SO quando o SQL 95.1 rodou —
  // pedia-las sem o SQL o GET inteiro 500ava (mesmo bug do qtd_pendentes).
  const [comCest, comEntrada] = await Promise.all([hasXmlCestColumn(), hasXmlEntradaColumn()]);
  let cols = 'id, importacao_id, c_prod, c_ean, x_prod, ncm, cfop, unidade, quantidade, valor_unitario, valor_total, cst_icms, status, produto_id';
  if (comCest) cols += ', cest';
  if (comEntrada) cols += ', entrada_estoque_em';
  let q = supabase
    .from('xml_itens')
    .select(cols)
    .order('criado_em', { ascending: true })
    .limit(Math.max(1, Math.min(500, limit)));
  if (status !== 'TODOS') q = q.eq('status', status);
  const { data: itens, error } = await q;
  if (error) return { erro: `Falha lendo fila: ${error.message}` };

  // Notas de origem (emitente/data) — 1 query e mapa na memoria
  const impIds = [...new Set((itens || []).map((r: Record<string, unknown>) => String(r.importacao_id)))];
  const mapaImp = new Map<string, { emitNome: string; dataEmissao: string; chave: string }>();
  if (impIds.length > 0) {
    const { data: imps } = await supabase
      .from('xml_importacoes')
      .select('id, emit_nome, data_emissao, chave')
      .in('id', impIds);
    for (const imp of (imps || []) as Record<string, unknown>[]) {
      mapaImp.set(String(imp.id), {
        emitNome: String(imp.emit_nome || ''),
        dataEmissao: imp.data_emissao ? String(imp.data_emissao) : '',
        chave: String(imp.chave || ''),
      });
    }
  }

  // Catalogo para sugestao + nome do produto vinculado
  const { data: prods } = await supabase
    .from('products')
    .select('id, nome, ean');
  const produtos = (prods || []) as Record<string, unknown>[];
  const prodPorId = new Map(produtos.map((p) => [String(p.id), p]));

  const out: ItemFila[] = (itens || []).map((raw: Record<string, unknown>) => {
    const impId = String(raw.importacao_id || '');
    const imp = mapaImp.get(impId) || { emitNome: '', dataEmissao: '', chave: '' };
    const vinculadoId = raw.produto_id ? String(raw.produto_id) : null;
    const vinculado = vinculadoId ? prodPorId.get(vinculadoId) : null;
    let sugestao: ItemFila['sugestao'] = null;
    if (String(raw.status) === 'PENDENTE') {
      const s = sugerirProduto(
        { xProd: String(raw.x_prod || ''), cEAN: String(raw.c_ean || '') },
        produtos.map((p) => ({ id: String(p.id), nome: String(p.nome || ''), ean: String(p.ean || '') }))
      );
      if (s) sugestao = s;
    }
    return {
      id: String(raw.id),
      importacaoId: impId,
      ...imp,
      cProd: String(raw.c_prod || ''),
      cEAN: String(raw.c_ean || ''),
      xProd: String(raw.x_prod || ''),
      ncm: String(raw.ncm || ''),
      cest: comCest ? (raw.cest ? String(raw.cest) : null) : null,
      cfop: String(raw.cfop || ''),
      unidade: String(raw.unidade || 'UN'),
      quantidade: Number(raw.quantidade) || 0,
      valorUnitario: Number(raw.valor_unitario) || 0,
      valorTotal: Number(raw.valor_total) || 0,
      cstIcms: String(raw.cst_icms || ''),
      status: String(raw.status || 'PENDENTE'),
      produtoId: vinculadoId,
      produtoNome: vinculado ? String(vinculado.nome || '') : null,
      entradaEstoqueEm: comEntrada && raw.entrada_estoque_em ? String(raw.entrada_estoque_em) : null,
      sugestao,
    };
  });
  return out;
}

export async function GET(request: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return BAD(503, 'Indisponivel no preview local.');
  }
  if (!isAdminSession(request)) {
    return BAD(401, 'Sessao invalida.');
  }
  if (!(await hasXmlTables())) {
    return BAD(503, 'Banco desatualizado: rode sql/bloco95_xml_produtos.sql no Supabase.');
  }

  const url = new URL(request.url);
  const status = (url.searchParams.get('status') || 'PENDENTE').toUpperCase();
  const limit = Number(url.searchParams.get('limit') || 200) || 200;

  const fila = await carregarFila(status, limit);
  if (fila instanceof Array) {
    const comEntrada = await hasXmlEntradaColumn();
    return NextResponse.json({ ok: true, itens: fila, temEntrada: comEntrada });
  }
  return BAD(500, (fila as { erro: string }).erro);
}

interface BodyAcao {
  acao?: 'VINCULAR' | 'CRIAR' | 'IGNORAR' | 'REABRIR' | 'VINCULAR_SUGESTOES' | 'ENTRADA_ESTOQUE' | 'ENTRADA_LOTE';
  itemId?: string;
  produtoId?: string;
  produto?: { nome?: string; precoVenda?: number; precoCusto?: number; unidade?: string };
}

/** VINCULAR + completar fiscal do produto (so campos VAZIOS — nunca pisa). */
async function aplicarVinculo(itemId: string, produtoId: string) {
  const supabase = getServiceClient();
  const { data: item } = await supabase.from('xml_itens').select('*').eq('id', itemId).maybeSingle();
  if (!item) return { erro: 'Item nao encontrado.' };
  const rec = item as Record<string, unknown>;
  if (String(rec.status) !== 'PENDENTE') return { erro: 'Item ja resolvido (reabra primeiro).' };

  const { data: prod } = await supabase.from('products').select('id, nome, ncm, ean, unidade, origem, cest').eq('id', produtoId).maybeSingle();
  if (!prod) return { erro: 'Produto nao encontrado.' };
  const p = prod as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  const ncmXml = String(rec.ncm || '').trim();
  const eanXml = String(rec.c_ean || '').trim();
  const unXml = String(rec.unidade || '').trim();
  const cestXml = String(rec.cest || '').trim();
  if (ncmXml && !String(p.ncm || '').trim()) patch.ncm = ncmXml;
  if (eanXml && !String(p.ean || '').trim()) patch.ean = eanXml;
  if (unXml && !String(p.unidade || '').trim()) patch.unidade = unXml;
  // BLOCO 95.1: CEST so preenche se vazio — e o cadastro fiscal que sai na nota
  if (cestXml && !String(p.cest || '').trim()) patch.cest = cestXml;
  if (Object.keys(patch).length > 0) {
    const { error: eProd } = await supabase.from('products').update(patch).eq('id', produtoId);
    if (eProd) {
      // products.cest pode ainda nao existir (bloco 12 nao rodou): tenta sem cest
      if ('cest' in patch) {
        const semCest = { ...patch };
        delete semCest.cest;
        if (Object.keys(semCest).length > 0) {
          await supabase.from('products').update(semCest).eq('id', produtoId);
        }
      } else {
        return { erro: `Falha completando produto: ${eProd.message}` };
      }
    }
  }

  const { error: eItem } = await supabase
    .from('xml_itens')
    .update({ produto_id: produtoId, status: 'VINCULADO', resolvido_em: new Date().toISOString() })
    .eq('id', itemId);
  if (eItem) return { erro: `Falha vinculando item: ${eItem.message}` };
  return {
    ok: true,
    produtoNome: String(p.nome || ''),
    completados: Object.keys(patch),
  } as Record<string, unknown>;
}

/**
 * BLOCO 95.1 — ENTRADA DE ESTOQUE de 1 item da fila (ja vinculado/criado).
 * 1o tente: RPC registrar_movimento_estoque do bloco 108 (kardex: movimento
 * origem='XML' + estoque_principal na mesma transacao).
 * Fallback: RPC inexistente (bloco 108 nao rodou) -> soma direto no estoque
 * principal e devolve aviso. NUNCA entra 2x (carimbo entrada_estoque_em).
 */
async function entradaEstoqueItem(supabase: ReturnType<typeof getServiceClient>, rec: Record<string, unknown>, itemId: string): Promise<{ ok?: boolean; saldo?: number; aviso?: string; erro?: string }> {
  const produtoId = rec.produto_id ? String(rec.produto_id) : '';
  if (!produtoId) return { erro: 'Item sem produto vinculado — vincule ou crie o produto primeiro.' };
  const qtd = Number(rec.quantidade) || 0;
  if (qtd <= 0) return { erro: 'Quantidade da nota invalida.' };
  const custo = Number(rec.valor_unitario) > 0 ? Number(rec.valor_unitario) : null;
  const referencia = String(rec.importacao_id || '') || null;

  const r = await supabase.rpc('registrar_movimento_estoque', {
    p_produto_id: produtoId,
    p_tipo: 'ENTRADA',
    p_quantidade: qtd,
    p_origem: 'XML',
    p_referencia: referencia,
    p_custo_unitario: custo,
    p_usuario_id: null,
    p_usuario_nome: 'XML → Produtos',
  });
  const dados = (r.data ?? null) as { ok?: boolean; saldo?: number; erro?: string } | null;

  if (dados && dados.ok) {
    return { ok: true, saldo: Number(dados.saldo) };
  }

  // RPC existente mas recusou (ex.: produto inexistente) — erro REAL, nao engole
  if (dados && dados.ok === false && dados.erro) {
    return { erro: `Kardex recusou a entrada: ${dados.erro}` };
  }

  // Fallback: RPC nao existe (bloco 108 pendente) OU resposta nula (mock) —
  // le o estoque atual, soma em memoria e grava (PostgREST nao aceita
  // expressao SQL no update; 1 admin operando, corrida improvavel e sem risco).
  const { data: prod } = await supabase.from('products').select('estoque_principal').eq('id', produtoId).maybeSingle();
  if (!prod) return { erro: 'Produto nao encontrado para a entrada.' };
  const atual = Number((prod as Record<string, unknown>).estoque_principal) || 0;
  const novo = Math.max(0, atual + qtd);
  const { error: eUpd } = await supabase.from('products').update({ estoque_principal: novo }).eq('id', produtoId);
  if (eUpd) return { erro: `Falha na entrada direta: ${eUpd.message}` };
  return { ok: true, saldo: novo, aviso: 'Entrada simples (sem kardex) — rode o SQL do bloco 108 para o historico.' };
}

/** Carimba a entrada do item (protegido pela sonda — so quando a coluna existe). */
async function carimbarEntrada(supabase: ReturnType<typeof getServiceClient>, itemId: string): Promise<boolean> {
  if (!(await hasXmlEntradaColumn())) return false;
  const { error } = await supabase.from('xml_itens').update({ entrada_estoque_em: new Date().toISOString() }).eq('id', itemId);
  return !error;
}

export async function POST(request: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return BAD(503, 'Indisponivel no preview local.');
  }
  if (!isAdminSession(request)) {
    return BAD(401, 'Sessao invalida.');
  }
  if (!(await hasXmlTables())) {
    return BAD(503, 'Banco desatualizado: rode sql/bloco95_xml_produtos.sql no Supabase.');
  }

  let body: BodyAcao = {};
  try {
    body = await request.json();
  } catch {
    return BAD(400, 'Corpo JSON invalido.');
  }

  const supabase = getServiceClient();
  const acao = String(body.acao || '').toUpperCase();

  try {
    if (acao === 'VINCULAR') {
      if (!body.itemId || !body.produtoId) return BAD(400, 'itemId e produtoId obrigatorios.');
      const r = await aplicarVinculo(body.itemId, body.produtoId);
      if ('erro' in r && r.erro) return BAD(400, String(r.erro));
      return NextResponse.json({ ok: true, ...r });
    }

    if (acao === 'CRIAR') {
      if (!body.itemId) return BAD(400, 'itemId obrigatorio.');
      const nome = String(body.produto?.nome || '').trim();
      if (!nome) return BAD(400, 'Nome do produto obrigatorio.');
      const precoVenda = Number(body.produto?.precoVenda);
      if (!Number.isFinite(precoVenda) || precoVenda <= 0) return BAD(400, 'Preco de venda invalido.');

      const { data: item } = await supabase.from('xml_itens').select('*').eq('id', body.itemId).maybeSingle();
      if (!item) return BAD(400, 'Item nao encontrado.');
      const rec = item as Record<string, unknown>;
      if (String(rec.status) !== 'PENDENTE') return BAD(400, 'Item ja resolvido (reabra primeiro).');

      const precoCusto = Number.isFinite(Number(body.produto?.precoCusto)) && Number(body.produto?.precoCusto) > 0
        ? Number(body.produto?.precoCusto)
        : Number(rec.valor_unitario) || 0;

      const novo: Record<string, unknown> = {
        nome: nome.slice(0, 120),
        preco_custo: Math.round(precoCusto * 100) / 100,
        preco_venda: Math.round(precoVenda * 100) / 100,
        preco_minimo: Math.round(precoVenda * 100) / 100,
        comissao_percentual: 10,
        comissao_pv_percentual: 5,
        estoque_principal: 0,
        estoque_van: 0,
        ativo: true,
        unidade: String(body.produto?.unidade || rec.unidade || 'UN'),
        origem: '0',
      };
      if (String(rec.ncm || '').trim()) novo.ncm = String(rec.ncm).trim();
      if (String(rec.c_ean || '').trim()) novo.ean = String(rec.c_ean).trim();

      const { data: prodNovo, error: eNovo } = await supabase
        .from('products')
        .insert(novo)
        .select('id, nome')
        .single();
      if (eNovo || !prodNovo) return BAD(500, `Falha criando produto: ${eNovo?.message || 'sem retorno'}`);
      const novoId = String((prodNovo as Record<string, unknown>).id);

      const { error: eItem } = await supabase
        .from('xml_itens')
        .update({ produto_id: novoId, status: 'CRIADO', resolvido_em: new Date().toISOString() })
        .eq('id', body.itemId);
      if (eItem) return BAD(500, `Produto criado mas item nao marcado: ${eItem.message}`);
      return NextResponse.json({ ok: true, produtoNome: String((prodNovo as Record<string, unknown>).nome || ''), produtoId: novoId });
    }

    if (acao === 'IGNORAR' || acao === 'REABRIR') {
      if (!body.itemId) return BAD(400, 'itemId obrigatorio.');
      const patch = acao === 'IGNORAR'
        ? { status: 'IGNORADO', resolvido_em: new Date().toISOString() }
        : { status: 'PENDENTE', produto_id: null, resolvido_em: null };
      const { error } = await supabase.from('xml_itens').update(patch).eq('id', body.itemId);
      if (error) return BAD(500, `Falha: ${error.message}`);
      return NextResponse.json({ ok: true });
    }

    if (acao === 'VINCULAR_SUGESTOES') {
      // Lote: vincula todos os pendentes com sugestao alta (>= 0.9)
      const pend = await carregarFila('PENDENTE', 500);
      if (!(pend instanceof Array)) return BAD(500, (pend as { erro: string }).erro);
      const alvos = pend.filter((i) => (i.sugestao?.score ?? 0) >= 0.9 && i.sugestao);
      let ok = 0;
      const falhas: string[] = [];
      for (const i of alvos) {
        const r = await aplicarVinculo(i.id, i.sugestao!.produtoId);
        if ('erro' in r && r.erro) falhas.push(`${i.xProd}: ${r.erro}`);
        else ok++;
      }
      return NextResponse.json({ ok: true, vinculados: ok, falhas: falhas.slice(0, 5) });
    }

    // ===== BLOCO 95.1: ENTRADA DE ESTOQUE =====
    if (acao === 'ENTRADA_ESTOQUE') {
      if (!body.itemId) return BAD(400, 'itemId obrigatorio.');
      const { data: item } = await supabase.from('xml_itens').select('*').eq('id', body.itemId).maybeSingle();
      if (!item) return BAD(400, 'Item nao encontrado.');
      const rec = item as Record<string, unknown>;
      const st = String(rec.status || '');
      if (st !== 'VINCULADO' && st !== 'CRIADO') return BAD(400, 'So entra no estoque item vinculado ou criado.');
      if (!(await hasXmlEntradaColumn())) {
        return BAD(400, 'Banco desatualizado: rode sql/bloco95_1_cest_entrada.sql no Supabase (trava contra entrada duplicada).');
      }
      if (rec.entrada_estoque_em) {
        return BAD(400, 'Entrada ja feita — o estoque desse item ja recebeu a quantidade da nota.');
      }
      const r = await entradaEstoqueItem(supabase, rec, String(body.itemId));
      if (r.erro) return BAD(400, r.erro);
      await carimbarEntrada(supabase, String(body.itemId));
      return NextResponse.json({ ok: true, saldo: r.saldo ?? null, aviso: r.aviso ?? null });
    }

    if (acao === 'ENTRADA_LOTE') {
      // Nota inteira: TODOS os vinculados/criados que ainda nao entraram
      if (!(await hasXmlEntradaColumn())) {
        return BAD(400, 'Banco desatualizado: rode sql/bloco95_1_cest_entrada.sql no Supabase (trava contra entrada duplicada).');
      }
      const { data: itens } = await supabase
        .from('xml_itens')
        .select('*')
        .in('status', ['VINCULADO', 'CRIADO'])
        .is('entrada_estoque_em', null)
        .limit(500);
      const alvos = (itens || []) as Record<string, unknown>[];
      if (alvos.length === 0) return NextResponse.json({ ok: true, entradas: 0, falhas: [] });
      let ok = 0;
      const falhas: string[] = [];
      for (const rec of alvos) {
        const r = await entradaEstoqueItem(supabase, rec, String(rec.id));
        if (r.erro) falhas.push(`${String(rec.x_prod || 'item')}: ${r.erro}`);
        else {
          await carimbarEntrada(supabase, String(rec.id));
          ok++;
        }
      }
      return NextResponse.json({ ok: true, entradas: ok, falhas: falhas.slice(0, 5), aviso: falhas.length === 0 ? null : 'Parte dos itens falhou — veja as mensagens.' });
    }

    return BAD(400, `Acao desconhecida: ${acao}`);
  } catch (e) {
    return BAD(500, `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`);
  }
}
