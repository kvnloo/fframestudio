"""Fable 5.2's eight "magic" checks (FABLE-REPORT.md section 5), measured in the browser, one JSON object out.
reuse-checked: score.py interaction_suite -- it measures the frozen v1/v2 cases, not these; steer/swap/layers_e2e
  each own one journey. score.py runs this file as its fourth e2e and files the result under card["fable"].

usage: fable_probes.py <url> [outdir] [--only m1,m2,...] [--widths 360,393,412] [--video fixture.mp4]
  m7m5  a tap stays where you touched (camera < 2 px over 5 taps); the land pulse arrives with `playing`;
        a forced 403 keeps its toast
  m1    pointerdown -> `playing` of that song, 9 dot taps per width (Fable: <= 350 ms cold)
  m2    loupe under a held slide: >= 48 px above the finger, auditioned = nearest the crosshair 9/9
  m3    tap a feel's name on the map: it lights in place within 100 ms, the sheet doesn't move, ink stays >= 50%,
        >= 8 feel names drawn in every frame while the map dances; off-screen feels pin to the edge when zoomed in
  m4    a pan across a feel border ticks once; a 0 -> 100 meter steer ticks once per lead song passed
  m6    the map scales with the sheet frame by frame; the selected dot stays in the free region
  m8    a fixture video under the map: advances, restarts on a new song, >= 30% of the height at peek
"""
import json, statistics as st, subprocess, sys, tempfile, time
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1]; OUT = Path(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else None
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
ONLY = arg("--only", "m7m5,m1,m2,m3,m4,m6,m8").split(","); WIDTHS = [int(w) for w in arg("--widths", "360,393,412").split(",")]
HEIGHT = {360: 780, 393: 852, 412: 915}
INIT = """localStorage.setItem('sa-fs','no'); window.__hap=[]; window.__eq=[];
navigator.vibrate=(p)=>{__hap.push([performance.now(),p]);return true};
addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{if(document.querySelector('.trk .eq'))__eq.push(performance.now())}).observe(document.body,{subtree:true,childList:true}));"""
DOTS = """(n) => { const A = __sa.A, pick = []; for (const t of __sa.all) { if (!t.audio || t.provider === 'spotify' || !A.inView(t.id, 70)) continue;
  const p = A.screenOf(t.id); if (pick.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 40)) pick.push({ id: t.id, ...p }); if (pick.length === n) break; } return pick; }"""


def page(b, w):
    ctx = b.new_context(viewport={"width": w, "height": HEIGHT.get(w, 852)}, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); pg.errs = []; pg.on("pageerror", lambda e: pg.errs.append(str(e)[:160])); pg.add_init_script(INIT)
    pg.goto(URL); pg.wait_for_function("window.__sa && __sa.all?.length", timeout=60000); time.sleep(2.5)
    return ctx, pg, ctx.new_cdp_session(pg)


def touch(cdp, kind, pts=()): cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y} for x, y in pts]})


def m7m5(pg, cdp, w):
    pg.evaluate("(() => { window.__ev = []; for (const k of ['playing']) __sa.audio.addEventListener(k, () => __ev.push(performance.now())); })()")
    ids = pg.evaluate(DOTS, 5); cam0 = pg.evaluate("({...__sa.A.cam})"); t0 = pg.evaluate("performance.now()"); sels = []
    for d in ids: pg.touchscreen.tap(d["x"], d["y"]); sels.append(pg.evaluate("__sa.state.sel")); time.sleep(0.4)
    time.sleep(1.0); cams = [pg.evaluate("({...__sa.A.cam})")]
    dpx = max(max(abs(c["x"] - cam0["x"]), abs(c["y"] - cam0["y"])) * cam0["s"] for c in cams)
    hap = [h for h in pg.evaluate("__hap") if h[0] >= t0]; playing = [x for x in pg.evaluate("__ev") if x >= t0]
    eq_early = [x for x in pg.evaluate("__eq") if x >= t0 and (not playing or x < playing[0])]
    pg.route("**/*.mp3*", lambda r: r.fulfill(status=403, body="no")); pg.route("**/api/ccm*", lambda r: r.fulfill(status=403, body="no"))
    cur = pg.evaluate("__sa.state.sel"); other = [d for d in pg.evaluate(DOTS, 8) if d["id"] != cur][0]
    pg.touchscreen.tap(other["x"], other["y"]); time.sleep(1.7)
    toast = pg.evaluate("[document.querySelector('#toast')?.textContent, !!document.querySelector('#toast')?.classList.contains('on')]")
    pg.unroute("**/*.mp3*"); pg.unroute("**/api/ccm*")
    return {"cam_move_px": round(dpx, 2), "distinct_sel": len(set(sels)), "taps": len(ids), "playing": len(playing),
            "land_within_40ms": sum(any(abs(h[0] - p) <= 40 for h in hap) for p in playing), "eq_before_playing": len(eq_early),
            "error_toast_up_1700ms": toast}


