/* Mon carnet de voyages : plusieurs voyages, suivis sans compte avec un code d'accès ; photos ajoutées par les éditeurs. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut,
  connectAuthEmulator, signInWithCredential, EmailAuthProvider, linkWithCredential, reauthenticateWithCredential, reauthenticateWithPopup,
  updatePassword, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getDocFromCache, getFirestore, doc, getDoc, getDocFromServer, getDocs, setDoc, addDoc, deleteDoc, updateDoc, deleteField, collection, onSnapshot, writeBatch, serverTimestamp, getCountFromServer, connectFirestoreEmulator, Bytes }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, OWNER_EMAIL, OWNER_NAME, emulators } from "./firebase-config.js";
import { toLocalInput, fromLocalInput } from "./lib/time.js";
import { readMeta } from "./lib/exif.js";
import { readVideoMeta } from "./lib/mov.js";
import { putFile, deleteFile, publicUrl, regionOf } from "./lib/s3.js";
import { km, curve, fmtCoord, packPlace, reverseGeocode, searchPlaces, autoPlace, loadCountry, loadWorld, makeLand } from "./lib/geo.js";
import { buildJourney, estimatePosition, legField, MODES } from "./lib/journey.js";
import { loadPack, ICONS } from "./packs/index.js";

const APP = "Mon carnet de voyages";
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
  // Cache local (IndexedDB) : à la réouverture, le carnet et ses miniatures s'affichent tout de suite,
  // seules les nouveautés sont téléchargées.
  try { db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch(_){ db = getFirestore(fb); }
  if (emulators?.host){
    const h = emulators.host;
    connectAuthEmulator(auth, `http://${h}:9099`, {disableWarnings:true});
    connectFirestoreEmulator(db, h, 8080);
    // Connexion « Google » simulée, pour les tests automatiques avec l'émulateur uniquement.
    window.__viTestSignIn = email => signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({sub: email, email, email_verified: true})));
  }
}
let user = null, isEditor = false, editorEmails = [], S3CFG = null;
// Un compte : Google, ou e-mail + mot de passe dont l'adresse est confirmée (les visiteurs sont anonymes).
const isGoogle = u => !!u && !u.isAnonymous && (u.providerData.some(p => p.providerId === "google.com") || (u.emailVerified && u.providerData.some(p => p.providerId === "password")));
async function refreshRole(){
  isEditor = false; editorEmails = [];
  loadProfile();
  if (!isGoogle(user)) return;
  try {
    const s = await getDoc(doc(db, "config/editors"));
    isEditor = true; editorEmails = s.exists() ? (s.data().emails || []) : [];
  } catch(_){ isEditor = false; }
  // Stockage des vidéos (Backblaze B2, compatible S3) : réglages lisibles par les seuls éditeurs.
  S3CFG = null;
  if (isEditor){ try { const c = await getDoc(doc(db, "config/storage")); if (c.exists() && c.data().keyId) S3CFG = c.data(); } catch(_){} }
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
  await afterSignIn("Ce compte Google");
}
/* Seuls les éditeurs ont un compte : les proches suivent un voyage avec son code, sans compte. */
async function afterSignIn(what){
  await refreshRole();
  if (!isEditor){
    toast(`${what} n'est pas éditeur. Pour suivre un voyage, utilise son code.`);
    await signOut(auth); return false;
  }
  $("acct").hidden = true; renderAccounts();
  return true;
}
document.addEventListener("click", e => {
  const a = e.target.closest("[data-action]"); if (!a) return;
  if (a.dataset.action === "editor-signin") openAccount(true);
  if (a.dataset.action === "google-signin") editorSignIn();
  if (a.dataset.action === "account") openAccount();
  if (a.dataset.action === "signout"){ $("acct").hidden = true; signOut(auth).then(() => { location.hash = "#/"; }); }
});

/* L'appli est gardée sur l'appareil (sw.js). Une nouvelle version : rechargée d'elle-même juste après l'ouverture,
   sinon proposée. */
const bootAt = Date.now();
if ("serviceWorker" in navigator && configured && !emulators?.host && location.protocol === "https:"){
  navigator.serviceWorker.register("sw.js").catch(() => {});
  let told = false;
  navigator.serviceWorker.addEventListener("message", e => {
    if (e.data?.type !== "update" || told) return; told = true;
    if (Date.now() - bootAt < 6000 && !adding && $("add").hidden) location.reload();
    else toast("Une nouvelle version de l'appli est prête.", () => location.reload(), "Recharger");
  });
}
let toastTimer = null;
function toast(t, action, button){
  const el = $("toast"); el.textContent = t; el.hidden = false; el.classList.toggle("clickable", !!action && !button);
  el.onclick = action && !button ? () => { el.hidden = true; action(); } : null;
  // Une action à ne pas déclencher par mégarde (« Annuler ») n'a qu'un vrai bouton.
  if (action && button){ const b = document.createElement("button"); b.type = "button"; b.className = "toast-btn"; b.textContent = button;
    b.onclick = () => { el.hidden = true; action(); }; el.append(" ", b); }
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
/* Une image tirée de la vidéo (vers 1 s) : affiche de la vidéo, sur la carte et dans le carnet. */
const isVideoFile = f => /^video\//.test(f.type) || /\.(mov|mp4|m4v|3gp|webm)$/i.test(f.name);
function decodeVideoFrame(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.setAttribute("playsinline", ""); v.src = url;
    let doneOnce = false;
    const fail = () => { if (doneOnce) return; doneOnce = true; clearTimeout(timer); URL.revokeObjectURL(url); reject(new Error("format")); };
    const timer = setTimeout(fail, 20000);
    v.onerror = fail;
    v.onloadedmetadata = () => { v.play?.().then(() => v.pause()).catch(() => {}); v.currentTime = Math.min(1, (v.duration || 2) / 3); };
    v.onseeked = () => { if (doneOnce) return; doneOnce = true; clearTimeout(timer);
      resolve({src: v, w: v.videoWidth || 640, h: v.videoHeight || 360, duration: v.duration, done: () => { v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); }}); };
  });
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
/* La photo en grand : sur Backblaze (photoUrl, haute définition) si elle y est, sinon dans Firestore.
   On ne la montre qu'une fois chargée : en cas d'échec, la miniature reste affichée. */
function fullPhoto(tripId, stopId){
  const k = `${tripId}/${stopId}`;
  const url = T.id === tripId ? T.photos.find(x => x.id === stopId)?.photoUrl : null;
  if (url && !fullLoads.has(k)) fullLoads.set(k, new Promise(res => { const im = new Image(); im.onload = () => res(url); im.onerror = () => { fullLoads.delete(k); res(null); }; im.src = url; }));
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
  renderAccounts();
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
/* ---------- Mon compte : avatar, photo, mot de passe, connexion ---------- */
let myPhoto = null;
const hasAccount = () => isGoogle(user);
const hasPassword = () => !!user?.providerData.some(p => p.providerId === "password");
function storedName(){ try { return localStorage.getItem("vi.name") || ""; } catch(_){ return ""; } }
function myName(){
  if (hasAccount()) return (user.displayName || "").trim() || String(user.email || "").split("@")[0];
  return storedName();
}
const initials = n => String(n || "").trim().split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
const PERSON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
function avatarInner(){
  if (!hasAccount()) return storedName() ? esc(initials(storedName())) : PERSON;
  const src = myPhoto || user.photoURL;
  return src ? `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${esc(initials(myName()))}'))">` : esc(initials(myName()));
}
function renderAccounts(){
  const label = hasAccount() ? `Mon compte (${myName()})` : "Mon compte, connexion éditeur";
  ["home-account", "trip-account", "admin-account"].forEach(id => {
    $(id).innerHTML = `<button class="avatar" type="button" data-action="account" aria-label="${esc(label)}" title="${esc(label)}">${avatarInner()}</button>`;
  });
}
let profileUid = null;
async function loadProfile(){
  const uid = hasAccount() ? user.uid : null;
  if (uid === profileUid) return;
  profileUid = uid; myPhoto = null;
  if (!uid) return renderAccounts();
  try { const s = await getDoc(doc(db, "users", uid)); if (profileUid === uid && s.exists()) myPhoto = imgUrl("me:" + uid, s.data().photo); } catch(_){}
  renderAccounts();
}
function openAccount(login){
  ["ac-msg", "ac-login-msg"].forEach(m => setMsg(m, ""));
  const acc = hasAccount();
  $("ac-title").textContent = acc ? "Mon compte" : login ? "Connexion éditeur" : "Mon compte";
  $("ac-signed").hidden = !acc; $("ac-guest").hidden = acc; $("ac-pw").hidden = true;
  $("ac-me").hidden = !acc && login;
  $("ac-me").innerHTML = `<span class="avatar big">${avatarInner()}</span><span>${acc
    ? `<b>${esc(myName())}</b><small>${esc(user.email || "")}</small>${isEditor ? '<small style="display:block">Éditeur</small>' : ""}`
    : `<b>${esc(storedName() || "Visiteur")}</b><small>Tu suis les voyages avec leur code, sans compte.</small>`}</span>`;
  $("ac-photo-del").hidden = !(acc && myPhoto);
  $("ac-photo-del").textContent = user?.photoURL ? "Reprendre la photo Google" : "Retirer ma photo";
  $("ac-pw-open").textContent = hasPassword() ? "Changer mon mot de passe" : "Créer un mot de passe";
  $("ac-name").value = storedName();
  $("ac-name").closest(".f").hidden = !!login;
  $("acct").hidden = false;
  if (login) setTimeout(() => $("ac-email").focus(), 50);
}
document.querySelectorAll('[data-close="acct"]').forEach(b => b.onclick = () => $("acct").hidden = true);
$("ac-name").addEventListener("change", () => { try { localStorage.setItem("vi.name", $("ac-name").value.trim().slice(0, 40)); } catch(_){} renderAccounts(); });

/* Photo de profil choisie dans la galerie : carrée, 256 px, rangée dans users/{uid}. */
$("ac-photo").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f || !hasAccount()) return;
  setMsg("ac-msg", "Enregistrement de la photo…");
  try {
    const im = await decodeImage(f), side = Math.min(im.w, im.h);
    const c = document.createElement("canvas"); c.width = c.height = 256;
    try { c.getContext("2d").drawImage(im.src, (im.w - side) / 2, (im.h - side) / 2, side, side, 0, 0, 256, 256); } finally { im.done(); }
    const b = await new Promise(r => c.toBlob(r, "image/jpeg", .85)); if (!b) throw new Error("format");
    const bytes = await toBytes(b);
    await setDoc(doc(db, "users", user.uid), { photo: bytes, updatedAt: serverTimestamp() });
    myPhoto = imgUrl("me:" + user.uid, bytes); renderAccounts(); openAccount();
    setMsg("ac-msg", "Photo de profil changée.", "ok");
  } catch(err){ setMsg("ac-msg", err?.message === "format" ? "Cette image n'est pas lisible ici." : "La photo n'a pas pu être enregistrée. Réessaie.", "err"); }
});
$("ac-photo-del").onclick = async () => {
  try { await deleteDoc(doc(db, "users", user.uid)); myPhoto = null; renderAccounts(); openAccount(); setMsg("ac-msg", user.photoURL ? "Photo Google reprise." : "Photo retirée.", "ok"); }
  catch(_){ setMsg("ac-msg", "Impossible pour l'instant. Réessaie.", "err"); }
};

/* Mot de passe : le changer, ou en créer un pour un compte Google (connexion possible ensuite par e-mail). */
$("ac-pw-open").onclick = () => {
  $("ac-pw").reset(); $("ac-pw").hidden = false; $("ac-signed").hidden = true; setMsg("ac-msg", "");
  $("ac-pw-cur-l").hidden = !hasPassword();
  setTimeout(() => (hasPassword() ? $("ac-pw-cur") : $("ac-pw-new")).focus(), 50);
};
$("ac-pw-cancel").onclick = () => { $("ac-pw").hidden = true; $("ac-signed").hidden = false; setMsg("ac-msg", ""); };
const authErr = e => ({
  "auth/wrong-password": "Mot de passe incorrect.", "auth/invalid-credential": "E-mail ou mot de passe incorrect.", "auth/invalid-login-credentials": "E-mail ou mot de passe incorrect.",
  "auth/user-not-found": "E-mail ou mot de passe incorrect.", "auth/weak-password": "Mot de passe trop faible : 8 caractères au moins.",
  "auth/invalid-email": "Cette adresse e-mail n'est pas valide.", "auth/too-many-requests": "Trop d'essais : patiente quelques minutes.",
  "auth/email-already-in-use": "Cette adresse a déjà un compte. Connecte-toi (avec Google si c'est une adresse Gmail), puis crée un mot de passe dans « Mon compte ».",
  "auth/network-request-failed": "Pas de connexion internet.", "auth/popup-closed-by-user": "Connexion Google annulée.",
  "auth/provider-already-linked": "Ce compte a déjà un mot de passe.", "auth/operation-not-allowed": "La connexion par e-mail n'est pas activée dans Firebase."
}[e?.code] || "Ça n'a pas marché. Réessaie.");
$("ac-pw").addEventListener("submit", async e => {
  e.preventDefault();
  const cur = $("ac-pw-cur").value, nw = $("ac-pw-new").value;
  if (nw.length < 8) return setMsg("ac-msg", "Le nouveau mot de passe doit faire 8 caractères au moins.", "err");
  if (nw !== $("ac-pw-new2").value) return setMsg("ac-msg", "Les deux mots de passe ne sont pas identiques.", "err");
  $("ac-pw-save").disabled = true; setMsg("ac-msg", "Enregistrement…");
  try {
    if (hasPassword()){
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, cur));
      await updatePassword(user, nw);
    } else {
      // Compte Google : on lui ajoute un mot de passe (même adresse, même compte).
      const add = async () => {
        try { await linkWithCredential(user, EmailAuthProvider.credential(user.email, nw)); }
        catch(err){ if (err?.code === "auth/email-already-in-use") await updatePassword(user, nw); else throw err; }
      };
      try { await add(); }
      catch(err){
        if (err?.code !== "auth/requires-recent-login") throw err;
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
        await add();
      }
      await user.reload();
    }
    $("ac-pw").hidden = true; $("ac-signed").hidden = false;
    $("ac-pw-open").textContent = "Changer mon mot de passe";
    setMsg("ac-msg", `Mot de passe enregistré. Tu peux aussi te connecter avec ${user.email} et ce mot de passe.`, "ok");
  } catch(err){ setMsg("ac-msg", authErr(err), "err"); }
  $("ac-pw-save").disabled = false;
});

