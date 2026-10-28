// Messager des nouveautés : lancé toutes les 10 minutes par GitHub (.github/workflows/notify.yml).
// Pour chaque voyage, regroupe les photos publiées et les commentaires arrivés depuis le dernier passage,
// puis envoie une notification à chaque appareil abonné (trips/{id}/subs). Un toucher ouvre la photo concernée.
//
// Se connecte avec le compte Firebase « messager@carnet.invalid » (mot de passe dans le secret NOTIFIER_PASSWORD) :
// les règles Firestore ne lui donnent que la lecture des voyages, photos, commentaires et abonnements.
//
//   NOTIFIER_PASSWORD=… node tools/notify.mjs          (DRY=1 : affiche sans rien envoyer ni enregistrer)
import webpush from "web-push";

const API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyD69h8T9LjV-oY2jnKFyXZ6XmLBqu_iX-8";
const PROJECT = process.env.FIREBASE_PROJECT || "voyage-interactif";
const SITE = process.env.SITE_URL || "https://qtheun27.github.io/voyage-interactif/";
const EMAIL = "messager@carnet.invalid";
const AUTH = process.env.AUTH_BASE || "https://identitytoolkit.googleapis.com";
const FS = (process.env.FIRESTORE_BASE || "https://firestore.googleapis.com") + `/v1/projects/${PROJECT}/databases/(default)/documents`;
const QUIET = Number(process.env.QUIET_MS ?? 3 * 60000);   // on attend la fin d'un envoi de photos avant de prévenir
const DRY = !!process.env.DRY;

const password = process.env.NOTIFIER_PASSWORD;
if (!password){ console.log("Secret NOTIFIER_PASSWORD absent : rien à faire."); process.exit(0); }

/* ---------- Firestore par REST ---------- */
let token = "";
async function api(url, opt = {}){
  const r = await fetch(url, { ...opt, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(opt.headers || {}) } });
  if (r.status === 404) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${url.replace(FS, "")} : ${j.error?.message || ""}`);
  return j;
}
const val = v => !v ? null : "stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue
  : "booleanValue" in v ? v.booleanValue : "timestampValue" in v ? Date.parse(v.timestampValue) : "mapValue" in v ? fields(v.mapValue.fields || {})
  : "arrayValue" in v ? (v.arrayValue.values || []).map(val) : null;
const fields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, val(v)]));
const asDoc = d => ({ id: d.name.split("/").pop(), ...fields(d.fields) });
async function list(path, mask = []){
  const out = []; let page = "";
  do {
    const q = new URLSearchParams({ pageSize: "300" }); if (page) q.set("pageToken", page); mask.forEach(m => q.append("mask.fieldPaths", m));
    const j = await api(`${FS}/${path}?${q}`); (j?.documents || []).forEach(d => out.push(asDoc(d))); page = j?.nextPageToken || "";
  } while (page);
  return out;
}
/* Documents d'une collection dont un champ dépasse une valeur (requête structurée). */
async function after(parent, coll, field, value, select){
  const where = { fieldFilter: { field: { fieldPath: field }, op: "GREATER_THAN", value } };
  const j = await api(`${FS}/${parent}:runQuery`, { method: "POST", body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: coll }], where, select: { fields: select.map(f => ({ fieldPath: f })) } } }) });
  return (j || []).filter(x => x.document).map(x => asDoc(x.document));
}
const put = (path, data) => api(`${FS}/${path}`, { method: "PATCH", body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { integerValue: String(v) }])) }) });
const del = path => api(`${FS}/${path}`, { method: "DELETE" });

/* ---------- Messages ---------- */
const plural = (n, a, b) => `${n} ${n > 1 ? b : a}`;
const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
export function photosMessage(trip, items){
  const ph = items.filter(x => !x.video).length, vd = items.filter(x => x.video).length;
  const what = [ph ? plural(ph, "nouvelle photo", "nouvelles photos") : "", vd ? plural(vd, "nouvelle vidéo", "nouvelles vidéos") : ""].filter(Boolean).join(" et ");
  const sorted = [...items].sort((a, b) => a.at - b.at);
  const places = [...new Set(sorted.map(x => x.place).filter(Boolean))];
  const where = places.length > 2 ? `${places[0]}, ${places[1]}…` : places.join(", ");
  const who = [...new Set(items.map(x => (x.byName || "").split(" ")[0]).filter(Boolean))].join(" et ");
  return { title: trip.title || "Mon carnet de voyages", body: `📸 ${what}${where ? ` · ${where}` : ""}${who ? ` (${who})` : ""}`,
    url: `${SITE}#/v/${encodeURIComponent(trip.id)}/p/${encodeURIComponent(sorted[0].id)}`, tag: `photos-${trip.id}` };
}
export function commentsMessage(trip, items){
  const sorted = [...items].sort((a, b) => a.at - b.at), last = sorted[sorted.length - 1];
  const body = items.length === 1 ? `💬 ${last.name} : « ${clip(last.text || "", 110)} »`
    : `💬 ${plural(items.length, "nouveau commentaire", "nouveaux commentaires")} (${[...new Set(items.map(x => x.name))].join(", ")})`;
  return { title: trip.title || "Mon carnet de voyages", body, url: `${SITE}#/v/${encodeURIComponent(trip.id)}/p/${encodeURIComponent(last.photoId)}`, tag: `comments-${trip.id}` };
}

