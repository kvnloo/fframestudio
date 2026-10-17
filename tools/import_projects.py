#!/usr/bin/env python3
"""Import existing video projects into the fframestudio library.

Reads ~/.config/fframestudio/sources.json (your projects; falls back to projects/sources.example.json) and writes, per project, into the library root
(~/fframestudio/projects/<id>/, the folder the bridge serves):
  project.json            fframestudio.project/0 (see docs/project-format.md)
  media/poster.jpg        a frame at 30 %
  media/strip.jpg         eight frames across the film
  media/proxy.mp4         1280x720 H.264 for the browser (masters are often FFV1 .mkv)
  media/shots/<n>.jpg     one thumbnail per shot
and library.json listing every project. Sources are only read, never modified.

Timeline per kind: studio-spec -> the studio's buildSpec(); fframes -> logs/timeline.txt when
present; html-film -> the SHOTS table in film.js; otherwise cut detection on the render.

Usage: python3 tools/import_projects.py [ids...] [--force]
"""
import datetime as dt, json, os, pathlib, re, subprocess, sys
from studio_music import resolve_music

HERE = pathlib.Path(__file__).resolve().parent.parent
SRC_FILE = pathlib.Path(os.environ.get("FFS_SOURCES", os.path.expanduser("~/.config/fframestudio/sources.json")))
if not SRC_FILE.exists(): SRC_FILE = HERE / "projects/sources.example.json"
SRC = json.loads(SRC_FILE.read_text())
for _s in SRC["sources"]: _s["path"] = os.path.expanduser(_s["path"])
LIB = pathlib.Path(os.path.expanduser(SRC["library_root"])); LIB.mkdir(parents=True, exist_ok=True)
args = [a for a in sys.argv[1:] if not a.startswith("--")]; FORCE = "--force" in sys.argv
now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

def sh(*cmd, **kw): return subprocess.run(cmd, capture_output=True, text=True, **kw)
def probe(f):
    j = json.loads(sh("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", str(f)).stdout or "{}")
    st = (j.get("streams") or [{}])[0]; n, d = (st.get("r_frame_rate") or "0/1").split("/")
    return {"width": st.get("width"), "height": st.get("height"), "fps": round(int(n) / max(1, int(d)), 3), "duration_s": round(float(j.get("format", {}).get("duration", 0)), 3)}
def frame(src, t, out, w=640):
    out.parent.mkdir(parents=True, exist_ok=True)
    sh("ffmpeg", "-loglevel", "error", "-y", "-ss", f"{max(0, t):.3f}", "-i", str(src), "-frames:v", "1", "-vf", f"scale={w}:-2", "-q:v", "4", str(out))
    return out.exists()
def cuts(src, dur, thr=0.32):
    r = sh("ffmpeg", "-i", str(src), "-vf", f"scale=320:-2,select='gt(scene,{thr})',showinfo", "-an", "-f", "null", "-")
    ts = [float(m) for m in re.findall(r"pts_time:([\d.]+)", r.stderr)]
    ts = [t for i, t in enumerate(ts) if t > 0.25 and (i == 0 or t - ts[i - 1] > 0.25)]
    if len(ts) < 3 and dur > 15 and thr > 0.15: return cuts(src, dur, thr - 0.12)
    edges = [0.0] + ts + [dur]
    return [{"id": f"s{i + 1:02d}", "name": f"Shot {i + 1}", "t0": round(a, 3), "t1": round(b, 3), "origin": f"cut detection (scene>{thr:.2f})"} for i, (a, b) in enumerate(zip(edges, edges[1:])) if b - a > 0.05]

