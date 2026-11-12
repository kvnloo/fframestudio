"""Sound Atlas hill-climb scorer. FROZEN: a climb round never edits this directory (autoresearch rule:
the evaluator is read-only to the thing being optimised). Every number comes from the real app in a
real browser; nothing here is a model's opinion. Model critics score separately (see README.md).

usage: score.py <url> <outdir> [--journey journey.json] [--skip-e2e]
Writes <outdir>/scorecard.json and prints one line per category. Exit 1 if a hard gate fails."""
import json, statistics, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
RUBRIC = json.loads((HERE / "rubric.json").read_text())
URL, OUT = sys.argv[1], Path(sys.argv[2])
ARGS = sys.argv[3:]
JOURNEY = ARGS[ARGS.index("--journey") + 1] if "--journey" in ARGS else None
TID = RUBRIC["fixture_track"]
OUT.mkdir(parents=True, exist_ok=True)

INIT = r"""(() => {
  window.__hap = []; navigator.vibrate = (p) => { __hap.push({ t: performance.now(), p }); return true; };
  window.__anim = []; document.addEventListener('animationstart', (e) => __anim.push({ t: performance.now(), n: e.animationName }), true);
  window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => __lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  window.__toasts = []; addEventListener('DOMContentLoaded', () => { const t = document.querySelector('#toast'); t && new MutationObserver(() => __toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); });
})()"""

# Layout checks (from the critic loop's shots.py): clipping, truncation, small targets, WCAG contrast,
# plus elements of the header/rail crossing the screen edge outside an intentional scroller.
CHECK = r"""((minTap) => {
  const vw = innerWidth, out = { overflowX: document.documentElement.scrollWidth - vw, clipped: [], truncated: [], small: [], lowContrast: [], edge: [] };
  const lum = (c) => { const unit = c.startsWith("color("); const m = c.replace(/^color\(srgb/, "").match(/[\d.]+/g); if (!m) return null;
    let [r,g,b] = m.map(Number); const a = c.includes("/") || c.startsWith("rgba") ? Number(m[3]) : 1; if (a < .5) return null;
    const f = (v) => { v = unit ? v : v/255; return v <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4 }; return .2126*f(r)+.7152*f(g)+.0722*f(b) };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const L = lum(getComputedStyle(e).backgroundColor); if (L != null) return L; } return lum("rgb(13,17,18)") };
  const scroller = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || +cs.opacity === 0) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const id = `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 40) + ":" + el.textContent.trim().slice(0, 24);
    if (own && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== "visible" && cs.textOverflow !== "ellipsis") out.clipped.push(id);
    if (own && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) && (cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") && !el.closest(".trk, #pt")) out.truncated.push(id);
    if (el.closest(".top, .rail") && (r.left < -1 || r.right > vw + 1) && !scroller(el)) out.edge.push(id);
    if (el.matches("button, a, [role=tab], input:not(.tune)") && (r.width < minTap || r.height < minTap) && !el.closest("[hidden]")) out.small.push(`${id} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (own && +cs.opacity > 0.3) { const fg = lum(cs.color), bg = bgOf(el); if (fg != null) { const cr = (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
      if (cr < (parseFloat(cs.fontSize) >= 18 ? 3 : 4.5)) out.lowContrast.push(`${id} ${cr.toFixed(2)}`); } }
  }
  for (const k of ["clipped", "truncated", "small", "lowContrast", "edge"]) out[k] = [...new Set(out[k])];
  return out; })"""

# Animations that move layout properties cost a layout per frame (owner motion budget: transform/opacity).
LAYOUT_ANIMS = r"""(() => { const bad = new Set(["width","height","top","left","right","bottom","margin","marginTop","marginBottom","marginLeft","marginRight","padding","paddingTop","paddingBottom","maxHeight","flexBasis","fontSize","gridTemplateRows","gridTemplateColumns"]);
  const hits = []; for (const a of document.getAnimations()) { const props = a.transitionProperty ? [a.transitionProperty] : (a.effect?.getKeyframes?.() || []).flatMap((k) => Object.keys(k));
    for (const p of props) if (bad.has(p.replace(/-([a-z])/g, (_, c) => c.toUpperCase()))) hits.push(`${a.transitionProperty ? "transition" : a.animationName}:${p}`); }
  return hits; })()"""


