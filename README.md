# Brain Radiology FM Portal (`NeuroRad-FM`)

**Interactive Neuroradiology PACS Portal, Open-Access Brain MRI/CT/fMRI Dataset Explorer, Clinical Benchmark Leaderboards & Local GPU Server for 28 Open-Weight Brain Radiology & Neuroimaging Foundation Models.**

Brain Radiology FM Portal (`NeuroRad-FM`) is a privacy-first static GitHub Pages web workstation and local FastAPI GPU backend unifying **28 open-weight neuroimaging foundation models**, **18 curated open-access neuroimaging datasets**, and **8 clinical benchmark leaderboards** across 3D structural/mpMRI (`T1w`, `T1ce`, `T2w`, `FLAIR`, `DWI`), Head CT, PET, and 4D BOLD fMRI — including `NeuroVFM`, `Neuro-JEPA`, `BrainFound`, `BrainIAC`, `Brain2Vec`, `BrainSegFounder`, `SynthSeg 2.0`, `FastSurferVINN`, `VISTA3D`, `nnInteractive`, `BrainGemma3D`, `M3D-LaMed`, `BrainFM`, `BrainMorph`, `BrainLM`, and `BrainGFM`.

> **Privacy-first hybrid design**: `docs/` is a zero-build static web app published directly on GitHub Pages (complete with an in-browser **3D Analytical Brain Phantom Demo Mode**, Dataset Explorer, and Benchmark Leaderboards). When you are ready to run real `.nii` / `.nii.gz` or DICOM scans, start the lightweight FastAPI server in `backend/` on your own workstation, hospital research server, or cloud GPU — scans never leave your infrastructure.

---

## ✨ Key Capabilities

- **28 Open-Weight Neuroimaging Foundation Models across 5 Families**:
  1. **3D Volumetric Encoders (`vol_enc`, 8)**: `NeuroVFM Encoder` (*Nature Medicine 2026*), `Neuro-JEPA` (*NYU Langone, arXiv 2026*), `BrainFound` (*UCL, npj Imaging 2026*), `BrainIAC` (*Nature Neuroscience 2026*), `Brain2Vec` (*UPenn CBICA*), `NeuroFM` (*11M CPU-friendly*), `BrainMVP` (*CVPR missing-modality mpMRI*), `CT-FM` (*148K 3D CTs*).
  2. **Neuro Vision–Language & Diagnostic Triage (`vlm`, 9)**: `NeuroVFM-LLM`, `Brainfound` (*Tsinghua, Patterns 2026*), `NeuroVFM-Dx (Brain MRI)`, `NeuroVFM-Dx (Head CT)`, `BrainGemma3D (Brain3D)`, `M3D-LaMed (Phi-3-4B)`, `MedGemma-4B-IT`, `RadFM`, `BiomedCLIP`.
  3. **3D Parcellation & Lesion Segmentation (`seg`, 7)**: `BrainSegFounder` (*UK Biobank 3D SwinUNETR*), `SynthSeg 2.0` (*any-contrast MRI/CT parcellation*), `FastSurferVINN` (*sub-millimeter 95-class DKT*), `VISTA3D` (*MONAI*), `nnInteractive` (*DKFZ 3D promptable*), `MedSAM2`, `TotalSegmentator (Brain MRI & CT)`.
  4. **Cross-Modality Synthesis & 3D Registration (`morph`, 2)**: `BrainFM` (*JHU modality-agnostic T1↔T2↔FLAIR↔CT synthesis*), `BrainMorph` (*100K-scan keypoint diffeomorphic registration*).
  5. **4D fMRI & Connectome FMs (`fmri`, 2)**: `BrainLM (650M)` (*spatiotemporal ViTMAE*), `BrainGFM` (*cross-atlas brain graph FM*).
