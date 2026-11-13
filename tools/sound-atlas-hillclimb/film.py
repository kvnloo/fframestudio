"""Critic-loop motion capture: film every Sound Atlas motion frame by frame on a phone viewport.
Slow motion that the app cannot tell from real time: the page clock (performance.now, rAF
timestamps, setTimeout/setInterval delays) and CSS animations/transitions (CDP
Animation.setPlaybackRate) both run at RATE, and the harness stretches its own touch timings by
1/RATE, so every screenshot is ~1 app frame apart. Per motion it writes a cropped filmstrip
labelled in app milliseconds, every haptic (navigator.vibrate) with its app-time offset, and
supersede collisions (two vibrate calls inside 30 ms: on Android the later call cancels the first).
usage: film.py <url> <outdir> [width height] [only-substring]"""
import io, json, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

URL, OUT = sys.argv[1], sys.argv[2]
W, H = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (393, 852)
ONLY = sys.argv[5] if len(sys.argv) > 5 else ""
RATE = 0.1
INIT = r"""(() => {
  const rn = performance.now.bind(performance); let base = rn(), vb = base, rate = 1;
  const vnow = () => vb + (rn() - base) * rate;
  performance.now = vnow; window.__setRate = (r) => { vb = vnow(); base = rn(); rate = r; };
  const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf(() => cb(vnow()));
  const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.setTimeout = (f, d = 0, ...a) => st(f, d / rate, ...a); window.setInterval = (f, d = 0, ...a) => si(f, d / rate, ...a);
  window.__hap = []; navigator.vibrate = (p) => { __hap.push({ t: vnow(), p }); return true; };
})()"""

