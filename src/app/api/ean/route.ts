import { NextRequest, NextResponse } from 'next/server';
import { sessionFromRequest } from '@/lib/session';
import { devBridge, isServerSupabaseConfigured } from '@/lib/serverSupabase';

/**
 * EAN/GTIN AUTOCOMPLETE (Bloco 13) — consulta dados do produto pelo codigo
 * de barras para preencher automaticamente o cadastro (igual ao CNPJ).
 *
 * GET /api/ean?ean=7891234567890   (Bearer session obrigatoria)
 *
 * Fontes, em ordem (a primeira que responder com NOME do produto ganha):
 *   1. GoUp               — https://api.goup.com.br/v1/gtin/{gtin}   (opcional: env GOUP_API_KEY — traz NCM/CEST)
 *   2. Cosmos             — https://api.cosmos.blumelabs.com.br      (opcional: env COSMOS_TOKEN — traz NCM/CEST)
 *   3. Open Food Facts    — https://world.openfoodfacts.org          (sem chave; nome, marca, quantidade)
 *   4. Open Products Facts— https://world.openproductsfacts.org      (fallback sem chave, nao-alimenticio)
 *
 * Sem SQL, sem chave obrigatoria. Cache em memoria por 24h por instancia
 * serverless (mesma consulta repetida nao bate na fonte).
 */

const BAD = (status: number, erro: string) =>
  NextResponse.json({ ok: false, erro }, { status });

export interface EanInfo {
  ean: string;
  /** Nome sugerido para o cadastro */
  nome: string;
  marca: string;
  /** ML | LT | GR | KG | UN (quando a fonte informar quantidade) */
  unidade: string;
  /** Preenchido somente por fontes brasileiras (GoUp/Cosmos) */
  ncm: string;
  cest: string;
  /** Nome da fonte usada (para feedback na tela) */
  fonte: string;
  /** URL da foto do produto (quando a fonte tiver) — alimenta products.imagem (Bloco 15) */
  imagem: string;
  /** true quando o NCM veio da fonte (nao precisara digitar) */
  temNcm: boolean;
}

type CacheEntry = { data: EanInfo; exp: number };
const g = globalThis as { __dmEanCache?: Map<string, CacheEntry> };
const CACHE = (g.__dmEanCache = g.__dmEanCache || new Map<string, CacheEntry>());
const TTL_MS = 24 * 60 * 60 * 1000;

const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/** Valida o digito verificador de GTIN-8/12/13/14 (EAN/UPC). */
export function validaGtin(d: string): boolean {
  if (![8, 12, 13, 14].includes(d.length)) return false;
  let soma = 0;
  d.slice(0, -1).split('').reverse().forEach((ch, i) => {
    soma += parseInt(ch, 10) * (i % 2 === 0 ? 3 : 1);
  });
  const dv = (10 - (soma % 10)) % 10;
  return dv === parseInt(d.slice(-1), 10);
}

async function fetchJson(url: string, headers: Record<string, string> = {}, timeoutMs = 9000): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Docemania-Estoque/1.0 (sistema interno)', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string => String(v ?? '').trim();

/** Converte a quantidade ("330 ml", "1 L", "90 g", "20 UN") na unidade do cadastro. */
function unidadeDaQuantidade(q: string): string {
  const m = q.trim().toLowerCase().match(/^([\d.,]+)\s*(ml|l|lt|g|gr|kg|un|unds?|unidade)$/);
  if (!m) return '';
  const val = parseFloat(m[1].replace(',', '.'));
  if (!isFinite(val) || val <= 0) return '';
  const un = m[2];
  if (un === 'ml') return 'ML';
  if (un === 'l' || un === 'lt') return val >= 1 ? 'LT' : 'ML';
  if (un === 'g' || un === 'gr') return 'GR';
  if (un === 'kg') return 'KG';
  return 'UN';
}

