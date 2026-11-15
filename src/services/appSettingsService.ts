import { supabase } from '@/lib/supabaseClient';
import { MelhoriasFlags, MELHORIAS_DEFAULT } from '@/lib/types';

export interface AppSettings {
  logo: string | null;
  margemGlobalAtiva: boolean;
  margemGlobalValor: number;
  margemMinimaAtiva: boolean;
  margemMinima: number;
  pix1Name: string | null;
  pix1Code: string | null;
  pix2Name: string | null;
  pix2Code: string | null;
  /** BLOCO 62: chave Pix do RECEBIMENTO (QR gerado na entrega) — CPF/CNPJ/telefone/email/EVP */
  pixChave: string | null;
  productOrder: string[];
  clientOrder: string[];
  /** Bloco 23: ORDEM DO PORTAL — independente da ordem do PDV (product_order) */
  catalogoOrder: string[];
  companyName: string | null;
  companyCnpj: string | null;
  melhorias: MelhoriasFlags;
}

const DEFAULT_SETTINGS: AppSettings = {
  logo: null,
  margemGlobalAtiva: true,
  margemGlobalValor: 30,
  margemMinimaAtiva: true,
  margemMinima: 20,
  pix1Name: "Pix Banco A",
  pix1Code: null,
  pix2Name: "Pix Banco B",
  pix2Code: null,
  pixChave: null,
  productOrder: [],
  clientOrder: [],
  catalogoOrder: [],
  companyName: "DOCE MANIA DISTRIBUIDORA",
  companyCnpj: "00.000.000/0001-00",
  melhorias: { ...MELHORIAS_DEFAULT }
};

const safeNumber = (value: any): number => Number(value || 0);

// ============================================================
// EGRESS: logo + QR Pix sao base64 GRANDES dentro de app_settings.
// Antes vinham em TODO getSettings() (load, realtime, cada mutacao),
// dezenas de vezes por dia por aparelho. Agora vivem em cache
// localStorage e revalidam 1x a cada 12h (mudam raramente).
// ============================================================
const MEDIA_KEY = 'dm_media_cache_v1';
const MEDIA_TTL = 12 * 60 * 60 * 1000; // 12h

interface MediaCache { logo: string | null; pix1Code: string | null; pix2Code: string | null; ts: number; }

function readMediaLocal(): MediaCache | null {
  try {
    const raw = localStorage.getItem(MEDIA_KEY);
    return raw ? (JSON.parse(raw) as MediaCache) : null;
  } catch { return null; }
}

function writeMediaLocal(m: MediaCache) {
  try { localStorage.setItem(MEDIA_KEY, JSON.stringify(m)); } catch {}
}

async function fetchMediaFromDb(): Promise<MediaCache | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('logo, pix1_code, pix2_code')
    .eq('id', 'global_settings')
    .maybeSingle();
  if (error || !data) return null;
  const m: MediaCache = {
    logo: data.logo ?? null,
    pix1Code: data.pix1_code ?? null,
    pix2Code: data.pix2_code ?? null,
    ts: Date.now(),
  };
  writeMediaLocal(m);
  return m;
}

async function getMedia(): Promise<MediaCache> {
  const cached = readMediaLocal();
  if (cached && Date.now() - cached.ts < MEDIA_TTL) return cached;
  const fresh = await fetchMediaFromDb();
  return fresh || cached || { logo: null, pix1Code: null, pix2Code: null, ts: 0 };
}

