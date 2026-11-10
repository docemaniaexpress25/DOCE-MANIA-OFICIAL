import { getServiceClient } from '@/lib/serverSupabase';

/**
 * BLOCO 108 — ERP CONFIG (central de automações da tela ERP Fiscal & Automações).
 *
 * Uma unica coluna jsonb em app_settings (id='global_settings') guarda tudo:
 *   { nfeAutoPe, cupomDuploNfc, boletoAutoAReceber,
 *     emitente: { cnpj, ie, razao, fantasia, logradouro, numero, bairro,
 *                 municipio, uf, cep, regime } }
 *
 * Regras:
 * - Tudo com default OFF (nada muda na rotina das vendedoras sem o dono ligar).
 * - Emitente aqui SOBRESCREVE as env vars FOCUS_NFE_* no payload — assim o
 *   dono cadastra/atualiza o CNPJ emissor pela tela, sem deploy.
 * - Degradacao graciosa: coluna ausente (SQL 108 nao rodou) = defaults,
 *   sem erro — nada quebra.
 */

export interface ErpEmitente {
  cnpj: string;
  ie: string;
  razao: string;
  fantasia: string;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  regime: number;
}

export interface ErpConfig {
  nfeAutoPe: boolean;
  cupomDuploNfc: boolean;
  boletoAutoAReceber: boolean;
  emitente: ErpEmitente;
}

export const ERP_CONFIG_DEFAULT: ErpConfig = {
  nfeAutoPe: false,
  cupomDuploNfc: false,
  boletoAutoAReceber: false,
  emitente: { cnpj: '', ie: '', razao: '', fantasia: '', logradouro: '', numero: '', bairro: '', municipio: '', uf: 'RS', cep: '', regime: 1 },
};

/** Limpa e normaliza o emitente vindo do POST (so texto util). */
function sanitizaEmitente(e: Record<string, unknown>): ErpEmitente {
  const txt = (v: unknown, max = 120) => String(v ?? '').trim().slice(0, max);
  const dig = (v: unknown, max = 20) => String(v ?? '').replace(/\D/g, '').slice(0, max);
  return {
    cnpj: dig(e.cnpj, 14),
    ie: txt(e.ie, 20),
    razao: txt(e.razao, 60),
    fantasia: txt(e.fantasia, 60),
    logradouro: txt(e.logradouro, 120),
    numero: txt(e.numero, 60),
    bairro: txt(e.bairro, 60),
    municipio: txt(e.municipio, 60),
    uf: txt(e.uf, 2).toUpperCase(),
    cep: dig(e.cep, 8),
    regime: Number(e.regime) === 3 ? 3 : 1,
  };
}

/** Le o erp_config (com defaults). Coluna ausente/tabela ausente = default. */
export async function lerErpConfig(supabase?: any): Promise<ErpConfig> {
  try {
    const db = supabase || getServiceClient();
    const { data, error } = await db
      .from('app_settings')
      .select('erp_config')
      .eq('id', 'global_settings')
      .limit(1)
      .maybeSingle();
    if (error || !data?.erp_config) return { ...ERP_CONFIG_DEFAULT };
    const raw = data.erp_config as Record<string, unknown>;
    return {
      nfeAutoPe: raw.nfeAutoPe === true,
      cupomDuploNfc: raw.cupomDuploNfc === true,
      boletoAutoAReceber: raw.boletoAutoAReceber === true,
      emitente: raw.emitente ? sanitizaEmitente(raw.emitente as Record<string, unknown>) : { ...ERP_CONFIG_DEFAULT.emitente },
    };
  } catch {
    return { ...ERP_CONFIG_DEFAULT };
  }
}

