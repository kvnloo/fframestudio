// End-to-end on a phone profile (Pixel 7): the fullscreen hint fades and leaves by itself even when the user
// only scrolls, and Aural reaches aural-local over Tailscale from the computer's phone link (#aural=<addr>).
// Needs aural-local running on this machine with Tailscale up (its /health reports the tailnet address).
// Usage: node test/music-atlas/remote-e2e.mjs <base-url> [shots-dir]
import { chromium, devices } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://127.0.0.1:8874/", shots = process.argv[3];
const tailnet = (await fetch("http://127.0.0.1:4317/health", { headers: { origin: "http://127.0.0.1:8874" } }).then((r) => r.json())).tailnet;
assert.match(tailnet ?? "", /^https:\/\/.+\.ts\.net:\d+$/, "aural-local is running and published on the tailnet");
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices["Pixel 7"] });
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png` });

// 1. The hint shows, the user only scrolls the sheet (no tap ever reaches it), and it still goes away.
await page.goto(base); await page.waitForFunction(() => window.__sa?.all?.length > 100, null, { timeout: 30000 });
await page.waitForSelector(".fsh.on", { timeout: 5000 }); await shot("1-hint");
await page.mouse.wheel(0, 300);
const t0 = Date.now(); await page.waitForSelector(".fsh", { state: "detached", timeout: 6000 });
console.log(`hint gone after ${Date.now() - t0} ms`);

// 2. The computer's phone link: the pane opens, points at the tailnet address and connects through it.
await page.goto(base + "#aural=" + encodeURIComponent(tailnet));
await page.waitForSelector("aside.aural.open");
await page.waitForFunction(() => /Disconnect/.test(document.querySelector("aside.aural")?.textContent ?? ""), null, { timeout: 15000 });
assert.equal(new URL(page.url()).hash, "#aural", "the address is taken out of the URL once saved");
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("sa-aural")).base), tailnet, "the address is remembered");
await shot("2-connected");

// 3. Unreachable address: the pane explains Tailscale / same Wi-Fi and offers the address box.
await page.evaluate(async () => { const m = await window.__sa.aural(); m.useServer("https://nope.tail00000.ts.net:4317"); });
await page.waitForFunction(() => /Can't reach/.test(document.querySelector("aside.aural")?.textContent ?? ""), null, { timeout: 30000 });
const txt = await page.locator("aside.aural").textContent();
assert.match(txt, /Tailscale/); assert.match(txt, /Wi.Fi/); assert.equal(await page.locator("aside.aural [data-addr]").count(), 1);
await shot("3-hint");

// 4. Typing the right address in the box connects again.
await page.locator("aside.aural [data-addr]").fill(tailnet); await page.locator("aside.aural [data-useaddr]").click();
await page.waitForFunction(() => /Disconnect/.test(document.querySelector("aside.aural")?.textContent ?? ""), null, { timeout: 15000 });

assert.deepEqual(errors, []);
await browser.close(); console.log("remote e2e ok · " + tailnet);
