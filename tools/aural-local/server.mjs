#!/usr/bin/env node
// aural-local: the opt-in half of Sound Atlas's audiophile pane. A port of Aural's server
// (kvnloo/aural apps/server: PipeWire sinks, spatial modes, cava spectrum) plus Aural Evolution's
// controller (kvnloo/.files scripts/audio-evolve) and the CamillaDSP experiences, as one dependency-free
// Node process that only ever listens on 127.0.0.1. The website never starts it; you do:
//
//   node tools/aural-local/server.mjs            # then open the pane (type "aural") -> This computer
//
// Env: AURAL_PORT (4317), AURAL_ORIGINS (extra allowed origins, comma-separated), AURAL_DOTFILES
// (dotfiles checkout; default ~/workspace/.files or /workspace/.files), AURAL_EVOLVE (audio-evolve path),
// AURAL_TAILSCALE=0 (don't publish to your tailnet).
// Phones: when Tailscale is up it also runs `tailscale serve` so your own devices reach it at
// https://<this-machine>.<tailnet>.ts.net:4317 (tailnet only, never the internet; HTTPS, which the
// https site needs). It still only listens on 127.0.0.1; Tailscale proxies to it. Stopped on exit.
// Safety: browsers send Origin on every cross-origin request, so only the allowed origins can drive it,
// and the Host check stops DNS-rebinding pages that pretend to be 127.0.0.1.
import { createServer } from "node:http";
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, createReadStream } from "node:fs";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { SOUNDSCAPES } from "../../web/src/music-atlas/aural.js";

const PORT = +(process.env.AURAL_PORT ?? 4317);
const ORIGINS = new Set(["https://glide-music-picker.vercel.app", ...(process.env.AURAL_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);
const localOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o)
  || /^https:\/\/glide-music-picker-[a-z0-9]+-kvnloos-projects\.vercel\.app$/.test(o); // the site's preview deploys
// This machine's tailnet name ("groot.tail1234.ts.net"), or "" without Tailscale.
const TAILNET = process.env.AURAL_TAILSCALE === "0" ? "" : (() => {
  try { return JSON.parse(execFileSync("tailscale", ["status", "--self", "--json"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] })).Self?.DNSName?.replace(/\.$/, "") ?? ""; } catch { return ""; }
})();
const hostOk = (h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h) || (!!TAILNET && (h === TAILNET || h === `${TAILNET}:${PORT}`));
const DOT = process.env.AURAL_DOTFILES ?? [join(homedir(), "workspace/.files"), "/workspace/.files"].find((d) => existsSync(d)) ?? "";
const EVOLVE = process.env.AURAL_EVOLVE ?? join(DOT, "scripts/audio-evolve");
const CAMILLA = join(DOT, "config/camilladsp");
const BRIRS = ["BRIR_R02_C1_True_Stereo.wav", "BRIR_R32_C1_True_Stereo.wav"];

// Which soundscapes this computer can run system-wide, and how.
// PipeWire sinks from config/pipewire/pipewire.conf.d (always loaded) and CamillaDSP experience scripts
// (only while camilladsp is listening on :1234).
const SINKS = { clean: "effect_input.headphone_dsp", speakers: "effect_input.headphone_dsp_crossfeed", room: "effect_input.headphone_dsp_room", evolved: "effect_input.aural_evolution", movie: "effect_input.headphone_dsp_movie" };
const SCRIPTS = {
  warm: ["the-tilt-shifter.sh", "warm"], analytical: ["the-tilt-shifter.sh", "analytical"], vinyl: ["the-vinyl-experience.sh", "on"],
  "late-night": ["late-night-mode.sh", "on"], haas: ["the-haas-widener.sh", "8"], hall: ["concert-hall-teleporter.sh", "wdr"],
  "mono-mid": ["the-mono-truth.sh", "mid"], "mono-side": ["the-mono-truth.sh", "side"], "comp-gentle": ["the-compression-revealer.sh", "gentle"], "comp-hyper": ["the-compression-revealer.sh", "hyper"],
  ...Object.fromEntries(["sub", "bass", "lowmid", "mid", "uppermid", "presence", "air"].map((b) => ["spot-" + b, ["frequency-spotlight.sh", b]])),
};

