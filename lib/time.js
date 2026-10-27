/* Heures : de l'heure murale d'un fuseau (ex. Europe/Malta) vers un instant UTC, et inversement. */
const partsCache = new Map();
function partsFmt(tz){
  if (!partsCache.has(tz)) partsCache.set(tz, new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}));
  return partsCache.get(tz);
}
export function wallParts(tz, utcMs){
  return Object.fromEntries(partsFmt(tz).formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
}
/* Décalage du fuseau à un instant donné, en minutes (Malte l'été : +120). */
export function tzOffsetMin(tz, utcMs){
  const p = wallParts(tz, utcMs);
  return (Date.UTC(+p.year, p.month-1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs/1000)*1000) / 60000;
}
/* Heure murale -> UTC. Avec offStr ("+02:00"), il fait foi ; sinon le fuseau tz est utilisé,
   changement d'heure compris (heure ambiguë d'octobre : on prend la seconde, heure d'hiver). */
export function wallToUtc(tz, y, mo, d, h, mi, s, offStr){
  const naive = Date.UTC(y, mo-1, d, h, mi, s);
  if (offStr && /^[+-]\d\d:?\d\d$/.test(offStr)){
    const sign = offStr[0] === "-" ? -1 : 1, hh = +offStr.slice(1,3), mm = +offStr.slice(-2);
    return naive - sign*(hh*60+mm)*60000;
  }
  const t = naive - tzOffsetMin(tz, naive)*60000;
  return naive - tzOffsetMin(tz, t)*60000;
}
export function parseExifDate(tz, str, off){
  const m = /^(\d{4}):(\d\d):(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(str || ""); if (!m) return null;
  if (+m[1] < 2000) return null;
  return wallToUtc(tz, +m[1],+m[2],+m[3],+m[4],+m[5],+m[6], off);
}
/* Valeur d'un champ datetime-local, lue dans le fuseau du voyage. */
export function toLocalInput(tz, t){
  const p = wallParts(tz, t);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function fromLocalInput(tz, s){
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s || "");
  return m ? wallToUtc(tz, +m[1],+m[2],+m[3],+m[4],+m[5],0,null) : null;
}