def m1(pg, cdp, w):
    pg.evaluate("window.__pl=[]; __sa.audio.addEventListener('playing',()=>__pl.push([performance.now(),__sa.audio.currentSrc]))")
    lat, miss = [], 0
    for d in pg.evaluate(DOTS, 12)[:9]:
        t0 = pg.evaluate("performance.now()"); touch(cdp, "touchStart", [(d["x"], d["y"])]); time.sleep(0.1); touch(cdp, "touchEnd"); time.sleep(2.2)
        src = pg.evaluate("__sa.audio.currentSrc"); pl = [t for t, s in pg.evaluate("__pl") if t > t0 and s == src]
        if pl: lat.append(round(pl[0] - t0))
        else: miss += 1
    return {"down_to_playing_ms": lat, "median": st.median(lat) if lat else None, "no_sound": miss}


def m2(pg, cdp, w):
    d = pg.evaluate("""(()=>{const A=__sa.A,ps=[];for(const t of __sa.all){if(!t.audio||!A.inView(t.id,70))continue;ps.push({id:t.id,...A.screenOf(t.id)})}
      let best=null,bn=-1;for(const a of ps){let n=0;for(const q of ps)if(Math.hypot(q.x-a.x,q.y-a.y)<14)n++;if(n>bn){bn=n;best=a}}return {...best,crowd:bn}})()""")
    x, y = d["x"], d["y"]; touch(cdp, "touchStart", [(x, y)]); time.sleep(0.75); pg.evaluate("__hap.length=0"); steps = []
    for i in range(1, 10):
        x2, y2 = x + 6 * i, y + 2 * (i % 3); touch(cdp, "touchMove", [(x2, y2)]); time.sleep(0.16)
        s = pg.evaluate("""(()=>{const L=__sa.A.loupe;if(!L)return null;let best=null,bd=1e9;for(const n of __sa.A.graph.leaves){if((n.al??1)<=0.5)continue;const q=Math.hypot(n.x-L.cross.x,n.y-L.cross.y);if(q<bd){bd=q;best=n}}
          return {ly:L.y,m:L.m,id:L.id,nearest:best?.id}})()""")
        if s: s["above"] = y2 - s["ly"]
        steps.append(s)
        if i == 5 and OUT: pg.screenshot(path=str(OUT / f"fable-loupe-{w}.png"))
    hap = pg.evaluate("__hap"); touch(cdp, "touchEnd"); time.sleep(0.6); ok = [s for s in steps if s]
    gaps = [hap[i + 1][0] - hap[i][0] for i in range(len(hap) - 1)]
    return {"crowd_14px": d["crowd"], "loupe_steps": len(ok), "magnify": round(ok[0]["m"], 2) if ok else None, "min_above_px": round(min(s["above"] for s in ok), 1) if ok else None,
            "audition_is_nearest": f"{sum(s['id'] == s['nearest'] for s in ok)}/{len(ok)}", "haptic_min_gap_ms": round(min(gaps)) if gaps else None,
            "kept_is_last": pg.evaluate("__sa.state.sel") == (ok[-1]["id"] if ok else None)}


INK = "(()=>{const c=document.querySelector('#atlas'),x=document.createElement('canvas');x.width=96;x.height=96;const g=x.getContext('2d');g.drawImage(c,0,0,96,96);const d=g.getImageData(0,0,96,96).data;let s=0;for(let i=0;i<d.length;i+=4)s+=d[i]+d[i+1]+d[i+2];return s})()"


