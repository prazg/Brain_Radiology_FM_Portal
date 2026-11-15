# Brain Radiology FM Portal (`NeuroRad-FM`)

Brain Radiology FM Portal (NeuroRad-FM) is a privacy-first web workstation and local FastAPI GPU backend unifying 28 open-weight neuroimaging foundation models across 3D structural/mpMRI (T1w, T1ce, T2w, FLAIR, DWI), Head CT, PET, and 4D BOLD fMRI — including NeuroVFM, Neuro-JEPA, BrainFound, BrainIAC, Brain2Vec, BrainSegFounder, SynthSeg 2.0, VISTA3D, nnInteractive, BrainGemma3D, M3D-LaMed, BrainFM, and BrainLM. The static GitHub Pages frontend includes an in-browser 3D analytical brain phantom demo, an interactive tri-planar PACS lightbox with radiology Window/Level presets and .nii.gz export, hardware-fit advice, and a searchable directory of verified DOIs, preprints, benchmarks, and one-click BibTeX citations.

An open-source, GitHub Pages-ready graphical workstation and local GPU inference server for **28 open-weight Brain Radiology & Neuroimaging Foundation Models** spanning **3D structural & multi-parametric Brain MRI (`T1w`, `T1ce`, `T2w`, `FLAIR`, `DWI`), non-contrast Head CT, PET, and 4D BOLD fMRI / connectomics** — with verified paper links, one-click BibTeX citations, hardware-fit guidance, and an interactive tri-planar PACS viewer.

> **Privacy-first hybrid design**: `docs/` is a zero-build static web app you can publish directly on GitHub Pages (complete with an in-browser **3D Analytical Brain Phantom Demo Mode**). When you are ready to run real `.nii` / `.nii.gz` or DICOM scans, start the lightweight FastAPI server in `backend/` on your own workstation, hospital research server, or cloud GPU — scans never leave your infrastructure.

---

## ✨ Key Capabilities

- **28 Open-Weight Neuroimaging Foundation Models across 5 Families**:
  1. **3D Volumetric Encoders (`vol_enc`)**: `NeuroVFM Encoder` (*Nature Medicine 2026*), `Neuro-JEPA` (*NYU Langone, arXiv 2026*), `BrainFound` (*UCL, npj Imaging 2026*), `BrainIAC` (*Nature Neuroscience 2026*), `Brain2Vec` (*UPenn CBICA*), `NeuroFM` (*11M CPU-friendly*), `BrainMVP` (*CVPR missing-modality mpMRI*), `CT-FM` (*148K 3D CTs*).
  2. **Neuro Vision–Language & Diagnostic Triage (`vlm`)**: `NeuroVFM-LLM`, `Brainfound` (*Tsinghua, Patterns 2026*), `NeuroVFM-Dx (Brain MRI)`, `NeuroVFM-Dx (Head CT)`, `BrainGemma3D (Brain3D)`, `M3D-LaMed (Phi-3-4B)`, `MedGemma-4B-IT`, `RadFM`, `BiomedCLIP`.
  3. **3D Parcellation & Lesion Segmentation (`seg`)**: `BrainSegFounder` (*UK Biobank 3D SwinUNETR*), `SynthSeg 2.0` (*any-contrast MRI/CT parcellation*), `FastSurferVINN` (*sub-millimeter 95-class DKT*), `VISTA3D` (*MONAI*), `nnInteractive` (*DKFZ 3D promptable*), `MedSAM2`, `TotalSegmentator (Brain MRI & CT)`.
  4. **Cross-Modality Synthesis & 3D Registration (`morph`)**: `BrainFM` (*JHU modality-agnostic T1↔T2↔FLAIR↔CT synthesis*), `BrainMorph` (*100K-scan keypoint diffeomorphic registration*).
  5. **4D fMRI & Connectome FMs (`fmri`)**: `BrainLM (650M)` (*spatiotemporal ViTMAE*), `BrainGFM` (*cross-atlas brain graph FM*).
- **Interactive Tri-Planar PACS Lightbox**:
  - Simultaneous **Axial, Coronal, and Sagittal** views with radiology Window/Level presets (*Standard W/L*, *FLAIR / Edema*, *Head CT W80/L40*, *Stroke CT W40/L40*, *Inverted*), structure ROI isolation, mask opacity slider, hover voxel/structure readouts, and `.nii.gz` export compatible with **3D Slicer**, **ITK-SNAP**, and **FreeView**.
