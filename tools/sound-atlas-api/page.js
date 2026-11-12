// Vercel edge function behind the pretty links (/song/…, /room/…, /playlist/…; see sound-atlas.vercel.json).
// Serves the app's own index.html with link-preview tags for what the link points at, so a shared
// song reads "Inspired · Kevin MacLeod" in Messages, WhatsApp or Slack. The app reads the path itself.
import { slugIndex, readPath } from "./_links.js";
export const config = { runtime: "edge" };

let idx = null; // per isolate: the catalogue changes only on deploy
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mins = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

async function meta(origin, p) {
  if (p?.kind === "song") {
    idx ??= fetch(origin + "/catalog.json").then((r) => r.json()).then((c) => slugIndex(c.tracks)).catch((e) => { idx = null; throw e; });
    const t = (await idx).bySlug.get(p.k);
    if (t) return { title: `${t.title} · ${t.author}`, desc: [t.bpm && `${t.bpm} bpm`, t.dur && mins(t.dur), t.license, "free to use · Sound Atlas"].filter(Boolean).join(" · "), type: "music.song" };
  }
  if (p?.kind === "room") return { title: `Listen together · room ${p.k.toUpperCase()}`, desc: "Open on your phone and it joins the room's speakers: every device plays the same song, in sync." };
  if (p?.kind === "playlist") return { title: "A Sound Atlas playlist", desc: "Free music, picked by feel." };
  return { title: "Sound Atlas · free music by feel", desc: "1,800 free songs on one map, filed by feel, family and style." };
}

export default async function handler(req) {
  const u = new URL(req.url), path = u.searchParams.get("path") ?? "/", origin = u.origin;
  const [html, m] = await Promise.all([fetch(origin + "/index.html").then((r) => r.text()), meta(origin, readPath(path)).catch(() => meta(origin, null))]);
  const url = origin + path, tags = [
    `<meta property="og:site_name" content="Sound Atlas" />`, `<meta property="og:type" content="${m.type ?? "website"}" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`, `<meta property="og:description" content="${esc(m.desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`, `<meta name="twitter:card" content="summary" />`,
    `<meta name="description" content="${esc(m.desc)}" />`, `<link rel="canonical" href="${esc(url)}" />`,
  ].join("\n");
  const out = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`).replace("</head>", tags + "\n</head>");
  return new Response(out, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=300" } });
}