/** Monta o nome sugerido: nome da fonte + quantidade no final (estilo "Kero coco 330ml") se faltar. */
function montarNome(nome: string, marca: string, quantidade: string): string {
  let n = nome.replace(/\s+/g, ' ').trim();
  if (!n) return '';
  const nLower = n.toLowerCase().replace(/\s+/g, '');
  const q = quantidade.trim().toLowerCase().replace(/\s+/g, '');
  if (q && !nLower.includes(q)) n = `${n} ${q}`;
  const m = marca.trim();
  if (m && !n.toLowerCase().includes(m.toLowerCase())) n = `${n} ${m}`;
  n = n.replace(/\s+/g, ' ').trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

interface FonteResultado {
  nome: string;
  marca: string;
  quantidade: string;
  unidade: string;
  ncm: string;
  cest: string;
  fonte: string;
  imagem: string;
}

function parseGoup(d: Record<string, unknown>): FonteResultado | null {
  const nome = str(d.description) || str(d.descricao) || str(d.name) || str(d.product_name);
  if (!nome) return null;
  const marcaObj = d.brand && typeof d.brand === 'object' ? (d.brand as Record<string, unknown>) : null;
  const marca = str(d.brand_name) || str(marcaObj?.name) || (typeof d.brand === 'string' ? str(d.brand) : '');
  const qGoUp = str(d.unit_measure) || str(d.unidade) || str(d.quantity);
  return {
    nome,
    marca,
    quantidade: qGoUp,
    unidade: unidadeDaQuantidade(qGoUp),
    ncm: soDigitos(d.ncm) || '',
    cest: soDigitos(d.cest) || '',
    fonte: 'GoUp',
    imagem: str(d.image_url) || str(d.thumbnail) || str(d.photo_url),
  };
}

function parseCosmos(d: Record<string, unknown>): FonteResultado | null {
  const entry = d.entry && typeof d.entry === 'object' ? (d.entry as Record<string, unknown>) : null;
  const nome = str(entry?.name) || str(entry?.description);
  if (!nome) return null;
  const marcaObj = entry?.brand && typeof entry.brand === 'object' ? (entry.brand as Record<string, unknown>) : null;
  const qCosmos = str(entry?.quantity) || str(entry?.net_weight);
  return {
    nome,
    marca: str(marcaObj?.name) || (typeof entry?.brand === 'string' ? str(entry?.brand) : ''),
    quantidade: qCosmos,
    unidade: unidadeDaQuantidade(qCosmos),
    ncm: soDigitos(entry?.ncm) || '',
    cest: soDigitos(entry?.cest) || '',
    fonte: 'Cosmos',
    imagem: str(entry?.image_url) || str(entry?.thumbnail) || str(entry?.image),
  };
}

function parseOff(d: Record<string, unknown>, fonte: string): FonteResultado | null {
  if (Number(d.status) !== 1) return null;
  const product = d.product && typeof d.product === 'object' ? (d.product as Record<string, unknown>) : null;
  if (!product) return null;
  const nome = str(product.product_name_pt) || str(product.product_name) || str(product.product_name_en);
  if (!nome) return null;
  const quantidade = str(product.quantity);
  return {
    nome,
    marca: str(product.brands).split(',')[0].trim(),
    quantidade,
    unidade: unidadeDaQuantidade(quantidade),
    ncm: '',
    cest: '',
    fonte,
    imagem: str(product.image_front_url) || str(product.image_url) || str(product.image_small_url),
  };
}

export async function GET(req: NextRequest) {
  // Preview local (Bloco 12): repassa para o deploy de producao quando o
  // servidor nao tem env do Supabase — o token de producao e validado la.
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
  }

  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');

  const digitos = soDigitos(req.nextUrl.searchParams.get('ean'));
  if (!digitos) return BAD(400, 'Informe o codigo EAN.');
  if (!validaGtin(digitos)) {
    return BAD(422, 'EAN invalido (digito verificador nao confere). Confira o numero ou escaneie de novo.');
  }

  const cached = CACHE.get(digitos);
  if (cached && cached.exp > Date.now()) {
    return NextResponse.json({ ok: true, cached: true, ...cached.data });
  }

  let fonte: FonteResultado | null = null;

  // 1) GoUp (tem NCM/CEST) — so com chave configurada
  const goupKey = process.env.GOUP_API_KEY || '';
  if (!fonte && goupKey) {
    const r = await fetchJson(`https://api.goup.com.br/v1/gtin/${digitos}`, { Authorization: `Bearer ${goupKey}` });
    if (r) fonte = parseGoup(r);
  }

  // 2) Cosmos (tem NCM/CEST) — so com token configurado
  const cosmosToken = process.env.COSMOS_TOKEN || '';
  if (!fonte && cosmosToken) {
    const r = await fetchJson(`https://api.cosmos.blumelabs.com.br/entry/${digitos}.json?token=${encodeURIComponent(cosmosToken)}`);
    if (r) fonte = parseCosmos(r);
  }

  // 3) Open Food Facts (sem chave) -> 4) Open Products Facts (fallback nao-alimenticio)
  if (!fonte) {
    const r = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${digitos}.json`);
    if (r) fonte = parseOff(r, 'Open Food Facts');
  }
  if (!fonte) {
    const r = await fetchJson(`https://world.openproductsfacts.org/api/v2/product/${digitos}.json`);
    if (r) fonte = parseOff(r, 'Open Products Facts');
  }

  if (!fonte || !fonte.nome) {
    return BAD(
      502,
      'Produto nao encontrado pelo EAN (nenhuma base respondeu). Preencha os dados manualmente ou escaneie de novo.'
    );
  }

  const info: EanInfo = {
    ean: digitos,
    nome: montarNome(fonte.nome, fonte.marca, fonte.quantidade),
    marca: fonte.marca,
    unidade: fonte.unidade,
    ncm: fonte.ncm,
    cest: fonte.cest,
    fonte: fonte.fonte,
    imagem: fonte.imagem,
    temNcm: !!fonte.ncm,
  };
  CACHE.set(digitos, { data: info, exp: Date.now() + TTL_MS });
  return NextResponse.json({ ok: true, cached: false, ...info });
}
