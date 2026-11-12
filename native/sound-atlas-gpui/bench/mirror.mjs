// Save every same-origin response prod Sound Atlas loads (boot + one play) into ./mirror.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const ORIGIN = "https://glide-music-picker.vercel.app";
const OUT = join(process.cwd(), "mirror");
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: true });
const p = await b.newPage();
const saves = [];
p.on("response", (r) => saves.push((async () => {
  const u = new URL(r.url()); if (u.origin !== ORIGIN || r.status() !== 200 || u.pathname.startsWith("/api/")) return;
  let f = u.pathname.endsWith("/") ? u.pathname + "index.html" : u.pathname;
  try { const body = await r.body(); mkdirSync(dirname(join(OUT, f)), { recursive: true }); writeFileSync(join(OUT, f), body); console.log(r.status(), f, body.length); } catch {}
})()));
await p.goto(ORIGIN + "/", { waitUntil: "networkidle" });
await p.waitForTimeout(4000);
await Promise.all(saves);
await b.close();
