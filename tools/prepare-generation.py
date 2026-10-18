#!/usr/bin/env python3
"""Download pinned LTX runtime assets to a caller-selected external artifacts dir.
Run using the optional worker venv Python after installing requirements-generation.txt.
The download is explicit; bridge generation itself is offline-only.
"""
import argparse
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REVISION = "8984fa25007f376c1a299016d0957a37a2f797bb"
CHECKPOINT = "ltxv-2b-0.9.6-distilled-04-25.safetensors"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", type=Path, required=True)
    args = parser.parse_args()
    target = args.dir.expanduser().resolve()
    if target == REPO or target.is_relative_to(REPO):
        parser.error("Weights must be outside the repository")
    from huggingface_hub import snapshot_download, hf_hub_download
    target.mkdir(parents=True, exist_ok=True)
    cache = str(target / "cache")
    snapshot_download(
        "Lightricks/LTX-Video", revision=REVISION,
        allow_patterns=["model_index.json", "scheduler/*", "tokenizer/*", "text_encoder/*", "transformer/config.json", "vae/config.json"],
        local_dir=str(target / "base"), cache_dir=cache,
    )
    for name in [CHECKPOINT, "LTX-Video-Open-Weights-License-0.X.txt"]:
        hf_hub_download("Lightricks/LTX-Video", name, revision=REVISION, local_dir=str(target), cache_dir=cache)
    (target / "model.json").write_text(json.dumps({
        "model": "Lightricks/LTX-Video", "revision": REVISION,
        "checkpoint": CHECKPOINT, "licence": "LTXV Open Weights License 0.X",
    }, indent=2))
    print("Pinned LTX weights/config downloaded outside the repository. Review licence before generation.")


if __name__ == "__main__":
    main()
