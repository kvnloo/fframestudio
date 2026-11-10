"""Hermes plugin `factory`: the fframestudio content factory as `/factory` (see core.py)."""

from . import core


def register(ctx) -> None:
    ctx.register_command("factory", core.command,
                         description="Content factory: ComfyUI status, renders, reference scenes")