const run = (cmd, args, timeout = 10000) => new Promise((ok, no) => execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (e, out, err) => (e ? no(new Error((err || e.message).toString().trim().slice(0, 300))) : ok(out.toString()))));
const camillaUp = () => new Promise((ok) => { const s = connect(1234, "127.0.0.1"); s.once("connect", () => { s.destroy(); ok(true); }); s.once("error", () => ok(false)); s.setTimeout(300, () => { s.destroy(); ok(false); }); });

async function sinks() {
  const [list, def] = await Promise.all([run("pactl", ["-f", "json", "list", "sinks"]).then(JSON.parse), run("pactl", ["get-default-sink"]).then((s) => s.trim())]);
  return list.map((s) => { const m = /(\S+)\s+(\d+)ch\s+(\d+)Hz/.exec(s.sample_specification ?? "") ?? []; return { name: s.name, desc: s.description, format: m[1] ?? null, channels: +m[2] || null, rate: +m[3] || null, state: s.state, default: s.name === def }; });
}
async function evolveState() { try { return JSON.parse(await run(EVOLVE, ["json"])); } catch { return null; } }
async function caps() {
  const has = async (c) => run("sh", ["-c", `command -v ${c}`]).then(() => true, () => false);
  return { pipewire: await has("pactl"), evolve: existsSync(EVOLVE), camilla: await camillaUp(), cava: await has("cava"), dotfiles: DOT || null };
}
async function state() {
  const [s, e, c] = await Promise.all([sinks().catch(() => []), evolveState(), camillaUp()]);
  const names = new Set(s.map((x) => x.name));
  const scapes = SOUNDSCAPES.map((x) => x.id).filter((id) => (SINKS[id] && names.has(SINKS[id])) || (SCRIPTS[id] && c));
  if (names.has(SINKS.movie)) scapes.push("movie");
  return { sinks: s, evolve: e, camilla: c, scapes, active: activeScape };
}
let activeScape = null;

// audio-evolve verbs the pane may send; everything else is refused.
function evolveArgs({ cmd, arg }) {
  if (cmd === "select" && /^[0-9]$/.test(String(arg))) return ["select", String(arg)];
  if (["favorite", "calibrate", "stop", "status", "save"].includes(cmd)) return [cmd];
  if (cmd === "mode" && ["native", "room"].includes(arg)) return ["mode", arg];
  if (cmd === "note" && typeof arg === "string" && arg.length <= 200) return ["note", arg];
  return null;
}

// --- spectrum: cava -> server-sent events (Aural's /ws/spectrum, as SSE so the page needs no socket code) ---
const listeners = new Set(); let cava = null;
function startCava() {
  if (cava) return;
  const dir = mkdtempSync(join(tmpdir(), "aural-cava-")), fifo = join(dir, "fifo"), conf = join(dir, "conf");
  try { execFileSync("mkfifo", [fifo]); } catch { return; }
  writeFileSync(conf, `[general]\nbars = 24\nframerate = 30\nautosens = 1\n[input]\nmethod = pulse\nsource = auto\n[output]\nmethod = raw\nraw_target = ${fifo}\ndata_format = ascii\nascii_max_range = 1000\nchannels = stereo\n`);
  const p = spawn("cava", ["-p", conf], { stdio: "ignore" }); cava = p;
  let buf = ""; const rs = createReadStream(fifo, { encoding: "utf8" });
  rs.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const bars = line.split(";").filter(Boolean).map((n) => +n / 1000); for (const l of listeners) l(bars); } });
  p.on("exit", () => { cava = null; rs.destroy(); });
}
function stopCava() { if (cava && !listeners.size) { cava.kill(); cava = null; } }