/* Connexion par e-mail et mot de passe (éditeurs). */
const loginFields = () => ({ email: $("ac-email").value.trim(), pass: $("ac-pass").value });
$("ac-login").addEventListener("submit", async e => {
  e.preventDefault();
  const { email, pass } = loginFields();
  if (!email || !pass) return setMsg("ac-login-msg", "Indique ton e-mail et ton mot de passe.", "err");
  $("ac-signin").disabled = true; setMsg("ac-login-msg", "Connexion…");
  try {
    const c = await signInWithEmailAndPassword(auth, email, pass);
    if (!c.user.emailVerified){
      await sendEmailVerification(c.user).catch(() => {});
      await signOut(auth);
      setMsg("ac-login-msg", `Adresse pas encore confirmée : ouvre le lien qu'on vient d'envoyer à ${email}, puis reconnecte-toi.`, "err");
    } else if (await afterSignIn("Ce compte")) { $("ac-login").reset(); }
    else setMsg("ac-login-msg", "Ce compte n'est pas éditeur. Pour suivre un voyage, utilise son lien et son code.", "err");
  } catch(err){ setMsg("ac-login-msg", authErr(err), "err"); }
  $("ac-signin").disabled = false;
});
$("ac-create").onclick = async () => {
  const { email, pass } = loginFields();
  if (!email) return setMsg("ac-login-msg", "Indique ton adresse e-mail.", "err");
  if (pass.length < 8) return setMsg("ac-login-msg", "Choisis un mot de passe de 8 caractères au moins.", "err");
  $("ac-create").disabled = true; setMsg("ac-login-msg", "Création du compte…");
  try {
    const c = await createUserWithEmailAndPassword(auth, email, pass);
    await sendEmailVerification(c.user);
    await signOut(auth);
    setMsg("ac-login-msg", `Compte créé. Ouvre le lien envoyé à ${email} pour confirmer ton adresse, puis connecte-toi. Seules les adresses ajoutées par ${OWNER_NAME} dans les éditeurs peuvent publier.`, "ok");
  } catch(err){ setMsg("ac-login-msg", authErr(err), "err"); }
  $("ac-create").disabled = false;
};
$("ac-forgot").onclick = async () => {
  const { email } = loginFields();
  if (!email) return setMsg("ac-login-msg", "Indique d'abord ton adresse e-mail.", "err");
  try { await sendPasswordResetEmail(auth, email); setMsg("ac-login-msg", `Si un compte existe pour ${email}, un e-mail pour choisir un nouveau mot de passe vient de partir.`, "ok"); }
  catch(err){ setMsg("ac-login-msg", authErr(err), "err"); }
};

/* Prénom des visiteurs, demandé une fois pour les réactions et les commentaires. */
let nameWait = null;
function askName(){
  const n = myName(); if (n) return Promise.resolve(n);
  $("ns-name").value = ""; $("namesheet").hidden = false; setTimeout(() => $("ns-name").focus(), 50);
  return new Promise(r => nameWait = r);
}
function closeName(v){ $("namesheet").hidden = true; const r = nameWait; nameWait = null; r?.(v || ""); }
document.querySelectorAll('[data-close="namesheet"]').forEach(b => b.onclick = () => closeName(""));
$("ns-form").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("ns-name").value.trim().slice(0, 40); if (!v) return $("ns-name").focus();
  try { localStorage.setItem("vi.name", v); } catch(_){}
  renderAccounts(); closeName(v);
});
function tripCard(t, count){
  const status = t.status === "terminé" ? '<span class="pill done">Terminé</span>' : t.status ? '<span class="pill live">En cours</span>' : "";
  const meta = [fmtDates(t), count != null ? `${count} photo${count>1?"s":""}` : ""].filter(Boolean).join(" · ");
  return `<a class="tcard" href="#/v/${encodeURIComponent(t.id)}">
    <div class="cover">${coverSrc(t) ? `<img src="${coverSrc(t)}" alt="" loading="lazy">` : `<span class="iso">${esc(t.country || "")}</span>`}${status}</div>
    <div class="body"><h2>${esc(t.title || t.id)}</h2>${t.subtitle ? `<div class="meta">${esc(t.subtitle)}</div>` : ""}<div class="meta">${esc(meta)}</div></div></a>`;
}
const coverSrc = t => imgUrl("cover:" + t.id, t.cover);
async function renderHome(seq){
  document.title = APP;
  show("screen-home");
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
  gateTrip = id; document.title = APP;
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
  loaded:false, autoNames:{}, mine:new Set(), reacts:new Map(), comments:[] };

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
  clearTimeout(T.renderTimer);
  stopStory(true);
  if (T.map){ T.map.remove(); T.map = null; }
  ["lb","add","place","hero","legsheet"].forEach(id => $(id).hidden = true);
  Object.assign(T, { id:null, trip:null, photos:[], J:null, entries:[], flat:[], filterDay:null, active:null, loaded:false,
    autoNames:{}, streetsOn:false, overview:false, mine:new Set(), reacts:new Map(), comments:[] });
}

async function openTrip(id, seq, force){
  if (!idOk(id)){ location.hash = "#/"; return; }
  if (T.id === id && T.map && !force){ show("screen-trip"); setTimeout(() => T.map?.invalidateSize(), 0); return; }
  closeTrip();
  if (!user) return showGate(id);
  let snap;
  try { const c = await getDocFromCache(doc(db, "trips", id)); if (c.exists()) snap = c; } catch(_){}
  if (!snap) try { snap = await getDoc(doc(db, "trips", id)); }
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
  // La carte (fonds GeoJSON) et les photos se chargent en même temps.
  const mapReady = buildMap();
  T.unsubs.push(onSnapshot(doc(db, "trips", id), s => {
    if (!s.exists()) return;
    const prevTz = T.tz; setTrip(s.data());
    if (!isEditor) remember(id, {id, ...T.trip});
    if (prevTz !== T.tz) render(false); else renderStatus();
  }, () => {}));
  let first = true, fromCache = false;
  T.unsubs.push(onSnapshot(collection(db, `trips/${id}/stops`), {includeMetadataChanges: true}, snap => {
    // Après un affichage depuis le cache, les photos arrivées entre-temps ne sont pas annoncées une à une.
    const changes = snap.docChanges();
    if (!first && !changes.length){ fromCache = snap.metadata.fromCache; return; }   // seulement « synchronisé avec le serveur »
    const added = first || fromCache ? [] : changes.filter(c => c.type === "added").map(c => c.doc.id).filter(x => !T.mine.has(x));
    fromCache = snap.metadata.fromCache;
    T.photos = snap.docs.map(s => { const d = s.data(); return {id:s.id, ...d, thumbUrl: imgUrl("thumb:" + s.id, d.thumb), hasPhoto: !!d.hasPhoto}; })
      .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng) && Number.isFinite(s.at));
    T.loaded = true;
    const after = () => {
      const keepPhoto = lbCurrentId();
      render(isFirst);
      if (isFirst) maybeHero();
      if (added.length) announce(added);
      if (!$("lb").hidden && keepPhoto){ const k = T.flat.findIndex(f => f.e.items[f.i].id === keepPhoto); if (k < 0) closeLb(); else { lbPos = k; if ($("lb-edit").hidden) drawLb(); } }
      fillMissingNames();
    };
    const isFirst = first; first = false;
    // Pendant un gros envoi, les mises à jour arrivent par dizaines : on redessine au plus toutes les 0,6 s.
    clearTimeout(T.renderTimer);
    if (isFirst){ if (T.land) after(); else mapReady.then(() => { if (T.id === id) after(); }); }
    else T.renderTimer = setTimeout(after, adding ? 1500 : 250);
  }, err => {
    T.loaded = true; render(false);
    if (err?.code === "permission-denied") revoked(id);
  }));
  mapReady.then(() => { if (T.id === id && !T.J) render(false); });
  // Réactions et commentaires, en direct.
  T.unsubs.push(onSnapshot(collection(db, `trips/${id}/reactions`), snap => {
    T.reacts = new Map(snap.docs.map(d => [d.id, d.data()]));
    socialChanged();
  }, () => {}));
  let firstC = true;
  T.unsubs.push(onSnapshot(collection(db, `trips/${id}/comments`), snap => {
    const me = auth.currentUser?.uid;
    const fresh = firstC ? [] : snap.docChanges().filter(c => c.type === "added" && c.doc.data().uid !== me).map(c => c.doc.data());
    firstC = false;
    T.comments = snap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => (a.at?.toMillis?.() ?? Infinity) - (b.at?.toMillis?.() ?? Infinity));
    socialChanged();
    if (fresh.length){
      const c = fresh[fresh.length-1], e = T.entries.find(x => x.items.some(it => it.id === c.photoId));
      toast(`💬 ${c.name} : « ${c.text.length > 60 ? c.text.slice(0, 58) + "…" : c.text} »`, e ? () => openEntry(e.id, true) : null);
    }
  }, () => {}));
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
  document.title = `${t.title || "Voyage"} · ${APP}`;
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
  const id = T.id;
  const [pack, country, world] = await Promise.all([loadPack(T.trip.country), loadCountry(T.trip.country), loadWorld()]);
  if (!T.id || T.id !== id) return;
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
  if (key && s){ const n = Math.round((Date.parse(key) - Date.parse(s)) / 864e5) + 1; if (n <= 90) return n; }
  return d + 1;
}
const dayName = d => { const n = dayNo(d); return n >= 1 ? `Jour ${n}` : n === 0 ? "La veille" : "Avant le départ"; };
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
  bike:'<svg viewBox="0 0 24 24"><circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h6l2 7M10 9l3 7h5M9 6h3"/></svg>',
  walk:'<svg viewBox="0 0 24 24"><circle cx="13" cy="4" r="2"/><path d="M10 21l2-6 3 3v3M9 12l2-4 4 2 2 3M11 8l-2 7"/></svg>'
};
const modeIcon = m => MODE_SVG[MODES[m]?.icon || "car"];

