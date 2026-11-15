import crypto from 'node:crypto';

/**
 * Cliente SPEDY (docs.spedy.com.br) — emissao de NF-e/NFC-e, recebimento DFe
 * (notas contra o CNPJ da empresa), certificado A1 e catalogo de produtos,
 * via API REST (X-Api-Key).
 *
 * BLOCO 95: decisao do dono — a integracao fiscal sera pela SPEDY. Este
 * modulo PREPARA o app para a troca: NENHUM fluxo de venda chama nada daqui
 * ainda (/api/notas segue na Focus ate o dono ligar a Spedy em producao).
 * Tudo aqui e "dormant" — usado so pela aba Fiscal (admin) para status,
 * teste de conexao, certificado e importacao das notas recebidas.
 *
 * SOMENTE SERVER-SIDE: a API key e segredo e vive em env var (Vercel).
 *   SPEDY_API_KEY      -> X-Api-Key (obrigatorio p/ qualquer chamada)
 *   SPEDY_AMBIENTE     -> 'sandbox' (default — plano Desenvolvedor gratis)
 *                         | 'producao'
 *   SPEDY_EMPRESA_ID   -> id da empresa emissora na Spedy (v1/companies/{id})
 *   SPEDY_NATUREZA     -> natureza da operacao (default 'Venda de mercadoria')
 *   SPEDY_UF_EMITENTE  -> UF do emitente (default 'RS' — decide CFOP 5102/6102)
 *
 * ENDPOINTS (referencia docs.spedy.com.br/api-reference):
 *   GET  /v1/companies                          — empresas da conta (teste conexao)
 *   GET  /v1/companies/{id}/certificates        — certificados A1 (isActive/expirationAt)
 *   POST /v1/companies/{id}/certificates        — upload .pfx + senha (multipart)
 *   PUT  /v1/companies/{id}/settings            — liga inbound (notas recebidas)
 *   POST /v1/product-invoices                   — NF-e (modelo 55) — ASSINCRONA
 *   POST /v1/consumer-invoices                  — NFC-e (modelo 65) — ASSINCRONA
 *   GET  /v1/{product|consumer}-invoices/{id}   — status (processingDetail)
 *   GET  /v1/{product|consumer}-invoices/{id}/pdf|xml — DANFE / XML autorizado
 *   POST /v1/{product|consumer}-invoices/{id}/corrections — CC-e (NF-e)
 *   POST /v1/{product|consumer}-invoices/{id}/cancelations — cancelamento
 *   POST /v1/inbound-product-invoices/sync      — busca antecipada SEFAZ (429 + Retry-After)
 *   GET  /v1/inbound-product-invoices           — notas recebidas (cursor)
 *   GET  /v1/inbound-product-invoices/{id}/xml  — XML da recebida (pos-manifestacao)
 *
 * PAGAMENTO + BOLETO (pergunta do dono — "como atrelar o boleto a nota?"):
 *   - metodo tPag da Spedy: money | check | creditCard | debitCard |
 *     storeCredit | foodVoucher | mealVoucher | giftVoucher | fuelVoucher |
 *     commercialDuplicate | BILLETBANKING (boleto bancario) | bankDeposit |
 *     dynamicPix | bankTransfer | fidelityProgram | pix | noPayment | other
 *   - Venda A PRAZO c/ boleto: payments [{ method:'billetBanking', amount }]
 *     + billing { number, originalAmount, netAmount } + duplicates[] com
 *     { number [nDup], dueDate [dVenc], amount [vDup] } — cada duplicata e
 *     uma parcela; o boleto em si nasce no BANCO INTER (interBoleto.ts,
 *     seuNumero DM+saleId) e o app amarra: venda -> nota (nDup = parcela) ->
 *     boleto (nosso numero) -> baixa no webhook do Inter.
 *   - NFC-e NAO leva boleto/duplicata (venda a prazo na rota = NF-e).
 */

export type SpedyAmbiente = 'sandbox' | 'producao';
export type SpedyDoc = 'product-invoices' | 'consumer-invoices'; // NF-e | NFC-e

