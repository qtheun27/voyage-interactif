/* Du tas de photos au récit du voyage : des étapes (on s'arrête quelque part) reliées par des trajets
   (avion, bateau, voiture, à pied). Les photos prises en route — sur le ferry, dans l'avion, depuis la
   voiture — ne créent pas d'étape : elles dessinent le trajet. */
import { km, curve } from "./geo.js";

export const MODES = {
  plane: { label: "En avion", icon: "plane" },
  boat:  { label: "En bateau", icon: "boat" },
  car:   { label: "En voiture", icon: "car" },
  taxi:  { label: "En taxi", icon: "car" },
  bus:   { label: "En bus", icon: "bus" },
  train: { label: "En train", icon: "train" },
  bike:  { label: "À vélo", icon: "bike" },
  walk:  { label: "À pied", icon: "walk" }
};

const STOP_GAP = 75*60000, STOP_RADIUS = 0.6;     // une étape : même jour, moins de 75 min et 600 m d'écart
const SAME_PLACE = 0.15, SAME_PLACE_GAP = 5*3600e3; // ou bien au même endroit (150 m) dans les 5 h : l'hôtel le matin
const MOVING_KMH = 12, FLIGHT_KMH = 200;

/* Vitesse (km/h) entre deux photos prises à moins de maxH heures d'écart, sinon null. */
function speed(a, b, maxH = .75){
  const h = Math.abs(b.at - a.at) / 3.6e6;
  return h > 0 && h <= maxH ? km(a, b) / h : null;
}

/* Une photo est « en route » si elle est sur l'eau, si l'on roulait avant et après elle,
   ou si l'on volait avant et après elle (photo prise dans l'avion). */
export function markMoving(ps, isWater){
  ps.forEach((p, i) => {
    if (p.still || !p.hasPhoto && !p.moving) { p._moving = !!p.moving && !p.still; p._water = false; return; }
    if (p.moving) { p._moving = true; p._water = isWater(p.lat, p.lng); return; }
    const prev = ps[i-1], next = ps[i+1];
    const s1 = prev ? speed(prev, p) : null, s2 = next ? speed(p, next) : null;
    p._water = isWater(p.lat, p.lng);
    const f1 = prev ? speed(prev, p, 8) : null, f2 = next ? speed(p, next, 8) : null;
    p._moving = p._water || (s1 > MOVING_KMH && s2 > MOVING_KMH) || (f1 > FLIGHT_KMH && f2 > FLIGHT_KMH);
  });
}

/* Courbe lisse qui passe par tous les points (Catmull-Rom). */
export function smoothPath(pts){
  if (pts.length < 3) return pts.length === 2 ? curve(pts[0], pts[1], .12) : pts;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++){
    const p0 = pts[i-1] || pts[i], p1 = pts[i], p2 = pts[i+1], p3 = pts[i+2] || p2;
    for (let k = 0; k < 8; k++){
      const t = k / 8, t2 = t*t, t3 = t2*t;
      out.push([0, 1].map(j => .5 * ((2*p1[j]) + (-p0[j]+p2[j])*t + (2*p0[j]-5*p1[j]+4*p2[j]-p3[j])*t2 + (-p0[j]+3*p1[j]-3*p2[j]+p3[j])*t3)));
    }
  }
  out.push(pts[pts.length-1]);
  return out;
}

function waterShare(a, b, isWater){
  let n = 0; for (let k = 1; k < 10; k++){ const t = k/10; if (isWater(a.lat + (b.lat-a.lat)*t, a.lng + (b.lng-a.lng)*t)) n++; }
  return n / 9;
}

/* Réglages d'un trajet posés par l'éditeur : sur les photos de l'étape d'arrivée, sinon sur celles du trajet. */
export const legField = (leg, k) => leg.to?.items.find(x => x[k])?.[k] || leg.items.find(x => x[k])?.[k] || "";

export function legMode(leg, isWater){
  const { from, to, items } = leg;
  const forced = legField(leg, "arriveBy");
  if (forced && MODES[forced]) return forced;
  const a = from ? {lat: from.lat, lng: from.lng, at: from.end} : items[0];
  const b = to ? {lat: to.lat, lng: to.lng, at: to.at} : items[items.length-1];
  const direct = km(a, b), h = Math.max(1/60, (b.at - a.at) / 3.6e6), v = direct / h;
  const seq = [a, ...items, b];
  const fast = seq.some((x, i) => { const y = seq[i+1]; return y && speed(x, y, 8) > FLIGHT_KMH && km(x, y) > 50; });
  if (fast || (direct > 250 && (v > 120 || direct > 600))) return "plane";
  if (items.length && items.filter(x => x._water).length / items.length >= .5) return "boat";
  if (!items.length && from && to && direct >= 3 && waterShare(from, to, isWater) >= .75) return "boat";
  return direct >= 2 ? "car" : "walk";
}

