import os, subprocess, sys, time, tempfile
H = os.path.dirname(os.path.abspath(__file__)); RT = os.path.join(H, "wl", "rt")
env = {**os.environ, "WAYLAND_DISPLAY": "wayland-1", "XDG_RUNTIME_DIR": RT, "WEB_WL": "1"}; env.pop("DISPLAY", None)
srv = subprocess.Popen([sys.executable, "-I", "-m", "http.server", "28791", "-b", "127.0.0.1", "-d", os.path.join(H, "mirror")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
for tag, extra in [("vk", {}), ("gl", {"WEB_NOVK": "1"})]:
    p = subprocess.Popen(["node", os.path.join(H, "web.mjs"), "http://127.0.0.1:28791/index.html", tempfile.mkdtemp()], env={**env, **extra}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in p.stdout:
        if "gpu" in line or "idle_start" in line or "rror" in line: print(tag, line.strip())
        if "idle_start" in line: time.sleep(2); subprocess.run(["grim", os.path.join(H, f"wl-web-{tag}.png")], env=env); p.terminate(); break
    p.wait(timeout=20)
srv.terminate()
