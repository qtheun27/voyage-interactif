// Règles Firestore avec l'émulateur : npm run test:rules
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, collectionGroup, updateDoc, serverTimestamp } from "firebase/firestore";

let env;
const OWNER = { email: "q.theuninck@gmail.com", email_verified: true, firebase: { sign_in_provider: "google.com" } };
const anon = { firebase: { sign_in_provider: "anonymous" } };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-voyage",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 }
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "config/editors"), { emails: ["q.theuninck@gmail.com", "compagne@example.com"] });
    for (const [id, code] of [["malte-2026", "MALTE-26"], ["islande-2027", "ISLANDE-27"]]){
      await setDoc(doc(db, `trips/${id}`), { title: id, country: "MLT" });
      await setDoc(doc(db, `trips/${id}/codes/${code}`), {});
      await setDoc(doc(db, `trips/${id}/stops/s1`), { lat: 35.9, lng: 14.5, at: 1 });
      await setDoc(doc(db, `trips/${id}/photos/s1`), { data: "jpeg" });
    }
  });
});
// Un seul client Firestore/Storage par contexte (l'émulateur refuse de les réinitialiser).
function ctx(uid, token){
  const c = token ? env.authenticatedContext(`${uid}`, token) : env.unauthenticatedContext();
  let f; return { firestore: () => (f ??= c.firestore()) };
}
const visitor = (uid = "v1") => ctx(uid, anon);
const join = (ctx, trip, code, uid = "v1") => setDoc(doc(ctx.firestore(), `trips/${trip}/members/${uid}`), { code, joinedAt: serverTimestamp() });

test("visiteur sans code : ne voit rien", async () => {
  const v = visitor(); const db = v.firestore();
  await assertFails(getDoc(doc(db, "trips/malte-2026")));
  await assertFails(getDocs(collection(db, "trips")));
  await assertFails(getDocs(collection(db, "trips/malte-2026/stops")));
  await assertFails(getDocs(collection(db, "trips/malte-2026/codes")));
  await assertFails(getDoc(doc(db, "trips/malte-2026/codes/MALTE-26")));
  await assertFails(getDocs(collectionGroup(db, "codes")));
  await assertFails(getDoc(doc(db, "config/editors")));
  await assertFails(getDoc(doc(db, "config/storage")));
  await assertFails(getDoc(doc(v.firestore(), "trips/malte-2026/photos/s1")));
  const u = ctx();
  await assertFails(getDoc(doc(u.firestore(), "trips/malte-2026")));
  await assertFails(join(u, "malte-2026", "MALTE-26"));
});

test("mauvais code refusé, bon code accepté", async () => {
  const v = visitor();
  await assertFails(join(v, "malte-2026", "FAUX-CODE"));
  await assertFails(join(v, "malte-2026", "ISLANDE-27"));          // code d'un autre voyage
  await assertFails(join(v, "malte-2026", "MALTE-26", "autre-uid")); // pour quelqu'un d'autre
  await assertFails(setDoc(doc(v.firestore(), "trips/malte-2026/members/v1"), { code: "MALTE-26", joinedAt: 1, admin: true }));
  await assertSucceeds(join(v, "malte-2026", "MALTE-26"));
  await assertSucceeds(getDoc(doc(v.firestore(), "trips/malte-2026/members/v1")));
  await assertFails(getDoc(doc(v.firestore(), "trips/malte-2026/members/v2")));
  await assertFails(getDocs(collection(v.firestore(), "trips/malte-2026/members")));
  await assertFails(updateDoc(doc(v.firestore(), "trips/malte-2026/members/v1"), { code: "AUTRE" }));
});

