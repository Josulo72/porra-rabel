// Service Worker para La Porra de Supervivencia
// Permite recibir notificaciones push incluso con la web cerrada

const CACHE_NAME = 'porra-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// Escuchar mensajes del frontend para mostrar notificaciones
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(e.data.title, {
      body: e.data.body,
      icon: e.data.icon || '/favicon.ico',
      badge: '/favicon.ico',
      tag: e.data.tag || 'porra-notification',
      renotify: true,
      requireInteraction: e.data.persistent || false,
      data: { url: e.data.url || '/' },
    });
  }
});

// Al hacer click en la notificación, abrir/enfocar la web
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('porra') && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(e.notification.data.url || '/');
    })
  );
});
