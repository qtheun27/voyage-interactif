/* Lecteur EXIF JPEG intégré : date de prise de vue, fuseau, heure GPS (UTC), position, appareil. */
import { parseExifDate } from "./time.js";

export function readJpegExif(buf){
  const v = new DataView(buf); if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
  let o = 2;
  while (o < v.byteLength - 10){
    const mk = v.getUint16(o); if ((mk & 0xFF00) !== 0xFF00) return null;
    const len = v.getUint16(o+2);
    if (mk === 0xFFE1 && v.getUint32(o+4) === 0x45786966) return readTiff(v, o+10);
    if (mk === 0xFFDA) return null;
    o += 2 + len;
  }
  return null;
}
function readTiff(v, t){
  const le = v.getUint16(t) === 0x4949;
  const u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
  const SZ = [0,1,1,2,4,8,1,1,2,4,8,4,8];
  const ifd = p => { const n = u16(p), out = {}; for (let i=0;i<n;i++){ const e=p+2+i*12, tag=u16(e), type=u16(e+2), cnt=u32(e+4); const sz=(SZ[type]||1)*cnt; out[tag]={type,cnt,vp: sz>4 ? t+u32(e+8) : e+8}; } return out; };
  const str = x => { if (!x) return null; let s=""; for (let i=0;i<x.cnt;i++){ const c=v.getUint8(x.vp+i); if (!c) break; s+=String.fromCharCode(c);} return s.trim(); };
  const rat = (x,i) => { const p=x.vp+i*8, d=u32(p+4); return d ? u32(p)/d : 0; };
  const dms = x => x && x.cnt >= 3 ? rat(x,0) + rat(x,1)/60 + rat(x,2)/3600 : null;
  const r = {};
  const i0 = ifd(t + u32(t+4));
  r.make = str(i0[0x010F]); r.model = str(i0[0x0110]); r.dt0 = str(i0[0x0132]);
  if (i0[0x8769]){ const ex = ifd(t + u32(i0[0x8769].vp)); r.dto = str(ex[0x9003]) || str(ex[0x9004]); r.off = str(ex[0x9011]) || str(ex[0x9012]) || str(ex[0x9010]); }
  if (i0[0x8825]){
    const g = ifd(t + u32(i0[0x8825].vp));
    const la = dms(g[2]), lo = dms(g[4]);
    if (la != null && lo != null && (la || lo)){ r.lat = (str(g[1])==="S"?-1:1)*la; r.lng = (str(g[3])==="W"?-1:1)*lo; }
    const gd = str(g[0x1D]);
    if (gd && g[7]){ const m = /^(\d{4}):(\d\d):(\d\d)/.exec(gd); if (m) r.gpsUtc = Date.UTC(+m[1],m[2]-1,+m[3]) + Math.round((rat(g[7],0)*3600 + rat(g[7],1)*60 + rat(g[7],2))*1000); }
  }
  return r;
}
/* Métadonnées brutes -> { lat, lng, at (ms UTC), timeSrc, device }.
   tz : fuseau du voyage, pour une heure de photo sans fuseau. */
export function interpretMeta(r, tz){
  r = r || {};
  let at = null, timeSrc = null;
  if (r.dto){ at = parseExifDate(tz, r.dto, r.off); timeSrc = r.off ? "photo (avec fuseau)" : "photo"; }
  if (at == null && r.gpsUtc){ at = r.gpsUtc; timeSrc = "GPS"; }
  if (at == null && r.dt0){ at = parseExifDate(tz, r.dt0, r.off); timeSrc = "photo"; }
  // Heure de l'appareil restée sur un autre fuseau : l'heure GPS (UTC) fait foi.
  if (at != null && r.gpsUtc && Math.abs(at - r.gpsUtc) > 30*60000 && Math.abs(at - r.gpsUtc) < 15*3600000 && !r.off){ at = r.gpsUtc; timeSrc = "GPS"; }
  return { lat: Number.isFinite(r.lat) ? r.lat : null, lng: Number.isFinite(r.lng) ? r.lng : null, at, timeSrc,
    device: [r.make, r.model].filter(Boolean).join(" ").slice(0,60) };
}
/* Lecture sur le fichier original (avant compression). exifr (global) en secours pour HEIC & co. */
export async function readMeta(file, tz){
  let r = null;
  try { r = readJpegExif(await file.slice(0, 524288).arrayBuffer()); } catch(_){}
  const exifr = globalThis.exifr;
  if (!r && exifr){
    try {
      const x = await exifr.parse(file, {tiff:true, exif:true, gps:true, reviveValues:false, translateValues:false});
      if (x){
        r = {dto: x.DateTimeOriginal || x.CreateDate, off: x.OffsetTimeOriginal || x.OffsetTime, make:x.Make, model:x.Model, dt0:x.ModifyDate};
        const g = await exifr.gps(file).catch(() => null);
        if (g && Number.isFinite(g.latitude) && (g.latitude || g.longitude)){ r.lat = g.latitude; r.lng = g.longitude; }
        if (x.GPSDateStamp && Array.isArray(x.GPSTimeStamp)){
          const m = /^(\d{4}):(\d\d):(\d\d)/.exec(x.GPSDateStamp), ts = x.GPSTimeStamp;
          if (m) r.gpsUtc = Date.UTC(+m[1], m[2]-1, +m[3]) + Math.round((ts[0]*3600 + ts[1]*60 + ts[2])*1000);
        }
      }
    } catch(_){}
  }
  return interpretMeta(r, tz);
}