test("visiteur avec le code de Malte : voit Malte, rien d'Islande", async () => {
  const v = visitor(); await assertSucceeds(join(v, "malte-2026", "MALTE-26"));
  const db = v.firestore();
  await assertFails(getDoc(doc(db, "config/storage")));  // même avec le code, jamais la clé vidéo
  await assertSucceeds(getDoc(doc(db, "trips/malte-2026")));
  await assertSucceeds(getDocs(collection(db, "trips/malte-2026/stops")));
  await assertSucceeds(getDoc(doc(db, "trips/malte-2026/photos/s1")));
  await assertFails(getDoc(doc(db, "trips/islande-2027")));
  await assertFails(getDocs(collection(db, "trips/islande-2027/stops")));
  await assertFails(getDoc(doc(db, "trips/islande-2027/photos/s1")));
  await assertFails(getDocs(collection(db, "trips")));
  await assertFails(getDocs(collection(db, "trips/malte-2026/codes")));
  await assertFails(getDocs(collectionGroup(db, "stops")));
  // et ne peut rien écrire
  await assertFails(setDoc(doc(db, "trips/malte-2026/stops/x"), { lat: 1 }));
  await assertFails(updateDoc(doc(db, "trips/malte-2026"), { title: "piraté" }));
  await assertFails(setDoc(doc(db, "trips/malte-2026/codes/MONCODE"), {}));
  await assertFails(setDoc(doc(db, "trips/malte-2026/photos/b"), { data: "x" }));
  await assertFails(deleteDoc(doc(db, "trips/malte-2026/photos/s1")));
});

test("éditeur : tout voir, tout gérer", async () => {
  const e = ctx("owner", OWNER), db = e.firestore();
  await assertSucceeds(getDocs(collection(db, "trips")));
  await assertSucceeds(getDoc(doc(db, "trips/islande-2027")));
  await assertSucceeds(getDocs(collection(db, "trips/malte-2026/codes")));
  await assertSucceeds(setDoc(doc(db, "trips/malte-2026/codes/NOUVEAU-1"), {}));
  await assertSucceeds(deleteDoc(doc(db, "trips/malte-2026/codes/MALTE-26")));
  await assertSucceeds(setDoc(doc(db, "trips/malte-2026/stops/s2"), { lat: 1, lng: 2, at: 3 }));
  await assertSucceeds(getDocs(collection(db, "trips/malte-2026/members")));
  await assertSucceeds(updateDoc(doc(db, "config/editors"), { emails: ["q.theuninck@gmail.com"] }));
  await assertSucceeds(setDoc(doc(db, "config/storage"), { keyId: "k", appKey: "secret" }));
  await assertSucceeds(setDoc(doc(db, "trips/malte-2026/photos/b"), { data: "x" }));
  await assertSucceeds(deleteDoc(doc(db, "trips/malte-2026/photos/s1")));
  await assertSucceeds(getDoc(doc(db, "trips/islande-2027/photos/s1")));
});

