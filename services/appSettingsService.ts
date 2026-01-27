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

    return {
      logo: data.logo,
      margemGlobalAtiva: !!data.margem_global_ativa,
      margemGlobalValor: safeNumber(data.margem_global_valor),
      margemMinimaAtiva: !!data.margem_minima_ativa,
      margemMinima: safeNumber(data.margem_minima),
      pix1Name: data.pix1_name,
      pix1Code: data.pix1_code,
      pix2Name: data.pix2_name,
      pix2Code: data.pix2_code,
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

    const { error } = await supabase
      .from('app_settings')
      .update(payload)
      .eq('id', 'global_settings');

    if (error) {
      // Se a linha não existir, tenta inserir
      if (error.code === 'PGRST116') {
        const insertPayload = { id: 'global_settings', ...payload };
        const { error: insertError } = await supabase.from('app_settings').insert(insertPayload);
        if (insertError) {
          console.error('Erro ao inserir configurações:', insertError);
          return false;
        }
        return true;
      }
      console.error('Erro ao atualizar configurações:', error);
      return false;
    }
    return true;
  },
};