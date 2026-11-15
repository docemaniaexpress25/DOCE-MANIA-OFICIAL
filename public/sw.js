// Doce Mania - Service Worker
// Intercepta push notifications e mostra na tela do celular

const VAPID_PUBLIC_KEY = 'BK6v9AgRkhRVvHVeU8qpORoMybYJ41KHxhpluV2PIG-awhUIJxcMBOhnGNzNEhKPo_VNl6YrdQPa3DcOmvYAh60';

// Instalacao do Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Instalado');
  self.skipWaiting();
});

// Ativacao
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativado');
  event.waitUntil(clients.claim());
});

// Receber push notification
self.addEventListener('push', (event) => {
  console.log('[SW] Push recebido');
  
  let data = { title: 'Doce Mania', body: 'Nova atividade', icon: '/logo.svg', url: '/' };
  
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }
  
  const options = {
    body: data.body,
    icon: data.icon || '/logo.svg',
    badge: '/logo.svg',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'dismiss', title: 'Fechar' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Acao ao clicar na notificacao
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'dismiss') return;
  
  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se ja tem uma janela aberta, foca nela
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Senao abre nova janela
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