test("éditrice ajoutée dans config/editors, non-éditeurs refusés", async () => {
  const c = ctx("c", { email: "compagne@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } });
  await assertSucceeds(getDoc(doc(c.firestore(), "trips/malte-2026")));
  await assertSucceeds(setDoc(doc(c.firestore(), "trips/malte-2026/stops/s3"), { lat: 1 }));
  await assertFails(updateDoc(doc(c.firestore(), "config/editors"), { emails: ["pirate@example.com"] })); // seul le propriétaire
  await assertSucceeds(getDoc(doc(c.firestore(), "config/storage")));                  // les éditeurs lisent la clé vidéo
  await assertFails(setDoc(doc(c.firestore(), "config/storage"), { keyId: "x" }));      // seul le propriétaire la change
  // Google mais pas dans la liste
  const g = ctx("g", { email: "inconnu@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } });
  await assertFails(getDoc(doc(g.firestore(), "trips/malte-2026")));
  await assertFails(getDocs(collection(g.firestore(), "trips")));
  // Bon e-mail mais connexion anonyme / e-mail non vérifié
  const fake = ctx("f", { email: "q.theuninck@gmail.com", email_verified: false, firebase: { sign_in_provider: "password" } });
  await assertFails(getDocs(collection(fake.firestore(), "trips")));
  await assertFails(setDoc(doc(fake.firestore(), "trips/malte-2026/photos/x"), { data: "x" }));
});

test("déconnexion des visiteurs : l'accès disparaît", async () => {
  const v = visitor(); await assertSucceeds(join(v, "malte-2026", "MALTE-26"));
  const e = ctx("owner", OWNER);
  await assertSucceeds(deleteDoc(doc(e.firestore(), "trips/malte-2026/members/v1")));
  await assertFails(getDoc(doc(v.firestore(), "trips/malte-2026")));
  await assertFails(getDoc(doc(v.firestore(), "trips/malte-2026/photos/s1")));
});

test("éditeur par e-mail et mot de passe : seulement avec une adresse vérifiée", async () => {
  const pw = ctx("p", { email: "compagne@example.com", email_verified: true, firebase: { sign_in_provider: "password" } });
  await assertSucceeds(getDocs(collection(pw.firestore(), "trips")));
  await assertSucceeds(setDoc(doc(pw.firestore(), "trips/malte-2026/stops/s4"), { lat: 1 }));
  const nv = ctx("n", { email: "compagne@example.com", email_verified: false, firebase: { sign_in_provider: "password" } });
  await assertFails(getDocs(collection(nv.firestore(), "trips")));
  const other = ctx("o", { email: "inconnu@example.com", email_verified: true, firebase: { sign_in_provider: "password" } });
  await assertFails(getDoc(doc(other.firestore(), "trips/malte-2026")));
});

test("profil : photo lisible et modifiable par son seul titulaire", async () => {
  const o = ctx("owner", OWNER), db = o.firestore();
  const { Bytes } = await import("firebase/firestore");
  await assertSucceeds(setDoc(doc(db, "users/owner"), { photo: Bytes.fromUint8Array(new Uint8Array(1000)), updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(db, "users/owner")));
  await assertFails(setDoc(doc(db, "users/owner"), { photo: Bytes.fromUint8Array(new Uint8Array(160000)) }));  // trop lourde
  await assertFails(setDoc(doc(db, "users/owner"), { photo: "x", admin: true }));
  await assertFails(setDoc(doc(db, "users/autre"), { updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(visitor().firestore(), "users/owner")));
  await assertFails(setDoc(doc(visitor("v9").firestore(), "users/v9"), { updatedAt: serverTimestamp() })); // visiteur anonyme
  await assertSucceeds(deleteDoc(doc(db, "users/owner")));
});

test("réactions : membres et éditeurs, chacun son propre champ", async () => {
  const v = visitor(); await assertSucceeds(join(v, "malte-2026", "MALTE-26"));
  const db = v.firestore(), r = doc(db, "trips/malte-2026/reactions/s1");
  await assertSucceeds(setDoc(r, { v1: "❤️|Mamie" }));
  await assertSucceeds(getDoc(r));
  const e = ctx("owner", OWNER);
  await assertSucceeds(updateDoc(doc(e.firestore(), "trips/malte-2026/reactions/s1"), { owner: "👏|Quentin" }));
  await assertFails(updateDoc(r, { owner: "😂|Mamie" }));            // pas le champ d'un autre
  await assertFails(updateDoc(r, { v1: "x".repeat(81) }));
  await assertSucceeds(updateDoc(r, { v1: "😮|Mamie" }));
  const { deleteField } = await import("firebase/firestore");
  await assertSucceeds(updateDoc(r, { v1: deleteField() }));
  await assertFails(deleteDoc(r));
  await assertFails(setDoc(doc(db, "trips/islande-2027/reactions/s1"), { v1: "❤️|Mamie" }));  // autre voyage
  await assertFails(setDoc(doc(visitor("v2").firestore(), "trips/malte-2026/reactions/s2"), { v2: "❤️|X" })); // sans code
  await assertFails(setDoc(doc(db, "trips/malte-2026/reactions/s3"), { v1: "❤️", v2: "❤️" }));
});

test("commentaires : créés par les membres, supprimés par l'auteur ou un éditeur", async () => {
  const v = visitor(); await assertSucceeds(join(v, "malte-2026", "MALTE-26"));
  const db = v.firestore();
  const ok = { photoId: "s1", text: "Superbe !", name: "Mamie", uid: "v1", at: serverTimestamp() };
  await assertSucceeds(setDoc(doc(db, "trips/malte-2026/comments/c1"), ok));
  await assertSucceeds(getDocs(collection(db, "trips/malte-2026/comments")));
  await assertFails(setDoc(doc(db, "trips/malte-2026/comments/c2"), { ...ok, uid: "autre" }));
  await assertFails(setDoc(doc(db, "trips/malte-2026/comments/c3"), { ...ok, text: "" }));
  await assertFails(setDoc(doc(db, "trips/malte-2026/comments/c4"), { ...ok, at: 5 }));
  await assertFails(setDoc(doc(db, "trips/malte-2026/comments/c5"), { ...ok, admin: true }));
  await assertFails(updateDoc(doc(db, "trips/malte-2026/comments/c1"), { text: "modifié" }));
  await assertFails(setDoc(doc(db, "trips/islande-2027/comments/c1"), ok));
  const v2 = visitor("v2"); await assertSucceeds(join(v2, "malte-2026", "MALTE-26", "v2"));
  await assertFails(deleteDoc(doc(v2.firestore(), "trips/malte-2026/comments/c1")));
  await assertSucceeds(setDoc(doc(v2.firestore(), "trips/malte-2026/comments/c6"), { ...ok, uid: "v2", name: "Papy" }));
  await assertSucceeds(deleteDoc(doc(db, "trips/malte-2026/comments/c1")));
  await assertSucceeds(deleteDoc(doc(ctx("owner", OWNER).firestore(), "trips/malte-2026/comments/c6")));
});

test("éditeur d'un seul voyage : son voyage, pas les autres", async () => {
  await env.withSecurityRulesDisabled(async c => {
    const a = c.firestore();
    await setDoc(doc(a, "trips/malte-2026"), { title: "Malte", country: "MLT", editors: ["cousine@example.com"] });
    await setDoc(doc(a, "config/editors"), { emails: ["q.theuninck@gmail.com"], tripEmails: ["cousine@example.com"] });
    await setDoc(doc(a, "config/storage"), { keyId: "k" });
  });
  const c = ctx("cz", { email: "cousine@example.com", email_verified: true, firebase: { sign_in_provider: "password" } }), db = c.firestore();
  const { query, where } = await import("firebase/firestore");
  await assertSucceeds(getDocs(query(collection(db, "trips"), where("editors", "array-contains", "cousine@example.com"))));
  await assertFails(getDocs(collection(db, "trips")));                                    // pas la liste de tous les voyages
  await assertSucceeds(getDoc(doc(db, "trips/malte-2026")));
  await assertSucceeds(getDocs(collection(db, "trips/malte-2026/stops")));
  await assertSucceeds(setDoc(doc(db, "trips/malte-2026/stops/n1"), { lat: 1 }));
  await assertSucceeds(setDoc(doc(db, "trips/malte-2026/photos/n1"), { data: "x" }));
  await assertSucceeds(updateDoc(doc(db, "trips/malte-2026"), { subtitle: "Octobre" }));
  await assertFails(updateDoc(doc(db, "trips/malte-2026"), { editors: ["cousine@example.com", "ami@example.com"] })); // ne s'ajoute personne
  await assertFails(deleteDoc(doc(db, "trips/malte-2026")));
  await assertSucceeds(getDocs(collection(db, "trips/malte-2026/codes")));
  await assertSucceeds(getDoc(doc(db, "config/storage")));                                 // pour envoyer vidéos et photos HD
  await assertFails(getDoc(doc(db, "config/editors")));
  await assertFails(getDoc(doc(db, "trips/islande-2027")));
  await assertFails(setDoc(doc(db, "trips/islande-2027/stops/n1"), { lat: 1 }));
  await assertFails(setDoc(doc(db, "trips/nouveau"), { title: "x" }));
  // Même adresse non confirmée : rien
  const nv = ctx("nv", { email: "cousine@example.com", email_verified: false, firebase: { sign_in_provider: "password" } });
  await assertFails(getDoc(doc(nv.firestore(), "trips/malte-2026")));
  await assertFails(getDoc(doc(nv.firestore(), "config/storage")));
});
