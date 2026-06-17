self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  const shouldBypassCache =
    request.mode === 'navigate' ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'worker' ||
    request.destination === 'manifest' ||
    request.destination === 'font' ||
    request.destination === 'document' ||
    requestUrl.pathname.startsWith('/assets/') ||
    requestUrl.pathname === '/version.json';

  if (!shouldBypassCache) {
    return;
  }

  event.respondWith(fetch(request, { cache: 'no-store' }));
});

/**
 * Handle push notifications from Firebase Cloud Messaging
 */
self.addEventListener('push', (event) => {
  if (!event.data) {
    console.warn('Push event received without data');
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch (error) {
    console.error('Error parsing push notification data:', error);
    return;
  }

  const { notification, data } = payload;
  if (!notification) {
    console.warn('Push notification received without notification field');
    return;
  }

  const options = {
    body: notification.body || '',
    icon: notification.icon || '/icon-192.png',
    badge: notification.badge || '/icon-192.png',
    tag: data?.tag || 'harinos-notification',
    data: data || {},
    vibrate: [300, 200, 300],
    requireInteraction: false,
    actions: [
      {
        action: 'open',
        title: 'Open',
        icon: '/icon-192.png',
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/icon-192.png',
      },
    ],
  };

  const promises = [];
  promises.push(self.registration.showNotification(notification.title || 'Harino\'s', options));

  // Set homescreen app icon badge if pendingCount exists
  if (data && data.pendingCount) {
    const count = parseInt(data.pendingCount, 10);
    if (!isNaN(count)) {
      const nav = self.navigator || navigator;
      if (nav && 'setAppBadge' in nav) {
        if (count > 0) {
          promises.push(nav.setAppBadge(count));
        } else {
          promises.push(nav.clearAppBadge());
        }
      }
    }
  }

  event.waitUntil(Promise.all(promises));
});

/**
 * Handle notification clicks
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const orderId = event.notification.data?.orderId;
  const data = event.notification.data || {};

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      // Check if app is already open
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          // App is open, send message and focus it
          client.postMessage({
            type: 'FCM_NOTIFICATION_CLICK',
            orderId,
            data,
          });
          return client.focus();
        }
      }

      // App not open, open it
      if (self.clients.openWindow) {
        const url = orderId ? `/?orderId=${orderId}` : '/';
        return self.clients.openWindow(url);
      }
    })(),
  );
});

/**
 * Handle notification close
 */
self.addEventListener('notificationclose', (event) => {
  console.log('Notification closed:', event.notification.tag);
});

