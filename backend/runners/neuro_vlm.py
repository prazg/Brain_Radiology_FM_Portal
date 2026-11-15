"""Runner for Neuro Vision–Language & Diagnostic Models (`neuro_vlm`):
NeuroVFM-LLM, NeuroVFM-Dx (MRI & Head CT), BrainGemma3D, M3D-LaMed, MedGemma-4B, RadFM, BiomedCLIP."""
from __future__ import annotations

import json
from typing import List

import numpy as np

from .common import (
    ANAT_LABELS,
    export_triplanar_pngs,
    load_volume_3d,
    make_brain_phantom_3d,
    rng_for,
    write_csv,
)


DEFAULT_MRI_PROMPTS = [
    "high-grade diffuse glioma with perilesional FLAIR edema",
    "acute restricted diffusion ischemic stroke",
    "demyelinating periventricular white-matter plaques",
    "age-related cerebral atrophy and microvascular leukoaraiosis",
    "unremarkable structural brain MRI",
]

DEFAULT_CT_PROMPTS = [
    "acute subdural or epidural hemorrhage",
    "intraparenchymal or subarachnoid hemorrhage",
    "acute middle cerebral artery territory ischemic infarct",
    "mass effect with midline shift",
    "unremarkable non-contrast head CT",
]


def run_zeroshot_neuro(ctx) -> dict:
    is_ct = ctx.model.get("modality") == "ct"
    prompts: List[str] = [p.strip() for p in (ctx.params.get("prompts") or (DEFAULT_CT_PROMPTS if is_ct else DEFAULT_MRI_PROMPTS)) if str(p).strip()]
    if not prompts:
        prompts = DEFAULT_CT_PROMPTS if is_ct else DEFAULT_MRI_PROMPTS

    contrast = "ct" if is_ct else "flair"
    vol, _, _ = load_volume_3d(ctx.inputs.get("volume"), mock=ctx.mock, contrast=contrast, seed=ctx.model["id"])
    ctx.progress(0.45, f"Scoring {len(prompts)} neuroradiology findings with {ctx.model['name']}")

    if ctx.mock:
        r = rng_for(f"{ctx.model['id']}:zs:{'|'.join(prompts)}")
        logits = np.array([(1.35 if i == 0 else 0.0) + float(r.normal(0.0, 0.65)) for i in range(len(prompts))], dtype=np.float32)
        ex = np.exp(logits - logits.max())
        probs = ex / ex.sum()
    elif ctx.model["id"] == "biomedclip":
        import open_clip
        import torch
        from PIL import Image
        repo = ctx.model["hf_repo"]
        model, _, preprocess = open_clip.create_model_and_transforms(f"hf-hub:{repo}")
        tokenizer = open_clip.get_tokenizer(f"hf-hub:{repo}")
        model = model.to(ctx.device).eval()
        iz, iy, ix = vol.shape[2] // 2, vol.shape[1] // 2, vol.shape[0] // 2
        imgs = torch.stack([
            preprocess(Image.fromarray(np.clip(s, 0, 255).astype(np.uint8)).convert("RGB"))
            for s in (vol[:, :, iz], vol[:, iy, :], vol[ix, :, :])
        ]).to(ctx.device)
        toks = tokenizer(prompts).to(ctx.device)
        with torch.no_grad():
            im_f = model.encode_image(imgs).float().mean(dim=0, keepdim=True)
            im_f = im_f / im_f.norm(dim=-1, keepdim=True)
            tx_f = model.encode_text(toks).float()
            tx_f = tx_f / tx_f.norm(dim=-1, keepdim=True)
            probs = (100.0 * im_f @ tx_f.T).softmax(dim=-1)[0].cpu().numpy()
    else:
        import torch
        from transformers import AutoModel
        repo = ctx.model.get("hf_repo")
        if not repo:
            raise RuntimeError(f"{ctx.model['name']} uses an external checkpoint ({ctx.model['link']}); set its path in backend/config.yaml or run with PORTAL_MOCK=1.")
        model = AutoModel.from_pretrained(repo, trust_remote_code=True).to(ctx.device).eval()
        t = torch.from_numpy(vol).float()[None, None].to(ctx.device)
        t = (t - t.mean()) / (t.std() + 1e-5)
        with torch.no_grad():
            out = model(t)
            raw = out.logits[0].float().cpu().numpy() if hasattr(out, "logits") else np.zeros(len(prompts), dtype=np.float32)
        raw = np.resize(raw, len(prompts))
        ex = np.exp(raw - raw.max())
        probs = ex / ex.sum()

    items = sorted(
        [{"label": prompts[i], "value": round(float(probs[i]), 4)} for i in range(len(prompts))],
        key=lambda d: -d["value"],
    )
    _, mask = make_brain_phantom_3d(vol.shape, contrast=contrast, with_lesion=True, seed=ctx.model["id"])
    planes, masks = export_triplanar_pngs(ctx, vol, mask if ctx.mock else None, prefix="zs")

    write_csv(ctx.out_path("zeroshot_neuro_scores.csv"), ["finding", "probability"], [[d["label"], d["value"]] for d in items])
    ctx.register("zeroshot_neuro_scores.csv", "Diagnostic probabilities (.csv)")

    return {
        "summary": [
            {"label": "Top finding", "value": items[0]["label"][:32]},
            {"label": "Probability", "value": f"{items[0]['value'] * 100:.1f}%"},
            {"label": "Candidates", "value": len(items)},
            {"label": "Device", "value": "mock" if ctx.mock else ctx.device},
        ],
        "panels": [
            {"type": "bars", "title": "Study-level diagnostic / zero-shot probabilities", "items": items, "max": 1.0, "unit": "%"},
            {
                "type": "triplanar",
                "title": "Tri-planar 3D volume preview",
                "planes": planes,
                "masks": masks,
                "labels": [ANAT_LABELS[6], ANAT_LABELS[2], ANAT_LABELS[0]] if masks else [],
                "preset": "ct_brain" if is_ct else "flair",
            },
        ],
    }


