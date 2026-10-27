/* Voyage interactif : plusieurs voyages, suivis sans compte avec un code d'accès ; photos ajoutées par les éditeurs. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut,
  connectAuthEmulator, signInWithCredential }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocFromServer, getDocs, setDoc, collection, onSnapshot, writeBatch, serverTimestamp, getCountFromServer, connectFirestoreEmulator, Bytes }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, OWNER_EMAIL, OWNER_NAME, emulators } from "./firebase-config.js";
import { toLocalInput, fromLocalInput } from "./lib/time.js";
import { readMeta } from "./lib/exif.js";
import { km, curve, fmtCoord, packPlace, reverseGeocode, autoPlace, loadCountry } from "./lib/geo.js";
import { loadPack, ICONS } from "./packs/index.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const NDAY = 6;
const dc = d => `var(--d${(d % NDAY)+1})`;
const SEED = { id: "malte-2026", title: "Notre voyage à Malte", country: "MLT", timezone: "Europe/Malta", status: "en cours" };
const COUNTRIES = [
  ["MLT","Malte","Europe/Malta"],["FRA","France","Europe/Paris"],["BEL","Belgique","Europe/Brussels"],["ITA","Italie","Europe/Rome"],["ESP","Espagne","Europe/Madrid"],
  ["PRT","Portugal","Europe/Lisbon"],["GRC","Grèce","Europe/Athens"],["HRV","Croatie","Europe/Zagreb"],["CYP","Chypre","Asia/Nicosia"],["CHE","Suisse","Europe/Zurich"],
  ["NLD","Pays-Bas","Europe/Amsterdam"],["LUX","Luxembourg","Europe/Luxembourg"],["DEU","Allemagne","Europe/Berlin"],["AUT","Autriche","Europe/Vienna"],["GBR","Royaume-Uni","Europe/London"],
  ["IRL","Irlande","Europe/Dublin"],["ISL","Islande","Atlantic/Reykjavik"],["NOR","Norvège","Europe/Oslo"],["SWE","Suède","Europe/Stockholm"],["DNK","Danemark","Europe/Copenhagen"],
  ["FIN","Finlande","Europe/Helsinki"],["POL","Pologne","Europe/Warsaw"],["CZE","Tchéquie","Europe/Prague"],["HUN","Hongrie","Europe/Budapest"],["SVN","Slovénie","Europe/Ljubljana"],
  ["MNE","Monténégro","Europe/Podgorica"],["ALB","Albanie","Europe/Tirane"],["TUR","Turquie","Europe/Istanbul"],["MAR","Maroc","Africa/Casablanca"],["TUN","Tunisie","Africa/Tunis"],
  ["EGY","Égypte","Africa/Cairo"],["JOR","Jordanie","Asia/Amman"],["USA","États-Unis","America/New_York"],["CAN","Canada","America/Toronto"],["MEX","Mexique","America/Mexico_City"],
  ["JPN","Japon","Asia/Tokyo"],["THA","Thaïlande","Asia/Bangkok"],["VNM","Viêt Nam","Asia/Ho_Chi_Minh"],["IDN","Indonésie","Asia/Jakarta"],["AUS","Australie","Australia/Sydney"],
  ["NZL","Nouvelle-Zélande","Pacific/Auckland"],["ZAF","Afrique du Sud","Africa/Johannesburg"],["BRA","Brésil","America/Sao_Paulo"],["ARG","Argentine","America/Argentina/Buenos_Aires"],["PER","Pérou","America/Lima"]
];

/* ---------- Firebase ---------- */
const configured = !String(firebaseConfig.apiKey || "").startsWith("REMPLACER");
let fb = null, auth = null, db = null;
if (configured){
  fb = initializeApp(firebaseConfig);
  auth = getAuth(fb); auth.languageCode = "fr";
  db = getFirestore(fb);
  if (emulators?.host){
    const h = emulators.host;
    connectAuthEmulator(auth, `http://${h}:9099`, {disableWarnings:true});
    connectFirestoreEmulator(db, h, 8080);
    // Connexion « Google » simulée, pour les tests automatiques avec l'émulateur uniquement.
    window.__viTestSignIn = email => signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({sub: email, email, email_verified: true})));
  }
}
let user = null, isEditor = false, editorEmails = [];
const isGoogle = u => !!u && !u.isAnonymous && u.providerData.some(p => p.providerId === "google.com");
async function refreshRole(){
  isEditor = false; editorEmails = [];
  if (!isGoogle(user)) return;
  try {
    const s = await getDoc(doc(db, "config/editors"));
    isEditor = true; editorEmails = s.exists() ? (s.data().emails || []) : [];
  } catch(_){ isEditor = false; }
}
let authReadyResolve; const authReady = new Promise(r => authReadyResolve = r);
let firstAuth = true, gateBusy = false;
if (configured){
  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, async u => {
    user = u; await refreshRole();
    if (firstAuth){ firstAuth = false; authReadyResolve(); return; }
    if (!gateBusy) route(true);
  });
}
async function editorSignIn(){
  const p = new GoogleAuthProvider(); p.setCustomParameters({prompt:"select_account"});
  try { await signInWithPopup(auth, p); }
  catch(e){
    if (["auth/popup-blocked","auth/operation-not-supported-in-this-environment","auth/cancelled-popup-request"].includes(e?.code)) return signInWithRedirect(auth, p);
    if (e?.code !== "auth/popup-closed-by-user") toast("La connexion Google a échoué. Vérifie que ce site est autorisé dans Firebase.");
    return;
  }
  await refreshRole();
  if (!isEditor){
    toast("Ce compte Google n'est pas éditeur. Pour suivre un voyage, utilise son code.");
    await signOut(auth);
  }
}
document.addEventListener("click", e => {
  const a = e.target.closest("[data-action]"); if (!a) return;
  if (a.dataset.action === "editor-signin") editorSignIn();
  if (a.dataset.action === "signout") signOut(auth).then(() => { location.hash = "#/"; });
});

let toastTimer = null;
function toast(t){ const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 4200); }
function setMsg(id, t, kind){ const m = $(id); m.hidden = !t; m.textContent = t || ""; m.classList.toggle("err", kind === "err"); m.classList.toggle("ok", kind === "ok"); }

/* ---------- Mémoire de l'appareil : voyages rejoints ---------- */
function joined(){ try { return JSON.parse(localStorage.getItem("vi.joined") || "[]"); } catch(_){ return []; } }
function remember(id, t){
  try {
    const l = joined().filter(x => x.id !== id);
    l.unshift({id, title: t?.title || id, startDate: t?.startDate || "", endDate: t?.endDate || "", status: t?.status || "", country: t?.country || ""});
    localStorage.setItem("vi.joined", JSON.stringify(l.slice(0, 30)));
  } catch(_){}
}
function forget(id){ try { localStorage.setItem("vi.joined", JSON.stringify(joined().filter(x => x.id !== id))); } catch(_){} }

/* ---------- Petites aides ---------- */
const normCode = s => String(s || "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9-]/g, "");
const codeOk = c => /^[A-Z0-9-]{6,40}$/.test(c);
function genCode(prefix){
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(6));
  const tail = [...r].map(x => A[x % A.length]).join("");
  const p = normCode(prefix).replace(/-/g, "").slice(0, 6);
  return p ? `${p}-${tail}` : tail;
}
const slugify = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const idOk = s => /^[a-z0-9][a-z0-9-]{1,39}$/.test(s);
function fmtDates(t){
  const f = new Intl.DateTimeFormat("fr-BE", {day:"numeric", month:"long", year:"numeric", timeZone:"UTC"});
  const d = s => s ? new Date(s + "T12:00:00Z") : null;
  const a = d(t.startDate), b = d(t.endDate);
  if (a && b) return f.formatRange ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`;
  return a ? `Dès le ${f.format(a)}` : b ? `Jusqu'au ${f.format(b)}` : "";
}
const shareLink = id => `${location.origin}${location.pathname}#/v/${encodeURIComponent(id)}`;
function fillDatalists(){
  $("dl-countries").innerHTML = COUNTRIES.map(([c,n]) => `<option value="${c}">${esc(n)}</option>`).join("");
  let tzs = []; try { tzs = Intl.supportedValuesOf("timeZone"); } catch(_){ tzs = COUNTRIES.map(c => c[2]); }
  $("dl-timezones").innerHTML = tzs.map(z => `<option value="${esc(z)}">`).join("");
}
const tzValid = tz => { try { new Intl.DateTimeFormat("en", {timeZone: tz}); return true; } catch(_){ return false; } };
function tzForCountry(iso){ return COUNTRIES.find(c => c[0] === iso)?.[2] || ""; }

