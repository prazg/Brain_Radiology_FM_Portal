"""Configuration loader for the Brain Radiology FM Portal backend."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

import yaml

BACKEND_DIR = Path(__file__).resolve().parent
REGISTRY_PATH = BACKEND_DIR.parent / "docs" / "models.json"


@dataclass
class Settings:
    work_dir: Path = field(default_factory=lambda: BACKEND_DIR / "work")
    origins: List[str] = field(default_factory=lambda: ["*"])
    portal_key: str = ""
    allowed_scan_roots: List[Path] = field(default_factory=list)
    device: str = "auto"
    mock: bool = False
    max_upload_mb: int = 1024

    # External repo / checkpoint overrides
    synthseg_repo: str = ""
    fastsurfer_repo: str = ""
    brainfm_repo: str = ""
    brainmorph_repo: str = ""
    brainmvp_ckpt: str = ""
    brainfound_ucl_ckpt: str = ""
    brainfound_mm_ckpt: str = ""
    braingfm_ckpt: str = ""

    def resolved_device(self) -> str:
        if self.device != "auto":
            return self.device
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda:0"
            mps = getattr(torch.backends, "mps", None)
            if mps and mps.is_available():
                return "mps"
        except ImportError:
            pass
        return "cpu"


def load_settings(config_path: Path | None = None) -> Settings:
    cfg_file = config_path or Path(os.environ.get("PORTAL_CONFIG", BACKEND_DIR / "config.yaml"))
    raw: dict = {}
    if cfg_file.is_file():
        raw = yaml.safe_load(cfg_file.read_text(encoding="utf-8")) or {}

    work_dir = Path(os.environ.get("PORTAL_WORK_DIR", raw.get("work_dir", BACKEND_DIR / "work"))).expanduser().resolve()
    work_dir.mkdir(parents=True, exist_ok=True)

    roots_raw = list(raw.get("allowed_scan_roots") or [])
    env_roots = os.environ.get("PORTAL_SCAN_ROOTS", "")
    if env_roots:
        roots_raw.extend([p for p in env_roots.split(os.pathsep) if p.strip()])
    allowed_roots = [Path(p).expanduser().resolve() for p in roots_raw if p]

    mock_env = os.environ.get("PORTAL_MOCK")
    mock = (mock_env.lower() in ("1", "true", "yes")) if mock_env is not None else bool(raw.get("mock", False))

    return Settings(
        work_dir=work_dir,
        origins=list(raw.get("origins") or ["*"]),
        portal_key=os.environ.get("PORTAL_KEY", str(raw.get("portal_key") or "")),
        allowed_scan_roots=allowed_roots,
        device=os.environ.get("PORTAL_DEVICE", str(raw.get("device") or "auto")),
        mock=mock,
        max_upload_mb=int(os.environ.get("PORTAL_MAX_UPLOAD_MB", raw.get("max_upload_mb", 1024))),
        synthseg_repo=str(raw.get("synthseg_repo") or os.environ.get("SYNTHSEG_REPO", "")),
        fastsurfer_repo=str(raw.get("fastsurfer_repo") or os.environ.get("FASTSURFER_REPO", "")),
        brainfm_repo=str(raw.get("brainfm_repo") or os.environ.get("BRAINFM_REPO", "")),
        brainmorph_repo=str(raw.get("brainmorph_repo") or os.environ.get("BRAINMORPH_REPO", "")),
        brainmvp_ckpt=str(raw.get("brainmvp_ckpt") or os.environ.get("BRAINMVP_CKPT", "")),
        brainfound_ucl_ckpt=str(raw.get("brainfound_ucl_ckpt") or os.environ.get("BRAINFOUND_UCL_CKPT", "")),
        brainfound_mm_ckpt=str(raw.get("brainfound_mm_ckpt") or os.environ.get("BRAINFOUND_MM_CKPT", "")),
        braingfm_ckpt=str(raw.get("braingfm_ckpt") or os.environ.get("BRAINGFM_CKPT", "")),
    )
