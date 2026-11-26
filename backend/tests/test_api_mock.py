"""End-to-end mock-mode test suite for the Brain Radiology FM Portal backend.

Exercises registry schema integrity (28 models, 18 datasets, 8 benchmarks),
`/api/health`, `/api/models`, `/api/datasets`, `/api/benchmarks`, `/api/weights`,
path-traversal safety, and EVERY single one of the 28 models × all declared tasks."""
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


def test_registry_schema_datasets_and_benchmarks():
    reg = json.loads((BACKEND_DIR.parent / "docs" / "models.json").read_text(encoding="utf-8"))
    assert len(reg["models"]) == 28
    assert len(reg["datasets"]) == 18
    assert len(reg["benchmarks"]) == 8
    assert len(reg.get("ecosystem", [])) >= 5

    cat_ids = set(reg["categories"].keys())
    task_ids = set(reg["tasks"].keys())
    model_ids = set()
    for m in reg["models"]:
        assert m["id"] not in model_ids, f"Duplicate model id: {m['id']}"
        model_ids.add(m["id"])
        assert m["category"] in cat_ids, f"Invalid category on {m['id']}"
        assert m["tasks"], f"No tasks on {m['id']}"
        for t in m["tasks"]:
            assert t in task_ids, f"Invalid task {t} on {m['id']}"
        assert m["paper_url"].startswith("https://"), f"Invalid paper_url on {m['id']}"
        assert m["link"].startswith("https://"), f"Invalid link on {m['id']}"

    ds_cats = set(reg["dataset_categories"].keys())
    ds_ids = set()
    for d in reg["datasets"]:
        assert d["id"] not in ds_ids, f"Duplicate dataset id: {d['id']}"
        ds_ids.add(d["id"])
        assert d["category"] in ds_cats, f"Invalid dataset category on {d['id']}"
        assert d["access_tier"] in ("open", "registration", "credentialed"), f"Invalid access_tier on {d['id']}"
        assert d["doi"], f"Missing DOI on dataset {d['id']}"
        assert d["bibtex"].startswith("@"), f"Invalid BibTeX on dataset {d['id']}"
        assert d["url"].startswith("http"), f"Invalid URL on dataset {d['id']}"
        assert d["paper_url"].startswith("http"), f"Invalid paper_url on dataset {d['id']}"
        assert d["cli_hint"], f"Missing cli_hint on dataset {d['id']}"

    bench_ids = set()
    for b in reg["benchmarks"]:
        assert b["id"] not in bench_ids, f"Duplicate benchmark id: {b['id']}"
        bench_ids.add(b["id"])
        assert b["entries"], f"Empty leaderboard on benchmark {b['id']}"
        assert b["doi"], f"Missing DOI on benchmark {b['id']}"
        assert b["url"].startswith("http"), f"Invalid URL on benchmark {b['id']}"
        for e in b["entries"]:
            assert e["model_id"] in model_ids, f"Benchmark {b['id']} references unknown model_id {e['model_id']}"
            assert isinstance(e["score"], (int, float)), f"Non-numeric score on {b['id']}/{e['model_id']}"


def test_health_and_auth(client):
    tc, _ = client
    assert tc.get("/api/health").status_code == 401
    r = tc.get("/api/health", headers={"X-Portal-Key": "test-secret"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["mock"] is True
    assert body["model_count"] == 28
    assert body["dataset_count"] == 18
    assert body["benchmark_count"] == 8


def test_registry_and_models_ready(client):
    tc, _ = client
    hdr = {"X-Portal-Key": "test-secret"}
    r = tc.get("/api/models", headers=hdr)
    assert r.status_code == 200
    models = r.json()
    assert len(models) == 28
    assert all(v["ready"] for v in models.values())

    assert tc.get("/api/datasets").status_code == 401
    rd = tc.get("/api/datasets", headers=hdr)
    assert rd.status_code == 200
    assert len(rd.json()["datasets"]) == 18

    assert tc.get("/api/benchmarks").status_code == 401
    rb = tc.get("/api/benchmarks", headers=hdr)
    assert rb.status_code == 200
    assert len(rb.json()["benchmarks"]) == 8
    assert len(rb.json()["ecosystem"]) >= 5


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
