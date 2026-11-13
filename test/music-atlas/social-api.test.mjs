// /api/social against a real Neon database, in a throwaway schema that is dropped afterwards.
// Runs only when DATABASE_URL is set (vercel env pull); skipped otherwise.
import { test, after } from "node:test";
import assert from "node:assert/strict";

const url = process.env.DATABASE_URL;
const schema = `sa_test_${process.pid}`;
process.env.SA_SCHEMA = schema;
const { default: handler } = url ? await import("../../tools/sound-atlas-api/social.js") : {};
const call = async (op, body, method = "POST") => {
  const r = await handler(new Request(`https://x/api/social?op=${op}`, method === "POST" ? { method, body: JSON.stringify(body) } : { method }));
  return { status: r.status, ...(await r.json()) };
};
const A = "a".repeat(20), B = "b".repeat(20);

after(async () => {
  if (!url) return;
  await fetch(`https://${new URL(url).hostname}/sql`, { method: "POST", headers: { "Neon-Connection-String": url, "content-type": "application/json" }, body: JSON.stringify({ query: `drop schema if exists ${schema} cascade`, params: [] }) });
});

test("views, presence, likes, plays and playlists round-trip", { skip: !url && "no DATABASE_URL" }, async () => {
  let r = await call("hello", { sid: A });
  assert.equal(r.status, 200); assert.equal(r.views, 1); assert.equal(r.here, 1); assert.equal(r.listening, 0); assert.deepEqual(r.mine, []);
  r = await call("hello", { sid: B, track: "inc:x", playing: true });
  assert.equal(r.views, 2); assert.equal(r.visitors, 2); assert.equal(r.here, 2); assert.equal(r.listening, 1); assert.deepEqual(r.now, [["inc:x", 1]]);

  r = await call("like", { sid: A, track: "inc:x", on: true }); assert.equal(r.likes, 1);
  r = await call("like", { sid: A, track: "inc:x", on: true }); assert.equal(r.likes, 1, "a like counts once per listener");
  r = await call("like", { sid: B, track: "inc:x", on: true }); assert.equal(r.likes, 2);
  r = await call("like", { sid: B, track: "inc:x", on: false }); assert.equal(r.likes, 1);

  await call("play", { sid: A, track: "inc:y" }); await call("play", { sid: B, track: "inc:y" });
  r = await call("stats", null, "GET");
  assert.equal(r.plays, 2); assert.deepEqual(r.top, [["inc:y", 2]]); assert.deepEqual(r.streams, { "inc:y": 2 }, "every track's streams ride in the room"); assert.deepEqual(r.likes, { "inc:x": 1 }); assert.equal(r.listening, 2);
  r = await call("hello", { sid: A }); assert.deepEqual(r.mine, ["inc:x"]);

  r = await call("publish", { sid: A, name: "  late   night  ", tracks: ["inc:x", "inc:y", "inc:x", "bad id!"] });
  assert.equal(r.status, 200); const id = r.id;
  assert.deepEqual(r.playlists.map((p) => [p.name, p.tracks, p.own]), [["late night", ["inc:x", "inc:y"], true]]);
  r = await call("plike", { sid: B, id, on: true }); assert.equal(r.likes, 1);
  r = await call("playlists", { sid: B }); assert.equal(r.playlists[0].liked, true); assert.equal(r.playlists[0].own, false);
  await call("unpublish", { sid: B, id }); r = await call("playlists", { sid: B }); assert.equal(r.playlists.length, 1, "only the owner can unpublish");
  await call("unpublish", { sid: A, id }); r = await call("playlists", { sid: A }); assert.equal(r.playlists.length, 0);

  await call("bye", { sid: B }); r = await call("beat", { sid: A, track: null, playing: false }); assert.equal(r.here, 1); assert.equal(r.listening, 0);
});

test("heals when its tables vanish under a warm instance", { skip: !url && "no DATABASE_URL" }, async () => {
  await call("hello", { sid: A });
  await fetch(`https://${new URL(url).hostname}/sql`, { method: "POST", headers: { "Neon-Connection-String": url, "content-type": "application/json" }, body: JSON.stringify({ query: `drop schema ${schema} cascade`, params: [] }) });
  const r = await call("stats", null, "GET");
  assert.equal(r.status, 200); assert.equal(r.views, 0);
});

test("cast room: the phone commands, the TV follows and reports back", { skip: !url && "no DATABASE_URL" }, async () => {
  const room = "tv2abc";
  let r = await call("tvpoll", { sid: B, room, after: 0, tv: { t: null, playing: false, name: "Samsung TV" } });
  assert.equal(r.status, 200); assert.equal(r.cseq, 0); assert.equal(r.cmd, undefined, "no command yet");
  r = await call("castpeek", { sid: A, room: "TV2ABC" }); // codes are typed in either case
  assert.equal(r.tv.name, "Samsung TV"); assert.ok(r.tage >= 0 && r.tage < 5000, "fresh TV heartbeat");
  r = await call("cast", { sid: A, room, cmd: { t: "inc:x", pos: 12.5, playing: true } }); assert.equal(r.cseq, 1);
  r = await call("tvpoll", { sid: B, room, after: 0, tv: { t: null, playing: false } });
  assert.equal(r.cseq, 1); assert.deepEqual(r.cmd, { t: "inc:x", pos: 12.5, playing: true }); assert.ok(r.cage >= 0 && r.cage < 5000);
  r = await call("tvpoll", { sid: B, room, after: 1, tv: { t: "inc:x", pos: 13, playing: true } });
  assert.equal(r.cseq, 1); assert.equal(r.cmd, undefined, "a command is delivered once");
  r = await call("castpeek", { sid: A, room }); assert.deepEqual(r.tv, { t: "inc:x", pos: 13, playing: true });
  assert.equal((await call("cast", { sid: A, room: "../x", cmd: { t: 1 } })).status, 400);
  assert.equal((await call("cast", { sid: A, room, cmd: { big: "x".repeat(3000) } })).status, 400);
  assert.equal((await call("tvpoll", { sid: B, room })).status, 400, "a TV poll carries its state");
});

test("rejects bad input", { skip: !url && "no DATABASE_URL" }, async () => {
  assert.equal((await call("hello", { sid: "x" })).status, 400);
  assert.equal((await call("like", { sid: A, track: "../../etc", on: true })).status, 400);
  assert.equal((await call("publish", { sid: A, name: "", tracks: ["inc:x"] })).status, 400);
  assert.equal((await call("publish", { sid: A, name: "n", tracks: [] })).status, 400);
  assert.equal((await call("nope", { sid: A })).status, 400);
});
