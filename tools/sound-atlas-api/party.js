// Vercel edge function, deployed as /api/party: "Listen together" rooms. Every phone in a room is a
// speaker: the room holds one anchor (song, position, playing, and the server time that position was
// true at); each device estimates its offset to this server's clock (op=time, NTP style) and plays
// the anchor's position for "now", correcting drift itself (web/src/music-atlas/party.js).
// Same Neon Postgres as /api/social, over its HTTP SQL endpoint. Rooms are anonymous and expire.
export const config = { runtime: "edge" };

const ROOM = /^[a-z0-9]{6}$/, SID = /^[a-z0-9]{16,40}$/, ID = /^[\w:.\-]{1,120}$/;
const PEER_S = 12; // devices poll every second; a speaker that stops for 12 s has left
const S = /^[a-z_][a-z0-9_]{0,30}$/.test(process.env.SA_SCHEMA ?? "") ? process.env.SA_SCHEMA : "public";

async function sql(queries) {
  const url = process.env.DATABASE_URL; if (!url) throw new Error("no database");
  const r = await fetch(`https://${new URL(url).hostname}/sql`, {
    method: "POST", headers: { "Neon-Connection-String": url, "content-type": "application/json" },
    body: JSON.stringify({ queries: queries.map(([query, params = []]) => ({ query, params })) }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message ?? `sql ${r.status}`);
  return j.results.map((x) => x.rows);
}
const SCHEMA = [
  `create schema if not exists ${S}`,
  `create table if not exists ${S}.sa_party (room text primary key, st jsonb, seq int not null default 0, by text, upd timestamptz not null default now())`,
  `create table if not exists ${S}.sa_party_peer (room text not null, sid text not null, at timestamptz not null default now(), primary key (room, sid))`,
];
let ready = null;
const ensure = () => (ready ??= sql(SCHEMA.map((q) => [q])).catch((e) => { ready = null; throw e; }));

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const bad = (why) => json({ error: why }, 400);
const peer = (room, sid) => [`insert into ${S}.sa_party_peer (room, sid) values ($1, $2) on conflict (room, sid) do update set at = now()`, [room, sid]];
const snap = (room) => [`select r.st, r.seq, r.by, (select count(*)::int from ${S}.sa_party_peer p where p.room = $1 and p.at > now() - interval '${PEER_S} seconds') as peers
  from (select $1::text as room) q left join ${S}.sa_party r on r.room = q.room`, [room]];
const out = (row, after) => {
  const o = { now: Date.now(), seq: row?.seq ?? 0, peers: row?.peers ?? 0 };
  return o.seq > after ? { ...o, st: row.st, by: row.by } : o;
};

// A playhead: which song, where in it, playing or not, and the server time (ms) it was there.
function anchor(st) {
  if (!st || typeof st !== "object" || !ID.test(st.t ?? "")) return null;
  const pos = +st.pos, at = +st.at, now = Date.now();
  if (!(pos >= 0 && pos < 36000)) return null;
  // the sender stamps the moment it read its playhead, in its estimate of our clock; trust it within 5 s
  return { t: st.t, pos: Math.round(pos * 1000) / 1000, playing: !!st.playing, at: Math.abs(at - now) < 5000 ? Math.round(at) : now };
}

export default async function handler(req) {
  const op = new URL(req.url).searchParams.get("op");
  if (op === "time") return json({ now: Date.now() }); // clock probe: no database, answer fast
  if (req.method !== "POST") return bad("post");
  const b = await req.json().catch(() => null); if (!b) return bad("body");
  const room = String(b.room ?? "").toLowerCase(), sid = String(b.sid ?? "");
  if (!ROOM.test(room)) return bad("room"); if (!SID.test(sid)) return bad("sid");
  try {
    await ensure();
    switch (op) {
      case "poll": { // heartbeat + the anchor when it changed since `after`
        const r = await sql([peer(room, sid), snap(room)]);
        return json(out(r[1][0], +(b.after ?? 0) || 0));
      }
      case "set": {
        const st = anchor(b.st); if (!st) return bad("st");
        const r = await sql([
          peer(room, sid),
          [`insert into ${S}.sa_party (room, st, seq, by) values ($1, $2::jsonb, 1, $3)
            on conflict (room) do update set st = excluded.st, seq = ${S}.sa_party.seq + 1, by = excluded.by, upd = now()`, [room, JSON.stringify(st), sid]],
          snap(room),
        ]);
        return json(out(r[2][0], 0));
      }
      case "bye": await sql([[`delete from ${S}.sa_party_peer where room = $1 and sid = $2`, [room, sid]]]); return json({ ok: true });
      case "hello": { // joining also sweeps rooms and speakers nobody has touched in a day
        const r = await sql([
          [`delete from ${S}.sa_party where upd < now() - interval '1 day'`], [`delete from ${S}.sa_party_peer where at < now() - interval '1 day'`],
          peer(room, sid), snap(room),
        ]);
        return json(out(r[3][0], 0));
      }
      default: return bad("op");
    }
  } catch (e) { return json({ error: String(e.message ?? e) }, 503); }
}
