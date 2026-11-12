// Local Sound Atlas server for end-to-end tests: serves a bundle (tools/sound-atlas-bundle.sh) and
// runs its edge functions (api/*.js) in-process, so /api/social talks to the real database.
// Usage: DATABASE_URL=… [SA_SCHEMA=sa_e2e] node tools/sound-atlas-serve.mjs <bundle-dir> [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve(process.argv[2] ?? "."), port = +(process.argv[3] ?? 0);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ttf": "font/ttf", ".bin": "application/octet-stream", ".mp3": "audio/mpeg" };
const fns = new Map();
createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    const m = u.pathname.match(/^\/api\/(\w+)$/);
    if (m) {
      if (!fns.has(m[1])) fns.set(m[1], (await import(pathToFileURL(join(dir, "api", m[1] + ".js")).href)).default);
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });
      const r = await fns.get(m[1])(new Request("http://x" + req.url, { method: req.method, headers: req.headers, body }));
      res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = normalize(join(dir, decodeURIComponent(u.pathname))); if (!p.startsWith(dir)) throw 0;
    if ((await stat(p)).isDirectory()) p = join(p, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" }); res.end(await readFile(p));
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(port, "127.0.0.1", function () { console.log(`http://127.0.0.1:${this.address().port}/`); });
