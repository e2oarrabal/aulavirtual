// Avisos al móvil del Aula Virtual
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const RAIZ = () => self.registration.scope.replace(/prueba\/$/, '');
self.addEventListener('push', e => {
  let d = {};
  try { const j = e.data.json(); d = j.data || j; if (j.notification) d = { ...d, titulo: d.titulo || j.notification.title, texto: d.texto || j.notification.body }; } catch (x) { d = { texto: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Aula Virtual', {
    body: d.texto || '', icon: RAIZ() + 'icons/icon-192.png', badge: RAIZ() + 'icons/icon-192.png', tag: d.id || 'aula', data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data.url || './', RAIZ()).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if (w.url.split('#')[0] === url.split('#')[0] && 'focus' in w) { w.navigate(url); return w.focus(); }
    return clients.openWindow(url);
  }));
});
