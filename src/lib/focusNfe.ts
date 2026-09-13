/**
 * Cliente Focus NFe (https://focusnfe.com.br) — emissao de NF-e (modelo 55)
 * e NFC-e (modelo 65) via API REST v2.
 *
 * SOMENTE SERVER-SIDE: o token e segredo e vive em env var (Vercel).
 *   FOCUS_NFE_TOKEN      -> token da empresa (obrigatorio p/ emitir)
 *   FOCUS_NFE_AMBIENTE   -> 'homologacao' (default) | 'producao'
 *   FOCUS_NFE_NATUREZA   -> natureza da operacao (default 'Venda de mercadoria')
 *   FOCUS_NFE_UF_EMITENTE-> UF do emitente (default 'RS') — decide CFOP 5102/6102
 *
 * Documentos suportados aqui:
 *   NFe  -> POST /v2/nfe?ref=...       (cliente CNPJ/mercearia)
 *   NFCe -> POST /v2/nfce?ref=...      (consumidor final)
 *
 * Autenticacao: HTTP Basic com token como usuario e senha vazia.
 * Homologacao usa host separado (homologacao.focusnfe.com.br) — o token
 * de homologacao e diferente do de producao (ambos no dashboard da Focus).
 */

export type FocusAmbiente = 'homologacao' | 'producao';
export type FocusDoc = 'nfe' | 'nfce';

export interface FocusItem {
  numero_item: string;
  codigo_produto?: string;
  descricao: string;
  codigo_ncm?: string;
  codigo_cest?: string;
  cfop: string;
  unidade_comercial: string;
  unidade_tributavel: string;
  quantidade_comercial: string;
  quantidade_tributavel: string;
  valor_unitario_comercial: string;
  valor_unitario_tributavel: string;
  valor_total: string;
  valor_desconto?: string;
  origem_mercadoria: string;
  /** CST/CSOSN — '102' = Simples Nacional sem ICMS (padrao do projeto) */
  tributacao_icms: string;
  icms_aliquota: string;
  icms_base_calculo: string;
  icms_valor: string;
}

export interface FocusCliente {
  cpf_cnpj?: string;
  razao_social: string;
  inscricao_estadual?: string;
  endereco_uf: string;
  endereco_municipio: string;
  endereco_logradouro: string;
  endereco_numero: string;
  endereco_bairro: string;
  endereco_cep?: string;
  telefone?: string;
  email?: string;
}

export interface FocusPagamento {
  forma_pagamento: string;
  valor_pagamento: string;
}

export interface FocusNfePayload {
  natureza_operacao: string;
  data_emissao: string;
  data_entrada_saida: string;
  tipo_documento: string;
  local_destino: string;
  finalidade_emissao: string;
  consumidor_final: string;
  presenca_comprador: string;
  modalidade_frete: string;
  cliente: FocusCliente;
  items: FocusItem[];
  formas_pagamento?: FocusPagamento[];
  informacoes_adicionais?: string;
}

