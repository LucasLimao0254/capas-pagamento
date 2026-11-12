// Service worker: deixa a tela do app abrir mesmo sem internet.
// Só guarda os arquivos do próprio app e as bibliotecas; nunca os dados do servidor.
const CACHE = 'capas-v6';
const BIBLIOTECAS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png', ...BIBLIOTECAS];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  const doApp = u.origin === self.location.origin || BIBLIOTECAS.includes(u.href);
  if (!doApp) return; // Supabase e demais: direto na rede, sem guardar
  // rede primeiro (para receber atualizações); sem rede, usa o que está guardado
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