/* Décodage d'image (createImageBitmap, sinon <img> : Safari lit le HEIC) et réduction en JPEG. */
async function decodeImage(file){
  try { const b = await createImageBitmap(file, {imageOrientation:"from-image"}); return {src:b, w:b.width, h:b.height, done:() => b.close?.()}; } catch(_){}
  const url = URL.createObjectURL(file), img = new Image();
  img.src = url;
  try { await img.decode(); } catch(_){ URL.revokeObjectURL(url); throw new Error("format"); }
  return {src:img, w:img.naturalWidth, h:img.naturalHeight, done:() => URL.revokeObjectURL(url)};
}
async function toJpeg(im, max, q){
  const k = Math.min(1, max / Math.max(im.w, im.h));
  const c = document.createElement("canvas"); c.width = Math.round(im.w*k); c.height = Math.round(im.h*k);
  c.getContext("2d").drawImage(im.src, 0, 0, c.width, c.height);
  const b = await new Promise(r => c.toBlob(r, "image/jpeg", q));
  if (!b) throw new Error("format");
  return b;
}
/* Les photos sont rangées dans Firestore (forfait gratuit, sans Storage) : un document fait au plus 1 Mio.
   On réduit la qualité, puis la taille, jusqu'à passer sous la limite. */
async function jpegUnder(im, max, limit, q = .85){
  for (let size = max; size >= Math.min(max, 320); size = Math.round(size * .85)){
    for (let qq = q; qq >= .55; qq -= .1){
      const b = await toJpeg(im, size, qq);
      if (b.size <= limit) return b;
    }
  }
  throw new Error("format");
}
const toBytes = async b => Bytes.fromUint8Array(new Uint8Array(await b.arrayBuffer()));
/* Bytes Firestore -> adresse d'image locale, gardée en mémoire. */
const imgCache = new Map();
function imgUrl(key, bytes){
  if (!bytes?.toUint8Array) return null;
  const u8 = bytes.toUint8Array(), c = imgCache.get(key);
  if (c && c.n === u8.length) return c.url;
  if (c) URL.revokeObjectURL(c.url);
  const url = URL.createObjectURL(new Blob([u8], {type:"image/jpeg"}));
  imgCache.set(key, {n: u8.length, url});
  return url;
}
/* Photo en grand : chargée à la demande depuis trips/{id}/photos/{stop}. */
const fullLoads = new Map();
function fullPhoto(tripId, stopId){
  const k = `${tripId}/${stopId}`;
  if (!fullLoads.has(k)) fullLoads.set(k, getDoc(doc(db, `trips/${tripId}/photos/${stopId}`))
    .then(s => s.exists() ? imgUrl("full:" + k, s.data().data) : null)
    .catch(() => { fullLoads.delete(k); return null; }));
  return fullLoads.get(k);
}

/* ---------- Routeur ---------- */
const SCREENS = ["screen-home", "screen-gate", "screen-trip", "screen-admin"];
function show(id){
  $("boot").hidden = true;
  SCREENS.forEach(s => $(s).hidden = s !== id);
  $("fab").hidden = !(id === "screen-trip" && isEditor && T.trip);
}
function parseHash(){
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "v" && parts[1]) return {name: parts[2] === "admin" ? "admin" : "trip", id: parts[1]};
  return {name:"home"};
}
let routeSeq = 0;
async function route(authChanged){
  if (!configured){ $("boot-text").textContent = "Firebase n'est pas encore configuré : remplis firebase-config.js."; $("boot").querySelector(".spinner").hidden = true; return; }
  await authReady;
  const seq = ++routeSeq, r = parseHash();
  if (r.name !== "trip") closeTrip();
  if (r.name === "home") return renderHome(seq);
  if (r.name === "admin") return renderAdmin(r.id, seq);
  return openTrip(r.id, seq, authChanged);
}
window.addEventListener("hashchange", () => route(false));

/* =================================================================== */
/* Accueil                                                             */
/* =================================================================== */
function renderAccount(el){
  if (isEditor) el.innerHTML = `<small title="${esc(user.email)}">${esc(user.email)}</small><button class="btn ghost" type="button" data-action="signout">Se déconnecter</button>`;
  else el.innerHTML = `<button class="linkbtn" type="button" data-action="editor-signin">Je suis éditeur</button>`;
}
function tripCard(t, count){
  const status = t.status === "terminé" ? '<span class="pill done">Terminé</span>' : t.status ? '<span class="pill live">En cours</span>' : "";
  const meta = [fmtDates(t), count != null ? `${count} photo${count>1?"s":""}` : ""].filter(Boolean).join(" · ");
  return `<a class="tcard" href="#/v/${encodeURIComponent(t.id)}">
    <div class="cover">${coverSrc(t) ? `<img src="${coverSrc(t)}" alt="" loading="lazy">` : `<span class="iso">${esc(t.country || "")}</span>`}${status}</div>
    <div class="body"><h2>${esc(t.title || t.id)}</h2>${t.subtitle ? `<div class="meta">${esc(t.subtitle)}</div>` : ""}<div class="meta">${esc(meta)}</div></div></a>`;
}
const coverSrc = t => imgUrl("cover:" + t.id, t.cover);
async function renderHome(seq){
  document.title = "Voyage interactif";
  show("screen-home");
  renderAccount($("home-account"));
  $("home-editor-actions").hidden = !isEditor;
  $("join-form").hidden = isEditor;
  const el = $("home-cards");
  if (isEditor){
    $("home-sub").textContent = "Tous les voyages";
    el.innerHTML = `<div class="muted">Chargement des voyages…</div>`;
    let trips = [];
    try { trips = (await getDocs(collection(db, "trips"))).docs.map(d => ({id:d.id, ...d.data()})); }
    catch(_){ if (seq === routeSeq) el.innerHTML = `<div class="empty"><strong>Impossible de lire les voyages</strong>Vérifie les règles Firestore publiées.</div>`; return; }
    if (seq !== routeSeq) return;
    trips.sort((a,b) => String(b.startDate || "").localeCompare(String(a.startDate || "")) || (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    const counts = await Promise.all(trips.map(t => getCountFromServer(collection(db, `trips/${t.id}/stops`)).then(s => s.data().count).catch(() => null)));
    if (seq !== routeSeq) return;
    el.innerHTML = trips.map((t,i) => tripCard(t, counts[i])).join("") +
      (trips.some(t => t.id === SEED.id) ? "" : `<button class="tcard ghost" type="button" id="seed-card"><div class="body"><h2>Créer « ${esc(SEED.title)} »</h2><div class="meta">Le premier voyage : Malte, fuseau Europe/Malta. Tu choisiras les dates et le code.</div></div></button>`);
    $("seed-card")?.addEventListener("click", () => openNewTrip(SEED));
    if (!trips.length && !$("seed-card")) el.innerHTML = `<div class="empty"><strong>Aucun voyage</strong>Crée le premier avec « Nouveau voyage ».</div>`;
  } else {
    $("home-sub").textContent = "Nos carnets de voyage, en direct";
    const list = joined();
    el.innerHTML = list.length ? list.map(t => tripCard(t)).join("") : "";
    // Rafraîchit titres et couvertures si l'accès est toujours valable.
    // Rafraîchit titres et couvertures si l'accès est toujours valable.
    if (user && list.length){
      const fresh = await Promise.all(list.map(t => getDoc(doc(db, "trips", t.id)).then(s => s.exists() ? {id:t.id, ...s.data()} : t).catch(() => t)));
      if (seq !== routeSeq) return;
      fresh.forEach(t => remember(t.id, t));
      el.innerHTML = fresh.map(t => tripCard(t)).join("");
    }
  }
}
$("join-form").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("join-input").value.trim();
  const m = /#\/v\/([^/?#\s]+)/.exec(v);
  const id = m ? decodeURIComponent(m[1]) : v.toLowerCase();
  if (!idOk(id)){ setMsg("join-msg", "Ce lien n'est pas reconnu. Colle le lien complet reçu par message.", "err"); return; }
  if (!m && /^[A-Z0-9-]+$/.test(v) && /\d/.test(v) && !/-\d{4}$/.test(v)){
    setMsg("join-msg", "On dirait un code : ouvre d'abord le lien du voyage, le code se tape juste après.", "err"); return;
  }
  setMsg("join-msg", ""); $("join-input").value = "";
  location.hash = `#/v/${encodeURIComponent(id)}`;
});

