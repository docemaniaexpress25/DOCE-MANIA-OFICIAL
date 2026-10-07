import { authHeaders } from '@/services/userService';
import { DailyRouteState } from '@/lib/types';

/**
 * A rota diaria NAO conversa mais direto com o Supabase (anon):
 * daily_routes tem RLS e as policies antigas eram "TO authenticated" —
 * como o app usa login proprio (nunca Supabase Auth), toda requisicao
 * chegava como anon e o upsert falhava com 42501 em silencio
 * ("Erro ao salvar rota diaria" no console).
 * Agora passa pela /api/daily-route (service_role + sessao),
 * mesmo padrao do /api/location.
 */
export const dailyRouteService = {
  async getRoute(vendedorId: string, date: string): Promise<DailyRouteState | null> {
    try {
      const res = await fetch(`/api/daily-route?data=${encodeURIComponent(date)}`, {
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        console.error('Erro ao buscar rota diária:', res.status, d?.error || '', d?.detail || '');
        return null;
      }
      const d = await res.json();
      if (!d?.route) return null;
      return {
        date: d.route.date,
        clientIds: d.route.clientIds || [],
        skippedClientIds: d.route.skippedClientIds || []
      };
    } catch (err: any) {
      console.error('Erro ao buscar rota diária:', err?.message);
      return null;
    }
  },

  async updateRoute(vendedorId: string, route: DailyRouteState): Promise<boolean> {
    try {
      const res = await fetch('/api/daily-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          date: route.date,
          clientIds: route.clientIds,
          skippedClientIds: route.skippedClientIds
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        console.error('Erro ao salvar rota diária:', res.status, d?.error || '', d?.detail || '');
        return false;
      }
      return true;
    } catch (err: any) {
      console.error('Erro ao salvar rota diária:', err?.message);
      return false;
    }
  }
};
