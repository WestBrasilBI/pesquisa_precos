// nome inclui o endereço: o link de teste e o oficial ficam no mesmo domínio e não podem apagar o cache um do outro
const CACHE = 'pesquisa-preco-v3|' + self.registration.scope;
const ASSETS = ['./', './index.html', './styles.css', './config.js', './vendor/msal-browser.min.js', './nuvem.js', './app.js',
  './data/data.js', './manifest.json', './logo-west.png', './logo-west-branco.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE && (k.endsWith('|' + self.registration.scope) || !k.includes('|'))).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // só os arquivos do app; login Microsoft, API do banco e SharePoint passam direto
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    // online: sempre a versão mais nova; offline (loja sem sinal): a última salva
    fetch(e.request, { cache: 'no-store' })
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