/* ---------- Nouveau voyage ---------- */
let ntIdTouched = false;
function openNewTrip(seed){
  $("nt-form").reset(); ntIdTouched = false; setMsg("nt-msg", "");
  if (seed){
    $("nt-title").value = seed.title; $("nt-country").value = seed.country; $("nt-timezone").value = seed.timezone;
    $("nt-id").value = seed.id; ntIdTouched = true;
  } else $("nt-timezone").value = "";
  $("nt-code").value = genCode(seed?.country || "");
  $("nt-id-echo").textContent = $("nt-id").value || "…";
  $("newtrip").hidden = false; $("nt-title").focus();
}
$("btn-newtrip").onclick = () => openNewTrip(null);
document.querySelectorAll('[data-close="newtrip"]').forEach(b => b.onclick = () => $("newtrip").hidden = true);
const ntAutoId = () => {
  if (ntIdTouched) return;
  const y = ($("nt-start").value || "").slice(0,4) || String(new Date().getFullYear());
  const base = slugify($("nt-title").value.replace(/^(notre|nos|mon|ma|mes)\s+(voyage|vacances|séjour)\s+(à|au|aux|en)\s+/i, ""));
  $("nt-id").value = base ? `${base}-${y}`.slice(0, 40) : "";
  $("nt-id-echo").textContent = $("nt-id").value || "…";
};
$("nt-title").addEventListener("input", ntAutoId);
$("nt-start").addEventListener("change", ntAutoId);
$("nt-id").addEventListener("input", () => { ntIdTouched = true; $("nt-id-echo").textContent = $("nt-id").value || "…"; });
$("nt-country").addEventListener("change", () => {
  const c = $("nt-country").value = $("nt-country").value.toUpperCase();
  if (!$("nt-timezone").value) $("nt-timezone").value = tzForCountry(c);
});
$("nt-gen").onclick = () => $("nt-code").value = genCode($("nt-country").value);
$("nt-form").addEventListener("submit", async e => {
  e.preventDefault();
  const title = $("nt-title").value.trim(), id = $("nt-id").value.trim(), country = $("nt-country").value.trim().toUpperCase();
  const timezone = $("nt-timezone").value.trim(), code = normCode($("nt-code").value);
  if (!title) return setMsg("nt-msg", "Indique un titre.", "err");
  if (!/^[A-Z]{3}$/.test(country)) return setMsg("nt-msg", "Le pays s'écrit en code ISO à 3 lettres (MLT, FRA, ITA…).", "err");
  if (!timezone || !tzValid(timezone)) return setMsg("nt-msg", "Fuseau horaire inconnu (exemple : Europe/Malta).", "err");
  if (!idOk(id)) return setMsg("nt-msg", "L'identifiant ne peut contenir que des minuscules, chiffres et tirets.", "err");
  if (!codeOk(code)) return setMsg("nt-msg", "Le code doit faire au moins 6 caractères (lettres, chiffres, tirets).", "err");
  $("nt-submit").disabled = true; setMsg("nt-msg", "Création…");
  try {
    if ((await getDoc(doc(db, "trips", id))).exists()){ setMsg("nt-msg", "Un voyage porte déjà cet identifiant.", "err"); $("nt-submit").disabled = false; return; }
    const b = writeBatch(db);
    b.set(doc(db, "trips", id), { title, subtitle: $("nt-subtitle").value.trim(), country, timezone,
      startDate: $("nt-start").value || "", endDate: $("nt-end").value || "", status: "en cours",
      createdAt: serverTimestamp(), owner: user.uid });
    b.set(doc(db, `trips/${id}/codes/${code}`), {});
    await b.commit();
    $("newtrip").hidden = true;
    toast(`Voyage créé. Code d'accès : ${code}`);
    location.hash = `#/v/${encodeURIComponent(id)}`;
  } catch(_){ setMsg("nt-msg", "La création a échoué. Vérifie ta connexion et les règles Firestore.", "err"); }
  $("nt-submit").disabled = false;
});

/* =================================================================== */
/* Accès avec code                                                     */
/* =================================================================== */
let gateTrip = null;
function showGate(id, msg){
  gateTrip = id; document.title = "Voyage interactif";
  show("screen-gate"); setMsg("gate-msg", msg || "", msg ? "err" : null);
  $("gate-code").value = ""; setTimeout(() => $("gate-code").focus(), 50);
}
$("gate-form").addEventListener("submit", async e => {
  e.preventDefault();
  const code = normCode($("gate-code").value);
  const wrong = `Ce code n'est pas le bon. Vérifie-le auprès de ${OWNER_NAME}.`;
  if (code.length < 4) return setMsg("gate-msg", wrong, "err");
  $("gate-submit").disabled = true; setMsg("gate-msg", "Vérification…");
  gateBusy = true;
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
    await setDoc(doc(db, `trips/${gateTrip}/members/${auth.currentUser.uid}`), { code, joinedAt: serverTimestamp() });
    setMsg("gate-msg", "");
    $("gate-submit").disabled = false; gateBusy = false;
    return openTrip(gateTrip, ++routeSeq, true);
  } catch(err){
    setMsg("gate-msg", err?.code === "permission-denied" ? wrong
      : err?.code === "auth/admin-restricted-operation" || err?.code === "auth/operation-not-allowed" ? "L'accès visiteur n'est pas encore activé (connexion anonyme dans Firebase)."
      : "Impossible de vérifier le code. Vérifie la connexion internet.", "err");
  }
  gateBusy = false;
  $("gate-submit").disabled = false;
});

/* =================================================================== */
/* Voyage : carte et carnet                                            */
/* =================================================================== */
const T = { id:null, trip:null, tz:"UTC", F:null, pack:null, map:null, layers:null, streets:null, streetsOn:false, home:null,
  unsubs:[], photos:[], groups:[], filterDay:null, activeGroup:null, replaying:false, loaded:false, autoNames:{} };

function makeFmts(tz){
  return {
    dayKey: new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}),
    dayLabel: new Intl.DateTimeFormat("fr-BE",{timeZone:tz,weekday:"long",day:"numeric",month:"long"}),
    chip: new Intl.DateTimeFormat("fr-BE",{timeZone:tz,weekday:"short",day:"numeric",month:"short"}),
    time: new Intl.DateTimeFormat("fr-BE",{timeZone:tz,hour:"2-digit",minute:"2-digit"}),
    full: new Intl.DateTimeFormat("fr-BE",{timeZone:tz,weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})
  };
}
function closeTrip(){
  T.unsubs.forEach(u => { try { u(); } catch(_){} }); T.unsubs = [];
  stopReplay(true);
  if (T.map){ T.map.remove(); T.map = null; }
  $("lb").hidden = true; $("add").hidden = true;
  Object.assign(T, { id:null, trip:null, photos:[], groups:[], filterDay:null, activeGroup:null, loaded:false, autoNames:{}, streetsOn:false });
}

async function openTrip(id, seq, force){
  if (!idOk(id)){ location.hash = "#/"; return; }
  if (T.id === id && T.map && !force){ show("screen-trip"); setTimeout(() => T.map?.invalidateSize(), 0); return; }
  closeTrip();
  if (!user) return showGate(id);
  let snap;
  try { snap = await getDoc(doc(db, "trips", id)); }
  catch(err){
    if (seq !== routeSeq) return;
    if (err?.code === "permission-denied"){ return showGate(id); }
    $("boot").hidden = false; $("boot-text").textContent = "Connexion impossible. Vérifie internet puis recharge la page."; return;
  }
  if (seq !== routeSeq) return;
  if (!snap.exists()){
    if (isEditor){ show("screen-home"); $("home-cards").innerHTML = `<div class="empty"><strong>Ce voyage n'existe pas encore</strong>${id === SEED.id ? `<button class="btn primary" type="button" id="seed-now" style="margin-top:10px">Créer « ${esc(SEED.title)} »</button>` : "Crée-le depuis l'accueil."}</div>`; $("seed-now")?.addEventListener("click", () => openNewTrip(SEED)); return; }
    forget(id); return showGate(id);
  }
  T.id = id; setTrip(snap.data());
  if (!isEditor) remember(id, T.trip);
  show("screen-trip");
  await buildMap();
  if (seq !== routeSeq || T.id !== id) return;
  render(false);
  T.unsubs.push(onSnapshot(doc(db, "trips", id), s => {
    if (!s.exists()) return;
    const prevTz = T.tz; setTrip(s.data());
    if (!isEditor) remember(id, T.trip);
    if (prevTz !== T.tz) render(false); else renderStatus();
  }, () => {}));
  let first = true;
  T.unsubs.push(onSnapshot(collection(db, `trips/${id}/stops`), snap => {
    T.photos = snap.docs.map(s => { const d = s.data(); return {id:s.id, ...d, thumbUrl: imgUrl("thumb:" + s.id, d.thumb), hasPhoto: !!d.hasPhoto}; }).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng) && Number.isFinite(s.at));
    T.loaded = true;
    const grew = !first && snap.docChanges().some(ch => ch.type === "added");
    const keep = T.activeGroup;
    render(first || (grew && !T.replaying && $("lb").hidden));
    if (keep && !$("lb").hidden){
      const g = T.groups.find(x => x.id === keep) || T.groups.find(x => x.items.some(it => it.id === keep));
      if (g){ T.activeGroup = g.id; if ($("lb-edit").hidden) drawLb(); } else closeLb();
    }
    first = false;
    fillMissingNames();
  }, err => {
    T.loaded = true; render(false);
    if (err?.code === "permission-denied") revoked(id);
  }));
  // Un écouteur déjà ouvert n'est pas coupé quand l'accès est retiré : on revérifie auprès du serveur.
  if (!isEditor){
    const check = () => { if (T.id === id && document.visibilityState === "visible" && auth.currentUser)
      getDocFromServer(doc(db, `trips/${id}/members/${auth.currentUser.uid}`))
        .then(s => { if (!s.exists()) revoked(id); })
        .catch(err => { if (err?.code === "permission-denied") revoked(id); }); };
    const timer = setInterval(check, 120000);
    document.addEventListener("visibilitychange", check);
    T.unsubs.push(() => { clearInterval(timer); document.removeEventListener("visibilitychange", check); });
  }
}
function revoked(id){
  if (T.id !== id) return;
  forget(id); closeTrip(); showGate(id, "Ton accès à ce voyage a été retiré. Entre à nouveau le code.");
}
function setTrip(t){
  T.trip = t;
  const tz = t.timezone && tzValid(t.timezone) ? t.timezone : (tzForCountry(t.country) || "UTC");
  if (tz !== T.tz || !T.F){ T.tz = tz; T.F = makeFmts(tz); }
  $("trip-title").textContent = t.title || "Voyage";
  document.title = `${t.title || "Voyage"} · Voyage interactif`;
  $("btn-admin").hidden = !isEditor; $("btn-admin").href = `#/v/${encodeURIComponent(T.id)}/admin`;
  $("fab").hidden = !isEditor;
}

