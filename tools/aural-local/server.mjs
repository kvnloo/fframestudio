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
// AURAL_CAMILLA (CamillaDSP profile dir; macOS default ~/.config/camilladsp, as install.sh lays it out),
// AURAL_TAILSCALE=0 (don't publish to your tailnet).
// Linux drives PipeWire (pactl) and audio-evolve; macOS drives CamillaDSP + BlackHole (headphone-switch.sh and
// the experience scripts) and picks outputs with SwitchAudioSource. tools/aural-local/install.sh sets up either.
// Phones: when Tailscale is up it also runs `tailscale serve` so your own devices reach it at
// https://<this-machine>.<tailnet>.ts.net:4317 (tailnet only, never the internet; HTTPS, which the
// https site needs). It still only listens on 127.0.0.1; Tailscale proxies to it. Stopped on exit.
// Safety: browsers send Origin on every cross-origin request, so only the allowed origins can drive it,
// and the Host check stops DNS-rebinding pages that pretend to be 127.0.0.1.
import { createServer } from "node:http";
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, createReadStream, readFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { SOUNDSCAPES } from "../../web/src/music-atlas/aural.js";
import * as native from "./native.mjs";

const PORT = +(process.env.AURAL_PORT ?? 4317);
const MAC = process.platform === "darwin";
// The Mac app's CLI lives inside the bundle unless the user linked it onto PATH.
const TS_BIN = process.env.AURAL_TAILSCALE_BIN ?? (MAC && existsSync("/Applications/Tailscale.app/Contents/MacOS/Tailscale") ? "/Applications/Tailscale.app/Contents/MacOS/Tailscale" : "tailscale");
const ORIGINS = new Set(["https://glide-music-picker.vercel.app", ...(process.env.AURAL_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);
const localOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o)
  || /^https:\/\/glide-music-picker-[a-z0-9]+-kvnloos-projects\.vercel\.app$/.test(o); // the site's preview deploys
// This machine's tailnet name ("groot.tail1234.ts.net"), or "" without Tailscale.
const TAILNET = process.env.AURAL_TAILSCALE === "0" ? "" : (() => {
  try { return JSON.parse(execFileSync(TS_BIN, ["status", "--self", "--json"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] })).Self?.DNSName?.replace(/\.$/, "") ?? ""; } catch { return ""; }
})();
const hostOk = (h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h) || (!!TAILNET && (h === TAILNET || h === `${TAILNET}:${PORT}`));
const DOT = process.env.AURAL_DOTFILES ?? [join(homedir(), "workspace/.files"), "/workspace/.files"].find((d) => existsSync(d)) ?? "";
const EVOLVE = process.env.AURAL_EVOLVE ?? join(DOT, "scripts/audio-evolve");
const CAMILLA = process.env.AURAL_CAMILLA ?? (MAC && existsSync(join(homedir(), ".config/camilladsp")) ? join(homedir(), ".config/camilladsp") : join(DOT, "config/camilladsp"));
// macOS: the PipeWire sinks' counterparts are CamillaDSP profiles, switched live by headphone-switch.sh.
const PROFILES = { clean: "clean", speakers: "crossfeed", room: "room" };
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
  if (MAC) { // SwitchAudioSource prints one JSON object per device
    const [all, cur] = await Promise.all([run("SwitchAudioSource", ["-a", "-t", "output", "-f", "json"]), run("SwitchAudioSource", ["-c", "-t", "output"]).then((x) => x.trim())]);
    return all.split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((d) => ({ name: d.name, desc: d.name, format: null, channels: null, rate: null, state: null, default: d.name === cur }));
  }
  const [list, def] = await Promise.all([run("pactl", ["-f", "json", "list", "sinks"]).then(JSON.parse), run("pactl", ["get-default-sink"]).then((s) => s.trim())]);
  return list.map((s) => { const m = /(\S+)\s+(\d+)ch\s+(\d+)Hz/.exec(s.sample_specification ?? "") ?? []; return { name: s.name, desc: s.description, format: m[1] ?? null, channels: +m[2] || null, rate: +m[3] || null, state: s.state, default: s.name === def }; });
}
// --- bit-perfect (native.mjs): which hardware output the native player uses, and what it is doing ---------
async function rawSinks() { return MAC ? [] : JSON.parse(await run("pactl", ["-f", "json", "list", "sinks"])); }
async function nativeTarget() {
  if (MAC) {
    const [all, cur] = await Promise.all([run("SwitchAudioSource", ["-a", "-t", "output", "-f", "json"]), run("SwitchAudioSource", ["-c", "-t", "output"]).then((x) => x.trim())]);
    const devs = all.split("\n").filter(Boolean).map((l) => JSON.parse(l)), d = native.macDevice(devs, cur);
    return { device: d?.uid ?? null, name: d?.name ?? null, auto: !!cur && !/BlackHole/i.test(cur), def: cur };
  }
  const [list, def] = await Promise.all([rawSinks(), run("pactl", ["get-default-sink"]).then((x) => x.trim())]);
  const s = native.pickSink(list, def);
  return { device: s?.name ?? null, name: s?.description ?? null, auto: def.startsWith("alsa_output."), def, sink: s };
}
// The page keeps playing silently while the native player has the sound, and that silent browser stream would
// sit on the DAC's PipeWire graph and pin it to 48 kHz. So while bit-perfect plays, the browser's streams move to
// a null sink (their own graph) and move back after. The browser is found from the request's own TCP connection.
const QUIET = "aural_quiet";
let quietBin = null, quietMod = null; const quietMoved = new Map(); // sink-input id -> original sink name
async function browserOf(req) {
  if (MAC) return null;
  try {
    const out = await run("ss", ["-Htnp", "state", "established", `( sport = :${req.socket.remotePort} )`]);
    const m = /users:\(\("([^"]+)"/.exec(out); const bin = m?.[1] ?? null;
    return bin && !/^(tailscaled|node|curl)$/.test(bin) ? bin : null; // over the tailnet the browser is on another device
  } catch { return null; }
}
async function quiet() {
  if (MAC || !quietBin) return;
  const [sinksJ, ins] = await Promise.all([rawSinks(), run("pactl", ["-f", "json", "list", "sink-inputs"]).then(JSON.parse)]);
  let q = sinksJ.find((x) => x.name === QUIET);
  const mine = ins.filter((i) => (i.properties?.["application.process.binary"] ?? "") === quietBin && (!q || i.sink !== q.index));
  if (!mine.length) return;
  if (!q) { quietMod = (await run("pactl", ["load-module", "module-null-sink", `sink_name=${QUIET}`, "sink_properties=device.description=Aural-quiet"])).trim(); q = (await rawSinks()).find((x) => x.name === QUIET); }
  const byIdx = new Map(sinksJ.map((x) => [x.index, x.name]));
  for (const i of mine) { if (!quietMoved.has(i.index)) quietMoved.set(i.index, byIdx.get(i.sink)); await run("pactl", ["move-sink-input", String(i.index), QUIET]).catch(() => {}); }
}
async function unquiet() {
  quietBin = null;
  if (MAC) return;
  const names = new Set((await rawSinks().catch(() => [])).map((x) => x.name));
  for (const [id, sink] of quietMoved) await run("pactl", ["move-sink-input", String(id), names.has(sink) ? sink : "@DEFAULT_SINK@"]).catch(() => {});
  quietMoved.clear();
  if (quietMod) { await run("pactl", ["unload-module", quietMod]).catch(() => {}); quietMod = null; }
}