function render(fit){
  if (!T.trip || !T.land) return;
  T.J = buildJourney(T.photos, { dayKey, isWater: T.land.isWater, inCountry: T.land.inCountry, autoNames: T.autoNames, airport: T.pack?.airport });
  // Trajets supprimés : invisibles, sauf pour l'éditeur qui demande à les revoir (pour en rétablir un).
  T.entries = T.J.timeline.filter(e => e.kind === "stop" || (e.off ? isEditor && T.showOff : e.notable || (isEditor && e.hidden)));
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
const fmtSec = d => d ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}` : "";
const vbadge = x => x?.video ? `<span class="vbadge"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${esc(fmtSec(x.video.duration))}</span>` : "";
function tripStats(){
  const J = T.J, n = T.photos.filter(p => p.hasPhoto && !p.video).length, nv = T.photos.filter(p => p.video).length;
  const kmTot = J ? J.legs.reduce((s, l) => s + (l.off ? 0 : l.km), 0) : 0;
  return { n, nv, stops: J?.stops.length || 0, days: J?.days.length || 0, km: kmTot,
    last: T.photos.length ? Math.max(...T.photos.map(p => p.created || p.at)) : 0 };
}

/* ---------- Rendu ---------- */
function renderStatus(){
  const st = $("status"); if (!T.trip) return;
  if (!T.loaded){ st.innerHTML = `<span class="pill calm">Chargement</span>`; return; }
  if (!T.photos.length){ st.innerHTML = `<span class="pill calm">Pas encore commencé</span>${T.trip.subtitle ? `<span>${esc(T.trip.subtitle)}</span>` : ""}`; return; }
  const s = tripStats(), live = Date.now() - s.last < 3*3600e3;
  st.innerHTML = `${live ? '<span class="pill live">En direct</span>' : '<span class="pill calm">En différé</span>'}
    <span>${s.n} photo${s.n>1?"s":""}${s.nv ? ` · ${s.nv} vidéo${s.nv>1?"s":""}` : ""} · ${s.stops} étape${s.stops>1?"s":""} · ${s.days} jour${s.days>1?"s":""} · ${fmtKm(s.km)} km parcourus · ${esc(ago(s.last))}</span>`;
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
  $("drag-hint").hidden = !isEditor || T.view !== "carnet" || (T.J?.stops.length || 0) < 2;
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
    return `<section class="day" style="--dc:${dc(d)}"><div class="day-head"><h2>${dayName(d)}</h2><span>${esc(T.F.dayLabel.format(dayDate(d)))}${dd >= .5 ? ` · ${fmtKm(dd)} km` : ""}${st.length ? ` · ${st.length} étape${st.length>1?"s":""}` : ""}</span>${isEditor && dayMessy(d) ? `<button type="button" class="linkbtn dayfix" data-dayfix="${d}">↺ Remettre dans l'ordre des photos</button>` : ""}</div>
      <ol class="stops">${l.map(e => e.kind === "leg" ? legRow(e) : stopRow(e)).join("")}</ol></section>`;
  }).join("");
  const off = isEditor ? T.J.legs.filter(x => x.off).length : 0;
  if (off) el.insertAdjacentHTML("beforeend", `<p class="offlegs"><button type="button" class="linkbtn" id="btn-showoff">${T.showOff
    ? "Cacher les trajets supprimés" : `${off} trajet${off > 1 ? "s" : ""} supprimé${off > 1 ? "s" : ""} · les revoir pour en rétablir un`}</button></p>`);
}
function stopRow(g){
  const ph = g.items.filter(x => x.thumbUrl);
  const t1 = T.F.time.format(new Date(g.at)), t2 = T.F.time.format(new Date(g.end));
  const second = ph.find(x => x.thumbUrl !== g.cover);
  return `<li class="stop ${g.id===T.active?"active":""}">${isEditor ? `<button type="button" class="rowedit" data-edit="${esc(g.id)}" aria-label="Modifier l'étape">${PEN}</button>` : ""}
    <button type="button" data-open="${esc(g.id)}">
      <span class="thumbstack">${ph.length ? `<img src="${esc(g.cover)}" alt="" loading="lazy">${second?`<img src="${esc(second.thumbUrl)}" alt="" loading="lazy">`:""}${ph.length>1?`<b>${ph.length}</b>`:""}${g.items.some(x => x.video) ? '<i class="vmark"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></i>' : ""}` : `<span class="ph">${pinSvg}</span>`}</span>
      <span class="txt"><span class="when">${esc(t1)}${t2!==t1?` – ${esc(t2)}`:""}${g.tag ? `<span class="flag">${esc(g.tag)}</span>` : ""}</span>
      <span class="place">${esc(g.place || "Étape")}${g.approx?'<span class="tag">position estimée</span>':""}</span>
      ${g.caption ? `<span class="cap">${esc(g.caption)}</span>` : ""}${socialMini(g)}</span>
    </button></li>`;
}
const PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
function legRow(l){
  const ph = l.items.filter(x => x.thumbUrl).slice(0, 5);
  const dur = l.to && l.from ? fmtDur(l.to.at - l.from.end) : "";
  const meta = [l.km >= .5 ? `${fmtKm(l.km)} km` : "", l.mode === "plane" && dur ? dur : "", l.items.length ? `${l.items.length} photo${l.items.length>1?"s":""}` : ""].filter(Boolean).join(" · ");
  return `<li class="leg m-${l.mode} ${l.id===T.active?"active":""}${l.hidden?" is-hidden":""}">${isEditor ? `<button type="button" class="rowedit" data-legedit="${esc(l.id)}" aria-label="Modifier le trajet">${PEN}</button>` : ""}
    <button type="button" data-open="${esc(l.id)}" ${l.items.length ? "" : 'data-fly="1"'}>
      <span class="modeico">${modeIcon(l.mode)}</span>
      <span class="txt"><span class="leg-title">${esc(l.label)}${l.off ? ' <span class="tag">supprimé</span>' : l.hidden ? ' <span class="tag">masqué</span>' : ""}</span><span class="when">${esc(meta)}</span>${l.caption ? `<span class="cap">${esc(l.caption)}</span>` : ""}
      ${ph.length ? `<span class="film">${ph.map(x => `<span class="fi"><img src="${esc(x.thumbUrl)}" alt="" loading="lazy">${vbadge(x)}</span>`).join("")}</span>` : ""}</span>
    </button></li>`;
}
function renderGallery(el){
  el.innerHTML = byDay(visibleEntries()).map(([d,l]) => {
    const its = l.flatMap(e => e.items.filter(x => x.thumbUrl));
    if (!its.length) return "";
    return `<section class="day" style="--dc:${dc(d)}"><div class="day-head"><h2>${dayName(d)}</h2><span>${esc(T.F.dayLabel.format(dayDate(d)))} · ${its.length} photo${its.length>1?"s":""}</span></div>
      <div class="gallery">${its.map(x => `<button type="button" data-photo="${esc(x.id)}" aria-label="${x.video ? "Lire la vidéo" : "Ouvrir la photo"}"><img src="${esc(x.thumbUrl)}" alt="" loading="lazy">${vbadge(x)}</button>`).join("")}</div></section>`;
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
    const html = `<div class="${cls}" style="--dc:${dc(g.day)}"><div class="card">${g.cover?`<img src="${esc(g.cover)}" alt="">`:`<div class="noimg">${pinSvg}</div>`}${g.items.some(x => x.video) ? '<span class="pinplay"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>' : ""}</div><span class="num">${g.n}</span>${ph>1?`<span class="count">${ph}</span>`:""}${g.tag?`<span class="pinflag">${esc(g.tag)}</span>`:""}</div>`;
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
    if (l.km < .05 || l.off) return;
    const kind = l.mode === "plane" ? "flight" : l.mode === "boat" ? "sea" : l.mode === "walk" ? "walk" : "road";
    const active = l.id === T.active ? " active" : "";
    L.polyline(l.path, {className:"route-under", interactive:false}).addTo(T.layers.route);
    const line = L.polyline(l.path, {className:`route ${kind} d${(l.day % NDAY)+1}${active}`});
    line.on("click", () => !picking && (isEditor ? openLegSheet(l.id) : openEntry(l.id)));
    line.addTo(T.layers.route);
    if (l.mode === "plane" || l.mode === "boat" || l.km > 3){
      const mid = Math.floor(l.path.length / 2), a = T.map.latLngToLayerPoint(l.path[Math.max(0, mid-1)]), b = T.map.latLngToLayerPoint(l.path[Math.min(l.path.length-1, mid+1)]);
      const rot = l.mode === "plane" ? Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI : 0;
      const m = L.marker(l.path[mid], {icon:L.divIcon({className:"stop-pin", html:`<div class="modepin m-${l.mode}" style="--dc:${dc(l.day)};--rot:${rot}deg" title="${esc(l.label)}">${modeIcon(l.mode)}</div>`, iconSize:[0,0]}), zIndexOffset:-100});
      m.on("click", () => !picking && (isEditor ? openLegSheet(l.id) : l.items.length ? openEntry(l.id) : (T.active = l.id, flyToEntry(l), renderMap(false))));
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
  if (suppressClick){ e.preventDefault(); e.stopPropagation(); return; }
  const fx = e.target.closest("[data-dayfix]"); if (fx){ resetDay(+fx.dataset.dayfix); return; }
  if (e.target.closest("#btn-showoff")){ T.showOff = !T.showOff; render(false); return; }
  const le = e.target.closest("[data-legedit]"); if (le) return openLegSheet(le.dataset.legedit);
  const se = e.target.closest("[data-edit]"); if (se){ openEntry(se.dataset.edit, true); $("lb-editbtn").click(); return; }
  const p = e.target.closest("[data-photo]"); if (p) return openPhoto(p.dataset.photo);
  const b = e.target.closest("[data-open]"); if (!b) return;
  const en = T.entries.find(x => x.id === b.dataset.open);
  if (en && !en.items.length && isEditor && en.kind === "leg") return openLegSheet(en.id);
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
  $("lb-img").innerHTML = it.hasPhoto ? (it.video
    ? `<video class="lb-media" src="${esc(it.video.url)}" poster="${esc(it.thumbUrl || "")}" controls playsinline preload="metadata"></video>`
    : `<img class="lb-media" src="${esc(it.thumbUrl || "")}" alt="${esc(it.caption||e.place||"Photo du voyage")}" draggable="false">`) + `
    ${many?`<button class="arrow l" type="button" data-step="-1" aria-label="Photo précédente"${lbPos?"":" disabled"}>‹</button><button class="arrow r" type="button" data-step="1" aria-label="Photo suivante"${lbPos<T.flat.length-1?"":" disabled"}>›</button>`:""}
    <span class="lb-count">${lbPos+1} / ${T.flat.length}</span>` : "";
  if (it.hasPhoto){
    const tripId = T.id;
    fullPhoto(tripId, it.id).then(url => { const im = $("lb-img").querySelector(".lb-media"); if (url && im && T.id === tripId && lbCurrentId() === it.id){ if (it.video) im.poster = url; else im.src = url; } });
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
  drawSocial();
}
/* ---------- Réactions sur les photos, commentaires sur les étapes ---------- */
const EMOJIS = ["❤️", "😍", "😂", "😮", "👏"];
const splitReact = v => { const i = String(v).indexOf("|"); return i < 0 ? [String(v), ""] : [v.slice(0, i), v.slice(i + 1)]; };
function reactsOf(photoId){ return Object.entries(T.reacts.get(photoId) || {}).map(([uid, v]) => { const [emoji, name] = splitReact(v); return {uid, emoji, name}; }); }
function commentsOf(e){ const ids = new Set(e.items.map(x => x.id)); return T.comments.filter(c => ids.has(c.photoId)); }
function socialMini(e){
  const r = e.items.reduce((n, x) => n + reactsOf(x.id).length, 0), c = commentsOf(e).length;
  return r || c ? `<span class="social-mini">${r ? `<span>❤️ ${r}</span>` : ""}${c ? `<span>💬 ${c}</span>` : ""}</span>` : "";
}
let socialTimer = null;
function socialChanged(){
  if (!$("lb").hidden) drawSocial();
  clearTimeout(socialTimer);
  socialTimer = setTimeout(() => { if (T.trip && T.J && T.view === "carnet" && !dragging()) renderLog(); }, 300);
}
const dragging = () => document.body.classList.contains("dragmode");
const fmtAgo = ts => {
  if (!ts?.toMillis) return "à l'instant";
  const m = (Date.now() - ts.toMillis()) / 60000;
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${Math.round(m)} min`;
  if (m < 60 * 20) return `il y a ${Math.round(m / 60)} h`;
  return T.F.full.format(ts.toDate());
};
function drawSocial(){
  const f = lbCur(); if (!f) return;
  const e = f.e, it = e.items[f.i], me = auth.currentUser?.uid;
  // Réactions : une par personne et par photo ; toucher la même l'enlève.
  const rs = it?.hasPhoto ? reactsOf(it.id) : [];
  const mine = rs.find(r => r.uid === me)?.emoji;
  $("lb-reacts").hidden = !it?.hasPhoto;
  $("lb-reacts").innerHTML = EMOJIS.map(em => { const n = rs.filter(r => r.emoji === em).length;
    return `<button type="button" data-react="${em}" aria-pressed="${mine === em}" aria-label="Réagir ${em}${n ? `, ${n}` : ""}">${em}${n ? `<b>${n}</b>` : ""}</button>`; }).join("");
  const names = rs.map(r => `${r.uid === me ? "Toi" : r.name || "Quelqu'un"} ${r.emoji}`);
  $("lb-who").textContent = names.length > 6 ? `${names.slice(0, 5).join(", ")} et ${names.length - 5} autres` : names.join(", ");
  // Commentaires : sur l'étape (ou le trajet) entière, quelle que soit la photo affichée.
  const cs = commentsOf(e);
  $("lb-comments").hidden = !e.items.length;
  $("lb-c-title").textContent = `Commentaires sur ${e.kind === "leg" ? "ce trajet" : "cette étape"}${cs.length ? ` (${cs.length})` : ""}`;
  $("lb-c-list").innerHTML = cs.length ? cs.map(c => `<li><div class="c-head"><b>${esc(c.uid === me ? "Toi" : c.name)}</b><span>${esc(fmtAgo(c.at))}</span></div><p>${esc(c.text)}</p>${c.uid === me || isEditor ? `<button type="button" class="c-del" data-cdel="${esc(c.id)}">Supprimer</button>` : ""}</li>`).join("")
    : `<li class="c-empty">Pas encore de commentaire. Un petit mot pour les voyageurs ?</li>`;
}
$("lb-reacts").addEventListener("click", async e => {
  const b = e.target.closest("[data-react]"); if (!b) return;
  const f = lbCur(), it = f?.e.items[f.i]; if (!it) return;
  const name = await askName(); if (!name || !auth.currentUser) return;
  const uid = auth.currentUser.uid, emoji = b.dataset.react, tripId = T.id;
  const cur = T.reacts.get(it.id) || {}, same = cur[uid] && splitReact(cur[uid])[0] === emoji;
  const ref = doc(db, `trips/${tripId}/reactions/${it.id}`);
  // Affichage immédiat, corrigé par l'écouteur.
  const next = {...cur}; if (same) delete next[uid]; else next[uid] = `${emoji}|${name}`;
  T.reacts.set(it.id, next); drawSocial();
  try {
    if (same) await updateDoc(ref, {[uid]: deleteField()});
    else await setDoc(ref, {[uid]: `${emoji}|${name}`.slice(0, 80)}, {merge:true});
  } catch(_){ T.reacts.set(it.id, cur); drawSocial(); toast("Ta réaction n'a pas pu être enregistrée."); }
});
const growText = () => { const t = $("lb-c-text"); t.style.height = "auto"; t.style.height = Math.min(140, t.scrollHeight + 2) + "px"; };
$("lb-c-text").addEventListener("input", growText);
$("lb-c-form").addEventListener("submit", async e => {
  e.preventDefault();
  const f = lbCur(); if (!f?.e.items.length) return;
  const text = $("lb-c-text").value.trim().slice(0, 1000); if (!text) return;
  const name = await askName(); if (!name || !auth.currentUser) return;
  $("lb-c-send").disabled = true;
  try {
    await addDoc(collection(db, `trips/${T.id}/comments`), { photoId: f.e.items[0].id, text, name: name.slice(0, 40), uid: auth.currentUser.uid, at: serverTimestamp() });
    $("lb-c-text").value = ""; growText();
  } catch(_){ toast("Ton commentaire n'a pas pu être envoyé. Vérifie la connexion."); }
  $("lb-c-send").disabled = false;
});
$("lb-c-text").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer:fine)").matches){ e.preventDefault(); $("lb-c-form").requestSubmit(); } });
$("lb-c-list").addEventListener("click", async e => {
  const b = e.target.closest("[data-cdel]"); if (!b || !confirm("Supprimer ce commentaire ?")) return;
  try { await deleteDoc(doc(db, `trips/${T.id}/comments/${b.dataset.cdel}`)); } catch(_){ toast("Suppression impossible."); }
});
function closeLb(){ $("lb").hidden = true; $("lb-img").innerHTML = ""; document.body.classList.remove("noscroll"); T.active = null; if (T.trip){ renderLog(); renderMap(false); } }
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
  if (e.key === "Escape" && !$("legsheet").hidden){ $("legsheet").hidden = true; return; }
  if (e.key === "Escape" && !$("newtrip").hidden){ $("newtrip").hidden = true; return; }
  if (e.key === "Escape" && !$("namesheet").hidden){ closeName(""); return; }
  if (e.key === "Escape" && !$("acct").hidden){ $("acct").hidden = true; return; }
  if ($("lb").hidden || !$("lb-edit").hidden) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
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
  if (S3CFG) items.forEach(it => { if (it.video?.key) deleteFile(S3CFG, it.video.key); if (it.photoKey) deleteFile(S3CFG, it.photoKey); });
}
$("lb-editbtn").onclick = () => {
  const { e, i } = lbCur(), it = e.items[i], isStop = e.kind === "stop";
  document.querySelectorAll("#lb-edit .only-stop").forEach(x => x.hidden = !isStop);
  $("e-name").value = isStop ? e.place : ""; $("e-caption").value = isStop ? e.caption : (it.caption || "");
  $("e-caption-label").firstChild.textContent = isStop ? "Petit mot de l'étape" : "Petit mot sur cette photo";
  // L'heure modifiée est celle de la photo (ou vidéo) affichée ; « Décaler toute l'étape » reste possible.
  $("e-when").value = toLocalInput(T.tz, it.at);
  $("e-when-label").textContent = `Heure de cette ${it.video ? "vidéo" : "photo"}`;
  $("e-shift").checked = false; $("e-shift-row").hidden = !isStop || e.items.length < 2;
  $("e-shift").onchange = () => $("e-when").value = toLocalInput(T.tz, $("e-shift").checked ? e.at : it.at);
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
  const manual = isStop && e.items.some(x => x.joinPrev || (x.stopRef && x.stopRef !== x.id));
  $("e-merge").hidden = !manual;
  const here = isStop ? e : null;
  $("e-target").innerHTML = `<option value="">Choisir l'étape…</option>` + T.J.stops.filter(s => s !== here).map(s =>
    `<option value="${esc(s.id)}">${esc(dayName(s.day))} · ${esc(T.F.time.format(new Date(s.at)))} · ${esc(s.place || "Étape")} (${s.items.length})</option>`).join("");
  $("e-split").hidden = !isStop || i === 0;
  $("e-legbtn").hidden = isStop ? !T.J.legs.some(l => l.to === e) : false;
  $("lb-edit").hidden = false; $("lb-nav").hidden = true;
  $("lb-edit").scrollIntoView({block:"nearest"});
};
$("e-cancel").onclick = () => { $("lb-edit").hidden = true; $("lb-nav").hidden = false; };
$("e-merge").onclick = async () => {
  const { e } = lbCur();
  try { await updateEach(e.items, x => (x.joinPrev || x.stopRef) ? {joinPrev: false, stopRef: ""} : {});
    $("lb-edit").hidden = true; $("lb-nav").hidden = false; toast("Rangement manuel annulé : les photos reprennent leur place d'après l'heure et le lieu"); }
  catch(_){ setMsg("e-msg", "La modification a échoué. Réessaie.", "err"); }
};
/* Ranger des photos dans une étape choisie (avec « Annuler »). Leur heure et leur position suivent l'étape
   si elles sont incertaines ou trop éloignées. */
