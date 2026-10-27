/* Distances, courbes, noms de lieux (pack du pays puis Nominatim) et contours de pays (geoBoundaries). */
export const km = (a,b) => { const R=6371, r=Math.PI/180, dl=(b.lat-a.lat)*r, dg=(b.lng-a.lng)*r; const h=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dg/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
export const curve = (a,b,bend=.18) => {
  const mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2, dx=b[0]-a[0], dy=b[1]-a[1];
  const c=[mx - dy*bend, my + dx*bend], pts=[];
  for (let i=0;i<=24;i++){ const t=i/24, u=1-t; pts.push([u*u*a[0]+2*u*t*c[0]+t*t*b[0], u*u*a[1]+2*u*t*c[1]+t*t*b[1]]); }
  return pts;
};
export const fmtCoord = (lat,lng) => `${Math.abs(lat).toFixed(5)}° ${lat>=0?"N":"S"} · ${Math.abs(lng).toFixed(5)}° ${lng>=0?"E":"O"}`;

/* Lieu connu du pack si proche : "" sinon. */
export function packPlace(pack, lat, lng){
  if (!pack?.places?.length) return "";
  let best = "", bd = 1e9;
  pack.places.forEach(([n,la,lo]) => { const d = km({lat,lng},{lat:la,lng:lo}); if (d < bd){ bd = d; best = n; } });
  return bd < 1.5 ? best : bd < 4 ? `Près de ${best}` : "";
}

/* Géocodage inverse Nominatim : 1 requête par seconde au plus, langue fr, cache mémoire + appareil. */
const memo = new Map();
let chain = Promise.resolve(), last = 0;
const keyOf = (lat,lng) => `${lat.toFixed(3)},${lng.toFixed(3)}`;
function lsGet(k){ try { const o = JSON.parse(localStorage.getItem("vi.geo") || "{}"); return o[k]; } catch(_){ return undefined; } }
function lsSet(k,v){ try { const o = JSON.parse(localStorage.getItem("vi.geo") || "{}"); o[k] = v; const ks = Object.keys(o); if (ks.length > 500) delete o[ks[0]]; localStorage.setItem("vi.geo", JSON.stringify(o)); } catch(_){} }
export function nominatimName(j){
  const a = j?.address || {};
  return (j?.name || a.tourism || a.historic || a.attraction || a.leisure || a.natural || a.beach
    || a.village || a.town || a.suburb || a.hamlet || a.city_district || a.city || a.municipality || a.county || "").slice(0,80);
}
export function reverseGeocode(lat, lng){
  const k = keyOf(lat,lng);
  if (memo.has(k)) return memo.get(k);
  const cached = lsGet(k);
  if (cached !== undefined){ const p = Promise.resolve(cached); memo.set(k,p); return p; }
  const p = chain = chain.then(async () => {
    const wait = last + 1100 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    try {
      const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=fr&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`;
      const res = await fetch(u, {headers:{"Accept-Language":"fr"}});
      if (!res.ok) return "";
      const name = nominatimName(await res.json());
      lsSet(k, name); return name;
    } catch(_){ return ""; }
  });
  memo.set(k, p);
  p.then(v => { if (!v) memo.delete(k); });
  return p;
}
/* Nom automatique : pack d'abord, sinon Nominatim. */
export async function autoPlace(pack, lat, lng){
  return packPlace(pack, lat, lng) || await reverseGeocode(lat, lng);
}

/* Contour du pays : data/{ISO3}.geojson (cache du dépôt), sinon l'API geoBoundaries. */
export async function loadCountry(iso3){
  iso3 = String(iso3 || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(iso3)) return null;
  try { const r = await fetch(`data/${iso3}.geojson`); if (r.ok) return await r.json(); } catch(_){}
  const lsKey = "vi.country." + iso3;
  try { const c = localStorage.getItem(lsKey); if (c) return JSON.parse(c); } catch(_){}
  try {
    const meta = await (await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM0/`)).json();
    const url = (Array.isArray(meta) ? meta[0] : meta)?.simplifiedGeometryGeoJSON;
    if (!url) return null;
    const gj = await (await fetch(url)).json();
    try { localStorage.setItem(lsKey, JSON.stringify(gj)); } catch(_){}
    return gj;
  } catch(_){ return null; }
}

/* Terre ou mer ? Contour détaillé du pays du voyage + terres du monde (Natural Earth, simplifiées).
   Une photo à moins de 300 m de la côte du pays (3 km ailleurs) compte comme prise à terre. */
export function makeLand(country, world){
  const polys = gj => {
    const out = [];
    (gj?.features || (gj ? [gj] : [])).forEach(f => {
      const g = f.geometry || f;
      const cs = g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : [];
      cs.forEach(rings => {
        let w = 180, e = -180, s = 90, n = -90;
        rings[0].forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); });
        out.push({ rings, w, e, s, n });
      });
    });
    return out;
  };
  const C = polys(country);
  const cb = C.length ? C.reduce((b, p) => ({ w: Math.min(b.w, p.w), e: Math.max(b.e, p.e), s: Math.min(b.s, p.s), n: Math.max(b.n, p.n) }), { w: 180, e: -180, s: 90, n: -90 }) : null;
  const near = (b, x, y, m) => x >= b.w - m && x <= b.e + m && y >= b.s - m && y <= b.n + m;
  // Les terres du monde qui recouvrent le pays détaillé sont écartées (contour grossier).
  const W = polys(world).filter(p => !(cb && p.w >= cb.w - .2 && p.e <= cb.e + .2 && p.s >= cb.s - .2 && p.n <= cb.n + .2));
  const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++){ const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const inAny = (P, x, y) => P.some(p => near(p, x, y, 0) && p.rings.reduce((c, r) => inRing(r, x, y) ? !c : c, false));
  const coastKm = (P, lat, lng, m) => {
    const kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57; let best = 1e9;
    P.forEach(p => { if (!near(p, lng, lat, m)) return; p.rings.forEach(r => { for (let i = 1; i < r.length; i++){
      const ax = (r[i-1][0] - lng) * kx, ay = (r[i-1][1] - lat) * ky, bx = (r[i][0] - lng) * kx, by = (r[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, L = dx*dx + dy*dy, t = L ? Math.max(0, Math.min(1, -(ax*dx + ay*dy) / L)) : 0;
      best = Math.min(best, Math.hypot(ax + t*dx, ay + t*dy)); } }); });
    return best;
  };
  const memo = new Map();
  const isWater = (lat, lng) => {
    if (!C.length && !W.length) return false;
    const k = lat.toFixed(4) + "," + lng.toFixed(4);
    if (memo.has(k)) return memo.get(k);
    let water = true;
    if (cb && near(cb, lng, lat, .3) && (inAny(C, lng, lat) || coastKm(C, lat, lng, .01) < .3)) water = false;
    else if (inAny(W, lng, lat) || coastKm(W, lat, lng, .05) < 3) water = false;
    memo.set(k, water);
    return water;
  };
  const inCountry = (lat, lng) => !cb || near(cb, lng, lat, .15);
  return { isWater, inCountry };
}

/* Terres du monde pour le fond de carte et la détection terre/mer. */
let worldP = null;
export function loadWorld(){
  return worldP ??= fetch("data/world-land.geojson").then(r => r.ok ? r.json() : null).catch(() => null);
}

/* Recherche d'un lieu par son nom (Nominatim), même file d'attente que le géocodage inverse. */
export function searchPlaces(q){
  const p = chain = chain.then(async () => {
    const wait = last + 1100 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&accept-language=fr&q=${encodeURIComponent(q)}`, {headers:{"Accept-Language":"fr"}});
      if (!res.ok) return [];
      return (await res.json()).map(j => ({ name: (j.name || nominatimName(j) || j.display_name.split(",")[0]).slice(0, 80),
        detail: j.display_name, lat: +j.lat, lng: +j.lon }));
    } catch(_){ return []; }
  });
  return p;
}
