"""Task dispatcher and readiness probe for all 28 Brain Radiology Foundation Models."""
from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path

from .fmri_decode import run_decode_fmri
from .morph_synth import run_synth_register
from .neuro_vlm import run_report_vqa, run_zeroshot_neuro
from .segment3d import run_segment_brain
from .vol_embed import run_brain_health, run_embed_volumes


def _has(pkg: str) -> bool:
    return importlib.util.find_spec(pkg) is not None


def runner_status(model: dict, settings) -> dict:
    """Report whether `model` can execute on this server right now."""
    if settings.mock:
        return {"ready": True, "reason": "Mock 3D phantom mode"}

    mid = model["id"]
    runner = model.get("runner")

    if not _has("torch"):
        return {"ready": False, "reason": "Install PyTorch (`pip install torch`)"}
    if not _has("nibabel"):
        return {"ready": False, "reason": "Install NiBabel (`pip install nibabel`)"}

    if mid == "biomedclip" and not _has("open_clip"):
        return {"ready": False, "reason": "Install open_clip_torch (`pip install open_clip_torch`)"}
    if mid == "synthseg" and not (settings.synthseg_repo and Path(settings.synthseg_repo).exists()) and not shutil.which("mri_synthseg"):
        return {"ready": False, "reason": "Set `synthseg_repo` in config.yaml or install FreeSurfer 7.4+ (`mri_synthseg`)"}
    if mid == "fastsurfer_vinn" and not (settings.fastsurfer_repo and Path(settings.fastsurfer_repo).exists()) and not shutil.which("run_fastsurfer.sh"):
        return {"ready": False, "reason": "Set `fastsurfer_repo` in config.yaml or install FastSurfer"}
    if mid == "totalseg_mri" and not shutil.which("TotalSegmentator"):
        return {"ready": False, "reason": "Install TotalSegmentator (`pip install TotalSegmentator`)"}
    if mid == "brainmvp" and not (settings.brainmvp_ckpt and Path(settings.brainmvp_ckpt).exists()):
        return {"ready": False, "reason": "Set `brainmvp_ckpt` in config.yaml to BrainMVP_pretrained.pt"}
    if mid == "brainfound_ucl" and not (settings.brainfound_ucl_ckpt and Path(settings.brainfound_ucl_ckpt).exists()):
        return {"ready": False, "reason": "Set `brainfound_ucl_ckpt` in config.yaml (Moona-Mazher/BrainFound)"}
    if mid == "brainfound_mm" and not (settings.brainfound_mm_ckpt and Path(settings.brainfound_mm_ckpt).exists()):
        return {"ready": False, "reason": "Set `brainfound_mm_ckpt` in config.yaml (gingerbread000/Brainfound)"}
    if mid == "brainfm_jhu" and not (settings.brainfm_repo and Path(settings.brainfm_repo).exists()):
        return {"ready": False, "reason": "Set `brainfm_repo` in config.yaml to jhuldr/BrainFM"}
    if mid == "brainmorph" and not (settings.brainmorph_repo and Path(settings.brainmorph_repo).exists()):
        return {"ready": False, "reason": "Set `brainmorph_repo` in config.yaml to alanqrwang/brainmorph"}
    if mid == "braingfm" and not (settings.braingfm_ckpt and Path(settings.braingfm_ckpt).exists()):
        return {"ready": False, "reason": "Set `braingfm_ckpt` in config.yaml to BrainGFM checkpoint"}

    if runner in ("vol_enc", "neuro_vlm", "fmri_decode") and model.get("hf_repo") and mid != "biomedclip":
        if not _has("transformers"):
            return {"ready": False, "reason": "Install transformers (`pip install transformers accelerate`)"}

    return {"ready": True, "reason": "Ready"}


TASK_FN = {
    "embed_volumes":  run_embed_volumes,
    "brain_health":   run_brain_health,
    "zeroshot_neuro": run_zeroshot_neuro,
    "report_vqa":     run_report_vqa,
    "segment_brain":  run_segment_brain,
    "synth_register": run_synth_register,
    "decode_fmri":    run_decode_fmri,
}


def dispatch(ctx) -> dict:
    fn = TASK_FN.get(ctx.job.task)
    if fn is None:
        raise ValueError(f"Unsupported task: {ctx.job.task}")
    return fn(ctx)