export interface FocusNotaResultado {
  ref?: string;
  status?: string;
  cStatus?: string;
  motivos?: string | string[];
  numero?: string;
  serie?: string;
  danfe_url?: string;
  arquivo_url?: string;
  pdf_url?: string;
  url_danfe?: string;
  erro?: string;
  erro_sefaz?: string;
  mensagem_sefaz?: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function getFocusConfig() {
  const token = process.env.FOCUS_NFE_TOKEN || '';
  const ambiente = (process.env.FOCUS_NFE_AMBIENTE as FocusAmbiente) || 'homologacao';
  return {
    token,
    ambiente,
    baseUrl: ambiente === 'producao' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br',
    natureza: process.env.FOCUS_NFE_NATUREZA || 'Venda de mercadoria',
    ufEmitente: (process.env.FOCUS_NFE_UF_EMITENTE || 'RS').toUpperCase(),
  };
}

export function isFocusConfigured(): boolean {
  return !!getFocusConfig().token;
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

/** Monta o payload NF-e (modelo 55) do projeto a partir da venda */
export function montarPayloadNfe(opts: {
  dataVenda: Date;
  natureza?: string;
  ufEmitente?: string;
  cliente: FocusCliente;
  itens: { codigo?: string; descricao: string; ncm?: string; cest?: string; cfop?: string; unidade?: string; quantidade: number; valorUnitario: number }[];
  valorTotalVenda: number;
  pagamento: FocusPagamento;
  informacoesAdicionais?: string;
}): FocusNfePayload {
  const iso = opts.dataVenda.toISOString();
  const itensTotal = round2(opts.itens.reduce((acc, it) => acc + it.quantidade * it.valorUnitario, 0));
  // Desconto aplicado a troca/desconto geral da venda entra no primeiro item
  // (NFe trabalha com desconto por item; a diferenca e concentrada ali).
  const descontoTotal = round2(Math.max(0, itensTotal - opts.valorTotalVenda));
  const ufDestino = (opts.cliente.endereco_uf || '').toUpperCase();

  const items: FocusItem[] = opts.itens.map((it, i) => {
    const bruto = round2(it.quantidade * it.valorUnitario);
    const desconto = i === 0 ? descontoTotal : 0;
    return {
      numero_item: String(i + 1),
      codigo_produto: (it.codigo || '').slice(0, 60) || undefined,
      descricao: normalizaTexto(it.descricao, 120),
      codigo_ncm: soDigitos(it.ncm) || '21069090',
      codigo_cest: soDigitos(it.cest) || undefined,
      // 5102 = venda interna (mesma UF); 6102 = venda para outra UF
      cfop: soDigitos(it.cfop) || (ufDestino === (opts.ufEmitente || 'RS') ? '5102' : '6102'),
      unidade_comercial: it.unidade || 'UN',
      unidade_tributavel: it.unidade || 'UN',
      quantidade_comercial: String(it.quantidade),
      quantidade_tributavel: String(it.quantidade),
      valor_unitario_comercial: round2(it.valorUnitario).toFixed(2),
      valor_unitario_tributavel: round2(it.valorUnitario).toFixed(2),
      valor_total: round2(bruto - desconto).toFixed(2),
      valor_desconto: desconto > 0 ? desconto.toFixed(2) : undefined,
      origem_mercadoria: '0',
      tributacao_icms: '102', // CSOSN 102 — Simples Nacional, sem cobranca de ICMS
      icms_aliquota: '0.00',
      icms_base_calculo: '0.00',
      icms_valor: '0.00',
    };
  });

  const localDestino = ufDestino === (opts.ufEmitente || 'RS') ? '1' : '2';

  return {
    natureza_operacao: opts.natureza || 'Venda de mercadoria',
    data_emissao: iso,
    data_entrada_saida: iso,
    tipo_documento: '1', // 1 = saida
    local_destino: localDestino, // 1 = operacao interna, 2 = interestadual
    finalidade_emissao: '1', // 1 = normal
    consumidor_final: '1',
    presenca_comprador: '1', // 1 = operacao presencial
    modalidade_frete: '9', // 9 = sem frete (retirada no local)
    cliente: opts.cliente,
    items,
    formas_pagamento: [opts.pagamento],
    informacoes_adicionais: opts.informacoesAdicionais || undefined,
  };
}

/** POST para autorizar a nota. Retorna a resposta crua da Focus. */
export async function emitirNfe(doc: FocusDoc, ref: string, payload: FocusNfePayload) {
  return focusRequest<FocusNotaResultado>('POST', `/v2/${doc}?ref=${encodeURIComponent(ref)}`, payload);
}

/** Consulta situacao atual da nota pela ref. */
export async function consultarNota(doc: FocusDoc, ref: string) {
  return focusRequest<FocusNotaResultado>('GET', `/v2/${doc}/${encodeURIComponent(ref)}`);
}

/** Cancela a nota (requer justificativa >= 15 chars, regra da SEFAZ). */
export async function cancelarNota(doc: FocusDoc, ref: string, justificativa: string) {
  return focusRequest<FocusNotaResultado>('DELETE', `/v2/${doc}/${encodeURIComponent(ref)}`, {
    justificativa: normalizaTexto(justificativa, 255),
  });
}

/**
 * Interpreta a resposta da Focus num resultado normalizado do app.
 * status possiveis: autorizado | reprovado | processando_autorizacao |
 *                   erro_autorizacao | cancelado | cancelado_por_substituicao
 */
export function interpretarResultado(data: FocusNotaResultado) {
  const status = (data.status || '').toLowerCase();
  const motivo = Array.isArray(data.motivos)
    ? data.motivos.join('; ')
    : data.motivos || data.erro_sefaz || data.mensagem_sefaz || data.erro || '';
  const pdf = data.danfe_url || data.pdf_url || data.url_danfe || '';
  return {
    autorizada: status === 'autorizado',
    cancelada: status.startsWith('cancelado'),
    processando: status === 'processando_autorizacao' || status === 'erro_autorizacao',
    numero: data.numero || '',
    cStatus: data.cStatus || '',
    motivo,
    pdfUrl: pdf,
    xmlUrl: data.arquivo_url || '',
    statusBruto: status,
  };
}
