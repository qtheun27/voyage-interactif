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
import { km, curve, fmtCoord, packPlace, reverseGeocode, searchPlaces, autoPlace, loadCountry, loadWorld, makeLand } from "./lib/geo.js";
import { buildJourney, estimatePosition, MODES } from "./lib/journey.js";
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
function toast(t, action){
  const el = $("toast"); el.textContent = t; el.hidden = false; el.classList.toggle("clickable", !!action);
  el.onclick = action ? () => { el.hidden = true; action(); } : null;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, action ? 7000 : 4200);
}
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
const T = { id:null, trip:null, tz:"UTC", F:null, pack:null, land:null, map:null, layers:null, streets:null, streetsOn:false,
  home:null, overview:false, view:"carnet", unsubs:[], photos:[], J:null, entries:[], flat:[], filterDay:null, active:null,
  loaded:false, autoNames:{}, mine:new Set() };

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
  stopStory(true);
  if (T.map){ T.map.remove(); T.map = null; }
  ["lb","add","place","hero"].forEach(id => $(id).hidden = true);
  Object.assign(T, { id:null, trip:null, photos:[], J:null, entries:[], flat:[], filterDay:null, active:null, loaded:false,
    autoNames:{}, streetsOn:false, overview:false, mine:new Set() });
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
  if (!isEditor) remember(id, {id, ...T.trip});
  show("screen-trip");
  await buildMap();
  if (seq !== routeSeq || T.id !== id) return;
  render(false);
  T.unsubs.push(onSnapshot(doc(db, "trips", id), s => {
    if (!s.exists()) return;
    const prevTz = T.tz; setTrip(s.data());
    if (!isEditor) remember(id, {id, ...T.trip});
    if (prevTz !== T.tz) render(false); else renderStatus();
  }, () => {}));
  let first = true;
  T.unsubs.push(onSnapshot(collection(db, `trips/${id}/stops`), snap => {
    const added = first ? [] : snap.docChanges().filter(c => c.type === "added").map(c => c.doc.id).filter(x => !T.mine.has(x));
    T.photos = snap.docs.map(s => { const d = s.data(); return {id:s.id, ...d, thumbUrl: imgUrl("thumb:" + s.id, d.thumb), hasPhoto: !!d.hasPhoto}; })
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng) && Number.isFinite(s.at));
    T.loaded = true;
    const keepPhoto = lbCurrentId();
    render(first);
    if (first) maybeHero();
    if (added.length) announce(added);
    if (!$("lb").hidden && keepPhoto){ const k = T.flat.findIndex(f => f.e.items[f.i].id === keepPhoto); if (k < 0) closeLb(); else { lbPos = k; if ($("lb-edit").hidden) drawLb(); } }
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
/* Nouvelles photos reçues en direct : petit message cliquable. */
function announce(ids){
  const its = T.photos.filter(p => ids.includes(p.id) && p.hasPhoto);
  if (!its.length) return;
  const last = its[its.length-1], e = T.entries.find(x => x.items.some(it => it.id === last.id));
  const where = e?.kind === "stop" ? e.place : e?.label;
  toast(`📸 ${its.length > 1 ? `${its.length} nouvelles photos` : "Nouvelle photo"}${where ? ` · ${where}` : ""}`, () => openPhoto(last.id, true));
}

/* ---------- Fond de carte illustré ---------- */
function bboxOf(gj){
  let s = 90, w = 180, n = -90, e = -180;
  const walk = c => typeof c[0] === "number" ? (s = Math.min(s, c[1]), n = Math.max(n, c[1]), w = Math.min(w, c[0]), e = Math.max(e, c[0])) : c.forEach(walk);
  (gj.features || [gj]).forEach(f => walk((f.geometry || f).coordinates));
  return n >= s ? [[s, w], [n, e]] : null;
}
async function buildMap(){
  const [pack, country, world] = await Promise.all([loadPack(T.trip.country), loadCountry(T.trip.country), loadWorld()]);
  if (!T.id) return;
  T.pack = pack;
  T.land = makeLand(country, world);
  const bb = country ? bboxOf(country) : null;
  const home = pack?.home || bb;
  const map = T.map = L.map("map", {zoomControl:false, maxZoom:18, minZoom:3, zoomSnap:.25, zoomDelta:.5, worldCopyJump:true});
  T.home = home;
  if (home) map.fitBounds(home, {padding:[8,8]}); else map.setView([45, 10], 4);
  map.createPane("base").style.zIndex = 150;
  L.control.zoom({position:"bottomleft"}).addTo(map);
  L.control.scale({position:"bottomleft", imperial:false, maxWidth:110}).addTo(map);
  map.attributionControl.setPrefix(false);
  if (country) map.attributionControl.addAttribution('<a href="https://www.geoboundaries.org" target="_blank" rel="noopener">geoBoundaries</a> · Natural Earth');
  map.attributionControl.addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>');
  const opt = cls => ({pane:"base", interactive:false, style:() => ({className:cls})});
  if (world){
    // Les terres du monde (pour l'aller-retour) sauf celles que le contour détaillé du pays remplace.
    const cb = bb ? {s:bb[0][0]-.2, w:bb[0][1]-.2, n:bb[1][0]+.2, e:bb[1][1]+.2} : null;
    const coords = world.features[0].geometry.coordinates.filter(p => {
      if (!cb) return true;
      const xs = p[0].map(c => c[0]), ys = p[0].map(c => c[1]);
      return !(Math.min(...xs) >= cb.w && Math.max(...xs) <= cb.e && Math.min(...ys) >= cb.s && Math.max(...ys) <= cb.n);
    });
    L.geoJSON({type:"MultiPolygon", coordinates:coords}, opt("land world")).addTo(map);
  }
  if (country){
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
  const syncZoom = () => { const z = map.getZoom(); const w = $("mapwrap");
    w.classList.toggle("z-close", z >= 12); w.classList.toggle("z-mid", z >= 10.75); w.classList.toggle("z-far", z < 8); };
  map.on("zoomend", syncZoom); syncZoom();
  T.layers = { route: L.layerGroup().addTo(map), legpics: L.layerGroup().addTo(map), pins: L.layerGroup().addTo(map), story: L.layerGroup().addTo(map) };
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
$("btn-overview").onclick = () => { T.overview = !T.overview; $("btn-overview").setAttribute("aria-pressed", String(T.overview)); renderMap(true); };

/* ---------- Le récit : étapes et trajets ---------- */
const dayKey = t => T.F.dayKey.format(new Date(t));
/* « Jour 3 » compte depuis la date de début du voyage (sinon depuis la première photo). */
function dayNo(d){
  const key = T.J?.days[d]; const s = T.trip?.startDate;
  if (key && s){ const n = Math.round((Date.parse(key) - Date.parse(s)) / 864e5) + 1; if (n >= 1 && n <= 90) return n; }
  return d + 1;
}
const dayName = d => `Jour ${dayNo(d)}`;
const dayDate = d => new Date((T.J?.days[d] || "2000-01-01") + "T12:00:00Z");
const visibleEntries = () => T.filterDay == null ? T.entries : T.entries.filter(e => e.day === T.filterDay);
function byDay(list){ const m = new Map(); list.forEach(e => { if (!m.has(e.day)) m.set(e.day, []); m.get(e.day).push(e); }); return [...m.entries()]; }
const fmtKm = d => d < 10 ? d.toFixed(1).replace(".", ",") : Math.round(d).toLocaleString("fr-BE");
function fmtDur(ms){ const m = Math.round(ms / 60000); if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${String(r).padStart(2,"0")}` : `${h} h`; }
const MODE_SVG = {
  plane:'<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" transform="rotate(90 12 12)"/></svg>',
  boat:'<svg viewBox="0 0 24 24"><path d="M3 15h18l-3 5H6z"/><path d="M12 15V4l6 9h-6"/></svg>',
  car:'<svg viewBox="0 0 24 24"><path d="M5 16h14v-4l-2-5H7l-2 5z"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/></svg>',
  bus:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="15" rx="2"/><path d="M5 11h14"/><circle cx="8.5" cy="15" r="1"/><circle cx="15.5" cy="15" r="1"/><path d="M7 18v2M17 18v2"/></svg>',
  train:'<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 11h12"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M8 21l2-4M16 21l-2-4"/></svg>',
  walk:'<svg viewBox="0 0 24 24"><circle cx="13" cy="4" r="2"/><path d="M10 21l2-6 3 3v3M9 12l2-4 4 2 2 3M11 8l-2 7"/></svg>'
};
const modeIcon = m => MODE_SVG[MODES[m]?.icon || "car"];

function render(fit){
  if (!T.trip || !T.land) return;
  T.J = buildJourney(T.photos, { dayKey, isWater: T.land.isWater, inCountry: T.land.inCountry, autoNames: T.autoNames, airport: T.pack?.airport });
  T.entries = T.J.timeline.filter(e => e.kind === "stop" || e.notable);
  if (T.filterDay != null && T.filterDay >= T.J.days.length) T.filterDay = null;
  T.flat = visibleEntries().flatMap(e => e.items.map((_, i) => ({e, i})));
  renderStatus(); renderDays(); renderLog(); renderMap(fit);
}

/* Noms de lieux automatiques pour les étapes sans nom : pack, sinon Nominatim.
   Un éditeur enregistre le nom trouvé dans les documents (cache) ; un visiteur le garde en mémoire. */
let naming = false;
async function fillMissingNames(){
  if (naming || !T.J) return; naming = true;
  try {
    for (const g of [...T.J.stops]){
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
function tripStats(){
  const J = T.J, n = T.photos.filter(p => p.hasPhoto).length;
  const kmTot = J ? J.legs.reduce((s, l) => s + l.km, 0) : 0;
  return { n, stops: J?.stops.length || 0, days: J?.days.length || 0, km: kmTot,
    last: T.photos.length ? Math.max(...T.photos.map(p => p.created || p.at)) : 0 };
}

/* ---------- Rendu ---------- */
function renderStatus(){
  const st = $("status"); if (!T.trip) return;
  if (!T.loaded){ st.innerHTML = `<span class="pill calm">Chargement</span>`; return; }
  if (!T.photos.length){ st.innerHTML = `<span class="pill calm">Pas encore commencé</span>${T.trip.subtitle ? `<span>${esc(T.trip.subtitle)}</span>` : ""}`; return; }
  const s = tripStats(), live = Date.now() - s.last < 3*3600e3;
  st.innerHTML = `${live ? '<span class="pill live">En direct</span>' : '<span class="pill calm">En différé</span>'}
    <span>${s.n} photo${s.n>1?"s":""} · ${s.stops} étape${s.stops>1?"s":""} · ${s.days} jour${s.days>1?"s":""} · ${fmtKm(s.km)} km parcourus · ${esc(ago(s.last))}</span>`;
  $("btn-replay").disabled = T.entries.length < 2;
}
function renderDays(){
  const el = $("days"), ds = byDay(T.entries);
  if (ds.length < 2){ el.innerHTML = ""; el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<button class="chip" type="button" data-day="" aria-pressed="${T.filterDay==null}">Tout le voyage</button>` +
    ds.map(([d,l]) => `<button class="chip" type="button" data-day="${d}" aria-pressed="${T.filterDay===d}" style="--dc:${dc(d)}"><i></i>${dayName(d)} · ${esc(T.F.chip.format(dayDate(d)))}</button>`).join("");
}
const pinSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
function renderLog(){
  const el = $("list");
  $("view-tabs").hidden = !T.photos.length;
  document.querySelectorAll("#view-tabs [data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === T.view)));
  $("editor-tools").hidden = !isEditor;
  if (!T.loaded){ el.innerHTML = ""; return; }
  if (!T.photos.length){
    el.innerHTML = isEditor
      ? `<div class="empty"><strong>Le carnet est vide</strong>Appuie sur <b>Ajouter des photos</b> et choisis-les : l'heure et l'endroit sont lus dans chaque photo, il ne reste qu'à publier. Les photos prises à l'aéroport, dans l'avion ou sur le ferry dessinent les trajets.</div>`
      : `<div class="empty"><strong>Le voyage n'a pas encore commencé</strong>Les photos apparaîtront ici dès qu'elles seront publiées. Garde la page ouverte, elles arrivent en direct.</div>`;
    return;
  }
  if (T.view === "photos") return renderGallery(el);
  el.innerHTML = byDay(visibleEntries()).map(([d,l]) => {
    const st = l.filter(e => e.kind === "stop"), dd = l.filter(e => e.kind === "leg").reduce((s, x) => s + x.km, 0);
    return `<section class="day" style="--dc:${dc(d)}"><div class="day-head"><h2>${dayName(d)}</h2><span>${esc(T.F.dayLabel.format(dayDate(d)))}${dd >= .5 ? ` · ${fmtKm(dd)} km` : ""}${st.length ? ` · ${st.length} étape${st.length>1?"s":""}` : ""}</span></div>
      <ol class="stops">${l.map(e => e.kind === "leg" ? legRow(e) : stopRow(e)).join("")}</ol></section>`;
  }).join("");
}
function stopRow(g){
  const ph = g.items.filter(x => x.thumbUrl);
  const t1 = T.F.time.format(new Date(g.at)), t2 = T.F.time.format(new Date(g.end));
  const second = ph.find(x => x.thumbUrl !== g.cover);
  return `<li class="stop ${g.id===T.active?"active":""}">
    <button type="button" data-open="${esc(g.id)}">
      <span class="thumbstack">${ph.length ? `<img src="${esc(g.cover)}" alt="" loading="lazy">${second?`<img src="${esc(second.thumbUrl)}" alt="" loading="lazy">`:""}${ph.length>1?`<b>${ph.length}</b>`:""}` : `<span class="ph">${pinSvg}</span>`}</span>
      <span class="txt"><span class="when">${esc(t1)}${t2!==t1?` – ${esc(t2)}`:""}${g.tag ? `<span class="flag">${esc(g.tag)}</span>` : ""}</span>
      <span class="place">${esc(g.place || "Étape")}${g.approx?'<span class="tag">position estimée</span>':""}</span>
      ${g.caption ? `<span class="cap">${esc(g.caption)}</span>` : ""}</span>
    </button></li>`;
}
function legRow(l){
  const ph = l.items.filter(x => x.thumbUrl).slice(0, 5);
  const dur = l.to && l.from ? fmtDur(l.to.at - l.from.end) : "";
  const meta = [l.km >= .5 ? `${fmtKm(l.km)} km` : "", l.mode === "plane" && dur ? dur : "", l.items.length ? `${l.items.length} photo${l.items.length>1?"s":""}` : ""].filter(Boolean).join(" · ");
  return `<li class="leg m-${l.mode} ${l.id===T.active?"active":""}">
    <button type="button" data-open="${esc(l.id)}" ${l.items.length ? "" : 'data-fly="1"'}>
      <span class="modeico">${modeIcon(l.mode)}</span>
      <span class="txt"><span class="leg-title">${esc(l.label)}</span><span class="when">${esc(meta)}</span>
      ${ph.length ? `<span class="film">${ph.map(x => `<img src="${esc(x.thumbUrl)}" alt="" loading="lazy">`).join("")}</span>` : ""}</span>
    </button></li>`;
}
function renderGallery(el){
  el.innerHTML = byDay(visibleEntries()).map(([d,l]) => {
    const its = l.flatMap(e => e.items.filter(x => x.thumbUrl));
    if (!its.length) return "";
    return `<section class="day" style="--dc:${dc(d)}"><div class="day-head"><h2>${dayName(d)}</h2><span>${esc(T.F.dayLabel.format(dayDate(d)))} · ${its.length} photo${its.length>1?"s":""}</span></div>
      <div class="gallery">${its.map(x => `<button type="button" data-photo="${esc(x.id)}" aria-label="Ouvrir la photo"><img src="${esc(x.thumbUrl)}" alt="" loading="lazy"></button>`).join("")}</div></section>`;
  }).join("");
}

function renderMap(fit){
  if (!T.map || !T.J) return;
  const vis = visibleEntries(), stops = vis.filter(e => e.kind === "stop"), last = T.J.stops[T.J.stops.length-1];
  const legs = T.J.legs.filter(l => T.filterDay == null || l.day === T.filterDay);
  T.layers.pins.clearLayers(); T.layers.legpics.clearLayers();
  stops.forEach(g => {
    const ph = g.items.filter(x => x.thumbUrl).length;
    const cls = ["pin", ph>1?"stack":"", g.approx?"approx":"", last&&g.id===last.id?"latest":"", g.id===T.active?"active":""].join(" ");
    const html = `<div class="${cls}" style="--dc:${dc(g.day)}"><div class="card">${g.cover?`<img src="${esc(g.cover)}" alt="">`:`<div class="noimg">${pinSvg}</div>`}</div><span class="num">${g.n}</span>${ph>1?`<span class="count">${ph}</span>`:""}${g.tag?`<span class="pinflag">${esc(g.tag)}</span>`:""}</div>`;
    const m = L.marker([g.lat,g.lng], {icon:L.divIcon({className:"stop-pin", html, iconSize:[0,0]}), title:g.place||"Étape", zIndexOffset:g.n*10 + (g.id===T.active?5000:0), riseOnHover:true});
    m.on("click", () => !picking && openEntry(g.id));
    m.addTo(T.layers.pins);
  });
  // Photos prises en route : petites vignettes rondes le long du trajet
  legs.forEach(l => l.items.filter(x => x.thumbUrl).forEach(x => {
    const m = L.marker([x.lat, x.lng], {icon:L.divIcon({className:"stop-pin", html:`<div class="legpic ${l.id===T.active?"active":""}" style="--dc:${dc(l.day)}"><img src="${esc(x.thumbUrl)}" alt=""></div>`, iconSize:[0,0]}), title:l.label, riseOnHover:true});
    m.on("click", () => !picking && openPhoto(x.id));
    m.addTo(T.layers.legpics);
  }));
  drawRoutes(legs);
  const note = $("map-note");
  if (T.loaded && !T.photos.length){
    note.hidden = false;
    note.innerHTML = `<strong>${esc(T.pack?.noteTitle || T.trip.title || "Le voyage")}</strong><p>${isEditor?"Les premières photos publiées apparaîtront ici.":"Le parcours s'affichera ici au fil du voyage."}</p>`;
  } else note.hidden = true;
  const hasOut = T.J.stops.some(s => s.out) && T.J.stops.some(s => !s.out);
  $("btn-overview").hidden = !hasOut || T.filterDay != null;
  if (fit && stops.length){
    const focus = T.filterDay != null || T.overview || !hasOut ? stops : stops.filter(s => !s.out);
    const pts = [...focus.map(g => [g.lat, g.lng]), ...(T.overview || T.filterDay != null ? legs.flatMap(l => l.items.map(x => [x.lat, x.lng])) : [])];
    if (pts.length === 1) T.map.setView(pts[0], 13);
    else T.map.fitBounds(L.latLngBounds(pts), {padding:[60,60], maxZoom:14});
  }
}
function drawRoutes(legs){
  T.layers.route.clearLayers();
  legs.forEach(l => {
    if (l.km < .05) return;
    const kind = l.mode === "plane" ? "flight" : l.mode === "boat" ? "sea" : l.mode === "walk" ? "walk" : "road";
    const active = l.id === T.active ? " active" : "";
    L.polyline(l.path, {className:"route-under", interactive:false}).addTo(T.layers.route);
    const line = L.polyline(l.path, {className:`route ${kind} d${(l.day % NDAY)+1}${active}`});
    line.on("click", () => !picking && openEntry(l.id));
    line.addTo(T.layers.route);
    if (l.mode === "plane" || l.mode === "boat" || l.km > 3){
      const mid = Math.floor(l.path.length / 2), a = T.map.latLngToLayerPoint(l.path[Math.max(0, mid-1)]), b = T.map.latLngToLayerPoint(l.path[Math.min(l.path.length-1, mid+1)]);
      const rot = l.mode === "plane" ? Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI : 0;
      const m = L.marker(l.path[mid], {icon:L.divIcon({className:"stop-pin", html:`<div class="modepin m-${l.mode}" style="--dc:${dc(l.day)};--rot:${rot}deg" title="${esc(l.label)}">${modeIcon(l.mode)}</div>`, iconSize:[0,0]}), zIndexOffset:-100});
      m.on("click", () => !picking && openEntry(l.id));
      m.addTo(T.layers.route);
    }
  });
}
setInterval(() => T.trip && renderStatus(), 60000);

$("days").addEventListener("click", e => {
  const b = e.target.closest("[data-day]"); if (!b) return;
  T.filterDay = b.dataset.day === "" ? null : +b.dataset.day; stopStory();
  if (T.filterDay == null && !T.J?.stops.length && T.home) T.map.fitBounds(T.home);
  render(true);
});
$("view-tabs").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (!b) return; T.view = b.dataset.view; renderLog(); });
$("list").addEventListener("click", e => {
  const p = e.target.closest("[data-photo]"); if (p) return openPhoto(p.dataset.photo);
  const b = e.target.closest("[data-open]"); if (!b) return;
  const en = T.entries.find(x => x.id === b.dataset.open);
  if (en && !en.items.length){ T.active = en.id; flyToEntry(en); renderLog(); renderMap(false); $("mapwrap").scrollIntoView({behavior:"smooth", block:"start"}); return; }
  openEntry(b.dataset.open, true);
});

/* ---------- Visionneuse : toutes les photos du voyage à la suite ---------- */
let lbPos = 0;
const lbCur = () => T.flat[lbPos];
const lbCurrentId = () => $("lb").hidden ? null : lbCur()?.e.items[lbCur().i]?.id;
function flyToEntry(e){
  if (!T.map) return;
  if (e.kind === "leg") T.map.flyToBounds(L.latLngBounds(e.path), {padding:[50,50], maxZoom:13, duration:.8});
  else T.map.flyTo([e.lat, e.lng], Math.max(T.map.getZoom(), e.out ? 11 : 14), {duration:.8});
}
function openEntry(id, fly){
  let k = T.flat.findIndex(f => f.e.id === id);
  if (k < 0 && T.filterDay != null){ T.filterDay = null; render(false); k = T.flat.findIndex(f => f.e.id === id); }
  if (k >= 0) showLb(k, fly);
}
function openPhoto(id, fly){
  let k = T.flat.findIndex(f => f.e.items[f.i].id === id);
  if (k < 0 && T.filterDay != null){ T.filterDay = null; render(false); k = T.flat.findIndex(f => f.e.items[f.i].id === id); }
  if (k >= 0) showLb(k, fly);
}
function showLb(k, fly){
  lbPos = k; const { e } = lbCur();
  T.active = e.id;
  if (fly) flyToEntry(e);
  drawLb(); $("lb").hidden = false; $("lb-edit").hidden = true; $("lb-nav").hidden = false;
  document.body.classList.add("noscroll");
  renderLog(); renderMap(false);
}
function entryKicker(e){
  return e.kind === "leg" ? `${dayName(e.day)} · ${e.label}` : `Étape ${e.n} · ${dayName(e.day)}`;
}
function drawLb(){
  const f = lbCur(); if (!f) return;
  const { e } = f, it = e.items[f.i];
  $("lb-card").style.setProperty("--dc", dc(e.day));
  const many = T.flat.length > 1;
  $("lb-img").hidden = !it.hasPhoto;
  $("lb-img").innerHTML = it.hasPhoto ? `<img src="${esc(it.thumbUrl || "")}" alt="${esc(it.caption||e.place||"Photo du voyage")}" draggable="false">
    ${many?`<button class="arrow l" type="button" data-step="-1" aria-label="Photo précédente"${lbPos?"":" disabled"}>‹</button><button class="arrow r" type="button" data-step="1" aria-label="Photo suivante"${lbPos<T.flat.length-1?"":" disabled"}>›</button>`:""}
    <span class="lb-count">${lbPos+1} / ${T.flat.length}</span>` : "";
  if (it.hasPhoto){
    const tripId = T.id;
    fullPhoto(tripId, it.id).then(url => { const im = $("lb-img").querySelector("img"); if (url && im && T.id === tripId && lbCurrentId() === it.id) im.src = url; });
    [1, -1, 2].forEach(d => { const g = T.flat[lbPos + d]; const x = g?.e.items[g.i]; if (x?.hasPhoto) fullPhoto(tripId, x.id); });
  }
  $("lb-strip").hidden = e.items.length < 2;
  $("lb-strip").innerHTML = e.items.map((x,i) => `<button type="button" data-i="${i}" aria-current="${i===f.i}" aria-label="Photo ${i+1}">${x.thumbUrl?`<img src="${esc(x.thumbUrl)}" alt="">`:""}</button>`).join("");
  $("lb-when").textContent = `${entryKicker(e)} · ${T.F.full.format(new Date(it.at))}${it.approxTime ? " (heure estimée)" : ""}`;
  $("lb-title").innerHTML = esc(e.kind === "leg" ? `${e.label}${e.km >= 1 ? ` · ${fmtKm(e.km)} km` : ""}` : (e.place || "Étape")) + (e.tag ? ` <span class="flag big">${esc(e.tag)}</span>` : "");
  $("lb-cap").textContent = e.kind === "leg" ? (it.caption || "") : (e.caption || "");
  $("lb-coords").textContent = fmtCoord(it.lat,it.lng) + (it.approxPos ? " · position estimée d'après l'heure" : "");
  $("lb-by").textContent = [it.byName ? `Publié par ${it.byName}` : "", it.device].filter(Boolean).join(" · ");
  const ents = visibleEntries().filter(x => x.items.length), i = ents.indexOf(e);
  $("lb-prev").disabled = i <= 0; $("lb-next").disabled = i < 0 || i >= ents.length-1;
  $("lb-prev").dataset.id = ents[i-1]?.id || ""; $("lb-next").dataset.id = ents[i+1]?.id || "";
  $("lb-editbtn").hidden = !isEditor;
}
function closeLb(){ $("lb").hidden = true; document.body.classList.remove("noscroll"); T.active = null; if (T.trip){ renderLog(); renderMap(false); } }
$("lb-close").onclick = closeLb;
$("lb").addEventListener("click", e => { if (e.target === $("lb")) closeLb(); });
function stepLb(k){
  const n = lbPos + k; if (n < 0 || n >= T.flat.length) return;
  const prevE = lbCur().e; lbPos = n; const e = lbCur().e;
  drawLb();
  if (e !== prevE){ T.active = e.id; flyToEntry(e); renderLog(); renderMap(false); }
}
$("lb-img").addEventListener("click", e => { const b = e.target.closest("[data-step]"); if (b) stepLb(+b.dataset.step); });
$("lb-strip").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (!b) return; const f = lbCur(); lbPos = T.flat.findIndex(x => x.e === f.e && x.i === +b.dataset.i); drawLb(); });
$("lb-prev").onclick = () => $("lb-prev").dataset.id && openEntry($("lb-prev").dataset.id, true);
$("lb-next").onclick = () => $("lb-next").dataset.id && openEntry($("lb-next").dataset.id, true);
let touchX = null, touchY = null;
$("lb-img").addEventListener("touchstart", e => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, {passive:true});
$("lb-img").addEventListener("touchend", e => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY; touchX = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) stepLb(dx < 0 ? 1 : -1);
  else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) closeLb();
});
document.addEventListener("keydown", e => {
  if (S.on){
    if (e.key === "Escape") stopStory();
    if (e.key === "ArrowRight") storyGo(S.k + 1);
    if (e.key === "ArrowLeft") storyGo(Math.max(0, S.k - 1));
    if (e.key === " "){ e.preventDefault(); storyToggle(); }
    return;
  }
  if (e.key === "Escape" && !$("hero").hidden){ $("hero").hidden = true; return; }
  if (e.key === "Escape" && !$("add").hidden && !$("add-submit").disabled){ closeAdd(); return; }
  if (e.key === "Escape" && !$("place").hidden){ $("place").hidden = true; return; }
  if (e.key === "Escape" && !$("newtrip").hidden){ $("newtrip").hidden = true; return; }
  if ($("lb").hidden || !$("lb-edit").hidden) return;
  if (e.key === "Escape") closeLb();
  if (e.key === "ArrowLeft") stepLb(-1);
  if (e.key === "ArrowRight") stepLb(1);
});

