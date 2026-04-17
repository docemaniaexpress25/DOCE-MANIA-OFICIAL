import { supabase } from '../supabaseClient';
import { DailyRouteState } from '../types';

export const dailyRouteService = {
  async getRoute(vendedorId: string, date: string): Promise<DailyRouteState | null> {
    const { data, error } = await supabase
      .from('daily_routes')
      .select('data, client_ids, skipped_client_ids') // ✅ Added 'data' column
      .eq('vendedor_id', vendedorId)
      .eq('data', date)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar rota diária:', error);
      return null;
    }

    if (!data) return null;

    return {
      date: data.data as string,
      clientIds: data.client_ids || [],
      skippedClientIds: data.skipped_client_ids || []
    };
  },

  async updateRoute(vendedorId: string, route: DailyRouteState): Promise<boolean> {
    const payload = {
      vendedor_id: vendedorId,
      data: route.date,
      client_ids: route.clientIds,
      skipped_client_ids: route.skippedClientIds
    };
    const { error } = await supabase
      .from('daily_routes')
      .upsert(payload, { onConflict: 'vendedor_id,data' });
    return !error;
  }
};