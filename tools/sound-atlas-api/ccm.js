// Vercel edge function, deployed as /api/ccm next to the Sound Atlas bundle.
// ccMixter hotlink-protects its mp3s: it serves them only with its own Referer, which a browser
// will not send from another origin. This streams one file through with that Referer, passing
// Range so seeking works. Only ccmixter.org/content/*.mp3 is reachable; nothing else is proxied.
export const config = { runtime: "edge" };

const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

export default async function handler(req) {
  const p = new URL(req.url).searchParams.get("p") ?? "";
  if (!/^[\w\-.%]+\/[\w\-.%()',!~]+\.mp3$/i.test(p) || p.includes("..")) return new Response("bad path", { status: 400 });
  const headers = { Referer: "https://ccmixter.org/" };
  const range = req.headers.get("range"); if (range) headers.Range = range;
  const up = await fetch("https://ccmixter.org/content/" + p, { headers });
  // Never edge-cache: the CDN keys on URL, not Range, so a cached 206 would answer every seek.
  const out = new Headers({ "cache-control": "private, no-store" });
  for (const k of PASS) { const v = up.headers.get(k); if (v) out.set(k, v); }
  return new Response(up.body, { status: up.status, headers: out });
}
