/* Mon carnet de voyages : l'appli reste sur le téléphone pour s'ouvrir tout de suite.
   - bibliothèques et polices (adresses versionnées) : depuis le cache, jamais retéléchargées ;
   - fichiers de l'appli : depuis le cache, puis mis à jour en arrière-plan ; une nouvelle version est signalée à la page.
   Les données (Firestore), les photos et les vidéos ne passent pas par ici. */
const SHELL = "carnet-shell-v2", LIBS = "carnet-libs-v1";
const CORE = ["./", "index.html", "app.js", "style.css", "firebase-config.js", "manifest.webmanifest", "icons/icon.svg",
  "lib/time.js", "lib/exif.js", "lib/mov.js", "lib/s3.js", "lib/geo.js", "lib/journey.js", "packs/index.js"];
const LIB_HOSTS = ["www.gstatic.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, LIBS].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const sig = r => r && (r.headers.get("etag") || r.headers.get("last-modified") || r.headers.get("content-length") || "");
async function notify(){
  for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "update" });
}

self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (LIB_HOSTS.includes(url.host) && (url.host !== "www.gstatic.com" || url.pathname.startsWith("/firebasejs/"))){
    e.respondWith(caches.open(LIBS).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const r = await fetch(req); if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  const key = req.mode === "navigate" ? new Request(new URL("./", location).href) : new Request(url.origin + url.pathname);
  // Le code de l'appli (page, scripts, styles) vient d'abord du réseau : une correction publiée arrive tout de suite.
  // Sans réseau (ou s'il traîne plus de 3 s), la copie gardée sur l'appareil prend le relais.
  if (req.mode === "navigate" || /\.(js|css|html|webmanifest)$/.test(url.pathname)){
    e.respondWith(caches.open(SHELL).then(async c => {
      const net = fetch(req, { cache: "no-cache" }).then(r => { if (r.ok) c.put(key, r.clone()); return r; });
      const late = new Promise(res => setTimeout(res, 3000)).then(() => c.match(key));
      try { return (await Promise.race([net, late.then(h => h || net)])) || await net; }
      catch(_){ return (await c.match(key)) || Response.error(); }
    }));
    return;
  }
  e.respondWith(caches.open(SHELL).then(async c => {
    const hit = await c.match(key);
    const fresh = fetch(req, { cache: "no-cache" }).then(async r => {
      if (r.ok){
        await c.put(key, r.clone());
        if (hit && sig(hit) !== sig(r) && (req.mode === "navigate" || /\.(js|css)$/.test(url.pathname))) notify();
      }
      return r;
    }).catch(() => hit || Response.error());
    if (hit){ e.waitUntil(fresh); return hit; }
    return fresh;
  }));
});