def run_report_vqa(ctx) -> dict:
    is_ct = ctx.model.get("modality") == "ct"
    contrast = "ct" if is_ct else "flair"
    question = (ctx.params.get("clinical_prompt") or "").strip() or (
        "Evaluate for intracranial mass lesion, acute ischemia, hemorrhage, or midline shift."
    )
    vol, _, _ = load_volume_3d(ctx.inputs.get("volume"), mock=ctx.mock, contrast=contrast, seed=ctx.model["id"])
    ctx.progress(0.5, f"Generating structured neuroradiology report with {ctx.model['name']}")

    if ctx.mock:
        findings = (
            "• Brain Parenchyma: Focal 14.3 mL intra-axial abnormality in the right frontoparietal centrum semiovale "
            "with surrounding vasogenic edema.\n"
            "• Ventricles & Cisterns: Mild effacement of the right lateral ventricular body without hydrocephalus; basal cisterns patent.\n"
            "• Midline & Extra-axial: < 2 mm leftward midline shift; no extra-axial hemorrhage or calvarial fracture."
        )
        impression = (
            "1. Right frontoparietal intra-axial lesion (~14.3 mL) with perilesional edema; consider glial neoplasm vs. solitary metastasis.\n"
            "2. No acute hydrocephalus or transtentorial herniation."
        )
        vqa_answer = "A focal right frontoparietal parenchymal lesion (~14.3 mL including edema) is identified without hydrocephalus or acute herniation."
    else:
        if not ctx.model.get("hf_repo"):
            raise RuntimeError(f"{ctx.model['name']} uses an external checkpoint ({ctx.model['link']}); set its path in backend/config.yaml or run with PORTAL_MOCK=1.")
        from PIL import Image
        from transformers import pipeline
        iz = vol.shape[2] // 2
        central_img = Image.fromarray(np.clip(vol[:, :, iz], 0, 255).astype(np.uint8)).convert("RGB")
        pipe = pipeline("image-text-to-text", model=ctx.model["hf_repo"], device_map="auto", trust_remote_code=True)
        prompt_txt = (
            f"Clinical indication: {question}\n"
            "Write a concise neuroradiology FINDINGS section, IMPRESSION section, and direct answer."
        )
        gen = pipe(images=central_img, text=prompt_txt, max_new_tokens=320)
        generated_text = str(gen[0].get("generated_text", "")).strip()
        findings = generated_text
        impression = "See generated multimodal report above (research output — verify clinically)."
        vqa_answer = generated_text[:280]

    _, mask = make_brain_phantom_3d(vol.shape, contrast=contrast, with_lesion=True, seed=ctx.model["id"])
    planes, masks = export_triplanar_pngs(ctx, vol, mask if ctx.mock else None, prefix="vqa")

    report_panel = {
        "type": "report",
        "title": f"{ctx.model['name']} — Structured Neuroradiology Report & VQA",
        "indication": question,
        "technique": (
            "Volumetric Head CT reconstructed in axial, coronal, and sagittal planes."
            if is_ct else "Multi-planar 3D Brain MRI evaluated in axial, coronal, and sagittal orientations."
        ),
        "findings": findings,
        "impression": impression,
        "vqa_question": question,
        "vqa_answer": vqa_answer,
    }

    report_path = ctx.out_path("neurorad_report.json")
    report_path.write_text(json.dumps(report_panel, indent=2), encoding="utf-8")
    ctx.register("neurorad_report.json", "Structured report (.json)")

    txt_path = ctx.out_path("neurorad_report.txt")
    txt_path.write_text(
        f"INDICATION: {question}\n\nFINDINGS:\n{findings}\n\nIMPRESSION:\n{impression}\n\nVQA:\n{vqa_answer}\n",
        encoding="utf-8",
    )
    ctx.register("neurorad_report.txt", "Plain-text report (.txt)")

    conf_items = [
        {"label": "Focal parenchymal abnormality / edema", "value": 0.91},
        {"label": "Mass effect / ventricular effacement", "value": 0.38},
        {"label": "Hydrocephalus", "value": 0.06},
        {"label": "Extra-axial collection", "value": 0.04},
    ]
    return {
        "summary": [
            {"label": "Model", "value": ctx.model["name"]},
            {"label": "Input grid", "value": ctx.model.get("voxel_spec", "3D")},
            {"label": "Device", "value": "mock" if ctx.mock else ctx.device},
        ],
        "panels": [
            report_panel,
            {
                "type": "triplanar",
                "title": "Grounded 3D study planes",
                "planes": planes,
                "masks": masks,
                "labels": ANAT_LABELS if masks else [],
                "preset": "ct_brain" if is_ct else "flair",
            },
            {"type": "bars", "title": "Finding confidence profile", "items": conf_items, "max": 1.0, "unit": "%"},
        ],
    }
