import https from 'node:https';

/**
 * BANCO INTER — API Cobranca V3 (Boleto com Pix) — Bloco 25.
 *
 * Documentacao: https://developers.inter.co/references/cobranca-bolepix
 *
 * Autenticacao: OAuth2 client_credentials + mTLS (certificado da aplicacao
 * gerado no Internet Banking PJ > Desenvolvedor). Token vive 1 hora e e
 * reutilizado (cache em memoria; endpoint de token aceita 5 req/min).
 *
 * Env vars (Vercel):
 *   INTER_CLIENT_ID       -> Client Id da aplicacao (obrigatorio)
 *   INTER_CLIENT_SECRET   -> Client Secret da aplicacao (obrigatorio)
 *   INTER_CERT            -> certificado X509 (PEM) da aplicacao, com \n
 *   INTER_KEY             -> chave privada (PEM) da aplicacao, com \n
 *   (alternativa ao par PEM: INTER_P12 = arquivo .p12 em base64 + INTER_P12_SENHA)
 *   INTER_CONTA_CORRENTE  -> opcional (header x-conta-corrente, so se a
 *                            conta PJ tiver mais de uma conta corrente)
 *   INTER_AMBIENTE        -> 'sandbox' usa o servidor de testes; padrao producao
 *
 * Endpoints (producao):
 *   POST /oauth/v2/token                        -> {access_token, expires_in}
 *   POST /cobranca/v3/cobrancas                 -> {codigoSolicitacao} (assincrono)
 *   GET  /cobranca/v3/cobrancas/{codigo}        -> cobranca completa
 *   GET  /cobranca/v3/cobrancas/{codigo}/pdf    -> {pdf: base64}
 *   POST /cobranca/v3/cobrancas/{codigo}/cancelar {motivoCancelamento}
 *
 * Escopos: boleto-cobranca.read + boleto-cobranca.write
 */

const TOKEN_TTL_MS = 55 * 60 * 1000; // token vale 1h; renova 5 min antes

export interface InterConfig {
  clientId: string;
  clientSecret: string;
  contaCorrente: string;
  ambiente: 'producao' | 'sandbox';
  baseUrl: string;
}

export interface InterPagador {
  cpfCnpj: string;          // so digitos
  tipoPessoa: 'FISICA' | 'JURIDICA';
  nome: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  email?: string;
  ddd?: string;
  telefone?: string;
}

export interface InterNotaFiscal {
  chaveNFe: string;         // 44 digitos
  numero?: number;
  serie?: number;
  dataEmissao?: string;     // YYYY-MM-DD
  parcela?: number;
  naturezaOperacao?: string;
}

export interface InterCobrancaResultado {
  ok: boolean;
  status: number;
  erro?: string;
  data?: Record<string, unknown>;
}

export function getInterConfig(): InterConfig {
  const ambiente = process.env.INTER_AMBIENTE === 'sandbox' ? 'sandbox' : 'producao';
  return {
    clientId: process.env.INTER_CLIENT_ID || '',
    clientSecret: process.env.INTER_CLIENT_SECRET || '',
    contaCorrente: (process.env.INTER_CONTA_CORRENTE || '').replace(/\D/g, ''),
    ambiente,
    baseUrl: ambiente === 'sandbox'
      ? 'https://cdpj-sandbox.partners.uatinter.co'
      : 'https://cdpj.partners.bancointer.com.br',
  };
}

export function isInterConfigured(): boolean {
  const c = getInterConfig();
  if (!c.clientId || !c.clientSecret) return false;
  const p12 = !!process.env.INTER_P12 && !!process.env.INTER_P12_SENHA;
  const pem = !!process.env.INTER_CERT && !!process.env.INTER_KEY;
  return p12 || pem;
}

// ---------------------------------------------------------------------------
// mTLS agent (cache por instancia de servidor — keepAlive)
// ---------------------------------------------------------------------------
let agentCache: https.Agent | null = null;

function mtlsAgent(): https.Agent {
  if (agentCache) return agentCache;
  const p12B64 = process.env.INTER_P12 || '';
  const p12Senha = process.env.INTER_P12_SENHA || '';
  if (p12B64 && p12Senha) {
    agentCache = new https.Agent({
      pfx: Buffer.from(p12B64, 'base64'),
      passphrase: p12Senha,
      keepAlive: true,
    });
  } else {
    agentCache = new https.Agent({
      cert: (process.env.INTER_CERT || '').replace(/\\n/g, '\n'),
      key: (process.env.INTER_KEY || '').replace(/\\n/g, '\n'),
      keepAlive: true,
    });
  }
  return agentCache;
}