- **18 Open-Access Brain Radiology & Neuroimaging Datasets**:
  - **Brain Tumors & Neuro-Oncology**: `BraTS` (Adult Glioma, Meningioma, Mets & SSA), `UCSF-PDGM`, `UPenn-GBM`, `LUMIERE` (longitudinal RANO GBM).
  - **Acute Head CT, ICH & Stroke**: `RSNA Intracranial Hemorrhage (ICH) CT`, `CQ500`, `ISLES 2022` (acute DWI/FLAIR stroke), `ATLAS v2.0` (chronic T1w stroke).
  - **Neurodegeneration & Lifespan MRI**: `ADNI`, `OASIS-3 & OASIS-4`, `UK Biobank Brain Imaging`, `Mindboggle-101 & IXI`.
  - **FM Pretraining, VLM & Reconstruction**: `FOMO-MRI (FOMO60K / FOMO260K)`, `M3D-Data & M3D-VQA`, `fastMRI Brain & fastMRI+`.
  - **4D fMRI, Connectomics & Open BIDS**: `Human Connectome Project (HCP-YA & Lifespan)`, `OpenNeuro`, `ABIDE I & II`.
  - Includes searchable/filterable cards by category and access tier (*Direct Open Access*, *Free Registration / DUA*, *Credentialed / Managed*), cohort scale, format/size, CLI download commands (`idc-index`, `hf download`, `zenodo_get`, `openneuro-py`, `aws s3`), verified DOIs, and 1-click BibTeX / CSV export.
- **8 Clinical Neuroimaging Benchmarks & Visual Leaderboards**:
  - **BraTS Adult Glioma 3D Segmentation** (*Mean Dice*), **Acute Head CT Triage & ICH Detection** (*Macro AUROC*), **Whole-Brain 3D Anatomical Parcellation** (*Mean Dice*), **Lifespan BrainAge Estimation** (*MAE in years, ↓ better*), **Clinical Brain MRI Diagnosis & Neurodegeneration** (*ROC-AUC*), **Stroke Lesion 3D Segmentation (ATLAS / ISLES)** (*Mean Dice*), **3D Neuroradiology Reporting & Clinical VQA** (*Entity F1 / VQA Acc*), and **4D fMRI Brain-State & Cross-Atlas Decoding** (*AUC / Masked R²*) — plus an Open Neuroimaging Tooling & Standards directory. Click any model on a leaderboard to open its full specification drawer & CLI quickstart.
- **Interactive Tri-Planar PACS Lightbox**:
  - Simultaneous **Axial, Coronal, and Sagittal** views with radiology Window/Level presets (*Standard W/L*, *FLAIR / Edema*, *Head CT W80/L40*, *Stroke CT W40/L40*, *Inverted*), structure ROI isolation, mask opacity slider, hover voxel/structure readouts, and `.nii.gz` export compatible with **3D Slicer**, **ITK-SNAP**, and **FreeView**.
- **Hardware VRAM Fit Advisor, Side-by-Side Model Comparator & 46-Entry BibTeX Library**:
  - Auto-detects browser GPU/threads (or probes your local CUDA/MPS server), pins up to 4 models for side-by-side comparison, and provides a unified searchable **Papers & BibTeX** directory across all **28 Foundation Models + 18 Open Datasets (46 verified references)** with 1-click `.bib` and `.csv` export.

---

## 🚀 Quickstart

