// Vercel edge function, deployed as /api/ccm next to the Sound Atlas bundle.
// ccMixter hotlink-protects its mp3s: it serves them only with its own Referer, which a browser
// will not send from another origin. This streams one file through with that Referer, passing
// Range so seeking works. Only ccmixter.org/content/*.mp3 is reachable that way.
// ?u=https://incompetech.com/music/…mp3 also streams through: incompetech sends no CORS headers, and the
// audiophile pane's Web Audio graph (aural.js) hears silence from cross-origin media without them.
export const config = { runtime: "edge" };

const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

export default async function handler(req) {
  const q = new URL(req.url).searchParams, u = q.get("u");
  if (u !== null) {
    let url; try { url = new URL(u); } catch { return new Response("bad url", { status: 400 }); }
    if (url.origin !== "https://incompetech.com" || !url.pathname.startsWith("/music/") || !/\.mp3$/i.test(url.pathname) || url.pathname.includes("..") || url.search) return new Response("bad url", { status: 400 });
    return pass(await fetch(url, { headers: req.headers.get("range") ? { Range: req.headers.get("range") } : {} }));
  }
  const p = q.get("p") ?? "";
  if (!/^[\w\-.%]+\/[\w\-.%()',!~]+\.mp3$/i.test(p) || p.includes("..")) return new Response("bad path", { status: 400 });
  const headers = { Referer: "https://ccmixter.org/" };
  const range = req.headers.get("range"); if (range) headers.Range = range;
  return pass(await fetch("https://ccmixter.org/content/" + p, { headers }));
}
function pass(up) {
  // Never edge-cache: the CDN keys on URL, not Range, so a cached 206 would answer every seek.
  const out = new Headers({ "cache-control": "private, no-store" });
  for (const k of PASS) { const v = up.headers.get(k); if (v) out.set(k, v); }
  return new Response(up.body, { status: up.status, headers: out });
}
