import { XMLParser } from 'fast-xml-parser';

/**
 * PARSER DE XML DE NF-e DE COMPRA (Bloco 95) — a base da aba "XML → Produtos".
 *
 * O dono vai subir os XMLs das notas de compra dos fornecedores (arquivos
 * .xml do computador / pen drive, ou futuramente puxados direto da Spedy via
 * DFe — inbound-product-invoices). Daqui sai TUDO que o cadastro fiscal do
 * produto precisa: NCM, EAN (cEAN), unidade, codigo do fornecedor (cProd),
 * custo real (vUnCom) e o regime de ICMS da entrada (CST/CSOSN — item que
 * entrou com ST/CST 60 sai com CSOSN 500).
 *
 * Formatos aceitos:
 *   <nfeProc><NFe><infNFe Id="NFe43...">...</NFe><protNFe>...</protNFe></nfeProc>
 *   <NFe><infNFe Id="NFe43...">...</NFe></NFe>
 *
 * Nenhum dado e inventado: so o que esta no XML. CFOP de ENTRADA (1xxx/2xxx)
 * NAO vira CFOP de saida — o CFOP de venda (5102/6102) e calculado na emissao
 * pela UF do destinatario.
 */

export interface ItemXmlCompra {
  cProd: string;
  cEAN: string;
  xProd: string;
  ncm: string;
  cfop: string;
  uCom: string;
  qCom: number;
  vUnCom: number;
  vProd: number;
  /** CST do ICMS da entrada (ex.: 00, 40, 60=ST) — futuro CSOSN 500 */
  cstIcms: string;
  /** CSOSN (Simples) da entrada, quando houver */
  csosnIcms: string;
}

export interface XmlCompraNota {
  chave: string;
  emitCnpj: string;
  emitNome: string;
  emitIe: string;
  numero: string;
  serie: string;
  dataEmissao: string;
  valorTotal: number;
  destCnpj: string;
  itens: ItemXmlCompra[];
}

export interface ParseXmlResultado {
  ok: boolean;
  erro?: string;
  nota?: XmlCompraNota;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // tudo string — numeros com ponto viram Number() aqui
  trimValues: true,
});

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/\s+/g, '');
  // XML fiscal usa ponto decimal; tolera virgula por seguranca
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function txt(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    // tag com filho (raro em campo texto) — pega o texto '#text' se houver
    const o = v as Record<string, unknown>;
    return txt(o['#text'] ?? o['@_value'] ?? '');
  }
  return String(v).trim();
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Extrai CST ou CSOSN do grupo ICMS (ICMS00, ICMSSN102, ICMS40...). */
function cstDoIcms(icmsGroup: unknown): { cst: string; csosn: string } {
  let cst = '';
  let csosn = '';
  const obj = icmsGroup as Record<string, unknown> | undefined;
  if (!obj || typeof obj !== 'object') return { cst, csosn };
  for (const key of Object.keys(obj)) {
    const g = obj[key] as Record<string, unknown> | undefined;
    if (!g || typeof g !== 'object') continue;
    if (!cst) cst = txt(g.CST);
    if (!csosn) csosn = txt(g.CSOSN);
  }
  return { cst, csosn };
}

/**
 * Parseia o XML de uma NF-e (compra). Retorna { ok, nota } — nota pronta para
 * gravar em xml_importacoes + xml_itens (staging da aba Fiscal).
 */