### 1. Run Locally (Static UI + FastAPI Backend)

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
│   ├── index.html                 # 7-tab UI: Models, Datasets, Benchmarks, Run, Results, Papers, Connect
│   ├── models.json                # Single source of truth: 28 models, 18 datasets, 8 benchmarks
│   ├── .nojekyll                  # Bypass Jekyll on GitHub Pages
│   └── assets/
│       ├── style.css              # Lightbox & PACS Darkroom theme
│       ├── viewers.js             # Tri-planar NIfTI slice viewer, report card, PCA, matrices
│       ├── hardware.js            # Browser WebGL/WebGPU + server VRAM fit advisor
│       ├── demo.js                # In-browser 128³ analytical 3D brain phantom generator
│       └── app.js                 # Catalogue filters, compare dock, Datasets, Benchmarks, Papers/BibTeX, job client
├── backend/                       # Local / remote GPU FastAPI inference server
│   ├── server.py                  # REST API (/api/models, /api/datasets, /api/benchmarks, /api/jobs) + CORS/PNA
│   ├── config.py / config.example.yaml
│   ├── hardware.py                # nvidia-smi + torch.cuda + MPS + RAM detector
│   ├── weights.py                 # Hugging Face cache & gated access manager
│   ├── jobs.py                    # Single-GPU sequential worker & measured VRAM logger
│   ├── runners/                   # Task runners (vol_embed, neuro_vlm, segment3d, morph_synth, fmri_decode)
│   └── tests/test_api_mock.py     # Pytest suite verifying 28 models × tasks, 18 datasets & 8 benchmarks
├── .github/workflows/             # Automated GitHub Pages deployment & CI pytest
├── SETUP.md                       # Detailed GPU, BIDS/NIfTI, and gated HF setup guide
└── LICENSE                        # MIT License (portal code)
```

---

## ⚠️ Disclaimer

**Research Use Only.** Neither this portal nor the underlying open-weight models are cleared or approved for clinical diagnostic use or patient management. Always strip Protected Health Information (PHI) from DICOM headers (e.g., via `dcm2niix -ba y`) and verify each model's licence before use.
Created and curated by Prajwal Ghimire
Copyright @Prajwal Ghimire
Contact: prajwal.ghimire@crick.ac.uk

---

<!-- PRAZG_SUITE_README_START -->
## Open Neuro & Pathology AI Suite

Part of the open-access neurosurgery, neuroimaging, neuro-oncology, and computational pathology web suite by [@prazg](https://github.com/prazg):

| Tool | Live App | Repository | Focus |
|---|---|---|---|
| **NeuroScope-RANO** | [Open App](https://prazg.github.io/neuroscope-rano/) | [`prazg/neuroscope-rano`](https://github.com/prazg/neuroscope-rano) | Zero-upload NIfTI MRI volumetrics, RANO 2.0, RANO-Resect (EOR) & AI segmentation QA |
| **OpenNeuroAtlas** | [Open App](https://prazg.github.io/openneuroatlas/) | [`prazg/openneuroatlas`](https://github.com/prazg/openneuroatlas) | Living registry of 44 open neurosurgery & neuroimaging datasets, foundation models & MICCAI benchmarks |
| **CNS5-Audit** | [Open App](https://prazg.github.io/cns5-audit/) | [`prazg/cns5-audit`](https://github.com/prazg/cns5-audit) | WHO CNS5 (2021) classifier, RANO 2.0 / RANO-BM / RANO-Resect calculators & CLAIM/TRIPOD+AI leakage auditor |
| **NeuroCorridor-3D** | [Open App](https://prazg.github.io/neurocorridor-3d/) | [`prazg/neurocorridor-3d`](https://github.com/prazg/neurocorridor-3d) | Interactive 3D MNI-152 eloquent neuroanatomy, white-matter tractography & surgical corridor sandbox |
| **3D Neurosurgical Atlas** | [Open App](https://prazg.github.io/3D_Neurosurgical_Atlas/) | [`prazg/3D_Neurosurgical_Atlas`](https://github.com/prazg/3D_Neurosurgical_Atlas) | Interactive browser-based 3D atlas of craniospinal anatomy, 76 walkthroughs & neuro-oncological pathology |
| **Brain Trials Finder** | [Open App](https://prazg.github.io/brain_trials_finder/) | [`prazg/brain_trials_finder`](https://github.com/prazg/brain_trials_finder) | Discovers actively recruiting neuro-oncology clinical trials across ClinicalTrials.gov, ISRCTN, EU CTIS & WHO ICTRP |
| **Brain Radiology FM** *(this repo)* | [Open App](https://prazg.github.io/Brain_Radiology_FM_Portal/) | [`prazg/Brain_Radiology_FM_Portal`](https://github.com/prazg/Brain_Radiology_FM_Portal) | Interactive PACS portal, 18 neuroimaging datasets, 8 benchmarks & GPU runner for 28 open-weight 3D Brain MRI, Head CT & fMRI FMs |
| **Lung Radiology FM** | [Open App](https://prazg.github.io/Lung_Radiology_FM_Portal/) | [`prazg/Lung_Radiology_FM_Portal`](https://github.com/prazg/Lung_Radiology_FM_Portal) | Interactive Thoracic PACS portal, 18 lung cancer datasets, 8 benchmarks & GPU runner for 33 open-weight lung & thoracic FMs |
| **Histology FM** | [Open App](https://prazg.github.io/Histology_FM_Portal/) | [`prazg/Histology_FM_Portal`](https://github.com/prazg/Histology_FM_Portal) | Graphical frontend & GPU runner for 55 open-weight clinical & preclinical histology foundation models |
| **Animal Pathology FM** | [Open App](https://prazg.github.io/Animal_Pathology_FM_Portal/) | [`prazg/Animal_Pathology_FM_Portal`](https://github.com/prazg/Animal_Pathology_FM_Portal) | Frontend & local runner for open-weight preclinical, rodent & veterinary pathology foundation models |
| **Remote DICOM Viewer** | [Open App](https://prazg.github.io/Remote_Dicom_Viewer/) | [`prazg/Remote_Dicom_Viewer`](https://github.com/prazg/Remote_Dicom_Viewer) | Secure browser-based DICOM viewer for sending scans for remote radiological reporting |

<!-- PRAZG_SUITE_README_END -->
