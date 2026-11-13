/**
 * Cliente Focus NFe (https://focusnfe.com.br) — emissao de NF-e (modelo 55)
 * e NFC-e (modelo 65) via API REST v2.0 (payload "flat").
 *
 * BLOCO 85: a Focus publicou a referencia v2.0 (doc.focusnfe.com.br,
 * atualizada ago/2026) com campos RASOS e novos nomes — o formato antigo
 * (objeto "cliente", razao_social, tributacao_icms) saiu da referencia.
 * Payload/resposta agora (exemplos reais da docs):
 *   envia:  cnpj_destinatario, nome_destinatario, valor_bruto (item),
 *           icms_situacao_tributaria, regime_tributario_emitente...
 *   volta:  status ('autorizado'|'processando_autorizacao'|'erro_autorizacao'|
 *           'cancelado'), chave_nfe ('NFe4119...'), caminho_danfe,
 *           qrcode_url (NFC-e), erros[{mensagem,campo}]
 *
 * SOMENTE SERVER-SIDE: o token e segredo e vive em env var (Vercel).
 *   FOCUS_NFE_TOKEN       -> token da empresa (obrigatorio p/ emitir)
 *   FOCUS_NFE_AMBIENTE    -> 'homologacao' (default) | 'producao'
 *   FOCUS_NFE_NATUREZA    -> natureza da operacao (default 'Venda de mercadoria')
 *   FOCUS_NFE_UF_EMITENTE -> UF do emitente (default 'RS') — decide CFOP 5102/6102
 *
 * DADOS DO EMITENTE (v2.0 pede no payload; NFC-e exige ao menos o CNPJ):
 *   FOCUS_NFE_CNPJ / FOCUS_NFE_IE / FOCUS_NFE_RAZAO / FOCUS_NFE_FANTASIA
 *   FOCUS_NFE_LOGRADOURO / FOCUS_NFE_NUMERO / FOCUS_NFE_BAIRRO
 *   FOCUS_NFE_MUNICIPIO / FOCUS_NFE_CEP
 *   FOCUS_NFE_REGIME     -> 1 Simples Nacional (default) | 2 excesso sublimite | 3 normal
 *
 * ENDPOINTS:
 *   POST   /v2/nfe?ref=...  /v2/nfce?ref=...   (201 autorizado sincrono |
 *                                              202 processando assincrono)
 *   GET    /v2/nfe/{ref}      /v2/nfce/{ref}
 *   DELETE /v2/nfe/{ref}      (justificativa >= 15 chars, regra SEFAZ)
 *
 * AUTENTICACAO: HTTP Basic — usuario = token, senha vazia. Homologacao usa
 * host separado (homologacao.focusnfe.com.br) e token proprio do dashboard.
 *
 * REGRAS v2.0 importantes:
 * - NFC-e: data_emissao com timezone e diferenca maxima de 5 min do relogio
 *   (por isso a emissao usa SEMPRE "agora", nunca a data da venda).
 * - formas_pagamento (tPag): 01 dinheiro, 02 cheque, 03/04 cartao, 15 boleto,
 *   17 PIX (16 = deposito bancario — armadilha comum), 91 pagamento posterior.
 * - NFC-e nao aceita 13/14/15 (duplicata/boleto) — venda a prazo vai de NF-e.
 * - NF-e cancelavel em ate 24h; NFC-e em ate 30 MINUTOS (regra SEFAZ, doc
 *   reference/cancelar_nfce.md).
 * - STATUS v2.0 (doc consultar_nfe/emitir_nfce): autorizado | cancelado |
 *   processando_autorizacao (NF-e assincrona, segue fila) | erro_autorizacao
 *   (REJEICAO DEFINITIVA da SEFAZ — nao e processando!).
 * - Rate limit: 100 req/min por token (doc cuidado-com-o-rate-limit) — por
 *   isso o app usa WEBHOOK de status em vez de polling (doc utilizando-
 *   webhooks: eventos reenviados por 48h com backoff).
 * - Webhooks da Focus: POST/GET/DELETE /v2/hooks (doc reference/webhooks).
 *   Evento 'nfe' notifica mudanca de status; `authorization` +
 *   `authorization_header` definem o header de segredo que a Focus envia.
 * - Contingencia: NF-e tem chaveamento automatico SVC transparente (doc
 *   mecanismo-de-contingencia-automatica-svc — nada a fazer no app); NFC-e
 *   offline exige Comunicador Offline (app de PC) — fora de escopo do app
 *   mobile hoje.
 */

