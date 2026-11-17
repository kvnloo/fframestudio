// aural-local's native player: bit-perfect playback on this computer, driven by the Sound Atlas page.
//
// A browser can't play bit-perfect: Chrome mixes every page at the output's current rate, so a 44.1 kHz song
// on a 48 kHz output is resampled before PipeWire or CoreAudio ever sees it. So when bit-perfect is on, the page
// keeps playing silently (its map, beat and scrubber follow along) and this module plays the same song with mpv,
// straight to the hardware output, skipping every DSP sink:
//   Linux: mpv -> PipeWire (pipewire AO, node.rate = the song's rate) -> the DAC's ALSA sink. PipeWire switches
//          the graph to the song's rate (default.clock.allowed-rates in .files' pipewire.conf), so nothing resamples.
//   macOS: mpv -> CoreAudio in exclusive (hog) mode on the DAC, which sets the device to the song's rate.
// mpv runs with no config, no scripts, no filters, volume 100, no ReplayGain, no pitch correction.
// /native/now reports what the song is, what mpv sends, and (Linux) what the DAC is actually running
// (/proc/asound/.../hw_params), with every reason it isn't bit-perfect.
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const MAC = process.platform === "darwin";
// Only songs: the site (and its previews, local copies and tailnet copies) and the catalogue's two hosts.
const HOST_OK = /^(glide-music-picker(-[a-z0-9]+-kvnloos-projects)?\.vercel\.app|([a-z0-9-]+\.)*ts\.net|incompetech\.com|([a-z0-9-]+\.)?ccmixter\.org|127\.0\.0\.1|localhost)$/i;
export function urlOk(u) {
  try { const x = new URL(String(u)); return (x.protocol === "https:" || x.protocol === "http:") && HOST_OK.test(x.hostname) && !x.username && !x.password; } catch { return false; }
}

// --- the output: the DAC itself, never a DSP sink ---------------------------------------------------------
// Linux: the default sink if it is hardware; else (default is a filter-chain sink) the USB DAC, else any ALSA sink.
export function pickSink(list, def, want = process.env.AURAL_NATIVE_SINK) {
  const hw = list.filter((s) => s.name.startsWith("alsa_output."));
  return hw.find((s) => s.name === want) ?? hw.find((s) => s.name === def) ?? hw.find((s) => /Topping|DX5/i.test(s.name)) ?? hw.find((s) => /usb-/i.test(s.name)) ?? hw[0] ?? null;
}
// /proc/asound/cardN/pcmMp/sub0/hw_params: what the DAC is really being sent.
export function parseHwParams(txt) {
  if (!txt || /closed/.test(txt)) return null;
  const f = /format:\s*(\S+)/.exec(txt), r = /rate:\s*(\d+)/.exec(txt), c = /channels:\s*(\d+)/.exec(txt);
  return { format: f?.[1] ?? null, rate: r ? +r[1] : null, channels: c ? +c[1] : null };
}
// Every reason the current playback is not bit-perfect ([] = it is).
export function verdict({ params, out, hw, volume, mpvVolume, af, others, exclusive }) {
  const why = [];
  if (!params?.samplerate) return ["nothing playing"];
  if (out?.samplerate && out.samplerate !== params.samplerate) why.push(`mpv resamples ${params.samplerate} → ${out.samplerate} Hz`);
  if (hw && hw.rate && hw.rate !== params.samplerate) why.push(`the DAC runs at ${hw.rate} Hz, the song is ${params.samplerate} Hz (PipeWire resamples: add the rate to default.clock.allowed-rates, or stop other audio)`);
  if (others > 0) why.push(`${others} other stream${others === 1 ? "" : "s"} on the DAC hold its rate`);
  if (volume != null && volume !== 100) why.push(`output volume is ${volume}% (software gain); set it to 100% and use the DAC's knob`);
  if (mpvVolume != null && Math.round(mpvVolume) !== 100) why.push(`player volume is ${Math.round(mpvVolume)}%`);
  if (af) why.push(`audio filters active: ${af}`);
  if (MAC && exclusive === false) why.push("not in exclusive (hog) mode");
  return why;
}

