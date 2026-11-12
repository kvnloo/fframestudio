// Vercel edge function, deployed as /api/social next to the Sound Atlas bundle.
// The site's shared layer: page views, who is here right now (presence heartbeats), likes, play
// counts and community playlists. Storage is the project's Neon Postgres (DATABASE_URL, provisioned
// through the Vercel marketplace), spoken to over Neon's HTTP SQL endpoint so no driver is bundled.
// Listeners are anonymous: the client keeps a random id in localStorage. Nothing personal is stored.
export const config = { runtime: "edge" };

const LIVE_S = 60; // a heartbeat every ~25 s; two missed beats and you have left
const ID = /^[\w:.\-]{1,120}$/, SID = /^[a-z0-9]{16,40}$/;
const S = /^[a-z_][a-z0-9_]{0,30}$/.test(process.env.SA_SCHEMA ?? "") ? process.env.SA_SCHEMA : "public"; // tests use their own schema

async function sql(queries) {
  const url = process.env.DATABASE_URL; if (!url) throw new Error("no database");
  const r = await fetch(`https://${new URL(url).hostname}/sql`, {
    method: "POST",
    headers: { "Neon-Connection-String": url, "content-type": "application/json" },
    body: JSON.stringify({ queries: queries.map(([query, params = []]) => ({ query, params })) }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message ?? `sql ${r.status}`);
  return j.results.map((x) => x.rows);
}

const SCHEMA = [
  `create schema if not exists ${S}`,
  `create table if not exists ${S}.sa_counter (k text primary key, n bigint not null default 0)`,
  `create table if not exists ${S}.sa_visitor (sid text primary key, first timestamptz not null default now(), last timestamptz not null default now(), visits int not null default 1)`,
  `create table if not exists ${S}.sa_presence (sid text primary key, track text, playing boolean not null default false, at timestamptz not null default now())`,
  `create table if not exists ${S}.sa_like (sid text not null, track text not null, at timestamptz not null default now(), primary key (sid, track))`,
  `create table if not exists ${S}.sa_play (track text primary key, n bigint not null default 0)`,
  `create table if not exists ${S}.sa_playlist (id text primary key, sid text not null, name text not null, tracks jsonb not null, at timestamptz not null default now(), plays int not null default 0)`,
  `create table if not exists ${S}.sa_playlist_like (sid text not null, pid text not null, primary key (sid, pid))`,
  `create table if not exists ${S}.sa_cast (room text primary key, cmd jsonb, cseq int not null default 0, cat timestamptz, tv jsonb, tat timestamptz)`,
  // Aural: community evolution of filter-song combos. A combo is a soundscape plus its evolve EQ at 0.5 dB
  // (web/src/music-atlas/aural.js comboKey). seen = auditioned in a round, keeps = picked; one keep per listener.
  `create table if not exists ${S}.sa_combo (track text not null, combo text not null, seen int not null default 0, keeps int not null default 0, primary key (track, combo))`,
  `create table if not exists ${S}.sa_combo_keep (sid text not null, track text not null, combo text not null, at timestamptz not null default now(), primary key (sid, track, combo))`,
];
let ready = null; // first request on a cold isolate makes sure the tables exist (idempotent)
const ensure = () => (ready ??= sql(SCHEMA.map((q) => [q])).catch((e) => { ready = null; throw e; }));

const fresh = `at > now() - interval '${LIVE_S} seconds'`;
// One snapshot of the room: counters, presence, what people are playing, every liked track's count.
const ROOM = () => [
  [`select k, n from ${S}.sa_counter`],
  [`select count(*)::int as here, count(*) filter (where playing)::int as listening from ${S}.sa_presence where ${fresh}`],
  [`select track, count(*)::int as n from ${S}.sa_presence where ${fresh} and playing and track is not null group by track order by n desc limit 24`],
  [`select track, count(*)::int as n from ${S}.sa_like group by track`],
  [`select track, n::int from ${S}.sa_play order by n desc limit 40`],
  [`select count(*)::int as n from ${S}.sa_visitor`],
];
const room = ([counters, live, now, likes, plays, vis]) => {
  const c = Object.fromEntries(counters.map((r) => [r.k, +r.n]));
  return {
    views: c.views ?? 0, plays: c.plays ?? 0, visitors: vis[0]?.n ?? 0,
    here: live[0]?.here ?? 0, listening: live[0]?.listening ?? 0,
    now: now.map((r) => [r.track, r.n]),
    likes: Object.fromEntries(likes.map((r) => [r.track, r.n])),
    top: plays.map((r) => [r.track, r.n]),
  };
};
const mine = (sid) => [[`select track from ${S}.sa_like where sid = $1`, [sid]]];
const presence = (sid, track, playing) => [`insert into ${S}.sa_presence (sid, track, playing, at) values ($1, $2, $3, now())
  on conflict (sid) do update set track = excluded.track, playing = excluded.playing, at = now()`, [sid, track, !!playing]];

const PL = (sid) => [`select p.id, p.name, p.tracks, p.plays, p.at, (p.sid = $1) as own,
  (select count(*)::int from ${S}.sa_playlist_like l where l.pid = p.id) as likes,
  exists (select 1 from ${S}.sa_playlist_like l where l.pid = p.id and l.sid = $1) as liked
  from ${S}.sa_playlist p order by likes desc, p.at desc limit 60`, [sid]];
const playlist = (r) => ({ id: r.id, name: r.name, tracks: r.tracks, plays: r.plays, likes: r.likes, liked: r.liked, own: r.own, at: r.at });

const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const bad = (msg) => out({ error: msg }, 400);
const ROOM_ID = /^[a-z0-9]{6}$/;
// A cast room: the phone writes commands (cmd, numbered by cseq), the TV writes where it is (tv).
// Ages come from the database clock, so phone, TV and edge never compare their own clocks.
const castRow = (room) => [`select cmd, cseq, tv, (extract(epoch from now() - cat) * 1000)::int as cage,
  (extract(epoch from now() - tat) * 1000)::int as tage from ${S}.sa_cast where room = $1`, [room]];
const castOut = (r) => (r ? { cseq: r.cseq, cmd: r.cmd, cage: r.cage, tv: r.tv, tage: r.tage } : { cseq: 0, cmd: null, tv: null });
const small = (o) => { if (o == null || typeof o !== "object") return null; const j = JSON.stringify(o); return j.length <= 2000 ? j : null; };
const COMBO = /^[a-z0-9-]{1,24}\|-?\d{1,2}\.\d(,-?\d{1,2}\.\d){4}$/;
// Ranked by kept share with a +1/+2 prior, so one lucky keep does not outrank a combo kept 30 times in 40.
const COMBOS = (track) => [
  [`select combo, keeps, seen from ${S}.sa_combo where track = $1 order by (keeps + 1)::float / (seen + 2) desc, keeps desc limit 6`, [track]],
  [`select split_part(combo, '|', 1) as scape, sum(keeps)::int as keeps, count(distinct track)::int as songs from ${S}.sa_combo group by 1 having sum(keeps) > 0 order by keeps desc limit 8`],
];
const combos = ([best, scapes]) => ({ best: best.map((r) => ({ combo: r.combo, keeps: r.keeps, seen: r.seen })), scapes: scapes.map((r) => ({ scape: r.scape, keeps: r.keeps, songs: r.songs })) });
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b & 31]).join("");

