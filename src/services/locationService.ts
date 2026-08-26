import { supabase } from '@/lib/supabaseClient';

// Salva a última localização conhecida do vendedor
export const locationService = {
  async saveLocation(userId: string, lat: number, lng: number) {
    const { error } = await supabase
      .from('user_locations')
      .upsert({
        user_id: userId,
        latitude: lat,
        longitude: lng,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (error) console.error('Erro ao salvar localização:', error);
    return !error;
  },

  async getLocation(userId: string): Promise<{ latitude: number; longitude: number; updated_at: string } | null> {
    const { data, error } = await supabase
      .from('user_locations')
      .select('latitude, longitude, updated_at')
      .eq('user_id', userId)
      .single();
    if (error || !data) return null;
    return {
      latitude: data.latitude,
      longitude: data.longitude,
      updated_at: data.updated_at,
    };
  },
};

// Tipos de notificação disponíveis
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

// Serviço de notificações realtime via Supabase
export const notificationService = {
  /**
   * Inscreve o admin para receber notificações realtime de vendas e recebimentos.
   * Retorna uma função de cleanup para desinscrever.
   */
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
              body: `R$ ${valor} — ${metodo}`,
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
          // Detecta recebimento: valor_pago aumentou
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

  // Salva preferências de notificação no localStorage
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