/**
 * photos : [{id, lat, lng, at, hasPhoto, place, caption, thumbUrl, approxPos, arriveBy, moving, still, tag}]
 * opts.dayKey(t) -> "2026-10-25" ; opts.isWater(lat,lng) ; opts.inCountry(lat,lng)
 */
export function buildJourney(photos, { dayKey, isWater = () => false, inCountry = () => true, autoNames = {}, airport = null } = {}){
  let ps = [...photos].sort((a, b) => a.at - b.at);
  // Une photo étiquetée « Arrivée » mais encore située hors du pays, alors que la suite du voyage y est :
  // sa position GPS est périmée (téléphone sans signal à l'atterrissage). On l'affiche à l'aéroport d'arrivée.
  ps = ps.map((p, i) => {
    if (p.tag !== "Arrivée" || inCountry(p.lat, p.lng)) return p;
    const next = ps.slice(i + 1).find(x => inCountry(x.lat, x.lng));
    if (!next) return p;
    const to = airport || next;
    return { ...p, lat: to.lat, lng: to.lng, approxPos: true, place: airport?.name || p.place };
  });
  // Les autres photos du même moment (même minute, même position périmée) suivent l'arrivée.
  ps = ps.map(p => {
    const a = ps.find(x => x.tag === "Arrivée" && x !== p && Math.abs(x.at - p.at) < 5*60000 && x.approxPos && !inCountry(p.lat, p.lng));
    return a ? { ...p, lat: a.lat, lng: a.lng, approxPos: true, place: a.place } : p;
  });
  markMoving(ps, isWater);
  const stops = [], legs = [];
  let buf = [];
  const newStop = p => ({ kind: "stop", id: p.id, items: [p], lat: p.lat, lng: p.lng });
  // Photos rangées à la main dans une étape (stopRef = une photo de cette étape) : placées après coup.
  const placed = [];
  for (const p of ps){
    if (p.stopRef && p.stopRef !== p.id){ placed.push(p); continue; }
    if (p._moving){ buf.push(p); continue; }
    const s = stops[stops.length-1];
    const gap = s ? p.at - s.items[s.items.length-1].at : 0, d = s ? km(s, p) : 0;
    const sameDay = s && dayKey(s.items[0].at) === dayKey(p.at);
    const join = s && !buf.length && !p.splitHere && (p.joinPrev || sameDay && (gap < STOP_GAP && d < STOP_RADIUS || gap < SAME_PLACE_GAP && d < SAME_PLACE));
    if (join){
      s.items.push(p);
      const n = s.items.length; s.lat += (p.lat - s.lat)/n; s.lng += (p.lng - s.lng)/n;
      continue;
    }
    const ns = newStop(p);
    if (s || buf.length) legs.push({ kind: "leg", from: s || null, to: ns, items: buf });
    buf = []; stops.push(ns);
  }
  if (buf.length) legs.push({ kind: "leg", from: stops[stops.length-1] || null, to: null, items: buf });
  for (const p of placed){
    let t = stops.find(s => s.items.some(x => x.id === p.stopRef));
    if (!t){ t = null; let bd = Infinity; stops.forEach(s => { const d = Math.abs(s.items[0].at - p.at); if (d < bd){ bd = d; t = s; } }); }
    if (t) t.items.push(p); else stops.push(newStop(p));
  }
  if (placed.length){
    stops.forEach(s => { s.items.sort((a, b) => a.at - b.at); const fix = s.items.filter(x => !x.approxPos), src = fix.length ? fix : s.items;
      s.lat = src.reduce((a, x) => a + x.lat, 0) / src.length; s.lng = src.reduce((a, x) => a + x.lng, 0) / src.length; s.id = s.items[0].id; });
    stops.sort((a, b) => a.items[0].at - b.items[0].at);
  }

  // Étapes : heures, nom, légende, couverture, jour
  const days = [];
  stops.forEach((s, i) => {
    s.at = s.items[0].at; s.end = s.items[s.items.length-1].at;
    s.place = s.items.find(x => x.place)?.place || autoNames[s.id] || "";
    s.caption = s.items.map(x => x.caption).filter(Boolean).join("\n\n");
    s.cover = s.items.find(x => x.caption && x.thumbUrl)?.thumbUrl || s.items.find(x => x.thumbUrl)?.thumbUrl || null;
    s.approx = s.items.every(x => x.approxPos);
    s.out = !inCountry(s.lat, s.lng);
    s.n = i + 1;
  });
  const allKeys = [...new Set([...stops.map(s => dayKey(s.at)), ...legs.map(l => dayKey((l.items[0] || l.to || l.from).at))])].sort();
  const dayOf = t => allKeys.indexOf(dayKey(t));
  stops.forEach(s => { s.day = dayOf(s.at); });

  // Trajets : mode, tracé, distance
  legs.forEach(l => {
    const { from, to, items } = l;
    l.id = "leg:" + (to?.id || items[0]?.id || from.id);
    l.at = items[0]?.at ?? to?.at ?? from.end; l.end = items[items.length-1]?.at ?? to?.at ?? l.at;
    l.mode = legMode(l, isWater);
    const pts = [from, ...items, to].filter(Boolean).map(p => [p.lat, p.lng]);
    l.path = l.mode === "plane" ? curve(pts[0], pts[pts.length-1], .22) : items.length ? smoothPath(pts) : curve(pts[0], pts[pts.length-1], l.mode === "boat" ? .12 : .18);
    l.km = 0; for (let i = 1; i < pts.length; i++) l.km += km({lat: pts[i-1][0], lng: pts[i-1][1]}, {lat: pts[i][0], lng: pts[i][1]});
    l.day = dayOf(items[0]?.at ?? to?.at ?? from.end);
    l.caption = items.map(x => x.caption).filter(Boolean).join("\n\n");
    l.cover = items.find(x => x.thumbUrl)?.thumbUrl || null;
  });

  // Étiquettes : départ, arrivée, retour ; vols aller et retour
  const firstIn = stops.findIndex(s => !s.out), lastIn = stops.length - 1 - [...stops].reverse().findIndex(s => !s.out);
  stops.forEach((s, i) => {
    const forced = s.items.find(x => x.tag)?.tag;
    // « Départ » sur la première étape hors du pays, « Retour » sur la dernière.
    s.tag = forced || (firstIn < 0 ? "" : s.out && i === 0 && i < firstIn ? "Départ" : s.out && i === stops.length - 1 && i > lastIn ? "Retour" : "");
  });
  legs.forEach(l => {
    l.label = MODES[l.mode].label;
    if (l.mode === "plane"){
      const fo = l.from ? l.from.out : true, too = l.to ? l.to.out : true;
      l.label = fo && !too ? "Vol aller" : !fo && too ? "Vol retour" : "Vol";
      if (l.to && !l.to.out && fo && !l.to.items.find(x => x.tag)) l.to.tag = "Arrivée";
    }
    if (l.mode === "boat" && l.items.length) l.label = "Traversée en bateau";
    l.auto = l.label;
    const custom = legField(l, "legLabel"); if (custom) l.label = custom;
    const cap = legField(l, "legCaption"); if (cap) l.caption = cap;
    l.off = !!legField(l, "legOff");                 // supprimé : ni dans le carnet, ni sur la carte
    l.hidden = !!legField(l, "legHidden") || l.off;
  });

  // Récit : trajets et étapes dans l'ordre ; seuls les trajets marquants apparaissent dans le carnet
  const timeline = [];
  stops.forEach(s => {
    const l = legs.find(x => x.to === s); if (l) timeline.push(l);
    timeline.push(s);
  });
  const tail = legs.find(x => !x.to); if (tail) timeline.push(tail);
  legs.forEach(l => { l.notable = !l.hidden && (l.items.length > 0 || l.mode === "plane" || l.mode === "boat" || l.km > 5 || !!legField(l, "arriveBy") || !!legField(l, "legLabel")); });
  return { stops, legs, timeline, days: allKeys };
}