def phone(b, w, h, reduced=False, fs_hint=False):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, has_touch=True, is_mobile=True, reduced_motion="reduce" if reduced else "no-preference")
    pg = ctx.new_page(); pg.errs = []
    pg.on("pageerror", lambda e: pg.errs.append("pageerror " + str(e)[:160]))
    pg.on("console", lambda m: m.type == "error" and pg.errs.append("console " + m.text[:160]))
    pg.add_init_script(INIT)
    if not fs_hint: pg.add_init_script("localStorage.setItem('sa-fs','no')")
    pg.cdp = ctx.new_cdp_session(pg)
    return pg


def boot(pg, hash_=""):
    t0 = time.time(); pg.goto(URL + hash_, wait_until="domcontentloaded")
    pg.wait_for_function("window.__sa && __sa.all?.length", timeout=60000)
    ready = time.time() - t0; time.sleep(2.0); return ready


def touch(pg, kind, pts): pg.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y} for x, y in pts]})
def ctr(pg, sel):
    r = pg.evaluate(f"(() => {{ const e = document.querySelector({json.dumps(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }})()")
    if not r: raise RuntimeError("missing " + sel)
    return r
def tap(pg, sel): x, y = ctr(pg, sel); touch(pg, "touchStart", [(x, y)]); time.sleep(0.06); touch(pg, "touchEnd", [])
def haps(pg, since): return [h["p"] for h in pg.evaluate("__hap") if h["t"] >= since]
def now(pg): return pg.evaluate("performance.now()")
def full_library(pg): pg.evaluate("__sa.sheetTo('full'); __sa.setView('library')"); time.sleep(0.9)


def gates_and_craft(b, card):
    per = {}
    for w, h in RUBRIC["widths"]:
        pg = phone(b, w, h); ready = boot(pg)
        s = {"ready_s": round(ready, 2)}
        # the idle player line is the first-open instruction: it must read in full, not "Tap a dot to h…"
        s["idle_hint_fits"] = pg.evaluate("(() => [...document.querySelectorAll('#pt b, #pt small')].every((e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 2))()")
        for state, js in [("peek", "0"), ("half", "__sa.sheetTo('half')"), ("track", f"__sa.select({json.dumps(TID)}); __sa.sheetTo('full'); __sa.setView('track')")]:
            pg.evaluate(js); time.sleep(1.0); pg.screenshot(path=str(OUT / f"{w}-{state}.png"))
            s[state] = pg.evaluate(CHECK + f"({RUBRIC['gates']['min_tap_px']})")
        s["errors"] = pg.errs; per[w] = s; pg.context.close()
    agg = lambda k: sorted({x for s in per.values() for st in ("peek", "half", "track") for x in s[st][k]})
    card["gates"] = {
        "console_errors": sorted({e for s in per.values() for e in s["errors"]}),
        "overflow_x": max(s[st]["overflowX"] for s in per.values() for st in ("peek", "half", "track")),
        "clipped": agg("clipped"), "edge_crossers": agg("edge")}
    g = card["gates"]; g["pass"] = not g["console_errors"] and g["overflow_x"] <= 0 and not g["clipped"] and not g["edge_crossers"]
    card["idle_hint_fits"] = all(s["idle_hint_fits"] for s in per.values())
    card["craft"] = {"small_targets": agg("small"), "low_contrast": agg("lowContrast"), "truncated": agg("truncated")}
    card["perf"] = {"ready_s_median": statistics.median(s["ready_s"] for s in per.values())}


