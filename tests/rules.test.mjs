// Règles Firestore + Storage avec l'émulateur : npm run test:rules
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, collectionGroup, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getBytes, deleteObject } from "firebase/storage";

let env;
const OWNER = { email: "q.theuninck@gmail.com", email_verified: true, firebase: { sign_in_provider: "google.com" } };
const anon = { firebase: { sign_in_provider: "anonymous" } };
const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-voyage",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 }
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore(); await env.clearStorage();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "config/editors"), { emails: ["q.theuninck@gmail.com", "compagne@example.com"] });
    for (const [id, code] of [["malte-2026", "MALTE-26"], ["islande-2027", "ISLANDE-27"]]){
      await setDoc(doc(db, `trips/${id}`), { title: id, country: "MLT" });
      await setDoc(doc(db, `trips/${id}/codes/${code}`), {});
      await setDoc(doc(db, `trips/${id}/stops/s1`), { lat: 35.9, lng: 14.5, at: 1 });
    }
    const st = ctx.storage();
    await uploadBytes(ref(st, "voyages/malte-2026/a.jpg"), png, { contentType: "image/jpeg" });
    await uploadBytes(ref(st, "voyages/islande-2027/a.jpg"), png, { contentType: "image/jpeg" });
  });
});
// Un seul client Firestore/Storage par contexte (l'émulateur refuse de les réinitialiser).
function ctx(uid, token){
  const c = token ? env.authenticatedContext(`${uid}`, token) : env.unauthenticatedContext();
  let f, s; return { firestore: () => (f ??= c.firestore()), storage: () => (s ??= c.storage()) };
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
  await assertFails(getBytes(ref(v.storage(), "voyages/malte-2026/a.jpg")));
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
  const db = v.firestore(), st = v.storage();
  await assertSucceeds(getDoc(doc(db, "trips/malte-2026")));
  await assertSucceeds(getDocs(collection(db, "trips/malte-2026/stops")));
  await assertSucceeds(getBytes(ref(st, "voyages/malte-2026/a.jpg")));
  await assertFails(getDoc(doc(db, "trips/islande-2027")));
  await assertFails(getDocs(collection(db, "trips/islande-2027/stops")));
  await assertFails(getBytes(ref(st, "voyages/islande-2027/a.jpg")));
  await assertFails(getDocs(collection(db, "trips")));
  await assertFails(getDocs(collection(db, "trips/malte-2026/codes")));
  await assertFails(getDocs(collectionGroup(db, "stops")));
  // et ne peut rien écrire
  await assertFails(setDoc(doc(db, "trips/malte-2026/stops/x"), { lat: 1 }));
  await assertFails(updateDoc(doc(db, "trips/malte-2026"), { title: "piraté" }));
  await assertFails(setDoc(doc(db, "trips/malte-2026/codes/MONCODE"), {}));
  await assertFails(uploadBytes(ref(st, "voyages/malte-2026/b.jpg"), png, { contentType: "image/jpeg" }));
  await assertFails(deleteObject(ref(st, "voyages/malte-2026/a.jpg")));
});

test("éditeur : tout voir, tout gérer", async () => {
  const e = ctx("owner", OWNER), db = e.firestore(), st = e.storage();
  await assertSucceeds(getDocs(collection(db, "trips")));
  await assertSucceeds(getDoc(doc(db, "trips/islande-2027")));
  await assertSucceeds(getDocs(collection(db, "trips/malte-2026/codes")));
  await assertSucceeds(setDoc(doc(db, "trips/malte-2026/codes/NOUVEAU-1"), {}));
  await assertSucceeds(deleteDoc(doc(db, "trips/malte-2026/codes/MALTE-26")));
  await assertSucceeds(setDoc(doc(db, "trips/malte-2026/stops/s2"), { lat: 1, lng: 2, at: 3 }));
  await assertSucceeds(getDocs(collection(db, "trips/malte-2026/members")));
  await assertSucceeds(updateDoc(doc(db, "config/editors"), { emails: ["q.theuninck@gmail.com"] }));
  await assertSucceeds(uploadBytes(ref(st, "voyages/malte-2026/b.jpg"), png, { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(st, "voyages/malte-2026/c.txt"), png, { contentType: "text/plain" }));
  await assertFails(uploadBytes(ref(st, "voyages/malte-2026/big.jpg"), new Uint8Array(21 * 1024 * 1024), { contentType: "image/jpeg" }));
  await assertSucceeds(deleteObject(ref(st, "voyages/malte-2026/a.jpg")));
  await assertSucceeds(getBytes(ref(st, "voyages/islande-2027/a.jpg")));
});

test("éditrice ajoutée dans config/editors, non-éditeurs refusés", async () => {
  const c = ctx("c", { email: "compagne@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } });
  await assertSucceeds(getDoc(doc(c.firestore(), "trips/malte-2026")));
  await assertSucceeds(setDoc(doc(c.firestore(), "trips/malte-2026/stops/s3"), { lat: 1 }));
  await assertFails(updateDoc(doc(c.firestore(), "config/editors"), { emails: ["pirate@example.com"] })); // seul le propriétaire
  // Google mais pas dans la liste
  const g = ctx("g", { email: "inconnu@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } });
  await assertFails(getDoc(doc(g.firestore(), "trips/malte-2026")));
  await assertFails(getDocs(collection(g.firestore(), "trips")));
  // Bon e-mail mais connexion anonyme / e-mail non vérifié
  const fake = ctx("f", { email: "q.theuninck@gmail.com", email_verified: false, firebase: { sign_in_provider: "password" } });
  await assertFails(getDocs(collection(fake.firestore(), "trips")));
  await assertFails(uploadBytes(ref(fake.storage(), "voyages/malte-2026/x.jpg"), png, { contentType: "image/jpeg" }));
});

test("déconnexion des visiteurs : l'accès disparaît", async () => {
  const v = visitor(); await assertSucceeds(join(v, "malte-2026", "MALTE-26"));
  const e = ctx("owner", OWNER);
  await assertSucceeds(deleteDoc(doc(e.firestore(), "trips/malte-2026/members/v1")));
  await assertFails(getDoc(doc(v.firestore(), "trips/malte-2026")));
  await assertFails(getBytes(ref(v.storage(), "voyages/malte-2026/a.jpg")));
});
