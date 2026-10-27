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
