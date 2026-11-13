// reuse-checked: scratch tveval.mjs -- same CDP attach, but records what the TV's compositor shows. The TV's sdb has no shell
// to grab the screen, and on Tizen 6.5 Page.captureScreenshot hangs and Page.startScreencast sends no frames, so this
// records a trace with the devtools screenshot category: the compositor's own frame snapshots plus its frame events.
// usage: node record.mjs <cdpPort> <outDir> <seconds> [setupExpr | setupFile]
//   writes outDir/f00000.jpg… (one per presented frame), frames.json ({ i, ts ms, dt ms }) and trace.json
//   SA_OVERRIDE=<dir> first reloads the TV with that dir's *.js/*.css served in place of prod's /src/music-atlas/ files
//   (the TV app won't navigate off prod, so a candidate build is tested by intercepting its requests).
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
const [port, out, secs = "6", setup] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl); let id = 0; const P = new Map();
const call = (method, params = {}) => new Promise((ok) => { const i = ++id; P.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = []; let done;
const dir = process.env.SA_OVERRIDE, local = dir ? readdirSync(dir).filter((f) => /\.(js|css)$/.test(f)) : [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && P.has(d.id)) { P.get(d.id)(d.result ?? d.error); P.delete(d.id); return; }
  if (d.method === "Tracing.dataCollected") ev.push(...d.params.value);
  if (d.method === "Fetch.requestPaused") {
    const p = d.params, f = p.request.url.split("?")[0].split("/src/music-atlas/")[1];
    if (f && local.includes(f)) call("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: f.endsWith(".css") ? "text/css" : "text/javascript" }, { name: "Cache-Control", value: "no-store" }], body: readFileSync(`${dir}/${f}`).toString("base64") });
    else call("Fetch.continueRequest", { requestId: p.requestId });
  }
  if (d.method === "Tracing.tracingComplete") done?.();
};
await new Promise((ok) => (ws.onopen = ok));
if (dir) {
  await call("Network.enable"); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/src/music-atlas/*" }] });
  await call("Page.reload", { ignoreCache: true }); await new Promise((ok) => setTimeout(ok, 15000));
  console.log("override", JSON.stringify((await call("Runtime.evaluate", { expression: "[...document.querySelectorAll('canvas')].map((c) => c.className + ':' + c.width + 'x' + c.height).join(' ')", returnByValue: true })).result?.value));
}
if (setup) { const r = await call("Runtime.evaluate", { expression: setup.startsWith("(") ? setup : readFileSync(setup, "utf8"), returnByValue: true, awaitPromise: true }); console.log("setup", JSON.stringify(r.result?.value ?? r.exceptionDetails?.exception?.description ?? r)); }
console.log("start", JSON.stringify(await call("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: ["disabled-by-default-devtools.screenshot", "devtools.timeline", "disabled-by-default-devtools.timeline.frame", "benchmark", "cc", "viz", "gpu"] } })));
await new Promise((ok) => setTimeout(ok, +secs * 1000));
await new Promise((ok) => { done = ok; call("Tracing.end"); setTimeout(ok, 30000); });
writeFileSync(`${out}/trace.json`, JSON.stringify(ev));
const shots = ev.filter((e) => e.name === "Screenshot" && e.args?.snapshot).sort((a, b) => a.ts - b.ts), frames = [];
shots.forEach((e, i) => { writeFileSync(`${out}/f${String(i).padStart(5, "0")}.jpg`, Buffer.from(e.args.snapshot, "base64")); frames.push({ i, ts: e.ts / 1000, dt: i ? +((e.ts - shots[i - 1].ts) / 1000).toFixed(1) : 0 }); });
writeFileSync(`${out}/frames.json`, JSON.stringify(frames));
const count = (n) => ev.filter((e) => e.name === n).length, dts = frames.slice(1).map((f) => f.dt).sort((a, b) => a - b), q = (p) => dts[Math.min(dts.length - 1, (dts.length * p) | 0)];
const df = ev.filter((e) => e.name === "DrawFrame").map((e) => e.ts).sort((a, b) => a - b), span = (df.at(-1) - df[0]) / 1e6;
console.log(JSON.stringify({ drawnFps: +((df.length - 1) / span).toFixed(1), slowFrames: df.slice(1).filter((t, i) => t - df[i] > 25000).length, events: ev.length, shots: frames.length, shotP50: q(0.5), shotP90: q(0.9), shotMax: dts.at(-1), drawFrame: count("DrawFrame"), dropped: count("DroppedFrame"), beginFrame: count("BeginFrame"), names: [...new Set(ev.map((e) => e.name))].slice(0, 40) }));
ws.close(); process.exit(0);