def interaction_suite(b, card):
    cases, motion, hap = card["cases"], card["motion"], card["haptics"]
    pg = phone(b, 393, 852); boot(pg)
    # perf: long tasks during boot, shipped JS/CSS bytes
    card["perf"]["longtasks_over_50ms"] = len([d for d in pg.evaluate("__lt") if d > 50])
    card["perf"]["js_css_kb"] = round(pg.evaluate("performance.getEntriesByType('resource').filter(e => /\\.(m?js|css)(\\?|$)/.test(e.name)).reduce((s, e) => s + (e.encodedBodySize || 0), 0)") / 1024)
    # first open teaches the map (journey 1)
    cold = pg.evaluate("document.body.innerText")
    cases["first_open_explains_dots"] = any(w in cold.lower() for w in RUBRIC["cases"]["first_open_explains_dots"]["any_of"])
    # haptics: one pulse per committed gesture, each long enough to feel
    full_library(pg)
    pulses = {}
    for name, sel in [("row_tap", "#body .trk:nth-of-type(3)"), ("play_pause", "#pp"), ("heart", "#ph"), ("tab_track", "#views [data-view=track]"), ("tab_library", "#views [data-view=library]")]:
        t = now(pg); tap(pg, sel); time.sleep(0.5); pulses[name] = haps(pg, t)
    # player title on a new song: does it glide or hard-cut? sample #pt each frame after a row tap
    t = now(pg)
    samples = pg.evaluate("""(sel) => new Promise((res) => { const pt = document.querySelector('#pt'), out = []; const t0 = performance.now();
      document.querySelector(sel).click(); const f = () => { const cs = getComputedStyle(pt); out.push([+cs.opacity, cs.transform, cs.translate]);
      if (performance.now() - t0 < 450) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); })""", "#body .trk:nth-of-type(6)")
    motion["title_glides"] = any(0.05 < o < 0.95 or (tr not in ("none", "") and tr != "matrix(1, 0, 0, 1, 0, 0)") or tl not in ("none", "") for o, tr, tl in samples)
    # hold a row: press, beats, release; no two pulses inside the supersede window
    t = now(pg); x, y = ctr(pg, "#body .trk:nth-of-type(4)"); touch(pg, "touchStart", [(x, y)])
    ring_seen = False
    for _ in range(9):
        time.sleep(0.1); ring_seen |= pg.evaluate("(() => { const r = document.querySelector('.press'); return !!r && (r.classList.contains('arm') || r.classList.contains('on')) && +getComputedStyle(r).opacity > 0.05; })()")
    touch(pg, "touchEnd", []); time.sleep(0.6); hold = pg.evaluate(f"__hap.filter(h => h.t >= {t})")
    gaps = [b_["t"] - a["t"] for a, b_ in zip(hold, hold[1:])]
    # sort hold: visible feedback before the menu opens (Sort felt dead)
    pg.evaluate("__sa.sheetTo('peek')"); time.sleep(0.9)
    sx, sy = ctr(pg, "#sortbtn"); touch(pg, "touchStart", [(sx, sy)]); time.sleep(0.25)
    cases["sort_hold_feedback"] = pg.evaluate("(() => { const r = document.querySelector('.press'); return !!r && r.classList.contains('arm') && +getComputedStyle(r).opacity > 0.05; })()")
    time.sleep(0.4); touch(pg, "touchEnd", []); time.sleep(0.3); pg.keyboard.press("Escape"); time.sleep(0.3)
    flat = [p for v in pulses.values() for p in v] + [h["p"] for h in hold]
    durs = [p if isinstance(p, (int, float)) else max(p[0::2]) for p in flat]
    hap.update({"pulses": pulses, "hold": [h["p"] for h in hold], "hold_ring_seen": ring_seen,
                "one_pulse_per_tap": all(len(v) <= 1 for v in pulses.values()),
                "commits_have_pulse": all(len(pulses[k]) == 1 for k in ("row_tap", "play_pause", "heart")),
                "min_pulse_ms": min(durs) if durs else None, "supersede_pairs": len([g for g in gaps if g < RUBRIC["gates"]["haptic_gap_ms"]])})
    # tab revisit must not replay entrances
    pg.evaluate(f"__sa.select({json.dumps(TID)}); __sa.sheetTo('full'); __sa.setView('track')"); time.sleep(1.2)
    pg.evaluate("__sa.setView('library')"); time.sleep(0.8); t = now(pg)
    pg.evaluate("__sa.setView('track')"); time.sleep(1.0)
    motion["revisit_replays"] = sorted({a["n"] for a in pg.evaluate("__anim") if a["t"] >= t} - set(RUBRIC["meaningful_anims"]))
    motion["layout_property_animations"] = sorted(set(pg.evaluate(LAYOUT_ANIMS)))
    # plain words on the Track card (journey 8/9): engineer jargon visible without a gloss
    txt = pg.evaluate("document.querySelector('.card')?.innerText || ''")
    cases["track_card_plain_words"] = [w for w in RUBRIC["cases"]["track_card_plain_words"]["jargon"] if w.lower() in txt.lower()] == []
    cases["credit_or_no_credit_on_card"] = bool(pg.evaluate("!!document.querySelector('[data-act=credit]') || /no credit/i.test(document.querySelector('.card')?.innerText || '')"))
    # frame pacing while the sheet is dragged (indicative only: headless is not the phone)
    pg.evaluate("__sa.sheetTo('half')"); time.sleep(0.8)
    pg.evaluate("window.__gaps = []; (() => { let last = performance.now(); const f = (t) => { __gaps.push(t - last); last = t; if (__gaps.length < 90) requestAnimationFrame(f); }; requestAnimationFrame(f); })()")
    yv = pg.evaluate("document.querySelector('#views').getBoundingClientRect().top") - 30
    touch(pg, "touchStart", [(196, yv)])
    for i in range(1, 16): touch(pg, "touchMove", [(196, yv - 18 * i)]); time.sleep(0.016)
    touch(pg, "touchEnd", []); time.sleep(1.2)
    g = sorted(pg.evaluate("__gaps")[2:]); motion["drag_frame_p95_ms"] = round(g[int(len(g) * 0.95) - 1], 1) if g else None
    # search: no contradictory toast while matches are on screen (journey 6)
    pg.evaluate("__sa.sheetTo('half')"); time.sleep(0.6); t0 = len(pg.evaluate("__toasts"))
    pg.fill("#q", "rainy night piano"); pg.press("#q", "Enter"); time.sleep(5)
    hits = pg.evaluate("__sa.result.hits.length"); said = pg.evaluate("__toasts")[t0:]
    cases["search_toast_agrees"] = not (hits and any("No new" in s for s in said))
    # chip at peek raises the sheet so the filtered list is visible (journey 5)
    pg.fill("#q", ""); pg.press("#q", "Enter"); time.sleep(1); pg.evaluate("__sa.sheetTo('peek')"); time.sleep(1)
    tap(pg, "#chips .chip"); time.sleep(1.2)
    cases["chip_at_peek_shows_list"] = pg.evaluate("document.querySelector('#sheet').getBoundingClientRect().top < innerHeight * 0.7")
    # radio shows what plays next (journey 16)
    pg.evaluate("__sa.startRadio('ear')"); time.sleep(1.5)
    cases["radio_shows_next_up"] = bool(pg.evaluate("/next\\s*(up|:)/i.test(document.body.innerText)"))
    card["gates"]["console_errors"] += [e for e in pg.errs if e not in card["gates"]["console_errors"]]
    pg.context.close()

    # shared link opens the whole app (owner rule) on the song
    pg = phone(b, 393, 852); boot(pg, f"#t={TID}")
    cases["share_link_opens_whole_app"] = pg.evaluate(f"(() => {{ const s = __sa.state; return s.sel === {json.dumps(TID)} && !s.q && !s.cc0 && !s.picksOnly && s.feels.size === 0 && __sa.result.hits.length === __sa.all.length; }})()")
    # colour has one source: player tint == the playing row's tint
    pg.evaluate("__sa.sheetTo('full'); __sa.setView('library')"); time.sleep(1)
    cases["one_colour_source"] = pg.evaluate(f"""(() => {{ const r = document.querySelector('.trk[data-id="{TID}"]'), p = document.querySelector('#player'); if (!r) return null;
      const c = (e) => getComputedStyle(e).getPropertyValue('--c').trim(); return c(r) === c(p); }})()""")
    # borrow keeps the map zoomed into the stems while Layers is on screen (journey 12, broken)
    pg.evaluate("__sa.setView('track')"); time.sleep(0.8)
    if pg.locator(".layers .lane").count():
        pg.evaluate("document.querySelector('#body').scrollTo({ top: document.querySelector('.layers').offsetTop - 8 })"); time.sleep(2)
        k0 = pg.evaluate("__sa.A.layerK")
        if pg.locator("[data-lmix='swap']").count(): pg.locator("[data-lmix='swap']").first.click(); time.sleep(2)
        cases["borrow_keeps_layers_zoom"] = k0 >= 1 and pg.evaluate("__sa.A.layerK") >= 1
    else: cases["borrow_keeps_layers_zoom"] = None
    pg.context.close()

    # fullscreen hint clears the rail at every width
    ok = []
    for w, h in RUBRIC["widths"]:
        pg = phone(b, w, h, fs_hint=True); boot(pg); time.sleep(0.8)
        ok.append(pg.evaluate("(() => { const f = document.querySelector('.fsh'), r = document.querySelector('.rail'); if (!f) return true; return f.getBoundingClientRect().bottom <= r.getBoundingClientRect().top - 8; })()"))
        pg.context.close()
    cases["fullscreen_hint_clears_rail"] = all(ok)

    # reduced motion: no entrance animations at all
    pg = phone(b, 393, 852, reduced=True); boot(pg); t = now(pg)
    pg.evaluate(f"__sa.select({json.dumps(TID)}); __sa.sheetTo('full'); __sa.setView('track')"); time.sleep(1.2)
    motion["reduced_motion_anims"] = sorted({a["n"] for a in pg.evaluate("__anim") if a["t"] >= t})
    pg.context.close()