/* ---------- Fond de carte illustré ---------- */
function bboxOf(gj){
  let s = 90, w = 180, n = -90, e = -180;
  const walk = c => typeof c[0] === "number" ? (s = Math.min(s, c[1]), n = Math.max(n, c[1]), w = Math.min(w, c[0]), e = Math.max(e, c[0])) : c.forEach(walk);
  (gj.features || [gj]).forEach(f => walk((f.geometry || f).coordinates));
  return n >= s ? [[s, w], [n, e]] : null;
}
async function buildMap(){
  const [pack, country] = await Promise.all([loadPack(T.trip.country), loadCountry(T.trip.country)]);
  if (!T.id) return;
  T.pack = pack;
  const bb = country ? bboxOf(country) : null;
  const home = pack?.home || bb;
  const pad = bb ? Math.max(bb[1][0]-bb[0][0], bb[1][1]-bb[0][1]) * .6 : 0;
  const maxBounds = pack?.maxBounds || (bb ? [[bb[0][0]-pad, bb[0][1]-pad], [bb[1][0]+pad, bb[1][1]+pad]] : null);
  const map = T.map = L.map("map", {zoomControl:false, maxZoom:18, zoomSnap:.25, zoomDelta:.5, ...(maxBounds ? {maxBounds, maxBoundsViscosity:.8} : {})});
  T.home = home;
  if (home) map.fitBounds(home, {padding:[8,8]}); else map.setView([30, 10], 3);
  map.setMinZoom(pack?.minZoom ?? Math.max(2, map.getZoom() - 1.5));
  map.createPane("base").style.zIndex = 150;
  L.control.zoom({position:"bottomleft"}).addTo(map);
  L.control.scale({position:"bottomleft", imperial:false, maxWidth:110}).addTo(map);
  map.attributionControl.setPrefix(false);
  if (country) map.attributionControl.addAttribution('Contours : <a href="https://www.geoboundaries.org" target="_blank" rel="noopener">geoBoundaries</a> (CC BY 4.0)');
  map.attributionControl.addAttribution('Noms de lieux : © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>');
  if (country){
    const opt = cls => ({pane:"base", interactive:false, style:() => ({className:cls})});
    L.geoJSON(country, opt("shallow")).addTo(map);
    L.geoJSON(country, opt("shallow2")).addTo(map);
    L.geoJSON(country, opt("land")).addTo(map);
  }
  const lbl = (ll, cls, html) => L.marker(ll, {interactive:false, keyboard:false, icon:L.divIcon({className:"lbl "+cls, html:`<span>${html}</span>`, iconSize:[0,0]})}).addTo(map);
  if (pack){
    (pack.ferries || []).forEach(([a,b,bend]) => L.polyline(curve(a,b,bend), {className:"ferry", interactive:false}).addTo(map));
    (pack.labels || []).forEach(([ll,cls,t]) => lbl(ll, cls, esc(t)));
    (pack.places || []).forEach(([n,la,lo,maj]) => lbl([la,lo], "place-label"+(maj?" major":""), esc(n)));
    (pack.marks || []).forEach(([la,lo,k]) => L.marker([la,lo], {interactive:false, keyboard:false, icon:L.divIcon({className:"mark", html:ICONS[k], iconSize:[22,22], iconAnchor:[11,30]})}).addTo(map));
  }
  const syncZoom = () => { const z = map.getZoom(); $("mapwrap").classList.toggle("z-close", z >= 12); $("mapwrap").classList.toggle("z-mid", z >= 10.75); };
  map.on("zoomend", syncZoom); syncZoom();
  T.layers = { route: L.layerGroup().addTo(map), pins: L.layerGroup().addTo(map) };
  T.streets = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    subdomains:"abcd", maxZoom:20, className:"streets-tiles",
    attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
  });
  map.on("click", e => { if (picking) endPick(e.latlng); });
  setStreets(!country);
  setTimeout(() => map.invalidateSize(), 0);
}
function setStreets(on){
  T.streetsOn = on;
  if (!T.map) return;
  if (on) T.streets.addTo(T.map); else T.streets.remove();
  $("mapwrap").classList.toggle("streets", on);
  $("btn-streets").setAttribute("aria-pressed", String(on));
}
$("btn-streets").onclick = () => setStreets(!T.streetsOn);

/* ---------- Regroupement en étapes ---------- */
const dayKey = t => T.F.dayKey.format(new Date(t));
function buildGroups(){
  const ps = [...T.photos].sort((a,b) => a.at - b.at);
  const out = [];
  for (const p of ps){
    const g = out[out.length-1];
    if (g && dayKey(g.items[0].at) === dayKey(p.at) && p.at - g.items[g.items.length-1].at < 75*60000 && km(g, p) < 0.6){
      g.items.push(p);
      const n = g.items.length; g.lat = g.lat + (p.lat - g.lat)/n; g.lng = g.lng + (p.lng - g.lng)/n;
    } else out.push({ id: p.id, items: [p], lat: p.lat, lng: p.lng });
  }
  const dk = [...new Set(out.map(g => dayKey(g.items[0].at)))];
  out.forEach((g,i) => {
    g.at = g.items[0].at; g.end = g.items[g.items.length-1].at;
    g.place = g.items.find(x => x.place)?.place || T.autoNames[g.id] || "";
    g.caption = g.items.map(x => x.caption).filter(Boolean).join("\n\n");
    g.cover = g.items.find(x => x.caption && x.thumbUrl)?.thumbUrl || g.items.find(x => x.thumbUrl)?.thumbUrl || null;
    g.approx = g.items.every(x => x.approxPos);
    g.day = dk.indexOf(dayKey(g.at)); g.n = i+1;
  });
  T.groups = out;
}
const visible = () => T.filterDay == null ? T.groups : T.groups.filter(g => g.day === T.filterDay);
function byDay(list){ const m = new Map(); list.forEach(g => { if (!m.has(g.day)) m.set(g.day, []); m.get(g.day).push(g); }); return [...m.entries()]; }
function distance(list){ let d = 0; for (let i=1;i<list.length;i++) d += km(list[i-1], list[i]); return d; }
const fmtKm = d => d < 10 ? d.toFixed(1).replace(".", ",") : String(Math.round(d));

/* Noms de lieux automatiques pour les étapes sans nom : pack, sinon Nominatim.
   Un éditeur enregistre le nom trouvé dans les documents (cache) ; un visiteur le garde en mémoire. */
let naming = false;
async function fillMissingNames(){
  if (naming) return; naming = true;
  try {
    for (const g of [...T.groups]){
      if (g.place || T.autoNames[g.id] === "") continue;
      const tripId = T.id;
      const name = await autoPlace(T.pack, g.lat, g.lng);
      if (T.id !== tripId) return;
      T.autoNames[g.id] = name;
      if (name && isEditor){
        try { const b = writeBatch(db); g.items.forEach(it => b.update(doc(db, `trips/${tripId}/stops/${it.id}`), {place: name})); await b.commit(); } catch(_){}
      } else if (name){ render(false); }
    }
  } finally { naming = false; }
}

function ago(t){
  const m = Math.round((Date.now()-t)/60000);
  if (m < 1) return "à l'instant"; if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m/60); if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h/24); return `il y a ${d} jour${d>1?"s":""}`;
}

