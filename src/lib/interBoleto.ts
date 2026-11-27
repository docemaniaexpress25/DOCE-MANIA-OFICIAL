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

/** Requisicao HTTPS com certificado da aplicacao (mTLS).
 *  BLOCO 230: timeout PARAMETRIZADO (antes 45s fixos) — a emissao de boleto
 *  é uma ação que o DONO espera na tela; cada chamada agora tem prazo curto
 *  (15-30s) e o retry tem DEADLINE total, para o GERAR nunca ficar minutos
 *  sem resposta (caso real 27/11 13:07: card girando 3 min porque a cadeia
 *  token+3 tentativas+fallback sem nota+consulta podia somar ~5,5 min). */
function mtlsRequest(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
  timeoutMs = 20_000
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
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout na API do Inter (${Math.round(timeoutMs / 1000)}s)`)));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Token OAuth (cache 55 min)
// BLOCO 231 — SINGLE-FLIGHT: quando o token expira com varias chamadas em
// voo (sync + webhook + GERAR do dono), TODAS pediam um token novo ao mesmo
// tempo — e o endpoint de token aceita só 5 req/min: a rajada tomava 429 e
// a emissao do dono caia em retry lento. Agora a PRIMEIRA chamada busca o
// token e as outras ESPERAM a mesma Promise (um unico pedido por instância).
// ---------------------------------------------------------------------------
let tokenCache: { token: string; exp: number } | null = null;
let tokenEmVoo: Promise<string> | null = null;

export async function obterToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && now < tokenCache.exp) return tokenCache.token;
  if (tokenEmVoo) return tokenEmVoo; // outra chamada já está buscando — espera a mesma

  tokenEmVoo = (async () => {
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
    }, 15_000); // BLOCO 230: token rápido — sem ele nada mais começa
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(res.body); } catch { /* segue */ }
    if (res.status !== 200 || !data.access_token) {
      throw new Error(`Falha ao autenticar no Inter (HTTP ${res.status}): ${String(data.error_description || data.error || res.body).slice(0, 200)}`);
    }
    tokenCache = { token: String(data.access_token), exp: Date.now() + TOKEN_TTL_MS };
    return tokenCache.token;
  })();
  try {
    return await tokenEmVoo;
  } finally {
    tokenEmVoo = null; // falhou ou passou — próxima chamada tenta de novo
  }
}

// ---------------------------------------------------------------------------
// BLOCO 231 — SINAL DE EMISSÃO EM VOO (prioridade do GERAR do dono).
// A causa real da demora de 27/11 13:07: o dono apertou GERAR 7 minutos
// depois do cron das 13:00, no meio de uma rodada de sync que virou PESADA
// com os blocos 226/228 (até ~42 chamadas ao Inter + listagem de cobranças
// de 2x500 itens) — emissão e sync disputaram a API e o POST do dono caiu
// em retry lento enquanto o card girava 3 minutos.
//
// O contador abaixo marca (POR INSTÂNCIA serverless) que uma EMISSÃO está
// acontecendo agora. O sync consulta esse sinal ENTRE chamadas e CENDE a
// vez (para de chamar o Inter por alguns segundos) enquanto o dono está
// esperando o boleto na tela. Com isso o GERAR volta a ser rápido como
// antes dos blocos 226/228: o sync nunca mais disputa a emissão.
// ---------------------------------------------------------------------------
type SinalEmissao = { __dmEmissoesEmVoo?: number };
const sinal = () => globalThis as unknown as SinalEmissao;

/** Entra/sai de região de emissão (sempre em try/finally pelo chamador). */
export function emissaoEntrar(): void {
  const s = sinal();
  s.__dmEmissoesEmVoo = (s.__dmEmissoesEmVoo || 0) + 1;
}
export function emissaoSair(): void {
  const s = sinal();
  s.__dmEmissoesEmVoo = Math.max(0, (s.__dmEmissoesEmVoo || 0) - 1);
}
/** true quando alguma emissão (GERAR do dono) está em voo nesta instância. */
export function temEmissaoEmVoo(): boolean {
  return (sinal().__dmEmissoesEmVoo || 0) > 0;
}
/**
 * Cede a vez à emissão: enquanto houver GERAR em voo, o sync dorme em ciclos
 * de 2s (máx. ~24s) sem chamar o Inter — a emissão do dono disputa a API
 * sozinha e sai em segundos. Devolve quanto tempo esperou (ms, diagnóstico).
 */
export async function cederAEmissao(maxEsperaMs = 24_000): Promise<number> {
  const inicio = Date.now();
  while (temEmissaoEmVoo() && Date.now() - inicio < maxEsperaMs) {
    await esperarMs(2_000);
  }
  return Date.now() - inicio;
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
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs = 20_000
): Promise<InterCobrancaResultado> {
  const cfg = getInterConfig();
  try {
    const token = await obterToken();
    const res = await mtlsRequest(method, `${cfg.baseUrl}${path}`, {
      headers: authHeaders(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    }, timeoutMs);
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
  // BLOCO 230: 15s por tentativa — o Inter saudável responde em ~2-12s
  // (medido 27/11: POST aceito em 12s de ponta a ponta); se travar, o
  // retry com deadline resolve mais rápido do que esperar 45s preso.
  return requestJson('POST', '/cobranca/v3/cobrancas', payload, 15_000);
}

// ---------------------------------------------------------------------------
// BLOCO 225 — RETRY AUTOMATICO PARA INSTABILIDADE DO INTER.
// Caso real (Paradouro do Campo, 27/11 07:48): o POST de emissao voltou com
// o erro TRANSIENTE "Tente novamente mais tarde, caso o erro persista favor
// entrar em contato com o suporte inter." e a parcela morreu em FALHA_EMISSAO
// sem nova tentativa — o dono ficou sem boleto ("nao consigo gerar nenhum
// boleto novo!"). 40 minutos depois o MESMO servidor Inter aceitou a outra
// parcela (08:28): era instabilidade passageira. Agora erros transientes
// (HTTP 429/500/502/503/504, timeout de rede ou mensagens de instabilidade)
// ganham RETRY: ate 3 tentativas com espera de 3s/6s. Falha de DADOS (400/
// 422 de validacao, 401 token, 403 escopo) NAO re-tenta — volta na hora.
// ---------------------------------------------------------------------------
export function ehErroTransienteInter(status: number, erro?: string): boolean {
  if (status === 0) return true; // falha de rede/timeout do nosso lado
  if (status === 429 || (status >= 500 && status <= 504)) return true;
  const t = String(erro || '').toLowerCase();
  return (
    t.includes('tente novamente') ||
    t.includes('suporte inter') ||
    t.includes('timeout') ||
    t.includes('tempo esgotado') ||
    t.includes('unavailable') ||
    t.includes('overloaded') ||
    t.includes('temporarily')
  );
}

const esperarMs = (ms: number) => new Promise(res => setTimeout(res, ms));

/** BLOCO 231: emissão com retry + deadline (230) MARCANDO o sinal de
 *  emissão em voo — durante o GERAR do dono o sync cede a vez e para de
 *  disputar a API do Inter (ver cederAEmissao / boletosSyncCore). */
export async function emitirCobrancaComRetryMarcada(
  payload: Parameters<typeof emitirCobranca>[0],
  opts?: { maxTentativas?: number; esperaBaseMs?: number; deadlineMs?: number }
): Promise<InterCobrancaResultado & { tentativas: number }> {
  emissaoEntrar();
  try {
    return await emitirCobrancaComRetry(payload, opts);
  } finally {
    emissaoSair();
  }
}

/** BLOCO 230: emissão com retry automático E DEADLINE TOTAL.
 *  - prazo por tentativa: 15s (emitirCobranca);
 *  - espera entre tentativas: 2s/4s (antes 3s/6s);
 *  - DEADLINE (deadlineMs, default 50s): quando o orçamento estoura, PARA
 *    de tentar e responde na hora — o dono nunca mais fica 3 minutos
 *    olhando o card girar (o pior caso antigo somava ~5,5 min: 6 tentativas
 *    x 45s + esperas + consulta).
 *  EMITIR_TODAS (2 parcelas) usa deadlineMs menor por chamada (~28s) para
 *  as duas emissões somarem menos que o prazo da função na Vercel. */
export async function emitirCobrancaComRetry(
  payload: Parameters<typeof emitirCobranca>[0],
  opts?: { maxTentativas?: number; esperaBaseMs?: number; deadlineMs?: number }
): Promise<InterCobrancaResultado & { tentativas: number }> {
  const maxTentativas = Math.min(Math.max(opts?.maxTentativas ?? 3, 1), 5);
  const esperaBaseMs = Math.max(opts?.esperaBaseMs ?? 2_000, 1_000);
  const deadlineMs = Math.max(opts?.deadlineMs ?? 50_000, 10_000);
  const inicio = Date.now();
  let ultimo: InterCobrancaResultado = { ok: false, status: 0, erro: 'emissao nao iniciada' };
  for (let i = 1; i <= maxTentativas; i++) {
    ultimo = await emitirCobranca(payload);
    if (ultimo.ok || !ehErroTransienteInter(ultimo.status, ultimo.erro)) {
      return { ...ultimo, tentativas: i };
    }
    if (i < maxTentativas) {
      // BLOCO 230: deadline — não inicia nova tentativa se o orçamento acabou
      if (Date.now() - inicio >= deadlineMs) break;
      await esperarMs((i - 1) * esperaBaseMs + esperaBaseMs); // 2s, depois 4s...
    }
  }
  return { ...ultimo, tentativas: maxTentativas };
}

/** Recupera a cobranca completa (situacao, linha digitavel, pix...).
 *  BLOCO 230: 15s — a consulta é leve; se o Inter travar, o card avisará
 *  em vez de girar 45s. */
export function recuperarCobranca(codigoSolicitacao: string): Promise<InterCobrancaResultado> {
  return requestJson('GET', `/cobranca/v3/cobrancas/${encodeURIComponent(codigoSolicitacao)}`, undefined, 15_000);
}

/** Recupera o PDF do boleto (JSON {pdf: base64}). BLOCO 230: 30s (PDF é maior). */
export async function recuperarPdf(codigoSolicitacao: string): Promise<{ ok: boolean; pdf?: Buffer; erro?: string }> {
  const r = await requestJson('GET', `/cobranca/v3/cobrancas/${encodeURIComponent(codigoSolicitacao)}/pdf`, undefined, 30_000);
  if (!r.ok) return { ok: false, erro: r.erro };
  const b64 = String((r.data as Record<string, unknown>)?.pdf || '');
  if (!b64) return { ok: false, erro: 'Inter nao devolveu o PDF (cobranca ainda processando?)' };
  return { ok: true, pdf: Buffer.from(b64, 'base64') };
}

/** Cancela a cobranca (motivo <= 50 caracteres). BLOCO 230: 20s. */
export function cancelarCobranca(codigoSolicitacao: string, motivo: string): Promise<InterCobrancaResultado> {
  return requestJson('POST', `/cobranca/v3/cobrancas/${encodeURIComponent(codigoSolicitacao)}/cancelar`, {
    motivoCancelamento: motivo.slice(0, 50),
  }, 20_000);
}

// ---------------------------------------------------------------------------
// BLOCO 220 — WEBHOOK DA COBRANCA V3: cadastrar/consultar/excluir VIA API.
//
// A resposta ao dono: o Internet Banking do Inter NAO tem tela para cadastrar
// webhook (por isso ele nao achava a funcao). A doc oficial "Como configurar
// um webhook?" (developers.inter.co/docs/webhooks/como-config-webhooks) manda
// CRIAR O WEBHOOK PELA API, na referencia da funcionalidade desejada. Para a
// Cobranca V3 (boleto com Pix), a referencia oficial (cobranca-bolepix,
// secao "Webhook") define:
//
//   PUT    /cobranca/v3/cobrancas/webhook   body {"webhookUrl": "https://..."}
//          -> 204 Sucesso | escopo boleto-cobranca.write | 5 req/min
//   GET    /cobranca/v3/cobrancas/webhook   -> {webhookUrl, criacao, atualizacao}
//          -> 404 quando nao ha webhook | escopo boleto-cobranca.read
//   DELETE /cobranca/v3/cobrancas/webhook   -> 204 | escopo boleto-cobranca.write
//
// Os escopos sao os MESMOS que o app ja usa para emitir/reconsultar boletos
// (obterToken) — nenhuma credencial nova e necessaria.
// ---------------------------------------------------------------------------

/** Estado do webhook no Inter (consulta REAL na API, mTLS). */
export interface WebhookInterEstado {
  ok: boolean;
  cadastrado: boolean;
  url: string;
  criacao: string;
  atualizacao: string;
  erro: string;
  /** true quando a falha e so de credenciais no ambiente (nada a concluir). */
  semCredenciais: boolean;
}

export async function consultarWebhookInter(): Promise<WebhookInterEstado> {
  const vazio: WebhookInterEstado = { ok: false, cadastrado: false, url: '', criacao: '', atualizacao: '', erro: '', semCredenciais: false };
  if (!isInterConfigured()) return { ...vazio, erro: 'INTER_NAO_CONFIGURADO — defina INTER_CLIENT_ID/SECRET e o certificado no ambiente', semCredenciais: true };
  const r = await requestJson('GET', '/cobranca/v3/cobrancas/webhook', undefined, 20_000);
  if (r.status === 404) return { ...vazio, ok: true, cadastrado: false, erro: '' };
  if (!r.ok) return { ...vazio, erro: r.erro || `HTTP ${r.status}` };
  const d = (r.data || {}) as Record<string, unknown>;
  return {
    ok: true,
    cadastrado: !!d.webhookUrl,
    url: String(d.webhookUrl || ''),
    criacao: String(d.criacao || ''),
    atualizacao: String(d.atualizacao || ''),
    erro: '',
    semCredenciais: false,
  };
}

/** Cadastra/reponta o webhook da Cobranca V3 (PUT — o Inter aceita re-PUT). */
export async function cadastrarWebhookInter(webhookUrl: string): Promise<WebhookInterEstado> {
  const vazio: WebhookInterEstado = { ok: false, cadastrado: false, url: '', criacao: '', atualizacao: '', erro: '', semCredenciais: false };
  const url = (webhookUrl || '').trim();
  if (!/^https:\/\/[^\s]+$/.test(url)) return { ...vazio, erro: 'URL invalida — deve iniciar com https:// (sem espacos)' };
  if (!isInterConfigured()) return { ...vazio, erro: 'INTER_NAO_CONFIGURADO — defina INTER_CLIENT_ID/SECRET e o certificado no ambiente', semCredenciais: true };
  const r = await requestJson('PUT', '/cobranca/v3/cobrancas/webhook', { webhookUrl: url }, 20_000);
  if (!r.ok) return { ...vazio, erro: r.erro || `HTTP ${r.status}` };
  // Re-consulta o estado final (fonte da verdade — o PUT responde 204 vazio)
  const estado = await consultarWebhookInter();
  if (!estado.ok) return { ...vazio, ok: true, cadastrado: true, url, erro: '' };
  return estado;
}

/** Exclui o webhook cadastrado (DELETE). */
export async function excluirWebhookInter(): Promise<{ ok: boolean; erro: string }> {
  if (!isInterConfigured()) return { ok: false, erro: 'INTER_NAO_CONFIGURADO — defina INTER_CLIENT_ID/SECRET e o certificado no ambiente' };
  const r = await requestJson('DELETE', '/cobranca/v3/cobrancas/webhook', undefined, 20_000);
  if (r.status === 404) return { ok: true, erro: '' }; // ja nao existia — objetivo alcancado
  if (!r.ok) return { ok: false, erro: r.erro || `HTTP ${r.status}` };
  return { ok: true, erro: '' };
}

// ---------------------------------------------------------------------------
// BLOCO 205 — PORTAL DE COBRANCAS: colecao de cobrancas (boleto atrasado)
// ---------------------------------------------------------------------------
export interface CobrancaColecaoItem {
  codigo: string;           // codigoSolicitacao
  seuNumero: string;
  situacao: string;
  vencimento: string;       // YYYY-MM-DD
  valor: number | null;
  pagadorNome: string;
  pagadorDoc: string;       // so digitos
}

/**
 * Lista cobrancas da API do Inter (GET /cobranca/v3/cobrancas — colecao).
 *
 * BLOCO 218 — CORRECAO CRITICA (portal de cobrancas mostrava "tudo em dia"
 * com boletos vencidos): a consulta estava na SPEC V2 deprecada. A colecao
 * V3 (spec OpenAPI oficial swagger-cobranca-bolepix.yaml, operacao
 * pesquisaCobranca) usa:
 *   - paginacao.paginaAtual   (0-based, default 0)  — nao era enviado
 *   - paginacao.itensPorPagina (default 100, MAX 1000) — antes ia `size` (ignorado)
 *   - ordenarPor=DATA_VENCIMENTO + tipoOrdenacao=ASC — o default da API e
 *     PESSOA_PAGADORA (alfabetico), que espalha os vencidos pelas paginas
 *   - resposta: array em `cobrancas` + `totalPaginas` (antes leia `itens`/`qtdPaginas`)
 * Janela de vencimento [dataInicial, dataFinal] (YYYY-MM-DD). O parser segue
 * defensivo: aceita `cobrancas` (V3), `itens` (legado) ou array direto.
 * Situacao do boleto vencido e nao pago na V3: ATRASADO.
 */
export async function listarCobrancas(opts: {
  dataInicial: string;
  dataFinal: string;
  size?: number;
  maxPaginas?: number;
}): Promise<{ ok: boolean; itens: CobrancaColecaoItem[]; erro?: string; paginas?: number }> {
  const size = Math.min(Math.max(opts.size || 500, 1), 1000);
  const maxPaginas = Math.min(Math.max(opts.maxPaginas || 5, 1), 10);
  const todas: CobrancaColecaoItem[] = [];
  // BLOCO 230: deadline TOTAL da listagem (30s por página) — a varredura do
  // sync/portal não pode ficar 150s+ preso se o Inter começar a travar.
  const inicioListagem = Date.now();
  const DEADLINE_LISTAGEM_MS = 110_000;

  const parseItem = (raw: Record<string, unknown>): CobrancaColecaoItem | null => {
    const cob = ((raw.cobranca as Record<string, unknown>) || raw) as Record<string, unknown>;
    const pag = ((cob.pagador as Record<string, unknown>) || (raw.pagador as Record<string, unknown>) || {}) as Record<string, unknown>;
    const codigo = String(cob.codigoSolicitacao || raw.codigoSolicitacao || '');
    if (!codigo) return null;
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
    return {
      codigo,
      seuNumero: String(cob.seuNumero || raw.seuNumero || ''),
      situacao: String(cob.situacao || raw.situacao || cob.status || ''),
      vencimento: String(cob.dataVencimento || raw.dataVencimento || ''),
      valor: num(cob.valorNominal ?? raw.valorNominal),
      pagadorNome: String(pag.nome || ''),
      pagadorDoc: String(pag.cpfCnpj || pag.cpf_cnpj || '').replace(/\D/g, ''),
    };
  };

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const qs = new URLSearchParams({
      dataInicial: opts.dataInicial,
      dataFinal: opts.dataFinal,
      // SPEC V3: paginacao em sub-campos (BLOCO 218 — antes size/page da V2
      // eram ignorados e a resposta `cobrancas` nunca era lida)
      'paginacao.paginaAtual': String(pagina),
      'paginacao.itensPorPagina': String(size),
      ordenarPor: 'DATA_VENCIMENTO',
      tipoOrdenacao: 'ASC',
    });
    const r = await requestJson('GET', `/cobranca/v3/cobrancas?${qs.toString()}`, undefined, 30_000);
    if (!r.ok) return { ok: false, itens: todas, erro: r.erro };
    const data = r.data as Record<string, unknown>;
    const arr: Record<string, unknown>[] = Array.isArray((data as { cobrancas?: unknown }).cobrancas)
      ? ((data as { cobrancas: unknown[] }).cobrancas as Record<string, unknown>[])
      : Array.isArray((data as { itens?: unknown }).itens)
        ? ((data as { itens: unknown[] }).itens as Record<string, unknown>[])
        : (Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : []);
    for (const raw of arr) {
      const it = parseItem(raw);
      if (it) todas.push(it);
    }
    const qtdPaginas = Number((data as Record<string, unknown>).totalPaginas || (data as Record<string, unknown>).qtdPaginas || 1);
    // BLOCO 230: para por deadline total ou fim real da paginação
    if (Date.now() - inicioListagem >= DEADLINE_LISTAGEM_MS) break;
    if (!Number.isFinite(qtdPaginas) || pagina + 1 >= qtdPaginas || arr.length < size) break;
  }
  return { ok: true, itens: todas, paginas: maxPaginas };
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
  /** FIX atrelamento: chave da NF-e/NFC-e atrelada à cobrança (o Inter devolve
   *  em cobranca.notaFiscal.chaveNFe quando o boleto nasceu com a nota). */
  notaFiscalChave: string;
}

export function interpretarCobranca(data: Record<string, unknown>): CobrancaPublica {
  const cob = (data.cobranca || {}) as Record<string, unknown>;
  const bol = (data.boleto || {}) as Record<string, unknown>;
  const pix = (data.pix || {}) as Record<string, unknown>;
  const nf = (cob.notaFiscal || (data as Record<string, unknown>).notaFiscal || {}) as Record<string, unknown>;
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
    notaFiscalChave: String(nf.chaveNFe || nf.chave || '').replace(/\D/g, ''),
  };
}

// ---------------------------------------------------------------------------
// Helpers de pagador (dados do cadastro do cliente)
// ---------------------------------------------------------------------------
/** Monta o pagador a partir das colunas do cadastro.
 *  - docManual: CPF/CNPJ digitado na tela quando o cadastro nao tem documento
 *  - cepManual: CEP digitado na tela quando o cadastro nao tem CEP
 *    (o Inter EXIGE cep com 8 digitos — sem ele recusa a cobranca com a
 *    mensagem generica "Verifique se os dados informados...")
 *  Cidade/UF tem fallback Caxias do Sul/RS (base local). Sem documento -> null. */
export function montarPagador(client: Record<string, unknown>, docManual?: string, cepManual?: string): InterPagador | null {
  const dig = (v: unknown) => String(v || '').replace(/\D/g, '');
  const txt = (v: unknown) => String(v || '').trim();
  const doc = dig(docManual) || dig(client.cnpj) || dig(client.cpf); // BLOCO 189: CPF do cadastro entra como fallback do pagador
  if (doc.length !== 11 && doc.length !== 14) return null;
  const cep = dig(cepManual) || dig(client.endereco_cep) || undefined;

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
    cep,
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

/**
 * BLOCO 199 (BOLETO DUPLICO — rota 5): seuNumero único POR PARCELA (<=15 chars).
 * Base = DM + 8 chars da venda; parcela entra como -P<seq>; reemissão acumula
 * r2, r3... Ex.: DMBB1E53EE-P1 / DMBB1E53EE-P1r2 (15 chars no limite).
 * O webhook casa a baixa por codigo e, no fallback, por este seu_numero
 * gravado inteiro na sales_boletos (sem truncar).
 */
export function seuNumeroParcela(saleId: string, seq: number, anterior?: string): string {
  const base = `DM${saleId.replace(/-/g, '').slice(0, 8)}`.toUpperCase();
  if (!anterior) return `${base}-P${seq}`.slice(0, 15);
  const m = anterior.match(/-r(\d+)$/);
  const n = m ? Number(m[1]) + 1 : 2;
  return `${base}-P${seq}r${n}`.slice(0, 15);
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
