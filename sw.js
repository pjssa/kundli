// Present only so browsers treat the page as installable; it caches nothing and never answers a request itself,
// so every visit still loads the latest files and the live API.
self.addEventListener('fetch', () => {});

// Daily forecast pushes (sent at 7am IST by the server). Tapping one opens the app.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Cosmic Math', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Cosmic Math', {
    body: data.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: data.tag || undefined, requireInteraction: true, renotify: !!data.tag, data: { url: data.url || '/' },
  }));
});

// A new version of this file takes over as soon as it has installed, so a fix reaches phones the next time the app is opened.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Tapping a push. On an iPhone the app is brought up only by opening a window from inside this handler: finding the already-open (often
// suspended) window and calling focus() can resolve without showing anything, which looked like "I tapped it and nothing happened".
// So an iPhone always opens the page with ?daily=1 or ?sky=1, which shows the message in a popup after loading. Elsewhere an open app
// gets the message at once and a closed one opens the same link; if focusing fails the link is opened instead.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const n = event.notification;
  const url = new URL(n.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    // An already-open (often suspended) app ignores openWindow on iOS and a bare focus() can resolve without showing anything,
    // which was the "I tapped it and nothing happened" report. Navigating that window to the ?daily=1 link makes it load and show
    // the popup itself; only when no window exists is a new one opened.
    try {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = wins.find((w) => w.url.startsWith(self.location.origin));
      if (open) {
        const nav = open.navigate ? await open.navigate(url) : null;
        await (nav || open).focus();
        return;
      }
    } catch { /* open the link below instead */ }
    await self.clients.openWindow(url);
  })());
});