export async function handle(op, b) {
  const sid = b.sid;
  if (op !== "stats" && !SID.test(sid ?? "")) return bad("sid");
  const track = b.track == null ? null : String(b.track);
  if (track !== null && !ID.test(track)) return bad("track");
  await ensure();
  switch (op) {
    case "stats": return out(room(await sql(ROOM())));
    case "hello": { // a page view: count it, remember the visitor, and put them in the room
      const r = await sql([
        [`insert into ${S}.sa_counter (k, n) values ('views', 1) on conflict (k) do update set n = ${S}.sa_counter.n + 1`],
        [`insert into ${S}.sa_visitor (sid) values ($1) on conflict (sid) do update set last = now(), visits = ${S}.sa_visitor.visits + 1`, [sid]],
        presence(sid, track, b.playing),
        [`delete from ${S}.sa_presence where at < now() - interval '1 day'`],
        ...ROOM(), ...mine(sid),
      ]);
      return out({ ...room(r.slice(4, 10)), mine: r[10].map((x) => x.track) });
    }
    case "beat": { const r = await sql([presence(sid, track, b.playing), ...ROOM()]); return out(room(r.slice(1))); }
    case "bye": await sql([[`delete from ${S}.sa_presence where sid = $1`, [sid]]]); return out({ ok: true });
    case "play": {
      if (!track) return bad("track");
      await sql([
        [`insert into ${S}.sa_play (track, n) values ($1, 1) on conflict (track) do update set n = ${S}.sa_play.n + 1`, [track]],
        [`insert into ${S}.sa_counter (k, n) values ('plays', 1) on conflict (k) do update set n = ${S}.sa_counter.n + 1`],
        presence(sid, track, true),
      ]);
      return out({ ok: true });
    }
    case "like": {
      if (!track) return bad("track");
      const r = await sql([
        b.on ? [`insert into ${S}.sa_like (sid, track) values ($1, $2) on conflict do nothing`, [sid, track]] : [`delete from ${S}.sa_like where sid = $1 and track = $2`, [sid, track]],
        [`select count(*)::int as n from ${S}.sa_like where track = $1`, [track]],
      ]);
      return out({ track, likes: r[1][0].n, on: !!b.on });
    }
    case "playlists": return out({ playlists: (await sql([PL(sid)]))[0].map(playlist) });
    case "publish": {
      const name = String(b.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
      const tracks = Array.isArray(b.tracks) ? [...new Set(b.tracks.map(String))].filter((t) => ID.test(t)).slice(0, 200) : [];
      if (!name) return bad("name");
      if (!tracks.length) return bad("tracks");
      const [n] = await sql([[`select count(*)::int as n from ${S}.sa_playlist where sid = $1`, [sid]]]);
      if (n[0].n >= 20) return bad("limit"); // 20 lists per listener keeps the board readable
      const id = rid();
      const r = await sql([[`insert into ${S}.sa_playlist (id, sid, name, tracks) values ($1, $2, $3, $4::jsonb)`, [id, sid, name, JSON.stringify(tracks)]], PL(sid)]);
      return out({ id, playlists: r[1].map(playlist) });
    }
    case "unpublish": await sql([[`delete from ${S}.sa_playlist where id = $1 and sid = $2`, [String(b.id), sid]], [`delete from ${S}.sa_playlist_like where pid = $1`, [String(b.id)]]]); return out({ ok: true });
    case "plike": {
      const pid = String(b.id ?? ""); if (!/^[a-z0-9]{6}$/.test(pid)) return bad("id");
      const r = await sql([
        b.on ? [`insert into ${S}.sa_playlist_like (sid, pid) select $1, $2 where exists (select 1 from ${S}.sa_playlist where id = $2) on conflict do nothing`, [sid, pid]] : [`delete from ${S}.sa_playlist_like where sid = $1 and pid = $2`, [sid, pid]],
        [`select count(*)::int as n from ${S}.sa_playlist_like where pid = $1`, [pid]],
      ]);
      return out({ id: pid, likes: r[1][0].n, on: !!b.on });
    }
    case "cast": case "castpeek": case "tvpoll": {
      const room = String(b.room ?? "").toLowerCase(); if (!ROOM_ID.test(room)) return bad("room");
      if (op === "cast") {
        const cmd = small(b.cmd); if (!cmd) return bad("cmd");
        const r = await sql([[`insert into ${S}.sa_cast (room, cmd, cseq, cat) values ($1, $2::jsonb, 1, now())
          on conflict (room) do update set cmd = excluded.cmd, cseq = ${S}.sa_cast.cseq + 1, cat = now()`, [room, cmd]], castRow(room)]);
        return out(castOut(r[1][0]));
      }
      if (op === "tvpoll") {
        const tv = small(b.tv); if (!tv) return bad("tv");
        const r = await sql([
          [`insert into ${S}.sa_cast (room, tv, tat) values ($1, $2::jsonb, now()) on conflict (room) do update set tv = excluded.tv, tat = now()`, [room, tv]],
          [`delete from ${S}.sa_cast where coalesce(tat, cat) < now() - interval '30 days'`],
          castRow(room),
        ]);
        const o = castOut(r[2][0]); return out(o.cseq > +(b.after ?? 0) ? o : { cseq: o.cseq });
      }
      return out(castOut((await sql([castRow(room)]))[0][0]));
    }
    case "combos": if (!track) return bad("track"); return out(combos(await sql(COMBOS(track))));
    case "combo": { // a finished evolve round: every variant heard, at most one kept
      if (!track) return bad("track");
      const heard = (Array.isArray(b.heard) ? [...new Set(b.heard.map(String))] : []).filter((c) => COMBO.test(c)).slice(0, 10);
      const kept = b.kept == null ? null : String(b.kept);
      if (kept !== null && !COMBO.test(kept)) return bad("combo");
      if (kept && !heard.includes(kept)) heard.push(kept);
      if (!heard.length) return bad("combo");
      const r = await sql([
        ...heard.map((c) => [`insert into ${S}.sa_combo (track, combo, seen) values ($1, $2, 1) on conflict (track, combo) do update set seen = ${S}.sa_combo.seen + 1`, [track, c]]),
        ...(kept ? [[`with k as (insert into ${S}.sa_combo_keep (sid, track, combo) values ($1, $2, $3) on conflict do nothing returning 1)
          update ${S}.sa_combo set keeps = keeps + (select count(*) from k) where track = $2 and combo = $3`, [sid, track, kept]]] : []),
        ...COMBOS(track),
      ]);
      return out(combos(r.slice(-2)));
    }
    case "pplay": await sql([[`update ${S}.sa_playlist set plays = plays + 1 where id = $1`, [String(b.id ?? "")]]]); return out({ ok: true });
  }
  return bad("op");
}

export default async function handler(req) {
  const u = new URL(req.url);
  let b = {};
  if (req.method === "POST") { try { b = JSON.parse((await req.text()) || "{}"); } catch { return bad("json"); } } // sendBeacon posts text/plain
  else if (req.method !== "GET") return out({ error: "method" }, 405);
  const op = u.searchParams.get("op") ?? b.op ?? "stats";
  try { return await handle(op, b); }
  catch (e) {
    // Tables gone under a warm isolate (a reset database, a new branch): re-create them and retry once.
    if (/does not exist/.test(e.message)) { ready = null; try { return await handle(op, b); } catch (e2) { e = e2; } }
    return out({ error: "unavailable", detail: String(e.message).slice(0, 120) }, 503);
  }
}