/* ---------- Modifier une étape ou un trajet ---------- */
let delArm = null;
const stopRef = id => doc(db, `trips/${T.id}/stops/${id}`);
async function updateEach(items, fn){
  const b = writeBatch(db); let n = 0;
  items.forEach(it => { const u = fn(it); if (Object.keys(u).length){ b.update(stopRef(it.id), u); n++; } });
  if (n) await b.commit();
}
async function deleteItems(items){
  const b = writeBatch(db);
  items.forEach(it => { b.delete(stopRef(it.id)); if (it.hasPhoto) b.delete(doc(db, `trips/${T.id}/photos/${it.id}`)); });
  await b.commit();
}
$("lb-editbtn").onclick = () => {
  const { e, i } = lbCur(), it = e.items[i], isStop = e.kind === "stop";
  document.querySelectorAll("#lb-edit .only-stop").forEach(x => x.hidden = !isStop);
  $("e-name").value = isStop ? e.place : ""; $("e-caption").value = isStop ? e.caption : (it.caption || "");
  $("e-caption-label").firstChild.textContent = isStop ? "Petit mot de l'étape" : "Petit mot sur cette photo";
  $("e-when").value = toLocalInput(T.tz, isStop ? e.at : it.at);
  $("e-tag").value = isStop ? (e.items.find(x => x.tag)?.tag || "") : "";
  const forced = (e.kind === "leg" ? (e.to?.items.find(x => x.arriveBy) || e.items.find(x => x.arriveBy)) : e.items.find(x => x.arriveBy))?.arriveBy || "";
  $("e-mode").value = forced;
  $("e-mode-label").firstChild.textContent = isStop ? "Arrivé ici en " : "Mode de transport ";
  $("e-moving").checked = !!it._moving;
  $("e-moving-row").hidden = !it.hasPhoto;
  $("e-delphoto").hidden = !it.hasPhoto && e.items.length < 2; delArm = null; setMsg("e-msg", "");
  $("e-delphoto").textContent = "Retirer cette photo";
  $("e-delstop").textContent = isStop ? "Supprimer l'étape" : "Supprimer les photos du trajet";
  $("e-delstop").hidden = !e.items.length;
  $("lb-edit").hidden = false; $("lb-nav").hidden = true;
  $("lb-edit").scrollIntoView({block:"nearest"});
};
$("e-cancel").onclick = () => { $("lb-edit").hidden = true; $("lb-nav").hidden = false; };
$("e-save").onclick = async () => {
  const { e, i } = lbCur(), it = e.items[i], isStop = e.kind === "stop";
  const name = $("e-name").value.trim(), cap = $("e-caption").value.trim(), t = fromLocalInput(T.tz, $("e-when").value);
  const mode = $("e-mode").value, tag = $("e-tag").value.trim(), moving = $("e-moving").checked;
  $("e-save").disabled = true; setMsg("e-msg", "Enregistrement…");
  try {
    const b = writeBatch(db); const ups = new Map();
    const up = (x, u) => ups.set(x.id, {...(ups.get(x.id) || {}), ...u});
    if (isStop){
      const delta = t != null ? t - e.at : 0;
      e.items.forEach((x, k) => {
        if ((x.place || "") !== name) up(x, {place: name});
        const c = k === 0 ? cap : ""; if ((x.caption || "") !== c) up(x, {caption: c});
        if (delta) up(x, {at: x.at + delta, approxTime: false});
        const tg = k === 0 ? tag : ""; if ((x.tag || "") !== tg) up(x, {tag: tg});
        const md = k === 0 ? mode : ""; if ((x.arriveBy || "") !== md) up(x, {arriveBy: md});
      });
      if (it.hasPhoto && moving !== !!it._moving) up(it, moving ? {moving: true, still: false} : {moving: false, still: true});
    } else {
      if ((it.caption || "") !== cap) up(it, {caption: cap});
      const t2 = t != null && Math.abs(t - it.at) > 59000 ? t : null; if (t2 != null) up(it, {at: t2, approxTime: false});
      const holder = e.to?.items[0] || e.items[0];
      [...(e.to?.items || []), ...e.items].forEach(x => { const md = x === holder ? mode : ""; if ((x.arriveBy || "") !== md) up(x, {arriveBy: md}); });
      if (!moving) up(it, {moving: false, still: true});
    }
    ups.forEach((u, id) => b.update(stopRef(id), u));
    if (ups.size) await b.commit();
    if (!name) delete T.autoNames[e.id];
    $("lb-edit").hidden = true; $("lb-nav").hidden = false; setMsg("e-msg", "");
    drawLb();
  } catch(_){ setMsg("e-msg", "L'enregistrement a échoué. Réessaie.", "err"); }
  $("e-save").disabled = false;
};
$("e-delphoto").onclick = async () => {
  if (delArm !== "photo"){ delArm = "photo"; $("e-delphoto").textContent = "Confirmer : retirer la photo"; return; }
  const { e, i } = lbCur(), it = e.items[i];
  try {
    await deleteItems([it]);
    if (T.flat.length <= 1) closeLb(); else { lbPos = Math.max(0, lbPos - 1); $("lb-edit").hidden = true; $("lb-nav").hidden = false; }
  } catch(_){ setMsg("e-msg", "La suppression a échoué. Réessaie.", "err"); }
  delArm = null;
};
$("e-delstop").onclick = async () => {
  const { e } = lbCur();
  if (delArm !== "stop"){ delArm = "stop"; $("e-delstop").textContent = `Confirmer : supprimer ${e.items.length > 1 ? `les ${e.items.length} éléments` : "l'élément"}`; return; }
  try { await deleteItems(e.items); closeLb(); }
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
  const { e } = lbCur(); if (e.kind !== "stop") return;
  const keep = lbCurrentId();
  $("lb").hidden = true; document.body.classList.remove("noscroll");
  startPick("Touche le nouvel emplacement de l'étape", async ll => {
    if (ll){
      try {
        const place = e.items.some(x => x.place) ? null : await autoPlace(T.pack, ll.lat, ll.lng);
        delete T.autoNames[e.id];
        await updateEach(e.items, () => ({lat:ll.lat, lng:ll.lng, approxPos:false, ...(place ? {place} : {})}));
      } catch(_){ toast("Le déplacement a échoué."); }
    }
    openPhoto(keep, false);
  });
};

