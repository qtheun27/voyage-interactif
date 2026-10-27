// Lecteur EXIF intégré sur des JPEG générés par Pillow (tests/make_jpegs.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readJpegExif, interpretMeta } from "../lib/exif.js";

const TZ = "Europe/Malta";
const load = n => { const b = readFileSync(new URL(`./fixtures/${n}`, import.meta.url)); return readJpegExif(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const iso = t => new Date(t).toISOString().slice(0,19) + "Z";

test("GPS + fuseau + appareil", () => {
  const r = load("gps_fuseau.jpg");
  assert.equal(r.dto, "2026:10:24 18:12:05"); assert.equal(r.off, "+02:00");
  assert.equal(iso(r.gpsUtc), "2026-10-24T16:12:05Z");
  const m = interpretMeta(r, TZ);
  assert.ok(Math.abs(m.lat - 35.8989) < 1e-4, m.lat); assert.ok(Math.abs(m.lng - 14.5146) < 1e-4, m.lng);
  assert.equal(iso(m.at), "2026-10-24T16:12:05Z");
  assert.equal(m.timeSrc, "photo (avec fuseau)"); assert.equal(m.device, "Apple iPhone 15");
});
test("sans fuseau : interprétée à l'heure de Malte, nuit du changement d'heure", () => {
  const m = interpretMeta(load("sans_fuseau_changement_heure.jpg"), TZ);
  assert.equal(m.lat, null); assert.equal(m.timeSrc, "photo"); assert.equal(m.device, "Canon EOS R6");
  assert.equal(iso(m.at), "2026-10-25T01:30:00Z");
});
test("heure de l'appareil fausse : l'heure GPS (UTC) l'emporte", () => {
  const m = interpretMeta(load("heure_fausse_gps_juste.jpg"), TZ);
  assert.equal(iso(m.at), "2026-10-27T12:00:00Z"); assert.equal(m.timeSrc, "GPS");
  assert.ok(Math.abs(m.lat - 36.04444) < 1e-4 && Math.abs(m.lng - 14.23972) < 1e-4);
});
test("hémisphères sud et ouest, fuseau négatif", () => {
  const m = interpretMeta(load("sud_ouest.jpg"), TZ);
  assert.ok(m.lat < -34.5 && m.lng < -58.3, `${m.lat},${m.lng}`);
  assert.equal(iso(m.at), "2026-01-10T12:00:00Z");
});
test("sans métadonnées / pas un JPEG", () => {
  const m = interpretMeta(load("sans_meta.jpg"), TZ);
  assert.deepEqual([m.lat, m.lng, m.at], [null, null, null]);
  assert.equal(readJpegExif(new Uint8Array([0x89,0x50,0x4e,0x47,0,0,0,0,0,0,0,0]).buffer), null);
});
