"""
Brain Radiology FM Portal (NeuroRad-FM) — FastAPI GPU inference backend.

The GitHub Pages site (`docs/`) is pure static HTML/CSS/JS; this server runs 3D NIfTI / DICOM
models on your own GPU (or in deterministic 3D brain phantom mock mode anywhere):

    python -m uvicorn server:app --host 127.0.0.1 --port 8000          # from backend/
    PORTAL_MOCK=1 python -m uvicorn server:app --port 8000              # zero-weight 3D phantom test
"""
from __future__ import annotations

import certs  # noqa: F401 — inject OS TLS certificate store before HF Hub calls
import importlib.util
import json
import shutil
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from config import REGISTRY_PATH, load_settings
import hardware
from jobs import JobManager
from runners import dispatch, runner_status
from weights import WeightsManager, hf_cache_dir

VERSION = "1.0.0"
settings = load_settings()
registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
MODELS = {m["id"]: m for m in registry["models"]}
manager = JobManager(settings, registry, dispatch)
weights = WeightsManager(registry, mock=settings.mock)

app = FastAPI(title="Brain Radiology FM Portal Backend", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=False,
)


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    """Allow HTTPS GitHub Pages to call a local 127.0.0.1 backend on Chromium-based browsers."""
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


def require_key(x_portal_key: Optional[str] = Header(default=None)):
    if settings.portal_key and x_portal_key != settings.portal_key:
        raise HTTPException(401, "Missing or wrong portal key. Configure it under Connect in the portal.")


def _mods() -> dict:
    names = ["torch", "nibabel", "monai", "SimpleITK", "transformers", "open_clip", "timm", "h5py", "huggingface_hub"]
    return {n: importlib.util.find_spec(n) is not None for n in names}


@app.get("/api/health", dependencies=[Depends(require_key)])
def health():
    cuda, gpu = False, None
    try:
        import torch
        cuda = torch.cuda.is_available()
        gpu = torch.cuda.get_device_name(0) if cuda else None
    except ImportError:
        pass
    token = None
    try:
        from huggingface_hub import get_token
        token = get_token()
    except Exception:
        pass
    return {
        "ok": True,
        "version": VERSION,
        "mock": settings.mock,
        "device": settings.resolved_device(),
        "cuda": cuda,
        "gpu": gpu,
        "packages": _mods(),
        "registry_version": registry.get("version"),
        "scan_roots": [str(p) for p in settings.allowed_scan_roots],
        "queue": manager.q.qsize(),
        "hardware": hardware.detect(hf_cache_dir()),
        "hf_cache": hf_cache_dir(),
        "hf_logged_in": bool(token),
        "system_certs": certs.ACTIVE,
    }


@app.get("/api/weights", dependencies=[Depends(require_key)])
def weights_status():
    return weights.all_status()


@app.post("/api/weights/{model_id}/download", dependencies=[Depends(require_key)])
def weights_download(model_id: str, x_hf_token: Optional[str] = Header(default=None)):
    if model_id not in MODELS:
        raise HTTPException(404, f"Unknown model {model_id}")
    return weights.enqueue(model_id, x_hf_token)


@app.post("/api/weights/access", dependencies=[Depends(require_key)])
def weights_access(x_hf_token: Optional[str] = Header(default=None)):
    repos = sorted({
        (w["repo"], w.get("type", "model"))
        for m in MODELS.values()
        for w in m["weights"]
        if w["via"] == "hf"
    })
    return weights.check_access(repos, x_hf_token)


@app.get("/api/perf", dependencies=[Depends(require_key)])
def perf():
    return manager.perf.summary()


@app.get("/api/models", dependencies=[Depends(require_key)])
def models():
    return {m_id: runner_status(m, settings) for m_id, m in MODELS.items()}


