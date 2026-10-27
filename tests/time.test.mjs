// Heure murale -> UTC autour du changement d'heure du 25 octobre 2026 (Europe/Malta).
import { test } from "node:test";
import assert from "node:assert/strict";
import { wallToUtc, tzOffsetMin, parseExifDate, toLocalInput, fromLocalInput } from "../lib/time.js";

const TZ = "Europe/Malta";
const iso = t => new Date(t).toISOString().slice(0,19) + "Z";

test("décalages de Malte autour du 25 octobre 2026", () => {
  assert.equal(tzOffsetMin(TZ, Date.UTC(2026,9,25,0,59)), 120); // encore l'été
  assert.equal(tzOffsetMin(TZ, Date.UTC(2026,9,25,1,0)), 60);   // 03:00 CEST -> 02:00 CET
});
test("heures normales, la veille et le lendemain", () => {
  assert.equal(iso(wallToUtc(TZ, 2026,10,24,18,12,5)), "2026-10-24T16:12:05Z");
  assert.equal(iso(wallToUtc(TZ, 2026,10,25,12,0,0)), "2026-10-25T11:00:00Z");
  assert.equal(iso(wallToUtc(TZ, 2026,10,25,1,59,0)), "2026-10-24T23:59:00Z");
  assert.equal(iso(wallToUtc(TZ, 2026,10,25,3,0,0)), "2026-10-25T02:00:00Z");
});
test("heure ambiguë 02:30 (existe deux fois) : la seconde, à l'heure d'hiver", () => {
  const t = wallToUtc(TZ, 2026,10,25,2,30,0);
  assert.equal(iso(t), "2026-10-25T01:30:00Z");
  assert.equal(toLocalInput(TZ, t), "2026-10-25T02:30"); // aller-retour cohérent
});
test("heure inexistante du printemps (29 mars 2026, 02:30)", () => {
  // 02:30 n'existe pas : on obtient 03:30 heure d'été
  assert.equal(iso(wallToUtc(TZ, 2026,3,29,2,30,0)), "2026-03-29T01:30:00Z");
});
test("le fuseau EXIF fait foi quand il est présent", () => {
  assert.equal(iso(parseExifDate(TZ, "2026:10:25 02:30:00", "+02:00")), "2026-10-25T00:30:00Z");
  assert.equal(iso(parseExifDate(TZ, "2026:10:25 02:30:00", "+01:00")), "2026-10-25T01:30:00Z");
  assert.equal(iso(parseExifDate("Atlantic/Reykjavik", "2026:10:25 02:30:00", null)), "2026-10-25T02:30:00Z");
  assert.equal(parseExifDate(TZ, "0000:00:00 00:00:00"), null);
  assert.equal(parseExifDate(TZ, ""), null);
});
test("champ datetime-local aller-retour, été et hiver", () => {
  for (const s of ["2026-10-24T23:15", "2026-10-25T03:05", "2026-10-31T08:00", "2026-07-14T12:00"])
    assert.equal(toLocalInput(TZ, fromLocalInput(TZ, s)), s);
});
