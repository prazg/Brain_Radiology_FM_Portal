"""Single-GPU job queue for 3D Brain Radiology Foundation Models."""
from __future__ import annotations

import json
import os
import queue
import threading
import time
import traceback
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


class JobContext:
    """Everything a neuroimaging runner needs. Runners write outputs exclusively via this context."""

    def __init__(self, job: "Job", settings, model: dict, device: str):
        self.job = job
        self.settings = settings
        self.model = model
        self.params: Dict[str, Any] = job.params
        self.device = device
        self.mock = settings.mock
        self.dir = job.dir
        self.out = job.dir / "out"
        self.scratch = job.dir / "scratch"
        self.out.mkdir(parents=True, exist_ok=True)
        self.scratch.mkdir(parents=True, exist_ok=True)
        self.inputs = job.inputs
        self.files: List[dict] = []

    def log(self, msg: str) -> None:
        self.job.log.append(f"{time.strftime('%H:%M:%S')}  {msg}")

    def progress(self, frac: float, stage: Optional[str] = None) -> None:
        self.job.progress = float(max(0.0, min(1.0, frac)))
        if stage:
            self.job.stage = stage
            self.log(stage)

    def out_path(self, name: str) -> Path:
        return self.out / name

    def register(self, name: str, label: str) -> str:
        p = self.out / name
        self.files.append({"name": name, "label": label, "size": p.stat().st_size if p.exists() else 0})
        return name


class Job:
    def __init__(self, root: Path, model_id: str, task: str, params: dict, hf_token: Optional[str]):
        self.id = uuid.uuid4().hex[:12]
        self.dir = root / self.id
        (self.dir / "input").mkdir(parents=True, exist_ok=True)
        self.model_id, self.task, self.params = model_id, task, params
        self.hf_token = hf_token
        self.inputs: Dict[str, Any] = {"volumes": [], "volume": None}
        self.status = "queued"
        self.stage = "Queued for GPU"
        self.progress = 0.0
        self.log: List[str] = []
        self.result: Optional[dict] = None
        self.error: Optional[str] = None
        self.created = time.time()
        self.finished: Optional[float] = None

    def public(self, with_result: bool = True) -> dict:
        d = {
            "id": self.id,
            "model_id": self.model_id,
            "task": self.task,
            "status": self.status,
            "stage": self.stage,
            "progress": self.progress,
            "log": self.log[-200:],
            "error": self.error,
            "created": self.created,
            "finished": self.finished,
            "params": self.params,
        }
        if with_result:
            d["result"] = self.result
        return d

    def persist(self) -> None:
        (self.dir / "job.json").write_text(json.dumps(self.public(), default=str), encoding="utf-8")


@contextmanager
def hf_token_env(token: Optional[str]):
    if not token:
        yield
        return
    old = os.environ.get("HF_TOKEN")
    os.environ["HF_TOKEN"] = token
    try:
        yield
    finally:
        if old is None:
            os.environ.pop("HF_TOKEN", None)
        else:
            os.environ["HF_TOKEN"] = old


def friendly_hint(e: Exception) -> str:
    msg = str(e)
    if "CERTIFICATE_VERIFY_FAILED" in msg:
        return "  ->  Corporate/hospital TLS proxy detected: `pip install truststore` and restart the server."
    if "GatedRepo" in type(e).__name__ or ("403" in msg and "huggingface" in msg):
        return "  ->  Request gated model access on Hugging Face, then run `hf auth login` on the server."
    if "CUDA out of memory" in msg or "OutOfMemoryError" in type(e).__name__:
        return "  ->  GPU out of memory: lower batch size / use 1.5 mm fast resampling or a larger GPU."
    return ""


def _reset_peak(device: str) -> None:
    if device.startswith("cuda"):
        try:
            import torch
            torch.cuda.reset_peak_memory_stats(device)
        except Exception:
            pass


def _peak_gb(device: str) -> Optional[float]:
    if not device.startswith("cuda"):
        return None
    try:
        import torch
        return round(torch.cuda.max_memory_allocated(device) / 1e9, 2)
    except Exception:
        return None