export const appSettingsService = {
  async getSettings(): Promise<AppSettings> {
    // EGRESS: leitura LEVE — logo/pix_code (base64 pesados) NAO vem mais aqui;
    // vem do cache localStorage com revalidacao de 12h (getMedia).
    const COLS = 'margem_global_ativa, margem_global_valor, margem_minima_ativa, margem_minima, pix1_name, pix2_name, product_order, client_order, catalogo_order, company_name, company_cnpj, pix_chave_entrega, melhor_troca_separacao, melhor_push_entrega, melhor_whatsapp, melhor_bairro, melhor_foto_entrega, melhor_push_falha';

    let data: any = null;
    const { data: light, error: lightErr } = await supabase
      .from('app_settings')
      .select(COLS)
      .eq('id', 'global_settings')
      .maybeSingle();

    if (lightErr || !light) {
      // Fallback: coluna ainda inexistente (SQL pendente) → leitura completa (já traz a mídia)
      const { data: full, error } = await supabase
        .from('app_settings')
        .select('*')
        .eq('id', 'global_settings')
        .maybeSingle();
      if (error) {
        console.error('[appSettingsService] Erro ao buscar configurações:', error);
        return DEFAULT_SETTINGS;
      }
      if (!full) {
        console.log('[appSettingsService] Nenhuma configuração encontrada, usando defaults');
        return DEFAULT_SETTINGS;
      }
      data = full;
      // Atualiza o cache de mídia com a leitura completa (custo zero extra)
      writeMediaLocal({ logo: full.logo ?? null, pix1Code: full.pix1_code ?? null, pix2Code: full.pix2_code ?? null, ts: Date.now() });
    } else {
      data = light;
    }

    const media = data.logo !== undefined
      ? { logo: data.logo ?? null, pix1Code: data.pix1_code ?? null, pix2Code: data.pix2_code ?? null }
      : await getMedia();

    return {
      logo: media.logo ?? DEFAULT_SETTINGS.logo,
      margemGlobalAtiva: data.margem_global_ativa !== undefined ? !!data.margem_global_ativa : DEFAULT_SETTINGS.margemGlobalAtiva,
      margemGlobalValor: data.margem_global_valor !== undefined ? safeNumber(data.margem_global_valor) : DEFAULT_SETTINGS.margemGlobalValor,
      margemMinimaAtiva: data.margem_minima_ativa !== undefined ? !!data.margem_minima_ativa : DEFAULT_SETTINGS.margemMinimaAtiva,
      margemMinima: data.margem_minima !== undefined ? safeNumber(data.margem_minima) : DEFAULT_SETTINGS.margemMinima,
      pix1Name: data.pix1_name ?? DEFAULT_SETTINGS.pix1Name,
      pix1Code: media.pix1Code ?? DEFAULT_SETTINGS.pix1Code,
      pix2Name: data.pix2_name ?? DEFAULT_SETTINGS.pix2Name,
      pix2Code: media.pix2Code ?? DEFAULT_SETTINGS.pix2Code,
      // BLOCO 62: chave do recebimento (QR na entrega) — null = usa o padrao (env/CPF do dono)
      pixChave: data.pix_chave_entrega ?? DEFAULT_SETTINGS.pixChave,
      productOrder: Array.isArray(data.product_order) ? data.product_order : DEFAULT_SETTINGS.productOrder,
      clientOrder: Array.isArray(data.client_order) ? data.client_order : DEFAULT_SETTINGS.clientOrder,
      catalogoOrder: Array.isArray((data as any).catalogo_order) ? (data as any).catalogo_order : DEFAULT_SETTINGS.catalogoOrder,
      companyName: data.company_name ?? DEFAULT_SETTINGS.companyName,
      companyCnpj: data.company_cnpj ?? DEFAULT_SETTINGS.companyCnpj,
      melhorias: {
        trocaSeparacao: data.melhor_troca_separacao !== false,
        pushEntrega: data.melhor_push_entrega !== false,
        whatsapp: data.melhor_whatsapp !== false,
        bairroCard: data.melhor_bairro !== false,
        fotoEntrega: data.melhor_foto_entrega !== false,
        pushFalha: data.melhor_push_falha !== false,
      },
    };
  },

  async updateSettings(settings: Partial<AppSettings>): Promise<boolean> {
    const payload: Partial<any> = {};
    
    if (settings.logo !== undefined) payload.logo = settings.logo;
    if (settings.margemGlobalAtiva !== undefined) payload.margem_global_ativa = settings.margemGlobalAtiva;
    if (settings.margemGlobalValor !== undefined) payload.margem_global_valor = settings.margemGlobalValor;
    if (settings.margemMinimaAtiva !== undefined) payload.margem_minima_ativa = settings.margemMinimaAtiva;
    if (settings.margemMinima !== undefined) payload.margem_minima = settings.margemMinima;
    if (settings.pix1Name !== undefined) payload.pix1_name = settings.pix1Name;
    if (settings.pix1Code !== undefined) payload.pix1_code = settings.pix1Code;
    if (settings.pix2Name !== undefined) payload.pix2_name = settings.pix2Name;
    if (settings.pix2Code !== undefined) payload.pix2_code = settings.pix2Code;
    // BLOCO 62: chave do recebimento (QR gerado na entrega)
    if (settings.pixChave !== undefined) payload.pix_chave_entrega = settings.pixChave;

    // EGRESS: mantém o cache local de mídia em sync quando logo/pix mudam
    if (settings.logo !== undefined || settings.pix1Code !== undefined || settings.pix2Code !== undefined) {
      const cur = readMediaLocal() || { logo: null, pix1Code: null, pix2Code: null, ts: 0 };
      writeMediaLocal({
        logo: settings.logo !== undefined ? settings.logo : cur.logo,
        pix1Code: settings.pix1Code !== undefined ? settings.pix1Code : cur.pix1Code,
        pix2Code: settings.pix2Code !== undefined ? settings.pix2Code : cur.pix2Code,
        ts: Date.now(),
      });
    }
    if (settings.productOrder !== undefined) payload.product_order = settings.productOrder;
    if (settings.clientOrder !== undefined) payload.client_order = settings.clientOrder;
    if (settings.catalogoOrder !== undefined) (payload as any).catalogo_order = settings.catalogoOrder;
    if (settings.companyName !== undefined) payload.company_name = settings.companyName;
    if (settings.companyCnpj !== undefined) payload.company_cnpj = settings.companyCnpj;
    if (settings.melhorias !== undefined) {
      payload.melhor_troca_separacao = settings.melhorias.trocaSeparacao;
      payload.melhor_push_entrega = settings.melhorias.pushEntrega;
      payload.melhor_whatsapp = settings.melhorias.whatsapp;
      payload.melhor_bairro = settings.melhorias.bairroCard;
      payload.melhor_foto_entrega = settings.melhorias.fotoEntrega;
      payload.melhor_push_falha = settings.melhorias.pushFalha;
    }

    const upsertPayload = {
        id: 'global_settings',
        ...payload
    };

    console.log('[appSettingsService] Salvando no Supabase:', upsertPayload);

    const { error } = await supabase
      .from('app_settings')
      .upsert(upsertPayload, { onConflict: 'id' });

    if (error) {
      // BLOCO 23/62: coluna ainda inexistente (SQL pendente) — salva o restante
      // sem perder as outras configurações. Serve para catalogo_order e
      // pix_chave_entrega (o erro do PostgREST cita o nome da coluna).
      const mColuna = /(?:catalogo_order|pix_chave_entrega)/i.exec(error.message || '');
      if (mColuna && (payload as any)[mColuna[0]] !== undefined) {
        console.warn(`[appSettingsService] ${mColuna[0]} ausente (SQL pendente). Salvando sem ela.`);
        const semCol = { ...upsertPayload } as Record<string, unknown>;
        delete semCol[mColuna[0]];
        const { error: err2 } = await supabase
          .from('app_settings')
          .upsert(semCol, { onConflict: 'id' });
        if (err2) {
          console.error('[appSettingsService] Erro ao persistir configurações:', err2);
          return false;
        }
        return true;
      }
      console.error('[appSettingsService] Erro ao persistir configurações:', error);
      return false;
    }
    
    console.log('[appSettingsService] Salvo com sucesso!');
    return true;
  },
};