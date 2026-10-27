// Faux Backblaze (S3) pour les tests : envoi simple et en morceaux, lecture publique avec Range, suppression, CORS.
// node tests/mock-s3.cjs [port]   — journal des requêtes sur la sortie standard.
const http = require("http");
const files = new Map(), uploads = new Map();
let n = 0;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, PUT, POST, DELETE", "Access-Control-Allow-Headers": "*", "Access-Control-Expose-Headers": "ETag, Content-Length, Content-Range", "Access-Control-Max-Age": "600" };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), q = u.searchParams, chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks), send = (code, data = "", h = {}) => { res.writeHead(code, { ...cors, ...h }); res.end(data); };
    if (req.method === "OPTIONS") return send(204);
    if (u.pathname.startsWith("/file/")){                                   // lecture publique
      const key = decodeURIComponent(u.pathname.slice(6).split("/").slice(1).join("/")), f = files.get(key);
      if (!f) return send(404, "absent");
      const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
      if (r){ const a = +r[1], b = r[2] ? +r[2] : f.data.length - 1;
        return send(206, f.data.subarray(a, b + 1), { "Content-Type": f.type, "Content-Range": `bytes ${a}-${b}/${f.data.length}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1 }); }
      return send(200, f.data, { "Content-Type": f.type, "Accept-Ranges": "bytes", "Content-Length": f.data.length });
    }
    if (!q.get("X-Amz-Signature") || !q.get("X-Amz-Credential")) return send(403, "<Error>signature</Error>");
    const key = decodeURIComponent(u.pathname.split("/").slice(2).join("/"));
    console.log(req.method, key, [...q.keys()].filter(k => !k.startsWith("X-Amz")).join(","), body.length);
    if (req.method === "PUT" && q.has("partNumber")){ uploads.get(q.get("uploadId")).parts[+q.get("partNumber")] = body; return send(200, "", { ETag: `"p${q.get("partNumber")}"` }); }
    if (req.method === "PUT"){ files.set(key, { data: body, type: req.headers["content-type"] }); return send(200, "", { ETag: '"x"' }); }
    if (req.method === "POST" && q.has("uploads")){ const id = "up" + (++n); uploads.set(id, { key, type: req.headers["content-type"], parts: [] }); return send(200, `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`); }
    if (req.method === "POST" && q.has("uploadId")){ const up = uploads.get(q.get("uploadId")); files.set(key, { data: Buffer.concat(up.parts.filter(Boolean)), type: up.type }); return send(200, "<CompleteMultipartUploadResult/>"); }
    if (req.method === "DELETE"){ files.delete(key); return send(204); }
    send(400);
  });
}).listen(+process.argv[2] || 9000, "127.0.0.1", () => console.log("faux S3 prêt"));