async function moveItemsTo(items, target){
  if (!target || !items.length) return;
  const FIELDS = ["stopRef", "at", "lat", "lng", "approxTime", "approxPos", "joinPrev", "splitHere", "moving", "still"];
  const before = items.map(x => Object.fromEntries(FIELDS.map(k => [k, x[k] ?? (typeof x[k] === "number" ? 0 : k === "stopRef" ? "" : false)])));
  let k = 0;
  await updateEach(items, x => {
    const far = x.approxTime || x.at < target.at - 2*3600e3 || x.at > target.end + 2*3600e3;
    return { stopRef: target.items[0].id, joinPrev: false, splitHere: false, moving: false, still: true,
      ...(far ? { at: target.end + (++k) * 1000, approxTime: true } : {}),
      ...((x.approxPos || x.video || km(x, target) > 1) ? { lat: target.lat, lng: target.lng, approxPos: true } : {}) };
  });
  toast(`${items.length > 1 ? `${items.length} éléments rangés` : "Rangé"} dans « ${target.place || "l'étape"} »`, async () => {
    const b = writeBatch(db); items.forEach((x, i) => b.update(stopRef(x.id), before[i])); await b.commit(); toast("Rangement annulé");
  }, "Annuler");
}
const targetStop = () => T.J.stops.find(s => s.id === $("e-target").value);
$("e-move-photo").onclick = async () => {
  const { e, i } = lbCur(), t = targetStop(); if (!t) return setMsg("e-msg", "Choisis d'abord l'étape.", "err");
  try { await moveItemsTo([e.items[i]], t); closeLb(); } catch(_){ setMsg("e-msg", "Le rangement a échoué. Réessaie.", "err"); }
};
$("e-move-stop").onclick = async () => {
  const { e } = lbCur(), t = targetStop(); if (!t) return setMsg("e-msg", "Choisis d'abord l'étape.", "err");
  try { await moveItemsTo(e.items, t); closeLb(); } catch(_){ setMsg("e-msg", "Le rangement a échoué. Réessaie.", "err"); }
};