def main():
    res = {"viewport": [W, H], "rate": RATE, "motions": []}
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script(INIT)
        cdp = ctx.new_cdp_session(pg); cdp.send("Animation.enable")
        S = lambda s: time.sleep(s / RATE)  # app-time sleep while slowed
        def touch(kind, pts): cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y} for x, y in pts]})
        def tap(x, y): touch("touchStart", [(x, y)]); S(0.06); touch("touchEnd", [])
        def hold(x, y, s): touch("touchStart", [(x, y)]); S(s); touch("touchEnd", [])
        def drag(x0, y0, x1, y1, ms=300, steps=14):
            touch("touchStart", [(x0, y0)]); S(0.05)
            for i in range(1, steps + 1): touch("touchMove", [(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)]); S(ms / steps / 1000)
            touch("touchEnd", [])
        def rect(sel):
            r = pg.evaluate(f"(() => {{ const e = document.querySelector({json.dumps(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }})()")
            if not r: raise RuntimeError("missing " + sel)
            return r
        ctr = lambda sel: (lambda r: (r[0] + r[2] / 2, r[1] + r[3] / 2))(rect(sel))
        def motion(name, act, settle, crop):
            if ONLY and ONLY not in name: return
            import threading
            shots, stop = [], threading.Event()
            pg.evaluate(f"__setRate({RATE}); __hap.length = 0"); cdp.send("Animation.setPlaybackRate", {"playbackRate": RATE})
            t0 = time.time()
            shots.append((0, pg.screenshot(type="jpeg", quality=80)))
            act_err = []
            # Playwright sync API is single-threaded: interleave action steps and screenshots by
            # running the action first in slow time (touch dispatch is fast), shooting as we go.
            try: act(lambda: shots.append(((time.time() - t0) * RATE * 1000, pg.screenshot(type="jpeg", quality=80))))
            except Exception as e: act_err.append(str(e))
            end = time.time() + settle / RATE
            while time.time() < end: shots.append(((time.time() - t0) * RATE * 1000, pg.screenshot(type="jpeg", quality=80)))
            hap = pg.evaluate("__hap.map(h => ({ ...h }))"); t0v = pg.evaluate("performance.now()") - (time.time() - t0) * RATE * 1000
            pg.evaluate("__setRate(1)"); cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
            hs = [{"ms": round(h["t"] - t0v), "p": h["p"]} for h in hap]
            clash = [[a, c] for a, c in zip(hs, hs[1:]) if c["ms"] - a["ms"] < 30]
            res["motions"].append({"name": name, "shots": len(shots), "haptics": hs, "supersede": clash, "error": act_err})
            strip(name, shots, crop)
        # boot (real time), dismiss the fullscreen hint
        pg.goto(URL, wait_until="domcontentloaded"); pg.wait_for_function("window.__sa && __sa.all?.length", timeout=60000)
        pg.evaluate("localStorage.setItem('sa-fs','no'); document.querySelector('.fsh')?.remove()"); time.sleep(2.5)
        top = lambda: rect("#views")[1]
        motion("01-sheet-drag-half", lambda sh: (drag(W / 2, top() - 60, W / 2, H * 0.45, 260), sh()), 0.9, None)
        motion("02-tap-row-play", lambda sh: (tap(*ctr("#body .trk:nth-of-type(3)")), sh()), 1.0, "#player")
        motion("03-play-pause", lambda sh: (tap(*ctr("#pp")), sh()), 0.6, "#player")
        motion("04-view-track", lambda sh: (tap(*ctr("#views [data-view=track]")), sh()), 0.7, "#sheet")
        motion("05-view-similar", lambda sh: (tap(*ctr("#views [data-view=similar]")), sh()), 0.7, "#sheet")
        motion("06-heart", lambda sh: (tap(*ctr("#ph")), sh()), 0.6, "#player")
        pg.evaluate("__sa.setView('track')"); time.sleep(0.6)
        pg.evaluate("document.querySelector('input.tune')?.scrollIntoView({block:'center'})"); time.sleep(0.5)
        def steer(sh):
            x, y = ctr("input.tune[data-k='bright']") if pg.locator("input.tune[data-k='bright']").count() else ctr("input.tune")
            drag(x - 40, y, x + 70, y, 500, 10); sh()
        motion("07-steer-meter", steer, 1.4, "#sheet")
        pg.evaluate("__sa.setView('library')"); time.sleep(0.8)
        motion("08-hold-row", lambda sh: (touch("touchStart", [ctr("#body .trk:nth-of-type(5)")]), [ (S(0.1), sh()) for _ in range(8)], touch("touchEnd", []), sh()), 0.8, "#sheet")
        motion("09-sheet-drag-peek", lambda sh: (drag(W / 2, top() - 60, W / 2, H - 40, 260), sh()), 0.9, None)
        motion("10-sort-hold-menu", lambda sh: (touch("touchStart", [ctr("#sortbtn")]), [(S(0.1), sh()) for _ in range(7)], touch("touchEnd", []), sh()), 0.5, "#rail")
        motion("11-sort-pick", lambda sh: (tap(*ctr("#sortmenu button:nth-of-type(2)")), sh()), 1.4, None)
        motion("12-chip-filter", lambda sh: (tap(*ctr("#chips .chip:nth-of-type(2)")), sh()), 1.0, None)
        motion("13-map-tap-dot", lambda sh: (tap(W * 0.62, H * 0.32), sh()), 1.4, None)
        res["errors"] = errs
        json.dump(res, open(f"{OUT}/motion.json", "w"), indent=1)
        print(json.dumps(res))
        b.close()

def strip(name, shots, crop_sel, cols=6):
    keep, last = [], None
    for t, d in shots:
        if d != last: keep.append((t, d)); last = d
    if len(keep) > 36: keep = [keep[round(i * (len(keep) - 1) / 35)] for i in range(36)]
    ims = [Image.open(io.BytesIO(d)).convert("RGB") for _, d in keep]
    if crop_sel == "#player": box = (0, int(ims[0].height * 0.42), ims[0].width, int(ims[0].height * 0.62))
    elif crop_sel in ("#sheet",): box = (0, int(ims[0].height * 0.4), ims[0].width, ims[0].height)
    elif crop_sel == "#rail": box = (0, int(ims[0].height * 0.35), ims[0].width, int(ims[0].height * 0.95))
    else: box = (0, 0, ims[0].width, ims[0].height)
    ims = [im.crop(box) for im in ims]
    sc = min(1, 330 / ims[0].width); w, h = int(ims[0].width * sc), int(ims[0].height * sc)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * (h + 18)), (0, 0, 0)); dr = ImageDraw.Draw(sheet)
    for i, ((t, _), im) in enumerate(zip(keep, ims)):
        x, y = (i % cols) * w, (i // cols) * (h + 18)
        sheet.paste(im.resize((w, h)), (x, y + 18)); dr.text((x + 4, y + 3), f"{t:.0f}ms", fill=(255, 220, 120))
    sheet.save(f"{OUT}/film-{name}.png")

if __name__ == "__main__":
    main()
