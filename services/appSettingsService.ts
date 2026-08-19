import { supabase } from '../supabaseClient';

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
  productOrder: string[];
  clientOrder: string[];
  companyName: string | null;
  companyCnpj: string | null;
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
  productOrder: [],
  clientOrder: [],
  companyName: "DOCE MANIA DISTRIBUIDORA",
  companyCnpj: "00.000.000/0001-00"
};

const safeNumber = (value: any): number => Number(value || 0);

export const appSettingsService = {
  async getSettings(): Promise<AppSettings> {
    const { data, error } = await supabase
      .from('app_settings')
      .select('*')
      .eq('id', 'global_settings')
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar configurações:', error);
      return DEFAULT_SETTINGS;
    }

    if (!data) {
      return DEFAULT_SETTINGS;
    }

    return {
      logo: data.logo ?? DEFAULT_SETTINGS.logo,
      margemGlobalAtiva: data.margem_global_ativa !== undefined ? !!data.margem_global_ativa : DEFAULT_SETTINGS.margemGlobalAtiva,
      margemGlobalValor: data.margem_global_valor !== undefined ? safeNumber(data.margem_global_valor) : DEFAULT_SETTINGS.margemGlobalValor,
      margemMinimaAtiva: data.margem_minima_ativa !== undefined ? !!data.margem_minima_ativa : DEFAULT_SETTINGS.margemMinimaAtiva,
      margemMinima: data.margem_minima !== undefined ? safeNumber(data.margem_minima) : DEFAULT_SETTINGS.margemMinima,
      pix1Name: data.pix1_name ?? DEFAULT_SETTINGS.pix1Name,
      pix1Code: data.pix1_code ?? DEFAULT_SETTINGS.pix1Code,
      pix2Name: data.pix2_name ?? DEFAULT_SETTINGS.pix2Name,
      pix2Code: data.pix2_code ?? DEFAULT_SETTINGS.pix2Code,
      productOrder: data.product_order || DEFAULT_SETTINGS.productOrder,
      clientOrder: data.client_order || DEFAULT_SETTINGS.clientOrder,
      companyName: data.company_name ?? DEFAULT_SETTINGS.companyName,
      companyCnpj: data.company_cnpj ?? DEFAULT_SETTINGS.companyCnpj,
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
    if (settings.productOrder !== undefined) payload.product_order = settings.productOrder;
    if (settings.clientOrder !== undefined) payload.client_order = settings.clientOrder;
    if (settings.companyName !== undefined) payload.company_name = settings.companyName;
    if (settings.companyCnpj !== undefined) payload.company_cnpj = settings.companyCnpj;

    const upsertPayload = {
        id: 'global_settings',
        ...payload
    };

    const { error } = await supabase
      .from('app_settings')
      .upsert(upsertPayload, { onConflict: 'id' });

    if (error) {
      console.error('Erro ao persistir configurações globais:', error);
      return false;
    }
    return true;
  },
};