"""Shared 3D NIfTI / DICOM I/O, analytical brain phantom generator, and tri-planar PNG exporters."""
from __future__ import annotations

import csv
import gzip
import hashlib
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

ANAT_LABELS = [
    {"id": 1, "name": "Cerebral Cortex (GM)",     "color": "#38bdf8"},
    {"id": 2, "name": "Cerebral White Matter",    "color": "#a78bfa"},
    {"id": 3, "name": "Lateral Ventricles (CSF)", "color": "#2dd4bf"},
    {"id": 4, "name": "Thalamus & Basal Ganglia", "color": "#fbbf24"},
    {"id": 5, "name": "Hippocampus & Amygdala",   "color": "#34d399"},
    {"id": 6, "name": "Brainstem & Cerebellum",   "color": "#fb7185"},
    {"id": 7, "name": "Focal Lesion / Edema ROI", "color": "#f97316"},
]


def rng_for(seed_str: str) -> np.random.Generator:
    digest = hashlib.sha256(seed_str.encode("utf-8")).digest()
    seed = int.from_bytes(digest[:8], "little")
    return np.random.default_rng(seed)


def make_brain_phantom_3d(
    shape: Tuple[int, int, int] = (96, 96, 96),
    contrast: str = "t1",
    with_lesion: bool = True,
    seed: str = "phantom",
) -> Tuple[np.ndarray, np.ndarray]:
    """Generate an analytical 3D brain MRI/CT volume (float32 0..255) and 7-class uint8 label mask."""
    r = rng_for(seed)
    nx, ny, nz = shape
    u = np.linspace(-1.0, 1.0, nx, dtype=np.float32)[:, None, None]
    v = np.linspace(-1.0, 1.0, ny, dtype=np.float32)[None, :, None]
    w = np.linspace(-1.0, 1.0, nz, dtype=np.float32)[None, None, :]

    brain_ell = (u / 0.72) ** 2 + (v / 0.86) ** 2 + ((w - 0.05) / 0.74) ** 2
    skull_ell = (u / 0.79) ** 2 + (v / 0.93) ** 2 + ((w - 0.05) / 0.81) ** 2
    cereb_ell = (u / 0.52) ** 2 + ((v + 0.36) / 0.36) ** 2 + ((w + 0.48) / 0.28) ** 2
    stem_ell = (u / 0.15) ** 2 + ((v + 0.12) / 0.16) ** 2 + ((w + 0.48) / 0.42) ** 2

    vol = np.full(shape, 6.0, dtype=np.float32)
    mask = np.zeros(shape, dtype=np.uint8)

    inside_brain = (brain_ell <= 1.0) | (cereb_ell <= 1.0) | (stem_ell <= 1.0)
    calvarium = (skull_ell <= 1.0) & (~inside_brain)
    vol[calvarium] = 236.0 if contrast == "ct" else 26.0

    gyri = 0.06 * np.sin(13.0 * u + 2.0 * np.cos(9.0 * v)) * np.cos(11.0 * v + 1.7 * np.sin(10.0 * w))
    wm_region = inside_brain & ((brain_ell + gyri) < 0.74)

    gm_val = 138.0 if contrast == "t1" else (158.0 if contrast == "flair" else (128.0 if contrast == "ct" else 168.0))
    wm_val = 188.0 if contrast == "t1" else (126.0 if contrast == "flair" else (108.0 if contrast == "ct" else 134.0))

    vol[inside_brain] = gm_val
    mask[inside_brain] = 1
    vol[wm_region] = wm_val
    mask[wm_region] = 2

    # Cerebellum & brainstem
    cb = (cereb_ell <= 1.0) | (stem_ell <= 1.0)
    vol[cb] = (118.0 if contrast == "ct" else 146.0)
    mask[cb] = 6

    # Thalamus / basal ganglia
    deep = (((np.abs(u) - 0.19) / 0.11) ** 2 + ((v + 0.02) / 0.22) ** 2 + (w / 0.14) ** 2) < 1.0
    vol[deep] = 124.0 if contrast == "ct" else 150.0
    mask[deep] = 4

    # Hippocampus & amygdala
    hippo = (((np.abs(u) - 0.24) / 0.08) ** 2 + ((v + 0.08) / 0.18) ** 2 + ((w + 0.24) / 0.09) ** 2) < 1.0
    vol[hippo] = 120.0 if contrast == "ct" else 144.0
    mask[hippo] = 5

    # Lateral ventricles & midline CSF
    vent = ((((np.abs(u) - 0.13) / 0.10) ** 2 + ((v + 0.02 - 0.18 * np.abs(u)) / 0.34) ** 2 + ((w - 0.08) / 0.16) ** 2) < 1.0) & (np.abs(u) > 0.025)
    fissure = inside_brain & (np.abs(u) < 0.025) & (w > -0.18) & (v > -0.65)
    csf = vent | fissure
    vol[csf] = 36.0 if contrast == "ct" else (28.0 if contrast == "t1" else 42.0)
    mask[csf] = 3

    if with_lesion:
        lx = 0.27 + float(r.uniform(-0.03, 0.03))
        ly = -0.10 + float(r.uniform(-0.03, 0.03))
        lz = 0.12
        dles = ((u - lx) / 0.16) ** 2 + ((v - ly) / 0.18) ** 2 + ((w - lz) / 0.15) ** 2
        les = inside_brain & (dles < 1.0)
        core = inside_brain & (dles < 0.32)
        if contrast == "flair":
            vol[les] = 210.0
            vol[core] = 236.0
        elif contrast == "ct":
            vol[les] = 92.0
            vol[core] = 205.0
        else:
            vol[les] = 124.0
            vol[core] = 88.0
        mask[les] = 7

    noise = r.normal(0.0, 3.2, size=shape).astype(np.float32)
    vol = np.clip(vol + noise, 0.0, 255.0)
    return vol, mask


