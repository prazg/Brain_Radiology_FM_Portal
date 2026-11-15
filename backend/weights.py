"""Weights manager: checks cached Hugging Face checkpoints, gated repo access, and background downloads.

All weights live in the standard Hugging Face cache (HF_HOME / HF_HUB_CACHE) — nothing is ever
downloaded into the git repository."""
from __future__ import annotations

import os
import threading
import time
from typing import Dict, List, Optional


def hf_cache_dir() -> str:
    try:
        from huggingface_hub import constants
        return str(constants.HF_HUB_CACHE)
    except Exception:
        return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def _cached(repo: str, filename: str, rtype: str) -> bool:
    from huggingface_hub import try_to_load_from_cache
    return isinstance(try_to_load_from_cache(repo, filename, repo_type=rtype), str)


class WeightsManager:
    def __init__(self, registry: dict, mock: bool = False):
        self.models = {m["id"]: m for m in registry["models"]}
        self.mock = mock
        self.state: Dict[str, dict] = {}
        self.access: Dict[str, str] = {}
        self._mock_cached: set = set()
        self._lock = threading.Lock()
        self._queue: List[tuple] = []
        self._wake = threading.Event()
        threading.Thread(target=self._worker, daemon=True).start()

    def _component_ids(self, mid: str) -> List[str]:
        return [mid] + list(self.models[mid].get("requires_models", []))

    def _file_status(self, w: dict) -> Optional[bool]:
        if w["via"] == "hf":
            if self.mock:
                return w["repo"] in self._mock_cached
            try:
                return all(_cached(w["repo"], f, w.get("type", "model")) for f in w["files"])
            except Exception:
                return None
        return None  # external GitHub / pip-managed checkpoints

    def status(self, mid: str) -> dict:
        parts = []
        for cid in self._component_ids(mid):
            for w in self.models[cid]["weights"]:
                parts.append({
                    "model": cid,
                    "via": w["via"],
                    "repo": w.get("repo"),
                    "gb": w.get("gb"),
                    "cached": self._file_status(w),
                    "access": self.access.get(w.get("repo") or "", "unknown"),
                    "note": w.get("note"),
                    "url": w.get("url"),
                })
        known = [p["cached"] for p in parts if p["cached"] is not None]
        if not parts:
            overall = "none"
        elif any(p["via"] == "external" for p in parts):
            overall = "manual"
        elif known and all(known) and len(known) == len(parts):
            overall = "cached"
        elif any(known):
            overall = "partial"
        elif not known:
            overall = "unknown"
        else:
            overall = "missing"
        missing_gb = sum(p["gb"] or 0 for p in parts if p["cached"] is False)
        st = self.state.get(mid, {})
        return {
            "overall": overall,
            "parts": parts,
            "missing_gb": round(missing_gb, 2),
            "download": st.get("status", "idle"),
            "message": st.get("message"),
            "progress": st.get("progress", 0.0),
        }

    def all_status(self) -> dict:
        return {mid: self.status(mid) for mid in self.models}

    def check_access(self, repos: List[tuple], token: Optional[str]) -> Dict[str, str]:
        out = {}
        for repo, rtype in repos:
            if self.mock:
                out[repo] = "ok"
                continue
            try:
                from huggingface_hub import HfApi
                api = HfApi(token=token or None)
                if hasattr(api, "auth_check"):
                    api.auth_check(repo, repo_type=rtype)
                else:
                    api.model_info(repo, files_metadata=False) if rtype == "model" else api.dataset_info(repo)
                out[repo] = "ok"
            except Exception as e:
                name = type(e).__name__
                out[repo] = "no-access" if "Gated" in name else "not-found" if "NotFound" in name else "error"
        self.access.update(out)
        return out

    def enqueue(self, mid: str, token: Optional[str]) -> dict:
        with self._lock:
            st = self.state.get(mid, {})
            if st.get("status") in ("queued", "downloading"):
                return self.status(mid)
            self.state[mid] = {"status": "queued", "message": "Waiting to download", "progress": 0.0}
            self._queue.append((mid, token))
        self._wake.set()
        return self.status(mid)

    def _worker(self):
        while True:
            self._wake.wait()
            with self._lock:
                if not self._queue:
                    self._wake.clear()
                    continue
                mid, token = self._queue.pop(0)
            try:
                self._download(mid, token)
                self.state[mid] = {"status": "done", "message": "Weights cached on server.", "progress": 1.0}
            except Exception as e:
                name = type(e).__name__
                from jobs import friendly_hint
                msg = (
                    "Gated repository: accept access on Hugging Face, then run `hf auth login` on the server "
                    "or paste your HF token under Connect."
                    if "Gated" in name else f"{name}: {e}{friendly_hint(e)}"
                )
                self.state[mid] = {"status": "error", "message": msg, "progress": 0.0}

    def _download(self, mid: str, token: Optional[str]):
        items = [(cid, w) for cid in self._component_ids(mid) for w in self.models[cid]["weights"]]
        total = sum(w.get("gb") or 0 for _, w in items) or 1.0
        done = 0.0
        for cid, w in items:
            self.state[mid].update(status="downloading", message=f"{w.get('repo') or cid} ({w.get('gb') or '?'} GB)")
            if self.mock:
                for _ in range(3):
                    time.sleep(0.05)
                self._mock_cached.add(w.get("repo") or cid)
            elif w["via"] == "hf":
                from huggingface_hub import hf_hub_download
                for f in w["files"]:
                    hf_hub_download(w["repo"], f, repo_type=w.get("type", "model"), token=token or None)
            elif w["via"] == "external":
                raise RuntimeError(w.get("note") or "Weights are distributed via the upstream GitHub repository.")
            done += w.get("gb") or 0
            self.state[mid]["progress"] = min(1.0, done / total)
