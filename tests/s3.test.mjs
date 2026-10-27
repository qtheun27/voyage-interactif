// Signature V4 : exemple officiel d'AWS (URL présignée, « GET /test.txt », 24 mai 2013).
import { test } from "node:test";
import assert from "node:assert/strict";
import { presign, regionOf, publicUrl } from "../lib/s3.js";

test("URL présignée identique à l'exemple de la documentation AWS", async () => {
  const url = await presign({ method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", region: "us-east-1",
    accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", expires: 86400, date: new Date("2013-05-24T00:00:00Z") });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  assert.match(url, /X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request/);
});
test("région Backblaze et adresse publique", () => {
  assert.equal(regionOf("s3.eu-central-003.backblazeb2.com"), "eu-central-003");
  assert.equal(publicUrl({ publicBase: "https://f003.backblazeb2.com/file/mon-seau/" }, "voyages/malte-2026/a b.mov"), "https://f003.backblazeb2.com/file/mon-seau/voyages/malte-2026/a%20b.mov");
});
