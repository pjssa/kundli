// Present only so browsers treat the page as installable; it caches nothing and never answers a request itself,
// so every visit still loads the latest files and the live API.
self.addEventListener('fetch', () => {});

// Daily forecast pushes (sent at 7am IST by the server). Tapping one opens the app.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Cosmic Math', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Cosmic Math', {
    body: data.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: data.tag || undefined, data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const open = wins.find((w) => w.url.startsWith(self.location.origin));
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
