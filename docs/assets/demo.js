/* Demo mode — generates an analytical 3D neuroimaging brain phantom and synthetic
 * task outputs directly in the browser (matching the exact FastAPI backend schema)
 * so researchers can explore all 28 models & 7 tasks on GitHub Pages before connecting a GPU. */
(function () {
  "use strict";

  function rng(seed) {
    let s = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) s = Math.imul(s ^ seed.charCodeAt(i), 16777619) >>> 0;
    return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0) / 4294967296);
  }
  function randn(r) { return Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r()); }

  const ANAT_LABELS = [
    { id: 1, name: "Cerebral Cortex (GM)",     color: "#38bdf8", mm3: 486200, icv: 33.4 },
    { id: 2, name: "Cerebral White Matter",    color: "#a78bfa", mm3: 431800, icv: 29.7 },
    { id: 3, name: "Lateral Ventricles (CSF)", color: "#2dd4bf", mm3: 28450,  icv: 1.96 },
    { id: 4, name: "Thalamus & Basal Ganglia", color: "#fbbf24", mm3: 34920,  icv: 2.40 },
    { id: 5, name: "Hippocampus & Amygdala",   color: "#34d399", mm3: 8340,   icv: 0.57 },
    { id: 6, name: "Brainstem & Cerebellum",   color: "#fb7185", mm3: 149600, icv: 10.28 },
    { id: 7, name: "Focal Lesion / Edema ROI", color: "#f97316", mm3: 14280,  icv: 0.98 }
  ];

  function buildPhantomEvaluator(seed, opts = {}) {
    const r = rng(seed);
    const mode = opts.contrast || "t1"; // t1 | flair | ct | synth
    const withLesion = opts.lesion !== false;
    const lx = 0.28 + (r() - 0.5) * 0.08, ly = -0.10 + (r() - 0.5) * 0.08, lz = 0.12;

    function voxelAt(u, v, w) {
      const brainEll = (u * u) / (0.72 * 0.72) + (v * v) / (0.86 * 0.86) + ((w - 0.05) * (w - 0.05)) / (0.74 * 0.74);
      const skullEll = (u * u) / (0.79 * 0.79) + (v * v) / (0.93 * 0.93) + ((w - 0.05) * (w - 0.05)) / (0.81 * 0.81);
      const cerebEll = (u * u) / (0.52 * 0.52) + ((v + 0.36) * (v + 0.36)) / (0.36 * 0.36) + ((w + 0.48) * (w + 0.48)) / (0.28 * 0.28);
      const stemEll  = (u * u) / (0.15 * 0.15) + ((v + 0.12) * (v + 0.12)) / (0.16 * 0.16) + ((w + 0.48) * (w + 0.48)) / (0.42 * 0.42);

      if (skullEll > 1.0 && cerebEll > 1.0 && stemEll > 1.0) return { val: 6, label: 0 };

      if (brainEll > 1.0 && cerebEll > 1.0 && stemEll > 1.0) {
        const bone = mode === "ct" ? 238 : 26;
        return { val: bone, label: 0 };
      }

      const gyri = 0.065 * Math.sin(13 * u + 2.1 * Math.cos(9 * v)) * Math.cos(11 * v + 1.8 * Math.sin(10 * w));
      const fissure = Math.abs(u) < 0.028 && w > -0.18 && v > -0.65;
      if (fissure) return { val: mode === "t1" ? 34 : mode === "ct" ? 42 : 48, label: 3 };

      const ventL = ((Math.abs(u) - 0.13) / 0.10) ** 2 + ((v + 0.02 - 0.18 * Math.abs(u)) / 0.34) ** 2 + ((w - 0.08) / 0.16) ** 2;
      if (ventL < 1.0 && Math.abs(u) > 0.025) {
        return { val: mode === "t1" ? 28 : mode === "ct" ? 36 : 38, label: 3 };
      }

      if (withLesion) {
        const dLes = ((u - lx) / 0.16) ** 2 + ((v - ly) / 0.18) ** 2 + ((w - lz) / 0.15) ** 2;
        if (dLes < 1.0) {
          const core = dLes < 0.32;
          const lVal = mode === "flair" ? (core ? 236 : 212)
                     : mode === "ct"    ? (core ? 205 : 92)
                     : mode === "synth" ? (core ? 228 : 196)
                     : (core ? 86 : 124);
          return { val: lVal, label: 7 };
        }
      }

      const deepG = ((Math.abs(u) - 0.19) / 0.11) ** 2 + ((v + 0.02) / 0.22) ** 2 + ((w - 0.0) / 0.14) ** 2;
      if (deepG < 1.0) {
        return { val: mode === "t1" ? 148 : mode === "ct" ? 124 : 156, label: 4 };
      }

      const hippo = ((Math.abs(u) - 0.24) / 0.08) ** 2 + ((v + 0.08) / 0.18) ** 2 + ((w + 0.24) / 0.09) ** 2;
      if (hippo < 1.0) {
        return { val: mode === "t1" ? 142 : mode === "ct" ? 120 : 162, label: 5 };
      }

      if (cerebEll <= 1.0 || stemEll <= 1.0) {
        const folia = 10 * Math.sin(24 * w) * Math.cos(18 * u);
        return { val: (mode === "ct" ? 118 : 146) + folia, label: 6 };
      }

      const wmBoundary = brainEll + gyri;
      if (wmBoundary < 0.74) {
        const wmVal = mode === "t1" ? 188 : mode === "flair" ? 126 : mode === "ct" ? 108 : 134;
        return { val: wmVal, label: 2 };
      }
      const gmVal = mode === "t1" ? 138 : mode === "flair" ? 158 : mode === "ct" ? 128 : 168;
      return { val: gmVal, label: 1 };
    }

    return { voxelAt, r };
  }

  /* Build a realistic 128×128×128 analytical 3D brain phantom + anatomical/lesion mask
     and export Axial, Coronal, and Sagittal PNG data URLs. */
  function synthBrainTriplanar(seed, opts = {}) {
    const { voxelAt, r } = buildPhantomEvaluator(seed, opts);
    const N = 128;

    function renderPlane(sampler) {
      const cBase = document.createElement("canvas");
      const cMask = document.createElement("canvas");
      cBase.width = cMask.width = N;
      cBase.height = cMask.height = N;
      const gB = cBase.getContext("2d");
      const gM = cMask.getContext("2d");
      const imB = gB.createImageData(N, N);
      const imM = gM.createImageData(N, N);
      for (let py = 0; py < N; py++) {
        for (let px = 0; px < N; px++) {
          const { u, v, w } = sampler(px / (N - 1) * 2 - 1, py / (N - 1) * 2 - 1);
          const vox = voxelAt(u, v, w);
          const noise = vox.label > 0 ? (r() - 0.5) * 9 : (r() - 0.5) * 3;
          const I = Math.max(0, Math.min(255, Math.round(vox.val + noise)));
          const idx = (py * N + px) * 4;
          imB.data[idx] = imB.data[idx + 1] = imB.data[idx + 2] = I;
          imB.data[idx + 3] = 255;
          imM.data[idx] = imM.data[idx + 1] = imM.data[idx + 2] = vox.label;
          imM.data[idx + 3] = 255;
        }
      }
      gB.putImageData(imB, 0, 0);
      gM.putImageData(imM, 0, 0);
      return { base: cBase.toDataURL("image/png"), mask: cMask.toDataURL("image/png") };
    }

    const ax  = renderPlane((a, b) => ({ u: a,    v: -b,    w: 0.12 }));
    const cor = renderPlane((a, b) => ({ u: a,    v: -0.08, w: -b   }));
    const sag = renderPlane((a, b) => ({ u: 0.26, v: a,     w: -b   }));

    return {
      planes: { axial: ax.base, coronal: cor.base, sagittal: sag.base },
      masks:  { axial: ax.mask, coronal: cor.mask, sagittal: sag.mask }
    };
  }

  /* Export a valid 3D NIfTI-1 (.nii) uint8 segmentation mask (48³ @ 3 mm RAS+) compatible with 3D Slicer & ITK-SNAP. */
  function niftiMaskBlob(seed, opts = {}) {
    const { voxelAt } = buildPhantomEvaluator(seed, opts);
    const D = 48;
    const total = 352 + D * D * D;
    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf);
    const bytes = new Uint8Array(buf);

    dv.setInt32(0, 348, true);         // sizeof_hdr
    dv.setInt16(40, 3, true);          // dim[0] = 3D
    dv.setInt16(42, D, true);          // dim[1]
    dv.setInt16(44, D, true);          // dim[2]
    dv.setInt16(46, D, true);          // dim[3]
    dv.setInt16(48, 1, true);          // dim[4]
    dv.setInt16(70, 2, true);          // datatype = DT_UINT8
    dv.setInt16(72, 8, true);          // bitpix = 8
    dv.setFloat32(76, 1.0, true);      // pixdim[0]
    dv.setFloat32(80, 3.0, true);      // pixdim[1] = 3 mm
    dv.setFloat32(84, 3.0, true);      // pixdim[2] = 3 mm
    dv.setFloat32(88, 3.0, true);      // pixdim[3] = 3 mm
    dv.setFloat32(108, 352.0, true);   // vox_offset = 352
    dv.setFloat32(112, 1.0, true);     // scl_slope = 1
    dv.setInt8(123, 2);                // xyzt_units = NIFTI_UNITS_MM
    dv.setInt16(254, 1, true);         // sform_code = NIFTI_XFORM_SCANNER_ANAT
    dv.setFloat32(280, 3.0, true);     // srow_x[0]
    dv.setFloat32(292, -70.5, true);   // srow_x[3]
    dv.setFloat32(300, 3.0, true);     // srow_y[1]
    dv.setFloat32(308, -70.5, true);   // srow_y[3]
    dv.setFloat32(320, 3.0, true);     // srow_z[2]
    dv.setFloat32(324, -70.5, true);   // srow_z[3]
    bytes[344] = 110; bytes[345] = 43; bytes[346] = 49; bytes[347] = 0; // "n+1\0"

    let off = 352;
    for (let kz = 0; kz < D; kz++) {
      const w = (kz / (D - 1)) * 2 - 1;
      for (let ky = 0; ky < D; ky++) {
        const v = (ky / (D - 1)) * 2 - 1;
        for (let kx = 0; kx < D; kx++) {
          const u = (kx / (D - 1)) * 2 - 1;
          bytes[off++] = voxelAt(u, v, w).label;
        }
      }
    }
    return URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
  }

  function csvBlob(rows) {
    const txt = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    return URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
  }

  function txtBlob(txt, mime = "text/plain;charset=utf-8") {
    return URL.createObjectURL(new Blob([txt], { type: mime }));
  }

  function run(model, task, params, inputs) {
    const r = rng(model.id + ":" + task + ":" + JSON.stringify(params));
    const dim = model.embed_dim || 768;
    const isCt = model.modality === "ct";

    if (task === "embed_volumes") {
      const names = inputs.volNames.length
        ? inputs.volNames
        : Array.from({ length: 12 }, (_, i) => `sub-${String(i + 1).padStart(2, "0")}_${isCt ? "HeadCT" : "T1w"}.nii.gz`);
      const k = Math.min(3, names.length);
      const pts = names.map((nm, i) => {
        const g = i % k;
        return { label: nm, group: g, x: (g - 1) * 2.3 + randn(r) * 0.52, y: (g === 1 ? 1.5 : -0.8) + randn(r) * 0.52 };
      });
      const sim = names.map((_, i) => names.map((__, j) =>
        i === j ? 1 : Math.max(-1, Math.min(1, ((pts[i].group === pts[j].group ? 0.76 : 0.24) + randn(r) * 0.08)))));
      const csv = csvBlob([["volume", "pc1", "pc2", "cluster"], ...pts.map(p => [p.label, p.x.toFixed(4), p.y.toFixed(4), p.group])]);
      return {
        summary: [
          { label: "3D Volumes", value: names.length },
          { label: "Embedding dim", value: dim },
          { label: "Voxel spec", value: model.voxel_spec },
          { label: "Mode", value: "demo" }
        ],
        panels: [
          { type: "scatter", title: "Cohort 3D volume embeddings (PCA · coloured by k-means phenotype)", points: pts, axes: ["PC1", "PC2"] },
          { type: "matrix", title: "Pairwise 3D scan cosine similarity", labels: names, values: sim, min: -1, max: 1, cmap: "viridis" }
        ],
        files: [{ name: "volume_embeddings_pca.csv", label: "PCA coordinates (.csv)", url: csv }]
      };
    }

    if (task === "brain_health") {
      const chronoAge = Number(params.chronological_age) || 62;
      const predAge = +(chronoAge + (r() - 0.35) * 6.4).toFixed(1);
      const bag = +(predAge - chronoAge).toFixed(1);
      const etiv = +(1455 + randn(r) * 45).toFixed(1);
      const tri = synthBrainTriplanar(model.id + ":bh", { contrast: isCt ? "ct" : "t1", lesion: false });
      const biomarkers = [
        { label: "Parenchymal Brain Fraction (% ICV)",   value: +(78.4 + randn(r) * 1.8).toFixed(1), color: "#16a34a" },
        { label: "Cortical Grey Matter Percentile",      value: +(61.5 + randn(r) * 8.5).toFixed(1), color: "#0c7792" },
        { label: "Hippocampal Occupancy Score (%)",      value: +(81.2 + randn(r) * 3.1).toFixed(1), color: "#34d399" },
        { label: "Ventricular Enlargement Index (%)",    value: +(22.5 + Math.abs(randn(r)) * 6.0).toFixed(1), color: "#f59e0b" },
        { label: "WM Hyperintensity Burden Percentile",  value: +(34.0 + Math.abs(randn(r)) * 14.0).toFixed(1), color: "#a855f7" }
      ];
      const vec = Array.from({ length: Math.min(dim, 256) }, () => randn(r) * 0.32);
      const csv = csvBlob([
        ["metric", "value"],
        ["chronological_age_yr", chronoAge],
        ["predicted_brain_age_yr", predAge],
        ["brain_age_gap_yr", bag],
        ["estimated_icv_ml", etiv],
        ...biomarkers.map(b => [b.label, b.value])
      ]);
      return {
        summary: [
          { label: "Predicted BrainAge", value: `${predAge} yr` },
          { label: "Brain-Age Gap (BAG)", value: `${bag >= 0 ? "+" : ""}${bag} yr` },
          { label: "Est. ICV (eTIV)", value: `${etiv} mL` },
          { label: "Embedding dim", value: dim }
        ],
        panels: [
          { type: "triplanar", title: "Tri-planar 3D scan & morphometric reference", planes: tri.planes, masks: tri.masks,
            labels: ANAT_LABELS.slice(0, 6), preset: isCt ? "ct_brain" : "standard",
            meta: "Synthetic 1 mm isotropic 3D phantom — hover any plane to inspect structure labels; adjust Window/Level or ROI filter above." },
          { type: "bars", title: "Individualized brain-health & morphometric indices (0–100 scale)", items: biomarkers, max: 100, decimals: 1 },
          { type: "vector", title: "Patient-level 3D representation", values: vec, dim, norm: 1.0 }
        ],
        files: [{ name: "brain_health_metrics.csv", label: "BrainAge & biomarkers (.csv)", url: csv }]
      };
    }

    if (task === "zeroshot_neuro") {
      const defaultPrompts = isCt
        ? ["acute subdural or intraparenchymal hemorrhage", "acute middle cerebral artery territory ischemic infarct", "mass effect with midline shift", "hydrocephalus or ventricular effacement", "unremarkable non-contrast head CT"]
        : ["high-grade diffuse glioma with perilesional FLAIR edema", "acute restricted diffusion ischemic stroke", "demyelinating periventricular white-matter plaques", "age-related cerebral atrophy and microvascular leukoaraiosis", "unremarkable structural brain MRI"];
      const rawPrompts = (Array.isArray(params.prompts) && params.prompts.length ? params.prompts : defaultPrompts).filter(Boolean);
      const prompts = rawPrompts.length ? rawPrompts : defaultPrompts;
      const raw = prompts.map((_, i) => Math.exp((i === 0 ? 1.45 : 0) + randn(r) * 0.7));
      const Z = raw.reduce((a, b) => a + b, 0) || 1;
      const items = prompts.map((p, i) => ({ label: p, value: raw[i] / Z })).sort((a, b) => b.value - a.value);
      const tri = synthBrainTriplanar(model.id + ":zs", { contrast: isCt ? "ct" : "flair", lesion: true });
      const csv = csvBlob([["finding_or_prompt", "probability"], ...items.map(d => [d.label, d.value.toFixed(4)])]);
      return {
        summary: [
          { label: "Top finding", value: items[0]?.label.slice(0, 32) || "—" },
          { label: "Confidence", value: ((items[0]?.value || 0) * 100).toFixed(1) + "%" },
          { label: "Candidates", value: items.length },
          { label: "Mode", value: "demo" }
        ],
        panels: [
          { type: "bars", title: "Study-level diagnostic / zero-shot probabilities", items, max: 1, unit: "%" },
          { type: "triplanar", title: "Tri-planar volume & attention ROI preview", planes: tri.planes, masks: tri.masks,
            labels: [ANAT_LABELS[6], ANAT_LABELS[2], ANAT_LABELS[0]], preset: isCt ? "ct_brain" : "flair",
            meta: "Orange ROI highlights highest-saliency 3D region contributing to top finding score." }
        ],
        files: [{ name: "zeroshot_neuro_scores.csv", label: "Finding probabilities (.csv)", url: csv }]
      };
    }

    if (task === "report_vqa") {
      const question = (params.clinical_prompt || "").trim() || "Evaluate for intracranial mass lesion, acute ischemia, hemorrhage, or midline shift.";
      const useCt = isCt || /\b(head|cranial|non-contrast)\s+ct\b/i.test(question);
      const tri = synthBrainTriplanar(model.id + ":vqa:" + (useCt ? "ct" : "mri"), { contrast: useCt ? "ct" : "flair", lesion: true });
      const reportPanel = {
        type: "report",
        title: `${model.name} — Automated Neuroradiology Report & VQA`,
        indication: question,
        technique: useCt
          ? "Volumetric non-contrast helical Head CT reconstructed in axial, coronal, and sagittal planes (1.0 mm slice thickness)."
          : "Multi-sequence 3D Brain MRI (sagittal 3D T1w MPRAGE, axial T2-FLAIR, T2w, and DWI/ADC) evaluated natively in 3D.",
        findings: useCt
          ? "• Brain Parenchyma: Focal hyperattenuating lesion (~14.3 mL) in the right frontoparietal centrum semiovale with mild surrounding hypoattenuating vasogenic edema.\n• Ventricles & Cisterns: Lateral and third ventricles are symmetric without hydrocephalus; basal cisterns remain patent.\n• Midline & Calvarium: < 2 mm leftward septum pellucidum shift. No calvarial fracture or extra-axial fluid collection."
          : "• Brain Parenchyma: Well-delineated 14.3 cm³ right frontoparietal intra-axial lesion with central heterogeneous signal and surrounding T2/FLAIR hyperintense vasogenic edema.\n• Ventricles & Sulci: Mild effacement of the right lateral ventricular body; no hydrocephalus or transtentorial herniation.\n• Vascular & Extra-axial: Preserved major intracranial flow voids; no extra-axial collection.",
        impression: "1. Right frontoparietal intra-axial lesion (~14.3 mL) with perilesional edema; differential includes glial neoplasm vs. solitary metastasis — contrast-enhanced mpMRI and neurosurgical correlation advised.\n2. No hydrocephalus or herniation.",
        vqa_question: question,
        vqa_answer: "Yes — a focal right frontoparietal parenchymal abnormality (~14.3 mL including edema envelope) is present without acute herniation or hydrocephalus."
      };
      const confItems = [
        { label: "Focal parenchymal lesion / edema", value: 0.91 },
        { label: "Perilesional FLAIR / HU signal change", value: 0.86 },
        { label: "Hydrocephalus", value: 0.06 },
        { label: "Extra-axial hemorrhage", value: 0.04 }
      ];
      const reportJson = txtBlob(JSON.stringify(reportPanel, null, 2), "application/json");
      const reportTxt = txtBlob(
        `INDICATION: ${reportPanel.indication}\n\nTECHNIQUE: ${reportPanel.technique}\n\nFINDINGS:\n${reportPanel.findings}\n\nIMPRESSION:\n${reportPanel.impression}\n\nVQA:\n${reportPanel.vqa_answer}\n`,
        "text/plain;charset=utf-8"
      );
      return {
        summary: [
          { label: "Model", value: model.name },
          { label: "Input grid", value: model.voxel_spec },
          { label: "Primary alert", value: "Right frontoparietal ROI" },
          { label: "Mode", value: "demo" }
        ],
        panels: [
          reportPanel,
          { type: "triplanar", title: "Grounded 3D study planes", planes: tri.planes, masks: tri.masks,
            labels: ANAT_LABELS, preset: useCt ? "ct_brain" : "flair" },
          { type: "bars", title: "Structured finding confidence", items: confItems, max: 1, unit: "%" }
        ],
        files: [
          { name: "neurorad_report.json", label: "Structured report (.json)", url: reportJson },
          { name: "neurorad_report.txt", label: "Plain-text report (.txt)", url: reportTxt }
        ]
      };
    }

    if (task === "segment_brain") {
      const segMode = params.seg_mode || "auto";
      const withLesion = segMode !== "parcellation";
      const activeLabels = withLesion ? ANAT_LABELS : ANAT_LABELS.slice(0, 6);
      const seedKey = `${model.id}:seg:${segMode}`;
      const tri = synthBrainTriplanar(seedKey, { contrast: isCt ? "ct" : "t1", lesion: withLesion });
      const rows = activeLabels.map(lb => {
        const jitter = 1 + (r() - 0.5) * 0.08;
        const vol = Math.round(lb.mm3 * jitter);
        const icv = +(lb.icv * jitter).toFixed(2);
        return [lb.id, lb.name, vol, +(vol / 1000).toFixed(2), icv, +(0.89 + r() * 0.08).toFixed(3)];
      });
      const lesionRow = rows.find(rw => rw[0] === 7);
      const csv = csvBlob([["label_id", "structure", "volume_mm3", "volume_ml", "pct_icv", "qc_confidence"], ...rows]);
      const nii = niftiMaskBlob(seedKey, { contrast: isCt ? "ct" : "t1", lesion: withLesion });
      return {
        summary: [
          { label: "Segmented classes", value: activeLabels.length },
          { label: "Lesion / ROI vol", value: lesionRow ? `${lesionRow[3]} mL` : "Parcellation only" },
          { label: "Automated QC", value: "0.94 (Pass)" },
          { label: "Mode", value: "demo" }
        ],
        panels: [
          { type: "triplanar", title: `${model.name} — 3D Tri-Planar Parcellation & Lesion Overlay`,
            planes: tri.planes, masks: tri.masks, labels: activeLabels, preset: isCt ? "ct_brain" : "standard",
            meta: segMode === "lesion_center"
              ? "3D center-point lesion prompt active — isolate Label 7 (Focal Lesion / Edema ROI) in the ROI dropdown or download the NIfTI mask."
              : "Use the ROI dropdown to isolate cortical, subcortical, ventricular, or lesion masks; drag the Mask slider to inspect underlying anatomy." },
          { type: "table", title: "Quantitative 3D volumetry & intracranial fractions",
            columns: ["ID", "Anatomical structure / ROI", "Volume (mm³)", "Volume (mL)", "% eTIV", "QC score"], rows }
        ],
        files: [
          { name: "segmentation_mask.nii", label: "3D label mask (.nii)", url: nii },
          { name: "volumetry_stats.csv", label: "Volumetry table (.csv)", url: csv }
        ]
      };
    }

    if (task === "synth_register") {
      const target = params.target_modality || "T2-FLAIR (synthesized)";
      const isCtTarget = /CT/i.test(target);
      const isReg = /MNI152|Affine|Rigid|Alignment/i.test(target);
      const contrast = isCtTarget ? "ct" : (isReg ? "t1" : "synth");
      const tri = synthBrainTriplanar(model.id + ":synth:" + target, { contrast, lesion: true });
      const metrics = [
        { label: "Structural Similarity (SSIM vs atlas)", value: +(0.934 + r() * 0.03).toFixed(3) },
        { label: "Normalized Mutual Information (NMI)",   value: +(0.882 + r() * 0.05).toFixed(3) },
        { label: "Diffeomorphic Jacobian Regularity",     value: +(0.994 + r() * 0.004).toFixed(3) },
        { label: "Keypoint Alignment Inlier Ratio",       value: +(0.961 + r() * 0.025).toFixed(3) }
      ];
      const csv = csvBlob([["metric", "score"], ...metrics.map(m => [m.label, m.value])]);
      return {
        summary: [
          { label: "Target output", value: target },
          { label: "Resolution", value: "1.0 mm isotropic" },
          { label: "Jacobian folds", value: "0.02%" },
          { label: "Mode", value: "demo" }
        ],
        panels: [
          { type: "triplanar", title: `Synthesized / Registered 3D Output — ${target}`,
            planes: tri.planes, preset: isCtTarget ? "ct_brain" : (isReg ? "standard" : "flair"),
            meta: "Cross-modal synthesized or MNI152-aligned 3D output rendered across Axial, Coronal, and Sagittal planes." },
          { type: "bars", title: "Synthesis & registration fidelity metrics", items: metrics, max: 1.0, decimals: 3 }
        ],
        files: [{ name: "synth_register_qc.csv", label: "Quality metrics (.csv)", url: csv }]
      };
    }

    if (task === "decode_fmri") {
      const atlas = params.atlas || "AAL-424";
      const nets = [
        "Default Mode Network (DMN)",
        "Frontoparietal Control (FPN)",
        "Salience / Ventral Attention",
        "Dorsal Attention (DAN)",
        "Somatomotor Network (SMN)",
        "Visual Network (VIS)",
        "Limbic / Temporolimbic"
      ];
      const items = nets.map((nm, i) => ({
        label: nm,
        value: +(0.35 + Math.abs(randn(r)) * 0.35).toFixed(3),
        color: ["#0c7792", "#7c3aed", "#e11d48", "#16a34a", "#0284c7", "#ca8a04", "#f97316"][i]
      }));
      const fc = nets.map((_, i) => nets.map((__, j) =>
        i === j ? 1.0 : +Math.max(-0.85, Math.min(0.85, (Math.abs(i - j) === 1 ? 0.42 : -0.15) + randn(r) * 0.25)).toFixed(3)));
      const shortLabels = ["DMN", "FPN", "SAL", "DAN", "SMN", "VIS", "LIM"];
      const csv = csvBlob([["network", "activation_score"], ...items.map(d => [d.label, d.value])]);
      const fcCsv = csvBlob([["network", ...shortLabels], ...shortLabels.map((lb, i) => [lb, ...fc[i]])]);
      return {
        summary: [
          { label: "Atlas", value: atlas },
          { label: "Peak network", value: [...items].sort((a, b) => b.value - a.value)[0].label.split(" ")[0] },
          { label: "Latent dim", value: dim },
          { label: "Mode", value: "demo" }
        ],
        panels: [
          { type: "bars", title: `Intrinsic functional network activation profile (${atlas})`, items, max: 1.2, decimals: 3 },
          { type: "matrix", title: "Inter-network functional connectivity (Pearson r)", labels: shortLabels, values: fc, min: -1, max: 1, cmap: "rdbu" }
        ],
        files: [
          { name: "fmri_network_scores.csv", label: "Network activations (.csv)", url: csv },
          { name: "functional_connectivity.csv", label: "Connectivity matrix (.csv)", url: fcCsv }
        ]
      };
    }

    return { summary: [], panels: [{ type: "note", title: "Demo", text: "No demo preview defined for " + task }], files: [] };
  }

  window.Demo = { run };
})();