// --- http -------------------------------------------------------------------------------------------
const body = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => { try { ok(JSON.parse(Buffer.concat(c).toString() || "{}")); } catch { ok({}); } }); });
export function handler(req, res) {
  const origin = req.headers.origin, host = req.headers.host ?? "";
  if (!hostOk(host)) { res.writeHead(421); return res.end(); }
  if (origin && !(ORIGINS.has(origin) || localOrigin(origin))) { res.writeHead(403, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "origin not allowed" })); }
  const h = { "content-type": "application/json", "cache-control": "no-store", vary: "origin" };
  if (origin) Object.assign(h, { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST", "access-control-allow-private-network": "true" });
  if (req.method === "OPTIONS") { res.writeHead(204, h); return res.end(); }
  const send = (code, j) => { res.writeHead(code, h); res.end(JSON.stringify(j)); };
  const path = new URL(req.url, "http://x").pathname;
  (async () => {
    if (path === "/health") return send(200, { ok: true, name: "aural-local", version: 1, caps: await caps(), tailnet: tailnetUrl });
    if (path === "/state") return send(200, await state());
    const ir = /^\/brir\/([01])$/.exec(path); // your ASH true-stereo rooms, for the browser engine; never leaves this machine
    if (ir) { const f = join(DOT, "config/brir", BRIRS[+ir[1]]); if (!DOT || !existsSync(f)) return send(404, { error: "no BRIR" }); res.writeHead(200, { ...h, "content-type": "audio/wav", "cache-control": "max-age=86400" }); return createReadStream(f).pipe(res); }
    if (path === "/spectrum") {
      res.writeHead(200, { ...h, "content-type": "text/event-stream" }); res.write(": hi\n\n");
      const l = (bars) => res.write(`data: ${JSON.stringify(bars)}\n\n`); listeners.add(l); startCava();
      req.on("close", () => { listeners.delete(l); stopCava(); }); return;
    }
    if (req.method !== "POST") return send(404, { error: "not found" });
    const b = await body(req);
    if (path === "/sink") {
      const list = await sinks(); if (!list.some((s) => s.name === b.name)) return send(400, { error: "no such sink" });
      await run("pactl", ["set-default-sink", b.name]); return send(200, { ok: true, default: b.name });
    }
    if (path === "/scape") {
      const id = String(b.id ?? "");
      if (SINKS[id]) { const list = await sinks(); if (!list.some((s) => s.name === SINKS[id])) return send(409, { error: `sink ${SINKS[id]} is not loaded` }); await run("pactl", ["set-default-sink", SINKS[id]]); activeScape = id; return send(200, { ok: true, via: "pipewire", sink: SINKS[id] }); }
      if (SCRIPTS[id]) { if (!(await camillaUp())) return send(409, { error: "CamillaDSP is not running (needed for this soundscape system-wide)" }); const [sh, arg] = SCRIPTS[id]; await run(join(CAMILLA, sh), [arg], 20000); activeScape = id; return send(200, { ok: true, via: "camilladsp", script: `${sh} ${arg}` }); }
      return send(400, { error: "unknown soundscape" });
    }
    if (path === "/evolve") {
      const args = evolveArgs(b); if (!args) return send(400, { error: "verb not allowed" });
      const out = await run(EVOLVE, args, 20000); return send(200, { ok: true, out: out.trim().slice(0, 2000), state: await evolveState() });
    }
    return send(404, { error: "not found" });
  })().catch((e) => send(500, { error: e.message }));
}

let tailnetUrl = null; // set once `tailscale serve` is publishing us
if (import.meta.url === `file://${process.argv[1]}`) {
  const srv = createServer(handler).listen(PORT, "127.0.0.1", () => {
    console.log(`aural-local on http://127.0.0.1:${srv.address().port} (dotfiles: ${DOT || "none"})`);
    if (!TAILNET) return console.log("phones: Tailscale isn't running here, so only this computer can connect");
    execFile("tailscale", ["serve", "--bg", `--https=${PORT}`, `http://127.0.0.1:${PORT}`], { timeout: 15000 }, (e) => {
      if (e) return console.log(`phones: \`tailscale serve\` failed (${e.message.split("\n")[0]}); run \`sudo tailscale set --operator=$USER\` once`);
      tailnetUrl = `https://${TAILNET}:${PORT}`;
      console.log(`phones (Tailscale on): ${tailnetUrl}\n  open on the phone: https://glide-music-picker.vercel.app/#aural=${encodeURIComponent(tailnetUrl)}`);
    });
  });
  const bye = () => { listeners.clear(); stopCava(); if (tailnetUrl) try { execFileSync("tailscale", ["serve", `--https=${PORT}`, "off"], { timeout: 5000, stdio: "ignore" }); } catch {} process.exit(0); };
  process.on("SIGINT", bye); process.on("SIGTERM", bye);
}
