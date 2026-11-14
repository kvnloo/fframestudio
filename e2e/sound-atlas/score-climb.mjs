// Frozen referee for the Sound Atlas perf climb (rubric perf-climb-v5; v5 pairs reps in the bootstrap, v4 voids a run whose A/A arm is noisy, v3 adds zoomed-on-track gates, v2 per-rep motion medians). Reads perf-climb.mjs runs named
// <variant>-<rep>.json, scores every variant against the incumbent and prints KEEP / DROP with the reason.
//   node score-climb.mjs <runs-dir> [incumbent=base]          -> also writes <runs-dir>/score.json
// Lower is better for every metric. Ratios are candidate / incumbent with a 90% bootstrap CI over reps.
// KEEP needs all three: (1) quality gates pass, (2) the objective (geo-mean of the lows/latency ratios) has CI high < 1,
// (3) no metric regresses for sure (CI low > 1.03). Quality never trades: a gate failure is DROP whatever the speed.
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2], INC = process.argv[3] || 'base';
const runs = {}; for (const f of fs.readdirSync(dir).filter((f) => /-\d+\.json$/.test(f)).sort((a, b) => +a.match(/(\d+)\.json$/)[1] - +b.match(/(\d+)\.json$/)[1])) { // rep order: v5 pairs rep i with rep i
 const v = f.replace(/-\d+\.json$/, ''); (runs[v] ??= []).push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); }
