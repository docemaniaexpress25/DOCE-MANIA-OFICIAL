import { getServiceClient } from '@/lib/serverSupabase';
import { getFocusConfig, consultarNota, FocusDoc } from '@/lib/focusNfe';
import { unzipSync } from 'fflate';

/**
 * BLOCO 141 — ARQUIVOS FISCAIS DENTRO DO NOSSO SISTEMA (regra do dono):
 * "quero que acesse o portal da focus e me traga o pdf e xml das notas
 * atraves da api! salve dentro do nosso sistema. ja bati varias notas e
 * quero ter o controle disso, hj ta tudo no site da focus!"
 *
 * O que esta lib faz:
 * - Bucket PRIVADO `notas-fiscais` no Supabase Storage (criacao idempotente,
 *   mesmo padrao do bucket fotos-pedidos) — PDF (DANFE/DANFCe) e XML de cada
 *   nota ficam gravados no NOSSO storage, nao no site da Focus.
 * - Caminho deterministico por ref: `NFE/{ref}.pdf|.xml|-can.xml` e
 *   `NFCE/{ref}.pdf|.html|-can.xml` — presenca = listar pastas (sem DB novo).
 * - Baixa os arquivos na Focus com Basic auth (usuario = token):
 *   caminho_danfe (NF-e = PDF / NFC-e = HTML), caminho_xml_nota_fiscal e
 *   caminho_xml_cancelamento — todos relativos ("/arquivos/...") viram URL
 *   absoluta na baseUrl do ambiente.
 * - NFC-e: tenta tambem o endpoint legado `/v2/nfes/{ref}/danfe.pdf` (alguns
 *   estados/contas ainda servem PDF); sem PDF, o DANFCe HTML e a copia visual.
 * - NF-e com XML de cancelamento: baixa junto (prova do evento 135 na mao).
 *
 * RATE LIMIT da Focus (100 req/min): cada nota custa ate 4 reqs (consulta +
 * danfe + xml + [pdf legado]) — os lotes de importacao usam 6 notas/chamada.
 */

const BUCKET = 'notas-fiscais';
const LIMITE_BYTES = 30 * 1024 * 1024; // guarda-chuva contra arquivo patologico
const TETO_MS_GRANDE = 45_000; // guarda-chuva de duracao da rodada (Vercel — zips + importacoes)

// ---------------------------------------------------------------------------
// Bucket (criacao idempotente, cache por processo)
// ---------------------------------------------------------------------------
let bucketOk = false;

export async function garanteBucketNotas(): Promise<boolean> {
  if (bucketOk) return true;
  try {
    const db = getServiceClient();
    const { data: buckets } = await db.storage.listBuckets();
    const existe = (buckets || []).some((b) => b.name === BUCKET);
    if (!existe) {
      const { error } = await db.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: '30MB',
      });
      if (error && !/exists|duplicate/i.test(error.message || '')) throw error;
    }
    bucketOk = true;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Caminhos / tipos
// ---------------------------------------------------------------------------
export type TipoArquivo = 'pdf' | 'xml' | 'xml-cancelamento';

function pastaDe(doc: FocusDoc): string {
  return doc === 'nfce' ? 'NFCE' : 'NFE';
}

export function caminhoArquivo(doc: FocusDoc, ref: string, tipo: TipoArquivo, ext?: 'pdf' | 'html'): string {
  const sufixo = tipo === 'xml-cancelamento' ? '-can' : '';
  const e = ext || (tipo === 'pdf' ? 'pdf' : 'xml');
  return `${pastaDe(doc)}/${ref}${sufixo}.${e}`;
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  xml: 'application/xml; charset=utf-8',
  html: 'text/html; charset=utf-8',
};

export const MIME_XML = MIME.xml;
export const MIME_HTML = MIME.html;

/** Extrai a extensao real do caminho da Focus (DANFEs/*.pdf ou *.html). */
function extDeCaminho(caminho: string): 'pdf' | 'html' | 'xml' | null {
  const m = /\.(pdf|html?|xml)$/i.exec(caminho.trim());
  if (!m) return null;
  const e = m[1].toLowerCase();
  return e === 'htm' ? 'html' : (e as 'pdf' | 'html' | 'xml');
}

// ---------------------------------------------------------------------------
// Presenca (listagem das pastas — cache 30s por processo)
// ---------------------------------------------------------------------------
interface PresencaCache {
  at: number;
  refs: Map<string, { pdf: boolean; xml: boolean; can: boolean }>; // chave `{DOC}/{ref}`
}
let cachePresenca: PresencaCache | null = null;
const PRESENCA_TTL = 30_000;

