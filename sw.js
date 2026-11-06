// Aula E2O: la página se pide siempre a internet (para que lleguen las novedades);
// si no hay conexión, se usa la última copia guardada.
const CACHE='aula-e2o-202611061209';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','index.html','manifest.json','icons/icon-192.png','logos/e2o.jpg','logos/arrabal.png'])));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET') return;
  const u=new URL(r.url);
  const pagina = r.mode==='navigate' || u.pathname.endsWith('.html') || u.pathname.endsWith('/');
  if(pagina){ e.respondWith(fetch(r,{cache:'no-cache'}).then(res=>{const c=res.clone();caches.open(CACHE).then(x=>x.put(r,c));return res;}).catch(()=>caches.match(r).then(m=>m||caches.match('index.html')))); return; }
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{ if(res.ok&&(u.origin===location.origin||u.host.includes('fonts.g')||u.host.includes('jsdelivr'))){const c=res.clone();caches.open(CACHE).then(x=>x.put(r,c));} return res;})));
});