// --- mpv over its JSON IPC socket ------------------------------------------------------------------------
let mpv = null; // { proc, sock, conn, pending, nextId, url, device, loaded }
const dir = () => mkdtempSync(join(tmpdir(), "aural-mpv-"));
function start(device) {
  stop();
  const d = dir(), sock = join(d, "ipc");
  const args = ["--no-config", "--idle=yes", "--no-video", "--no-terminal", "--really-quiet", "--load-scripts=no", "--ytdl=no", "--input-default-bindings=no",
    `--input-ipc-server=${sock}`, "--volume=100", "--volume-max=100", "--replaygain=no", "--audio-pitch-correction=no", "--audio-normalize-downmix=no",
    "--audio-samplerate=0", "--audio-channels=auto", "--af=", "--gapless-audio=weak", "--cache=yes", "--demuxer-max-bytes=64MiB", "--audio-display=no",
    "--user-agent=fframestudio-sound-atlas/1 aural-local", "--pause=yes"];
  if (MAC) args.push("--ao=coreaudio", "--audio-exclusive=yes", ...(device ? [`--audio-device=coreaudio/${device}`] : []));
  else args.push("--ao=pipewire", ...(device ? [`--audio-device=pipewire/${device}`] : []));
  const proc = spawn(process.env.AURAL_MPV ?? "mpv", args, { stdio: "ignore" });
  mpv = { proc, sock, dir: d, conn: null, pending: new Map(), nextId: 1, url: null, device, loaded: false, onLoad: [] };
  proc.on("exit", () => { if (mpv?.proc === proc) { try { rmSync(d, { recursive: true, force: true }); } catch {} mpv = null; } });
  proc.on("error", () => { if (mpv?.proc === proc) mpv = null; });
  return mpv;
}
export function stop() {
  if (!mpv) return;
  const m = mpv; mpv = null;
  try { m.conn?.destroy(); } catch {}
  try { m.proc.kill(); } catch {}
  try { rmSync(m.dir, { recursive: true, force: true }); } catch {}
}
async function ipc() {
  if (!mpv) throw new Error("player not running");
  if (mpv.conn) return mpv;
  const m = mpv;
  for (let i = 0; i < 50 && !existsSync(m.sock); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((ok, no) => {
    const c = connect(m.sock); let buf = "";
    c.once("connect", () => { m.conn = c; ok(); });
    c.once("error", no);
    c.on("data", (d) => {
      buf += d; let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.request_id && m.pending.has(j.request_id)) { const p = m.pending.get(j.request_id); m.pending.delete(j.request_id); j.error === "success" ? p.ok(j.data) : p.no(new Error(j.error)); }
        else if (j.event === "file-loaded") { m.loaded = true; const w = m.onLoad.splice(0); w.forEach((f) => f()); }
      }
    });
    c.on("close", () => { if (m.conn === c) m.conn = null; });
  });
  return m;
}
async function cmd(...command) {
  const m = await ipc(), id = m.nextId++;
  return new Promise((ok, no) => { m.pending.set(id, { ok, no }); m.conn.write(JSON.stringify({ command, request_id: id }) + "\n"); setTimeout(() => { if (m.pending.delete(id)) no(new Error("mpv timeout")); }, 4000); });
}
const get = (p) => cmd("get_property", p).catch(() => null);

// play / follow the page: { url, pos, playing, device }
export async function play({ url, pos = 0, playing = true, device = null }) {
  if (!urlOk(url)) throw Object.assign(new Error("url not allowed"), { code: 400 });
  if (!mpv || mpv.device !== device) start(device);
  const m = mpv;
  if (m.url !== url) {
    m.url = url; m.loaded = false;
    const loaded = new Promise((ok) => { m.onLoad.push(ok); setTimeout(ok, 15000); });
    await cmd("loadfile", url, "replace");
    await loaded;
    if (pos > 0.05) await cmd("seek", +pos, "absolute+exact").catch(() => {});
  } else {
    const at = await get("time-pos");
    if (at != null && Math.abs(at - pos) > 0.25) await cmd("seek", +pos, "absolute+exact").catch(() => {});
  }
  await cmd("set_property", "pause", !playing);
  return now();
}
export async function now(extra = {}) {
  if (!mpv) return { running: false, bitperfect: false, why: ["player not running"], ...extra };
  const [pos, paused, params, out, vol, af, dur, idle] = await Promise.all(["time-pos", "pause", "audio-params", "audio-out-params", "volume", "af", "duration", "idle-active"].map(get));
  const r = { running: true, url: mpv.url, pos, playing: paused === false && !idle, duration: dur, params, out, mpvVolume: vol, af: Array.isArray(af) && af.length ? af.map((x) => x.name).join(",") : "", device: mpv.device, ...extra };
  r.why = verdict({ ...r, exclusive: MAC ? true : undefined });
  r.bitperfect = r.why.length === 0;
  return r;
}
export const running = () => !!mpv;

// macOS: the real output for the native player (never BlackHole): the device install.sh remembered, else the
// current output. SwitchAudioSource gives the CoreAudio UID mpv wants.
export function macDevice(devices, cur) {
  let saved = ""; try { saved = readFileSync(join(homedir(), ".config/aural/playback-device"), "utf8").trim(); } catch {}
  const real = devices.filter((d) => !/BlackHole/i.test(d.name));
  return real.find((d) => d.name === (process.env.AURAL_NATIVE_DEVICE ?? saved)) ?? real.find((d) => d.name === cur) ?? real[0] ?? null;
}
