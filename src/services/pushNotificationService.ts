import { supabase } from '@/lib/supabaseClient';

const VAPID_PUBLIC_KEY = 'BK6v9AgRkhRVvHVeU8qpORoMybYJ41KHxhpluV2PIG-awhUIJxcMBOhnGNzNEhKPo_VNl6YrdQPa3DcOmvYAh60';

// Converte a chave VAPID de base64 para Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const pushService = {
  /**
   * Registra o Service Worker e solicita permissao de notificacao
   */
  async init(): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[PUSH] Service Worker ou PushManager nao suportado');
      return false;
    }

    try {
      // 1. Registrar Service Worker
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('[PUSH] Service Worker registrado');

      // 2. Verificar permissao atual
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[PUSH] Permissao de notificacao negada:', permission);
        return false;
      }

      // 3. Inscrever para push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // 4. Salvar inscrio no Supabase
      await this.saveSubscription(subscription);
      console.log('[PUSH] Inscricao salva com sucesso');
      return true;
    } catch (err: any) {
      console.error('[PUSH] Erro ao inicializar:', err?.message);
      return false;
    }
  },

  /**
   * Salva a push subscription no Supabase
   */
  async saveSubscription(subscription: PushSubscription): Promise<boolean> {
    const subData = subscription.toJSON();
    const { error } = await supabase
      .from('push_tokens')
      .upsert({
        endpoint: subData.endpoint,
        keys_auth: subData.keys?.auth,
        keys_p256dh: subData.keys?.p256dh,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' });

    if (error) {
      console.error('[PUSH] Erro ao salvar token:', error.message);
      return false;
    }
    return true;
  },

  /**
   * Remove a inscricao (logout)
   */
  async unsubscribe(): Promise<void> {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        // Remove do Supabase
        await supabase.from('push_tokens').delete().eq('endpoint', sub.endpoint);
      }
    }
  },

  /**
   * Verifica se esta inscrito
   */
  async isSubscribed(): Promise<boolean> {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (!registration) return false;
    const sub = await registration.pushManager.getSubscription();
    return !!sub;
  },
};
