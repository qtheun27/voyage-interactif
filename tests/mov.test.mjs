// Métadonnées vidéo : MOV d'iPhone (clés Apple : date avec fuseau, ISO 6709) et MP4 Android (©xyz, mvhd).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readVideoMeta, parseIso6709, parseQtDate } from "../lib/mov.js";

const asFile = n => { const b = readFileSync(new URL(`./fixtures/videos/${n}`, import.meta.url)); return new Blob([b]); };
const iso = t => new Date(t).toISOString().slice(0, 19) + "Z";

test("vidéo d'iPhone : date avec fuseau, position, appareil, durée, taille", async () => {
  const m = await readVideoMeta(asFile("iphone.mov"), "Europe/Malta");
  assert.equal(iso(m.at), "2026-10-26T08:32:10Z");
  assert.ok(Math.abs(m.lat - 36.025) < 1e-6 && Math.abs(m.lng - 14.299) < 1e-6, `${m.lat},${m.lng}`);
  assert.equal(m.device, "Apple iPhone 15 Pro Max");
  assert.ok(Math.abs(m.duration - 3) < .1, String(m.duration));
  assert.deepEqual([m.width, m.height], [640, 360]);
  assert.equal(m.timeSrc, "vidéo (avec fuseau)");
});
test("vidéo MP4 (Android) : position ©xyz et heure UTC du conteneur", async () => {
  const m = await readVideoMeta(asFile("android.mp4"), "Europe/Malta");
  assert.equal(iso(m.at), "2026-10-25T12:00:00Z");
  assert.ok(Math.abs(m.lat - 35.8989) < 1e-6 && Math.abs(m.lng - 14.5146) < 1e-6, `${m.lat},${m.lng}`);
  assert.deepEqual([m.width, m.height], [480, 854]);
});
test("formats ISO 6709 et dates QuickTime", () => {
  assert.deepEqual(parseIso6709("-34.6037-058.3816/"), { lat: -34.6037, lng: -58.3816 });
  assert.equal(parseIso6709("+00.0000+000.0000/"), null);
  assert.equal(iso(parseQtDate("2026-10-25T02:30:00", "Europe/Malta")), "2026-10-25T01:30:00Z");
  assert.equal(iso(parseQtDate("2026-07-01T12:00:00Z", "Europe/Malta")), "2026-07-01T12:00:00Z");
});
test("pas une vidéo : rien d'inventé", async () => {
  const m = await readVideoMeta(new Blob([new Uint8Array(64)]), "Europe/Malta");
  assert.equal(m.at, null); assert.equal(m.lat, null);
});