export type FocusAmbiente = 'homologacao' | 'producao';
export type FocusDoc = 'nfe' | 'nfce';

// ---------------------------------------------------------------------------
// Config (env)
// ---------------------------------------------------------------------------
export function getFocusConfig() {
  const token = process.env.FOCUS_NFE_TOKEN || '';
  const ambiente = (process.env.FOCUS_NFE_AMBIENTE as FocusAmbiente) || 'homologacao';
  return {
    token,
    ambiente,
    baseUrl: ambiente === 'producao' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br',
    natureza: process.env.FOCUS_NFE_NATUREZA || 'Venda de mercadoria',
    ufEmitente: (process.env.FOCUS_NFE_UF_EMITENTE || 'RS').toUpperCase(),
    // dados do emitente (v2.0)
    cnpj: process.env.FOCUS_NFE_CNPJ || '',
    ie: process.env.FOCUS_NFE_IE || '',
    razao: process.env.FOCUS_NFE_RAZAO || '',
    fantasia: process.env.FOCUS_NFE_FANTASIA || '',
    logradouro: process.env.FOCUS_NFE_LOGRADOURO || '',
    numeroEndereco: process.env.FOCUS_NFE_NUMERO || '',
    bairro: process.env.FOCUS_NFE_BAIRRO || '',
    municipio: process.env.FOCUS_NFE_MUNICIPIO || '',
    cep: process.env.FOCUS_NFE_CEP || '',
    regime: Number(process.env.FOCUS_NFE_REGIME || '1') || 1, // 1 = Simples Nacional
  };
}

export function isFocusConfigured(): boolean {
  return !!getFocusConfig().token;
}

/** NFC-e v2.0 exige cnpj_emitente no payload; NF-e cai no padrao da conta. */
export function emitenteMinimoOk(): boolean {
  return !!soDigitos(getFocusConfig().cnpj);
}

function authHeader(): string {
  const { token } = getFocusConfig();
  return 'Basic ' + Buffer.from(`${token}:`).toString('base64');
}

async function focusRequest<T = FocusNotaResultado>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: T | { erro: string } }> {
  const { baseUrl } = getFocusConfig();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { erro: `Resposta nao-JSON da Focus: ${text.slice(0, 200)}` };
    }
    return { ok: res.ok, status: res.status, data: data as T };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, data: { erro: `Falha de rede com a Focus NFe: ${msg}` } };
  }
}

/** Ref idempotente por venda; reemissao pos-rejeicao usa sufixo -r2, -r3... */
export function refForSale(saleId: string, tentativa: number): string {
  return tentativa <= 1 ? `VENDA-${saleId}` : `VENDA-${saleId}-r${tentativa}`;
}

/** Extrai a proxima tentativa a partir da ref anterior (VENDA-x -> 2, VENDA-x-r2 -> 3) */
export function nextTentativa(refAnterior?: string | null): number {
  if (!refAnterior) return 1;
  const m = refAnterior.match(/-r(\d+)$/);
  return m ? parseInt(m[1], 10) + 1 : 2;
}

