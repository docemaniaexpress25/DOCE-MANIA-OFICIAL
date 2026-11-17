import { NextRequest, NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/session';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';

/**
 * BLOCO 156 — PRODUTOS FISCAIS (portal, fora do app) — LISTA EDITÁVEL de
 * TODOS os produtos com NCM, CEST, CFOP, EAN, unidade e origem.
 *
 * BLOCO 170 (pedido do dono): além dos fiscais, a planilha agora EDITA os
 * CÓDIGOS DO PRODUTO na mesma linha:
 *   - codigo            = código INTERNO que sobe na NF (Bloco 145, cProd);
 *   - codigo_especial_gb = código que sobe na NF do cliente ESPECIAL GB
 *     (Bloco 157 — substitui o interno nessas notas).
 * Ambos são texto livre (até 60 chars, limite SEFAZ do cProd), vazio = limpa
 * (a NF volta para o prefixo do id / código interno). O `codigo` tem índice
 * ÚNICO no banco (products_codigo_uidx, Bloco 145): duplicado é recusado com
 * mensagem amigável.
 *
 * Regra do dono: "me traga uma lista editavel de todos os produtos com NCM
 * CEST e CFOP, lista editavel". O portal /fiscal-produtos mostra o catálogo
 * INTEIRO em formato planilha e permite editar os códigos na linha
 * (1 clique ou SALVAR TUDO). Estes códigos são EXATAMENTE os que a emissão
 * da NF-e/NFC-e usa (/api/notas → focusNfe) — completar aqui faz a nota sair
 * certa. Produto sem NCM hoje sai com o código genérico 21069090.
 *
 * GET   /api/produtos-fiscal              -> todos os produtos + contagens
 * PATCH /api/produtos-fiscal { id, codigo?, codigo_especial_gb?, ncm?, cest?,
 *                              cfop?, ean?, unidade?, origem? }
 *                                        -> grava e devolve o produto atualizado
 *
 * Auth: MESMA SESSÃO do portal fiscal (/notas) — POST /api/notas-admin
 * { acao:'AUTH', pin } gera o token ADMIN e esta rota só aceita sessão
 * ADMIN válida (Bearer). Vendedor/entregador não entra.
 *
 * Validação SEFAZ (o que a nota aceita de verdade):
 *  - NCM: 8 dígitos (ou vazio = limpa; emissão usa 21069090 como fallback);
 *  - CEST: 7 dígitos (ou vazio);
 *  - CFOP: 4 dígitos, de SAÍDA (começa com 5 dentro do estado, 6 fora);
 *  - EAN/GTIN: 8 a 14 dígitos (ou vazio);
 *  - unidade: até 6 letras (UN, KG, PC, CX, LT...);
 *  - origem: dígito 0..8 da tabela de origem da NF-e.
 */

const BAD = (status: number, erro: string) =>
  NextResponse.json({ ok: false, erro }, { status });

const COLS = 'id, codigo, codigo_especial_gb, nome, ativo, preco_venda, ncm, cest, cfop, ean, unidade, origem';

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

interface FiscalPatch {
  codigo?: unknown;
  codigo_especial_gb?: unknown;
  ncm?: unknown;
  cest?: unknown;
  cfop?: unknown;
  ean?: unknown;
  unidade?: unknown;
  origem?: unknown;
}

/** Normaliza + valida o patch fiscal. vazio = limpa a coluna (null). */
function validaFiscal(patch: FiscalPatch): { dados: Record<string, string | null>; erro?: string } {
  const dados: Record<string, string | null> = {};

  if (patch.codigo !== undefined) {
    // BLOCO 170: código INTERNO (Bloco 145) — texto livre até 60 (limite SEFAZ cProd)
    const c = String(patch.codigo ?? '').trim().slice(0, 60);
    dados.codigo = c || null;
  }
  if (patch.codigo_especial_gb !== undefined) {
    // BLOCO 170: código do cliente ESPECIAL GB (Bloco 157) — mesmas regras
    const c = String(patch.codigo_especial_gb ?? '').trim().slice(0, 60);
    dados.codigo_especial_gb = c || null;
  }
  if (patch.ncm !== undefined) {
    const n = soDigitos(patch.ncm);
    if (n && n.length !== 8) return { dados, erro: 'NCM deve ter 8 dígitos (ex: 21069090). Vazio = limpa.' };
    dados.ncm = n || null;
  }
  if (patch.cest !== undefined) {
    const c = soDigitos(patch.cest);
    if (c && c.length !== 7) return { dados, erro: 'CEST deve ter 7 dígitos (ex: 0500500). Vazio = limpa.' };
    dados.cest = c || null;
  }
  if (patch.cfop !== undefined) {
    const c = soDigitos(patch.cfop);
    if (c && c.length !== 4) return { dados, erro: 'CFOP deve ter 4 dígitos (ex: 5102). Vazio = limpa.' };
    if (c && !/^[567]/.test(c)) return { dados, erro: 'CFOP de SAÍDA começa com 5 (dentro do estado) ou 6 (fora). Confira o número.' };
    dados.cfop = c || null;
  }
  if (patch.ean !== undefined) {
    const e = soDigitos(patch.ean);
    if (e && (e.length < 8 || e.length > 14)) return { dados, erro: 'EAN (código de barras) deve ter de 8 a 14 dígitos. Vazio = limpa.' };
    dados.ean = e || null;
  }
  if (patch.unidade !== undefined) {
    const u = String(patch.unidade ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    dados.unidade = u || null;
  }
  if (patch.origem !== undefined) {
    const o = soDigitos(patch.origem);
    if (o && !/^[0-8]$/.test(o)) return { dados, erro: 'Origem deve ser um código de 0 a 8 (tabela NF-e).' };
    dados.origem = o || null;
  }
  return { dados };
}

function produtoLinha(p: Record<string, unknown>) {
  return {
    id: String(p.id),
    codigo: p.codigo ? String(p.codigo) : '',
    codigoEspecialGb: p.codigo_especial_gb ? String(p.codigo_especial_gb) : '',
    nome: String(p.nome ?? ''),
    ativo: !!p.ativo,
    precoVenda: Number(p.preco_venda) || 0,
    ncm: p.ncm ? String(p.ncm) : '',
    cest: p.cest ? String(p.cest) : '',
    cfop: p.cfop ? String(p.cfop) : '',
    ean: p.ean ? String(p.ean) : '',
    unidade: p.unidade ? String(p.unidade) : '',
    origem: p.origem ? String(p.origem) : '',
  };
}

// ---------------- GET: lista completa + contagens ----------------
export async function GET(req: NextRequest) {
  // Preview/bridge primeiro (padrao do projeto): no sandbox quem responde é a produção.
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponível.');
  }
  if (!isAdminSession(req)) return BAD(401, 'Sessão ADMIN expirada. Entre com o PIN novamente.');

  const db = getServiceClient();
  const { data, error } = await db.from('products').select(COLS).order('nome', { ascending: true });
  if (error) return BAD(500, `Falha ao carregar produtos: ${error.message}`);

  const produtos = (data || []).map(produtoLinha);
  const total = produtos.length;
  const comNcm = produtos.filter(p => p.ncm).length;
  const comCfop = produtos.filter(p => p.cfop).length;
  const comCest = produtos.filter(p => p.cest).length;
  const comEan = produtos.filter(p => p.ean).length;
  // BLOCO 170: contagens dos códigos internos / código GB (KPIs do portal)
  const comCodigo = produtos.filter(p => p.codigo).length;
  const comCodigoGb = produtos.filter(p => p.codigoEspecialGb).length;
  return NextResponse.json({
    ok: true,
    produtos,
    stats: {
      total,
      ativos: produtos.filter(p => p.ativo).length,
      comNcm,
      semNcm: total - comNcm,
      comCfop,
      semCfop: total - comCfop,
      comCest,
      semCest: total - comCest,
      comEan,
      comCodigo,
      semCodigo: total - comCodigo,
      comCodigoGb,
    },
  });
}

// ---------------- PATCH: grava os fiscais de UM produto ----------------
export async function PATCH(req: NextRequest) {
  // Preview/bridge primeiro (padrao do projeto): no sandbox quem responde é a produção.
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponível.');
  }
  if (!isAdminSession(req)) return BAD(401, 'Sessão ADMIN expirada. Entre com o PIN novamente.');

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return BAD(400, 'Corpo inválido.');
  const id = String((body as Record<string, unknown>).id ?? '');
  if (!id) return BAD(400, 'Faltou o id do produto.');

  const { dados, erro } = validaFiscal(body as FiscalPatch);
  if (erro) return BAD(400, erro);
  if (Object.keys(dados).length === 0) return BAD(400, 'Nada para salvar.');

  const db = getServiceClient();
  let { data, error } = await db.from('products').update(dados).eq('id', id).select(COLS).single();

  // BLOCO 170: código INTERNO duplicado (products_codigo_uidx — Bloco 145)
  if (error && (error.code === '23505' || /duplicate|unique|codigo_uidx/i.test(error.message || ''))) {
    return BAD(400, `O código "${String(dados.codigo ?? '')}" JÁ EXISTE em outro produto! O código interno é único — escolha outro.`);
  }
  // coluna ausente (SQL 12/145/157 não rodou) — mensagem honesta
  if (error && /codigo_especial_gb/i.test(error.message || '')) {
    return BAD(500, `O banco recusou o CÓDIGO GB (${error.message}). Rode o SQL do Bloco 157 no Supabase.`);
  }
  if (error && /\bcodigo\b/i.test(error.message || '')) {
    return BAD(500, `O banco recusou o CÓDIGO interno (${error.message}). Rode o SQL do Bloco 145 no Supabase.`);
  }
  // coluna fiscal ausente (SQL do Bloco 12 não rodou) — mensagem honesta
  if (error && /ncm|cest|cfop|\bean\b|unidade|origem/i.test(error.message || '')) {
    return BAD(500, `O banco recusou o campo fiscal (${error.message}). Rode o SQL do Bloco 12 no Supabase.`);
  }
  if (error) return BAD(500, `Falha ao salvar: ${error.message}`);
  if (!data) return BAD(404, 'Produto não encontrado.');

  return NextResponse.json({ ok: true, produto: produtoLinha(data) });
}
