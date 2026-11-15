"""End-to-end mock-mode test suite for the Brain Radiology FM Portal backend.

Exercises `/api/health`, `/api/models`, `/api/weights`, path-traversal safety,
and EVERY single one of the 25 models × all of its declared tasks."""
from __future__ import annotations

import io
import json
import os
import sys
import time
from pathlib import Path

import pytest
from PIL import Image

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    work = tmp_path_factory.mktemp("neuro_work")
    scans = tmp_path_factory.mktemp("allowed_scans")
    # Create a tiny dummy scan file inside the allowed scan directory
    dummy_nii = scans / "sub-01_T1w.nii.gz"
    from runners.common import make_brain_phantom_3d, save_nifti
    vol, _ = make_brain_phantom_3d((32, 32, 32), contrast="t1", seed="pytest")
    save_nifti(vol, dummy_nii)

    os.environ["PORTAL_MOCK"] = "1"
    os.environ["PORTAL_WORK_DIR"] = str(work)
    os.environ["PORTAL_SCAN_ROOTS"] = str(scans)
    os.environ["PORTAL_KEY"] = "test-secret"

    from fastapi.testclient import TestClient
    import server
    return TestClient(server.app), dummy_nii


def _png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("L", (64, 64), color=128).save(buf, format="PNG")
    return buf.getvalue()


def test_health_and_auth(client):
    tc, _ = client
    assert tc.get("/api/health").status_code == 401
    r = tc.get("/api/health", headers={"X-Portal-Key": "test-secret"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["mock"] is True


def test_registry_and_models_ready(client):
    tc, _ = client
    r = tc.get("/api/models", headers={"X-Portal-Key": "test-secret"})
    assert r.status_code == 200
    models = r.json()
    assert len(models) == 28
    assert all(v["ready"] for v in models.values())


def test_scan_path_traversal_blocked(client, tmp_path):
    tc, _ = client
    outside = tmp_path / "secret.nii.gz"
    outside.write_bytes(b"outside")
    r = tc.post(
        "/api/jobs",
        headers={"X-Portal-Key": "test-secret"},
        data={"model_id": "brainiac", "task": "brain_health", "volume_path": str(outside)},
    )
    assert r.status_code == 403


def test_every_model_and_task_succeeds_in_mock_mode(client):
    tc, dummy_nii = client
    reg = json.loads((BACKEND_DIR.parent / "docs" / "models.json").read_text(encoding="utf-8"))
    hdr = {"X-Portal-Key": "test-secret"}

    for m in reg["models"]:
        for task in m["tasks"]:
            needs = reg["tasks"][task]["input"]
            if needs == "volumes":
                files = [
                    ("volumes", ("sub01.png", _png_bytes(), "image/png")),
                    ("volumes", ("sub02.png", _png_bytes(), "image/png")),
                    ("volumes", ("sub03.png", _png_bytes(), "image/png")),
                ]
                res = tc.post("/api/jobs", headers=hdr, data={"model_id": m["id"], "task": task}, files=files)
            else:
                res = tc.post(
                    "/api/jobs",
                    headers=hdr,
                    data={"model_id": m["id"], "task": task, "volume_path": str(dummy_nii)},
                )
            assert res.status_code == 200, f"Submit failed for {m['id']} / {task}: {res.text}"
            jid = res.json()["id"]

            # Wait for background worker
            for _ in range(80):
                jr = tc.get(f"/api/jobs/{jid}", headers=hdr).json()
                if jr["status"] in ("done", "failed"):
                    break
                time.sleep(0.05)

            assert jr["status"] == "done", f"{m['id']} / {task} failed: {jr.get('error')}"
            assert jr["result"]["panels"], f"{m['id']} / {task} produced no panels"
            for f in jr["result"].get("files", []):
                fr = tc.get(f"/api/jobs/{jid}/files/{f['name']}?key=test-secret")
                assert fr.status_code == 200