/* ---------- Rendu ---------- */
function renderStatus(){
  const st = $("status"); if (!T.trip) return;
  if (!T.loaded){ st.innerHTML = `<span class="pill calm">Chargement</span>`; return; }
  if (!T.groups.length){ st.innerHTML = `<span class="pill calm">Pas encore commencé</span>${T.trip.subtitle ? `<span>${esc(T.trip.subtitle)}</span>` : ""}`; return; }
  const lastCreated = Math.max(...T.photos.map(p => p.created || p.at));
  const live = Date.now() - lastCreated < 3*3600e3;
  const nd = new Set(T.groups.map(g => g.day)).size, d = distance(T.groups), n = T.photos.length, ng = T.groups.length;
  st.innerHTML = `${live ? '<span class="pill live">En direct</span>' : '<span class="pill calm">En différé</span>'}
    <span>${n} photo${n>1?"s":""} · ${ng} étape${ng>1?"s":""} · ${nd} jour${nd>1?"s":""} · ${fmtKm(d)} km à vol d'oiseau · ${esc(ago(lastCreated))}</span>`;
}
function renderDays(){
  const el = $("days"), ds = byDay(T.groups);
  if (ds.length < 2){ el.innerHTML = ""; el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<button class="chip" type="button" data-day="" aria-pressed="${T.filterDay==null}">Tout le voyage</button>` +
    ds.map(([d,l]) => `<button class="chip" type="button" data-day="${d}" aria-pressed="${T.filterDay===d}" style="--dc:${dc(d)}"><i></i>Jour ${d+1} · ${esc(T.F.chip.format(new Date(l[0].at)))}</button>`).join("");
}
const pinSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
function renderList(){
  const el = $("list");
  if (!T.loaded){ el.innerHTML = ""; return; }
  if (!T.groups.length){
    el.innerHTML = isEditor
      ? `<div class="empty"><strong>Le carnet est vide</strong>Appuie sur <b>Ajouter des photos</b> et choisis-les : l'heure et l'endroit sont lus dans chaque photo, il ne reste qu'à publier.</div>`
      : `<div class="empty"><strong>Le voyage n'a pas encore commencé</strong>Les photos apparaîtront ici dès qu'elles seront publiées. Garde la page ouverte, elles arrivent en direct.</div>`;
    return;
  }
  el.innerHTML = byDay(visible()).map(([d,l]) => {
    const dd = distance(l);
    return `<section class="day" style="--dc:${dc(d)}"><div class="day-head"><h2>Jour ${d+1}</h2><span>${esc(T.F.dayLabel.format(new Date(l[0].at)))}${l.length>1?` · ${fmtKm(dd)} km`:""}</span></div>
      <ol class="stops">${l.map(g => {
        const ph = g.items.filter(x => x.thumbUrl);
        const t1 = T.F.time.format(new Date(g.at)), t2 = T.F.time.format(new Date(g.end));
        const second = ph.find(x => x.thumbUrl !== g.cover);
        return `<li class="stop ${g.id===T.activeGroup?"active":""}">
        <button type="button" data-open="${esc(g.id)}">
          <span class="thumbstack">${ph.length ? `<img src="${esc(g.cover)}" alt="" loading="lazy">${ph.length>1 && second?`<img src="${esc(second.thumbUrl)}" alt="" loading="lazy">`:""}${ph.length>1?`<b>${ph.length}</b>`:""}` : `<span class="ph">${pinSvg}</span>`}</span>
          <span class="txt"><span class="when">${esc(t1)}${t2!==t1?` – ${esc(t2)}`:""}</span>
          <span class="place">${esc(g.place || "Étape")}${g.approx?'<span class="tag">position estimée</span>':""}</span>
          ${g.caption ? `<span class="cap">${esc(g.caption)}</span>` : ""}</span>
        </button></li>`;}).join("")}</ol></section>`;
  }).join("");
}
function renderMap(fit){
  if (!T.map) return;
  const vis = visible(), last = T.groups[T.groups.length-1];
  T.layers.pins.clearLayers();
  vis.forEach(g => {
    const ph = g.items.filter(x => x.thumbUrl).length;
    const cls = ["pin", ph>1?"stack":"", g.approx?"approx":"", last&&g.id===last.id?"latest":"", g.id===T.activeGroup?"active":""].join(" ");
    const html = `<div class="${cls}" style="--dc:${dc(g.day)}"><div class="card">${g.cover?`<img src="${esc(g.cover)}" alt="">`:`<div class="noimg"></div>`}</div><span class="num">${g.n}</span>${ph>1?`<span class="count">${ph}</span>`:""}</div>`;
    const m = L.marker([g.lat,g.lng], {icon:L.divIcon({className:"stop-pin", html, iconSize:[0,0]}), title:g.place||"Étape", zIndexOffset:g.n*10 + (g.id===T.activeGroup?5000:0), riseOnHover:true});
    m.on("click", () => !picking && openLb(g.id));
    m.addTo(T.layers.pins);
  });
  if (!T.replaying) drawRoutes(vis);
  const note = $("map-note");
  if (T.loaded && !T.groups.length){
    note.hidden = false;
    note.innerHTML = `<strong>${esc(T.pack?.noteTitle || T.trip.title || "Le voyage")}</strong><p>${isEditor?"Les premières photos publiées apparaîtront ici.":"Le parcours s'affichera ici au fil du voyage."}</p>`;
  } else note.hidden = true;
  if (fit && vis.length){
    if (vis.length === 1) T.map.setView([vis[0].lat,vis[0].lng], 13);
    else T.map.fitBounds(L.latLngBounds(vis.map(g=>[g.lat,g.lng])), {padding:[60,60], maxZoom:14});
  }
  $("btn-replay").disabled = vis.length < 2;
}
function drawRoutes(vis){
  T.layers.route.clearLayers();
  for (let i=1;i<vis.length;i++){
    const a = vis[i-1], b = vis[i]; if (km(a,b) < 0.05) continue;
    const pts = curve([a.lat,a.lng],[b.lat,b.lng]);
    L.polyline(pts, {className:"route-under", interactive:false}).addTo(T.layers.route);
    L.polyline(pts, {className:`route d${(b.day % NDAY)+1}`, interactive:false}).addTo(T.layers.route);
  }
}
function render(fit){ if (!T.trip) return; buildGroups(); renderStatus(); renderDays(); renderList(); renderMap(fit); }
setInterval(() => T.trip && renderStatus(), 60000);

$("days").addEventListener("click", e => {
  const b = e.target.closest("[data-day]"); if (!b) return;
  T.filterDay = b.dataset.day === "" ? null : +b.dataset.day; stopReplay();
  if (T.filterDay == null && !T.groups.length && T.home) T.map.fitBounds(T.home);
  render(true);
});
$("list").addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (b) openLb(b.dataset.open, true); });

/* ---------- Visionneuse ---------- */
let lbIdx = 0;
const curGroup = () => T.groups.find(g => g.id === T.activeGroup);
function openLb(id, fly, keepIdx){
  const g = T.groups.find(x => x.id === id); if (!g) return;
  T.activeGroup = id; if (!keepIdx) lbIdx = 0;
  lbIdx = Math.min(lbIdx, g.items.length-1);
  if (fly) T.map.flyTo([g.lat,g.lng], Math.max(T.map.getZoom(),14), {duration:.8});
  $("lb-card").style.setProperty("--dc", dc(g.day));
  drawLb(); $("lb").hidden = false; $("lb-edit").hidden = true; $("lb-nav").hidden = false;
  renderList(); renderMap(false);
}
function drawLb(){
  const g = curGroup(); if (!g) return;
  const it = g.items[lbIdx];
  $("lb-img").hidden = !it.hasPhoto;
  $("lb-img").innerHTML = it.hasPhoto ? `<img src="${esc(it.thumbUrl || "")}" alt="${esc(it.caption||g.place||"Photo du voyage")}">${g.items.length>1?`<button class="arrow l" type="button" data-step="-1" aria-label="Photo précédente">‹</button><button class="arrow r" type="button" data-step="1" aria-label="Photo suivante">›</button>`:""}` : "";
  if (it.hasPhoto){
    const tripId = T.id;
    fullPhoto(tripId, it.id).then(url => { const im = $("lb-img").querySelector("img"); if (url && im && T.id === tripId && curGroup()?.items[lbIdx]?.id === it.id) im.src = url; });
  }
  $("lb-strip").hidden = g.items.length < 2;
  $("lb-strip").innerHTML = g.items.map((x,i) => `<button type="button" data-i="${i}" aria-current="${i===lbIdx}" aria-label="Photo ${i+1}">${x.thumbUrl?`<img src="${esc(x.thumbUrl)}" alt="">`:""}</button>`).join("");
  $("lb-when").textContent = `Étape ${g.n} · Jour ${g.day+1} · ` + T.F.full.format(new Date(it.at)) + (it.approxTime ? " (heure estimée)" : "");
  $("lb-title").textContent = g.place || "Étape";
  $("lb-cap").textContent = g.caption || "";
  $("lb-coords").textContent = fmtCoord(it.lat,it.lng) + (it.approxPos ? " · position estimée d'après l'heure" : "");
  $("lb-by").textContent = [it.byName ? `Publié par ${it.byName}` : "", it.device].filter(Boolean).join(" · ");
  const vis = visible(), i = vis.findIndex(x => x.id === g.id);
  $("lb-prev").disabled = i <= 0; $("lb-next").disabled = i < 0 || i >= vis.length-1;
  $("lb-prev").dataset.id = vis[i-1]?.id || ""; $("lb-next").dataset.id = vis[i+1]?.id || "";
  $("lb-editbtn").hidden = !isEditor;
}
function closeLb(){ $("lb").hidden = true; T.activeGroup = null; if (T.trip){ renderList(); renderMap(false); } }
$("lb-close").onclick = closeLb;
$("lb").addEventListener("click", e => { if (e.target === $("lb")) closeLb(); });
const stepLb = k => { const g = curGroup(); if (!g) return; lbIdx = (lbIdx + k + g.items.length) % g.items.length; drawLb(); };
$("lb-img").addEventListener("click", e => { const b = e.target.closest("[data-step]"); if (b) stepLb(+b.dataset.step); });
$("lb-strip").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (!b) return; lbIdx = +b.dataset.i; drawLb(); });
$("lb-prev").onclick = () => $("lb-prev").dataset.id && openLb($("lb-prev").dataset.id, true);
$("lb-next").onclick = () => $("lb-next").dataset.id && openLb($("lb-next").dataset.id, true);
let touchX = null;
$("lb-img").addEventListener("touchstart", e => touchX = e.touches[0].clientX, {passive:true});
$("lb-img").addEventListener("touchend", e => { if (touchX == null) return; const dx = e.changedTouches[0].clientX - touchX; touchX = null; if (Math.abs(dx) > 40 && (curGroup()?.items.length || 0) > 1) stepLb(dx < 0 ? 1 : -1); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("add").hidden && !$("add-submit").disabled){ closeAdd(); return; }
  if (e.key === "Escape" && !$("newtrip").hidden){ $("newtrip").hidden = true; return; }
  if ($("lb").hidden || !$("lb-edit").hidden) return;
  if (e.key === "Escape") closeLb();
  if (e.key === "ArrowLeft") stepLb(-1);
  if (e.key === "ArrowRight") stepLb(1);
});