// ---------------------------------------------------------------------------
// Config (env)
// ---------------------------------------------------------------------------
export function getSpedyConfig() {
  const apiKey = process.env.SPEDY_API_KEY || '';
  const ambiente = (process.env.SPEDY_AMBIENTE as SpedyAmbiente) || 'sandbox';
  return {
    apiKey,
    ambiente,
    baseUrl: ambiente === 'producao' ? 'https://api.spedy.com.br' : 'https://sandbox-api.spedy.com.br',
    backofficeUrl: ambiente === 'producao' ? 'https://app.spedy.com.br' : 'https://sandbox-app.spedy.com.br',
    empresaId: process.env.SPEDY_EMPRESA_ID || '',
    natureza: process.env.SPEDY_NATUREZA || 'Venda de mercadoria',
    ufEmitente: (process.env.SPEDY_UF_EMITENTE || 'RS').toUpperCase(),
    // BLOCO 95 (webhook): segredo das assinaturas Standard Webhooks (valor de
    // GET /v1/webhooks/secret — aceita com ou sem prefixo whsec_) e a chave
    // geral do app. Sem segredo o /api/spedy/webhook recusa TUDO (503) — o
    // endpoint fica exposto na internet e nao aceita nada nao assinado.
    webhookSecret: process.env.SPEDY_WEBHOOK_SECRET || '',
    enabled: process.env.SPEDY_ENABLED === '1',
  };
}

export function isSpedyConfigured(): boolean {
  return !!getSpedyConfig().apiKey;
}

function soDigitos(v?: string | null): string {
  return (v || '').replace(/\D/g, '');
}

// ---------------------------------------------------------------------------
// Request basico (JSON)
// ---------------------------------------------------------------------------
async function spedyRequest<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  body?: unknown,
  timeoutMs = 45_000
): Promise<{ ok: boolean; status: number; data: T & Record<string, unknown>; retryAfterSeconds?: number }> {
  const { apiKey, baseUrl } = getSpedyConfig();
  if (!apiKey) return { ok: false, status: 0, data: { erro: 'SPEDY_API_KEY nao configurada.' } as T & Record<string, unknown> };
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { erro: `Resposta nao-JSON da Spedy: ${text.slice(0, 200)}` };
    }
    const out: { ok: boolean; status: number; data: T & Record<string, unknown>; retryAfterSeconds?: number } = {
      ok: res.ok,
      status: res.status,
      data: data as T & Record<string, unknown>,
    };
    if (res.status === 429) {
      // Docs: corpo traz retryAfterSeconds; header Retry-After (segundos)
      const ra = Number((data as Record<string, unknown>)?.retryAfterSeconds);
      const hdr = Number(res.headers.get('retry-after'));
      out.retryAfterSeconds = Number.isFinite(ra) && ra > 0 ? ra : Number.isFinite(hdr) && hdr > 0 ? hdr : 60;
    }
    return out;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, data: { erro: `Falha de rede com a Spedy: ${msg}` } as T & Record<string, unknown> };
  }
}