def e2e(card):
    for name in ("steer", "swap", "layers"):
        p = subprocess.run([sys.executable, str(HERE / f"{name}_e2e.py"), URL, str(OUT)], capture_output=True, text=True, timeout=240)
        try: card["e2e"][name] = json.loads(p.stdout[p.stdout.index("{"):])
        except ValueError: card["e2e"][name] = {"errors": ["no json: " + (p.stderr or p.stdout)[-300:]]}
    runs = [card["e2e"]["steer"]]  # the steer timing checks sit near one frame of lag: majority of 3 runs
    for _ in range(2):
        p = subprocess.run([sys.executable, str(HERE / "steer_e2e.py"), URL, str(OUT)], capture_output=True, text=True, timeout=240)
        try: runs.append(json.loads(p.stdout[p.stdout.index("{"):]))
        except ValueError: pass
    def steer_cases(s): return {
        "steer_switches_song_mid_drag": s.get("mid_drag", {}).get("sel") not in (None, s.get("before", {}).get("sel")) and bool(s.get("mid_drag_slider_alive")),
        "steer_no_entrance_replay": not (set((s.get("flash") or {}).get("anims", {"?": 1})) - set(RUBRIC["meaningful_anims"])),
        "scrub_follows_finger": (s.get("scrub") or {}).get("max_lag", 1) < 0.03 and (s.get("scrub") or {}).get("seeks_during_drag", 9) <= 1,
        "hand_pick_ends_tune": bool(s.get("manual_pick_ends_tune"))}
    per = [steer_cases(s) for s in runs]
    for k in per[0]: card["cases"][k] = majority([x[k] for x in per])
    card["steer_scrub_lags"] = [(s.get("scrub") or {}).get("max_lag") for s in runs]
    card["gates"]["e2e_errors"] = {k: v.get("errors", []) for k, v in card["e2e"].items() if v.get("errors")}