def load_volume_3d(
    path: Optional[str],
    mock: bool = False,
    contrast: str = "t1",
    seed: str = "vol",
) -> Tuple[np.ndarray, Tuple[float, float, float], Optional[np.ndarray]]:
    """Load a 3D NIfTI (.nii / .nii.gz), DICOM series, or 2D slice into RAS+ float32 array (0..255).
    Returns (vol_3d, spacing_mm, affine_or_none)."""
    if path:
        p = Path(path)
        name_l = p.name.lower()
        if name_l.endswith((".nii", ".nii.gz")):
            try:
                import nibabel as nib
                img = nib.as_closest_canonical(nib.load(str(p)))
                data = np.asarray(img.dataobj, dtype=np.float32)
                if data.ndim == 4:
                    data = data[..., 0]
                zooms = tuple(float(z) for z in img.header.get_zooms()[:3])
                lo, hi = np.percentile(data, [1.0, 99.5])
                norm = np.clip((data - lo) / max(1e-5, hi - lo), 0.0, 1.0) * 255.0
                return norm.astype(np.float32), zooms, img.affine
            except Exception:
                if not mock:
                    raise
        if p.is_file() and name_l.endswith((".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp")):
            sl = np.asarray(Image.open(p).convert("L").resize((128, 128)), dtype=np.float32)
            # Stack 2D radiological slice into a thin pseudo-volume so 3D pipelines work seamlessly
            vol = np.repeat(sl[:, :, None], 32, axis=2)
            return vol, (1.0, 1.0, 3.0), np.eye(4, dtype=np.float32)
        if p.exists() and not mock:
            try:
                import SimpleITK as sitk
                if p.is_dir():
                    reader = sitk.ImageSeriesReader()
                    series = reader.GetGDCMSeriesFileNames(str(p))
                    reader.SetFileNames(series)
                    simg = reader.Execute()
                else:
                    simg = sitk.ReadImage(str(p))
                arr = np.transpose(sitk.GetArrayFromImage(simg).astype(np.float32), (2, 1, 0))
                sp = tuple(float(s) for s in simg.GetSpacing()[:3])
                lo, hi = np.percentile(arr, [1.0, 99.5])
                norm = np.clip((arr - lo) / max(1e-5, hi - lo), 0.0, 1.0) * 255.0
                return norm, sp, np.eye(4, dtype=np.float32)
            except Exception:
                if not mock:
                    raise

    vol, _ = make_brain_phantom_3d((96, 96, 96), contrast=contrast, with_lesion=True, seed=seed)
    return vol, (1.0, 1.0, 1.0), np.eye(4, dtype=np.float32)