const q = (a, k) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * k))]; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, med = (a) => q(a, 0.5);
// Metrics pool frames across reps: 0.1% of a 12 s dance at 30 fps is under one frame per rep.
const METRICS = {
  'dance.ft.mean': (R) => mean(R.flatMap((r) => r.dance.ft)),
  'dance.ft.p99 (1% low)': (R) => q(R.flatMap((r) => r.dance.ft), 0.99),
  'dance.ft.p99.9 (0.1% low)': (R) => q(R.flatMap((r) => r.dance.ft), 0.999),
  'drag.ft.p99': (R) => q(R.flatMap((r) => r.drag.ft), 0.99),
  'drag.lat.p50': (R) => q(R.flatMap((r) => r.drag.lat), 0.5),
  'drag.lat.p95': (R) => q(R.flatMap((r) => r.drag.lat), 0.95),
  'tap.p75': (R) => q(R.flatMap((r) => r.tap.dur), 0.75),
  'tap.max': (R) => Math.max(...R.flatMap((r) => r.tap.dur), 0),
};
const OBJ = ['dance.ft.p99 (1% low)', 'dance.ft.p99.9 (0.1% low)', 'drag.ft.p99', 'drag.lat.p95', 'tap.p75'];
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const boot = (R) => R.map(() => R[Math.floor(rnd() * R.length)]);
// v5 paired bootstrap: perf.sh interleaves arms inside each rep, so rep i of every arm ran in the same minute of the box.
// Resampling the same rep indices for candidate and incumbent cancels the box's drift (shared-iGPU load) instead of
// counting it as noise. Falls back to independent resampling when rep counts differ.
const bootPair = (R, B) => { if (R.length !== B.length) return [boot(R), boot(B)]; const ix = R.map(() => Math.floor(rnd() * R.length)); return [ix.map((i) => R[i]), ix.map((i) => B[i])]; };
const stillOf = (r) => Buffer.from(r.vis.still.px, 'base64');
const sdiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
function gates(R, B) {
  const g = {};
  g.errors = R.every((r) => !r.errs.length) || R.flatMap((r) => r.errs).slice(0, 2).join(' | ');
  // every canvas at the incumbent's sharpest backing-store ratio (a split into more canvases is fine; a lower DPR is not)
  const top = Math.max(...B[0].vis.dens);
  g.density = R.every((r) => r.vis.dens.length && r.vis.dens.every((d) => d >= top)) || `canvas px/css ${JSON.stringify(R[0].vis.dens)} vs ${JSON.stringify(B[0].vis.dens)}`;
  // v2: median of per-rep medians. Pooling let one loud rep (a chorus) move the bar; on Boat A/A reps span 0.22-0.78.
  const mo = med(R.map((r) => med(r.vis.motion))) / med(B.map((r) => med(r.vis.motion)));
  g.motion = mo >= 0.75 || `dance motion energy ${(mo * 100).toFixed(0)}% of incumbent`;
  // Where it moves: the share of the incumbent's moving cells that also move in the candidate, against the incumbent's
  // own rep-to-rep share (A/A). A part of the dance that stops (arms, bands) drops it even when total motion holds.
  const mk = (r) => Buffer.from(r.vis.mask.b, 'base64'), cover = (a, b) => { let n = 0, d = 0; for (let i = 0; i < b.length; i++) if (b[i]) { d++; if (a[i]) n++; } return d ? n / d : 1; };
  const covAA = B.length > 1 ? med(B.slice(1).map((r) => cover(mk(r), mk(B[0])))) : 1, cov = med(R.map((r) => cover(mk(r), mk(B[0]))));
  g.where = cov >= covAA - 0.05 || `moves in ${(cov * 100).toFixed(0)}% of the incumbent's moving cells (A/A ${(covAA * 100).toFixed(0)}%)`;
  // v3: the same two checks zoomed onto the playing track (runs without vis.zoom fail: a v3 score needs v3 evidence)
  const zk = (r) => r.vis.zoom && Buffer.from(r.vis.zoom.mask.b, 'base64');
  if (B.every(zk) && R.every(zk)) {
    const zAA = B.length > 1 ? med(B.slice(1).map((r) => cover(zk(r), zk(B[0])))) : 1, zc = med(R.map((r) => cover(zk(r), zk(B[0]))));
    g.zoomWhere = zc >= zAA - 0.05 || `zoomed: moves in ${(zc * 100).toFixed(0)}% of the incumbent's moving cells (A/A ${(zAA * 100).toFixed(0)}%)`;
    const zm = med(R.map((r) => med(r.vis.zoom.motion))) / med(B.map((r) => med(r.vis.zoom.motion)));
    g.zoomMotion = zm >= 0.75 || `zoomed dance motion ${(zm * 100).toFixed(0)}% of incumbent`;
  } else g.zoom = 'no zoomed evidence (pre-v3 run)';
  // still frame vs the incumbent's, against the incumbent's own spread across reps (A/A)
  const aa = B.length > 1 ? Math.max(...B.slice(1).map((r) => sdiff(stillOf(r), stillOf(B[0])))) : 0;
  const d = med(R.map((r) => sdiff(stillOf(r), stillOf(B[0]))));
  g.still = d <= Math.max(0.6, aa * 1.5) || `still frame differs: ${d.toFixed(2)}/255 (A/A ${aa.toFixed(2)})`;
  return { g, motion: +mo.toFixed(2), still: +d.toFixed(2) };
}
const B = runs[INC]; if (!B) { console.error('no incumbent runs:', INC, Object.keys(runs)); process.exit(2); }
const out = { incumbent: INC, reps: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, v.length])), gl: B[0].gl, variants: {} };
const row = (k, v) => console.log(k.padEnd(28), v);
// v4 noise guard: an A/A arm (the incumbent again, named `aa`) is required, and a box whose A/A objective CI is wider
// than 0.45 (a contended shared iGPU: 7-60 fps on one build in round 3) voids every verdict in the run.
const AA = Object.keys(runs).find((k) => k === 'aa');
let voidWhy = AA ? null : 'no A/A arm (name one variant aa)';
for (const [name, R] of [[INC, B], ...Object.entries(runs).filter(([k]) => k !== INC)]) { // incumbent first: ratios need its abs
  const abs = Object.fromEntries(Object.entries(METRICS).map(([k, f]) => [k, +f(R).toFixed(1)]));
  out.variants[name] = { abs, loads: R.map((r) => r.host.load) };
  if (name === INC) continue;
  const ratios = {}, bs = Object.fromEntries(Object.keys(METRICS).map((k) => [k, []])), objB = [];
  for (let i = 0; i < 1000; i++) { const [r, b] = bootPair(R, B); let lg = 0;
    for (const [k, f] of Object.entries(METRICS)) { const x = f(r) / f(b); bs[k].push(x); if (OBJ.includes(k)) lg += Math.log(x); }
    objB.push(Math.exp(lg / OBJ.length)); }
  for (const k of Object.keys(METRICS)) ratios[k] = { r: +(abs[k] / out.variants[INC].abs[k]).toFixed(3), ci: [+q(bs[k], 0.05).toFixed(3), +q(bs[k], 0.95).toFixed(3)] };
  const obj = { r: +Math.exp(mean(OBJ.map((k) => Math.log(ratios[k].r)))).toFixed(3), ci: [+q(objB, 0.05).toFixed(3), +q(objB, 0.95).toFixed(3)] };
  const G = gates(R, B), failed = Object.entries(G.g).filter(([, v]) => v !== true);
  const worse = Object.entries(ratios).filter(([, v]) => v.ci[0] > 1.03).map(([k]) => k);
  const verdict = failed.length ? 'DROP (quality gate)' : worse.length ? 'DROP (regresses ' + worse.join(', ') + ')' : obj.ci[1] < 1 ? 'KEEP' : 'DROP (no sure gain)';
  if (name === AA && obj.ci[1] - obj.ci[0] > 0.45) voidWhy = `noisy box: A/A objective CI [${obj.ci.join(', ')}]`;
  Object.assign(out.variants[name], { ratios, objective: obj, gates: G, verdict });
  console.log(`\n== ${name} vs ${INC}: ${verdict}   objective ${obj.r} [${obj.ci.join(', ')}]   n=${R.length}/${B.length}`);
  for (const k of Object.keys(METRICS)) row(k, `${String(abs[k]).padStart(7)} vs ${String(out.variants[INC].abs[k]).padStart(7)}  x${ratios[k].r} [${ratios[k].ci.join(', ')}]`);
  for (const [k, v] of Object.entries(G.g)) row('gate ' + k, v === true ? 'pass' : 'FAIL ' + v);
}
if (voidWhy) { out.void = voidWhy; for (const v of Object.values(out.variants)) if (v.verdict) v.verdict = 'VOID (' + voidWhy + ')'; console.log(`\nRUN VOID: ${voidWhy}. Re-run on another box; no verdict above counts.`); }
fs.writeFileSync(path.join(dir, 'score.json'), JSON.stringify(out, null, 1));
