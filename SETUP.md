# Detailed Setup Guide — Brain Radiology FM Portal

This guide covers setting up the `backend/` GPU inference server on Windows, Linux, or macOS and connecting it to the GitHub Pages (or local) frontend.

---

## 1. Python & CUDA Environment

Create a dedicated Python 3.10–3.12 environment:

```bash
conda create -n neurorad-fm python=3.11 -y
conda activate neurorad-fm
```

Install a **CUDA-enabled PyTorch** build matching your NVIDIA driver (check `nvidia-smi` first):

```bash
# Example for CUDA 12.4 (visit https://pytorch.org/get-started/locally/ for your platform)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124

# Install neuroimaging & Hugging Face dependencies
cd backend
pip install -r requirements.txt
```

> **Quick wiring test without PyTorch or weights**:
> ```bash
> pip install -r requirements-server.txt
> PORTAL_MOCK=1 python -m uvicorn server:app --host 127.0.0.1 --port 8000
> ```

---

## 2. Configure `backend/config.yaml`

Copy the example configuration:

```bash
cp config.example.yaml config.yaml
```

Key settings in `backend/config.yaml`:

- **`portal_key`**: Set a strong passphrase whenever binding outside `127.0.0.1` or using a tunnel. Enter the same key under **Connect → Portal key** in the web UI.
- **`allowed_scan_roots`**: List local BIDS / NIfTI directories that the server is permitted to read when you choose **Path on server** (prevents arbitrary filesystem traversal):
  ```yaml
  allowed_scan_roots:
    - /data/neuro/BIDS_Cohort
    - D:/Datasets/BraTS2024
  ```
- **`origins`**: Restrict to your GitHub Pages origin (e.g. `https://<username>.github.io`) in multi-user environments.

---

## 3. Gated Hugging Face Neuroimaging Models

Twenty-two of the 28 models are ungated, while clinical health-system models (`mlinslab/neurovfm-*`, `NYUMedML/Neuro-JEPA`, `cbica/Brain2Vec`, `google/medgemma-4b-it`) require accepting terms on Hugging Face:

1. Click the model card link in the portal drawer and accept the licence on Hugging Face.
2. Authenticate on the GPU server once:
   ```bash
   hf auth login
   ```
   *(Alternatively, paste a read-only `hf_...` token into the **Connect** tab — it is held in browser `sessionStorage` only for the active tab.)*
3. Under **Connect → Model weights on this server**, click **Check gated HF access** or **Download** to pre-stage weights into `~/.cache/huggingface/hub`.

---

## 4. Optional External Neuroimaging Suites

Most models download automatically from Hugging Face. For specialized standalone packages, configure them as follows:

| Model | Installation / `config.yaml` key |
|---|---|
| **TotalSegmentator** (`totalseg_mri`) | `pip install TotalSegmentator` (weights auto-download into `~/.totalsegmentator`) |
| **SynthSeg 2.0** (`synthseg`) | Install FreeSurfer 7.4+ (`mri_synthseg` on `PATH`) or clone `BBillot/SynthSeg` and set `synthseg_repo` |
| **FastSurferVINN** (`fastsurfer_vinn`) | Clone `Deep-MI/FastSurfer` and set `fastsurfer_repo` (or use `deepmi/fastsurfer` Docker) |
| **BrainMVP** (`brainmvp`) | Download `BrainMVP_pretrained.pt` from `shaohao011/BrainMVP` and set `brainmvp_ckpt` |
| **BrainFound (UCL)** (`brainfound_ucl`) | Clone `Moona-Mazher/BrainFound` and set `brainfound_ucl_ckpt` |
| **Brainfound (Tsinghua)** (`brainfound_mm`) | Clone `gingerbread000/Brainfound` and set `brainfound_mm_ckpt` |
| **BrainFM** (`brainfm_jhu`) | Clone `jhuldr/BrainFM` and set `brainfm_repo` |
| **BrainMorph** (`brainmorph`) | Clone `alanqrwang/brainmorph` and set `brainmorph_repo` |

---

## 5. Connecting a Remote Hospital / HPC GPU Node

If your GPU lives on an SSH cluster node while you browse the portal on your laptop:

```bash
# On the GPU node:
cd Brain_Radiology_FM_Portal/backend
python -m uvicorn server:app --host 127.0.0.1 --port 8000

# On your laptop:
ssh -N -L 8000:127.0.0.1:8000 user@gpu-cluster.institution.edu
```

Then leave **Backend URL** set to `http://127.0.0.1:8000` in the portal — modern browsers permit `https://<you>.github.io` to connect to `http://127.0.0.1:8000` via Private Network Access headers already configured in `server.py`.