/* ---------- Glisser une étape dans une autre (appui long dans le carnet) ---------- */
let drag = null, suppressClick = false;
function dragStart(ev){
  if (!isEditor || T.view !== "carnet" || drag) return;
  const li = ev.target.closest("li.stop"); if (!li || ev.target.closest(".rowedit")) return;
  if (ev.type === "mousedown" && ev.button !== 0) return;
  const pt = ev.touches ? ev.touches[0] : ev, scroller = innerWidth >= 900 ? document.querySelector("aside.log") : null;
  const st = drag = { li, id: li.querySelector("[data-open]")?.dataset.open, x: pt.clientX, y: pt.clientY, on: false, target: null };
  const move = e => {
    const p = e.touches ? e.touches[0] : e;
    if (!st.on){ if (Math.hypot(p.clientX - st.x, p.clientY - st.y) > 10) end(); return; }
    e.preventDefault();
    st.ghost.style.transform = `translate(${p.clientX - st.x}px, ${p.clientY - st.y}px) scale(1.03)`;
    st.ghost.hidden = true; const under = document.elementFromPoint(p.clientX, p.clientY)?.closest("li.stop, li.leg"); st.ghost.hidden = false;
    $("list").querySelectorAll("li.drop, li.ins-before, li.ins-after").forEach(x => x.classList.remove("drop", "ins-before", "ins-after"));
    // Haut ou bas d'une étape, ou sur un trajet : insérer à cet endroit (changer l'ordre). Milieu d'une étape : l'y ranger.
    st.target = under && under !== li ? under : null; st.where = null;
    if (st.target){
      const r = st.target.getBoundingClientRect(), f = (p.clientY - r.top) / r.height;
      st.where = st.target.classList.contains("leg") ? "leg" : f < .3 ? "before" : f > .7 ? "after" : "in";
      st.target.classList.add(st.where === "in" ? "drop" : st.where === "after" ? "ins-after" : "ins-before");
    }
    const sy = p.clientY < 90 ? -14 : p.clientY > innerHeight - 90 ? 14 : 0;
    if (sy) (scroller || window).scrollBy(0, sy);
  };
  const end = () => {
    clearTimeout(st.timer);
    ["touchmove", "mousemove"].forEach(t => document.removeEventListener(t, move));
    ["touchend", "touchcancel", "mouseup"].forEach(t => document.removeEventListener(t, end));
    drag = null;
    if (!st.on) return;
    suppressClick = true; setTimeout(() => suppressClick = false, 400);
    st.ghost.remove(); li.classList.remove("dragging"); document.body.classList.remove("dragmode");
    $("list").querySelectorAll("li.drop, li.ins-before, li.ins-after").forEach(x => x.classList.remove("drop", "ins-before", "ins-after"));
    const src = T.J.stops.find(s => s.id === st.id), tid = st.target?.querySelector("[data-open]")?.dataset.open;
    if (!src || !tid) return;
    if (st.where === "in"){ const dst = T.J.stops.find(s => s.id === tid); if (dst) moveItemsTo(src.items, dst).catch(() => toast("Le rangement a échoué.")); return; }
    // Insertion : entre l'étape de départ et celle d'arrivée du trajet, ou avant / après l'étape visée.
    const stops = T.J.stops.filter(s => s !== src);
    let k;
    if (st.where === "leg"){ const l = T.J.legs.find(x => x.id === tid); k = l?.to ? stops.indexOf(l.to) : stops.length; }
    else { const s = stops.find(x => x.id === tid); k = stops.indexOf(s) + (st.where === "after" ? 1 : 0); }
    if (k < 0) return;
    reorderStop(src, stops[k - 1] || null, stops[k] || null).catch(() => toast("Le déplacement a échoué."));
  };
  st.timer = setTimeout(() => {
    st.on = true; navigator.vibrate?.(25);
    const r = li.getBoundingClientRect();
    st.ghost = li.cloneNode(true); st.ghost.classList.add("drag-ghost");
    Object.assign(st.ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px" });
    document.body.appendChild(st.ghost); li.classList.add("dragging"); document.body.classList.add("dragmode");
  }, 450);
  document.addEventListener("touchmove", move, {passive: false}); document.addEventListener("mousemove", move);
  ["touchend", "touchcancel", "mouseup"].forEach(t => document.addEventListener(t, end));
}
/* « Remettre dans l'ordre des photos » : un jour revient à l'heure et au lieu lus dans les photos, rangé automatiquement.
   Noms, petits mots, étiquettes et réglages des trajets sont gardés ; rangements, déplacements et heures inventées sont oubliés. */
function realTime(x){
  if (x.origAt != null) return x.origAt;
  if (x.gpsAt && !x.gpsStale && Math.abs(x.gpsAt - x.at) > 60000 && Math.abs(x.gpsAt - x.at) < 3 * 3600e3) return x.gpsAt;
  return null;
}
const manualItem = x => x.joinPrev || x.splitHere || (x.stopRef && x.stopRef !== x.id) || x.still || (x.moving && !x.approxPos) || realTime(x) != null && realTime(x) !== x.at;
function dayItems(d){ const k = T.J.days[d]; return T.photos.filter(x => dayKey(x.at) === k || (realTime(x) != null && dayKey(realTime(x)) === k)); }
function dayMessy(d){ return dayItems(d).some(manualItem); }
async function resetDay(d){
  const its = dayItems(d); if (!its.length) return;
  if (!confirm(`Remettre « ${dayName(d)} » dans l'ordre des photos ? Les heures et lieux lus dans les photos reprennent le dessus, les étapes et trajets sont recalculés. Les noms et petits mots sont gardés.`)) return;
  const F = ["at", "approxTime", "origAt", "joinPrev", "splitHere", "stopRef", "still", "moving"];
  const before = its.map(x => Object.fromEntries(F.map(k => [k, x[k] ?? (k === "at" ? x.at : k === "stopRef" ? "" : k === "origAt" ? null : false)])));
  try {
    await updateEach(its, x => { const t = realTime(x);
      return { ...(t != null ? {at: t, approxTime: false} : {}), joinPrev: false, splitHere: false, stopRef: "", still: false, ...(x.approxPos ? {} : {moving: false}) }; });
    toast(`${dayName(d)} remis dans l'ordre des photos`, async () => {
      const b = writeBatch(db); its.forEach((x, i) => b.update(stopRef(x.id), before[i])); await b.commit(); toast("Retour à l'état précédent");
    }, "Annuler");
  } catch(_){ toast("La remise en ordre a échoué. Réessaie."); }
}

/* Changer l'ordre : l'étape prend des heures entre ses nouvelles voisines (marquées estimées). « Annuler » remet tout. */
async function reorderStop(src, prev, next){
  const its = src.items, n = its.length;
  const a = prev ? prev.end : (next ? next.at - 3600e3 : src.at), b = next ? next.at : a + 2 * 3600e3;
  if (prev && next && b - a < (n + 2) * 1000) return toast("Pas de place entre ces deux étapes : change plutôt l'heure dans « Modifier ».");
  const step = (b - a) / (n + 1);
  const before = its.map(x => ({ at: x.at, approxTime: !!x.approxTime, stopRef: x.stopRef || "", joinPrev: !!x.joinPrev, splitHere: !!x.splitHere, moving: !!x.moving, still: !!x.still }));
  await updateEach(its, x => ({ ...(x.origAt == null && !x.approxTime ? {origAt: x.at} : {}), at: Math.round(a + step * (its.indexOf(x) + 1)), approxTime: true, stopRef: "", joinPrev: its.indexOf(x) > 0, splitHere: its.indexOf(x) === 0, moving: false, still: true }));
  toast(`« ${src.place || "Étape"} » déplacée${prev ? ` après « ${prev.place || "l'étape"} »` : " au début"}`, async () => {
    const bt = writeBatch(db); its.forEach((x, i) => bt.update(stopRef(x.id), before[i])); await bt.commit(); toast("Déplacement annulé");
  }, "Annuler");
}
$("list").addEventListener("touchstart", dragStart, {passive: true});
$("list").addEventListener("mousedown", dragStart);
$("e-split").onclick = async () => {
  const { e, i } = lbCur();
  try { await updateEach(e.items, (x, k) => x === e.items[i] ? {splitHere: true, joinPrev: false} : {});
    $("lb-edit").hidden = true; $("lb-nav").hidden = false; toast("Nouvelle étape créée à partir de cette photo"); }
  catch(_){ setMsg("e-msg", "La modification a échoué. Réessaie.", "err"); }
};
$("e-legbtn").onclick = () => {
  const { e } = lbCur(), l = e.kind === "leg" ? e : T.J.legs.find(x => x.to === e);
  if (l){ closeLb(); openLegSheet(l.id); }
};

/* ---------- Fiche d'un trajet : moyen de transport, nom, petit mot ---------- */
let legEditing = null;
function openLegSheet(id){
  const l = T.J?.legs.find(x => x.id === id); if (!l) return;
  legEditing = l;
  const forced = legField(l, "arriveBy");
  $("ls-modes").innerHTML = `<button type="button" data-mode="" aria-pressed="${!forced}"><span class="modeico">${modeIcon(l.mode)}</span><small>Auto</small></button>` +
    Object.entries(MODES).map(([k, m]) => `<button type="button" data-mode="${k}" aria-pressed="${forced === k}"><span class="modeico m-${k}">${modeIcon(k)}</span><small>${esc(m.label.replace(/^En |^À /, ""))}</small></button>`).join("");
  $("ls-from").textContent = [l.from?.place || (l.from ? "Étape" : ""), l.to?.place || (l.to ? "Étape" : "")].filter(Boolean).join(" → ") +
    ` · ${l.km >= .5 ? fmtKm(l.km) + " km · " : ""}${l.items.length} photo${l.items.length>1?"s":""} en route`;
  $("ls-label").value = legField(l, "legLabel"); $("ls-label").placeholder = l.auto || l.label;
  $("ls-caption").value = legField(l, "legCaption");
  $("ls-hidden").checked = l.hidden && !l.off;
  $("ls-delete").textContent = l.off ? "Rétablir ce trajet" : "Supprimer ce trajet";
  $("ls-merge").hidden = !(l.from && l.to);
  setMsg("ls-msg", "");
  $("legsheet").hidden = false;
}
$("ls-modes").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (!b) return; $("ls-modes").querySelectorAll("[data-mode]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
document.querySelectorAll('[data-close="legsheet"]').forEach(b => b.onclick = () => $("legsheet").hidden = true);
$("ls-save").onclick = async () => {
  const l = legEditing; if (!l) return;
  const mode = $("ls-modes").querySelector('[aria-pressed="true"]')?.dataset.mode || "";
  const vals = { arriveBy: mode, legLabel: $("ls-label").value.trim(), legCaption: $("ls-caption").value.trim(), legHidden: $("ls-hidden").checked, legOff: !!l.off };
  // Les réglages vont sur la première photo de l'étape d'arrivée (sinon du trajet) ; on les retire des autres.
  const all = [...(l.to?.items || []), ...l.items], holder = all[0];
  $("ls-save").disabled = true; setMsg("ls-msg", "Enregistrement…");
  try {
    await updateEach(all, x => { const u = {}; Object.entries(vals).forEach(([k, v]) => { const want = x === holder ? v : (typeof v === "boolean" ? false : ""); if ((x[k] || (typeof v === "boolean" ? false : "")) !== want) u[k] = want; }); return u; });
    $("legsheet").hidden = true; toast("Trajet modifié");
  } catch(_){ setMsg("ls-msg", "L'enregistrement a échoué. Réessaie.", "err"); }
  $("ls-save").disabled = false;
};
/* Supprimer un trajet (il disparaît du carnet, de la carte et du récit ; « Rétablir » le fait revenir). */
$("ls-delete").onclick = async () => {
  const l = legEditing; if (!l) return;
  const all = [...(l.to?.items || []), ...l.items], holder = all[0], off = !l.off;
  try {
    await updateEach(all, x => ({ ...(x === holder ? (!!x.legOff !== off ? {legOff: off} : {}) : (x.legOff ? {legOff: false} : {})),
      // Ses photos prises en route rejoignent l'étape d'arrivée (ou de départ) : le trajet disparaît vraiment.
      ...(off && l.items.includes(x) && (l.to || l.from) ? {moving: false, still: true, stopRef: (l.to || l.from).items[0].id} : {}) }));
    $("legsheet").hidden = true;
    toast(off ? "Trajet supprimé" : "Trajet rétabli", off ? () => updateEach([holder], () => ({legOff: false})) : null, off ? "Annuler" : undefined);
  } catch(_){ setMsg("ls-msg", "La modification a échoué. Réessaie.", "err"); }
};
/* Fusionner l'étape d'arrivée (et les photos prises en route) dans l'étape de départ : le trajet disparaît. */
$("ls-merge").onclick = async () => {
  const l = legEditing; if (!l?.from || !l.to) return;
  try { await moveItemsTo([...l.items, ...l.to.items], l.from); $("legsheet").hidden = true; }
  catch(_){ setMsg("ls-msg", "La fusion a échoué. Réessaie.", "err"); }
};

$("e-save").onclick = async () => {
  const { e, i } = lbCur(), it = e.items[i], isStop = e.kind === "stop";
  const name = $("e-name").value.trim(), cap = $("e-caption").value.trim(), t = fromLocalInput(T.tz, $("e-when").value);
  const mode = $("e-mode").value, tag = $("e-tag").value.trim(), moving = $("e-moving").checked;
  $("e-save").disabled = true; setMsg("e-msg", "Enregistrement…");
  try {
    const b = writeBatch(db); const ups = new Map();
    const up = (x, u) => ups.set(x.id, {...(ups.get(x.id) || {}), ...u});
    // Nouvelle heure pour la seule photo affichée : elle quitte son rangement manuel et rejoint l'étape de ce moment-là ;
    // sa position suit si elle n'était qu'estimée (vidéo sans lieu, par exemple).
    const own = t != null && Math.abs(t - it.at) > 59000 && !(isStop && $("e-shift").checked && e.items.length > 1);
    if (own){
      up(it, {at: t, approxTime: false, stopRef: "", joinPrev: false, splitHere: false});
      if (it.approxPos){
        const known = T.photos.filter(p => p.id !== it.id && !p.approxPos).map(p => ({at:p.at, lat:p.lat, lng:p.lng})).sort((a,b) => a.at - b.at);
        const est = estimatePosition(t, known, { airport: T.pack?.airport, inCountry: T.land?.inCountry });
        if (est) up(it, {lat: est.lat, lng: est.lng, approxPos: true, moving: !!est.inFlight, still: !est.inFlight});
      }
    }
    if (isStop){
      const delta = t != null && !own ? t - e.at : 0;
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
      const holder = e.to?.items[0] || e.items[0];
      [...(e.to?.items || []), ...e.items].forEach(x => { const md = x === holder ? mode : ""; if ((x.arriveBy || "") !== md) up(x, {arriveBy: md}); });
      if (!moving) up(it, {moving: false, still: true});
    }
    ups.forEach((u, id) => b.update(stopRef(id), u));
    if (ups.size) await b.commit();
    // Une étape choisie dans « Ranger dans une autre étape » puis « Enregistrer » : on range cette photo.
    const tgt = targetStop();
    if (tgt){ await moveItemsTo([it], tgt); setMsg("e-msg", ""); $("e-save").disabled = false; closeLb(); return; }
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

/* ---------- Ajout de photos (une ou des centaines) ---------- */
let pending = [], chosen = null, planEdits = {}, planAuto = {}, plan = [], adding = false;
function addMsg(t, err){ setMsg("add-msg", t, err ? "err" : null); }
function fillPlaceSelect(){
  const sel = $("f-place");
  sel.innerHTML = `<option value="">Lieu connu…</option>` + (T.pack?.places || []).map(([n],i) => `<option value="${i}">${esc(n)}</option>`).join("");
  sel.hidden = !T.pack?.places?.length;
}
/* Petite vignette (240 px) pour l'aperçu : légère même avec 200 photos. */
async function makePreview(file){
  try {
    const b = await createImageBitmap(file, {resizeWidth: 240, resizeQuality: "medium", imageOrientation: "from-image"});
    const c = document.createElement("canvas"); c.width = b.width; c.height = b.height;
    c.getContext("2d").drawImage(b, 0, 0); b.close?.();
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", .7));
    if (blob) return URL.createObjectURL(blob);
  } catch(_){}
  return URL.createObjectURL(file);
}
/* Exécute fn sur chaque élément, n à la fois. */
async function pool(list, n, fn){
  let i = 0;
  await Promise.all(Array.from({length: Math.min(n, list.length)}, async () => { while (i < list.length){ const k = i++; await fn(list[k], k); } }));
}
/* Déjà publiée ? Même appareil, même seconde, même endroit (ou position incertaine). */
function dupChecker(){
  const bySec = new Map();
  T.photos.forEach(p => { if (!p.hasPhoto) return; const k = Math.round(p.at / 1000) + "|" + (p.device || ""); if (!bySec.has(k)) bySec.set(k, []); bySec.get(k).push(p); });
  // Renvoie la photo déjà publiée qui correspond (ou null).
  return m => {
    if (m.at == null) return null;
    const l = bySec.get(Math.round(m.at / 1000) + "|" + (m.device || ""));
    return l?.find(x => m.lat == null || m.gpsStale || x.gpsStale || x.approxPos || km(x, {lat: m.lat, lng: m.lng}) < .05) || null;
  };
}

function resolvePending(){
  // Heure : photo > GPS > heure choisie (estimée)
  const fallbackAt = fromLocalInput(T.tz, $("f-when").value) ?? Date.now();
  pending.forEach((p,i) => { p.at = p.metaAt ?? (fallbackAt + i*1000); p.approxTime = p.metaAt == null || !!p.stripped; });
  // Position : photo (GPS frais) > choix manuel > estimée : dans l'avion, à l'aéroport d'arrivée,
  // ou d'après la photo la plus proche dans le temps. Un GPS périmé (mode avion) ne compte pas.
  const known = [...pending.filter(p => p.metaLat != null && !p.stripped).map(p => ({at:p.at, lat:p.metaLat, lng:p.metaLng})),
    ...T.photos.filter(p => !p.approxPos).map(p => ({at:p.at, lat:p.lat, lng:p.lng}))].sort((a,b) => a.at - b.at);
  let k = 0;
  pending.forEach(p => {
    p.approxPos = false; p.inFlight = false; p.estPlace = ""; p.stopRef = null;
    // Rangée à la main dans une étape : sa position, et son heure si la sienne est incertaine ou loin de l'étape.
    const t = p.assign ? T.J?.stops.find(s => s.id === p.assign) : null;
    if (t){
      p.stopRef = t.items[0].id; p.lat = t.lat; p.lng = t.lng; p.approxPos = true;
      if (p.approxTime || p.at < t.at - 2*3600e3 || p.at > t.end + 2*3600e3){ p.at = t.end + (++k) * 1000; p.approxTime = true; }
      return;
    }
    if (chosen && (p.metaLat == null || chosen.all)){ p.lat = chosen.lat; p.lng = chosen.lng; return; }
    if (p.metaLat != null){ p.lat = p.metaLat; p.lng = p.metaLng; return; }
    // Vidéo « vidée » par l'iPhone (heure = moment de l'export) : estimée seulement si une photo a été prise juste avant ou après.
    const near = p.stripped && known.some(x => Math.abs(x.at - p.at) < 2*3600e3);
    const est = p.approxTime && !near ? null : estimatePosition(p.at, known, { airport: T.pack?.airport, inCountry: T.land?.inCountry });
    if (est){ p.lat = est.lat; p.lng = est.lng; p.approxPos = true; p.inFlight = !!est.inFlight; p.estPlace = est.place || ""; }
    else if (p.staleLat != null){ p.lat = p.staleLat; p.lng = p.staleLng; p.approxPos = true; }
    else { p.lat = null; p.lng = null; }
  });
}
/* Le plan : comment les nouvelles photos se rangent dans le récit (étapes, trajets), avant publication. */
function buildPlan(){
  const fresh = pending.filter(p => !p.dup && p.lat != null).map(p => ({ id: "new:" + p.key, lat: p.lat, lng: p.lng, at: p.at, hasPhoto: true, stopRef: p.stopRef || undefined,
    thumbUrl: p.preview, approxPos: p.approxPos, moving: p.inFlight || undefined, place: "", caption: "", _p: p }));
  const J = buildJourney([...T.photos, ...fresh], { dayKey, isWater: T.land.isWater, inCountry: T.land.inCountry, autoNames: T.autoNames, airport: T.pack?.airport });
  plan = J.timeline.filter(e => e.items.some(x => x._p)).map(e => {
    const news = e.items.filter(x => x._p), key = news[0].id, old = e.items.filter(x => !x._p);
    return { e, key, news, old, day: e.day, days: J.days };
  });
}
function planName(pl){
  if (pl.e.kind !== "stop") return "";
  if (pl.key in planEdits && planEdits[pl.key].name != null) return planEdits[pl.key].name;
  if (pl.old.length) return pl.e.place;
  const est = pl.news.find(x => x._p.estPlace)?._p.estPlace;
  return est || planAuto[pl.key] || packPlace(T.pack, pl.e.lat, pl.e.lng) || "";
}
function renderPlan(){
  const el = $("plan");
  if (!plan.length){ el.innerHTML = ""; return; }
  let lastDay = null;
  el.innerHTML = plan.map(pl => {
    const { e, key, news } = pl, ed = planEdits[key] || {};
    const head = e.day !== lastDay ? `<div class="plan-day">${esc(T.F.dayLabel.format(new Date(pl.days[e.day] + "T12:00:00Z")))}</div>` : ""; lastDay = e.day;
    const strip = `<div class="plan-strip">${news.slice(0, 8).map(x => x.thumbUrl ? `<span class="fi"><img src="${x.thumbUrl}" alt="" loading="lazy">${x._p.video ? vbadge({video: {duration: x._p.duration}}) : ""}</span>` : `<span>▶</span>`).join("")}${news.length > 8 ? `<span>+${news.length - 8}</span>` : ""}</div>`;
    const t1 = T.F.time.format(new Date(news[0].at)), t2 = T.F.time.format(new Date(news[news.length-1].at));
    if (e.kind === "leg"){
      const mode = ed.mode ?? "";
      return `${head}<div class="plan-item leg m-${mode || e.mode}" data-key="${esc(key)}"><div class="plan-top"><span class="modeico">${modeIcon(mode || e.mode)}</span>
        <div class="plan-txt"><b>${esc(mode ? MODES[mode].label : e.label)}</b><small>${esc(t1)}${t2 !== t1 ? " – " + esc(t2) : ""} · ${news.length} photo${news.length>1?"s":""} en route</small></div>
        <select data-k="mode" aria-label="Moyen de transport"><option value="">Auto</option>${Object.entries(MODES).map(([k, m]) => `<option value="${k}"${k === mode ? " selected" : ""}>${esc(m.label.replace(/^En |^À /, ""))}</option>`).join("")}</select></div>${strip}</div>`;
    }
    const joined = pl.old.length ? `<small class="plan-join">Ajoutées à l'étape existante</small>` : "";
    return `${head}<div class="plan-item stop" data-key="${esc(key)}"><div class="plan-top"><span class="plan-n">${news.length}</span>
      <div class="plan-txt"><input type="text" data-k="name" value="${esc(planName(pl))}" placeholder="Nom de l'étape" maxlength="80" aria-label="Nom de l'étape"><small>${esc(t1)}${t2 !== t1 ? " – " + esc(t2) : ""}${news.some(x => x.approxPos) ? " · position estimée" : ""}</small>${joined}</div></div>
      ${strip}<textarea data-k="caption" rows="1" maxlength="600" placeholder="Petit mot pour cette étape (facultatif)">${esc(ed.caption || "")}</textarea></div>`;
  }).join("");
}
$("plan").addEventListener("input", e => {
  const box = e.target.closest("[data-key]"), k = e.target.dataset.k; if (!box || !k) return;
  const ed = planEdits[box.dataset.key] ??= {};
  ed[k] = e.target.value;
  if (k === "mode"){ renderAdd(); }
});
/* Noms automatiques des nouvelles étapes (pack, sinon OpenStreetMap, 1 requête/s). */
let naming2 = 0;
async function nameNewStops(){
  const run = ++naming2;
  for (const pl of plan){
    if (run !== naming2 || $("add").hidden) return;
    if (pl.e.kind !== "stop" || pl.old.length || pl.key in planAuto || planEdits[pl.key]?.name != null) continue;
    if (packPlace(T.pack, pl.e.lat, pl.e.lng) || pl.news.some(x => x._p.estPlace)) continue;
    const nm = await reverseGeocode(pl.e.lat, pl.e.lng);
    planAuto[pl.key] = nm;
    const inp = $("plan").querySelector(`[data-key="${CSS.escape(pl.key)}"] input[data-k="name"]`);
    if (inp && !inp.value && nm && planEdits[pl.key]?.name == null) inp.value = nm;
  }
}
function renderAdd(){
  resolvePending(); buildPlan(); renderPlan(); nameNewStops();
  const act = pending.filter(p => !p.dup), n = act.length, ups = pending.filter(p => p.upgrade && !p.sent).length, skipped = pending.filter(p => p.skipped).length, dup = pending.length - n - ups - skipped;
  const withT = act.filter(p => !p.approxTime).length, withG = act.filter(p => p.metaLat != null).length;
  const est = act.filter(p => p.approxPos).length, miss = act.filter(p => p.lat == null).length;
  const stops = plan.filter(x => x.e.kind === "stop").length, legs = plan.filter(x => x.e.kind === "leg");
  const src = [...new Set(act.filter(p => p.timeSrc).map(p => p.timeSrc))].join(", ");
  $("summary").innerHTML = `
    <div class="row"><b>${withT===n?"✓":"!"}</b><span>Heure lue dans ${withT===n?"toutes les photos":`${withT} photo${withT>1?"s":""} sur ${n}`}${src?` (${esc(src)})`:""}${withT<n?". Les autres prennent l'heure indiquée plus bas.":""}</span></div>
    <div class="row"><b>${withG===n?"✓":miss?"!":"≈"}</b><span>Position lue dans ${withG===n?"toutes les photos":`${withG} sur ${n}`}${est?`, ${est} estimée${est>1?"s":""} (avant/après, vol)`:""}${miss?`, <b>${miss} sans lieu</b>`:""}.</span></div>
    ${act.some(p => p.stale) ? `<div class="row"><b>≈</b><span>${act.filter(p => p.stale).length} photo(s) au GPS périmé (téléphone sans signal) : placée(s) d'après le trajet.</span></div>` : ""}
    <div class="row"><b>↝</b><span>Rangement automatique : <b>${stops} étape${stops>1?"s":""}</b>${legs.length ? ` et <b>${legs.length} trajet${legs.length>1?"s":""}</b> dessiné${legs.length>1?"s":""} par les photos prises en route` : ""}. Vérifie les noms ci-dessous, tout reste modifiable ensuite.</span></div>
    ${act.some(p => p.video) ? (S3CFG ? `<div class="row"><b>▶</b><span>${act.filter(p => p.video).length} vidéo(s), ${(act.filter(p => p.video).reduce((a, p) => a + p.file.size, 0) / 1e6).toFixed(0)} Mo à envoyer.</span></div>`
      : `<div class="row"><b>!</b><span>${act.filter(p => p.video).length} vidéo(s) : le stockage des vidéos n'est pas encore configuré (Réglages du voyage > Vidéos). Les photos partent quand même.</span></div>`) : ""}
    ${ups ? `<div class="row"><b>✦</b><span><b>${ups} photo${ups>1?"s":""} déjà publiée${ups>1?"s":""}</b> en qualité standard : ${ups>1?"elles seront remplacées":"elle sera remplacée"} par la version haute qualité. Noms, petits mots, étapes et réglages sont gardés.</span></div>` : ""}
    ${dup ? `<div class="row"><b>⤼</b><span>${dup} photo${dup>1?"s":""} déjà publiée${dup>1?"s":""} : ignorée${dup>1?"s":""}.</span></div>` : ""}
    ${chosen?`<div class="row"><b>✓</b><span>Placées sur : ${esc(chosen.name || fmtCoord(chosen.lat,chosen.lng))}</span></div>`:""}`;
  $("where").hidden = !miss && !chosen && !act.some(p => p.assign);
  $("where-title").textContent = miss ? `${miss} photo${miss>1?"s":""} sans position. Où était-ce ?` : "Lieu choisi";
  // Les photos concernées, avec leur heure : on sait de quoi on parle.
  // Chaque photo à placer, avec sa vignette, son heure et le choix de l'étape où la ranger.
  const missing = act.filter(p => p.lat == null || p.assign || (chosen && p.metaLat == null));
  const stopOpts = sel => `<option value="">${chosen ? "Au lieu choisi ci-dessus" : "Choisir l'étape…"}</option>` + (T.J?.stops || []).map(s =>
    `<option value="${esc(s.id)}"${s.id === sel ? " selected" : ""}>${esc(dayName(s.day))} · ${esc(T.F.time.format(new Date(s.at)))} · ${esc(s.place || "Étape")}</option>`).join("");
  $("where-strip").innerHTML = missing.slice(0, 40).map(p => `<div class="miss" data-key="${esc(p.key)}"><span class="fi">${p.preview ? `<img src="${p.preview}" alt="">` : "<span>▶</span>"}${p.video ? vbadge({video: {duration: p.duration}}) : ""}</span>
    <div class="miss-txt"><small>${p.stripped ? "Vidéo sans heure ni lieu (copie faite par l'iPhone)" : p.approxTime ? "Heure inconnue" : `Prise à ${esc(T.F.time.format(new Date(p.at)))}, lieu inconnu`}</small>
    <select data-assign aria-label="Ranger dans l'étape">${stopOpts(p.assign)}</select></div></div>`).join("") + (missing.length > 40 ? `<small>et ${missing.length - 40} autres : utilise le lieu ci-dessus</small>` : "");
  $("btn-skipmiss").hidden = !miss;
  $("coords").textContent = chosen ? fmtCoord(chosen.lat, chosen.lng) : "Aucune position choisie";
  if (withT < n) $("more").open = true;
  $("add-title").textContent = n > 1 ? `${n} nouvelles photos` : n ? "Nouvelle photo" : ups ? "Passer en haute qualité" : "Rien de nouveau";
  $("add-submit").textContent = !n && ups ? `Améliorer ${ups > 1 ? `les ${ups} photos` : "la photo"}` : n > 1 ? `Publier les ${n} photos${ups ? ` (+ ${ups} en HD)` : ""}` : `Publier${ups ? ` (+ ${ups} en HD)` : ""}`;
  $("add-submit").disabled = !(n || ups) || adding;
}
$("f-when").addEventListener("change", renderAdd);
/* Entre le « ✓ » de la photothèque et l'arrivée des fichiers, l'iPhone copie et convertit (surtout les vidéos) :
   un écran d'attente avec le temps écoulé, prêt dès l'ouverture de la photothèque, retiré à l'arrivée des fichiers. */
let prepTimer = null, prepAt = 0;
function prepShow(){
  prepAt = Date.now(); clearInterval(prepTimer);
  $("prep-time").textContent = "0 s"; $("prep-hint").textContent = "Les vidéos sont copiées une par une : cela peut prendre une ou deux minutes. Garde cette page ouverte.";
  $("prep").hidden = false;
  prepTimer = setInterval(() => {
    const s = Math.round((Date.now() - prepAt) / 1000);
    $("prep-time").textContent = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
    if (s === 20) $("prep-hint").textContent = "Toujours en cours… Beaucoup de vidéos ou de longues vidéos prennent plus de temps. Si tu as annulé la sélection, touche Fermer.";
    if (s > 600) prepHide();
  }, 1000);
}
function prepHide(){ clearInterval(prepTimer); $("prep").hidden = true; }
$("prep-close").onclick = prepHide;
$("f-photos").addEventListener("click", () => setTimeout(prepShow, 300));
$("f-photos").addEventListener("cancel", prepHide);
$("f-photos").addEventListener("change", async e => {
  prepHide();
  const files = [...e.target.files]; e.target.value = "";
  if (!files.length || !T.trip) return;
  pending.forEach(p => URL.revokeObjectURL(p.preview));
  pending = []; chosen = null; planEdits = {}; planAuto = {}; plan = [];
  $("add-form").reset(); $("more").open = false; fillPlaceSelect(); $("f-results").hidden = true;
  $("f-when").value = toLocalInput(T.tz, Date.now());
  $("add").hidden = false; $("plan").innerHTML = ""; $("where").hidden = true; addMsg("");
  $("progress").hidden = false; $("add-submit").disabled = true; const nvid = files.filter(isVideoFile).length, nph = files.length - nvid;
  $("add-title").textContent = [nph ? `${nph} photo${nph>1?"s":""}` : "", nvid ? `${nvid} vidéo${nvid>1?"s":""}` : ""].filter(Boolean).join(" et ");
  const bar = $("progress").firstElementChild; let done = 0;
  const isDup = dupChecker();
  const items = new Array(files.length);
  await pool(files, 4, async (f, k) => {
    const video = isVideoFile(f);
    const m = video ? await readVideoMeta(f, T.tz) : await readMeta(f, T.tz); // sur l'original, avant toute compression
    let preview = "";
    if (video){ try { const im = await decodeVideoFrame(f); try { preview = URL.createObjectURL(await toJpeg(im, 240, .7)); m.duration ||= im.duration; } finally { im.done(); } } catch(_){ preview = ""; } }
    else preview = await makePreview(f);
    // L'iPhone donne au navigateur une copie de la vidéo sans ses informations (ni lieu, ni appareil, heure de l'export).
    const stripped = video && !m.device && m.lat == null && m.timeSrc !== "vidéo (avec fuseau)";
    const stale = m.gpsStale;
    const key = `${Math.round((m.at ?? f.lastModified) / 1000)}|${m.device || ""}|${f.size}|${f.name}`;
    const dupOf = isDup(m), dup = !!dupOf;
    // Déjà publiée en qualité standard (Firestore) : on peut la passer en haute qualité sur Backblaze.
    const upgrade = !!(dupOf && S3CFG && !video && !dupOf.photoUrl && !dupOf.video && dupOf.hasPhoto);
    items[k] = {file:f, preview, key, dup, dupOf, upgrade, metaLat: stale ? null : m.lat, metaLng: stale ? null : m.lng, stale, staleLat: stale ? m.lat : null, staleLng: stale ? m.lng : null,
      gpsAt: m.gpsAt, metaAt: m.at, timeSrc: stripped ? null : m.timeSrc, device: m.device, video, stripped, duration: m.duration || null, vw: m.width, vh: m.height};
    done++; bar.style.width = `${done / files.length * 100}%`;
    readProgress(done, files.length, items, files.filter(isVideoFile).length);
  });
  // Doublons à l'intérieur de la sélection
  const seen = new Set(); items.forEach(p => { if (seen.has(p.key)) p.dup = true; seen.add(p.key); });
  pending = items.sort((a,b) => (a.metaAt ?? 9e15) - (b.metaAt ?? 9e15));
  $("progress").hidden = true; bar.style.width = "0";
  renderAdd();
});
function readProgress(done, total, items, nv){
  const got = items.filter(Boolean), thumbs = got.slice(-24).map(p => p.preview ? `<img src="${esc(p.preview)}" alt="">` : `<i></i>`).join("");
  $("summary").innerHTML = `<div class="readprog"><div class="row"><span class="spinner" aria-hidden="true"></span><span><b>Lecture des photos : ${done} sur ${total}</b>
    <small>Heure et lieu lus dans chaque photo${nv ? ` · ${nv} vidéo${nv>1?"s":""} (un peu plus longues à lire)` : ""}</small></span></div><div class="readthumbs">${thumbs}</div></div>`;
}
function closeAdd(){ if (adding) return; pending.forEach(p => URL.revokeObjectURL(p.preview)); pending = []; plan = []; $("add").hidden = true; $("progress").hidden = true; naming2++; }
$("add-close").onclick = closeAdd; $("add-cancel").onclick = closeAdd;
$("f-place").addEventListener("change", () => { const p = T.pack?.places?.[$("f-place").value]; if (!p) return; chosen = {lat:p[1], lng:p[2], name:p[0], all:false}; renderAdd(); });
placeSearch($("f-search"), $("f-results"), x => { chosen = {lat:x.lat, lng:x.lng, name:x.name, all:false}; $("f-place").value = ""; renderAdd(); });
const pickFor = all => { $("add").hidden = true; startPick(all ? "Touche l'endroit où placer toutes ces photos" : "Touche l'endroit où étaient prises ces photos", async ll => {
  if (ll){ chosen = {lat:ll.lat, lng:ll.lng, name:packPlace(T.pack, ll.lat, ll.lng), all}; $("f-place").value = ""; }
  $("add").hidden = false; renderAdd(); }); };
$("btn-pick").onclick = () => pickFor(false);
$("where-strip").addEventListener("change", e => { const s = e.target.closest("[data-assign]"); if (!s) return; const p = pending.find(x => x.key === s.closest("[data-key]").dataset.key); if (p){ p.assign = s.value || null; renderAdd(); } });
$("btn-skipmiss").onclick = () => { pending.forEach(p => { if (!p.dup && p.lat == null){ p.dup = true; p.skipped = true; } }); renderAdd(); };
$("btn-pick2").onclick = () => pickFor(true);

$("add-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (adding) return;
  resolvePending(); buildPlan();
  const todo = pending.filter(p => !p.sent && (!p.dup || p.upgrade));
  if (!todo.length) return;
  if (todo.some(p => !p.upgrade && p.lat == null)){ addMsg("Indique où ont été prises les photos sans position (recherche, liste ou carte).", true); $("where").scrollIntoView({block:"center"}); return; }
  // Ce que le plan dit de chaque photo : nom de l'étape, petit mot, mode du trajet
  const info = new Map();
  plan.forEach(pl => {
    const ed = planEdits[pl.key] || {};
    pl.news.forEach((x, k) => {
      const p = x._p;
      if (pl.e.kind === "stop") info.set(p, { place: planName(pl), caption: k === 0 && !pl.old.length ? (ed.caption || "").trim() : "", captionOld: k === 0 && pl.old.length ? (ed.caption || "").trim() : "" });
      else info.set(p, { place: p.estPlace || "", caption: "", arriveBy: ed.mode || "", leg: true });
    });
  });
  const tripId = T.id, bar = $("progress").firstElementChild, t0 = Date.now();
  adding = true; $("add-submit").disabled = true; $("add-cancel").disabled = true; $("progress").hidden = false;
  let lock = null; try { lock = await navigator.wakeLock?.request("screen"); } catch(_){}
  let done = 0, failed = 0, fatal = null;
  const vids = new Map();
  // Pas encore de couverture : la première photo envoyée la devient (modifiable dans les réglages).
  let wantCover = !T.trip?.cover;
  const tick = () => {
    const left = todo.length - done - failed, per = (Date.now() - t0) / Math.max(1, done);
    const partial = [...vids.values()].reduce((a, b) => a + b, 0);
    bar.style.width = `${(done + failed + partial) / todo.length * 100}%`;
    const v = vids.size ? ` · vidéo ${Math.round(Math.max(...vids.values()) * 100)} %` : "";
    addMsg(`Envoi : ${done} sur ${todo.length}${v}${left && done && !vids.size ? ` · environ ${Math.max(1, Math.round(left * per / 60000))} min restante${left * per > 90000 ? "s" : ""}` : ""}. Garde l'écran allumé.`);
  };
  tick();
  await pool(todo, 2, async p => {
    if (fatal) return;
    // Photo déjà publiée : seule l'image en grand change (2560 px sur Backblaze), tout le reste est gardé.
    if (p.upgrade){
      try {
        const x = p.dupOf, im = await decodeImage(p.file);
        let big; try { big = await toJpeg(im, 2560, .88); } finally { im.done(); }
        const rnd = [...crypto.getRandomValues(new Uint8Array(12))].map(v => v.toString(16).padStart(2, "0")).join("");
        const key = `voyages/${tripId}/${x.id}-${rnd}.jpg`;
        await putFile(S3CFG, key, big, { contentType: "image/jpeg" });
        const b = writeBatch(db);
        b.update(doc(db, `trips/${tripId}/stops/${x.id}`), { photoUrl: publicUrl(S3CFG, key), photoKey: key });
        b.delete(doc(db, `trips/${tripId}/photos/${x.id}`));
        await b.commit();
        fullLoads.delete(`${tripId}/${x.id}`);
        p.sent = true; done++;
      } catch(err){ failed++; if (["resource-exhausted", "permission-denied", "unauthenticated"].includes(err?.code)) fatal = err.code; }
      tick(); return;
    }
    try {
      const id = doc(collection(db, `trips/${tripId}/stops`)).id;
      if (p.video && !S3CFG) throw Object.assign(new Error("novideo"), { novideo: true });
      const im = p.video ? await decodeVideoFrame(p.file) : await decodeImage(p.file);
      // Photo en grand : 2560 px sur Backblaze quand il est branché (qualité), sinon 1600 px dans Firestore.
      const hd = S3CFG && !p.video;
      let big, small, cov = null;
      try {
        big = hd ? await toJpeg(im, 2560, .88) : await jpegUnder(im, 1600, 950000); small = await jpegUnder(im, 400, 60000, .78);
        if (wantCover && !p.video){ wantCover = false; cov = await jpegUnder(im, 1000, 200000, .8); }
      } finally { im.done(); }
      let photo = null;
      if (hd){
        const rnd = [...crypto.getRandomValues(new Uint8Array(12))].map(x => x.toString(16).padStart(2, "0")).join("");
        const key = `voyages/${tripId}/${id}-${rnd}.jpg`;
        await putFile(S3CFG, key, big, { contentType: "image/jpeg" });
        photo = { photoUrl: publicUrl(S3CFG, key), photoKey: key };
      }
      // La vidéo elle-même part sur Backblaze (en morceaux, avec reprise) ; son affiche reste dans Firestore.
      let video = null;
      if (p.video){
        const ext = (/\.([a-z0-9]{2,4})$/i.exec(p.file.name)?.[1] || "mp4").toLowerCase(), rnd = [...crypto.getRandomValues(new Uint8Array(12))].map(x => x.toString(16).padStart(2, "0")).join("");
        const key = `voyages/${tripId}/${id}-${rnd}.${ext}`, type = p.file.type || (ext === "mov" ? "video/quicktime" : "video/mp4");
        vids.set(p, 0);
        await putFile(S3CFG, key, p.file, { contentType: type, onProgress: b => { vids.set(p, b / p.file.size); tick(); } });
        vids.delete(p);
        video = { url: publicUrl(S3CFG, key), key, type, size: p.file.size, duration: p.duration || null, w: p.vw || im.w, h: p.vh || im.h };
      }
      const inf = info.get(p) || {};
      const place = inf.place || (chosen && !p.metaLat ? chosen.name : "") || p.estPlace || packPlace(T.pack, p.lat, p.lng)
        || (p.inFlight ? "" : await reverseGeocode(p.lat, p.lng));
      const docData = { lat:p.lat, lng:p.lng, at:p.at, created:Date.now(), place, caption: inf.caption || inf.captionOld || "",
        thumb: await toBytes(small), hasPhoto: true, approxPos: !!p.approxPos, approxTime: !!p.approxTime, device: p.device || "",
        ...(p.metaAt != null && !p.stripped ? {origAt: p.metaAt} : {}),
        by: user.uid, byName: user.displayName || user.email || "", ...(p.gpsAt ? {gpsAt: p.gpsAt} : {}), ...(p.stale ? {gpsStale: true} : {}),
        ...(p.inFlight ? {moving: true} : {}), ...(inf.arriveBy ? {arriveBy: inf.arriveBy} : {}), ...(video ? {video} : {}), ...(photo || {}),
        ...(p.stopRef ? {stopRef: p.stopRef} : {}) };
      // La photo et l'étape sont écrites ensemble : tout ou rien.
      const b = writeBatch(db);
      if (!photo) b.set(doc(db, `trips/${tripId}/photos/${id}`), { data: await toBytes(big) });
      b.set(doc(db, `trips/${tripId}/stops/${id}`), docData);
      T.mine.add(id);
      await b.commit();
      if (cov) setDoc(doc(db, "trips", tripId), { cover: await toBytes(cov), coverStop: id }, {merge:true}).catch(() => {});
      p.sent = true; done++;
    } catch(err){
      failed++;
      vids.delete(p);
      if (err?.novideo) p.noVideoStore = true;
      else if (err?.message === "format") p.badFormat = true;
      else if (["resource-exhausted", "permission-denied", "unauthenticated"].includes(err?.code)) fatal = err.code;
    }
    tick();
  });
  try { await lock?.release(); } catch(_){}
  adding = false; $("add-cancel").disabled = false;
  const bad = todo.filter(p => p.badFormat).length, rest = todo.filter(p => !p.sent).length, novid = todo.filter(p => p.noVideoStore).length;
  if (!rest){
    bar.style.width = "100%"; closeAdd(); T.filterDay = null;
    const hd = todo.filter(p => p.upgrade).length, nw = done - hd;
    toast([nw ? (nw > 1 ? `${nw} photos publiées` : "Photo publiée") : "", hd ? `${hd} passée${hd>1?"s":""} en haute qualité` : ""].filter(Boolean).join(" · "));
    return;
  }
  pending = pending.filter(p => !p.sent || p.dup);
  renderAdd();
  addMsg(novid && novid === rest ? `${done} publiée${done>1?"s":""}. ${novid} vidéo${novid>1?"s":""} en attente : le stockage des vidéos (Backblaze) n'est pas encore configuré dans les réglages.`
    : fatal === "resource-exhausted" ? `${done} photos publiées. Le quota gratuit de Firebase est atteint pour aujourd'hui : réessaie demain pour les ${rest} autres.`
    : fatal ? "Envoi refusé : ce compte n'est pas éditeur, ou la connexion a expiré. Reconnecte-toi."
    : `${done} photo${done>1?"s":""} publiée${done>1?"s":""}. ${rest} n'ont pas pu être envoyée${rest>1?"s":""}${bad ? ` (dont ${bad} dans un format illisible ici)` : ""} : vérifie la connexion puis appuie sur « Reprendre l'envoi ».`, true);
  $("add-submit").textContent = "Reprendre l'envoi";
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

const S = { on:false, sound:false, frames:[], k:0, playing:true, t:0, last:0, raf:0, entry:null, traveller:null, legT0:0 };
function buildFrames(){
  const frames = [];
  // Les grosses étapes (des dizaines de photos) : une sélection répartie, les photos avec un petit mot d'abord.
  const pick = (its, n) => {
    if (its.length <= n) return its;
    const keep = new Set([...its.filter(x => x.video).slice(0, 2), ...its.filter(x => x.caption)].slice(0, n));
    for (let k = 0; keep.size < n && k < n * 3; k++) keep.add(its[Math.round(k * (its.length - 1) / (n * 3 - 1))]);
    return its.filter(x => keep.has(x));
  };
  visibleEntries().filter(e => !e.off).forEach(e => {
    const its = pick(e.items.filter(x => x.hasPhoto), e.kind === "leg" ? 4 : 6);
    if (e.kind === "leg"){
      if (its.length) its.forEach(it => frames.push({e, it, dur: it.video ? Math.min(30, it.video.duration || 10) * 1000 + 400 : 2800 + Math.min(2500, (it.caption || "").length * 35)}));
      else frames.push({e, it:null, dur: e.mode === "plane" ? 4500 : Math.min(4000, 1800 + e.km * 80)});
    } else if (its.length){
      its.forEach((it, i) => frames.push({e, it, dur: it.video ? Math.min(30, it.video.duration || 10) * 1000 + 400 : 3200 + (i === 0 && e.caption ? Math.min(3500, e.caption.length * 40) : 0)}));
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
  $("story").hidden = true; document.body.classList.remove("storying"); $("st-media").innerHTML = "";
  $("btn-replay").querySelector("span").textContent = "Revivre le voyage";
  T.active = null;
  if (!silent){ setTimeout(() => { T.map?.invalidateSize(); render(true); }, 60); }
}
function drawSound(){ const f = S.frames[S.k], isV = !!f?.it?.video; $("st-sound").hidden = !isV; $("st-sound").setAttribute("aria-pressed", String(!!S.sound)); $("st-sound").setAttribute("aria-label", S.sound ? "Couper le son" : "Activer le son"); }
function storyToggle(){ const v = $("st-media").querySelector("video"); if (v){ S.playing ? v.pause() : v.play().catch(() => {}); }
  S.playing = !S.playing; S.last = performance.now(); $("story").classList.toggle("paused", !S.playing); $("st-play").setAttribute("aria-label", S.playing ? "Pause" : "Lecture"); }
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
    if (it.video){
      $("st-media").innerHTML = `<video class="st-video" src="${esc(it.video.url)}" poster="${esc(it.thumbUrl || "")}" playsinline autoplay preload="auto"></video>`;
      const vid = $("st-media").querySelector("video");
      vid.muted = !S.sound; if (!S.playing) vid.pause(); else vid.play().catch(() => { vid.muted = true; S.sound = false; drawSound(); vid.play().catch(() => {}); });
      vid.onended = () => { if (S.on && S.frames[S.k]?.it === it) storyGo(S.k + 1); };
      fullPhoto(tripId, it.id).then(u => { if (u && vid.isConnected) vid.poster = u; });
    } else {
      $("st-media").innerHTML = `<img class="kb k${S.k % 4}" src="${esc(it.thumbUrl || "")}" alt="" draggable="false" style="--kbdur:${(f.dur + 800) / 1000}s">`;
      fullPhoto(tripId, it.id).then(u => { const im = $("st-media").querySelector("img"); if (u && im && S.on && S.frames[S.k]?.it === it) im.src = u; });
    }
  } else {
    $("st-media").innerHTML = `<div class="st-illu ${e.kind === "leg" ? "m-" + e.mode : ""}">${e.kind === "leg" ? modeIcon(e.mode) : pinSvg}</div>`;
  }
  $("st-bar").innerHTML = frames.map((x, i) => `<i class="${i < idx ? "done" : ""}"><b></b></i>`).join("");
  const ents = [...new Set(S.frames.filter(x => !x.end).map(x => x.e))];
  $("st-count").textContent = `${ents.indexOf(e) + 1} / ${ents.length}`;
  drawSound();
}
function storyTick(now){
  if (!S.on) return;
  const f = S.frames[S.k];
  // Une vidéo qui charge encore ne fait pas avancer le temps.
  const vid = f.it?.video ? $("st-media").querySelector("video") : null;
  if (S.playing && !f.end && (!vid || (vid.readyState >= 3 && !vid.paused))){ S.t += now - S.last; }
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
$("st-sound").onclick = () => { S.sound = !S.sound; const v = $("st-media").querySelector("video"); if (v){ v.muted = !S.sound; if (S.playing) v.play().catch(() => {}); } drawSound(); };
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
let A = { id:null, trip:null, codes:[], coverFile:null, coverStop:null, stops:null };
async function renderAdmin(id, seq){
  if (!isEditor){ location.hash = `#/v/${encodeURIComponent(id)}`; return; }
  A = { id, trip:null, codes:[], coverFile:null, coverStop:null, stops:null };
  $("a-cover-grid").hidden = true; $("a-cover-grid").innerHTML = "";
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
  $("a-video-panel").hidden = user?.email !== OWNER_EMAIL;
  const c = S3CFG || {};
  $("v-endpoint").value = (c.scheme === "http" ? "http://" : "") + (c.endpoint || ""); $("v-bucket").value = c.bucket || ""; $("v-keyid").value = c.keyId || ""; $("v-appkey").value = c.appKey || ""; $("v-public").value = c.publicBase || "";
  setMsg("v-msg", S3CFG ? "Stockage des vidéos configuré." : "", S3CFG ? "ok" : null);
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
/* Couverture : une photo du voyage (l'image en grand est reprise, pas la miniature). */
$("a-cover-pick").onclick = async () => {
  const g = $("a-cover-grid");
  if (!g.hidden){ g.hidden = true; return; }
  g.hidden = false; g.innerHTML = `<div class="muted">Chargement des photos…</div>`;
  if (!A.stops){
    const id = A.id;
    try {
      const l = T.id === id && T.loaded ? T.photos : (await getDocs(collection(db, `trips/${id}/stops`))).docs.map(d => ({id:d.id, ...d.data(), thumbUrl: imgUrl("thumb:" + d.id, d.data().thumb)}));
      if (A.id !== id) return;
      A.stops = l.filter(x => x.thumbUrl).sort((a,b) => a.at - b.at);
    } catch(_){ g.innerHTML = `<div class="muted">Impossible de lire les photos.</div>`; return; }
  }
  const cur = A.coverStop || A.trip?.coverStop;
  g.innerHTML = A.stops.length ? A.stops.map(x => `<button type="button" data-cover="${esc(x.id)}" aria-pressed="${x.id === cur}" aria-label="${esc(x.place || "Photo")}"><img src="${esc(x.thumbUrl)}" alt="" loading="lazy"></button>`).join("")
    : `<div class="muted">Pas encore de photo dans ce voyage.</div>`;
};
$("a-cover-grid").addEventListener("click", e => {
  const b = e.target.closest("[data-cover]"); if (!b) return;
  A.coverStop = b.dataset.cover; A.coverFile = null;
  $("a-cover-grid").querySelectorAll("[data-cover]").forEach(x => x.setAttribute("aria-pressed", x === b));
  $("a-cover-prev").innerHTML = `<img src="${esc(b.querySelector("img").src)}" alt="">`;
  setMsg("a-msg", "Nouvelle couverture prête : appuie sur Enregistrer.");
});
async function coverFromStop(tripId, s){
  let blob = null;
  if (s.photoUrl && !s.video){ try { const r = await fetch(s.photoUrl); if (r.ok) blob = await r.blob(); } catch(_){} }
  if (!blob){ try { const d = await getDoc(doc(db, `trips/${tripId}/photos/${s.id}`)); if (d.exists()) blob = new Blob([d.data().data.toUint8Array()], {type:"image/jpeg"}); } catch(_){} }
  if (!blob && s.thumb) blob = new Blob([s.thumb.toUint8Array()], {type:"image/jpeg"});
  if (!blob) throw new Error("format");
  const im = await decodeImage(blob);
  try { return await jpegUnder(im, 1000, 200000, .8); } finally { im.done(); }
}
$("a-cover").addEventListener("change", e => {
  const f = e.target.files[0]; if (!f) return;
  A.coverFile = f; A.coverStop = null; $("a-cover-prev").innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
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
      u.cover = await toBytes(b); u.coverStop = "";
      A.coverFile = null;
    } else if (A.coverStop){
      const s = A.stops.find(x => x.id === A.coverStop);
      u.cover = await toBytes(await coverFromStop(A.id, s)); u.coverStop = s.id;
      A.coverStop = null; $("a-cover-grid").hidden = true;
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
/* ---------- Stockage des vidéos ---------- */
function videoCfgFromForm(){
  const raw = $("v-endpoint").value.trim(), scheme = /^http:\/\//.test(raw) ? "http" : "https";
  const endpoint = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, ""), bucket = $("v-bucket").value.trim();
  const num = /-(\d{3})\.backblazeb2\.com$/.exec(endpoint)?.[1];
  if (!$("v-public").value.trim() && num && bucket) $("v-public").value = `https://f${num}.backblazeb2.com/file/${bucket}`;
  return { endpoint, scheme, bucket, region: regionOf(endpoint), keyId: $("v-keyid").value.trim(), appKey: $("v-appkey").value.trim(), publicBase: $("v-public").value.trim().replace(/\/$/, "") };
}
["v-endpoint", "v-bucket"].forEach(id => $(id).addEventListener("change", videoCfgFromForm));
$("v-test").onclick = async () => {
  const cfg = videoCfgFromForm();
  if (!cfg.endpoint || !cfg.bucket || !cfg.keyId || !cfg.appKey || !cfg.publicBase) return setMsg("v-msg", "Remplis tous les champs.", "err");
  setMsg("v-msg", "Test en cours…");
  const key = `voyages/_test/${Date.now()}.txt`, body = new Blob(["Mon carnet de voyages : test"], {type: "text/plain"});
  try { await putFile(cfg, key, body, { contentType: "text/plain" }); }
  catch(e){ return setMsg("v-msg", e.status === 403 ? "Envoi refusé : vérifie keyID, applicationKey et le nom du seau." : `Envoi impossible (${e.status || "CORS ou réseau"}). Il faut une règle CORS sur le seau autorisant ce site (PUT, POST, GET, DELETE, en-tête ETag exposé).`, "err"); }
  try { const r = await fetch(publicUrl(cfg, key)); if (!r.ok) throw new Error(r.status); }
  catch(e){ deleteFile(cfg, key); return setMsg("v-msg", "Envoi réussi, mais le fichier n'est pas lisible publiquement : le seau doit être « Public » et l'adresse publique correcte.", "err"); }
  await deleteFile(cfg, key);
  setMsg("v-msg", "Tout fonctionne : envoi, lecture et suppression. Tu peux enregistrer.", "ok");
};
$("v-save").onclick = async () => {
  const cfg = videoCfgFromForm();
  try { await setDoc(doc(db, "config/storage"), cfg); S3CFG = cfg.keyId ? cfg : null; setMsg("v-msg", "Réglages des vidéos enregistrés.", "ok"); }
  catch(_){ setMsg("v-msg", "L'enregistrement a échoué.", "err"); }
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