/* ---------- Recherche de lieu (Nominatim) ---------- */
function placeSearch(input, list, onPick){
  let timer = null, req = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3){ list.innerHTML = ""; list.hidden = true; return; }
    timer = setTimeout(async () => {
      const r = ++req; list.hidden = false; list.innerHTML = `<li class="muted">Recherche…</li>`;
      const res = await searchPlaces(q);
      if (r !== req) return;
      list.innerHTML = res.length ? res.map((x, i) => `<li><button type="button" data-i="${i}"><b>${esc(x.name)}</b><small>${esc(x.detail)}</small></button></li>`).join("") : `<li class="muted">Aucun lieu trouvé</li>`;
      list.onclick = ev => { const b = ev.target.closest("[data-i]"); if (!b) return; const x = res[+b.dataset.i]; list.hidden = true; list.innerHTML = ""; input.value = x.name; onPick(x); };
    }, 650);
  });
}

/* ---------- Ajout de photos ---------- */
let pending = [], chosen = null, nameReq = 0;
function addMsg(t, err){ setMsg("add-msg", t, err ? "err" : null); }
function fillPlaceSelect(){
  const sel = $("f-place");
  sel.innerHTML = `<option value="">Lieu connu…</option>` + (T.pack?.places || []).map(([n],i) => `<option value="${i}">${esc(n)}</option>`).join("");
  sel.hidden = !T.pack?.places?.length;
}
function resolvePending(){
  // Heure : photo > GPS > heure choisie (estimée)
  const fallbackAt = fromLocalInput(T.tz, $("f-when").value) ?? Date.now();
  pending.forEach((p,i) => { p.at = p.metaAt ?? (fallbackAt + i*1000); p.approxTime = p.metaAt == null; });
  // Position : photo (GPS frais) > choix manuel > estimée : dans l'avion, à l'aéroport d'arrivée,
  // ou d'après la photo la plus proche dans le temps. Un GPS périmé (mode avion) ne compte pas.
  const known = [...pending.filter(p => p.metaLat != null).map(p => ({at:p.at, lat:p.metaLat, lng:p.metaLng})),
    ...T.photos.filter(p => !p.approxPos).map(p => ({at:p.at, lat:p.lat, lng:p.lng}))].sort((a,b) => a.at - b.at);
  pending.forEach(p => {
    p.approxPos = false; p.inFlight = false; p.estPlace = "";
    if (chosen && (p.metaLat == null || chosen.all)){ p.lat = chosen.lat; p.lng = chosen.lng; return; }
    if (p.metaLat != null){ p.lat = p.metaLat; p.lng = p.metaLng; return; }
    const est = p.approxTime ? null : estimatePosition(p.at, known, { airport: T.pack?.airport, inCountry: T.land?.inCountry });
    if (est){ p.lat = est.lat; p.lng = est.lng; p.approxPos = true; p.inFlight = !!est.inFlight; p.estPlace = est.place || ""; }
    else if (p.staleLat != null){ p.lat = p.staleLat; p.lng = p.staleLng; p.approxPos = true; }
    else { p.lat = null; p.lng = null; }
  });
}
function renderAdd(){
  resolvePending();
  $("thumbs").innerHTML = pending.map(p => `<div class="thumb"><img src="${p.preview}" alt=""><div class="meta">
    <span class="${p.approxTime?"no":"ok"}">${p.approxTime?"heure ?":esc(T.F.time.format(new Date(p.at)))}</span>
    <span class="${p.lat==null?"no":p.approxPos?"est":"ok"}">${p.lat==null?"lieu ?":p.inFlight?"✈":p.approxPos?"≈ lieu":"lieu"}</span></div>${p.sent?'<div class="done">✓</div>':""}</div>`).join("");
  const n = pending.length, withT = pending.filter(p => !p.approxTime).length, withG = pending.filter(p => p.metaLat != null).length;
  const est = pending.filter(p => p.approxPos).length, miss = pending.filter(p => p.lat == null).length;
  const src = [...new Set(pending.filter(p => p.timeSrc).map(p => p.timeSrc))].join(", ");
  $("summary").innerHTML = `
    <div class="row"><b>${withT===n?"✓":"!"}</b><span>Heure lue dans ${withT===n?"toutes les photos":`${withT} photo${withT>1?"s":""} sur ${n}`}${src?` (source : ${esc(src)})`:""}${withT<n?". Les autres prennent l'heure indiquée plus bas.":""}</span></div>
    <div class="row"><b>${withG===n?"✓":miss?"!":"≈"}</b><span>Position lue dans ${withG===n?"toutes les photos":`${withG} photo${withG>1?"s":""} sur ${n}`}${est?`, ${est} placée${est>1?"s":""} d'après les photos prises juste avant ou après`:""}${miss?`, ${miss} sans lieu`:""}.</span></div>
    ${pending.some(p => p.stale) ? `<div class="row"><b>≈</b><span>${pending.filter(p => p.stale).length} photo(s) avec une position GPS périmée (téléphone sans signal, par exemple à l'atterrissage) : placée(s) d'après le trajet.</span></div>` : ""}
    <div class="row"><b>↝</b><span>Les photos prises en route (avion, ferry, voiture) dessineront le trajet sur la carte.</span></div>
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
  fillPlaceSelect(); $("f-results").hidden = true;
  $("f-when").value = toLocalInput(T.tz, Date.now());
  $("add").hidden = false; $("thumbs").innerHTML = ""; $("summary").innerHTML = "Lecture des photos…"; $("where").hidden = true; addMsg("");
  $("progress").hidden = true; $("add-submit").disabled = false;
  for (const f of files){
    const m = await readMeta(f, T.tz); // sur l'original, avant toute compression
    pending.push({file:f, preview:URL.createObjectURL(f), metaLat:m.gpsStale ? null : m.lat, metaLng:m.gpsStale ? null : m.lng,
      stale:m.gpsStale, staleLat:m.gpsStale ? m.lat : null, staleLng:m.gpsStale ? m.lng : null, gpsAt:m.gpsAt,
      metaAt:m.at, timeSrc:m.timeSrc, device:m.device});
  }
  pending.sort((a,b) => (a.metaAt ?? 9e15) - (b.metaAt ?? 9e15));
  renderAdd();
});
function closeAdd(){ pending.forEach(p => URL.revokeObjectURL(p.preview)); pending = []; $("add").hidden = true; $("progress").hidden = true; nameReq++; }
$("add-close").onclick = closeAdd; $("add-cancel").onclick = closeAdd;
$("f-place").addEventListener("change", () => { const p = T.pack?.places?.[$("f-place").value]; if (!p) return; chosen = {lat:p[1], lng:p[2], name:p[0], all:false}; delete $("f-name").dataset.touched; renderAdd(); });
placeSearch($("f-search"), $("f-results"), x => { chosen = {lat:x.lat, lng:x.lng, name:x.name, all:false}; $("f-place").value = ""; delete $("f-name").dataset.touched; renderAdd(); });
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
  if (todo.some(p => p.lat == null)){ addMsg("Indique où ont été prises les photos sans position (recherche, liste ou carte).", true); $("where").scrollIntoView({block:"center"}); return; }
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
      const place = typed || (chosen && !p.metaLat ? chosen.name : "") || p.estPlace || packPlace(T.pack, p.lat, p.lng)
        || (pending.length === 1 ? autoName : "") || (p.inFlight ? "" : await reverseGeocode(p.lat, p.lng)) || (p.inFlight ? "" : autoName);
      const docData = { lat:p.lat, lng:p.lng, at:p.at, created:Date.now(), place, caption: firstCaption && i === 0 ? caption : "",
        thumb: await toBytes(small), hasPhoto: true, approxPos: !!p.approxPos, approxTime: !!p.approxTime, device: p.device || "",
        by: user.uid, byName: user.displayName || user.email || "", ...(p.gpsAt ? {gpsAt: p.gpsAt} : {}), ...(p.stale ? {gpsStale: true} : {}),
        ...(p.inFlight ? {moving: true} : {}) };
      // La photo et l'étape sont écrites ensemble : tout ou rien.
      const b = writeBatch(db);
      b.set(doc(db, `trips/${tripId}/photos/${id}`), { data: await toBytes(big) });
      b.set(doc(db, `trips/${tripId}/stops/${id}`), docData);
      T.mine.add(id);
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