def score(card):
    G, M, H, C, P = RUBRIC["gates"], card["motion"], card["haptics"], card["cases"], card["perf"]
    checks = {
        "owner_cases": [v for v in C.values() if v is not None],
        "motion": [M["title_glides"], not M["revisit_replays"], not M["layout_property_animations"], not M["reduced_motion_anims"], (M["drag_frame_p95_ms"] or 99) <= G["frame_p95_ms"]],
        "haptics": [H["one_pulse_per_tap"], H["commits_have_pulse"], (H["min_pulse_ms"] or 0) >= G["min_pulse_ms"], H["supersede_pairs"] == 0, H["hold_ring_seen"]],
        "craft": [not card["craft"]["small_targets"], not card["craft"]["low_contrast"], not card["craft"]["truncated"]],
        "perf": [P["ready_s_median"] <= G["ready_s"], P["longtasks_over_50ms"] <= G["longtasks"], P["js_css_kb"] <= G["js_css_kb"]],
    }
    if JOURNEY:
        st = json.loads(Path(JOURNEY).read_text()); st = st["stages"] if isinstance(st, dict) else st
        val = {"works": 1.0, "rough": 0.5, "broken": 0.0}
        card["journey"] = {s["n"]: s["verdict"] for s in st}
        checks["journey"] = [val.get(s["verdict"], 0) for s in st]
    card["scores"] = {k: round(100 * sum(map(float, v)) / len(v)) if v else None for k, v in checks.items()}
    card["failing_cases"] = [k for k, v in C.items() if v is False]