- **Structured Neuroradiology Reporting & Triage**:
  - Dedicated clinical report viewer (`INDICATION`, `TECHNIQUE`, `FINDINGS`, `IMPRESSION`, and grounded `VQA`) plus curated neuroradiology prompt presets (*Acute Head CT Hemorrhage & Stroke Triage*, *Glioma / Metastasis / Demyelination*, *Neurodegeneration AD / MCI*, *Sequence Identification*).
- **Papers, BibTeX & Benchmarks Directory**:
  - Searchable publication table with direct DOI / arXiv / medRxiv links, 1-click BibTeX copy, 8 major neuroimaging benchmarks (`BraTS`, `FOMO-MRI`, `ATLAS v2.0 & ISLES`, `RSNA ICH & CQ500`, `ADNI / OASIS / OpenNeuro`, `UK Biobank & HCP`, `M3D-Bench & RadBench`, `fastMRI Brain`), and ecosystem references (`MONAI`, `FreeSurfer 8`, `Med-Gemini-3D`).

---

## 🚀 Quickstart

### 1. Publish on GitHub Pages (Zero Build Step)

1. Push this repository to GitHub.
2. Go to **Settings → Pages**:
   - **Option A (GitHub Actions — included)**: Choose **Source: GitHub Actions** (uses `.github/workflows/pages.yml`).
   - **Option B (Branch deploy)**: Choose **Deploy from a branch** → Branch `main` → Folder `/docs`.
3. Open your published URL — **Interactive Demo Mode** works immediately in the browser with no GPU required!

### 2. Run Locally (Static UI + FastAPI Backend)

```bash
# Terminal 1 — Serve the static frontend
cd docs
python -m http.server 5500
```

```bash
# Terminal 2 — Start the backend (mock 3D phantom mode or real GPU mode)
cd backend
pip install -r requirements-server.txt        # lightweight server + NIfTI support
# pip install -r requirements.txt             # full PyTorch + MONAI + HF inference
cp config.example.yaml config.yaml
PORTAL_MOCK=1 python -m uvicorn server:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:5500`, click **Connect**, select **My GPU server** (`http://127.0.0.1:8000`), and run any of the 28 models. See [`SETUP.md`](SETUP.md) for CUDA, gated Hugging Face tokens, and external tool (`SynthSeg`, `FastSurfer`, `TotalSegmentator`, `BrainFound`) configuration.

---

## 📂 Repository Layout

```text
Brain_Radiology_FM_Portal/
├── docs/                          # Static GitHub Pages web workstation (no build step)
│   ├── index.html                 # 5-tab UI: Models, Run, Results, Papers, Connect
│   ├── models.json                # Single source of truth: 28 models, 7 tasks, 8 benchmarks
│   ├── .nojekyll                  # Bypass Jekyll on GitHub Pages
│   └── assets/
│       ├── style.css              # Lightbox & PACS Darkroom theme
│       ├── viewers.js             # Tri-planar NIfTI slice viewer, report card, PCA, matrices
│       ├── hardware.js            # Browser WebGL/WebGPU + server VRAM fit advisor
│       ├── demo.js                # In-browser 128³ analytical 3D brain phantom generator
│       └── app.js                 # Catalogue filters, drawer, Papers/BibTeX, job queue client
├── backend/                       # Local / remote GPU FastAPI inference server
│   ├── server.py                  # REST API + CORS / Private-Network-Access middleware
│   ├── config.py / config.example.yaml
│   ├── hardware.py                # nvidia-smi + torch.cuda + MPS + RAM detector
│   ├── weights.py                 # Hugging Face cache & gated access manager
│   ├── jobs.py                    # Single-GPU sequential worker & measured VRAM logger
│   ├── runners/                   # Task runners (vol_embed, neuro_vlm, segment3d, morph_synth, fmri_decode)
│   └── tests/test_api_mock.py     # Pytest suite verifying all 28 models × tasks
├── .github/workflows/             # Automated GitHub Pages deployment & CI pytest
├── SETUP.md                       # Detailed GPU, BIDS/NIfTI, and gated HF setup guide
└── LICENSE                        # MIT License (portal code)
```

---

## ⚠️ Disclaimer

**Research Use Only.** Neither this portal nor the underlying open-weight models are cleared or approved for clinical diagnostic use or patient management. Always strip Protected Health Information (PHI) from DICOM headers (e.g., via `dcm2niix -ba y`) and verify each model's licence before use.