/* ---------- Passage ---------- */
async function main(){
  const sign = await fetch(`${AUTH}/v1/accounts:signInWithPassword?key=${API_KEY}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password, returnSecureToken: true }) }).then(r => r.json());
  if (!sign.idToken){ console.error("Connexion du messager impossible :", sign.error?.message); process.exit(1); }
  token = sign.idToken;
  const push = asDoc(await api(`${FS}/config/push`));
  webpush.setVapidDetails(push.subject || "mailto:contact@example.com", push.publicKey, push.privateKey);
  const now = Date.now();
  for (const trip of await list("trips", ["title"])){
    const state = await api(`${FS}/notify/${trip.id}`);
    // Premier passage pour ce voyage : on part de maintenant (pas d'avalanche sur l'existant).
    if (!state){ if (!DRY) await put(`notify/${trip.id}`, { lastAt: now }); console.log(`${trip.id} : départ des notifications`); continue; }
    const lastAt = Number(asDoc(state).lastAt) || now;
    const photos = (await after(`trips/${trip.id}`, "stops", "created", { integerValue: String(lastAt) }, ["created", "at", "place", "by", "byName", "video", "hasPhoto"])).filter(x => x.hasPhoto);
    const comments = await after(`trips/${trip.id}`, "comments", "at", { timestampValue: new Date(lastAt).toISOString() }, ["at", "text", "name", "uid", "photoId"]);
    const newest = Math.max(0, ...photos.map(x => x.created), ...comments.map(x => x.at));
    if (!newest) continue;
    if (now - newest < QUIET){ console.log(`${trip.id} : envoi en cours, on attend`); continue; }
    const msgs = [];
    if (photos.length) msgs.push({ msg: photosMessage(trip, photos), skip: new Set(photos.map(x => x.by)) });
    if (comments.length) msgs.push({ msg: commentsMessage(trip, comments), skip: new Set(comments.map(x => x.uid)) });
    const subs = await list(`trips/${trip.id}/subs`);
    let sent = 0, gone = 0;
    for (const s of subs){
      for (const { msg, skip } of msgs){
        if (skip.has(s.uid)) continue;            // pas de notification pour ses propres photos ou commentaires
        if (DRY){ console.log("→", s.id.slice(0, 8), JSON.stringify(msg)); sent++; continue; }
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 86400, urgency: "normal" }); sent++; }
        catch(err){ if (err.statusCode === 404 || err.statusCode === 410){ await del(`trips/${trip.id}/subs/${s.id}`); gone++; break; } else console.log("échec", err.statusCode || err.message); }
      }
    }
    if (!DRY) await put(`notify/${trip.id}`, { lastAt: newest });
    console.log(`${trip.id} : ${photos.length} photo(s), ${comments.length} commentaire(s) → ${sent} notification(s), ${gone} abonnement(s) périmé(s) retiré(s)`);
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(err => { console.error(err); process.exit(1); });
