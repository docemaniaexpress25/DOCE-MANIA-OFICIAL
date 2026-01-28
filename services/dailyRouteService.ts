import { supabase } from '../supabaseClient';
import { DailyRouteState } from '../types';

export const dailyRouteService = {
  async getRoute(vendedorId: string): Promise<DailyRouteState | null> {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('daily_routes')
      .select('*')
      .eq('vendedor_id', vendedorId)
      .eq('data', today)
      .single();

    if (error || !data) return null;

    return {
      date: data.data,
      clientIds: data.client_ids || [],
      skippedClientIds: data.skipped_client_ids || []
    };
  },

  async updateRoute(vendedorId: string, state: DailyRouteState): Promise<boolean> {
    const { error } = await supabase
      .from('daily_routes')
      .upsert({
        vendedor_id: vendedorId,
        data: state.date,
        client_ids: state.clientIds,
        skipped_client_ids: state.skippedClientIds
      }, { onConflict: 'vendedor_id, data' });

    return !error;
  }
};