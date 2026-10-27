// Métadonnées vidéo : MOV d'iPhone (clés Apple : date avec fuseau, ISO 6709) et MP4 Android (©xyz, mvhd).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readVideoMeta, readMoov, parseIso6709, parseQtDate } from "../lib/mov.js";

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

// Boîtes fabriquées à la main : une piste avec sa propre « meta » avant celle du film (comme les iPhone récents)
const box = (type, ...parts) => { const body = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p, "latin1"))); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, "latin1"); return Buffer.concat([h, body]); };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const keys = list => box("keys", u32(0), u32(list.length), ...list.map(k => Buffer.concat([u32(8 + k.length), Buffer.from("mdta"), Buffer.from(k)])));
const item = (i, val) => { const t = u32(i).toString("latin1"); return box(t, box("data", u32(1), u32(0), Buffer.from(val, "utf8"))); };
const qtmeta = (k, vals) => box("meta", box("hdlr", Buffer.alloc(24)), keys(k), box("ilst", ...vals.map((x, i) => item(i + 1, x))));
test("iPhone récent : clés de piste et clés du film séparées", () => {
  const moov = Buffer.concat([
    box("trak", qtmeta(["com.apple.quicktime.video-orientation", "com.apple.quicktime.live-photo.auto"], ["1", "0"])),
    qtmeta(["com.apple.quicktime.make", "com.apple.quicktime.model", "com.apple.quicktime.location.ISO6709", "com.apple.quicktime.creationdate"],
      ["Apple", "iPhone 15 Pro Max", "+35.8990+014.5120+020.000/", "2026-10-26T13:31:05+0100"])
  ]);
  const m = readMoov(new DataView(moov.buffer, moov.byteOffset, moov.byteLength), "Europe/Malta");
  assert.equal(m.device, "Apple iPhone 15 Pro Max");
  assert.ok(Math.abs(m.lat - 35.899) < 1e-6 && Math.abs(m.lng - 14.512) < 1e-6, `${m.lat},${m.lng}`);
  assert.equal(iso(m.at), "2026-10-26T12:31:05Z");
});
test("secours : position et date retrouvées dans le texte des métadonnées", () => {
  const moov = box("udta", box("XYZW", "garbage +35.8990+014.5120+020.000/ 2026-10-26T13:31:05+0100 end"));
  const m = readMoov(new DataView(moov.buffer, moov.byteOffset, moov.byteLength), "Europe/Malta");
  assert.ok(Math.abs(m.lat - 35.899) < 1e-6, String(m.lat)); assert.equal(iso(m.at), "2026-10-26T12:31:05Z");
});