def _safe_scan_path(p: str) -> Path:
    path = Path(p).expanduser().resolve()
    if not settings.allowed_scan_roots:
        raise HTTPException(400, "Server scan paths are disabled. Add directories to allowed_scan_roots in backend/config.yaml.")
    if not any(path.is_relative_to(root) for root in settings.allowed_scan_roots):
        raise HTTPException(403, f"{path} is outside allowed_scan_roots.")
    if not path.exists():
        raise HTTPException(404, f"No NIfTI file or DICOM directory at {path}")
    return path


async def _save(upload: UploadFile, dest: Path) -> Path:
    limit = settings.max_upload_mb * 1024 * 1024
    size = 0
    with dest.open("wb") as f:
        while chunk := await upload.read(1 << 20):
            size += len(chunk)
            if size > limit:
                raise HTTPException(413, f"{upload.filename} exceeds max_upload_mb ({settings.max_upload_mb} MB).")
            f.write(chunk)
    return dest


@app.post("/api/jobs", dependencies=[Depends(require_key)])
async def create_job(
    model_id: str = Form(...),
    task: str = Form(...),
    params: str = Form("{}"),
    volume_path: Optional[str] = Form(None),
    volumes: List[UploadFile] = File(default=[]),
    volume: Optional[UploadFile] = File(default=None),
    x_hf_token: Optional[str] = Header(default=None),
):
    model = MODELS.get(model_id)
    if model is None:
        raise HTTPException(404, f"Unknown model {model_id}")
    if task not in model.get("tasks", []):
        raise HTTPException(400, f"{model['name']} does not support task '{task}'")
    status = runner_status(model, settings)
    if not status["ready"]:
        raise HTTPException(409, f"{model['name']} is not ready on this server: {status['reason']}")
    try:
        p = json.loads(params or "{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "params must be valid JSON")

    needs = registry["tasks"][task]["input"]
    job = manager.create(model_id, task, p, x_hf_token)
    inp = job.dir / "input"
    if needs == "volumes":
        if not volumes:
            raise HTTPException(400, "Upload at least one NIfTI volume or radiological slice.")
        for i, v in enumerate(volumes):
            name = Path(v.filename or f"vol_{i}.nii.gz").name
            job.inputs["volumes"].append(str(await _save(v, inp / f"{i:04d}_{name}")))
    else:
        if volume is not None and volume.filename:
            job.inputs["volume"] = str(await _save(volume, inp / Path(volume.filename).name))
        elif volume_path:
            job.inputs["volume"] = str(_safe_scan_path(volume_path))
        else:
            raise HTTPException(400, "Upload a 3D NIfTI / slice file or specify a server scan path.")
    manager.submit(job)
    return {"id": job.id}


@app.get("/api/jobs", dependencies=[Depends(require_key)])
def list_jobs():
    return [j.public(with_result=False) for j in sorted(manager.jobs.values(), key=lambda j: -j.created)]


def _job(job_id: str):
    job = manager.jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "No such job on this server.")
    return job


@app.get("/api/jobs/{job_id}", dependencies=[Depends(require_key)])
def get_job(job_id: str):
    return _job(job_id).public()


@app.delete("/api/jobs/{job_id}", dependencies=[Depends(require_key)])
def delete_job(job_id: str):
    job = _job(job_id)
    if job.status == "running":
        raise HTTPException(409, "Cannot delete a running job; wait for completion.")
    job.status = "cancelled"
    manager.jobs.pop(job_id, None)
    shutil.rmtree(job.dir, ignore_errors=True)
    return {"deleted": job_id}


def _out_file(job_id: str, name: str) -> Path:
    job = _job(job_id)
    path = (job.dir / "out" / name).resolve()
    if not path.is_relative_to((job.dir / "out").resolve()) or not path.is_file():
        raise HTTPException(404, "No such output file")
    return path


def _key_q(key: Optional[str] = None, x_portal_key: Optional[str] = Header(default=None)):
    if settings.portal_key and settings.portal_key not in (key, x_portal_key):
        raise HTTPException(401, "Missing or wrong portal key.")


@app.get("/api/jobs/{job_id}/files/{name}", dependencies=[Depends(_key_q)])
def get_file(job_id: str, name: str):
    return FileResponse(_out_file(job_id, name), filename=name)
