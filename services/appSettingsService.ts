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
  productOrder: string[]; // Novo campo para ordem dos produtos
}

const DEFAULT_SETTINGS: AppSettings = {
  logo: null,
  margemGlobalAtiva: true,
  margemGlobalValor: 35,
  margemMinimaAtiva: true,
  margemMinima: 20,
  pix1Name: "Pix Banco A",
  pix1Code: null,
  pix2Name: "Pix Banco B",
  pix2Code: null,
  productOrder: [], // Padrão: array vazio
};

// Helper function to safely convert database numeric values (which might be null or string) to number
const safeNumber = (value: any): number => Number(value || 0);

export const appSettingsService = {
  async getSettings(): Promise<AppSettings> {
    const { data, error } = await supabase
      .from('app_settings')
      .select('*')
      .eq('id', 'global_settings')
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = No rows found
      console.error('Erro ao buscar configurações:', error);
    }

    if (!data) {
      // Se não houver configurações, insere as configurações padrão
      await this.updateSettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }

    // Mapeamento robusto, usando valores do DB se existirem, ou valores padrão se forem null
    return {
      logo: data.logo ?? DEFAULT_SETTINGS.logo,
      margemGlobalAtiva: !!data.margem_global_ativa,
      margemGlobalValor: safeNumber(data.margem_global_valor),
      margemMinimaAtiva: !!data.margem_minima_ativa,
      margemMinima: safeNumber(data.margem_minima),
      pix1Name: data.pix1_name ?? DEFAULT_SETTINGS.pix1Name,
      pix1Code: data.pix1_code ?? DEFAULT_SETTINGS.pix1Code,
      pix2Name: data.pix2_name ?? DEFAULT_SETTINGS.pix2Name,
      pix2Code: data.pix2_code ?? DEFAULT_SETTINGS.pix2Code,
      productOrder: data.product_order || DEFAULT_SETTINGS.productOrder, // Lendo o JSONB
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
    if (settings.productOrder !== undefined) payload.product_order = settings.productOrder; // Escrevendo o JSONB

    // Adiciona o ID da linha única e mescla com os valores padrão para garantir que todos os campos NOT NULL sejam preenchidos na inserção (upsert)
    const upsertPayload = {
        id: 'global_settings',
        margem_global_ativa: DEFAULT_SETTINGS.margemGlobalAtiva,
        margem_global_valor: DEFAULT_SETTINGS.margemGlobalValor,
        margem_minima_ativa: DEFAULT_SETTINGS.margemMinimaAtiva,
        margem_minima: DEFAULT_SETTINGS.margemMinima,
        product_order: DEFAULT_SETTINGS.productOrder,
        ...payload
    };

    const { error } = await supabase
      .from('app_settings')
      .upsert(upsertPayload, { onConflict: 'id' });

    if (error) {
      console.error('Erro ao persistir configurações globais (upsert):', error);
      return false;
    }
    return true;
  },
};