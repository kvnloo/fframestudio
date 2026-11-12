"""Steer e2e: dragging a Track-pane meter changes the NOW PLAYING song (mid-drag, finger still down),
continuing at the same point; release keeps your settings on the new song's card; picking a song by
hand ends the tune."""
import json, sys, time
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
TID = sys.argv[3] if len(sys.argv) > 3 else "inc-USUAN2000020"
res, errs = {}, []
now = lambda pg: pg.evaluate("({ sel: __sa.state.sel, title: document.querySelector('#player b, .np b')?.textContent, playing: !__sa.audio.paused, t: +__sa.audio.currentTime.toFixed(1) })")
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True).new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.goto(URL + f"#t={TID}", wait_until="domcontentloaded")
    pg.wait_for_function("window.__sa && document.querySelector('.card input.tune')", timeout=60000)
    pg.evaluate("__sa.sheetTo('full')"); pg.evaluate("__sa.audio.play()"); time.sleep(4)
    res["before"] = now(pg)
    # flash probe: how much of the pane is torn down and which entrance animations replay while steering
    pg.evaluate("""(() => { const w = window.__flash = { removed: 0, anims: {}, scrollJumps: 0 }, b = document.querySelector('#body'); let st = b.scrollTop;
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.removedNodes) if (n.nodeType === 1) w.removed += 1 + n.querySelectorAll('*').length; }).observe(b, { childList: true, subtree: true });
      document.addEventListener('animationstart', (e) => { w.anims[e.animationName] = (w.anims[e.animationName] || 0) + 1; }, true);
      b.addEventListener('scroll', () => { if (Math.abs(b.scrollTop - st) > 40) w.scrollJumps++; st = b.scrollTop; }); })()""")
    inp = pg.locator("input.tune[data-k='bright']"); inp.scroll_into_view_if_needed(); time.sleep(0.4)
    bx = inp.bounding_box(); y = bx["y"] + bx["height"] / 2
    hi = int(inp.input_value()) > 50; x0 = bx["x"] + bx["width"] * 0.5; x1 = bx["x"] + bx["width"] * (0.04 if hi else 0.96)
    c = pg.context.new_cdp_session(pg); pts = lambda x: [{"x": x, "y": y}]
    c.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pts(x0)})
    for i in range(1, 13): c.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pts(x0 + (x1 - x0) * i / 12)}); time.sleep(0.03)
    time.sleep(1.5)  # finger still down, paused mid-drag
    res["mid_drag"] = now(pg)
    res["mid_drag_slider_alive"] = pg.evaluate("document.querySelector(\"input.tune[data-k='bright']\")?.isConnected")
    pg.screenshot(path=f"{OUT}/steer-middrag.png")
    c.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); time.sleep(1.5)
    res["after_release"] = now(pg)
    res["flash"] = pg.evaluate("window.__flash")
    res["card_title"] = pg.evaluate("document.querySelector('.card .lin .lv:last-child .v')?.textContent")
    res["knob_kept"] = pg.evaluate("document.querySelector(\"input.tune[data-k='bright']\").value")
    res["next"] = pg.eval_on_selector_all(".tunes .trk b", "els => els.map(e => e.textContent)")
    pg.locator(".meters").scroll_into_view_if_needed(); time.sleep(0.5)
    pg.screenshot(path=f"{OUT}/steer-after.png")
    # a second move keeps steering from the same settings
    inp = pg.locator("input.tune[data-k='busy']"); inp.scroll_into_view_if_needed(); time.sleep(0.3)
    bx = inp.bounding_box(); y = bx["y"] + bx["height"] / 2; x0 = bx["x"] + bx["width"] * 0.5
    x1 = bx["x"] + bx["width"] * (0.04 if int(inp.input_value()) > 50 else 0.96)
    c.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pts(x0)})
    for i in range(1, 13): c.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pts(x0 + (x1 - x0) * i / 12)}); time.sleep(0.03)
    c.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); time.sleep(1.5)
    res["after_second"] = now(pg)
    res["bright_still_set"] = pg.evaluate("document.querySelector(\"input.tune[data-k='bright']\").value")
    # scrub: drag the progress bar across in 20 steps; the thumb must follow the finger every step,
    # and the audio must not be re-seeked on every move (that stutters)
    pg.evaluate("""(() => { window.__seeks = 0; __sa.audio.addEventListener('seeking', () => window.__seeks++); })()""")
    sb = pg.locator(".scrub .track").bounding_box(); sy = sb["y"] + sb["height"] / 2; xs = [sb["x"] + sb["width"] * (0.1 + 0.8 * i / 20) for i in range(21)]
    c.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": xs[0], "y": sy}]}); follow = []
    for x in xs[1:]:
        c.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": sy}]}); time.sleep(0.016)
        follow.append(round(pg.evaluate("(() => { const r = document.querySelector('#thumb .thumb').getBoundingClientRect(), t = document.querySelector('.scrub .track').getBoundingClientRect(); return (r.left + r.width / 2 - t.left) / t.width; })()"), 3))
    c.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); time.sleep(0.8)
    want = [round(0.1 + 0.8 * i / 20, 3) for i in range(1, 21)]
    res["scrub_follow"] = follow; res["scrub"] = {"max_lag": round(max(abs(a - b) for a, b in zip(follow, want)), 3), "seeks_during_drag": pg.evaluate("window.__seeks"), "landed": round(pg.evaluate("__sa.audio.currentTime / __sa.audio.duration"), 3), "playing": pg.evaluate("!__sa.audio.paused")}
    # pick a song by hand: the tune ends
    pg.evaluate("__sa.setView('library')"); time.sleep(0.6)
    row = pg.locator(".trk").nth(3); rid = row.get_attribute("data-id"); row.click(); time.sleep(1)
    pg.evaluate("__sa.setView('track')"); time.sleep(0.6)
    res["manual_pick_ends_tune"] = pg.evaluate(f"__sa.state.sel === {json.dumps(rid)} && !document.querySelector('.meters.tuning') && !document.querySelector('.tunes')")
    res["errors"] = errs
    b.close()
print(json.dumps(res, indent=1))