/* ---------- Ajouter un lieu sans photo (départ de la maison, aéroport…) ---------- */
let placeChosen = null;
function placeMsg(t, kind){ setMsg("pl-msg", t, kind); }
function drawPlaceChosen(){ $("pl-coords").textContent = placeChosen ? `${placeChosen.name ? placeChosen.name + " · " : ""}${fmtCoord(placeChosen.lat, placeChosen.lng)}` : "Aucun endroit choisi"; }
$("btn-addplace").onclick = () => {
  $("pl-form").reset(); placeChosen = null; drawPlaceChosen(); placeMsg(""); $("pl-results").hidden = true;
  $("pl-when").value = toLocalInput(T.tz, Date.now());
  $("place").hidden = false;
};
document.querySelectorAll('[data-close="place"]').forEach(b => b.onclick = () => $("place").hidden = true);
placeSearch($("pl-search"), $("pl-results"), x => { placeChosen = {lat:x.lat, lng:x.lng, name:x.name}; if (!$("pl-name").value) $("pl-name").value = x.name; drawPlaceChosen(); });
$("pl-pick").onclick = () => { $("place").hidden = true; startPick("Touche l'endroit du lieu", async ll => {
  if (ll){ placeChosen = {lat:ll.lat, lng:ll.lng, name:""}; drawPlaceChosen(); const nm = await autoPlace(T.pack, ll.lat, ll.lng); if (nm && !$("pl-name").value) $("pl-name").value = nm; placeChosen.name = nm; drawPlaceChosen(); }
  $("place").hidden = false; }); };