def _save_slice_png(slice_2d: np.ndarray, out_path: Path, size: int = 160, nearest: bool = False) -> None:
    u8 = np.clip(np.rint(slice_2d), 0, 255).astype(np.uint8)
    # Orient slice upright for display (anterior/superior at top)
    im = Image.fromarray(np.rot90(u8))
    resample = Image.Resampling.NEAREST if nearest else Image.Resampling.BILINEAR
    im = im.resize((size, size), resample=resample)
    im.save(out_path, format="PNG")


def export_triplanar_pngs(
    ctx,
    vol: np.ndarray,
    mask: Optional[np.ndarray] = None,
    prefix: str = "scan",
) -> Tuple[Dict[str, str], Optional[Dict[str, str]]]:
    """Export Axial, Coronal, and Sagittal PNG planes (and optional uint8 label masks)."""
    nx, ny, nz = vol.shape
    ix = int(nx * 0.62) if mask is not None and np.any(mask == 7) else nx // 2
    iy = int(ny * 0.46)
    iz = int(nz * 0.56)

    planes = {
        "axial":    f"{prefix}_axial.png",
        "coronal":  f"{prefix}_coronal.png",
        "sagittal": f"{prefix}_sagittal.png",
    }
    _save_slice_png(vol[:, :, iz], ctx.out_path(planes["axial"]))
    _save_slice_png(vol[:, iy, :], ctx.out_path(planes["coronal"]))
    _save_slice_png(vol[ix, :, :], ctx.out_path(planes["sagittal"]))

    if mask is None:
        return planes, None

    masks = {
        "axial":    f"{prefix}_mask_axial.png",
        "coronal":  f"{prefix}_mask_coronal.png",
        "sagittal": f"{prefix}_mask_sagittal.png",
    }
    _save_slice_png(mask[:, :, iz], ctx.out_path(masks["axial"]), nearest=True)
    _save_slice_png(mask[:, iy, :], ctx.out_path(masks["coronal"]), nearest=True)
    _save_slice_png(mask[ix, :, :], ctx.out_path(masks["sagittal"]), nearest=True)
    return planes, masks


def save_nifti(arr: np.ndarray, out_path: Path, affine: Optional[np.ndarray] = None) -> str:
    """Save a 3D array as `.nii.gz` via nibabel (or fallback compressed NIfTI-1 binary header)."""
    aff = affine if affine is not None else np.eye(4, dtype=np.float32)
    try:
        import nibabel as nib
        img = nib.Nifti1Image(arr, aff)
        nib.save(img, str(out_path))
        return out_path.name
    except ImportError:
        # Minimal valid 352-byte NIfTI-1 header + voxel payload so .nii.gz download always succeeds
        data = np.asarray(arr, dtype=np.float32 if arr.dtype.kind == "f" else np.uint8)
        hdr = bytearray(352)
        hdr[0:4] = (348).to_bytes(4, "little")
        nd = data.ndim
        hdr[40:42] = nd.to_bytes(2, "little")
        for idx, d in enumerate(data.shape[:3]):
            hdr[42 + idx * 2:44 + idx * 2] = int(d).to_bytes(2, "little")
        dtype_code = 16 if data.dtype == np.float32 else 2
        bitpix = 32 if data.dtype == np.float32 else 8
        hdr[70:72] = dtype_code.to_bytes(2, "little")
        hdr[72:74] = bitpix.to_bytes(2, "little")
        hdr[108:112] = np.float32(352.0).tobytes()
        hdr[344:348] = b"n+1\x00"
        with gzip.open(out_path, "wb") as gz:
            gz.write(hdr)
            gz.write(data.tobytes(order="F"))
        return out_path.name


def write_csv(path: Path, header: List[str], rows: List[list]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def pca_2d(mat: np.ndarray) -> np.ndarray:
    """Project an N×D embedding matrix onto its top 2 principal components via SVD."""
    if len(mat) == 1:
        return np.zeros((1, 2), dtype=np.float32)
    centered = mat - mat.mean(axis=0, keepdims=True)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    comps = vt[:2]
    if len(comps) < 2:
        comps = np.vstack([comps, np.zeros((1, mat.shape[1]), dtype=mat.dtype)])
    return (centered @ comps.T).astype(np.float32)