/** Salva parcialmente (merge no jsonb). Devolve o config final. */
export async function salvarErpConfig(parcial: Partial<ErpConfig>, supabase?: any): Promise<{ ok: boolean; erro?: string; config?: ErpConfig }> {
  try {
    const db = supabase || getServiceClient();
    const atual = await lerErpConfig(db);
    const novo: ErpConfig = {
      nfeAutoPe: typeof parcial.nfeAutoPe === 'boolean' ? parcial.nfeAutoPe : atual.nfeAutoPe,
      cupomDuploNfc: typeof parcial.cupomDuploNfc === 'boolean' ? parcial.cupomDuploNfc : atual.cupomDuploNfc,
      boletoAutoAReceber: typeof parcial.boletoAutoAReceber === 'boolean' ? parcial.boletoAutoAReceber : atual.boletoAutoAReceber,
      emitente: parcial.emitente ? sanitizaEmitente(parcial.emitente as unknown as Record<string, unknown>) : atual.emitente,
    };
    const { error } = await db
      .from('app_settings')
      .upsert({ id: 'global_settings', erp_config: novo }, { onConflict: 'id' });
    if (error) return { ok: false, erro: error.message };
    return { ok: true, config: novo };
  } catch (e: unknown) {
    return { ok: false, erro: (e as Error).message };
  }
}

/**
 * Emitente para o payload da Focus: o que esta gravado no app_settings
 * SOBRESCREVE o padrao das env vars — campo vazio volta pro env.
 * Devolve um Partial<FocusNfePayloadV2>-shape (campos ja nomedos v2.0),
 * importado de forma frouxa para evitar dependencia circular.
 */
export async function lerEmitentePayload(supabase?: any): Promise<Record<string, unknown>> {
  const cfg = getFocusEnv();
  const erp = await lerErpConfig(supabase);
  const e = erp.emitente;
  const peg = (gravado: string, env: string) => (gravado || env || '').trim();
  const out: Record<string, unknown> = {
    uf_emitente: peg(e.uf, cfg.ufEmitente).toUpperCase(),
    regime_tributario_emitente: e.razao ? e.regime : cfg.regime,
  };
  const cnpj = (e.cnpj || cfg.cnpj || '').replace(/\D/g, '');
  if (cnpj) out.cnpj_emitente = cnpj;
  const razao = peg(e.razao, cfg.razao);
  if (razao) out.nome_emitente = razao;
  const fantasia = peg(e.fantasia, cfg.fantasia);
  if (fantasia) out.nome_fantasia_emitente = fantasia;
  const log = peg(e.logradouro, cfg.logradouro);
  if (log) out.logradouro_emitente = log;
  const num = peg(e.numero, cfg.numeroEndereco);
  if (num) out.numero_emitente = num;
  const bairro = peg(e.bairro, cfg.bairro);
  if (bairro) out.bairro_emitente = bairro;
  const mun = peg(e.municipio, cfg.municipio);
  if (mun) out.municipio_emitente = mun;
  const cep = (peg(e.cep, cfg.cep) || '').replace(/\D/g, '');
  if (cep) out.cep_emitente = cep;
  const ie = peg(e.ie, cfg.ie);
  if (ie) out.inscricao_estadual_emitente = ie;
  return out;
}

function getFocusEnv() {
  return {
    ufEmitente: (process.env.FOCUS_NFE_UF_EMITENTE || 'RS').toUpperCase(),
    regime: Number(process.env.FOCUS_NFE_REGIME || '1') || 1,
    cnpj: process.env.FOCUS_NFE_CNPJ || '',
    ie: process.env.FOCUS_NFE_IE || '',
    razao: process.env.FOCUS_NFE_RAZAO || '',
    fantasia: process.env.FOCUS_NFE_FANTASIA || '',
    logradouro: process.env.FOCUS_NFE_LOGRADOURO || '',
    numeroEndereco: process.env.FOCUS_NFE_NUMERO || '',
    bairro: process.env.FOCUS_NFE_BAIRRO || '',
    municipio: process.env.FOCUS_NFE_MUNICIPIO || '',
    cep: process.env.FOCUS_NFE_CEP || '',
  };
}

/** Fonte do emitente (para o chip da tela): gravado aqui / env / nenhum. */
export async function fonteEmitente(supabase?: any): Promise<'app_settings' | 'env' | 'nenhum'> {
  const erp = await lerErpConfig(supabase);
  if (erp.emitente.cnpj) return 'app_settings';
  if ((process.env.FOCUS_NFE_CNPJ || '').trim()) return 'env';
  return 'nenhum';
}