def majority(vals):
    """Combine N runs of one measurement: booleans by majority, numbers by median, string lists keep
    items seen in most runs. Timing-sensitive checks flip under host load; one run is not evidence."""
    v = [x for x in vals if x is not None]
    if not v: return None
    if all(isinstance(x, bool) for x in v): return sum(v) * 2 > len(v)
    if all(isinstance(x, (int, float)) for x in v): return statistics.median(v)
    if all(isinstance(x, list) and all(isinstance(i, str) for i in x) for x in v):
        return sorted(i for i in {i for x in v for i in x} if sum(i in x for x in v) * 2 > len(v))
    return v[0]


def main():
    card = {"url": URL, "rubric": RUBRIC["version"], "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "cases": {}, "motion": {}, "haptics": {}, "e2e": {}}
    runs = int(ARGS[ARGS.index("--runs") + 1]) if "--runs" in ARGS else 3
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        gates_and_craft(b, card); base = json.loads(json.dumps(card, default=str)); parts = []
        for _ in range(runs):
            c = json.loads(json.dumps(base)); interaction_suite(b, c); parts.append(c)
        b.close()
    for sec in ("cases", "motion", "haptics", "perf"):
        card[sec] = {k: majority([c[sec].get(k) for c in parts]) for k in parts[0][sec]}
    card["cases"]["idle_hint_fits"] = card.pop("idle_hint_fits")
    card["gates"]["console_errors"] = sorted({e for c in parts for e in c["gates"]["console_errors"]})
    card["runs"] = runs
    if "--skip-e2e" not in ARGS: e2e(card)
    card["gates"]["pass"] = card["gates"]["pass"] and not card["gates"]["console_errors"] and not card["gates"].get("e2e_errors")
    score(card)
    (OUT / "scorecard.json").write_text(json.dumps(card, indent=1, default=str))
    print(f"GATES {'PASS' if card['gates']['pass'] else 'FAIL'}  " + "  ".join(f"{k} {v}" for k, v in card["scores"].items()))
    print("failing cases:", ", ".join(card["failing_cases"]) or "none")
    sys.exit(0 if card["gates"]["pass"] else 1)


if __name__ == "__main__":
    main()