export function parseXmlNfe(xmlTexto: string): ParseXmlResultado {
  const bruto = (xmlTexto || '').trim();
  if (!bruto) return { ok: false, erro: 'Arquivo vazio.' };
  if (!/<infNFe/i.test(bruto)) return { ok: false, erro: 'Nao e um XML de NF-e (falta infNFe).' };

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(bruto) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, erro: `XML invalido: ${e instanceof Error ? e.message : String(e)}` };
  }

  // nfeProc (com protocolo) ou NFe isolada
  const proc = doc.nfeProc as Record<string, unknown> | undefined;
  const nfeRoot = (proc?.NFe ?? doc.NFe) as Record<string, unknown> | undefined;
  if (!nfeRoot) return { ok: false, erro: 'No NFe nao encontrado (procNFe/NFe).' };

  const infNFe = nfeRoot.infNFe as Record<string, unknown> | undefined;
  if (!infNFe) return { ok: false, erro: 'No infNFe nao encontrado.' };

  // Id="NFe4311..." -> chave de 44 digitos
  const idAttr = txt(infNFe['@_Id']);
  const chave = idAttr.replace(/\D/g, '');
  if (chave.length !== 44) {
    return { ok: false, erro: `Chave de acesso invalida (${chave.length} digitos — esperado 44).` };
  }

  const ide = (infNFe.ide ?? {}) as Record<string, unknown>;
  const emit = (infNFe.emit ?? {}) as Record<string, unknown>;
  const dest = (infNFe.dest ?? {}) as Record<string, unknown>;
  const total = ((infNFe.total ?? {}) as Record<string, unknown>)?.ICMSTot as Record<string, unknown> | undefined;

  // dhEmi "2026-11-05T10:30:21-03:00" ou dEmi "2026-11-05"
  const dhEmi = txt(ide.dhEmi) || txt(ide.dEmi);
  let dataEmissao = '';
  if (dhEmi) {
    const d = new Date(dhEmi.length === 10 ? `${dhEmi}T12:00:00-03:00` : dhEmi);
    dataEmissao = Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  const dets = asArray(infNFe.det as Record<string, unknown> | Record<string, unknown>[] | undefined);
  if (dets.length === 0) return { ok: false, erro: 'Nota sem itens (det vazio).' };

  const itens: ItemXmlCompra[] = dets.map((det) => {
    const prod = (det.prod ?? {}) as Record<string, unknown>;
    const imposto = (det.imposto ?? {}) as Record<string, unknown>;
    const icmsInfo = cstDoIcms(imposto.ICMS);
    return {
      cProd: txt(prod.cProd).slice(0, 60),
      cEAN: (txt(prod.cEAN) === 'SEM GTIN' ? '' : txt(prod.cEAN).replace(/\D/g, '')),
      xProd: txt(prod.xProd).slice(0, 120),
      ncm: txt(prod.NCM).replace(/\D/g, '').slice(0, 8),
      cfop: txt(prod.CFOP).replace(/\D/g, '').slice(0, 4),
      uCom: txt(prod.uCom).toUpperCase().slice(0, 6) || 'UN',
      qCom: num(prod.qCom),
      vUnCom: Math.round(num(prod.vUnCom) * 100) / 100,
      vProd: Math.round(num(prod.vProd) * 100) / 100,
      cstIcms: icmsInfo.cst,
      csosnIcms: icmsInfo.csosn,
    };
  }).filter((it) => it.xProd); // item sem descricao nao tem o que sincronizar

  const nota: XmlCompraNota = {
    chave,
    emitCnpj: txt(emit.CNPJ).replace(/\D/g, '').slice(0, 14),
    emitNome: txt(emit.xNome).slice(0, 120),
    emitIe: txt(emit.IE).slice(0, 20),
    numero: txt(ide.nNF),
    serie: txt(ide.serie),
    dataEmissao,
    valorTotal: Math.round(num(total?.vNF) * 100) / 100,
    destCnpj: txt(dest.CNPJ).replace(/\D/g, '').slice(0, 14),
    itens,
  };
  return { ok: true, nota };
}

// ---------------------------------------------------------------------------
// MATCHING — sugerir qual produto do catalogo casa com o item da XML
// ---------------------------------------------------------------------------
const SEM_ACENTO = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Nome "normalizado" para comparacao: minusculo, sem acento, so letras e
 *  numeros, 1 espaco entre palavras. "Ruffles 115g" -> "ruffles 115g". */
export function normalizaNome(s: string): string {
  return SEM_ACENTO(String(s || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(normalizaNome(s).split(' ').filter((t) => t.length > 1));
}

/** Similaridade 0..1: Jaccard de tokens + bonus de conter o outro nome. */
export function similaridade(a: string, b: string): number {
  const na = normalizaNome(a);
  const nb = normalizaNome(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(na);
  const tb = tokens(nb);
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const uniao = new Set([...ta, ...tb]).size;
  if (uniao === 0) return 0;
  let score = inter / uniao;
  if (na.includes(nb) || nb.includes(na)) score = Math.max(score, 0.85);
  return Math.min(1, Math.round(score * 100) / 100);
}

export interface ProdutoParaMatch {
  id: string;
  nome: string;
  ean?: string | null;
}

export interface SugestaoMatch {
  produtoId: string;
  nome: string;
  score: number;
}

/** Melhor candidato para o item da XML. Regras:
 *  1) EAN identico (e valido) -> score 1 (match certo)
 *  2) nome normalizado igual -> 0.95
 *  3) similaridade de tokens (Jaccard + contains) — so sugere >= 0.55 */
export function sugerirProduto(
  item: { xProd: string; cEAN?: string },
  produtos: ProdutoParaMatch[]
): SugestaoMatch | null {
  const eanXml = (item.cEAN || '').replace(/\D/g, '');
  let melhor: SugestaoMatch | null = null;
  for (const p of produtos) {
    let score = 0;
    const eanProd = (p.ean || '').replace(/\D/g, '');
    if (eanXml && eanProd && eanXml === eanProd) {
      score = 1;
    } else {
      score = similaridade(item.xProd, p.nome);
    }
    if (!melhor || score > melhor.score) {
      melhor = { produtoId: p.id, nome: p.nome, score };
    }
  }
  if (melhor && melhor.score >= 0.55) return melhor;
  return null;
}