def media_for(pdir, render, shots, info):
    m = pdir / "media"; m.mkdir(parents=True, exist_ok=True)
    proxy = m / "proxy.mp4"
    if FORCE or not proxy.exists():
        sh("ffmpeg", "-loglevel", "error", "-y", "-i", str(render), "-vf", "scale=1280:-2,fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(proxy))
    frame(render, info["duration_s"] * 0.3, m / "poster.jpg", 960)
    tiles = []
    for k in range(8):
        f = m / f"_s{k}.jpg"; frame(render, info["duration_s"] * (k + 0.5) / 8, f, 320); tiles.append(f)
    sh("ffmpeg", "-loglevel", "error", "-y", *sum([["-i", str(t)] for t in tiles], []), "-filter_complex", "".join(f"[{i}]" for i in range(8)) + "hstack=8", str(m / "strip.jpg"))
    for t in tiles: t.unlink(missing_ok=True)
    for i, s in enumerate(shots):
        f = m / "shots" / f"{i + 1:03d}.jpg"
        if FORCE or not f.exists(): frame(proxy if proxy.exists() else render, (s["t0"] + s["t1"]) / 2, f, 320)
        s["thumb"] = f"media/shots/{i + 1:03d}.jpg"
    return {"proxy": "media/proxy.mp4" if proxy.exists() else None, "poster": "media/poster.jpg", "strip": "media/strip.jpg"}

def from_timeline(txt, fps):
    shots = []
    for m in re.finditer(r"#(\d+)\s+(\S+)\s+frames\s+(\d+)\.\.(\d+)", txt):
        shots.append({"id": f"s{int(m.group(1)) + 1:02d}", "name": re.sub(r"(?<!^)([A-Z])", r" \1", m.group(2)), "t0": round(int(m.group(3)) / fps, 3), "t1": round(int(m.group(4)) / fps, 3), "text": {"title": re.sub(r"(?<!^)([A-Z])", r" \1", m.group(2))}, "origin": "timeline.txt"})
    return shots

def html_film_shots(js):
    out = []
    for m in re.finditer(r"\{\s*at:\s*([\d.]+),(.*?)\}\s*[,\]]", js, re.S):
        body = m.group(2)
        head = re.findall(r"'([^']*)'", (re.search(r"head:\s*\[(.*?)\]", body) or [None, ""])[1] if re.search(r"head:\s*\[(.*?)\]", body) else "")
        tag = re.search(r"tag:\s*'([^']*)'", body); bod = re.findall(r"'([^']*)'", (re.search(r"body:\s*\[(.*?)\]", body).group(1) if re.search(r"body:\s*\[(.*?)\]", body) else ""))
        out.append({"at": float(m.group(1)), "name": (tag.group(1) if tag else "") or " ".join(head), "text": {"head": head, "body": bod}})
    return out

def spec_from_studio(src):
    code = f"""
import asyncio, json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/chromium")
        pg = await b.new_page(); await pg.goto("file://{src}"); await pg.wait_for_function("window.buildSpec && (() => {{ try {{ return buildSpec().shots.length > 0; }} catch {{ return false; }} }})()", timeout=60000)
        print(json.dumps(await pg.evaluate("buildSpec()"))); await b.close()
asyncio.run(main())"""
    r = sh("uv", "run", "--quiet", "--with", "playwright", "python", "-c", code, timeout=180)
    if r.returncode: raise RuntimeError(r.stderr[-400:])
    return json.loads(r.stdout.strip().splitlines()[-1])

TEXT_KEYS = ("a", "b", "kicker", "title", "num", "unit", "src", "tag", "ask", "cta", "tagline", "sub", "time", "n", "name", "vo")
def import_one(s):
    base = pathlib.Path(s["path"]); pdir = LIB / s["id"]; pdir.mkdir(parents=True, exist_ok=True)
    P = {"schema": "fframestudio.project/0", "id": s["id"], "title": s["title"], "kind": s["kind"], "tags": s.get("tags", []),
         "source": {k: s[k] for k in s if k not in ("id", "title", "kind", "tags")}, "imported": now, "renders": [], "shots": [], "notes": []}
    old = pdir / "project.json"
    if old.exists():
        prev = json.loads(old.read_text()); P["edits"] = prev.get("edits", {}); P["notes"] = prev.get("notes", [])
    k = s["kind"]
    if k == "studio-spec":
        spec = spec_from_studio(base / s["studio"])
        P.update(canvas={"width": spec["size"][0], "height": spec["size"][1], "fps": spec["fps"]}, duration_s=spec["runtime_s"], music=resolve_music(base, spec["music"], pdir, s["studio"]), direction=spec["direction"], narrative=spec["narrative"], honesty=spec["honesty"])
        sb = base / "storyboard"
        for i, x in enumerate(spec["shots"]):
            media = [str(sb / x[f]) for f in ("move_file", "plate_file", "clip_file") if x.get(f)] + ([str(sb / "frames" / f"{x['screen']}.webp")] if x.get("screen") else [])
            P["shots"].append({"id": x["id"], "name": x["label"], "t0": x["t0"], "t1": x["t1"], "bars": x["bars"], "type": x["type"], "chapter": x.get("chapter"), "motion": x["motion"], "transition_in": x["transition_in"],
                               "text": {kk: x[kk] for kk in TEXT_KEYS if x.get(kk) not in (None, "")}, "media": media, "origin": "buildSpec"})
            thumb = next((m for m in media if m.endswith((".webp", ".jpg", ".png"))), None)
            if not thumb and media: thumb = media[0]
            if thumb:
                f = pdir / "media" / "shots" / f"{i + 1:03d}.jpg"; frame(thumb, 2.5 if thumb.endswith(".mp4") else 0, f, 320); P["shots"][-1]["thumb"] = f"media/shots/{i + 1:03d}.jpg"
        poster = pdir / "media" / "poster.jpg"; first = next((sh_["media"][0] for sh_ in P["shots"] if sh_["type"] == "P" and sh_.get("media")), None)
        if first: frame(first, 2.5 if first.endswith('.mp4') else 0, poster, 960)
        P["media"] = {"poster": "media/poster.jpg" if poster.exists() else None, "app": str(base / s["studio"])}
        P["edit_in"] = {"app": "studio page", "url": s.get("live"), "local": str(base / s["studio"])}
    elif k in ("fframes", "html-film"):
        render = pathlib.Path(s["render"]) if s.get("render", "").startswith("/") else base / s.get("render", "")
        if k == "html-film":
            js = (base / s["film"]).read_text(); dur = float((re.search(r"DURATION\s*=\s*([\d.]+)", js) or [0, 30])[1])
            P.update(canvas={"width": 1920, "height": 1080, "fps": 60}, duration_s=dur)
            beats = html_film_shots(js); edges = [b["at"] for b in beats]
            P["shots"] = ([{"id": "s00", "name": "Opening", "t0": 0, "t1": edges[0] if edges else dur, "origin": "film.js"}] if edges and edges[0] > 0 else []) + [
                {"id": f"s{i + 1:02d}", "name": b["name"], "t0": b["at"], "t1": (edges[i + 1] if i + 1 < len(edges) else dur), "text": b["text"], "origin": "film.js SHOTS"} for i, b in enumerate(beats)]
            P["notes"].append("Timing of shots outside the SHOTS table (opening, ending) is approximate.")
            foot = sorted((base / "footage").glob("*.mp4")) if (base / "footage").exists() else []
            pst = pdir / "media" / "poster.jpg"
            P["media"] = {"poster": "media/poster.jpg" if foot and frame(foot[0], 2, pst, 960) else None}
            if foot: P["notes"].append(f"Poster is a frame of the source footage ({foot[0].name}), not the finished film.")
            P["edit_in"] = {"app": "browser (deterministic page)", "local": str(base / "index.html")}
            if not (s.get("render") and render.exists()): P["notes"].append("No rendered master found; render with " + s.get("build", "render.sh"))
        if s.get("render") and render.exists():
            info = probe(render); P.update(canvas={"width": info["width"], "height": info["height"], "fps": info["fps"]}, duration_s=info["duration_s"])
            P["renders"].append({"label": "master", "file": str(render), **info})
            tl = base / s["timeline"] if s.get("timeline") else None
            if k == "fframes": P["shots"] = from_timeline(tl.read_text(), info["fps"]) if tl and tl.exists() else cuts(render, info["duration_s"])
            P["media"] = media_for(pdir, render, P["shots"], info)
        for key in ("brief", "readme", "review"):
            if s.get(key) and (base / s[key]).exists(): P.setdefault("docs", {})[key] = str((base / s[key]).resolve())
        P.setdefault("edit_in", {"app": "fframes (Rust)", "local": str(base), "build": s.get("build")})
    elif k == "fframes-clips":
        P["clips"] = []
        for i, rel in enumerate(s["renders"]):
            f = base / rel
            if not f.exists(): continue
            info = probe(f); cid = f.stem.replace("-master", "")
            P["renders"].append({"label": cid, "file": str(f), **info})
            sub = {"id": cid, "name": cid.title(), "t0": 0, "t1": info["duration_s"], "origin": "clip"}
            frame(f, info["duration_s"] * 0.4, pdir / "media" / "shots" / f"{i + 1:03d}.jpg", 320); sub["thumb"] = f"media/shots/{i + 1:03d}.jpg"
            P["shots"].append(sub)
        if P["renders"]:
            r0 = pathlib.Path(P["renders"][0]["file"]); info = probe(r0)
            P.update(canvas={"width": info["width"], "height": info["height"], "fps": info["fps"]}, duration_s=round(sum(r["duration_s"] for r in P["renders"]), 3))
            m = pdir / "media"; frame(r0, info["duration_s"] * 0.4, m / "poster.jpg", 960)
            P["media"] = {"poster": "media/poster.jpg", "proxy": None}
        P["edit_in"] = {"app": "fframes (Rust)", "local": str(base), "build": s.get("build")}
    elif k == "capture-manifest":
        man = base / s["manifest"]
        if not man.exists(): return {"id": s["id"], "skipped": "manifest not written yet"}
        clips = json.loads(man.read_text()).get("clips", [])
        t = 0.0
        for i, c in enumerate(clips):
            f = pathlib.Path(c.get("proxy") or c["file"]); f = f if f.is_absolute() else base / "capture" / f
            d = float(c.get("duration_s") or probe(f)["duration_s"])
            P["shots"].append({"id": c["id"], "name": c.get("title", c["id"]), "t0": round(t, 3), "t1": round(t + d, 3), "media": [str(f)], "text": {"feature": c.get("feature", "")}, "origin": "capture manifest"})
            if frame(f, d / 2, pdir / "media" / "shots" / f"{i + 1:03d}.jpg", 320): P["shots"][-1]["thumb"] = f"media/shots/{i + 1:03d}.jpg"
            t += d
        P.update(canvas={"width": 3840, "height": 2160, "fps": 60}, duration_s=round(t, 3), media={"poster": P["shots"][0].get("thumb") if P["shots"] else None})
        P["edit_in"] = {"app": "fframestudio", "local": str(base)}
    (pdir / "project.json").write_text(json.dumps(P, indent=1))
    return {"id": s["id"], "title": s["title"], "kind": k, "tags": P["tags"], "duration_s": P.get("duration_s"), "shots": len(P["shots"]), "renders": len(P["renders"]),
            "poster": f"{s['id']}/{P['media']['poster']}" if P.get("media", {}).get("poster") else None, "updated": now}

lib_file = LIB / "library.json"
lib = {p["id"]: p for p in (json.loads(lib_file.read_text())["projects"] if lib_file.exists() else [])}
for s in SRC["sources"]:
    if args and s["id"] not in args: continue
    try:
        r = import_one(s)
        if r.get("skipped"): print(f"skip {s['id']}: {r['skipped']}"); continue
        lib[s["id"]] = r; print(f"ok   {s['id']}: {r['shots']} shots, {r['duration_s']} s, {r['renders']} renders")
    except Exception as e:
        print(f"FAIL {s['id']}: {e}")
lib_file.write_text(json.dumps({"schema": "fframestudio.library/0", "updated": now, "projects": sorted(lib.values(), key=lambda p: p["id"])}, indent=1))
print("library:", lib_file)