$("pl-form").addEventListener("submit", async e => {
  e.preventDefault();
  const at = fromLocalInput(T.tz, $("pl-when").value);
  if (!placeChosen) return placeMsg("Choisis l'endroit (recherche ou carte).", "err");
  if (at == null) return placeMsg("Indique la date et l'heure.", "err");
  $("pl-submit").disabled = true; placeMsg("Enregistrement…");
  try {
    const ref = doc(collection(db, `trips/${T.id}/stops`)); T.mine.add(ref.id);
    await setDoc(ref, { lat:placeChosen.lat, lng:placeChosen.lng, at, created:Date.now(), place: $("pl-name").value.trim() || placeChosen.name || "",
      caption: $("pl-caption").value.trim(), tag: $("pl-tag").value.trim(), hasPhoto:false, approxPos:false, approxTime:false,
      by: user.uid, byName: user.displayName || user.email || "" });
    $("place").hidden = true; toast("Lieu ajouté au carnet");
  } catch(_){ placeMsg("L'enregistrement a échoué. Réessaie.", "err"); }
  $("pl-submit").disabled = false;
});

/* =================================================================== */
/* Accueil du voyage et « Revivre le voyage »                          */
/* =================================================================== */
function maybeHero(){
  if (isEditor || !T.photos.length) return;
  const k = "vi.hero." + T.id;
  try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch(_){}
  showHero();
}
function showHero(){
  const s = tripStats(), live = Date.now() - s.last < 3*3600e3;
  const coverId = [...T.photos].reverse().find(p => p.hasPhoto && p.caption)?.id || [...T.photos].sort((a,b) => b.at - a.at).find(p => p.hasPhoto)?.id;
  const tc = coverSrc({id:T.id, ...T.trip});
  const bg = $("hero-bg");
  bg.style.backgroundImage = tc ? `url("${tc}")` : "";
  if (!tc && coverId){ const p = T.photos.find(x => x.id === coverId); bg.style.backgroundImage = p?.thumbUrl ? `url("${p.thumbUrl}")` : ""; fullPhoto(T.id, coverId).then(u => { if (u) bg.style.backgroundImage = `url("${u}")`; }); }
  $("hero-kicker").innerHTML = `${live ? '<span class="pill live">En direct</span>' : ""}<span>${esc(fmtDates(T.trip) || "")}</span>`;
  $("hero-title").textContent = T.trip.title || "Le voyage";
  $("hero-sub").textContent = T.trip.subtitle || "";
  $("hero-stats").innerHTML = [[s.n, "photos"], [s.stops, "étapes"], [s.days, "jours"], [fmtKm(s.km), "km"]].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");
  $("hero").hidden = false;
}
$("hero-play").onclick = () => { $("hero").hidden = true; startStory(); };
$("hero-explore").onclick = () => { $("hero").hidden = true; };

