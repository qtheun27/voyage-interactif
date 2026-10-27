/* Stockage compatible S3 (Backblaze B2) : URL présignées (AWS Signature V4) calculées dans le navigateur
   d'un éditeur, puis envoi direct (simple ou en plusieurs morceaux, avec reprise). */
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha256hex = async s => hex(await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s));
async function hmac(key, s){
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(s));
}
export const uriEncode = (s, encodeSlash = true) => {
  const e = encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return encodeSlash ? e : e.replace(/%2F/g, "/");
};
/* URL présignée. path : « /seau/cle » (style chemin) ou « /cle » si le seau est dans host. */
export async function presign({ method, host, path, region, accessKey, secretKey, expires = 3600, query = {}, date = new Date(), scheme = "https" }){
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, ""), day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const q = { ...query, "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${accessKey}/${scope}`,
    "X-Amz-Date": amzDate, "X-Amz-Expires": String(expires), "X-Amz-SignedHeaders": "host" };
  const qs = Object.keys(q).sort().map(k => `${uriEncode(k)}=${uriEncode(String(q[k]))}`).join("&");
  const cpath = uriEncode(path, false);
  const canonical = [method, cpath, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256hex(canonical)].join("\n");
  let k = await hmac("AWS4" + secretKey, day); k = await hmac(k, region); k = await hmac(k, "s3"); k = await hmac(k, "aws4_request");
  return `${scheme}://${host}${cpath}?${qs}&X-Amz-Signature=${hex(await hmac(k, toSign))}`;
}

/* Réglages : { endpoint: "s3.eu-central-003.backblazeb2.com", bucket, keyId, appKey, publicBase } */
export const regionOf = endpoint => (/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(endpoint) || [])[1] || "us-east-1";
const sign = (cfg, method, key, query = {}, expires = 3600) => presign({ method, host: cfg.endpoint, path: `/${cfg.bucket}/${key}`,
  region: cfg.region || regionOf(cfg.endpoint), accessKey: cfg.keyId, secretKey: cfg.appKey, query, expires, scheme: cfg.scheme || "https" });
export const publicUrl = (cfg, key) => `${cfg.publicBase.replace(/\/$/, "")}/${uriEncode(key, false)}`;

function xhr(method, url, body, { onProgress, contentType, signal } = {}){
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    if (contentType) x.setRequestHeader("Content-Type", contentType);
    x.upload && (x.upload.onprogress = e => onProgress?.(e.loaded));
    x.onload = () => x.status >= 200 && x.status < 300 ? resolve(x) : reject(Object.assign(new Error(`S3 ${x.status}`), { status: x.status, body: x.responseText }));
    x.onerror = () => reject(Object.assign(new Error("réseau"), { network: true }));
    signal?.addEventListener("abort", () => x.abort());
    x.send(body ?? null);
  });
}
const retry = async (fn, n = 4) => { for (let i = 0; ; i++){ try { return await fn(); } catch(e){ if (i >= n - 1 || (e.status && e.status < 500 && e.status !== 408 && e.status !== 429)) throw e; await new Promise(r => setTimeout(r, 1000 * 2 ** i)); } } };

/* Envoie un fichier ; au-delà de 32 Mo, en morceaux de 16 Mo (3 à la fois, chacun réessayé). onProgress(octets envoyés). */
export async function putFile(cfg, key, file, { onProgress, contentType } = {}){
  const type = contentType || file.type || "application/octet-stream";
  if (file.size <= 32 * 1024 * 1024){
    await retry(async () => xhr("PUT", await sign(cfg, "PUT", key), file, { contentType: type, onProgress }));
    onProgress?.(file.size);
    return;
  }
  const PART = 16 * 1024 * 1024, n = Math.ceil(file.size / PART), sent = new Array(n).fill(0);
  const report = () => onProgress?.(sent.reduce((a, b) => a + b, 0));
  const init = await retry(async () => xhr("POST", await sign(cfg, "POST", key, { uploads: "" }), null, { contentType: type }));
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(init.responseText)?.[1];
  if (!uploadId) throw new Error("UploadId manquant");
  const etags = new Array(n);
  try {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, n) }, async () => {
      while (next < n){
        const i = next++, blob = file.slice(i * PART, Math.min(file.size, (i + 1) * PART));
        const r = await retry(async () => xhr("PUT", await sign(cfg, "PUT", key, { partNumber: String(i + 1), uploadId }), blob, { onProgress: b => { sent[i] = b; report(); } }));
        sent[i] = blob.size; report();
        etags[i] = r.getResponseHeader("ETag");
        if (!etags[i]) throw new Error("ETag illisible : ajouter ETag aux en-têtes exposés (CORS) du seau");
      }
    }));
    const xml = `<CompleteMultipartUpload>${etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${e}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
    await retry(async () => xhr("POST", await sign(cfg, "POST", key, { uploadId }), xml, { contentType: "application/xml" }));
  } catch(e){
    sign(cfg, "DELETE", key, { uploadId }).then(u => xhr("DELETE", u)).catch(() => {});
    throw e;
  }
}
export async function deleteFile(cfg, key){ try { await xhr("DELETE", await sign(cfg, "DELETE", key)); } catch(_){} }
