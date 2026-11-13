// Vercel edge function, deployed as /api/import next to the Sound Atlas bundle.
//   ?url=<Spotify | YouTube | YouTube Music | Apple Music | Tidal | Deezer link>  -> { source, name, tracks }
//   ?q=<artist title>  -> { id, title, alt: [ids] }: YouTube videos for the mini player, best first
// Only the hosts `source()` names are ever fetched, so this is not an open proxy.
import { source, parse, videos } from "./_import.js";
export const config = { runtime: "edge" };

const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "accept-language": "en-US,en;q=0.9", cookie: "CONSENT=YES+1" };
const send = (status, body, age = 0) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": age ? `public, s-maxage=${age}, max-age=${age}` : "no-store" } });

export default async function handler(req) {
  const q = new URL(req.url).searchParams;
  if (q.has("q")) {
    const s = (q.get("q") || "").trim().slice(0, 160); if (!s) return send(400, { error: "empty" });
    const r = await fetch("https://www.youtube.com/results?search_query=" + encodeURIComponent(s), { headers: UA }).catch(() => null);
    const v = r?.ok ? videos(await r.text()) : [];
    return v.length ? send(200, { ...v[0], alt: v.slice(1).map((x) => x.id) }, 86400) : send(502, { error: "YouTube didn't answer" });
  }
  const src = source(q.get("url") || "");
  if (!src) return send(400, { error: "Paste a Spotify, YouTube, Apple Music, Tidal or Deezer link" });
  const r = await fetch(src.url, { headers: UA }).catch(() => null);
  if (!r?.ok) return send(502, { error: `${src.source} didn't answer (${r?.status ?? "offline"}); is the playlist public?` });
  const out = parse(src.source, await r.text());
  return out?.tracks.length ? send(200, out, 600) : send(422, { error: `No songs found on that ${src.source} page; is it public?` });
}