const S = { on:false, frames:[], k:0, playing:true, t:0, last:0, raf:0, entry:null, traveller:null, legT0:0 };
function buildFrames(){
  const frames = [];
  visibleEntries().forEach(e => {
    const its = e.items.filter(x => x.hasPhoto);
    if (e.kind === "leg"){
      if (its.length) its.forEach(it => frames.push({e, it, dur: 2800 + Math.min(2500, (it.caption || "").length * 35)}));
      else frames.push({e, it:null, dur: e.mode === "plane" ? 4500 : Math.min(4000, 1800 + e.km * 80)});
    } else if (its.length){
      its.forEach((it, i) => frames.push({e, it, dur: 3200 + (i === 0 && e.caption ? Math.min(3500, e.caption.length * 40) : 0)}));
    } else frames.push({e, it:null, dur: 3200 + Math.min(3500, (e.caption || "").length * 40)});
  });
  // Pour animer le trajet : position de chaque image dans son trajet
  frames.forEach((f, i) => {
    if (f.e.kind !== "leg") return;
    const same = frames.filter(x => x.e === f.e);
    f.legTotal = same.reduce((s, x) => s + x.dur, 0);
    f.legOffset = same.slice(0, same.indexOf(f)).reduce((s, x) => s + x.dur, 0);
  });
  frames.push({end:true, dur:Infinity});
  return frames;
}
function storyPad(){
  const r = $("story").getBoundingClientRect(), m = $("map").getBoundingClientRect();
  if (innerWidth >= 900) return {paddingTopLeft:[Math.max(0, r.right - m.left) + 40, 50], paddingBottomRight:[50, 50]};
  return {paddingTopLeft:[30, 70], paddingBottomRight:[30, Math.max(0, m.bottom - r.top) + 40]};
}
function startStory(){
  if (!T.entries.length) return;
  closeLb();
  S.frames = buildFrames(); S.k = 0; S.on = true; S.playing = true; S.entry = null;
  document.body.classList.add("storying");
  $("story").hidden = false; $("btn-replay").querySelector("span").textContent = "Arrêter";
  window.scrollTo({top:0});
  setTimeout(() => { T.map.invalidateSize(); storyGo(0); S.last = performance.now(); S.raf = requestAnimationFrame(storyTick); }, 60);
}
function stopStory(silent){
  if (!S.on) return;
  S.on = false; cancelAnimationFrame(S.raf);
  T.layers?.story.clearLayers(); S.traveller = null;
  $("story").hidden = true; document.body.classList.remove("storying");
  $("btn-replay").querySelector("span").textContent = "Revivre le voyage";
  T.active = null;
  if (!silent){ setTimeout(() => { T.map?.invalidateSize(); render(true); }, 60); }
}
function storyToggle(){ S.playing = !S.playing; S.last = performance.now(); $("story").classList.toggle("paused", !S.playing); $("st-play").setAttribute("aria-label", S.playing ? "Pause" : "Lecture"); }
function storyGo(k){
  if (k < 0) k = 0;
  if (k >= S.frames.length) k = S.frames.length - 1;
  S.k = k; S.t = 0;
  const f = S.frames[k];
  if (!f.end && f.e !== S.entry){ S.entry = f.e; storyMove(f.e); }
  drawStory();
  // Préchargement des photos suivantes
  S.frames.slice(k + 1, k + 4).forEach(x => x.it && fullPhoto(T.id, x.it.id));
}
function storyMove(e){
  T.active = e.id; renderMap(false);
  const pad = storyPad(), L_ = T.layers.story;
  L_.clearLayers();
  const mode = e.kind === "leg" ? e.mode : null;
  S.traveller = L.marker(e.kind === "leg" ? e.path[0] : [e.lat, e.lng], {interactive:false, zIndexOffset:9000,
    icon:L.divIcon({className:"stop-pin", html: mode ? `<div class="traveller mode m-${mode}">${modeIcon(mode)}</div>` : '<div class="traveller"></div>', iconSize:[0,0]})}).addTo(L_);
  if (e.kind === "leg"){
    S.trace = L.polyline([e.path[0]], {className:`route trace d${(e.day % NDAY)+1}`, interactive:false}).addTo(L_);
    T.map.flyToBounds(L.latLngBounds(e.path), {...pad, maxZoom:13, duration:1.1});
  } else {
    const b = L.latLng(e.lat, e.lng).toBounds(e.out ? 6000 : 900);
    T.map.flyToBounds(b, {...pad, maxZoom: e.out ? 12 : 15, duration:1.1});
  }
}
function drawStory(){
  const f = S.frames[S.k];
  $("story").classList.toggle("is-end", !!f.end);
  if (f.end){
    const s = tripStats();
    $("st-kicker").textContent = "Fin du voyage";
    $("st-title").textContent = T.trip.title || "Le voyage";
    $("st-cap").textContent = `${s.n} photos · ${s.stops} étapes · ${s.days} jours · ${fmtKm(s.km)} km parcourus`;
    $("st-media").innerHTML = `<div class="st-end"><button class="btn primary big" type="button" id="st-again">Revoir depuis le début</button><button class="btn big" type="button" id="st-done">Explorer la carte</button></div>`;
    $("st-again").onclick = () => storyGo(0); $("st-done").onclick = () => stopStory();
    $("st-bar").innerHTML = ""; $("st-count").textContent = "";
    T.layers.story.clearLayers(); render(true);
    return;
  }
  const e = f.e, frames = S.frames.filter(x => x.e === e), idx = frames.indexOf(f);
  $("story").style.setProperty("--dc", dc(e.day));
  $("st-kicker").textContent = `${dayName(e.day)} · ${T.F.full.format(new Date(f.it ? f.it.at : e.at))}`;
  $("st-title").innerHTML = esc(e.kind === "leg" ? e.label : (e.place || "Étape")) + (e.tag ? ` <span class="flag big">${esc(e.tag)}</span>` : "");
  const cap = e.kind === "leg" ? (f.it?.caption || "") : (idx === 0 ? e.caption : (f.it?.caption && f.it.caption !== e.caption ? f.it.caption : ""));
  $("st-cap").textContent = cap || (e.kind === "leg" ? [e.km >= 1 ? `${fmtKm(e.km)} km` : "", e.from && e.to ? fmtDur(e.to.at - e.from.end) : ""].filter(Boolean).join(" · ") : "");
  if (f.it){
    const tripId = T.id, it = f.it;
    $("st-media").innerHTML = `<img class="kb k${S.k % 4}" src="${esc(it.thumbUrl || "")}" alt="" draggable="false" style="--kbdur:${(f.dur + 800) / 1000}s">`;
    fullPhoto(tripId, it.id).then(u => { const im = $("st-media").querySelector("img"); if (u && im && S.on && S.frames[S.k]?.it === it) im.src = u; });
  } else {
    $("st-media").innerHTML = `<div class="st-illu ${e.kind === "leg" ? "m-" + e.mode : ""}">${e.kind === "leg" ? modeIcon(e.mode) : pinSvg}</div>`;
  }
  $("st-bar").innerHTML = frames.map((x, i) => `<i class="${i < idx ? "done" : ""}"><b></b></i>`).join("");
  const ents = [...new Set(S.frames.filter(x => !x.end).map(x => x.e))];
  $("st-count").textContent = `${ents.indexOf(e) + 1} / ${ents.length}`;
}
function storyTick(now){
  if (!S.on) return;
  const f = S.frames[S.k];
  if (S.playing && !f.end){ S.t += now - S.last; }
  S.last = now;
  if (!f.end){
    const p = Math.min(1, S.t / f.dur);
    const seg = $("st-bar").children[S.frames.filter(x => x.e === f.e).indexOf(f)]?.firstChild; if (seg) seg.style.width = `${p * 100}%`;
    if (f.e.kind === "leg" && S.traveller){
      const raw = Math.min(1, (f.legOffset + S.t) / f.legTotal), ease = raw < .5 ? 2*raw*raw : 1 - Math.pow(-2*raw + 2, 2) / 2;
      const path = f.e.path, kf = ease * (path.length - 1), k0 = Math.floor(kf), k1 = Math.min(path.length - 1, k0 + 1), fr = kf - k0;
      const pos = [path[k0][0] + (path[k1][0] - path[k0][0]) * fr, path[k0][1] + (path[k1][1] - path[k0][1]) * fr];
      S.traveller.setLatLng(pos); S.trace?.setLatLngs([...path.slice(0, k0 + 1), pos]);
      if (f.e.mode === "plane"){ const a = T.map.latLngToLayerPoint(path[k0]), b = T.map.latLngToLayerPoint(path[k1]); const el = S.traveller.getElement()?.querySelector(".traveller"); if (el && (a.x !== b.x || a.y !== b.y)) el.style.setProperty("--rot", `${Math.atan2(b.y-a.y, b.x-a.x) * 180 / Math.PI}deg`); }
    }
    if (S.t >= f.dur) storyGo(S.k + 1);
  }
  S.raf = requestAnimationFrame(storyTick);
}
$("btn-replay").onclick = () => S.on ? stopStory() : startStory();
$("st-close").onclick = () => stopStory();
$("st-play").onclick = storyToggle;
$("st-next").onclick = () => storyGo(S.k + 1);
$("st-prev").onclick = () => storyGo(S.k - 1);
$("st-media").addEventListener("click", e => {
  if (e.target.closest("button")) return;
  const r = $("st-media").getBoundingClientRect();
  if (e.clientX - r.left < r.width * .3) storyGo(S.k - 1); else storyGo(S.k + 1);
});
let stTouch = null;
$("st-media").addEventListener("touchstart", e => { stTouch = [e.touches[0].clientX, e.touches[0].clientY]; }, {passive:true});
$("st-media").addEventListener("touchend", e => {
  if (!stTouch) return; const dy = e.changedTouches[0].clientY - stTouch[1]; stTouch = null;
  if (dy > 100) stopStory();
});

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