/** Lista recursivo simples por pasta com paginacao (limit 300 por página). */
async function listarArquivos(pasta: string): Promise<string[]> {
  const db = getServiceClient();
  const nomes: string[] = [];
  const LIM = 300;
  for (let offset = 0; offset < 10000; offset += LIM) {
    const { data, error } = await db.storage.from(BUCKET).list(pasta, { limit: LIM, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) break;
    const lote = (data || []).filter(f => f.name).map(f => f.name);
    nomes.push(...lote);
    if (lote.length < LIM) break;
  }
  return nomes;
}

/** Invalida o cache de presenca (depois de gravar arquivo novo). */
export function invalidaPresenca(): void {
  cachePresenca = null;
}

/**
 * Mapa de presenca de arquivos: chave `{DOC}/{ref}` ->
 * { pdf: tem DANFE (pdf ou html), xml: tem XML, can: tem XML de cancelamento }.
 * Cache 30s — a lista do portal chama uma vez por render.
 */
export async function presencaArquivos(): Promise<Map<string, { pdf: boolean; xml: boolean; can: boolean }>> {
  const now = Date.now();
  if (cachePresenca && now - cachePresenca.at < PRESENCA_TTL) return cachePresenca.refs;
  const mapa = new Map<string, { pdf: boolean; xml: boolean; can: boolean }>();
  try {
    const [nfe, nfce] = await Promise.all([listarArquivos('NFE'), listarArquivos('NFCE')]);
    const registra = (doc: string, nomes: string[]) => {
      for (const n of nomes) {
        const m = /^(.+?)(?:-can)?\.(pdf|html?|xml)$/i.exec(n);
        if (!m) continue;
        const ref = m[1];
        const e = m[2].toLowerCase() === 'htm' ? 'html' : m[2].toLowerCase();
        const chave = `${doc}/${ref}`;
        const atual = mapa.get(chave) || { pdf: false, xml: false, can: false };
        if (n.endsWith('-can.xml')) atual.can = true;
        else if (e === 'xml') atual.xml = true;
        else atual.pdf = true; // pdf OU html (DANFCe) conta como visual salvo
        mapa.set(chave, atual);
      }
    };
    registra('NFE', nfe);
    registra('NFCE', nfce);
    cachePresenca = { at: now, refs: mapa };
  } catch {
    // Storage fora do ar: presenca vazia (downloads caem no modo live da Focus)
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Download na Focus (Basic auth) + gravacao no Storage
// ---------------------------------------------------------------------------
export interface ArquivoBaixado {
  bytes: Buffer;
  contentType: string;
  ext: 'pdf' | 'html' | 'xml';
}

/** Baixa um caminho RELATIVO da Focus ("/arquivos/...") com Basic auth. */
export async function baixarCaminhoFocus(caminho: string): Promise<ArquivoBaixado | null> {
  const c = (caminho || '').trim();
  if (!c) return null;
  const { baseUrl, token } = getFocusConfig();
  if (!token) return null;
  const url = /^https?:\/\//i.test(c) ? c : `${baseUrl}${c.startsWith('/') ? '' : '/'}${c}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${token}:`).toString('base64') },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const ab = await res.arrayBuffer();
    if (!ab || ab.byteLength === 0 || ab.byteLength > LIMITE_BYTES) return null;
    // o caminho diz a extensao; content-type da resposta confirma quando util
    const extCaminho = extDeCaminho(c);
    let ext: 'pdf' | 'html' | 'xml';
    if (ct.includes('application/pdf') || extCaminho === 'pdf') ext = 'pdf';
    else if (ct.includes('text/html') || extCaminho === 'html') ext = 'html';
    else if (ct.includes('xml') || extCaminho === 'xml') ext = 'xml';
    else if (ct.includes('json')) return null; // resposta de erro da API disfarcada
    else ext = extCaminho || 'xml';
    return { bytes: Buffer.from(ab), contentType: MIME[ext], ext };
  } catch {
    return null;
  }
}

/** Grava um arquivo no bucket `notas-fiscais` (upsert) — usado também pelo
 *  importador de XML em lote (BLOCO 143). false = falha de storage. */
export async function gravarNoStorage(caminho: string, bytes: Buffer, contentType: string): Promise<boolean> {
  if (!(await garanteBucketNotas())) return false;
  try {
    const { error } = await getServiceClient()
      .storage.from(BUCKET)
      .upload(caminho, bytes, { contentType, upsert: true });
    if (error && !/exists|duplicate/i.test(error.message || '')) return false;
    invalidaPresenca();
    return true;
  } catch {
    return false;
  }
}

/** Le um arquivo do nosso Storage (null = nao tem). */
export async function lerArquivoNota(caminho: string): Promise<ArquivoBaixado | null> {
  try {
    const { data, error } = await getServiceClient()
      .storage.from(BUCKET)
      .download(caminho);
    if (error || !data) return null;
    const ab = await data.arrayBuffer();
    if (!ab || ab.byteLength === 0) return null;
    const e = extDeCaminho(caminho) || 'xml';
    return { bytes: Buffer.from(ab), contentType: MIME[e], ext: e };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Coleta: consulta a nota na Focus e arquiva XML + DANFE (+ cancelamento)
// ---------------------------------------------------------------------------
export interface ColetaResultado {
  ok: boolean;
  motivo?: string;
  status?: string;
  numero?: string;
  chave?: string;
  pdfSalvo?: boolean;   // DANFE visual (pdf ou html) gravado no storage
  xmlSalvo?: boolean;   // XML da nota gravado no storage
  cancelamentoSalvo?: boolean;
  semArquivo?: boolean; // nota rejeitada/processando — nao ha o que baixar
  pdfUrl?: string;      // URL absoluta do DANFE na Focus (espelha na venda)
  xmlUrl?: string;      // URL absoluta do XML na Focus
}

/** Caminho relativo da Focus -> URL absoluta do ambiente. */
function urlAbsoluta(caminho: string): string {
  const c = (caminho || '').trim();
  if (!c) return '';
  if (/^https?:\/\//i.test(c)) return c;
  const { baseUrl } = getFocusConfig();
  return `${baseUrl}${c.startsWith('/') ? '' : '/'}${c}`;
}

/**
 * Arquiva XML + DANFE (+ cancelamento) a partir da RESPOSTA de uma consulta
 * `GET /v2/{doc}/{ref}` (sem reconsultar — reuso no webhook/EMITIR).
 */
export async function arquivarDaConsulta(doc: FocusDoc, ref: string, data: Record<string, unknown>): Promise<ColetaResultado> {
  const status = String(data.status || '').toLowerCase();
  const numero = String(data.numero || '');
  const chave = String(data.chave_nfe || '').replace(/\D/g, '').slice(-44);
  const caminhoXml = String(data.caminho_xml_nota_fiscal || '');
  const caminhoDanfe = String(data.caminho_danfe || '');
  const caminhoCan = String(data.caminho_xml_cancelamento || '');

  if (!caminhoXml && !caminhoDanfe) {
    // processando_autorizacao / erro_autorizacao: ainda nao ha arquivo na Focus
    return { ok: true, status, numero, chave, semArquivo: true, motivo: status || 'sem arquivos' };
  }

  const out: ColetaResultado = { ok: true, status, numero, chave, pdfUrl: urlAbsoluta(caminhoDanfe), xmlUrl: urlAbsoluta(caminhoXml) };

  // XML da nota (o documento legal — sempre que existir)
  if (caminhoXml) {
    const xml = await baixarCaminhoFocus(caminhoXml);
    out.xmlSalvo = !!xml && (await gravarNoStorage(caminhoArquivo(doc, ref, 'xml'), xml.bytes, xml.contentType));
  } else {
    out.xmlSalvo = false;
  }

  // DANFE visual: NF-e = PDF / NFC-e = HTML (doc oficial focusnfe)
  let salvouPdfReal = false;
  if (caminhoDanfe) {
    const danfe = await baixarCaminhoFocus(caminhoDanfe);
    if (danfe) {
      const ext = danfe.ext === 'xml' ? (doc === 'nfce' ? 'html' : 'pdf') : danfe.ext;
      out.pdfSalvo = await gravarNoStorage(caminhoArquivo(doc, ref, 'pdf', ext as 'pdf' | 'html'), danfe.bytes, MIME[ext]);
      salvouPdfReal = ext === 'pdf' && !!out.pdfSalvo;
    }
  }

  // NFC-e: DANFCe nasce em HTML — tenta ainda um PDF verdadeiro pelo endpoint
  // legado (algumas contas/estados servem /v2/nfes/{ref}/danfe.pdf); se sair,
  // o dono tem o PDF oficial do cupom, senao o HTML cumpre o papel visual.
  if (doc === 'nfce' && !salvouPdfReal) {
    const pdf = await baixarCaminhoFocus(`/v2/nfes/${encodeURIComponent(ref)}/danfe.pdf`);
    if (pdf && pdf.ext === 'pdf') {
      await gravarNoStorage(caminhoArquivo(doc, ref, 'pdf', 'pdf'), pdf.bytes, pdf.contentType);
      out.pdfSalvo = true;
    }
  }

  // XML do cancelamento (quando a nota foi cancelada)
  if (caminhoCan) {
    const can = await baixarCaminhoFocus(caminhoCan);
    out.cancelamentoSalvo = !!can && (await gravarNoStorage(caminhoArquivo(doc, ref, 'xml-cancelamento'), can.bytes, can.contentType));
  }

  return out;
}

/**
 * Consulta `GET /v2/{doc}/{ref}` e arquiva XML + DANFE no nosso Storage.
 * Idempotente: arquivos sao gravados com upsert. Erro de rede/rejeicao da
 * SEFAZ nunca sobe excecao — devolve motivo.
 */
export async function coletarArquivosNota(doc: FocusDoc, ref: string): Promise<ColetaResultado> {
  const r = await consultarNota(doc, ref);
  const data = (r.data || {}) as Record<string, unknown>;
  if (!r.ok || 'erro' in data || !data) {
    return { ok: false, motivo: (data as { erro?: string }).erro || `HTTP ${r.status}` };
  }
  return arquivarDaConsulta(doc, ref, data);
}

// ---------------------------------------------------------------------------
// Notas AVULSAS (emitidas fora do app — descoberta pela listagem legada)
// ---------------------------------------------------------------------------
export interface NotaAvulsaMeta {
  ref: string;
  doc: 'NFE' | 'NFCE';
  numero: string;
  serie: string;
  status: string;
  chave: string;
  dataEmissao: string;
  dataAutorizacao: string;
  valor: number;
  cliente: string;
  clienteDoc: string;
  pagamento: string;
  qrcodeUrl: string;
  importadoEm: string;
  /** BLOCO 143: origem da avulsa — 'FOCUS' (importada da API/painel) ou 'XML'
   *  (XML de sistema terceiro enviado pelo portal). Ausente = FOCUS (legado). */
  origem?: 'FOCUS' | 'XML';
  /** Dados do EMITENTE (presentes nas notas importadas por XML — o DANFE
   *  gerado usa; as da Focus não precisam porque o DANFE oficial vem da API). */
  emitente?: string;
  emitenteCnpj?: string;
}

function pastaAvulsa(): string {
  return '_avulsas';
}

/** Interpreta o modelo (55/65) pela chave de acesso (posicao fixa do XML 4.00). */
export function docDaChave(chave: string): 'NFE' | 'NFCE' {
  const dig = String(chave || '').replace(/\D/g, '');
  return dig.length >= 22 && dig.slice(20, 22) === '65' ? 'NFCE' : 'NFE';
}

/** tPag -> rótulo legivel (mesma tabela do tpagDeMetodo). */
function rotuloPagamento(formas: unknown): string {
  if (!Array.isArray(formas) || formas.length === 0) return '';
  const f = formas[0] as Record<string, unknown>;
  const tPag = String(f?.forma_pagamento ?? f?.formaPagamento ?? '');
  const mapa: Record<string, string> = {
    '01': 'DINHEIRO', '02': 'CHEQUE', '03': 'CARTAO_CREDITO', '04': 'CARTAO_DEBITO',
    '15': 'BOLETO', '16': 'DEPOSITO', '17': 'PIX', '90': 'SEM_PAGAMENTO', '91': 'A_PRAZO',
  };
  return mapa[tPag] || tPag;
}

/**
 * BLOCO 142 — LISTAGEM OFICIAL DA FOCUS (regra do dono):
 * "nao tem como criar um webhook ou API que busque todas essas notas que
 * estao dentro da Focus NF-e?" — TEM. A API v2 expoe a listagem por CNPJ:
 *   GET /v2/nfes?cnpj={cnpj}&offset=N&limit=100   (NF-e)
 *   GET /v2/nfces?cnpj={cnpj}&offset=N&limit=100  (NFC-e)
 * — traz TODAS as notas do emitente, INCLUSIVE as batidas direto no PAINEL
 * da Focus (fora do app). O DIAG do 141 so testou variantes .json/v1 (404);
 * a listagem oficial pede o cnpj na query. Paginamos por offset com formato
 * tolerante e paramos quando a pagina acaba OU repete (API sem offset real).
 * CNPJ do emitente: env FOCUS_NFE_CNPJ -> fallback pela chave de acesso
 * (44 digitos; CNPJ nas posicoes 6-20) de uma nota gravada no banco.
 * Se a conta nao expuser a listagem, caimos nas variantes legadas e, no
 * pior caso, em { suportado: false } — o portal segue com o importador
 * manual por ref/chave.
 */
export interface ListagemFocus {
  suportado: boolean;
  motivo?: string;
  notas: Record<string, unknown>[];
  docs: { NFE: number; NFCE: number }; // coletadas por modelo
  cnpj: string;
}

const TETO_PAGINAS = 20; // 20 x 100 = 2000 notas por modelo
const LIM_PAGINA = 100;

function extrairLista(data: unknown): Record<string, unknown>[] | null {
  const d = data as Record<string, unknown> | null;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!d || typeof d !== 'object') return null;
  for (const k of ['nfes', 'nfces', 'notas', 'data', 'documents']) {
    if (Array.isArray(d[k])) return d[k] as Record<string, unknown>[];
  }
  return null;
}

async function paginaListagem(url: string, auth: string): Promise<{ ok: boolean; status: number; notas: Record<string, unknown>[] }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { return { ok: false, status: res.status, notas: [] }; }
    const arr = extrairLista(data);
    if (!res.ok || !arr) return { ok: false, status: res.status, notas: [] };
    return { ok: true, status: res.status, notas: arr };
  } catch {
    return { ok: false, status: 0, notas: [] };
  }
}

/** CNPJ do emitente: env -> primeira chave de acesso de 44 digitos no banco. */
async function cnpjDoEmitente(): Promise<string> {
  const env = (getFocusConfig().cnpj || '').replace(/\D/g, '');
  if (env.length === 14) return env;
  try {
    const db = getServiceClient();
    const { data } = await db.from('sales').select('nota_chave').not('nota_chave', 'is', null).limit(1);
    const chave = String((data?.[0] as { nota_chave?: string } | undefined)?.nota_chave || '').replace(/\D/g, '');
    if (chave.length >= 20) return chave.slice(6, 20);
  } catch { /* banco fora — segue vazio */ }
  return '';
}

export async function listarRefsFocus(): Promise<ListagemFocus> {
  const { baseUrl, token } = getFocusConfig();
  if (!token) return { suportado: false, motivo: 'FOCUS_NAO_CONFIGURADA', notas: [], docs: { NFE: 0, NFCE: 0 }, cnpj: '' };
  const auth = 'Basic ' + Buffer.from(`${token}:`).toString('base64');
  const cnpj = await cnpjDoEmitente();

  const acumulado: Record<string, unknown>[] = [];
  const docs: { NFE: number; NFCE: number } = { NFE: 0, NFCE: 0 };
  let ultimoMotivo = '';
  let algumaListou = false;

  for (const endpoint of ['nfes', 'nfces'] as const) {
    const rotulo = endpoint === 'nfes' ? 'NFE' : 'NFCE';
    let listou = false;
    let refPrimeiraPagina = '';
    for (let page = 0; page < TETO_PAGINAS; page++) {
      const qs = cnpj ? `cnpj=${encodeURIComponent(cnpj)}&` : '';
      const url = `${baseUrl}/v2/${endpoint}?${qs}offset=${page * LIM_PAGINA}&limit=${LIM_PAGINA}`;
      const r = await paginaListagem(url, auth);
      if (!r.ok) {
        ultimoMotivo = `/v2/${endpoint}: HTTP ${r.status}${r.status === 0 ? ' (rede)' : ''}`;
        break;
      }
      listou = true;
      if (r.notas.length === 0) break;
      // API sem offset real: pagina 2 devolve o mesmo inicio — parar
      const primeira = String((r.notas[0] || {}).ref || (r.notas[0] || {}).referencia || '');
      if (page > 0 && primeira && primeira === refPrimeiraPagina) break;
      if (page === 0) refPrimeiraPagina = primeira;
      acumulado.push(...r.notas);
      if (r.notas.length < LIM_PAGINA) break;
    }
    if (listou) {
      algumaListou = true;
      docs[rotulo] += 1; // pelo menos 1 pagina OK deste modelo
    }
  }

  if (algumaListou) {
    return { suportado: true, notas: acumulado, docs, cnpj };
  }

  // Fallback: variantes legadas (contas antigas / endpoints sem cnpj)
  const variantes = [
    `${baseUrl}/v2/nfes?offset=0`,
    `${baseUrl}/v2/nfes.json?offset=0`,
    `${baseUrl}/v1/nfes.json?token=${encodeURIComponent(token)}`,
    `${baseUrl}/v1/nfes.json`,
  ];
  for (const url of variantes) {
    const r = await paginaListagem(url, auth);
    if (r.ok && r.notas.length > 0) {
      return { suportado: true, notas: r.notas, docs, cnpj };
    }
    // motivo SEM token (algumas variantes levam token na query)
    if (r.ok) ultimoMotivo = `${url.slice(baseUrl.length).replace(token, '***').replace(/token=[^&]+/g, 'token=***')}: lista vazia`;
  }
  return {
    suportado: false,
    motivo: ultimoMotivo || 'nenhuma variante respondeu',
    notas: [],
    docs,
    cnpj,
  };
}

// ---------------------------------------------------------------------------
// BLOCO 142 — BACKUPS MENSais DA FOCUS (fonte OFICIAL de TODAS as notas).
// Comprovado real na conta: GET /v2/backups/{cnpj}.json -> 200 com
// [{ mes: '202611', xmls: 'https://focusnfe.s3.../..._XMLs.zip', danfes: null }]
// — o ZIP de XMLs traz TODAS as notas do mes (NFe + NFCe), batidas pelo app
// OU no PAINEL (nome do arquivo = chave de acesso de 44 digitos). A partir
// da chave importamos a nota completa (importarAvulsa aceita chave).
// ---------------------------------------------------------------------------

export interface BackupFocus {
  mes: string; // AAAAMM
  danfes: string | null; // URL S3 do ZIP de DANFEs (NFe) — pode ser null
  xmls: string | null;   // URL S3 do ZIP de XMLs (NFe, NFCe...) — pode ser null
}

/** GET /v2/backups/{cnpj}.json (Basic auth) — lista os backups mensais. */
export async function listarBackupsFocus(cnpjArg?: string): Promise<{ ok: boolean; motivo?: string; backups: BackupFocus[] }> {
  const { baseUrl, token } = getFocusConfig();
  if (!token) return { ok: false, motivo: 'FOCUS_NAO_CONFIGURADA', backups: [] };
  const cnpj = (cnpjArg || '').replace(/\D/g, '') || (await cnpjDoEmitente());
  if (cnpj.length !== 14) return { ok: false, motivo: 'CNPJ_EMITENTE_INDISPONIVEL', backups: [] };
  const auth = 'Basic ' + Buffer.from(`${token}:`).toString('base64');
  try {
    const res = await fetch(`${baseUrl}/v2/backups/${cnpj}.json`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
    if (!res.ok) {
      const corpo = (await res.text().catch(() => '')).slice(0, 120).replace(/\s+/g, ' ');
      return { ok: false, motivo: `HTTP ${res.status}${corpo ? ` :: ${corpo}` : ''}`, backups: [] };
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return { ok: false, motivo: 'FORMATO_INESPERADO', backups: [] };
    const backups = (data as Record<string, unknown>[]).map((b) => ({
      mes: String(b.mes || ''),
      danfes: typeof b.danfes === 'string' && b.danfes ? b.danfes : null,
      xmls: typeof b.xmls === 'string' && b.xmls ? b.xmls : null,
    })).filter((b) => /^\d{6}$/.test(b.mes));
    return { ok: true, backups };
  } catch (e) {
    return { ok: false, motivo: (e as Error).message, backups: [] };
  }
}

/** Extrai chaves de acesso (44 digitos) dos nomes dentro do ZIP. */
function chavesDeNomes(nomes: string[]): { xmls: string[]; danfes: string[] } {
  const xmls: string[] = [];
  const danfes: string[] = [];
  for (const n of nomes) {
    const mXml = /(?:^|\/)(\d{44})[^/]*\.xml$/i.exec(n);
    if (mXml) { xmls.push(mXml[1]); continue; }
    const mPdf = /(?:^|\/)(\d{44})[^/]*\.pdf$/i.exec(n);
    if (mPdf) danfes.push(mPdf[1]);
  }
  return { xmls: [...new Set(xmls)], danfes: [...new Set(danfes)] };
}

/** Baixa um ZIP (URL S3 pré-assinada da Focus — não pede auth). */
async function baixarZipFocus(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000), cache: 'no-store' });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    if (!ab || ab.byteLength === 0 || ab.byteLength > 60 * 1024 * 1024) return null;
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/** Chaves de acesso contidas num ZIP (via fflate — sem deps nativas). */
export function chavesDoZip(bytes: Buffer): { xmls: string[]; danfes: string[] } {
  try {
    const files = unzipSync(new Uint8Array(bytes));
    return chavesDeNomes(Object.keys(files));
  } catch {
    return { xmls: [], danfes: [] };
  }
}

/** Chaves/refs que o sistema ja conhece (vendas com nota_chave + avulsas). */
async function chavesConhecidas(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const db = getServiceClient();
    for (let range = 0; range < 5000; range += 1000) {
      const { data, error } = await db
        .from('sales')
        .select('nota_chave, nota_ref')
        .not('nota_chave', 'is', null)
        .range(range, range + 999);
      if (error || !data) break;
      for (const r of (data as unknown) as { nota_chave: string; nota_ref: string }[]) {
        const chave = String(r.nota_chave || '').replace(/\D/g, '').slice(-44);
        if (chave.length === 44) set.add(chave);
        const ref = String(r.nota_ref || '');
        if (ref) set.add(ref);
      }
      if ((data as unknown[]).length < 1000) break;
    }
  } catch { /* banco fora — segue */ }
  const metas = await listarMetasAvulsas();
  for (const m of metas) {
    if (m.ref) set.add(m.ref);
    if (m.chave && m.chave.length === 44) set.add(m.chave);
  }
  return set;
}

export interface BackupResultado {
  suportado: boolean;   // endpoint de backups respondeu
  motivo?: string;      // quando suportado=false
  fim: boolean;         // nenhum mes tem chave nova sem importar
  mes?: string;         // mes processado nesta rodada
  chavesNoBackup: number;
  novas: number;        // notas importadas nesta rodada
  puladas: number;      // cortadas pelo teto de tempo
  erros: { chave: string; erro: string }[];
  restantes: number;    // chaves novas ainda por importar (mes atual)
  mesesComBackup: number;
  danfesGravados: number;
}

// ---------------------------------------------------------------------------
// PARSE DO XML AUTORIZADO (o ZIP traz o XML completo — metadados SEM
// reconsultar a Focus; NFC-e do painel nao aceita consulta por chave: 404
// "Nota fiscal nao encontrada" com chave REAL, provado em producao).
// ---------------------------------------------------------------------------
interface XmlNotaMeta {
  chave: string;
  numero: string;
  serie: string;
  status: 'AUTORIZADO' | 'CANCELADO' | 'OUTRO';
  cStat: string;
  dataEmissao: string;
  dataAutorizacao: string;
  valor: number;
  cliente: string;
  clienteDoc: string;
  pagamento: string;
}

function blocoXml(texto: string, tag: string): string {
  // aceita atributos na tag de abertura (ex.: <protNFe xmlns="..." versao="4.00">)
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(texto);
  return m ? m[1] : '';
}

function valorTag(bloco: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(bloco);
  return m ? m[1].trim() : '';
}

function parseXmlNota(xml: string, chaveFallback: string): XmlNotaMeta | null {
  try {
    const chave = (/Id="NFe(\d{44})"/i.exec(xml) || [])[1] || chaveFallback;
    if (!/^\d{44}$/.test(chave)) return null;
    const ide = blocoXml(xml, 'ide');
    const dest = blocoXml(xml, 'dest');
    const tot = blocoXml(xml, 'ICMSTot');
    const prot = blocoXml(xml, 'protNFe');
    const cStat = valorTag(prot, 'cStat') || '';
    const docDest = valorTag(dest, 'CNPJ') || valorTag(dest, 'CPF');
    // formas de pagamento (tPag pode repetir — unimos no rotulo)
    const tPags = [...xml.matchAll(/<tPag>(\d{2})<\/tPag>/gi)].map((m) => m[1]);
    const mapaPag: Record<string, string> = {
      '01': 'DINHEIRO', '02': 'CHEQUE', '03': 'CARTAO_CREDITO', '04': 'CARTAO_DEBITO',
      '05': 'CREDITO_LOJA', '10': 'A_PRAZO', '11': 'CREDITO_LOJA', '13': 'CARTAO_DEBITO',
      '15': 'BOLETO', '16': 'DEPOSITO', '17': 'PIX', '90': 'SEM_PAGAMENTO', '91': 'A_PRAZO',
    };
    const pagamento = [...new Set(tPags.map((t) => mapaPag[t] || t))].join('+');
    const status: XmlNotaMeta['status'] = cStat === '100' || cStat === '150' ? 'AUTORIZADO'
      : cStat === '101' || cStat === '135' || cStat === '151' || cStat === '155' ? 'CANCELADO'
        : cStat ? 'OUTRO' : 'OUTRO';
    return {
      chave,
      numero: valorTag(ide, 'nNF'),
      serie: valorTag(ide, 'serie'),
      status,
      cStat,
      dataEmissao: valorTag(ide, 'dhEmi') || valorTag(ide, 'dEmi'),
      dataAutorizacao: valorTag(prot, 'dhRecbto'),
      valor: Number(valorTag(tot, 'vNF').replace(',', '.')) || 0,
      cliente: (valorTag(dest, 'xNome') || 'CONSUMIDOR NAO IDENTIFICADO').slice(0, 120),
      clienteDoc: docDest,
      pagamento,
    };
  } catch {
    return null;
  }
}

/**
 * UMA rodada do importador por BACKUPS (BLOCO 142): lista os backups mensais,
 * baixa o ZIP de XMLs (mais recente primeiro), extrai o XML AUTORIZADO de cada
 * chave NOVA e arquiva DIRETO no nosso storage (XML do ZIP + PDF do DANFE pela
 * URL oficial /arquivos/{cnpj}/{mes}/DANFEs/{chave}.pdf — provado 302->200
 * mesmo para NFC-e) + JSON de metadados parseado do XML (nº, série, data,
 * valor, cliente, pagamento, status). NAO depende de consulta por ref/chave
 * (NFC-e do painel nao aceita — 404 provado). Idempotente: rodar de novo
 * nunca duplica (chaves ja conhecidas sao puladas).
 */
export async function importarDoBackupFocus(lote = 8): Promise<BackupResultado> {
  const vazio: BackupResultado = { suportado: false, fim: true, chavesNoBackup: 0, novas: 0, puladas: 0, erros: [], restantes: 0, mesesComBackup: 0, danfesGravados: 0 };
  const { token } = getFocusConfig();
  if (!token) return { ...vazio, motivo: 'FOCUS_NAO_CONFIGURADA' };

  const lista = await listarBackupsFocus();
  if (!lista.ok) {
    // Endpoint de backups indisponivel — o chamador cai na varredura legada
    return { ...vazio, motivo: lista.motivo || 'backups indisponivel' };
  }
  if (lista.backups.length === 0) {
    return { ...vazio, suportado: true, motivo: 'SEM_BACKUPS' };
  }
  const cnpjEmit = await cnpjDoEmitente();

  const conhecidas = await chavesConhecidas();
  const inicio = Date.now();
  const erros: { chave: string; erro: string }[] = [];
  let novas = 0, puladas = 0, danfesGravados = 0;
  let mesProcessado: string | undefined;
  let chavesNoBackup = 0;
  let faltandoTotal = 0;

  // meses: mais recente primeiro (o JSON costuma vir assim — ordenamos mesmo assim)
  const meses = [...lista.backups].sort((a, b) => b.mes.localeCompare(a.mes));
  for (const backup of meses) {
    if (!backup.xmls) continue;
    if (Date.now() - inicio > TETO_MS_GRANDE) break;
    const zip = await baixarZipFocus(backup.xmls);
    if (!zip) continue;
    let files: Record<string, Uint8Array>;
    try { files = unzipSync(new Uint8Array(zip)); } catch { continue; }
    const nomes = Object.keys(files);
    const { xmls: chavesXml } = chavesDeNomes(nomes);
    if (chavesXml.length === 0) continue;
    chavesNoBackup = Math.max(chavesNoBackup, chavesXml.length);
    const novasChaves = chavesXml.filter((ch) => !conhecidas.has(ch));
    if (novasChaves.length === 0) continue;

    mesProcessado = backup.mes;
    faltandoTotal += novasChaves.length;

    for (const chave of novasChaves) {
      if (novas >= lote) continue; // fica para a proxima rodada (restantes++)
      if (Date.now() - inicio > TETO_MS_GRANDE) { puladas++; continue; }
      try {
        const doc = docDaChave(chave) === 'NFCE' ? 'nfce' as FocusDoc : 'nfe' as FocusDoc;
        const caminhoBase = caminhoArquivo(doc, chave, 'xml').replace(/\.xml$/, '');

        // 1) XML autorizado — direto do ZIP (sem bater na Focus)
        const nomeXml = nomes.find((n) => new RegExp(`(?:^|/)${chave}[^/]*\\.xml$`, 'i').test(n) && !/-can\.xml$/i.test(n));
        if (!nomeXml) { erros.push({ chave, erro: 'XML_AUSENTE_NO_BACKUP' }); continue; }
        const xmlTexto = Buffer.from(files[nomeXml]).toString('utf8');
        if (!xmlTexto) { erros.push({ chave, erro: 'XML_VAZIO' }); continue; }
        const meta = parseXmlNota(xmlTexto, chave);
        if (!meta) { erros.push({ chave, erro: 'XML_ILEGIVEL' }); continue; }

        // 2) PDF do DANFE pela URL oficial por chave (302->200; NFC-e tbm serve)
        let pdfSalvo = false;
        const pdf = await baixarCaminhoFocus(`/arquivos/${cnpjEmit}/${backup.mes}/DANFEs/${chave}.pdf`);
        if (pdf && pdf.ext === 'pdf') {
          pdfSalvo = await gravarNoStorage(`${caminhoBase}.pdf`, pdf.bytes, pdf.contentType);
          if (pdfSalvo) danfesGravados++;
        }

        // 3) XML autorizado no storage
        const xmlSalvo = await gravarNoStorage(`${caminhoBase}.xml`, Buffer.from(xmlTexto), MIME.xml);

        // 4) Metadados para a lista do portal (pasta _avulsas, ref = chave)
        const metaAvulsa: NotaAvulsaMeta = {
          ref: chave,
          doc: doc === 'nfce' ? 'NFCE' : 'NFE',
          numero: meta.numero,
          serie: meta.serie,
          status: meta.status,
          chave,
          dataEmissao: meta.dataEmissao,
          dataAutorizacao: meta.dataAutorizacao,
          valor: meta.valor,
          cliente: meta.cliente,
          clienteDoc: meta.clienteDoc,
          pagamento: meta.pagamento,
          qrcodeUrl: '',
          importadoEm: new Date().toISOString(),
        };
        const metaSalva = await gravarNoStorage(`${pastaAvulsa()}/${chave}.json`, Buffer.from(JSON.stringify(metaAvulsa, null, 2)), 'application/json');
        if (xmlSalvo || pdfSalvo || metaSalva) novas++;
        else erros.push({ chave, erro: 'FALHA_GRAVACAO' });
      } catch (e) {
        erros.push({ chave, erro: (e as Error).message || 'erro' });
      }
    }
  }

  invalidaPresenca();
  const faltandoRestante = Math.max(0, faltandoTotal - novas - erros.length);
  return {
    suportado: true,
    fim: faltandoRestante === 0,
    mes: mesProcessado,
    chavesNoBackup,
    novas,
    puladas,
    erros: erros.slice(0, 8),
    restantes: faltandoRestante,
    mesesComBackup: lista.backups.length,
    danfesGravados,
  };
}

/** Grava/atualiza o JSON de metadados de uma avulsa (idempotente). */
export async function gravarMetaAvulsa(meta: NotaAvulsaMeta): Promise<boolean> {
  const ok = await gravarNoStorage(`${pastaAvulsa()}/${meta.ref}.json`, Buffer.from(JSON.stringify(meta, null, 2)), 'application/json');
  return ok;
}

/** Devolve os metadados de uma avulsa (null = nao existe). */
export async function lerMetaAvulsa(ref: string): Promise<NotaAvulsaMeta | null> {
  try {
    const { data, error } = await getServiceClient()
      .storage.from(BUCKET)
      .download(`${pastaAvulsa()}/${ref}.json`);
    if (error || !data) return null;
    const text = await data.text();
    return JSON.parse(text) as NotaAvulsaMeta;
  } catch {
    return null;
  }
}

/** Lista as avulsas ja importadas (metadados). */
export async function listarMetasAvulsas(): Promise<NotaAvulsaMeta[]> {
  try {
    const db = getServiceClient();
    const { data, error } = await db.storage.from(BUCKET).list(pastaAvulsa(), { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
    if (error || !data) return [];
    const refs = data.filter(f => f.name.endsWith('.json')).map(f => f.name.replace(/\.json$/, ''));
    const metas: NotaAvulsaMeta[] = [];
    for (const ref of refs) {
      const m = await lerMetaAvulsa(ref);
      if (m) metas.push(m);
    }
    return metas;
  } catch {
    return [];
  }
}

/**
 * Importa uma nota AVULSA (fora do app — painel da Focus): consulta COMPLETA
 * na Focus (`?completa=1` traz destinatario/valor/pagamento), arquiva XML +
 * DANFE e grava o JSON de metadados que alimenta a lista do portal.
 * `tokenNota` pode ser a REF do painel OU a chave de acesso de 44 digitos
 * (BLOCO 141: GET /v2/{doc}/{chave} aceita chave — provado no DIAG).
 * docHint ausente: tenta nfce e depois nfe (a chave diz o modelo; ref não).
 */
export async function importarAvulsa(ref: string, docHint?: 'NFE' | 'NFCE'): Promise<{ ok: boolean; motivo?: string; meta?: NotaAvulsaMeta }> {
  const { token } = getFocusConfig();
  if (!token) return { ok: false, motivo: 'FOCUS_NAO_CONFIGURADA' };
  const tokenNota = ref.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  if (!tokenNota) return { ok: false, motivo: 'REF_INVALIDA' };
  // A listagem legada nao diz o modelo — tenta nfce depois nfe pela chave/ref
  let doc: FocusDoc = docHint === 'NFCE' ? 'nfce' : docHint === 'NFE' ? 'nfe' : 'nfce';
  let data: Record<string, unknown> | null = null;
  for (const d of docHint ? [docHint.toLowerCase() as FocusDoc] : (['nfce', 'nfe'] as FocusDoc[])) {
    const r = await consultarNota(d, tokenNota, true);
    const dd = (r.data || {}) as Record<string, unknown>;
    if (r.ok && dd && !('erro' in dd) && String(dd.status || '') !== '') {
      doc = d;
      data = dd;
      break;
    }
  }
  if (!data) return { ok: false, motivo: 'NOTA_NAO_ENCONTRADA_NA_FOCUS' };

  // Arquiva direto da resposta da consulta (sem reconsultar — economiza reqs)
  const coleta = await arquivarDaConsulta(doc, tokenNota, data);
  invalidaPresenca();
  const req = (data.requisicao_nota_fiscal || {}) as Record<string, unknown>;
  const totais = (req.totais || {}) as Record<string, unknown>;
  const dest = req.nome_destinatario || req.razao_social_destinatario || '';
  const meta: NotaAvulsaMeta = {
    ref: tokenNota,
    doc: doc === 'nfce' ? 'NFCE' : 'NFE',
    numero: String(data.numero || req.numero || ''),
    serie: String(data.serie || req.serie || ''),
    status: String(data.status || '').toUpperCase(),
    chave: String(data.chave_nfe || '').replace(/\D/g, '').slice(-44),
    dataEmissao: String(req.data_emissao || data.data_emissao || ''),
    dataAutorizacao: String(data.data_autorizacao || (data.protocolo_nota_fiscal as Record<string, unknown> | undefined)?.data_recebimento || ''),
    valor: Number(totais.valor_total ?? data.total ?? data.valor_total) || 0,
    cliente: String(dest || 'CONSUMIDOR NAO IDENTIFICADO').slice(0, 120),
    clienteDoc: String(req.cnpj_destinatario || req.cpf_destinatario || ''),
    pagamento: rotuloPagamento(req.formas_pagamento),
    qrcodeUrl: String(data.qrcode_url || ''),
    importadoEm: new Date().toISOString(),
  };
  const salvo = await gravarNoStorage(`${pastaAvulsa()}/${meta.ref}.json`, Buffer.from(JSON.stringify(meta, null, 2)), 'application/json');
  if (!salvo && !coleta.ok) return { ok: false, motivo: coleta.motivo || 'FALHA_GRAVACAO' };
  return { ok: true, meta };
}

/** Exclui uma avulsa (metadados + DANFE/XML na pasta do documento). */
export async function excluirAvulsa(ref: string, doc?: 'NFE' | 'NFCE'): Promise<void> {
  const db = getServiceClient();
  const refSan = ref.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120);
  const alvos = [`${pastaAvulsa()}/${refSan}.json`];
  for (const d of doc ? [doc] : (['NFE', 'NFCE'] as const)) {
    alvos.push(`${d}/${refSan}.pdf`, `${d}/${refSan}.html`, `${d}/${refSan}.xml`, `${d}/${refSan}-can.xml`);
  }
  try { await db.storage.from(BUCKET).remove(alvos); } catch { /* best-effort */ }
  invalidaPresenca();
}
