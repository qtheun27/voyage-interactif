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
  await assertSucceeds(setDoc(doc(db, "trips/malte-2026/photos/b"), { data: "x" }));
  await assertSucceeds(deleteDoc(doc(db, "trips/malte-2026/photos/s1")));
  await assertSucceeds(getDoc(doc(db, "trips/islande-2027/photos/s1")));
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
  await assertFails(setDoc(doc(fake.firestore(), "trips/malte-2026/photos/x"), { data: "x" }));
});

test("déconnexion des visiteurs : l'accès disparaît", async () => {
  const v = visitor(); await assertSucceeds(join(v, "malte-2026", "MALTE-26"));
  const e = ctx("owner", OWNER);
  await assertSucceeds(deleteDoc(doc(e.firestore(), "trips/malte-2026/members/v1")));
  await assertFails(getDoc(doc(v.firestore(), "trips/malte-2026")));
  await assertFails(getDoc(doc(v.firestore(), "trips/malte-2026/photos/s1")));
});
