"""Layers e2e: phone viewport; Track pane lists stems, scrolling to them zooms the map in, rings draw,
solo isolates (master muted, stem audio playing), zooming out by hand then in brings the pane back."""
import json, sys, time
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
TID = sys.argv[3] if len(sys.argv) > 3 else "inc-USUAN2000020"
res, errs = {}, []
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True).new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    webm = []; pg.on("response", lambda r: ".webm" in r.url and webm.append(r.status))
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.goto(URL + f"#t={TID}", wait_until="domcontentloaded")
    pg.wait_for_function("window.__sa && document.querySelector('.card')", timeout=60000)
    pg.wait_for_selector(".layers .lane", timeout=30000)
    res["lanes"] = pg.eval_on_selector_all(".layers .lane b", "els => els.map(e => e.textContent)")
    pg.evaluate("__sa.sheetTo('half')"); time.sleep(0.8)
    res["k_before"] = pg.evaluate("__sa.A.layerK")
    pg.evaluate("document.querySelector('#body').scrollTo({top: document.querySelector('.layers').offsetTop - 8})")
    time.sleep(1.6)
    res["k_after_scroll"] = pg.evaluate("__sa.A.layerK")
    pg.evaluate("__sa.audio.play()"); time.sleep(2.5)
    pg.screenshot(path=f"{OUT}/layers-rings.png")
    pg.click(".lane:nth-of-type(1) button[data-lmix='solo']"); time.sleep(2.5)
    res["after_solo"] = pg.evaluate("""({ masterMuted: __sa.audio.muted, masterT: +__sa.audio.currentTime.toFixed(2),
      stems: [...document.querySelectorAll('.lane')].map(l => [l.querySelector('b').textContent, !l.classList.contains('out'), l.classList.contains('solo')]),
      toast: document.querySelector('.toast, #toast')?.textContent })""")
    pg.screenshot(path=f"{OUT}/layers-solo.png")
    pg.click(".layers h4 button[data-lmix='reset']"); time.sleep(0.6)
    res["after_reset_muted"] = pg.evaluate("__sa.audio.muted")
    # scroll the pane away: the map flies back out
    pg.evaluate("document.querySelector('#body').scrollTo({top: 0})"); time.sleep(1.8)
    res["k_after_scroll_away"] = pg.evaluate("__sa.A.layerK")
    # zoom in by hand (double-tap path not needed: drive the camera), the pane comes to Layers
    pg.evaluate(f"__sa.A.zoomOn({json.dumps(TID)}, 10, 300)"); time.sleep(1.8)
    res["pane_at_layers"] = pg.evaluate("(() => { const r = document.querySelector('.layers').getBoundingClientRect(); return r.top < innerHeight - 60 && r.bottom > 0 && document.querySelector('#body').scrollTop > 0; })()")
    pg.screenshot(path=f"{OUT}/layers-zoomed.png")
    # tap a ring on the canvas: isolates that layer
    pg.evaluate("__sa.audio.play()"); time.sleep(0.5)
    res["stem_responses"] = webm[:8]; res["sid"] = pg.evaluate("localStorage.getItem('sa-sid')")
    res["errors"] = errs
    b.close()
print(json.dumps(res, indent=1))