def m3(pg, cdp, w):
    tags = pg.evaluate("__sa.A.tags")
    if not tags: return {"error": "no feel names drawn"}
    g = next((t for t in tags if 60 < t["y"] < 0.6 * HEIGHT.get(w, 852) and 30 < t["x"] < w - 30), tags[0])
    ink0 = pg.evaluate(INK); top0 = pg.evaluate("document.querySelector('#sheet').getBoundingClientRect().top")
    t0 = pg.evaluate("performance.now()"); pg.touchscreen.tap(g["x"], g["y"])
    pg.wait_for_function("document.querySelector('#pt b')?.textContent.match(/^[\\d,]+ /)", timeout=2000); dt = pg.evaluate("performance.now()") - t0
    time.sleep(0.8); line = pg.evaluate("document.querySelector('#pt').innerText.replace(/\\n/g,' · ')")
    top1 = pg.evaluate("document.querySelector('#sheet').getBoundingClientRect().top"); ink1 = pg.evaluate(INK)
    want = pg.evaluate("(f)=>__sa.A.graph.leaves.filter(n=>n.feel===f).length", g["feel"])
    # dance: play a song with motion on and sample the drawn names per frame
    pg.evaluate("(()=>{const t=__sa.all.find(t=>t.audio&&!/^https?:/.test(t.audio))||__sa.all.find(t=>t.audio);__sa.select(t.id,{play:true})})()"); time.sleep(2.5)
    per = pg.evaluate("new Promise(r=>{const o=[];const f=()=>{o.push([__sa.A.tags.length,+__sa.A.labels.toFixed(2)]);o.length<90?requestAnimationFrame(f):r(o)};requestAnimationFrame(f)})")
    pg.evaluate("(()=>{const L=__sa.A.graph.leaves[0];__sa.A.flyCam({x:L.x,y:L.y,s:3},1)})()"); time.sleep(1.0)
    edge = [t for t in pg.evaluate("__sa.A.tags") if t["x"] < 50 or t["x"] > w - 50]
    return {"tapped": g["feel"], "line": line, "count_ok": str(want) in line.replace(",", ""), "line_ms": round(dt), "sheet_moved_px": round(abs(top1 - top0), 1),
            "ink_kept": round(ink1 / ink0, 2), "names_min_per_frame": min(n for n, _ in per), "dancing": max(1 - k for _, k in per) > 0.3, "compass_tags_zoomed": len(edge)}


def m4(pg, cdp, w):
    info = pg.evaluate("""(()=>{const L=[...__sa.A.graph.leaves].sort((a,b)=>a.a-b.a);for(let i=1;i<L.length;i++)if(L[i].feel!==L[i-1].feel){const a=L[i-1],b=L[i];__sa.A.flyCam({x:a.x,y:a.y,s:0.6},1);return {dx:(b.x-a.x)*0.6,dy:(b.y-a.y)*0.6,from:a.feel,to:b.feel}}})()""")
    time.sleep(0.8); x0, y0 = w / 2, 250; pg.evaluate("__hap.length=0"); touch(cdp, "touchStart", [(x0, y0)])
    for i in range(1, 31): k = 1.5 * i / 30; touch(cdp, "touchMove", [(x0 - info["dx"] * k, y0 - info["dy"] * k)]); time.sleep(0.03)
    time.sleep(0.2); touch(cdp, "touchEnd"); time.sleep(0.6); border = len(pg.evaluate("__hap"))
    pg.evaluate("(()=>{const t=__sa.all.find(t=>t.p&&t.f);__sa.select(t.id);__sa.setView('track');__sa.sheetTo('full')})()")
    try: pg.wait_for_selector("input.tune", state="attached", timeout=15000)
    except Exception: return {"border": f"{info['from']}->{info['to']}", "border_haptics": border, "steer": "no meters"}
    steer = pg.evaluate("""(async()=>{const inp=document.querySelector('input.tune');inp.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));__hap.length=0;const ms=[];
      for(let v=0;v<=100;v+=2){inp.value=v;const t=performance.now();inp.dispatchEvent(new Event('input',{bubbles:true}));ms.push(performance.now()-t);await new Promise(r=>setTimeout(r,40))}
      const h=__hap.map(x=>x[0]);dispatchEvent(new PointerEvent('pointerup'));ms.sort((a,b)=>a-b);return {haptics:h.length,min_gap:h.length>1?Math.min(...h.slice(1).map((x,i)=>x-h[i])):null,input_ms_median:+ms[25].toFixed(1),input_ms_max:+ms[50].toFixed(1)}})()""")
    return {"border": f"{info['from']}->{info['to']}", "border_haptics": border, "steer": steer}


