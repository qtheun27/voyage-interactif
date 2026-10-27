/* Métadonnées des vidéos MOV / MP4 (iPhone, Android) : date avec fuseau, position GPS, durée, appareil.
   Seule la boîte « moov » est lue (quelques Mo au plus), jamais toute la vidéo. */
import { wallToUtc } from "./time.js";

const str = (v, o, n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(o + i)); return s; };
const utf8 = (v, o, n) => new TextDecoder().decode(new Uint8Array(v.buffer, v.byteOffset + o, n));

/* Trouve la boîte « moov » en ne lisant que les en-têtes de boîtes. read(start, end) -> ArrayBuffer */
async function findMoov(size, read){
  let o = 0;
  while (o + 8 <= size){
    const h = new DataView(await read(o, Math.min(size, o + 16)));
    let len = h.getUint32(0); const type = str(h, 4, 4);
    if (len === 1) len = Number(h.getBigUint64(8)); else if (len === 0) len = size - o;
    if (len < 8) return null;
    if (type === "moov") return len > 64 * 1024 * 1024 ? null : new DataView(await read(o, o + len));
    o += len;
  }
  return null;
}
function* boxes(v, start, end){
  let o = start;
  while (o + 8 <= end){
    let len = v.getUint32(o); const type = str(v, o + 4, 4); let hdr = 8;
    if (len === 1){ len = Number(v.getBigUint64(o + 8)); hdr = 16; } else if (len === 0) len = end - o;
    if (len < hdr || o + len > end) return;
    yield { type, start: o + hdr, end: o + len };
    o += len;
  }
}
/* ISO 6709 : « +35.8989+014.5146+010.000/ » */
export function parseIso6709(s){
  const m = /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(s || "");
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
/* « 2026-10-26T10:15:30+0100 » -> instant UTC ; sans fuseau, heure du voyage. */
export function parseQtDate(s, tz){
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|[+-]\d\d:?\d\d)?/.exec(s || "");
  if (!m || +m[1] < 2000) return null;
  const off = m[7] === "Z" ? "+00:00" : m[7];
  return wallToUtc(tz, +m[1], +m[2], +m[3], +m[4], +m[5], +m[6], off || null);
}

export function readMoov(v, tz){
  const r = {}, meta = {};
  // Chaque boîte « meta » a sa propre liste de clés (l'iPhone en met aussi dans les pistes).
  const walk = (start, end, path, keys = []) => {
    for (const b of boxes(v, start, end)){
      if (b.type === "mvhd"){
        const ver = v.getUint8(b.start);
        const ct = ver === 1 ? Number(v.getBigUint64(b.start + 4)) : v.getUint32(b.start + 4);
        const scale = v.getUint32(b.start + (ver === 1 ? 20 : 12)), dur = ver === 1 ? Number(v.getBigUint64(b.start + 24)) : v.getUint32(b.start + 16);
        if (ct > 0) r.mvhdUtc = (ct - 2082844800) * 1000; // secondes depuis 1904
        if (scale) r.duration = dur / scale;
      } else if (b.type === "tkhd" && !r.width){
        const ver = v.getUint8(b.start), o = b.start + (ver === 1 ? 88 : 76);
        const w = v.getUint32(o) / 65536, h = v.getUint32(o + 4) / 65536;
        if (w && h) { r.width = Math.round(w); r.height = Math.round(h); }
      } else if (b.type === "©xyz"){
        const n = v.getUint16(b.start); r.xyz = str(v, b.start + 4, Math.min(n, b.end - b.start - 4));
      } else if (b.type === "keys"){
        const n = v.getUint32(b.start + 4); let o = b.start + 8;
        for (let i = 0; i < n && o + 8 <= b.end; i++){ const len = v.getUint32(o); keys.push(str(v, o + 8, len - 8)); o += len; }
      } else if (path.endsWith("ilst") && /^\0\0\0[\x01-\xff]$/.test(b.type)){
        const idx = v.getUint32(b.start - 4) - 1, k = keys[idx];
        for (const d of boxes(v, b.start, b.end)) if (d.type === "data" && k && !(k in meta)) meta[k] = utf8(v, d.start + 8, d.end - d.start - 8);
      } else if (b.type === "meta"){
        // « meta » QuickTime (sans version) ou MP4 (avec 4 octets de version)
        const skip = str(v, b.start + 4, 4) === "hdlr" ? 0 : 4;
        walk(b.start + skip, b.end, path + "/meta", []);
      } else if (["moov", "trak", "udta", "ilst", "mdia"].includes(b.type)) walk(b.start, b.end, path + "/" + b.type, keys);
    }
  };
  walk(0, v.byteLength, "");
  // Secours : position et date cherchées directement dans le texte des métadonnées.
  let raw = null;
  const text = () => raw ??= new TextDecoder("latin1").decode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  const isoTxt = meta["com.apple.quicktime.location.ISO6709"] || r.xyz || /[+-]\d{1,2}\.\d{3,}[+-]\d{1,3}\.\d{3,}(?:[+-]\d+(?:\.\d+)?)?\//.exec(text())?.[0];
  const loc = parseIso6709(isoTxt);
  const dateTxt = meta["com.apple.quicktime.creationdate"] || /20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)/.exec(text())?.[0];
  const at = parseQtDate(dateTxt, tz) ?? (r.mvhdUtc > Date.UTC(2000, 0, 1) ? r.mvhdUtc : null);
  return { lat: loc?.lat ?? null, lng: loc?.lng ?? null, at, timeSrc: dateTxt ? "vidéo (avec fuseau)" : at ? "vidéo" : null,
    duration: r.duration || null, width: r.width || null, height: r.height || null,
    device: [meta["com.apple.quicktime.make"], meta["com.apple.quicktime.model"]].filter(Boolean).join(" ").slice(0, 60) };
}

/* Fichier vidéo du navigateur -> métadonnées */
export async function readVideoMeta(file, tz){
  try {
    const v = await findMoov(file.size, (a, b) => file.slice(a, b).arrayBuffer());
    if (v) return readMoov(new DataView(v.buffer, v.byteOffset + 8, v.byteLength - 8), tz);
  } catch(_){}
  return { lat: null, lng: null, at: null, timeSrc: null, duration: null, device: "" };
}
export { findMoov };