/* Où placer une photo sans position fiable (pas de GPS, ou GPS périmé) ?
   - entre deux photos éloignées (un vol) : sur la trajectoire si l'avion volait encore,
     à l'aéroport d'arrivée (ou au lieu suivant) s'il avait déjà atterri ;
   - sinon : la position de la photo la plus proche dans le temps (moins de 3 h).
   known : [{at, lat, lng}] triés par heure. Renvoie {lat, lng, inFlight, atArrival} ou null. */
export function estimatePosition(at, known, { airport = null, inCountry = () => true } = {}){
  const before = [...known].reverse().find(k => k.at <= at && at - k.at < 14*3600e3);
  const after = known.find(k => k.at >= at && k.at - at < 14*3600e3);
  if (before && after && after.at > before.at){
    const d = km(before, after), h = (after.at - before.at) / 3.6e6;
    if (d > 150 && d / h > 100){
      const flightH = d / 800 + .4, f = (at - before.at) / 3.6e6 / flightH;
      if (f >= .85){
        const useAirport = airport && inCountry(after.lat, after.lng) && km(airport, after) < 80;
        return { lat: useAirport ? airport.lat : after.lat, lng: useAirport ? airport.lng : after.lng, atArrival: true, place: useAirport ? airport.name : "" };
      }
      const t = Math.max(0, Math.min(1, f));
      return { lat: before.lat + (after.lat - before.lat) * t, lng: before.lng + (after.lng - before.lng) * t, inFlight: true };
    }
  }
  let best = null, bd = 3*3600e3;
  known.forEach(k => { const x = Math.abs(k.at - at); if (x < bd){ bd = x; best = k; } });
  return best ? { lat: best.lat, lng: best.lng } : null;
}