function normalizaTexto(v?: string | null, max = 120): string {
  return (v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** So digitos — CPF/CNPJ/CEP/IE */
function soDigitos(v?: string | null): string {
  return (v || '').replace(/\D/g, '');
}

/** 'S/N' quando o numero nao esta preenchido; tenta extrair do logradouro */
export function numeroDoEndereco(numero?: string | null, logradouro?: string | null): string {
  const n = soDigitos(numero);
  if (n) return n;
  const m = (logradouro || '').trim().match(/(\d+)\s*$/);
  return m ? m[1] : 'S/N';
}

/** Valida CPF (11 digitos) ou CNPJ (14 digitos) por digitos verificadores */
export function validaCpfCnpj(v?: string | null): 'CPF' | 'CNPJ' | null {
  const s = soDigitos(v);
  if (s.length === 11) {
    if (/^(\d)\1{10}$/.test(s)) return null;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(s[i]) * (10 - i);
    let d1 = (soma * 10) % 11;
    if (d1 === 10) d1 = 0;
    if (d1 !== parseInt(s[9])) return null;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(s[i]) * (11 - i);
    let d2 = (soma * 10) % 11;
    if (d2 === 10) d2 = 0;
    return d2 === parseInt(s[10]) ? 'CPF' : null;
  }
  if (s.length === 14) {
    if (/^(\d)\1{13}$/.test(s)) return null;
    const calc = (len: number): number => {
      let soma = 0;
      let peso = len - 7;
      for (let i = 0; i < len; i++) {
        soma += parseInt(s[i]) * peso--;
        if (peso < 2) peso = 9;
      }
      const r = soma % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === parseInt(s[12]) && calc(13) === parseInt(s[13]) ? 'CNPJ' : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// tPag / indPag — tabela oficial (campos.focusnfe.com.br, NF-e 4.00)
// 01 dinheiro, 02 cheque, 03 cartao credito, 04 cartao debito, 15 boleto,
// 16 DEPOSITO BANCARIO (nao e PIX!), 17 PIX dinamico, 91 pagamento posterior.
// ---------------------------------------------------------------------------
export function tpagDeMetodo(metodo?: string | null): { forma: string; indicador: 0 | 1 } {
  const m = String(metodo || '').toUpperCase();
  if (m === 'PIX') return { forma: '17', indicador: 0 };
  if (m === 'CHEQUE') return { forma: '02', indicador: 1 };
  if (m === 'A_PRAZO') return { forma: '15', indicador: 1 }; // boleto bancario
  if (m === 'CARTAO_CREDITO' || m === 'CREDITO') return { forma: '03', indicador: 0 };
  if (m === 'CARTAO_DEBITO' || m === 'DEBITO') return { forma: '04', indicador: 0 };
  return { forma: '01', indicador: 0 }; // DINHEIRO e padrao
}

// ---------------------------------------------------------------------------
// Payload v2.0
// ---------------------------------------------------------------------------
export interface FocusFormaPagamento {
  indicador_pagamento: 0 | 1;  // 0 = a vista, 1 = a prazo
  forma_pagamento: string;     // tPag (ver tpagDeMetodo)
  valor_pagamento: number;
}

export interface FocusItemV2 {
  numero_item: number;
  codigo_produto: string;
  descricao: string;
  codigo_ncm: string;
  codigo_barras_comercial?: string;  // cEAN (EAN do produto)
  cfop: string;
  unidade_comercial: string;
  unidade_tributavel: string;
  quantidade_comercial: number;
  quantidade_tributavel: number;
  valor_unitario_comercial: number;
  valor_unitario_tributavel: number;
  valor_bruto: number;
  valor_desconto?: number;
  inclui_no_total: 0 | 1;
  icms_origem: number;               // 0 nacional, 1/2 estrangeira...
  icms_situacao_tributaria: string;  // CSOSN 102 (Simples Nacional sem credito)
  pis_situacao_tributaria: string;   // 49 = outras saidas (Simples Nacional)
  cofins_situacao_tributaria: string;
}

export interface FocusDestinatarioV2 {
  nome?: string;
  cpf_cnpj?: string;             // so digitos (CPF 11 / CNPJ 14)
  inscricao_estadual?: string;   // presente => indicador 1
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  email?: string;
  telefone?: string;
}

export interface FocusNfePayloadV2 {
  natureza_operacao: string;
  data_emissao: string;            // ISO com timezone (NFC-e: max 5 min atras)
  tipo_documento: number;          // 1 = saida (NF-e)
  local_destino: number;           // 1 interna / 2 interestadual
  finalidade_emissao: number;      // 1 normal
  consumidor_final: number;        // 1
  presenca_comprador: number;      // 1 presencial
  modalidade_frete: number;        // 9 sem frete
  // emitente (v2.0 — cai no cadastro da conta quando ausente)
  cnpj_emitente?: string;
  nome_emitente?: string;
  nome_fantasia_emitente?: string;
  logradouro_emitente?: string;
  numero_emitente?: string;
  bairro_emitente?: string;
  municipio_emitente?: string;
  uf_emitente?: string;
  cep_emitente?: string;
  inscricao_estadual_emitente?: string;
  regime_tributario_emitente?: number; // 1 Simples Nacional
  // destinatario (flat)
  nome_destinatario?: string;
  cnpj_destinatario?: string;
  cpf_destinatario?: string;
  inscricao_estadual_destinatario?: string;
  indicador_inscricao_estadual_destinatario?: number; // 1 contribuinte / 9 nao
  logradouro_destinatario?: string;
  numero_destinatario?: string;
  bairro_destinatario?: string;
  municipio_destinatario?: string;
  uf_destinatario?: string;
  cep_destinatario?: string;
  email_destinatario?: string;
  telefone_destinatario?: string;
  // totais
  valor_produtos?: number;
  valor_desconto?: number;
  valor_total?: number;
  items: FocusItemV2[];
  formas_pagamento?: FocusFormaPagamento[];
  informacoes_adicionais_contribuinte?: string;
}

export interface FocusNotaResultado {
  ref?: string;
  status?: string;              // autorizado | processando_autorizacao | erro_autorizacao | cancelado | erro_cancelamento
  status_sefaz?: string;        // '100' = autorizado
  mensagem_sefaz?: string;
  chave_nfe?: string;           // 'NFe4119...' / 'NFCe...' + 44 digitos
  numero?: string;
  serie?: string;
  caminho_danfe?: string;       // NF-e PDF / NFC-e DANFCe .html
  caminho_xml_nota_fiscal?: string;
  caminho_xml_cancelamento?: string;
  qrcode_url?: string;          // NFC-e: QR de consulta
  url_consulta_nf?: string;
  contingencia_offline?: boolean;
  contingencia_offline_efetivada?: boolean;
  // webhooks v2.0 (doc reference/criar_webhook.md): POST /v2/hooks
  id?: string;
  url?: string;
  authorization?: string;
  authorization_header?: string;
  event?: string;
  // erros v2.0: { codigo, mensagem, erros: [{mensagem, campo}] }
  codigo?: string;
  mensagem?: string;
  erros?: { mensagem?: string; campo?: string }[];
  // legado (fallback — contas antigas podem responder no formato anterior)
  chave?: string;
  danfe_url?: string;
  pdf_url?: string;
  url_danfe?: string;
  arquivo_url?: string;
  erro?: string;
  erro_sefaz?: string;
  motivos?: string | string[];
  protocolo?: string;
  razao_social_emitente?: string;
  nome_emitente?: string;
  cnpj_emitente?: string;
  ie_emitente?: string;
  data_autorizacao?: string;
  total?: string | number;
  qr_code?: string;
  url_consulta?: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** ISO com fuso de SP ("2026-11-01T10:30:00-03:00") — a referencia v2.0 usa
 *  data-hora com timezone (sem horario de verao no BR desde 2019, offset
 *  fixo -03:00). toISOString() ("...Z") tambem e ISO, mas o exemplo oficial
 *  da docs e com offset — mandamos igual ao exemplo. */
function isoComFuso(d: Date): string {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d);
  return `${p.replace(' ', 'T')}-03:00`;
}

/** Emitente a partir das env vars (v2.0 pede os dados no payload). */
export function emitenteDaConfig(): Partial<FocusNfePayloadV2> {
  const cfg = getFocusConfig();
  const cnpj = soDigitos(cfg.cnpj);
  const out: Partial<FocusNfePayloadV2> = {
    uf_emitente: cfg.ufEmitente,
    regime_tributario_emitente: cfg.regime,
  };
  if (cnpj) out.cnpj_emitente = cnpj;
  if (cfg.razao) out.nome_emitente = normalizaTexto(cfg.razao, 60);
  if (cfg.fantasia) out.nome_fantasia_emitente = normalizaTexto(cfg.fantasia, 60);
  if (cfg.logradouro) out.logradouro_emitente = normalizaTexto(cfg.logradouro, 60);
  if (cfg.numeroEndereco) out.numero_emitente = cfg.numeroEndereco.slice(0, 60);
  if (cfg.bairro) out.bairro_emitente = normalizaTexto(cfg.bairro, 60);
  if (cfg.municipio) out.municipio_emitente = normalizaTexto(cfg.municipio, 60);
  if (soDigitos(cfg.cep)) out.cep_emitente = soDigitos(cfg.cep);
  if (cfg.ie) out.inscricao_estadual_emitente = cfg.ie.trim().slice(0, 20);
  return out;
}

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

/** Itens v2.0 — valores NUMERICOS (a API v2.0 nao aceita mais string). */
function montarItensV2(opts: {
  itens: ItemVendaInput[];
  valorTotalVenda: number;
  ufDestino: string;
  ufEmitente: string;
  doc: FocusDoc;
}): { items: FocusItemV2[]; valorProdutos: number; descontoTotal: number } {
  const itensTotal = round2(opts.itens.reduce((acc, it) => acc + it.quantidade * it.valorUnitario, 0));
  // Desconto (troca/desconto geral) entra concentrado no primeiro item
  const descontoTotal = round2(Math.max(0, itensTotal - opts.valorTotalVenda));

  const items: FocusItemV2[] = opts.itens.map((it, i) => {
    const bruto = round2(it.quantidade * it.valorUnitario);
    const desconto = i === 0 ? descontoTotal : 0;
    const item: FocusItemV2 = {
      // NFe v2.0 pede numero_item integer; NFC-e v2.0 pede string
      numero_item: (opts.doc === 'nfe' ? i + 1 : String(i + 1)) as unknown as number,
      codigo_produto: (it.codigo || `P${i + 1}`).slice(0, 60),
      descricao: normalizaTexto(it.descricao, 120),
      codigo_ncm: soDigitos(it.ncm) || '21069090',
      cfop: soDigitos(it.cfop) || (opts.ufDestino === opts.ufEmitente ? '5102' : '6102'),
      unidade_comercial: it.unidade || 'UN',
      unidade_tributavel: it.unidade || 'UN',
      quantidade_comercial: it.quantidade,
      quantidade_tributavel: it.quantidade,
      valor_unitario_comercial: round2(it.valorUnitario),
      valor_unitario_tributavel: round2(it.valorUnitario),
      valor_bruto: bruto,
      inclui_no_total: 1,
      icms_origem: Number(soDigitos(it.origem) || '0') || 0,
      icms_situacao_tributaria: '102', // CSOSN 102 — Simples Nacional, sem ICMS
      pis_situacao_tributaria: '49',   // Simples Nacional: outras saidas
      cofins_situacao_tributaria: '49',
    };
    const ean = soDigitos(it.ean);
    if (ean.length === 8 || ean.length === 12 || ean.length === 13 || ean.length === 14) {
      item.codigo_barras_comercial = ean;
    }
    if (desconto > 0) item.valor_desconto = desconto;
    return item;
  });

  return { items, valorProdutos: itensTotal, descontoTotal };
}

function destinatarioV2(d: FocusDestinatarioV2, doc: FocusDoc): Partial<FocusNfePayloadV2> {
  const docDigitos = soDigitos(d.cpf_cnpj);
  const out: Partial<FocusNfePayloadV2> = {};
  if (d.nome) out.nome_destinatario = normalizaTexto(d.nome, 60);
  if (docDigitos.length === 14) out.cnpj_destinatario = docDigitos;
  else if (docDigitos.length === 11) out.cpf_destinatario = docDigitos;
  const ie = (d.inscricao_estadual || '').trim();
  if (ie && !/^isen/i.test(ie)) {
    out.inscricao_estadual_destinatario = ie.slice(0, 20);
    out.indicador_inscricao_estadual_destinatario = 1;
  } else if (docDigitos) {
    out.indicador_inscricao_estadual_destinatario = 9; // nao contribuinte
  }
  if (d.logradouro) out.logradouro_destinatario = normalizaTexto(d.logradouro, 60);
  if (d.numero) out.numero_destinatario = d.numero.slice(0, 60);
  if (d.bairro) out.bairro_destinatario = normalizaTexto(d.bairro, 60);
  if (d.municipio) out.municipio_destinatario = normalizaTexto(d.municipio, 60);
  if (d.uf) out.uf_destinatario = d.uf.toUpperCase().slice(0, 2);
  if (soDigitos(d.cep)) out.cep_destinatario = soDigitos(d.cep);
  if (d.email) out.email_destinatario = d.email.trim().slice(0, 60);
  const tel = soDigitos(d.telefone);
  if (tel.length >= 6) out.telefone_destinatario = tel;
  return out;
}

/** Monta o payload NF-e (modelo 55) v2.0 a partir da venda.
 *  BLOCO 108: `emitente` opcional SOBRESCREVE os dados do emitente das env
 *  vars (campos gravados na tela ERP Fiscal & Automações — campo vazio
 *  volta pro env). */
export function montarPayloadNfe(opts: {
  dataEmissao: Date;
  natureza?: string;
  ufEmitente?: string;
  destinatario: FocusDestinatarioV2;
  itens: ItemVendaInput[];
  valorTotalVenda: number;
  pagamento: FocusFormaPagamento;
  informacoesAdicionais?: string;
  emitente?: Partial<FocusNfePayloadV2>;
}): FocusNfePayloadV2 {
  const ufEmit = opts.ufEmitente || getFocusConfig().ufEmitente;
  const ufDestino = (opts.destinatario.uf || '').toUpperCase();
  const { items, valorProdutos, descontoTotal } = montarItensV2({
    itens: opts.itens, valorTotalVenda: opts.valorTotalVenda, ufDestino, ufEmitente: ufEmit, doc: 'nfe',
  });

  return {
    natureza_operacao: opts.natureza || 'Venda de mercadoria',
    data_emissao: isoComFuso(opts.dataEmissao),
    tipo_documento: 1,   // saida
    local_destino: ufDestino === ufEmit ? 1 : 2,
    finalidade_emissao: 1,
    consumidor_final: 1,
    presenca_comprador: 1,
    modalidade_frete: 9,
    ...emitenteDaConfig(),
    ...(opts.emitente || {}),
    ...destinatarioV2(opts.destinatario, 'nfe'),
    valor_produtos: valorProdutos,
    valor_desconto: descontoTotal > 0 ? descontoTotal : undefined,
    valor_total: round2(opts.valorTotalVenda),
    items,
    formas_pagamento: [opts.pagamento],
    informacoes_adicionais_contribuinte: opts.informacoesAdicionais || undefined,
  };
}

/** Monta o payload NFC-e (modelo 65) v2.0 — data_emissao SEMPRE agora
 *  (a SEFAZ recusa dhEmi com mais de 5 min de diferenca).
 *  BLOCO 108: `emitente` opcional idem NF-e. */
export function montarPayloadNfce(opts: {
  dataEmissao: Date;
  natureza?: string;
  ufEmitente?: string;
  destinatario?: FocusDestinatarioV2;   // opcional: NFC-e anonima
  itens: ItemVendaInput[];
  valorTotalVenda: number;
  pagamento: FocusFormaPagamento;
  informacoesAdicionais?: string;
  emitente?: Partial<FocusNfePayloadV2>;
}): FocusNfePayloadV2 {
  const cfg = getFocusConfig();
  const ufEmit = opts.ufEmitente || cfg.ufEmitente;
  const ufDestino = (opts.destinatario?.uf || '').toUpperCase();
  const { items } = montarItensV2({
    itens: opts.itens, valorTotalVenda: opts.valorTotalVenda, ufDestino, ufEmitente: ufEmit, doc: 'nfce',
  });

  return {
    natureza_operacao: opts.natureza || 'VENDA DE MERCADORIA ACQR',
    data_emissao: isoComFuso(opts.dataEmissao),
    presenca_comprador: 1,
    modalidade_frete: 9,
    local_destino: ufDestino && ufDestino !== ufEmit ? 2 : 1,
    ...emitenteDaConfig(),
    ...(opts.emitente || {}),
    ...(opts.destinatario ? destinatarioV2(opts.destinatario, 'nfce') : {}),
    items,
    formas_pagamento: [opts.pagamento],
    informacoes_adicionais_contribuinte: opts.informacoesAdicionais || undefined,
  };
}

/** POST para autorizar a nota. 201 = autorizado (sincrono); 202 = processando. */
export async function emitirNfe(doc: FocusDoc, ref: string, payload: FocusNfePayloadV2) {
  return focusRequest<FocusNotaResultado>('POST', `/v2/${doc}?ref=${encodeURIComponent(ref)}`, payload);
}

/** Consulta situacao atual da nota pela ref. */
export async function consultarNota(doc: FocusDoc, ref: string) {
  return focusRequest<FocusNotaResultado>('GET', `/v2/${doc}/${encodeURIComponent(ref)}`);
}

// ---------------------------------------------------------------------------
// WEBHOOKS (doc reference/criar_webhook.md — POST /v2/hooks; listar GET
// /v2/hooks; excluir DELETE /v2/hooks/{id}). A Focus recomenda webhook em vez
// de polling (doc utilizando-webhooks: processamento em tempo real, menos
// consumo de quota — limite e 100 req/min por token).
// ---------------------------------------------------------------------------

/** Lista os gatilhos cadastrados no token. */
export async function listarWebhooksFocus() {
  return focusRequest<FocusNotaResultado[]>('GET', '/v2/hooks');
}

/**
 * Cria o gatilho de mudanca de status de NF-e. `segredo` vai no header
 * `authorizationHeader` (ex.: 'x-dm-token') de cada notificacao — o app
 * confere antes de reconsultar. `cnpj` opcional restringe ao emitente.
 */
export async function criarWebhookFocus(opts: {
  url: string;
  segredo: string;
  authorizationHeader?: string;
  cnpj?: string;
}) {
  const body: Record<string, unknown> = {
    event: 'nfe',
    url: opts.url,
    authorization: opts.segredo,
    authorization_header: opts.authorizationHeader || 'x-dm-token',
  };
  const cnpj = soDigitos(opts.cnpj);
  if (cnpj) body.cnpj = cnpj;
  return focusRequest<FocusNotaResultado>('POST', '/v2/hooks', body);
}

/** Exclui um gatilho pelo id (GET /v2/hooks devolve os ids). */
export async function excluirWebhookFocus(id: string) {
  return focusRequest<FocusNotaResultado>('DELETE', `/v2/hooks/${encodeURIComponent(id)}`);
}

/** Cancela a nota (requer justificativa >= 15 chars, regra da SEFAZ). */
export async function cancelarNota(doc: FocusDoc, ref: string, justificativa: string) {
  return focusRequest<FocusNotaResultado>('DELETE', `/v2/${doc}/${encodeURIComponent(ref)}`, {
    justificativa: normalizaTexto(justificativa, 255),
  });
}

/** Caminho de arquivo da Focus pode vir relativo ("/arquivos/...") — vira URL absoluta. */
function urlFocus(caminho?: string): string {
  const c = (caminho || '').trim();
  if (!c) return '';
  if (/^https?:\/\//i.test(c)) return c;
  const { baseUrl } = getFocusConfig();
  return `${baseUrl}${c.startsWith('/') ? '' : '/'}${c}`;
}

/**
 * Interpreta a resposta v2.0 da Focus num resultado normalizado do app.
 * status possiveis: autorizado | processando_autorizacao | erro_autorizacao |
 *                   cancelado | erro_cancelamento
 */
export function interpretarResultado(data: FocusNotaResultado) {
  const status = (data.status || '').toLowerCase();
  // Erros v2.0: erros[{mensagem, campo}] — mensagem legivel campo a campo
  const errosV2 = (Array.isArray(data.erros) ? data.erros : [])
    .map(e => [e?.campo, e?.mensagem].filter(Boolean).join(': '))
    .filter(Boolean);
  const isErro = status.startsWith('erro') || status === 'reprovado';
  const motivo = errosV2.join('; ')
    || (Array.isArray(data.motivos) ? data.motivos.join('; ') : data.motivos || '')
    || data.erro_sefaz || ''
    || (isErro ? (data.mensagem || data.mensagem_sefaz || data.erro || '') : (data.erro || ''));
  const pdf = urlFocus(data.caminho_danfe) || urlFocus(data.danfe_url) || urlFocus(data.pdf_url) || urlFocus(data.url_danfe);
  // BLOCO 82: dados para o mini DANFE 80mm (emitente real da SEFAZ, QR de
  // consulta NFC-e quando a Focus devolve)
  const emitenteNome = String(data.razao_social_emitente || data.nome_emitente || '').trim();
  const emitenteCnpj = String(data.cnpj_emitente || '').replace(/\D/g, '');
  return {
    autorizada: status === 'autorizado',
    cancelada: status.startsWith('cancelado'),
    // FIX bloco 116 (doc v2.0): 'erro_autorizacao' e REJEICAO DEFINITIVA da
    // SEFAZ (ex.: "Rejeição: Total da NF difere..."), NAO e processamento.
    // Antes isso mapeava rejeitada como EMITINDO e a venda ficava presa.
    processando: status === 'processando_autorizacao',
    rejeitada: status === 'erro_autorizacao',
    numero: data.numero || '',
    cStatus: data.status_sefaz || '',
    motivo,
    pdfUrl: pdf,
    xmlUrl: urlFocus(data.caminho_xml_nota_fiscal) || urlFocus(data.arquivo_url),
    statusBruto: status,
    // chave_nfe vem com prefixo ("NFe4119...") — fica so os 44 digitos
    chave: soDigitos(data.chave_nfe || data.chave).slice(-44) || '',
    serie: String(data.serie || ''),
    protocolo: String(data.protocolo || ''),
    dataAutorizacao: String(data.data_autorizacao || ''),
    total: Number(data.total) || 0,
    qrCode: String(data.qrcode_url || data.url_consulta_nf || data.qr_code || data.url_consulta || ''),
    // Contingencia (doc emitir_nfce.md): NFC-e emitida offline nasce
    // 'autorizado' com contingencia_offline=true e efetiva sozinha depois —
    // o app avisa o usuario que o espelho/DANFE e valido mas o QR so
    // consulta apos a efetivacao.
    contingenciaOffline: data.contingencia_offline === true,
    contingenciaEfetivada: data.contingencia_offline !== true ? null : data.contingencia_offline_efetivada !== false,
    emitente: {
      nome: emitenteNome,
      cnpj: emitenteCnpj,
      ie: String(data.ie_emitente || '').trim(),
    },
  };
}
