// End-to-end: the Aural pane's one-command setup ("This computer" tab).
// It detects macOS / Linux from the browser, shows the matching install command and plan, every link in the
// plan resolves, the served installer is the repo's, the copy button copies the command, and the pane
// connects by itself once aural-local answers (a stub here, on 127.0.0.1:4317).
// Usage: node test/music-atlas/aural-setup-e2e.mjs <base-url> [shots-dir]   (serve a bundle with tools/sound-atlas-serve.mjs)
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:8871/", shots = process.argv[3];
const origin = new URL(base).origin;
const browser = await chromium.launch();
const errors = [];
const UA = {
  mac: { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", platform: "MacIntel" },
  linux: { ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", platform: "Linux x86_64" },
};

async function openPc(kind) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, userAgent: UA[kind].ua, permissions: ["clipboard-read", "clipboard-write", ...(new URL(base).protocol === "https:" ? ["local-network-access"] : [])] });
  await ctx.addInitScript((p) => { Object.defineProperty(navigator, "platform", { get: () => p }); Object.defineProperty(navigator, "userAgentData", { get: () => undefined }); localStorage.removeItem("sa-aural"); }, UA[kind].platform);
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(`${kind}: ${e.message}`));
  await page.goto(base + "#aural"); await page.waitForSelector("aside.aural.open", { timeout: 30000 });
  await page.click('aside.aural [data-tab="pc"]');
  await page.waitForSelector("aside.aural [data-install]");
  return { ctx, page };
}

const want = { mac: "Set up this computer · macOS", linux: "Set up this computer · Linux · Hyprland or any PipeWire desktop" };
const links = new Set();
for (const kind of ["mac", "linux"]) {
  const { ctx, page } = await openPc(kind);
  assert.equal(await page.textContent("aside.aural h5"), want[kind], `${kind}: the pane names the detected OS`);
  const cmd = await page.textContent("aside.aural [data-cmd]");
  const live = origin === "https://glide-music-picker.vercel.app";
  assert.equal(cmd, `curl -fsSL ${origin}/aural/install.sh | ${live ? "" : `AURAL_SITE=${origin} `}bash`, `${kind}: install command points at this site`);
  await page.click("aside.aural .plan summary");
  const items = await page.$$eval("aside.aural .plan li b", (bs) => bs.map((b) => b.textContent));
  assert.ok(items.length >= 4, `${kind}: plan lists what it installs`);
  for (const h of await page.$$eval("aside.aural a[href]", (as) => as.map((a) => a.href))) links.add(h);
  if (shots) await page.screenshot({ path: `${shots}/aural-setup-${kind}.png` });
  if (kind === "linux") {
    // one click: copy, then the pane waits for aural-local and connects when it answers
    await page.click("aside.aural [data-install]");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), cmd, "the button copies the command");
    const stub = createServer((req, res) => {
      const h = { "content-type": "application/json", "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-private-network": "true", "access-control-allow-headers": "content-type" };
      if (req.method === "OPTIONS") { res.writeHead(204, h); return res.end(); }
      const p = new URL(req.url, "http://x").pathname;
      res.writeHead(200, h);
      res.end(JSON.stringify(p === "/health" ? { ok: true, name: "aural-local", caps: { os: "linux", pipewire: true, dotfiles: "/home/x/workspace/.files" } } : { sinks: [{ name: "effect_input.headphone_dsp", desc: "Headphone DSP", default: true }], scapes: ["clean", "speakers", "room"], camilla: false, evolve: null, active: null }));
    }).listen(4317, "127.0.0.1");
    await page.waitForFunction(() => /Connected/.test(document.querySelector("aside.aural .pane")?.textContent ?? ""), null, { timeout: 15000 });
    assert.ok(await page.locator('aside.aural [data-sink="effect_input.headphone_dsp"]').count(), "connected: the computer's outputs are listed");
    if (shots) await page.screenshot({ path: `${shots}/aural-setup-connected.png` });
    stub.close();
  }
  await ctx.close();
}

// the served installer is the repo's own, and so is the server it installs
for (const [path, file] of [["/aural/install.sh", "tools/aural-local/install.sh"], ["/aural/install.txt", "tools/aural-local/install.sh"], ["/aural/server.mjs", "tools/aural-local/server.mjs"]]) {
  const body = await (await fetch(origin + path)).text();
  assert.equal(body, readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), `${path} is ${file}`);
}
// every link in both plans resolves (GitHub files on .files@dev, release pages, project sites, the served files)
const bad = [];
await Promise.all([...links].map(async (u) => {
  const r = await fetch(u, { method: "GET", redirect: "follow" }).catch((e) => ({ status: String(e) }));
  if (!(r.status >= 200 && r.status < 400)) bad.push(`${r.status} ${u}`);
}));
assert.deepEqual(bad, [], "dead links in the setup plan");
assert.deepEqual(errors, []);
console.log(`aural setup e2e ok · ${links.size} links resolve`);
await browser.close();
