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


CONTEXT_ALLOWANCE_MIB = 512


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
    from diffusers import LTXImageToVideoPipeline, LTXPipeline
    from diffusers.utils import export_to_video
    from transformers import T5EncoderModel, T5TokenizerFast
    import diffusers
    import transformers

    if not torch.cuda.is_available():
        raise RuntimeError("unavailable")
    free, total = torch.cuda.mem_get_info()
    # The bridge gates on nvidia-smi free memory before spawning this worker.
    # torch reports free memory after creating this process's own CUDA context
    # (measured on the 3080 Ti: 9309 MiB nvidia-smi -> 9053 MiB torch), so allow
    # for that context instead of rejecting a run the bridge already admitted.
    minimum = request.get("minimumFreeMiB", 9216) - CONTEXT_ALLOWANCE_MIB
    if free / 1024**2 < minimum:
        raise RuntimeError("gpu-busy")
    torch.cuda.reset_peak_memory_stats()
    torch.manual_seed(request["seed"])
    torch.backends.cudnn.benchmark = False
    started = time.monotonic()
    model = Path(request["modelDir"])
    reference = request.get("referencePath")
    image = None
    if reference:
        from PIL import Image
        image = Image.open(reference).convert("RGB").resize((request["width"], request["height"]))
    emit(0.02)
    # The single-file checkpoint has no T5 weights. Encode on CPU in bf16 with a
    # text-only pipeline, then free T5 before loading diffusion weights: T5-XXL
    # alone can otherwise exhaust a 12 GB GPU or the host's free RAM.
    tokenizer = T5TokenizerFast.from_pretrained(str(model / "base" / "tokenizer"), local_files_only=True)
    text_encoder = T5EncoderModel.from_pretrained(
        str(model / "base" / "text_encoder"), torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True, local_files_only=True,
    )
    text = LTXPipeline(scheduler=None, vae=None, text_encoder=text_encoder, tokenizer=tokenizer, transformer=None)
    with torch.no_grad():
        prompt_embeds, mask, _, _ = text.encode_prompt(
            prompt=request["prompt"], negative_prompt=None,
            do_classifier_free_guidance=False, device=torch.device("cpu"),
        )
    del text, text_encoder
    gc.collect()
    encoded = time.monotonic()
    emit(0.1)
    Pipeline = LTXImageToVideoPipeline if image is not None else LTXPipeline
    pipe = Pipeline.from_single_file(
        str(model / "ltxv-2b-0.9.6-distilled-04-25.safetensors"),
        # 0.9.6 uses the 0.9.5 VAE/scheduler layout; the pinned 0.9.0 base config
        # cannot load it (decoder.conv_in 512 vs 1024 channels).
        config=str(model / "config-0.9.5"), torch_dtype=torch.bfloat16,
        text_encoder=None, tokenizer=tokenizer, local_files_only=True,
    )
    pipe.enable_model_cpu_offload()
    pipe.vae.enable_tiling()
    # Precomputed CPU embeddings are not moved by the pipeline under offload.
    prompt_embeds = prompt_embeds.to("cuda", dtype=torch.bfloat16)
    mask = mask.to("cuda")
    loaded = time.monotonic()
    emit(0.15)
    inference = request["inference"]
    # diffusers 0.35 LTXPipeline always derives its own sigmas, so a custom
    # timestep list would raise; the distilled preset uses eight uniform steps.
    steps = int(inference.get("steps", 8))
    count = max(9, round((request["duration"] * request["fps"] - 1) / 8) * 8 + 1)

    def progress(pipeline, step, timestep, values):
        emit(0.15 + 0.7 * (step + 1) / steps)
        return values

    extra = {"image": image} if image is not None else {}
    frames = pipe(
        **extra, prompt_embeds=prompt_embeds, prompt_attention_mask=mask,
        width=request["width"], height=request["height"], num_frames=count,
        num_inference_steps=steps, guidance_scale=inference["guidanceScale"],
        decode_timestep=inference["decodeTimestep"],
        decode_noise_scale=inference["decodeNoiseScale"],
        generator=torch.Generator(device="cpu").manual_seed(request["seed"]),
        callback_on_step_end=progress, output_type="pil",
    ).frames[0]
    denoised = time.monotonic()
    emit(0.9)
    export_to_video(frames, request["output"], fps=request["fps"], macro_block_size=1)
    torch.cuda.synchronize()
    # Measurements stay on disk, not mixed with the progress protocol.
    metrics = {
        "schema": "fframestudio.generation-measurement/1",
        "latencySeconds": time.monotonic() - started,
        "phasesSeconds": {"promptEncodeCpu": encoded - started, "loadDiffusion": loaded - encoded,
                          "denoiseAndDecode": denoised - loaded, "encodeMp4": time.monotonic() - denoised},
        "mode": "i2v" if image is not None else "t2v",
        "width": request["width"], "height": request["height"],
        "torchFreeMiBAtStart": free / 1024**2,
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
        if "--probe" in sys.argv:
            import torch
            from diffusers import LTXPipeline
            print(json.dumps({"available": torch.cuda.is_available(), "runtime": "diffusers", "torch": torch.__version__}))
        else:
            main()
    except Exception:
        # Diffusion libraries can include environment data and paths in errors.
        # Never serialize tracebacks or raw exceptions into jobs/SSE/logs.
        print("Local generation failed; verify the offline worker installation and available VRAM.", file=sys.stderr)
        sys.exit(1)