/* ---------- Modifier une étape ---------- */
let delArm = null;
const stopRef = id => doc(db, `trips/${T.id}/stops/${id}`);
async function updateEach(items, fn){
  const b = writeBatch(db); let n = 0;
  items.forEach(it => { const u = fn(it); if (Object.keys(u).length){ b.update(stopRef(it.id), u); n++; } });
  if (n) await b.commit();
}
async function deleteItems(items){
  const b = writeBatch(db);
  items.forEach(it => { b.delete(stopRef(it.id)); b.delete(doc(db, `trips/${T.id}/photos/${it.id}`)); });
  await b.commit();

}
$("lb-editbtn").onclick = () => {
  const g = curGroup(); if (!g) return;
  $("e-name").value = g.place; $("e-caption").value = g.caption; $("e-when").value = toLocalInput(T.tz, g.at);
  $("e-delphoto").hidden = g.items.length < 2 && !g.items[lbIdx]?.hasPhoto; delArm = null; setMsg("e-msg", "");
  $("e-delphoto").textContent = "Retirer cette photo"; $("e-delstop").textContent = "Supprimer l'étape";
  $("lb-edit").hidden = false; $("lb-nav").hidden = true;
};
$("e-cancel").onclick = () => { $("lb-edit").hidden = true; $("lb-nav").hidden = false; };
$("e-save").onclick = async () => {
  const g = curGroup(); if (!g) return;
  const name = $("e-name").value.trim(), cap = $("e-caption").value.trim(), t = fromLocalInput(T.tz, $("e-when").value);
  const delta = t != null ? t - g.at : 0;
  $("e-save").disabled = true; setMsg("e-msg", "Enregistrement…");
  try {
    await updateEach(g.items, it => {
      const u = {};
      if ((it.place || "") !== name) u.place = name;
      const c = it === g.items[0] ? cap : "";
      if ((it.caption || "") !== c) u.caption = c;
      if (delta){ u.at = it.at + delta; u.approxTime = false; }
      return u;
    });
    if (!name) delete T.autoNames[g.id];
    $("lb-edit").hidden = true; $("lb-nav").hidden = false; setMsg("e-msg", "");
    drawLb();
  } catch(_){ setMsg("e-msg", "L'enregistrement a échoué. Réessaie.", "err"); }
  $("e-save").disabled = false;
};
$("e-delphoto").onclick = async () => {
  if (delArm !== "photo"){ delArm = "photo"; $("e-delphoto").textContent = "Confirmer : retirer la photo"; return; }
  const g = curGroup(), it = g?.items[lbIdx]; if (!it) return;
  try {
    await deleteItems([it]); lbIdx = 0;
    if (g.items.length <= 1) closeLb(); else { $("lb-edit").hidden = true; $("lb-nav").hidden = false; }
  } catch(_){ setMsg("e-msg", "La suppression a échoué. Réessaie.", "err"); }
  delArm = null;
};
$("e-delstop").onclick = async () => {
  const g = curGroup(); if (!g) return;
  if (delArm !== "stop"){ delArm = "stop"; $("e-delstop").textContent = `Confirmer : supprimer ${g.items.length > 1 ? `les ${g.items.length} photos` : "l'étape"}`; return; }
  try { await deleteItems(g.items); closeLb(); }
  catch(_){ setMsg("e-msg", "La suppression a échoué. Réessaie.", "err"); }
  delArm = null;
};

/* ---------- Choisir un point sur la carte ---------- */
let picking = false, pickCb = null;
function startPick(text, cb){
  picking = true; pickCb = cb; $("pick-text").textContent = text;
  $("pickbar").hidden = false; $("mapwrap").classList.add("picking");
  $("mapwrap").scrollIntoView({behavior:"smooth", block:"start"});
}
function endPick(ll){ picking = false; $("pickbar").hidden = true; $("mapwrap").classList.remove("picking"); const cb = pickCb; pickCb = null; cb && cb(ll); }
$("pick-cancel").onclick = () => endPick(null);
$("e-move").onclick = () => {
  const g = curGroup(); if (!g) return;
  $("lb").hidden = true;
  startPick("Touche le nouvel emplacement de l'étape", async ll => {
    if (ll){
      try {
        const place = g.items.some(x => x.place) ? null : await autoPlace(T.pack, ll.lat, ll.lng);
        delete T.autoNames[g.id];
        await updateEach(g.items, () => ({lat:ll.lat, lng:ll.lng, approxPos:false, ...(place ? {place} : {})}));
      } catch(_){ toast("Le déplacement a échoué."); }
    }
    openLb(g.id, false, true);
  });
};

