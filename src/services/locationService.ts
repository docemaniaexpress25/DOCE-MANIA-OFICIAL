import { supabase } from '@/lib/supabaseClient';
import { authHeaders } from '@/services/userService';

/**
 * GPS: conversa com /api/location (server-side, service_role).
 * user_locations esta fechada para o anon (RLS + REVOKE) — o upsert
 * direto pelo cliente Supabase falhava com 42501 em silencio, e por
 * isso o admin nunca via a localizacao do vendedor.
 *
 * notificationService (realtime de vendas) continua usando o cliente
 * Supabase anon — sales segue legivel para o app.
 */

// Salva a ultima localizacao conhecida do usuario logado (user_id vem da sessao)
export const locationService = {
  async saveLocation(_userId: string, lat: number, lng: number): Promise<boolean> {
    try {
      const res = await fetch('/api/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        console.error('[LOCATION] Erro ao salvar:', res.status, d?.error || '');
        return false;
      }
      console.log('[LOCATION] Salva com sucesso:', lat.toFixed(5), lng.toFixed(5));
      return true;
    } catch (err: any) {
      console.error('[LOCATION] Excecao ao salvar:', err?.message);
      return false;
    }
  },

  async getLocation(userId: string): Promise<{ latitude: number; longitude: number; updated_at: string } | null> {
    try {
      const res = await fetch(`/api/location?userId=${encodeURIComponent(userId)}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        console.error('[LOCATION] Erro ao buscar:', res.status);
        return null;
      }
      const d = await res.json();
      if (!d?.location) return null;
      return {
        latitude: d.location.latitude,
        longitude: d.location.longitude,
        updated_at: d.location.updated_at,
      };
    } catch (err: any) {
      console.error('[LOCATION] Excecao ao buscar:', err?.message);
      return null;
    }
  },

  /** Localizacao de todos os usuarios de uma vez (painel admin) */
  async getAllLocations(): Promise<Array<{ userId: string; nome: string; latitude: number; longitude: number; updatedAt: string }>> {
    try {
      const res = await fetch('/api/location?all=1', { headers: authHeaders() });
      if (!res.ok) return [];
      const d = await res.json();
      return d?.locations || [];
    } catch {
      return [];
    }
  },
};

// Tipos de notificacao disponiveis
export type NotificationType = 'NOVA_VENDA' | 'RECEBIMENTO' | 'NOVO_CLIENTE' | 'ESTOQUE_BAIXO';

export interface NotificationPref {
  type: NotificationType;
  label: string;
  icon: string;
  color: string;
  enabled: boolean;
}

export const NOTIFICATION_TYPES: NotificationPref[] = [
  { type: 'NOVA_VENDA', label: 'Venda Realizada', icon: 'fa-solid fa-cart-shopping', color: 'text-emerald-500', enabled: true },
  { type: 'RECEBIMENTO', label: 'Recebimento de Conta', icon: 'fa-solid fa-money-bill-wave', color: 'text-blue-500', enabled: true },
  { type: 'NOVO_CLIENTE', label: 'Novo Cliente Cadastro', icon: 'fa-solid fa-user-plus', color: 'text-purple-500', enabled: false },
  { type: 'ESTOQUE_BAIXO', label: 'Estoque Baixo', icon: 'fa-solid fa-box-open', color: 'text-orange-500', enabled: false },
];

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
  createdAt: string;
  read: boolean;
}

// Servico de notificacoes realtime via Supabase
export const notificationService = {
  subscribeToRealtime(callback: (notification: AppNotification) => void, enabledTypes: NotificationType[]) {
    const channel = supabase
      .channel('admin-notifications')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sales' },
        (payload: any) => {
          const s = payload.new;
          if (!s) return;
          if (enabledTypes.includes('NOVA_VENDA')) {
            console.log('[NOTIF] Nova venda detectada via realtime:', s.id);
            const valor = Number(s.valor_total || 0).toFixed(2);
            const metodo = s.metodo_pagamento === 'A_PRAZO' ? 'A Prazo' : (s.metodo_pagamento || '');
            const vendedor = s.vendedor_id ? s.vendedor_id.substring(0, 8) : '?';
            callback({
              id: s.id,
              type: 'NOVA_VENDA',
              title: 'Nova Venda!',
              body: `R$ ${valor} - ${metodo}`,
              data: { saleId: s.id, vendedorId: s.vendedor_id, clientId: s.client_id },
              createdAt: s.data_venda || new Date().toISOString(),
              read: false,
            });
          }
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sales' },
        (payload: any) => {
          const s = payload.new;
          const old = payload.old;
          if (!s || !old) return;
          const oldPaid = Number(old.valor_pago || 0);
          const newPaid = Number(s.valor_pago || 0);
          if (newPaid > oldPaid && enabledTypes.includes('RECEBIMENTO')) {
            console.log('[NOTIF] Recebimento detectado via realtime:', s.id, 'R$', newPaid - oldPaid);
            const received = newPaid - oldPaid;
            const total = Number(s.valor_total || 0);
            const isFull = newPaid >= total;
            callback({
              id: s.id + '-recv-' + Date.now(),
              type: 'RECEBIMENTO',
              title: isFull ? 'Conta Recebida!' : 'Recebimento Parcial',
              body: `R$ ${received.toFixed(2)} recebido${isFull ? ' (pago)' : ''}`,
              data: { saleId: s.id, vendedorId: s.vendedor_id },
              createdAt: new Date().toISOString(),
              read: false,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  getPreferences(): NotificationType[] {
    if (typeof window === 'undefined') return NOTIFICATION_TYPES.filter(n => n.enabled).map(n => n.type);
    try {
      const saved = localStorage.getItem('admin_notif_prefs');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return NOTIFICATION_TYPES.filter(n => n.enabled).map(n => n.type);
  },

  savePreferences(types: NotificationType[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem('admin_notif_prefs', JSON.stringify(types));
  },
};
