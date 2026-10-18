#!/usr/bin/env python3
"""Experimental offline LTX worker. Protocol: one JSON stdin, progress-only stdout.
No credentials, remote code or browser-selected model paths are accepted here.
"""
import gc
import json
import os
from pathlib import Path
import sys
import threading
import time


def emit(progress):
    print(json.dumps({"type": "progress", "progress": progress}), flush=True)


def main():
    request = json.load(sys.stdin)
    parent = request["parentPid"]

    def watch_parent():
        while True:
            if os.getppid() != parent:
                os._exit(1)
            time.sleep(1)

    threading.Thread(target=watch_parent, daemon=True).start()
    import torch
    from diffusers import LTXPipeline
    from diffusers.utils import export_to_video
    import diffusers
    import transformers

    if not torch.cuda.is_available():
        raise RuntimeError("unavailable")
    free, total = torch.cuda.mem_get_info()
    if free < 9 * 1024**3:
        raise RuntimeError("gpu-busy")
    torch.cuda.reset_peak_memory_stats()
    torch.manual_seed(request["seed"])
    torch.backends.cudnn.benchmark = False
    started = time.monotonic()
    model = Path(request["modelDir"])
    emit(0.02)
    pipe = LTXPipeline.from_single_file(
        str(model / "ltxv-2b-0.9.6-distilled-04-25.safetensors"),
        config=str(model / "base"), torch_dtype=torch.bfloat16,
        local_files_only=True,
    )
    # Encode on CPU: T5 alone can otherwise exhaust a 12 GB GPU. Release it
    # before bringing diffusion weights/activations onto the shared device.
    prompt_embeds, mask, _, _ = pipe.encode_prompt(
        prompt=request["prompt"], negative_prompt=None,
        do_classifier_free_guidance=False, device=torch.device("cpu"),
    )
    pipe.text_encoder = None
    gc.collect()
    pipe.enable_model_cpu_offload()
    pipe.vae.enable_tiling()
    emit(0.15)
    timesteps = [1000, 993, 987, 981, 975, 909, 725, 0.03]
    count = max(9, round((request["duration"] * request["fps"] - 1) / 8) * 8 + 1)

    def progress(pipeline, step, timestep, values):
        emit(0.15 + 0.7 * (step + 1) / len(timesteps))
        return values

    frames = pipe(
        prompt_embeds=prompt_embeds, prompt_attention_mask=mask,
        width=request["width"], height=request["height"], num_frames=count,
        timesteps=timesteps, guidance_scale=1.0, decode_timestep=0.05,
        decode_noise_scale=0.025,
        generator=torch.Generator(device="cpu").manual_seed(request["seed"]),
        callback_on_step_end=progress, output_type="pil",
    ).frames[0]
    emit(0.9)
    export_to_video(frames, request["output"], fps=request["fps"], macro_block_size=1)
    torch.cuda.synchronize()
    # Measurements stay on disk, not mixed with the progress protocol.
    metrics = {
        "schema": "fframestudio.generation-measurement/1",
        "latencySeconds": time.monotonic() - started,
        "peakAllocatedMiB": torch.cuda.max_memory_allocated() / 1024**2,
        "peakReservedMiB": torch.cuda.max_memory_reserved() / 1024**2,
        "gpu": torch.cuda.get_device_name(0), "gpuTotalMiB": total / 1024**2,
        "torch": torch.__version__, "cuda": torch.version.cuda,
        "diffusers": diffusers.__version__, "transformers": transformers.__version__,
        "frames": count, "fps": request["fps"], "seed": request["seed"],
    }
    Path(request["output"]).with_suffix(".metrics.json").write_text(json.dumps(metrics, indent=2))
    emit(0.95)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Diffusion libraries can include environment data and paths in errors.
        # Never serialize tracebacks or raw exceptions into jobs/SSE/logs.
        print("Local generation failed; verify the offline worker installation and available VRAM.", file=sys.stderr)
        sys.exit(1)
