import os, subprocess, sys, time, tempfile
H = os.path.dirname(os.path.abspath(__file__)); RT = os.path.join(H, "wl", "rt")
env = {**os.environ, "WAYLAND_DISPLAY": "wayland-1", "XDG_RUNTIME_DIR": RT, "WEB_WL": "1"}; env.pop("DISPLAY", None)
srv = subprocess.Popen([sys.executable, "-I", "-m", "http.server", "28791", "-b", "127.0.0.1", "-d", os.path.join(H, "mirror")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
for name, cmd, extra in [("gpui", [os.environ.get("SA_BIN", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "target", "release", "sound-atlas-gpui")), os.path.join(H, "mirror", "catalog.json")], {"SA_SELFTEST": "lightless", "SA_BASE": "http://127.0.0.1:28791/"}),
                         ("web", ["node", os.path.join(H, "web.mjs"), "http://127.0.0.1:28791/index.html", tempfile.mkdtemp()], {})]:
    p = subprocess.Popen(cmd, env={**env, **extra}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(5 if name == "gpui" else 6)
    subprocess.run(["grim", os.path.join(H, f"wl-{name}.png")], env=env)
    p.terminate(); p.wait(timeout=20)
srv.terminate()