async function nativeNow() {
  if (native.running()) await quiet().catch(() => {});
  const t = await nativeTarget().catch(() => ({}));
  const extra = { target: t.name ?? null, auto: !!t.auto, system: t.def ?? null };
  if (!MAC && t.sink && native.running()) {
    const s = t.sink, p = s.properties ?? {};
    try { extra.hw = native.parseHwParams(readFileSync(`/proc/asound/card${p["alsa.card"]}/pcm${p["alsa.device"] ?? 0}p/sub0/hw_params`, "utf8")); } catch { extra.hw = null; }
    const v = Object.values(s.volume ?? {}).map((c) => parseInt(c.value_percent, 10)).filter(Number.isFinite);
    extra.volume = v.length ? Math.max(...v) : null; extra.muted = !!s.mute;
    // Other audio on the DAC pins its rate. The filter-chain sinks' own outputs are passive (they don't), nor does mpv.
    try { const ins = JSON.parse(await run("pactl", ["-f", "json", "list", "sink-inputs"])); extra.others = ins.filter((i) => i.sink === s.index && !/mpv/i.test(i.properties?.["application.name"] ?? "") && !String(i.properties?.["node.name"] ?? "").startsWith("effect_output.") && i.properties?.["node.passive"] !== "true").length; } catch { extra.others = 0; }
    // Without an ALSA card (or before it opens), the rate PipeWire runs the DAC's graph at, from pw-top
    // (columns: S ID QUANT RATE WAIT BUSY W/Q B/Q ERR FORMAT CH RATE NAME).
    if (!extra.hw) try { const line = (await run("pw-top", ["-b", "-n", "2"], 5000)).split("\n").reverse().find((l) => l.trim().endsWith(" " + s.name)); const c = line?.trim().split(/\s+/); if (c && +c[3]) extra.hw = { rate: +c[3], format: c[9] ?? null, channels: +c[10] || null, from: "pipewire" }; } catch {}
  }
  return native.now(extra);
}

