// Web side of the A/B: headed Chrome on the bot display, fresh profile, the same phases and
// BENCH markers as the GPUI SA_BENCH mode. Usage: node web.mjs <url> <user-data-dir>
import { chromium } from "playwright-core";
const [url, udd] = process.argv.slice(2);
const say = (s) => process.stdout.write("BENCH " + s + "\n");
const ctx = await chromium.launchPersistentContext(udd, {
  reducedMotion: process.env.WEB_REDUCED ? "reduce" : "no-preference",
  executablePath: "/usr/bin/google-chrome-stable", headless: false, viewport: { width: 1280, height: 772 },
  args: ["--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "--window-size=1280,800",
    // Tuned: Chrome on the Xvnc bot display otherwise falls back to SwiftShader/llvmpipe; these put it on the same NVIDIA GPU GPUI uses.
    ...(process.env.WEB_WL ? ["--ozone-platform=wayland"] : []),
    "--ignore-gpu-blocklist", ...(process.env.WEB_NOVK ? [] : ["--use-angle=vulkan", "--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE"])],
});
const errs = [];
const p = ctx.pages()[0] ?? (await ctx.newPage());
p.on("pageerror", (e) => errs.push(String(e)));
const t0 = Date.now();
await p.goto(url);
await p.waitForFunction(() => document.querySelectorAll("#body .trk").length > 0 && window.__sa?.all?.length > 0, null, { timeout: 60000, polling: "raf" });
await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
say(`ready_ms ${Date.now() - t0}`); // from goto; the harness also timestamps this line from process spawn
const gpu = await p.evaluate(() => { const c = document.createElement("canvas").getContext("webgl"); const d = c?.getExtension("WEBGL_debug_renderer_info"); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : "none"; });
say(`gpu ${JSON.stringify(gpu)}`);
const fps = await p.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
say(`raf_per_s ${fps}`);
await p.waitForTimeout(300); say("idle_start"); await p.waitForTimeout(5000); say("idle_end");
say("filter_start");
for (const q of ["calm", "night", "zzz", "a", ""]) {
  const ms = await p.evaluate(async (q) => {
    const sa = window.__sa, el = document.querySelector("#q"); el.value = q;
    const t = performance.now(); await sa.run({ fly: false });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return [performance.now() - t, sa.result.hits.length];
  }, q);
  say(`filter_ms ${JSON.stringify(q)} ${ms[0].toFixed(2)} hits ${ms[1]}`);
  await p.waitForTimeout(600 - Math.min(ms[0], 500));
}
say("filter_end"); say("scroll_start");
const sc = await p.evaluate(() => new Promise((res) => {
  const b = document.querySelector("#body"), ts = []; b.scrollTop = 0; let k = 0;
  const f = (now) => { ts.push(now); if (k++ < 240) { b.scrollTop += 44; requestAnimationFrame(f); } else res(ts); };
  requestAnimationFrame(f);
}));
const d = sc.slice(1).map((t, i) => t - sc[i]).sort((a, b) => a - b);
say(`scroll_frames ${d.length} p50 ${d[d.length >> 1].toFixed(2)} p95 ${d[Math.floor(d.length * 0.95)].toFixed(2)} max ${d[d.length - 1].toFixed(2)}`);
say("scroll_end");
const c0 = Date.now();
await p.evaluate(() => window.__sa.select("sl-rise-full", { play: true }));
await p.waitForFunction(() => window.__sa.audio.currentTime > 0, null, { timeout: 30000, polling: 10 });
say(`audio_ms ${Date.now() - c0}`);
say("play_start"); await p.waitForTimeout(10000); say("play_end");
say(`page_errors ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);
await ctx.close();
