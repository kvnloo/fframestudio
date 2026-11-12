"""Swap e2e: Track pane Layers, tap ⇄ on drums: a similar split song lends its drums, stretched and
playing while the master is muted; tap through to give it back."""
import json, sys, time
from playwright.sync_api import sync_playwright
URL, OUT = sys.argv[1], sys.argv[2]; TID = sys.argv[3] if len(sys.argv) > 3 else "inc-USUAN2000020"
res, errs = {}, []
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True).new_page()
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.goto(URL + f"#t={TID}", wait_until="domcontentloaded")
    pg.wait_for_selector(".layers .lane", timeout=60000)
    pg.evaluate("__sa.sheetTo('full')"); time.sleep(0.6); pg.evaluate("__sa.audio.play()"); time.sleep(1.5)
    btn = pg.locator(".lane:has(button[data-k='drums']) button[data-lmix='swap']"); btn.scroll_into_view_if_needed(); btn.click(); time.sleep(3)
    res["first"] = pg.evaluate("""({ toast: document.querySelector('.toast, #toast')?.textContent, muted: __sa.audio.muted, master: +__sa.audio.currentTime.toFixed(2),
      lane: document.querySelector(".lane:has(button[data-k='drums']) b").textContent,
      lent: (() => { const l = __sa.mixer.lent('drums'); return l && { id: l.id, rate: +l.rate.toFixed(3), playing: !l.el.paused, t: +l.el.currentTime.toFixed(2), pr: +l.el.playbackRate.toFixed(3), muted: l.el.muted, ready: l.el.readyState }; })() })""")
    pg.locator(".layers").screenshot(path=f"{OUT}/swap-lanes.png")
    n = 0
    while n < 60 and "back from" not in (pg.evaluate("document.querySelector('.toast, #toast')?.textContent") or ""):
        pg.locator(".lane:has(button[data-k='drums']) button[data-lmix='swap']").click(); time.sleep(0.15); n += 1
    res["cycled"] = n; res["after_back_muted"] = pg.evaluate("__sa.audio.muted")
    res["errors"] = errs; b.close()
print(json.dumps(res, indent=1))