/** Requisicao HTTPS com certificado da aplicacao (mTLS). */
function mtlsRequest(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  opts: { headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        host: u.hostname,
        path: u.pathname + u.search,
        agent: mtlsAgent(),
        headers: {
          ...(opts.body ? { 'Content-Length': Buffer.byteLength(opts.body).toString() } : {}),
          ...(opts.headers || {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.setTimeout(45_000, () => req.destroy(new Error('Timeout na API do Inter')));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Token OAuth (cache 55 min)
// ---------------------------------------------------------------------------
let tokenCache: { token: string; exp: number } | null = null;

export async function obterToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && now < tokenCache.exp) return tokenCache.token;

  const cfg = getInterConfig();
  const form = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'client_credentials',
    scope: 'boleto-cobranca.read boleto-cobranca.write',
  });
  const res = await mtlsRequest('POST', `${cfg.baseUrl}/oauth/v2/token`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(res.body); } catch { /* segue */ }
  if (res.status !== 200 || !data.access_token) {
    throw new Error(`Falha ao autenticar no Inter (HTTP ${res.status}): ${String(data.error_description || data.error || res.body).slice(0, 200)}`);
  }
  tokenCache = { token: String(data.access_token), exp: now + TOKEN_TTL_MS };
  return tokenCache.token;
}

// ---------------------------------------------------------------------------
// API Cobranca V3
// ---------------------------------------------------------------------------
function authHeaders(token: string): Record<string, string> {
  const cfg = getInterConfig();
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (cfg.contaCorrente) h['x-conta-corrente'] = cfg.contaCorrente;
  return h;
}

async function requestJson(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  body?: unknown
): Promise<InterCobrancaResultado> {
  const cfg = getInterConfig();
  try {
    const token = await obterToken();
    const res = await mtlsRequest(method, `${cfg.baseUrl}${path}`, {
      headers: authHeaders(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(res.body); } catch { /* resposta nao-JSON */ }
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, data };
    // Erros da Inter: {title, detail} ou {error: ...}
    const detail = (data.detail as string) || (data.title as string) || (data.error_description as string)
      || (data.error as string) || res.body.slice(0, 300);
    return { ok: false, status: res.status, erro: detail || `HTTP ${res.status}`, data };
  } catch (e: unknown) {
    return { ok: false, status: 0, erro: e instanceof Error ? e.message : 'Falha de conexao com o Inter' };
  }
}

/** Emite a cobranca (boleto + pix). Retorna codigoSolicitacao. */
export function emitirCobranca(payload: {
  seuNumero: string;
  valorNominal: number;
  dataVencimento: string; // YYYY-MM-DD
  numDiasAgenda?: number;
  pagador: InterPagador;
  mensagem?: { linha1?: string; linha2?: string; linha3?: string; linha4?: string; linha5?: string };
  formasRecebimento?: ('BOLETO' | 'PIX' | 'SEM_FORMA_PAGAMENTO')[];
  notaFiscal?: InterNotaFiscal;
}): Promise<InterCobrancaResultado> {
  return requestJson('POST', '/cobranca/v3/cobrancas', payload);
}

/** Recupera a cobranca completa (situacao, linha digitavel, pix...). */
export function recuperarCobranca(codigoSolicitacao: string): Promise<InterCobrancaResultado> {
  return requestJson('GET', `/cobranca/v3/cobrancas/${encodeURIComponent(codigoSolicitacao)}`);
}

/** Recupera o PDF do boleto (JSON {pdf: base64}). */
export async function recuperarPdf(codigoSolicitacao: string): Promise<{ ok: boolean; pdf?: Buffer; erro?: string }> {
  const r = await requestJson('GET', `/cobranca/v3/cobrancas/${encodeURIComponent(codigoSolicitacao)}/pdf`);
  if (!r.ok) return { ok: false, erro: r.erro };
  const b64 = String((r.data as Record<string, unknown>)?.pdf || '');
  if (!b64) return { ok: false, erro: 'Inter nao devolveu o PDF (cobranca ainda processando?)' };
  return { ok: true, pdf: Buffer.from(b64, 'base64') };
}

/** Cancela a cobranca (motivo <= 50 caracteres). */
export function cancelarCobranca(codigoSolicitacao: string, motivo: string): Promise<InterCobrancaResultado> {
  return requestJson('POST', `/cobranca/v3/cobrancas/${encodeURIComponent(codigoSolicitacao)}/cancelar`, {
    motivoCancelamento: motivo.slice(0, 50),
  });
}

// ---------------------------------------------------------------------------
// Interpretacao da resposta da cobranca
// ---------------------------------------------------------------------------
export interface CobrancaPublica {
  status: string;           // EM_PROCESSAMENTO | A_RECEBER | RECEBIDO | ...
  codigo: string;           // codigoSolicitacao
  seuNumero: string;
  vencimento: string;       // YYYY-MM-DD
  valor: number | null;
  linhaDigitavel: string;
  codigoBarras: string;
  pixCopiaECola: string;
  valorRecebido: number | null;
  erro: string;
}

export function interpretarCobranca(data: Record<string, unknown>): CobrancaPublica {
  const cob = (data.cobranca || {}) as Record<string, unknown>;
  const bol = (data.boleto || {}) as Record<string, unknown>;
  const pix = (data.pix || {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    status: String(cob.situacao || 'EM_PROCESSAMENTO'),
    codigo: String(cob.codigoSolicitacao || ''),
    seuNumero: String(cob.seuNumero || ''),
    vencimento: String(cob.dataVencimento || ''),
    valor: num(cob.valorNominal),
    linhaDigitavel: String(bol.linhaDigitavel || ''),
    codigoBarras: String(bol.codigoBarras || ''),
    pixCopiaECola: String(pix.pixCopiaECola || ''),
    valorRecebido: num(cob.valorTotalRecebido),
    erro: '',
  };
}

// ---------------------------------------------------------------------------
// Helpers de pagador (dados do cadastro do cliente)
// ---------------------------------------------------------------------------
/** Monta o pagador a partir das colunas do cadastro. Cidade/UF tem fallback
 *  Caxias do Sul/RS (base local). Sem documento -> null (boleto exige). */
export function montarPagador(client: Record<string, unknown>, docManual?: string): InterPagador | null {
  const dig = (v: unknown) => String(v || '').replace(/\D/g, '');
  const txt = (v: unknown) => String(v || '').trim();
  const doc = dig(docManual) || dig(client.cnpj);
  if (doc.length !== 11 && doc.length !== 14) return null;

  const nome = (txt(client.razao_social) || txt(client.nome_fantasia) || txt(client.nome) || 'CLIENTE').slice(0, 60);
  const logradouro = txt(client.endereco);
  const numero = txt(client.endereco_numero) || (logradouro.match(/,\s*(\d+)/)?.[1] ?? 'S/N');
  const cidade = txt(client.endereco_municipio) || 'CAXIAS DO SUL';
  const uf = (txt(client.endereco_uf).toUpperCase() || 'RS').slice(0, 2);
  const tel = dig(client.telefone);
  const pagador: InterPagador = {
    cpfCnpj: doc,
    tipoPessoa: doc.length === 14 ? 'JURIDICA' : 'FISICA',
    nome,
    endereco: (logradouro || '-').slice(0, 90),
    numero: numero.slice(0, 10),
    bairro: (txt(client.bairro) || '-').slice(0, 60),
    cidade: cidade.slice(0, 60),
    uf,
    cep: dig(client.endereco_cep) || undefined,
    email: txt(client.email) || undefined,
  };
  if (tel.length >= 10) {
    pagador.ddd = tel.slice(0, 2);
    pagador.telefone = tel.slice(2, 11);
  }
  return pagador;
}

/** seuNumero único (<=15 chars): DM- + 8 chars da venda + tentativa. */
export function seuNumeroBoleto(saleId: string, anterior?: string): string {
  const base = `DM${saleId.replace(/-/g, '').slice(0, 9)}`.toUpperCase();
  if (!anterior) return base.slice(0, 15);
  const m = anterior.match(/-r(\d+)$/);
  const n = m ? Number(m[1]) + 1 : 2;
  return `${base.slice(0, 12)}-r${n}`.slice(0, 15);
}

/** Data de hoje em SP como YYYY-MM-DD (para dataEmissao da notaFiscal). */
export function hojeSp(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Valida data de vencimento YYYY-MM-DD (nao muito distante). */
export function validaVencimento(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime());
}