/** Download de BINARIO (PDF do DANFE / XML) — devolve Buffer + content-type. */
async function spedyDownload(
  path: string,
  timeoutMs = 60_000
): Promise<{ ok: boolean; status: number; buffer?: Buffer; contentType?: string; erro?: string }> {
  const { apiKey, baseUrl } = getSpedyConfig();
  if (!apiKey) return { ok: false, status: 0, erro: 'SPEDY_API_KEY nao configurada.' };
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, erro: `Spedy ${res.status}: ${text.slice(0, 300)}` };
    }
    const ab = await res.arrayBuffer();
    return { ok: true, status: res.status, buffer: Buffer.from(ab), contentType: res.headers.get('content-type') || undefined };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, erro: `Falha de download na Spedy: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Empresas + Certificado A1
// ---------------------------------------------------------------------------
export interface SpedyEmpresa {
  id: string;
  federalTaxNumber?: string;
  name?: string;
  tradeName?: string;
  [k: string]: unknown;
}

/** GET /v1/companies — teste de conexao + achar a empresa emissora. */
export async function listarEmpresasSpedy() {
  return spedyRequest<{ data?: SpedyEmpresa[] } | Spedy[]>('GET', '/v1/companies');
}

export interface SpedyCertificado {
  id: string;
  subject?: string;
  issuer?: string;
  expirationAt?: string;
  isActive?: boolean;
  [k: string]: unknown;
}

/** GET /v1/companies/{id}/certificates — validade do A1 (expirou = nao emite!). */
export async function listarCertificadosSpedy(empresaId?: string) {
  const emp = empresaId || getSpedyConfig().empresaId;
  if (!emp) return { ok: false, status: 0, data: { erro: 'SPEDY_EMPRESA_ID nao configurada.' } };
  return spedyRequest<{ data?: SpedyCertificado[] } | SpedyCertificado[]>('GET', `/v1/companies/${emp}/certificates`);
}

/** POST multipart — upload do certificado A1 (.pfx + senha). A Spedy guarda e
 *  assina por nos: o app NUNCA manipula o arquivo alem deste repasse. */
export async function enviarCertificadoSpedy(opts: {
  empresaId?: string;
  arquivoBase64: string; // conteudo do .pfx em base64
  nomeArquivo?: string;
  senha: string;
}) {
  const emp = opts.empresaId || getSpedyConfig().empresaId;
  if (!emp) return { ok: false, status: 0, data: { erro: 'SPEDY_EMPRESA_ID nao configurada.' } };
  const { apiKey, baseUrl } = getSpedyConfig();
  if (!apiKey) return { ok: false, status: 0, data: { erro: 'SPEDY_API_KEY nao configurada.' } };
  try {
    const form = new FormData();
    const bytes = Buffer.from(opts.arquivoBase64, 'base64');
    form.append('certificateFile', new Blob([new Uint8Array(bytes)], { type: 'application/x-pkcs12' }), opts.nomeArquivo || 'certificado.pfx');
    form.append('password', opts.senha);
    const res = await fetch(`${baseUrl}/v1/companies/${emp}/certificates`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { erro: text.slice(0, 300) }; }
    return { ok: res.ok, status: res.status, data: data as Record<string, unknown> };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, data: { erro: `Falha enviando certificado: ${msg}` } };
  }
}

/** PUT /v1/companies/{id}/settings — liga o recebimento DFe (notas contra o
 *  CNPJ). startDate NAO pode ser mais de 90 dias atras (limite da SEFAZ). */
export async function habilitarInboundSpedy(empresaId?: string, startDate?: string) {
  const emp = empresaId || getSpedyConfig().empresaId;
  if (!emp) return { ok: false, status: 0, data: { erro: 'SPEDY_EMPRESA_ID nao configurada.' } };
  const inicio = startDate || new Date().toISOString().slice(0, 10);
  return spedyRequest('PUT', `/v1/companies/${emp}/settings`, {
    productInvoice: { inbound: { enabled: true, startDate: inicio } },
  });
}

// ---------------------------------------------------------------------------
// Pagamentos / cobranca (boleto atrelado a nota)
// ---------------------------------------------------------------------------
export type SpedyMetodoPagamento =
  | 'money' | 'check' | 'creditCard' | 'debitCard' | 'storeCredit'
  | 'foodVoucher' | 'mealVoucher' | 'giftVoucher' | 'fuelVoucher'
  | 'commercialDuplicate' | 'billetBanking' | 'bankDeposit'
  | 'dynamicPix' | 'bankTransfer' | 'fidelityProgram' | 'pix'
  | 'noPayment' | 'other';

/** Metodo do APP -> tPag da Spedy. A_PRAZO na NF-e = billetBanking (boleto
 *  bancario, tPag 15) — as parcelas/vencimentos vao no bloco duplicates. */
export function metodoSpedy(metodo?: string | null): SpedyMetodoPagamento {
  const m = String(metodo || '').toUpperCase();
  if (m === 'PIX') return 'pix';
  if (m === 'CHEQUE') return 'check';
  if (m === 'A_PRAZO') return 'billetBanking';
  if (m === 'CARTAO_CREDITO' || m === 'CREDITO') return 'creditCard';
  if (m === 'CARTAO_DEBITO' || m === 'DEBITO') return 'debitCard';
  return 'money';
}

export interface SpedyDuplicata {
  number: string;    // nDup — "NF 123/1" (parcela)
  dueDate: string;   // dVenc
  amount: number;    // vDup
}

export interface SpedyBilling {
  number: string;        // nFat
  originalAmount: number; // vOrig
  discountAmount?: number; // vDesc
  netAmount: number;    // vLiq
}

/** Duplicatas de uma venda a prazo: n parcelas iguais (a ultima absorve os
 *  centavos de arredondamento) com vencimentos mensais a partir da data. */
export function montarDuplicatas(opts: {
  numeroNota: string;        // numero da nota (ou ref da venda antes de autorizar)
  valorTotal: number;
  parcelas: number;
  primeiroVencimento?: Date;
}): SpedyDuplicata[] {
  const n = Math.max(1, Math.min(12, Math.round(opts.parcelas)));
  if (n <= 1) {
    return [{
      number: `${opts.numeroNota}/1`,
      dueDate: (opts.primeiroVencimento ?? new Date()).toISOString(),
      amount: Math.round(opts.valorTotal * 100) / 100,
    }];
  }
  const centavos = Math.round(opts.valorTotal * 100);
  const base = Math.floor(centavos / n);
  const resto = centavos - base * n;
  const primeiro = opts.primeiroVencimento ?? new Date();
  const dups: SpedyDuplicata[] = [];
  for (let i = 0; i < n; i++) {
    const venc = new Date(primeiro.getTime());
    venc.setMonth(venc.getMonth() + i);
    const valor = (base + (i === n - 1 ? resto : 0)) / 100;
    dups.push({ number: `${opts.numeroNota}/${i + 1}`, dueDate: venc.toISOString(), amount: valor });
  }
  return dups;
}

// ---------------------------------------------------------------------------
// Payload de emissao (Simples Nacional — CSOSN 102 / PIS-COFINS 49)
// ---------------------------------------------------------------------------
export interface SpedyItemPayload {
  code: string;
  description: string;
  ncm: string;
  cfop: number;
  unit: string;
  quantity: number;
  unitAmount: number;
  unitTax: string;
  quantityTax: number;
  unitTaxAmount: number;
  totalAmount: number;
  taxes: {
    icms: { origin: number; csosn: number };
    pis: { cst: number };
    cofins: { cst: number };
  };
}

export interface SpedyDestinatarioPayload {
  name: string;
  federalTaxNumber?: string;
  email?: string;
  address?: {
    street: string; number: string; district: string;
    postalCode: string; city: { name: string; state: string };
  };
}

export interface SpedyNfePayload {
  integrationId?: string;      // idempotencia: "VENDA-<saleId>" (reemissao -r2...)
  transactionId?: string;
  effectiveDate: string;       // ISO (NFC-e: SEMPRE agora — SEFAZ recusa > 5 min)
  operationNature: string;
  isFinalCustomer: boolean;
  receiver: SpedyDestinatarioPayload;
  payments: { method: SpedyMetodoPagamento; amount: number }[];
  billing?: SpedyBilling;      // venda a prazo (boleto)
  duplicates?: SpedyDuplicata[]; // parcelas da venda a prazo
  items: SpedyItemPayload[];
  [k: string]: unknown;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

interface ItemVendaInput {
  codigo?: string;
  descricao: string;
  ncm?: string;
  cfop?: string;
  ean?: string;
  unidade?: string;
  origem?: string;
  quantidade: number;
  valorUnitario: number;
}

function montarItensSpedy(opts: {
  itens: ItemVendaInput[];
  valorTotalVenda: number;
  ufDestino: string;
  ufEmitente: string;
}): { items: SpedyItemPayload[] } {
  const descontoTotal = round2(Math.max(0, round2(opts.itens.reduce((a, it) => a + it.quantidade * it.valorUnitario, 0)) - opts.valorTotalVenda));
  const items: SpedyItemPayload[] = opts.itens.map((it, i) => {
    const bruto = round2(it.quantidade * it.valorUnitario);
    const desconto = i === 0 ? descontoTotal : 0;
    return {
      code: (it.codigo || `P${i + 1}`).slice(0, 60),
      description: normaliza(it.descricao, 120),
      ncm: soDigitos(it.ncm) || '21069090', // guarda do modulo Focus (doce/salgado generico)
      cfop: Number(soDigitos(it.cfop) || (opts.ufDestino === opts.ufEmitente ? '5102' : '6102')) || 5102,
      unit: (it.unidade || 'UN').toUpperCase().slice(0, 6),
      quantity: it.quantidade,
      unitAmount: round2(it.valorUnitario),
      // trio tributavel espelhado (docs: item inline precisa dos 3)
      unitTax: (it.unidade || 'UN').toUpperCase().slice(0, 6),
      quantityTax: it.quantidade,
      unitTaxAmount: round2(it.valorUnitario),
      totalAmount: round2(bruto - desconto),
      taxes: {
        icms: { origin: Number(soDigitos(it.origem) || '0') || 0, csosn: 102 }, // Simples Nacional s/ credito
        pis: { cst: 49 },    // outras saidas — DAS
        cofins: { cst: 49 },
      },
    };
  });
  return { items };
}

function normaliza(v: string, max: number): string {
  return (v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function montarReceiver(d: SpedyDestinatarioPayload): SpedyDestinatarioPayload {
  const doc = soDigitos(d.federalTaxNumber);
  const out: SpedyDestinatarioPayload = { name: normaliza(d.name, 60) || 'CONSUMIDOR FINAL' };
  if (doc.length === 11 || doc.length === 14) out.federalTaxNumber = doc;
  if (d.email) out.email = d.email.trim().slice(0, 80);
  if (d.address) {
    out.address = {
      street: normaliza(d.address.street, 60),
      number: (d.address.number || 'S/N').slice(0, 10),
      district: normaliza(d.address.district, 60) || 'CENTRO',
      postalCode: soDigitos(d.address.postalCode).slice(0, 8),
      city: { name: normaliza(d.address.city?.name, 60) || 'CIDADE', state: (d.address.city?.state || 'RS').toUpperCase().slice(0, 2) },
    };
  }
  return out;
}

/** ISO com fuso de SP (igual ao modulo Focus — offset fixo -03:00). */
function isoComFuso(d: Date): string {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d);
  return `${p.replace(' ', 'T')}-03:00`;
}

/** Payload NF-e (modelo 55) — venda com boleto A PRAZO ganha billing+duplicates. */
export function montarPayloadNfeSpedy(opts: {
  integrationId: string;
  dataEmissao: Date;
  natureza?: string;
  ufEmitente?: string;
  destinatario: SpedyDestinatarioPayload;
  itens: ItemVendaInput[];
  valorTotalVenda: number;
  metodo: string;
  /** Venda a prazo: parcelas + 1o vencimento (boleto Inter amarrado pelo nDup) */
  parcelas?: number;
  primeiroVencimento?: Date;
  informacoesAdicionais?: string;
}): SpedyNfePayload {
  const cfg = getSpedyConfig();
  const ufEmit = opts.ufEmitente || cfg.ufEmitente;
  const ufDestino = '';
  const { items } = montarItensSpedy({ itens: opts.itens, valorTotalVenda: opts.valorTotalVenda, ufDestino, ufEmitente: ufEmit });
  const aPrazo = String(opts.metodo || '').toUpperCase() === 'A_PRAZO';
  const payload: SpedyNfePayload = {
    integrationId: opts.integrationId,
    effectiveDate: isoComFuso(opts.dataEmissao),
    operationNature: opts.natureza || cfg.natureza,
    isFinalCustomer: true,
    receiver: montarReceiver(opts.destinatario),
    payments: [{ method: metodoSpedy(opts.metodo), amount: round2(opts.valorTotalVenda) }],
    items,
  };
  if (aPrazo) {
    const parcelas = Math.max(1, Math.min(12, opts.parcelas || 1));
    payload.duplicates = montarDuplicatas({
      numeroNota: opts.integrationId.replace(/^VENDA-/i, 'NF'),
      valorTotal: opts.valorTotalVenda,
      parcelas,
      primeiroVencimento: opts.primeiroVencimento,
    });
    payload.billing = {
      number: opts.integrationId,
      originalAmount: round2(opts.valorTotalVenda),
      netAmount: round2(opts.valorTotalVenda),
    };
  }
  if (opts.informacoesAdicionais) {
    payload.additionalInformation = normaliza(opts.informacoesAdicionais, 500);
  }
  return payload;
}

/** Payload NFC-e (modelo 65) — consumidor final, SEMPRE agora, SEM boleto. */
export function montarPayloadNfceSpedy(opts: {
  integrationId: string;
  natureza?: string;
  ufEmitente?: string;
  destinatario?: SpedyDestinatarioPayload; // opcional (consumidor anonimo)
  itens: ItemVendaInput[];
  valorTotalVenda: number;
  metodo: string;
  informacoesAdicionais?: string;
}): SpedyNfePayload {
  const cfg = getSpedyConfig();
  const ufEmit = opts.ufEmitente || cfg.ufEmitente;
  const { items } = montarItensSpedy({ itens: opts.itens, valorTotalVenda: opts.valorTotalVenda, ufDestino: ufEmit, ufEmitente: ufEmit });
  const receiver: SpedyDestinatarioPayload = opts.destinatario
    ? montarReceiver(opts.destinatario)
    : { name: 'CONSUMIDOR FINAL' };
  const payload: SpedyNfePayload = {
    integrationId: opts.integrationId,
    effectiveDate: isoComFuso(new Date()),
    operationNature: opts.natureza || 'VENDA DE MERCADORIA ACQR',
    isFinalCustomer: true,
    receiver,
    payments: [{ method: metodoSpedy(opts.metodo), amount: round2(opts.valorTotalVenda) }],
    items,
  };
  if (opts.informacoesAdicionais) {
    payload.additionalInformation = normaliza(opts.informacoesAdicionais, 500);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Emissao (ASSINCRONA! 2xx = aceita, nao autorizada — webhook/consulta)
// ---------------------------------------------------------------------------
export async function emitirNfeSpedy(payload: SpedyNfePayload) {
  return spedyRequest('POST', '/v1/product-invoices', payload);
}

export async function emitirNfceSpedy(payload: SpedyNfePayload) {
  return spedyRequest('POST', '/v1/consumer-invoices', payload);
}

export async function obterNotaSpedy(doc: SpedyDoc, id: string) {
  return spedyRequest('GET', `/v1/${doc}/${id}`);
}

export async function baixarPdfNotaSpedy(doc: SpedyDoc, id: string) {
  return spedyDownload(`/v1/${doc}/${id}/pdf`);
}

export async function baixarXmlNotaSpedy(doc: SpedyDoc, id: string) {
  return spedyDownload(`/v1/${doc}/${id}/xml`);
}

export async function cancelarNotaSpedy(doc: SpedyDoc, id: string, reason: string) {
  return spedyRequest('POST', `/v1/${doc}/${id}/cancelations`, { reason: normaliza(reason, 255) });
}

export async function cartaCorrecaoSpedy(doc: SpedyDoc, id: string, letter: string) {
  return spedyRequest('POST', `/v1/${doc}/${id}/corrections`, { letter: normaliza(letter, 1000) });
}

/** Status da nota na Spedy -> status do app (sales.nota_status). */
export function interpretarResultadoSpedy(nota: Record<string, unknown>) {
  const status = String(nota.status || '').toLowerCase();
  const detail = (nota.processingDetail || {}) as Record<string, unknown>;
  const erro = String(detail.erro || detail.message || nota.erro || '');
  return {
    id: String(nota.id || ''),
    // enqueued | authorized | rejected | canceled | denied | disabled...
    autorizada: status === 'authorized' || status === 'autorizado',
    cancelada: status === 'canceled' || status === 'cancelado',
    processando: ['enqueued', 'processing', 'processando_autorizacao'].includes(status),
    rejeitada: status === 'rejected' || status === 'denied',
    statusBruto: status,
    numero: String(nota.number || ''),
    serie: String(nota.series || ''),
    chave: soDigitos(String(nota.accessKey || '')).slice(-44),
    motivo: erro,
    environment: String(nota.environment || ''),
  };
}

// ---------------------------------------------------------------------------
// Notas RECEBIDAS (DFe — a fonte dos "produtos vindos da XML")
// ---------------------------------------------------------------------------
export async function sincronizarInboundSpedy() {
  return spedyRequest('POST', '/v1/inbound-product-invoices/sync', undefined, 30_000);
}

export interface SpedInboundNota {
  id: string;
  accessKey?: string;
  status?: string;
  manifestationStatus?: string;
  isComplete?: boolean;
  emitter?: { federalTaxNumber?: string; name?: string };
  amount?: number;
  issueDate?: string;
  [k: string]: unknown;
}

/** GET /v1/inbound-product-invoices — notas contra o CNPJ (paginacao cursor). */
export async function listarInboundSpedy(params?: { cursor?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return spedyRequest<{ data?: SpedInboundNota[]; nextCursor?: string } | SpedInboundNota[]>(
    'GET', `/v1/inbound-product-invoices${q ? `?${q}` : ''}`
  );
}

export async function baixarXmlInboundSpedy(id: string) {
  return spedyDownload(`/v1/inbound-product-invoices/${id}/xml`);
}

// ---------------------------------------------------------------------------
// Webhooks (rota /api/spedy/webhook — eventos que importam pro app)
// ---------------------------------------------------------------------------

/**
 * BLOCO 95: o integrationId que o app manda na emissao e "VENDA-<saleId>"
 * (reemissao anexa -r2, -r3... no fim). O webhook decompoe de volta para
 * achar a venda no espelho sales.nota_*.
 */
export function decompoeIntegrationId(ref?: string | null): { saleId: string | null } {
  const raw = String(ref || '').trim();
  const m = raw.match(/^VENDA-(.+?)(?:-r\d+)?$/i);
  return { saleId: m ? m[1] : null };
}

/**
 * BLOCO 95: verificacao de assinatura do webhook da Spedy — padrao STANDARD
 * WEBHOOKS (docs.spedy.com.br): cabecalhos webhook-id, webhook-timestamp e
 * webhook-signature ("v1,<base64>" — uma ou mais durante rotacao de segredo).
 *   assinatura = HMAC-SHA256(segredo, "<id>.<timestamp>.<corpo>") em base64
 * O segredo vem de GET /v1/webhooks/secret (env SPEDY_WEBHOOK_SECRET — aceita
 * com ou sem prefixo whsec_). Comparacao em tempo constante + janela de 5
 * minutos contra replay. SEM segredo configurado recusa tudo (o endpoint
 * fica exposto na internet — nao aceita nada nao assinado).
 */
export async function verificarAssinaturaWebhook(
  headers: Headers,
  corpoCru: string
): Promise<{ valido: boolean; motivo?: string }> {
  const secret = process.env.SPEDY_WEBHOOK_SECRET || '';
  if (!secret) {
    return { valido: false, motivo: 'SPEDY_WEBHOOK_SECRET nao configurado no servidor (Vercel).' };
  }

  const id = headers.get('webhook-id') || '';
  const ts = headers.get('webhook-timestamp') || '';
  const sigHeader = headers.get('webhook-signature') || '';
  if (!id || !ts || !sigHeader) {
    return { valido: false, motivo: 'Cabecalhos Standard Webhooks ausentes (webhook-id/timestamp/signature).' };
  }

  // Janela de tolerancia: 5 minutos — fora disso e replay, recusa.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return { valido: false, motivo: 'webhook-timestamp invalido.' };
  const agora = Math.floor(Date.now() / 1000);
  if (Math.abs(agora - tsNum) > 300) {
    return { valido: false, motivo: 'webhook-timestamp fora da tolerancia de 5 min (possivel replay).' };
  }

  // Segredo: "whsec_<base64>" (Standard Webhooks) ou base64 cru.
  const secretoLimpo = secret.replace(/^whsec_/, '');
  const secretBytes = Buffer.from(secretoLimpo, 'base64');
  const key = secretBytes.length > 0 ? secretBytes : Buffer.from(secretoLimpo, 'utf8');

  const esperado = crypto.createHmac('sha256', key).update(`${id}.${ts}.${corpoCru}`, 'utf8').digest('base64');

  // "v1,abc v1,def" (rotacao de segredo) — vale qualquer uma.
  for (const parte of sigHeader.split(/[ ,]+/)) {
    const sig = parte.trim();
    if (!sig) continue;
    const v1 = sig.startsWith('v1,') ? sig.slice(3) : sig;
    const a = Buffer.from(v1);
    const b = Buffer.from(esperado);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { valido: true };
  }
  return { valido: false, motivo: 'Assinatura HMAC invalida.' };
}

export const SPEDY_WEBHOOK_EVENTS = [
  'invoice.status_changed',   // qualquer mudanca de status
  'invoice.authorized',       // AUTORIZADA -> baixa estoque COM NF + salva XML/DANFE
  'invoice.rejected',         // REJEITADA -> fila de correcao do admin
  'invoice.canceled',         // CANCELADA -> estorna se deu baixa
  'invoice.denied',           // DENEGADA
  'inbound_invoice.detected', // nota de compra DETECTADA (resumo) -> manifestar
  'inbound_invoice.completed',// XML COMPLETO liberado -> importa produtos
] as const;

/** Eventos relevantes + o que o app faz com cada um (documentacao viva). */
export const SPEDY_EVENTOS_ACAO: Record<string, string> = {
  'invoice.authorized': 'Baixa estoque (COM NF), salva XML+DANFE, imprime 80mm',
  'invoice.rejected': 'Fila de rejeicoes no admin (corrigir + reemitir)',
  'invoice.canceled': 'Estorna a baixa se ja foi feita',
  'inbound_invoice.detected': 'Manifesta (ciencia/confirmacao) e aguarda XML',
  'inbound_invoice.completed': 'Importa produtos da XML para a fila fiscal',
};
