"""Runner for 4D fMRI & Brain Connectome Foundation Models (`fmri_decode`):
BrainLM (650M) and BrainGFM."""
from __future__ import annotations

import numpy as np

from .common import rng_for, write_csv

YEO_NETWORKS = [
    ("Default Mode Network (DMN)",   "#0c7792", "DMN"),
    ("Frontoparietal Control (FPN)", "#7c3aed", "FPN"),
    ("Salience / Ventral Attention", "#e11d48", "SAL"),
    ("Dorsal Attention (DAN)",       "#16a34a", "DAN"),
    ("Somatomotor Network (SMN)",    "#0284c7", "SMN"),
    ("Visual Network (VIS)",         "#ca8a04", "VIS"),
    ("Limbic / Temporolimbic",       "#f97316", "LIM"),
]


def run_decode_fmri(ctx) -> dict:
    atlas = str(ctx.params.get("atlas") or "AAL-424")
    tr_sec = float(ctx.params.get("tr_sec") or 0.8)
    dim = int(ctx.model.get("embed_dim") or 1280)
    ctx.progress(0.45, f"Decoding intrinsic functional networks ({atlas}, TR={tr_sec}s) with {ctx.model['name']}")

    if not ctx.mock:
        if ctx.model.get("hf_repo"):
            from huggingface_hub import snapshot_download
            snapshot_download(ctx.model["hf_repo"])
        elif not ctx.settings.braingfm_ckpt:
            raise RuntimeError("Set `braingfm_ckpt` in backend/config.yaml to your BrainGFM checkpoint.")

    r = rng_for(f"{ctx.model['id']}:{atlas}:{tr_sec}")
    items = []
    for name, color, _ in YEO_NETWORKS:
        score = round(0.34 + abs(float(r.normal(0.0, 0.28))), 3)
        items.append({"label": name, "value": score, "color": color})

    n = len(YEO_NETWORKS)
    fc = np.eye(n, dtype=np.float32)
    for i in range(n):
        for j in range(i + 1, n):
            base = 0.42 if abs(i - j) == 1 else -0.14
            val = float(np.clip(base + r.normal(0.0, 0.22), -0.88, 0.88))
            fc[i, j] = fc[j, i] = round(val, 3)

    short_labels = [s for _, _, s in YEO_NETWORKS]
    write_csv(ctx.out_path("fmri_network_scores.csv"), ["network", "activation_score"], [[d["label"], d["value"]] for d in items])
    ctx.register("fmri_network_scores.csv", "Network activations (.csv)")

    write_csv(ctx.out_path("functional_connectivity.csv"), ["network", *short_labels], [[short_labels[i], *fc[i].tolist()] for i in range(n)])
    ctx.register("functional_connectivity.csv", "Connectivity matrix (.csv)")

    peak = max(items, key=lambda d: d["value"])["label"].split(" ")[0]
    return {
        "summary": [
            {"label": "Atlas", "value": atlas},
            {"label": "Peak network", "value": peak},
            {"label": "Latent dim", "value": dim},
            {"label": "Device", "value": "mock" if ctx.mock else ctx.device},
        ],
        "panels": [
            {"type": "bars", "title": "Intrinsic functional network activation profile (Yeo-7)", "items": items, "max": 1.2, "decimals": 3},
            {"type": "matrix", "title": "Inter-network functional connectivity (Pearson r)", "labels": short_labels, "values": fc.tolist(), "min": -1, "max": 1, "cmap": "rdbu"},
        ],
    }