def m6(pg, cdp, w):
    pg.evaluate("__sa.sheetTo('peek')"); time.sleep(1)
    tid = pg.evaluate("(()=>{const A=__sa.A;const t=__sa.all.find(t=>t.audio&&A.inView(t.id,90));__sa.select(t.id);return t.id})()"); time.sleep(1.5)
    pg.evaluate("""(id)=>{window.__fr=[];const mc=new MessageChannel();mc.port1.onmessage=()=>{const A=__sa.A,R=A.region;__fr.push({s:A.cam.s,fit:Math.min(R.w,R.h),y:A.screenOf(id).y,top:R.y,bot:R.y+R.h});if(__fr.length<300)requestAnimationFrame(f)};
      const f=()=>mc.port2.postMessage(0);requestAnimationFrame(f)}""", tid)
    g = pg.evaluate("(()=>{const r=document.querySelector('#sheet .grab').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
    touch(cdp, "touchStart", [(g["x"], g["y"])])
    for i in range(1, 61): touch(cdp, "touchMove", [(g["x"], g["y"] - 5 * i)]); time.sleep(0.016)
    touch(cdp, "touchEnd"); time.sleep(0.9); fr = pg.evaluate("__fr"); r0 = fr[0]["s"] / fr[0]["fit"]
    ch = [c for a, c in zip(fr, fr[1:]) if abs(c["fit"] - a["fit"]) > 0.5]
    return {"fit_px": [round(min(f["fit"] for f in fr)), round(max(f["fit"] for f in fr))], "scale_follows": f"{sum(abs(c['s'] / c['fit'] / r0 - 1) < 0.03 for c in ch)}/{len(ch)}",
            "dot_outside_frames": sum(not (f["top"] <= f["y"] <= f["bot"]) for f in fr)}


def m8(pg, cdp, w):
    mp4 = arg("--video", None)
    if not mp4:
        mp4 = str(Path(tempfile.gettempdir()) / "sa-fixture.mp4")
        if not Path(mp4).exists(): subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=20", "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4], check=True)
    ids = pg.evaluate("__sa.all.filter(t=>t.audio&&!/^https?:/.test(t.audio)).slice(0,2).map(t=>t.id)") or pg.evaluate("__sa.all.filter(t=>t.audio).slice(0,2).map(t=>t.id)")
    pg.evaluate("(id)=>{__sa.select(id,{play:true});__sa.setView('track');__sa.sheetTo('half')}", ids[0]); time.sleep(1.5)
    pg.evaluate("__sa.sheetTo('full')"); time.sleep(0.8); pg.evaluate("document.querySelector('[data-act=video]').scrollIntoView({block:'center'})"); time.sleep(0.5)
    box = pg.evaluate("(()=>{const r=document.querySelector('[data-act=video]').getBoundingClientRect(),c=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {x:r.x+r.width/2,y:r.y+r.height/2,top:!!c?.closest('[data-act=video]')}})()")
    with pg.expect_file_chooser() as fc: pg.touchscreen.tap(box["x"], box["y"])  # a real tap: it must be on top and hittable
    fc.value.set_files(mp4); time.sleep(1.5)
    t1 = pg.evaluate("document.querySelector('#sv')?.currentTime ?? -1"); time.sleep(1.0); t2 = pg.evaluate("document.querySelector('#sv')?.currentTime ?? -1")
    pg.evaluate("()=>{window.__vr=[];const v=document.querySelector('#sv');__sa.audio.addEventListener('playing',()=>__vr.push(['a',performance.now()]));v.addEventListener('seeked',()=>__vr.push(['v',performance.now(),v.currentTime]))}")
    pg.evaluate("(id)=>__sa.select(id,{play:true})", ids[1]); time.sleep(2)
    vr = pg.evaluate("__vr"); a = [x[1] for x in vr if x[0] == "a"]; v = [x for x in vr if x[0] == "v"]
    pg.evaluate("__sa.sheetTo('peek')"); time.sleep(1)
    frac = pg.evaluate("(()=>{const r=document.querySelector('#sv').getBoundingClientRect();return r.height/innerHeight})()")
    if OUT: pg.screenshot(path=str(OUT / f"fable-video-{w}.png"))
    return {"button_on_top": box["top"], "video_advances_s": round(t2 - t1, 2), "restart_after_playing_ms": round(v[0][1] - a[0]) if a and v else None, "peek_height_frac": round(frac, 2)}


def main():
    res = {}
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        for name in ONLY:
            fn = globals()[name]; res[name] = {}
            for w in WIDTHS:
                ctx, pg, cdp = page(b, w)
                try: res[name][w] = fn(pg, cdp, w)
                except Exception as e: res[name][w] = {"error": str(e)[:300]}
                if pg.errs: res[name][w]["page_errors"] = pg.errs[:3]
                ctx.close()
        b.close()
    out = json.dumps(res); print(out)
    if OUT: OUT.mkdir(parents=True, exist_ok=True); (OUT / "fable.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