async function evolveState() { if (MAC) return null; try { return JSON.parse(await run(EVOLVE, ["json"])); } catch { return null; } }
async function caps() {
  const has = async (c) => run("sh", ["-c", `command -v ${c}`]).then(() => true, () => false);
  return { os: process.platform, native: await has(process.env.AURAL_MPV ?? "mpv"), pipewire: !MAC && (await has("pactl")), switchaudio: MAC && (await has("SwitchAudioSource")), evolve: !MAC && existsSync(EVOLVE), camilla: await camillaUp(), cava: await has("cava"), dotfiles: DOT || null };
}
async function state() {
  const [s, e, c] = await Promise.all([sinks().catch(() => []), evolveState(), camillaUp()]);
  const names = new Set(s.map((x) => x.name));
  const scapes = SOUNDSCAPES.map((x) => x.id).filter((id) => (MAC ? PROFILES[id] && c : SINKS[id] && names.has(SINKS[id])) || (SCRIPTS[id] && c));
  if (!MAC && names.has(SINKS.movie) && !scapes.includes("movie")) scapes.push("movie");
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
  writeFileSync(conf, `[general]\nbars = 24\nframerate = 30\nautosens = 1\n[input]\n${MAC ? "method = portaudio\nsource = BlackHole 2ch" : "method = pulse\nsource = auto"}\n[output]\nmethod = raw\nraw_target = ${fifo}\ndata_format = ascii\nascii_max_range = 1000\nchannels = stereo\n`);
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
    if (path === "/native/now") return send(200, await nativeNow());
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
      const list = await sinks().catch(() => []); if (!list.some((s) => s.name === b.name)) return send(400, { error: "no such sink" });
      await run(MAC ? "SwitchAudioSource" : "pactl", MAC ? ["-t", "output", "-s", b.name] : ["set-default-sink", b.name]); return send(200, { ok: true, default: b.name });
    }
    if (path === "/scape") {
      const id = String(b.id ?? "");
      if (MAC && PROFILES[id]) { if (!(await camillaUp())) return send(409, { error: "CamillaDSP is not running (install.sh starts it as a LaunchAgent)" }); await run(join(CAMILLA, "headphone-switch.sh"), [PROFILES[id]], 20000); activeScape = id; return send(200, { ok: true, via: "camilladsp", profile: PROFILES[id] }); }
      if (!MAC && SINKS[id]) { const list = await sinks(); if (!list.some((s) => s.name === SINKS[id])) return send(409, { error: `sink ${SINKS[id]} is not loaded` }); await run("pactl", ["set-default-sink", SINKS[id]]); activeScape = id; return send(200, { ok: true, via: "pipewire", sink: SINKS[id] }); }
      if (SCRIPTS[id]) { if (!(await camillaUp())) return send(409, { error: "CamillaDSP is not running (needed for this soundscape system-wide)" }); const [sh, arg] = SCRIPTS[id]; await run(join(CAMILLA, sh), [arg], 20000); activeScape = id; return send(200, { ok: true, via: "camilladsp", script: `${sh} ${arg}` }); }
      return send(400, { error: "unknown soundscape" });
    }
    if (path === "/native/play") {
      const t = await nativeTarget().catch(() => ({}));
      if (!t.device && !MAC) return send(409, { error: "no hardware output to play to" });
      const bin = await browserOf(req); if (bin) quietBin = bin;
      await quiet().catch(() => {});
      try { await native.play({ url: b.url, pos: Number.isFinite(+b.pos) ? +b.pos : 0, playing: b.playing !== false, device: t.device }); } catch (e) { return send(e.code ?? 500, { error: e.message }); }
      return send(200, await nativeNow());
    }
    if (path === "/native/stop") { native.stop(); await unquiet(); return send(200, { ok: true }); }
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
    execFile(TS_BIN, ["serve", "--bg", `--https=${PORT}`, `http://127.0.0.1:${PORT}`], { timeout: 15000 }, (e) => {
      if (e) return console.log(`phones: \`tailscale serve\` failed (${e.message.split("\n")[0]}); run \`sudo tailscale set --operator=$USER\` once`);
      tailnetUrl = `https://${TAILNET}:${PORT}`;
      console.log(`phones (Tailscale on): ${tailnetUrl}\n  open on the phone: https://glide-music-picker.vercel.app/#aural=${encodeURIComponent(tailnetUrl)}`);
    });
  });
  const bye = async () => { listeners.clear(); stopCava(); native.stop(); await unquiet().catch(() => {}); if (tailnetUrl) try { execFileSync(TS_BIN, ["serve", `--https=${PORT}`, "off"], { timeout: 5000, stdio: "ignore" }); } catch {} process.exit(0); };
  process.on("SIGINT", bye); process.on("SIGTERM", bye);
}
