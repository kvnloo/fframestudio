"""Small synthetic Rust literals for GPU-free importer and browser journeys.

Not upstream films. All values are test data; no render is claimed.
"""
import json
import os
from pathlib import Path
import subprocess
import sys


def make(root):
    root = Path(root)
    sources = []
    for family in ("ff-tracking", "ff-unmute"):
        base = root / "source-fixtures" / family
        def write(rel, content):
            p = base / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
        write("Cargo.toml", '[workspace]\nmembers = ["hud", "flat", "lens"]\n')
        for name in ("flat", "lens"):
            write(f"{name}/Cargo.toml", f'[package]\nname = "{name}"\n[[bin]]\nname = "{name}"\n')
        if family == "ff-tracking":
            names = ["Paper", "Thermal", "Mono", "Phosphor", "Amber", "Navy", "Neon"]
            scenes = [f'''SceneDef {{
 kind: Kind::Typing, text: "Synthetic scene {i+1}", palette: Palette::{names[i%7]},
 cam: cam(0.1, -0.2, 0.0, 2.0, 2.5, 10.0, 0.0, 1.2),
 hero: (320.0, 540.0), size: 72.0,
}}''' for i in range(12)]
            palettes = '\n'.join(f'Palette::{n} => s(0x050506, 0x2b2c2e, 0x8a8c90, 0xd9dadc, 0xffffff),' for n in names)
            write("hud/src/lib.rs", 'pub const FPS: usize = 30;\npub const SCENES: usize = 12;\npub const SCENE_FRAMES: usize = 15;\npub const SCENE_LIST: [SceneDef; SCENES] = [\n' + ',\n'.join(scenes) + '\n];\n' + palettes)
        else:
            write("hud/src/lib.rs", 'pub const FPS: usize = 30;\nconst KEYS: [(f32,f32,f32,f32,f32,f32,f32,f32); 3] = [(0.0,600.0,3.0,0.1,0.2,0.0,0.0,1.0), (8.0,400.0,2.0,0.2,-0.2,0.1,10.0,1.2), (16.0,560.0,1.1,0.1,0.0,0.0,0.0,0.5)];\n')
            write("music/gen_hud.py", '# Synthetic fixture; no code is executed.\n')
            write("hud/src/generated.rs", '''pub const BPM: f32 = 120.0;
pub const LENGTH_FRAMES: usize = 480;
pub const SHOT_FRAMES: [usize; 4] = [0,120,240,480];
pub const KICKS: [f32; 3] = [4.0,4.5,5.0];
pub const CLAPS: [f32; 2] = [8.5,9.5];
pub const TOKENS: [f32; 3] = [2.0,2.4375,11.75];
pub const WAVE: [f32; 16] = [0.1,0.2,0.4,0.3,0.8,0.7,0.4,0.6,0.5,0.3,0.8,0.9,0.7,0.6,0.4,0.1];
''')
        sources.append(dict(id=family, title=family + " (synthetic source fixture)", kind="procedural-fframes", path=str(base), source_only=True))
    return sources


if __name__ == "__main__":
    root = Path(sys.argv[1])
    config = root / "procedural-sources.json"
    config.write_text(json.dumps(dict(library_root=str(root / "fframestudio/projects"), sources=make(root))))
    subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "tools/import_projects.py")], env=os.environ | {"FFS_SOURCES": str(config)}, check=True)
