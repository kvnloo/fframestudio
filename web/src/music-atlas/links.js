// Pretty links: /song/<title>-by-<artist>, /room/<code>, /playlist/<id>. The deploy rewrites these
// paths to /api/page (tools/sound-atlas-api/page.js), which serves the app with link-preview tags.
// Slugs are made from the catalogue in its order, so the page function and the app agree on them.

export const kebab = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");

// Map of slug -> track and id -> slug; a repeated title-by-artist gets -2, -3 … in catalogue order.
export function slugIndex(tracks) {
  const bySlug = new Map(), byId = new Map();
  for (const t of tracks) {
    const root = [kebab(t.title) || "song", kebab(t.author)].filter(Boolean).join("-by-");
    let s = root; for (let n = 2; bySlug.has(s); n++) s = `${root}-${n}`;
    bySlug.set(s, t); byId.set(t.id, s);
  }
  return { bySlug, byId };
}

export const ROOM = /^[a-z0-9]{6}$/;
// Reads a pretty path; null when the path is the app's root (or anything else).
export function readPath(pathname) {
  const m = /^\/(song|room|playlist)\/([^/?#]+)\/?$/.exec(pathname); if (!m) return null;
  const k = decodeURIComponent(m[2]).toLowerCase();
  return m[1] === "room" ? (ROOM.test(k) ? { kind: "room", k } : null) : { kind: m[1], k };
}