/* ---------- Ajout de photos ---------- */
let pending = [], chosen = null, nameReq = 0;
function addMsg(t, err){ setMsg("add-msg", t, err ? "err" : null); }
function fillPlaceSelect(){
  const sel = $("f-place");
  sel.innerHTML = `<option value="">Choisir un lieu…</option>` + (T.pack?.places || []).map(([n],i) => `<option value="${i}">${esc(n)}</option>`).join("");
  sel.hidden = !T.pack?.places?.length;
}
function resolvePending(){
  // Heure : photo > GPS > heure choisie (estimée)
  const fallbackAt = fromLocalInput(T.tz, $("f-when").value) ?? Date.now();
  pending.forEach((p,i) => { p.at = p.metaAt ?? (fallbackAt + i*1000); p.approxTime = p.metaAt == null; });
  // Position : photo > choix manuel > photo la plus proche dans le temps (moins de 3 h)
  const known = [...pending.filter(p => p.metaLat != null).map(p => ({at:p.at, lat:p.metaLat, lng:p.metaLng})),
    ...T.photos.filter(p => !p.approxPos).map(p => ({at:p.at, lat:p.lat, lng:p.lng}))];
  pending.forEach(p => {
    p.approxPos = false;
    if (chosen && (p.metaLat == null || chosen.all)){ p.lat = chosen.lat; p.lng = chosen.lng; return; }
    if (p.metaLat != null){ p.lat = p.metaLat; p.lng = p.metaLng; return; }
    let best = null, bd = 3*3600e3;
    known.forEach(k => { const d = Math.abs(k.at - p.at); if (d < bd){ bd = d; best = k; } });
    if (best && !p.approxTime){ p.lat = best.lat; p.lng = best.lng; p.approxPos = true; } else { p.lat = null; p.lng = null; }
  });
}
function renderAdd(){
  resolvePending();
  $("thumbs").innerHTML = pending.map(p => `<div class="thumb"><img src="${p.preview}" alt=""><div class="meta">
    <span class="${p.approxTime?"no":"ok"}">${p.approxTime?"heure ?":esc(T.F.time.format(new Date(p.at)))}</span>
    <span class="${p.lat==null?"no":p.approxPos?"est":"ok"}">${p.lat==null?"lieu ?":p.approxPos?"≈ lieu":"lieu"}</span></div>${p.sent?'<div class="done">✓</div>':""}</div>`).join("");
  const n = pending.length, withT = pending.filter(p => !p.approxTime).length, withG = pending.filter(p => p.metaLat != null).length;
  const est = pending.filter(p => p.approxPos).length, miss = pending.filter(p => p.lat == null).length;
  const src = [...new Set(pending.filter(p => p.timeSrc).map(p => p.timeSrc))].join(", ");
  $("summary").innerHTML = `
    <div class="row"><b>${withT===n?"✓":"!"}</b><span>Heure lue dans ${withT===n?"toutes les photos":`${withT} photo${withT>1?"s":""} sur ${n}`}${src?` (source : ${esc(src)})`:""}${withT<n?". Les autres prennent l'heure indiquée plus bas.":""}</span></div>
    <div class="row"><b>${withG===n?"✓":miss?"!":"≈"}</b><span>Position lue dans ${withG===n?"toutes les photos":`${withG} photo${withG>1?"s":""} sur ${n}`}${est?`, ${est} placée${est>1?"s":""} d'après la photo la plus proche dans le temps`:""}${miss?`, ${miss} sans lieu`:""}.</span></div>
    ${chosen?`<div class="row"><b>✓</b><span>Placées sur : ${esc(chosen.name || fmtCoord(chosen.lat,chosen.lng))}</span></div>`:""}`;
  $("where").hidden = !miss && !chosen;
  $("where-title").textContent = miss ? `${miss} photo${miss>1?"s":""} sans position. Où était-ce ?` : "Lieu choisi";
  $("coords").textContent = chosen ? fmtCoord(chosen.lat, chosen.lng) : "Aucune position choisie";
  if (withT < n) $("more").open = true;
  const ref = pending.find(p => p.lat != null);
  if (!$("f-name").dataset.touched){
    const auto = chosen?.name || (ref ? packPlace(T.pack, ref.lat, ref.lng) : "");
    $("f-name").value = auto;
    if (!auto && ref){
      const req = ++nameReq;
      $("name-hint").textContent = "Recherche du nom du lieu…";
      reverseGeocode(ref.lat, ref.lng).then(nm => {
        if (req !== nameReq || $("f-name").dataset.touched) return;
        $("f-name").value = nm; $("name-hint").textContent = nm ? "Trouvé automatiquement (OpenStreetMap), modifiable" : "Aucun nom trouvé, tu peux en écrire un";
      });
    }
  }
  if ($("f-name").value || !ref || $("f-name").dataset.touched) $("name-hint").textContent = $("f-name").value ? "Trouvé automatiquement, modifiable" : "Aucun lieu connu à proximité, tu peux en écrire un";
  $("add-title").textContent = n > 1 ? `${n} nouvelles photos` : "Nouvelle photo";
  $("add-submit").textContent = n > 1 ? `Publier les ${n} photos` : "Publier";
}
$("f-name").addEventListener("input", () => $("f-name").dataset.touched = "1");
$("f-when").addEventListener("change", renderAdd);
$("f-photos").addEventListener("change", async e => {
  const files = [...e.target.files]; e.target.value = "";
  if (!files.length || !T.trip) return;
  pending.forEach(p => URL.revokeObjectURL(p.preview));
  pending = []; chosen = null; $("add-form").reset(); delete $("f-name").dataset.touched; $("more").open = false;
  fillPlaceSelect();
  $("f-when").value = toLocalInput(T.tz, Date.now());
  $("add").hidden = false; $("thumbs").innerHTML = ""; $("summary").innerHTML = "Lecture des photos…"; $("where").hidden = true; addMsg("");
  $("progress").hidden = true; $("add-submit").disabled = false;
  for (const f of files){
    const m = await readMeta(f, T.tz); // sur l'original, avant toute compression
    pending.push({file:f, preview:URL.createObjectURL(f), metaLat:m.lat, metaLng:m.lng, metaAt:m.at, timeSrc:m.timeSrc, device:m.device});
  }
  pending.sort((a,b) => (a.metaAt ?? 9e15) - (b.metaAt ?? 9e15));
  renderAdd();
});
function closeAdd(){ pending.forEach(p => URL.revokeObjectURL(p.preview)); pending = []; $("add").hidden = true; $("progress").hidden = true; nameReq++; }
$("add-close").onclick = closeAdd; $("add-cancel").onclick = closeAdd;
$("f-place").addEventListener("change", () => { const p = T.pack?.places?.[$("f-place").value]; if (!p) return; chosen = {lat:p[1], lng:p[2], name:p[0], all:false}; delete $("f-name").dataset.touched; renderAdd(); });
const pickFor = all => { $("add").hidden = true; startPick(all ? "Touche l'endroit où placer toutes ces photos" : "Touche l'endroit où étaient prises ces photos", async ll => {
  if (ll){ chosen = {lat:ll.lat, lng:ll.lng, name:packPlace(T.pack, ll.lat, ll.lng), all}; $("f-place").value = ""; delete $("f-name").dataset.touched; }
  $("add").hidden = false; renderAdd(); }); };
$("btn-pick").onclick = () => pickFor(false);
$("btn-pick2").onclick = () => pickFor(true);

$("add-form").addEventListener("submit", async e => {
  e.preventDefault();
  const todo = pending.filter(p => !p.sent);
  if (!todo.length) return;
  resolvePending();
  if (todo.some(p => p.lat == null)){ addMsg("Indique où ont été prises les photos sans position (liste ou carte).", true); $("where").scrollIntoView({block:"center"}); return; }
  const caption = $("f-caption").value.trim(), typed = $("f-name").dataset.touched ? $("f-name").value.trim() : "";
  const autoName = $("f-name").value.trim();
  const tripId = T.id, firstCaption = !pending.some(p => p.sent);
  $("add-submit").disabled = true; $("progress").hidden = false;
  const bar = $("progress").firstElementChild;
  let done = 0;
  try {
    for (const p of todo){
      const i = done;
      addMsg(`Envoi de la photo ${i+1} sur ${todo.length}…`);
      const setBar = f => bar.style.width = `${((i + f) / todo.length) * 100}%`; setBar(0);
      const id = doc(collection(db, `trips/${tripId}/stops`)).id;
      const im = await decodeImage(p.file);
      let big, small;
      try { big = await jpegUnder(im, 1600, 950000); small = await jpegUnder(im, 400, 60000, .78); } finally { im.done(); }
      setBar(.3);
      // Nom : celui tapé, sinon lieu du pack proche, sinon Nominatim (mis en cache dans le document).
      const place = typed || (chosen && !p.metaLat ? chosen.name : "") || packPlace(T.pack, p.lat, p.lng)
        || (pending.length === 1 ? autoName : "") || await reverseGeocode(p.lat, p.lng) || autoName;
      const docData = { lat:p.lat, lng:p.lng, at:p.at, created:Date.now(), place, caption: firstCaption && i === 0 ? caption : "",
        thumb: await toBytes(small), hasPhoto: true, approxPos: !!p.approxPos, approxTime: !!p.approxTime, device: p.device || "",
        by: user.uid, byName: user.displayName || user.email || "" };
      // La photo et l'étape sont écrites ensemble : tout ou rien.
      const b = writeBatch(db);
      b.set(doc(db, `trips/${tripId}/photos/${id}`), { data: await toBytes(big) });
      b.set(doc(db, `trips/${tripId}/stops/${id}`), docData);
      await b.commit();
      p.sent = true; done++;
    }
    bar.style.width = "100%"; closeAdd(); T.filterDay = null;
    toast(done > 1 ? `${done} photos publiées` : "Photo publiée");
  } catch(err){
    renderAdd();
    const c = err?.code || "";
    addMsg(err?.message === "format" ? "Ce format de photo n'est pas lu par ce navigateur. Choisis la photo en JPEG."
      : c === "resource-exhausted" ? "Le quota gratuit de Firebase est atteint pour aujourd'hui. Réessaie demain."
      : c === "permission-denied" ? "Envoi refusé : ce compte n'est pas éditeur, ou les règles ne sont pas publiées."
      : `L'envoi s'est arrêté. ${done ? `${done} photo${done>1?"s":""} déjà publiée${done>1?"s":""}. ` : ""}Vérifie la connexion puis appuie à nouveau sur Publier pour envoyer les autres.`, true);
    $("add-submit").textContent = "Reprendre l'envoi";
  }
  $("add-submit").disabled = false;
});

/* ---------- Rejouer ---------- */
let replayTimer = null, rafId = null, traveller = null;
function stopReplay(silent){
  if (!T.replaying) return;
  T.replaying = false; clearTimeout(replayTimer); cancelAnimationFrame(rafId);
  traveller && traveller.remove(); traveller = null;
  $("replay-card").hidden = true; $("btn-replay").querySelector("span").textContent = "Rejouer le parcours";
  T.activeGroup = null; if (!silent) render(true);
}
$("btn-replay").onclick = () => {
  if (T.replaying) return stopReplay();
  const seq = visible(); if (seq.length < 2) return;
  const map = T.map;
  T.replaying = true; $("btn-replay").querySelector("span").textContent = "Arrêter";
  T.layers.route.clearLayers();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  traveller = L.marker([seq[0].lat,seq[0].lng], {interactive:false, icon:L.divIcon({className:"stop-pin", html:'<div class="traveller"></div>', iconSize:[0,0]}), zIndexOffset:9000}).addTo(map);
  let i = 0;
  const show = g => {
    T.activeGroup = g.id;
    const c = $("replay-card"); c.style.setProperty("--dc", dc(g.day));
    c.innerHTML = `${g.cover?`<img src="${esc(g.cover)}" alt="">`:""}<div class="rc-text"><div class="rc-when">Jour ${g.day+1} · ${esc(T.F.full.format(new Date(g.at)))}</div><div class="rc-place">${esc(g.place||"Étape")}${g.items.length>1?` · ${g.items.length} photos`:""}</div>${g.caption?`<div class="rc-cap">${esc(g.caption)}</div>`:""}</div>`;
    c.hidden = false; renderMap(false); renderList();
  };
  const next = () => {
    if (!T.replaying) return;
    if (i >= seq.length - 1){ replayTimer = setTimeout(() => stopReplay(), 2500); return; }
    const a = seq[i], b = seq[i+1], pts = curve([a.lat,a.lng],[b.lat,b.lng]);
    const line = L.polyline([pts[0]], {className:`route trace d${(b.day % NDAY)+1}`, interactive:false}).addTo(T.layers.route);
    map.flyToBounds(L.latLngBounds(pts), {padding:[80,80], maxZoom:14, duration: reduce?0:.9});
    const dur = reduce ? 0 : Math.min(2600, 900 + km(a,b)*120), t0 = performance.now() + (reduce?0:900);
    const tick = now => {
      if (!T.replaying) return;
      const t = Math.max(0, Math.min(1, (now - t0) / (dur || 1))), k = Math.floor(t*(pts.length-1));
      line.setLatLngs(pts.slice(0, k+1)); traveller.setLatLng(pts[k]);
      if (t < 1) rafId = requestAnimationFrame(tick);
      else { i++; show(b); replayTimer = setTimeout(next, b.caption ? 3200 : 2300); }
    };
    rafId = requestAnimationFrame(tick);
  };
  map.flyTo([seq[0].lat,seq[0].lng], 13.5, {duration: reduce?0:1});
  show(seq[0]); replayTimer = setTimeout(next, 2300);
};

/* =================================================================== */
/* Réglages du voyage                                                  */
/* =================================================================== */
let A = { id:null, trip:null, codes:[], coverFile:null };
async function renderAdmin(id, seq){
  if (!isEditor){ location.hash = `#/v/${encodeURIComponent(id)}`; return; }
  A = { id, trip:null, codes:[], coverFile:null };
  $("admin-back").href = `#/v/${encodeURIComponent(id)}`;
  ["a-msg","a-code-msg","a-members-msg","a-editors-msg"].forEach(m => setMsg(m, ""));
  let s;
  try { s = await getDoc(doc(db, "trips", id)); } catch(_){ s = null; }
  if (seq !== routeSeq) return;
  if (!s?.exists()){ toast("Ce voyage n'existe pas."); location.hash = "#/"; return; }
  const t = A.trip = s.data();
  document.title = `Réglages · ${t.title || id}`;
  show("screen-admin");
  $("admin-sub").textContent = t.title || id;
  $("a-title").value = t.title || ""; $("a-subtitle").value = t.subtitle || "";
  $("a-country").value = t.country || ""; $("a-timezone").value = t.timezone || "";
  $("a-start").value = t.startDate || ""; $("a-end").value = t.endDate || "";
  $("a-status").value = t.status === "terminé" ? "terminé" : "en cours";
  $("a-cover-prev").innerHTML = coverSrc({id, ...t}) ? `<img src="${coverSrc({id, ...t})}" alt="">` : "";
  $("a-share").value = shareLink(id);
  $("a-code-new").value = "";
  $("a-editors-panel").hidden = user?.email !== OWNER_EMAIL;
  $("a-editors").value = editorEmails.join("\n") || OWNER_EMAIL;
  loadCodes(); loadMembers();
}
async function loadCodes(){
  try { A.codes = (await getDocs(collection(db, `trips/${A.id}/codes`))).docs.map(d => d.id); }
  catch(_){ A.codes = []; }
  $("a-code-current").textContent = A.codes.length ? A.codes.join(" · ") : "aucun (personne ne peut entrer)";
}
async function loadMembers(){
  try { const n = (await getCountFromServer(collection(db, `trips/${A.id}/members`))).data().count;
    $("a-members").textContent = n ? `${n} appareil${n>1?"s ont":" a"} accès à ce voyage.` : "Aucun visiteur pour l'instant."; }
  catch(_){ $("a-members").textContent = "Nombre de visiteurs indisponible."; }
}
$("a-country").addEventListener("change", () => $("a-country").value = $("a-country").value.toUpperCase());
$("a-cover").addEventListener("change", e => {
  const f = e.target.files[0]; if (!f) return;
  A.coverFile = f; $("a-cover-prev").innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
  setMsg("a-msg", "Nouvelle couverture prête : appuie sur Enregistrer.");
});
$("admin-form").addEventListener("submit", async e => {
  e.preventDefault();
  const country = $("a-country").value.trim().toUpperCase(), timezone = $("a-timezone").value.trim();
  if (!$("a-title").value.trim()) return setMsg("a-msg", "Indique un titre.", "err");
  if (!/^[A-Z]{3}$/.test(country)) return setMsg("a-msg", "Le pays s'écrit en code ISO à 3 lettres.", "err");
  if (!tzValid(timezone)) return setMsg("a-msg", "Fuseau horaire inconnu (exemple : Europe/Malta).", "err");
  $("a-save").disabled = true; setMsg("a-msg", "Enregistrement…");
  try {
    const u = { title: $("a-title").value.trim(), subtitle: $("a-subtitle").value.trim(), country, timezone,
      startDate: $("a-start").value || "", endDate: $("a-end").value || "", status: $("a-status").value };
    if (A.coverFile){
      const im = await decodeImage(A.coverFile);
      let b; try { b = await jpegUnder(im, 1000, 200000, .8); } finally { im.done(); }
      u.cover = await toBytes(b);
      A.coverFile = null;
    }
    await setDoc(doc(db, "trips", A.id), u, {merge:true});
    Object.assign(A.trip, u);
    setMsg("a-msg", "Enregistré.", "ok");
  } catch(err){ setMsg("a-msg", err?.message === "format" ? "Cette image n'est pas lisible ici. Choisis un JPEG." : "L'enregistrement a échoué. Réessaie.", "err"); }
  $("a-save").disabled = false;
});
$("a-copy").onclick = async () => {
  try { await navigator.clipboard.writeText($("a-share").value); toast("Lien copié"); }
  catch(_){ $("a-share").select(); document.execCommand?.("copy"); toast("Lien copié"); }
};
$("a-code-gen").onclick = () => $("a-code-new").value = genCode(A.trip?.country || "");
$("a-code-save").onclick = async () => {
  const code = normCode($("a-code-new").value);
  if (!codeOk(code)) return setMsg("a-code-msg", "Le code doit faire au moins 6 caractères (lettres, chiffres, tirets).", "err");
  $("a-code-save").disabled = true;
  try {
    const b = writeBatch(db);
    b.set(doc(db, `trips/${A.id}/codes/${code}`), {});
    A.codes.filter(c => c !== code).forEach(c => b.delete(doc(db, `trips/${A.id}/codes/${c}`)));
    await b.commit();
    $("a-code-new").value = ""; await loadCodes();
    setMsg("a-code-msg", `Nouveau code : ${code}. L'ancien ne fonctionne plus.`, "ok");
  } catch(_){ setMsg("a-code-msg", "Le changement a échoué. Réessaie.", "err"); }
  $("a-code-save").disabled = false;
};
let kickArm = false;
$("a-kick").onclick = async () => {
  if (!kickArm){ kickArm = true; $("a-kick").textContent = "Confirmer : déconnecter tout le monde"; setTimeout(() => { kickArm = false; $("a-kick").textContent = "Déconnecter tous les visiteurs"; }, 5000); return; }
  kickArm = false; $("a-kick").textContent = "Déconnecter tous les visiteurs"; $("a-kick").disabled = true;
  try {
    const ds = (await getDocs(collection(db, `trips/${A.id}/members`))).docs;
    for (let i = 0; i < ds.length; i += 400){ const b = writeBatch(db); ds.slice(i, i+400).forEach(d => b.delete(d.ref)); await b.commit(); }
    setMsg("a-members-msg", `${ds.length} visiteur${ds.length>1?"s":""} déconnecté${ds.length>1?"s":""}. Chacun devra entrer le code à nouveau (dans les 2 minutes s'il a la page ouverte). Change aussi le code si besoin.`, "ok");
    loadMembers();
  } catch(_){ setMsg("a-members-msg", "La déconnexion a échoué. Réessaie.", "err"); }
  $("a-kick").disabled = false;
};
$("a-editors-save").onclick = async () => {
  const emails = [...new Set($("a-editors").value.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)))];
  if (!emails.includes(OWNER_EMAIL)) emails.unshift(OWNER_EMAIL);
  try { await setDoc(doc(db, "config/editors"), {emails}); editorEmails = emails; $("a-editors").value = emails.join("\n"); setMsg("a-editors-msg", "Éditeurs enregistrés.", "ok"); }
  catch(_){ setMsg("a-editors-msg", "L'enregistrement a échoué.", "err"); }
};

/* ---------- Démarrage ---------- */
fillDatalists();
route(false);