class PerfLog:
    """Measured runtime & peak VRAM per neuroimaging model × task × device."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()

    def record(self, job: Job, ctx: JobContext, seconds: float, peak_gb: Optional[float]) -> None:
        if ctx.mock:
            return
        gpu = None
        if ctx.device.startswith("cuda"):
            try:
                import torch
                gpu = torch.cuda.get_device_name(ctx.device)
            except Exception:
                pass
        items = len(job.inputs.get("volumes") or []) or 1
        row = {
            "t": time.time(),
            "model_id": job.model_id,
            "task": job.task,
            "device": "cuda" if gpu else "cpu",
            "gpu": gpu,
            "items": items,
            "seconds": round(seconds, 2),
            "peak_vram_gb": peak_gb,
        }
        with self.lock, self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")

    def summary(self) -> dict:
        rows = []
        if self.path.exists():
            for ln in self.path.read_text(encoding="utf-8").splitlines():
                try:
                    rows.append(json.loads(ln))
                except json.JSONDecodeError:
                    pass
        out: dict = {}
        for r in rows:
            d = out.setdefault(r["model_id"], {}).setdefault(r["task"], {}).setdefault(
                r["device"], {"rates": [], "peak": [], "gpu": r.get("gpu")}
            )
            if r.get("items") and r["seconds"] > 0:
                d["rates"].append(r["items"] / r["seconds"])
            if r.get("peak_vram_gb") is not None:
                d["peak"].append(r["peak_vram_gb"])
        for m in out.values():
            for t in m.values():
                for dev, d in list(t.items()):
                    rates = sorted(d.pop("rates"))
                    peaks = d.pop("peak")
                    t[dev] = {
                        "runs": max(len(rates), len(peaks), 1),
                        "items_per_s": round(rates[len(rates) // 2], 2) if rates else None,
                        "peak_vram_gb": max(peaks) if peaks else None,
                        "gpu": d["gpu"],
                    }
        return out


class JobManager:
    def __init__(self, settings, registry: dict, dispatch_fn: Callable):
        self.settings = settings
        self.models = {m["id"]: m for m in registry["models"]}
        self.dispatch = dispatch_fn
        self.jobs: Dict[str, Job] = {}
        self.q: "queue.Queue[Job]" = queue.Queue()
        self.perf = PerfLog(settings.work_dir / "perf.jsonl")
        self._load_persisted()
        threading.Thread(target=self._worker, daemon=True).start()

    def _load_persisted(self) -> None:
        for jf in sorted(self.settings.work_dir.glob("*/job.json")):
            try:
                data = json.loads(jf.read_text(encoding="utf-8"))
                j = Job(self.settings.work_dir, data["model_id"], data["task"], data.get("params", {}), None)
                j.id = data["id"]
                j.dir = jf.parent
                j.status = "failed" if data["status"] in ("queued", "running") else data["status"]
                j.stage = data.get("stage", "")
                j.progress = data.get("progress", 0.0)
                j.log = data.get("log", [])
                j.result = data.get("result")
                j.error = data.get("error") or ("Server restarted before job completed." if data["status"] in ("queued", "running") else None)
                j.created = data.get("created", time.time())
                j.finished = data.get("finished")
                self.jobs[j.id] = j
            except Exception:
                pass

    def create(self, model_id: str, task: str, params: dict, hf_token: Optional[str]) -> Job:
        job = Job(self.settings.work_dir, model_id, task, params, hf_token)
        self.jobs[job.id] = job
        return job

    def submit(self, job: Job) -> None:
        job.persist()
        self.q.put(job)

    def _worker(self) -> None:
        while True:
            job = self.q.get()
            if job.status == "cancelled":
                continue
            model = self.models[job.model_id]
            device = self.settings.resolved_device()
            ctx = JobContext(job, self.settings, model, device)
            job.status = "running"
            ctx.progress(0.05, f"Starting {model['name']} on {device}{' (mock)' if ctx.mock else ''}")
            job.persist()
            t0 = time.time()
            _reset_peak(device)
            try:
                with hf_token_env(job.hf_token):
                    result = self.dispatch(ctx)
                result.setdefault("files", ctx.files)
                job.result = result
                job.status = "done"
                job.finished = time.time()
                ctx.progress(1.0, f"Completed in {job.finished - t0:.1f}s")
                self.perf.record(job, ctx, job.finished - t0, _peak_gb(device))
            except Exception as e:
                job.status = "failed"
                job.finished = time.time()
                job.error = f"{type(e).__name__}: {e}{friendly_hint(e)}"
                ctx.log(traceback.format_exc())
            job.persist()
