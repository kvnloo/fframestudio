import { chromium } from "playwright-core";
for (const args of [
  ["--ignore-gpu-blocklist"],
  ["--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE"],
  ["--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=gl"],
]) {
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: false, args });
  const p = await b.newPage(); await p.goto("about:blank");
  const r = await p.evaluate(() => { const c = document.createElement("canvas").getContext("webgl"); const d = c?.getExtension("WEBGL_debug_renderer_info"); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : "none"; });
  await p.goto("chrome://gpu"); const st = await p.evaluate(() => document.body.innerText.match(/Canvas:.*|Compositing:.*|Rasterization:.*/g)?.join(" | ") ?? (document.querySelector("info-view")?.shadowRoot?.textContent ?? "").match(/(Canvas|Compositing|Rasterization|Vulkan):\s*\S+[^\n]*/g)?.slice(0,4).join(" | "));
  console.log(JSON.stringify(args), "\n  ", r, "\n  ", st); await b.close();
}
