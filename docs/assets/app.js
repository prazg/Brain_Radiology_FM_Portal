/* Brain Radiology FM Portal — single-page workstation controller (vanilla JS, zero build step). */
(function () {
  "use strict";
  const { h, hideTip } = window.Viewers;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  function loadSavedPinned() {
    try {
      const raw = JSON.parse(sessionStorage.getItem("neuro_fm_pinned") || "[]");
      return Array.isArray(raw) ? raw.filter(x => typeof x === "string").slice(0, 4) : [];
    } catch {
      return [];
    }
  }

  const S = {
    reg: null,
    view: "models",
    filter: {
      q: "",
      scenario: "all",
      cat: "all",
      modality: "all",
      commercial: false,
      ungated: false,
      ready: false,
      hwFit: false
    },
    hwProfile: localStorage.getItem("neuro_fm_hw_profile") || "auto",
    pinned: loadSavedPinned(),
    dockMsg: "",
    dockMsgTimer: null,
    paperQ: "",
    mode: localStorage.getItem("neuro_fm_mode") || "demo",
    url: (localStorage.getItem("neuro_fm_url") || "http://127.0.0.1:8000").replace(/\/+$/, ""),
    key: localStorage.getItem("neuro_fm_key") || "",
    hf: sessionStorage.getItem("neuro_fm_hf") || "",
    health: null,
    browserHw: null,
    weights: {},
    perf: {},
    ready: {},
    volFiles: [],
    volSource: "path",
    jobs: [],
    demoJobs: [],
    activeJob: null,
    pollTimer: null,
    weightsTimer: null
  };

  const CLINICAL_SCENARIOS = [
    {
      id: "all",
      label: reg => `All ${reg ? reg.models.length : 28} Models`,
      preferTask: null,
      match: () => true
    },
    {
      id: "glioma_seg",
      label: () => "Glioma & Lesion 3D Seg",
      preferTask: "segment_brain",
      match: m => m.tasks.includes("segment_brain")
    },
    {
      id: "ct_triage",
      label: () => "Head CT Triage",
      preferTask: "zeroshot_neuro",
      match: m => m.modality === "ct" || m.modality === "mri_ct"
    },
    {
      id: "vlm_report",
      label: () => "3D Vision-Language Report",
      preferTask: "report_vqa",
      match: m => m.tasks.includes("report_vqa")
    },
    {
      id: "brain_age",
      label: () => "BrainAge & Volumetric Emb",
      preferTask: "brain_health",
      match: m => m.tasks.includes("brain_health") || (m.tasks.includes("embed_volumes") && m.modality !== "fmri" && m.id !== "biomedclip")
    },
    {
      id: "cross_synth",
      label: () => "Cross-Sequence Synthesis",
      preferTask: "synth_register",
      match: m => m.tasks.includes("synth_register") || m.id === "brainmvp"
    },
    {
      id: "fmri_conn",
      label: () => "4D fMRI Connectomics",
      preferTask: "decode_fmri",
      match: m => m.modality === "fmri" || m.tasks.includes("decode_fmri")
    }
  ];

  const NEURO_PROMPTS = {
    ct_triage: {
      label: "Acute Head CT Hemorrhage & Stroke Triage",
      lines: [
        "acute subdural or epidural hemorrhage",
        "intraparenchymal or subarachnoid hemorrhage",
        "acute middle cerebral artery territory ischemic infarct",
        "mass effect with midline shift or herniation",
        "unremarkable non-contrast head CT"
      ]
    },
    mri_tumor: {
      label: "Brain MRI Glioma / Metastasis / Demyelination",
      lines: [
        "high-grade diffuse glioma with perilesional FLAIR edema",
        "ring-enhancing cerebral metastasis",
        "extra-axial dural-based meningioma",
        "demyelinating periventricular white-matter plaques",
        "unremarkable structural brain MRI"
      ]
    },
    mri_neurodeg: {
      label: "Neurodegeneration (AD / MCI / Vascular)",
      lines: [
        "hippocampal and medial temporal lobe atrophy suggestive of Alzheimer disease",
        "frontotemporal lobar degeneration pattern",
        "confluent periventricular microvascular leukoaraiosis (Fazekas 2-3)",
        "normal age-appropriate brain parenchyma"
      ]
    },
    seq_id: {
      label: "MRI / CT Sequence & Modality Identification",
      lines: [
        "3D T1-weighted structural brain MRI",
        "post-contrast T1ce brain MRI",
        "T2-FLAIR brain MRI",
        "diffusion-weighted (DWI) brain MRI",
        "non-contrast cranial CT scan"
      ]
    }
  };

  function texEscape(s) {
    return String(s || "").replace(/&/g, "\\&");
  }

  function parseCitationMeta(m) {
    const cit = (m.citation || "").trim();
    let authorBib = (m.developer || "Authors").trim();
    let title = m.name;

    if (cit) {
      let rawAuthors = "";
      let rest = "";
      const etAlMatch = cit.match(/^(.+\bet al\.),\s*(.+)$/);
      const ampMatch = !etAlMatch ? cit.match(/^([^,]+(?:,\s*[^,]+)*?\s*&\s*[^,]+),\s*(.+)$/) : null;
      if (etAlMatch) {
        rawAuthors = etAlMatch[1].trim();
        rest = etAlMatch[2].trim();
      } else if (ampMatch) {
        rawAuthors = ampMatch[1].trim();
        rest = ampMatch[2].trim();
      } else {
        const idx = cit.indexOf(",");
        if (idx > 0) {
          rawAuthors = cit.slice(0, idx).trim();
          rest = cit.slice(idx + 1).trim();
        } else {
          rest = cit;
        }
      }

      if (rawAuthors) {
        const hasEtAl = /\bet al\./i.test(rawAuthors);
        const names = rawAuthors
          .replace(/\bet al\.?/gi, "")
          .split(/[,/&]+/)
          .map(s => s.trim())
          .filter(Boolean);
        if (names.length) {
          authorBib = names.join(" and ") + (hasEtAl ? " and others" : "");
        }
      }

      if (rest) {
        title = rest
          .replace(/,\s*Google Health AI,\s*[^,]+\(\d{4}(?:\s*\/\s*\d{4})?\)\s*$/i, "")
          .replace(/,\s*[^,]+\(\d{4}(?:\s*\/\s*\d{4})?\)\s*$/, "")
          .trim() || m.name;
      }
    }

    const yr = (m.paper_label?.match(/20\d\d/) || m.citation?.match(/20\d\d/) || ["2025"])[0];
    const url = m.paper_url || m.link || "";
    const doiMatch = url.match(/^https?:\/\/doi\.org\/(.+)$/i);
    const arxivMatch = url.match(/^https?:\/\/arxiv\.org\/abs\/([0-9]+\.[0-9]+(?:v\d+)?)/i);
    const journalClean = (m.paper_label || "Preprint").replace(/\s+20\d\d\b/, "").trim() || m.paper_label || "Preprint";

    return {
      key: `${m.id}_${yr}`,
      author: texEscape(authorBib),
      title: texEscape(title),
      journal: texEscape(journalClean),
      year: yr,
      doi: doiMatch ? doiMatch[1] : null,
      arxiv: arxivMatch ? arxivMatch[1] : null,
      url
    };
  }

  function bibtexFor(m) {
    const meta = parseCitationMeta(m);
    const lines = [
      `@article{${meta.key},`,
      `  title   = {${meta.title}},`,
      `  author  = {${meta.author}},`,
      `  journal = {${meta.journal}},`,
      `  year    = {${meta.year}},`
    ];
    if (meta.doi) lines.push(`  doi     = {${meta.doi}},`);
    if (meta.arxiv) {
      lines.push(`  eprint  = {${meta.arxiv}},`);
      lines.push(`  archivePrefix = {arXiv},`);
    }
    lines.push(`  url     = {${meta.url}}`);
    lines.push(`}`);
    return lines.join("\n");
  }

  function downloadBlobFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: filename, hidden: true });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1800);
  }

  function exportModelsBibtex(models, filename = "neurorad_fm_models.bib") {
    if (!models || !models.length) return;
    const header = `% Brain Radiology FM Portal (NeuroRad-FM) — ${models.length} neuroimaging foundation model citation(s)\n% Generated ${new Date().toISOString().slice(0, 10)}\n\n`;
    const body = models.map(bibtexFor).join("\n\n") + "\n";
    downloadBlobFile(filename, header + body, "application/x-bibtex;charset=utf-8");
  }

  function exportModelsCsv(models, filename = "neurorad_fm_models.csv") {
    if (!models || !models.length || !S.reg) return;
    const cols = [
      "id", "name", "developer", "category", "modality", "voxel_spec", "arch", "embed_dim",
      "weights_gb", "runtime_weights_gb", "min_vram_gb", "hardware_tier", "tasks",
      "licence", "commercial_use", "gated", "hf_repo", "weights_or_code_url",
      "paper_label", "paper_url", "citation"
    ];
    const rows = models.map(m => {
      const fit = fitOf(m);
      return [
        m.id,
        m.name,
        m.developer,
        S.reg.categories[m.category]?.label || m.category,
        modBadgeLabel(m.modality),
        m.voxel_spec || "",
        m.arch || "",
        m.embed_dim ?? "",
        m.weights_gb ?? "",
        m.runtime_weights_gb ?? "",
        fit.needVram,
        fit.tier?.label || "",
        m.tasks.map(t => S.reg.tasks[t]?.label || t).join("; "),
        m.licence || "",
        m.commercial_use ? "yes" : "no",
        m.gated ? "gated" : "ungated",
        m.hf_repo || "",
        m.link || "",
        m.paper_label || "",
        m.paper_url || "",
        m.citation || ""
      ];
    });
    const csvCell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const txt = "\uFEFF" + [cols.map(csvCell).join(","), ...rows.map(r => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
    downloadBlobFile(filename, txt, "text/csv;charset=utf-8");
  }

  function quickstartSnippet(m) {
    if (m.hf_repo && m.category === "vlm") {
      return [
        `# Download / inspect ${m.name} from Hugging Face`,
        `pip install huggingface_hub transformers nibabel torch`,
        `hf download ${m.hf_repo}${m.gated ? "   # requires `hf auth login` & accepted access" : ""}`,
        ``,
        `# Or launch this portal's local GPU backend:`,
        `cd backend && python -m uvicorn server:app --host 127.0.0.1 --port 8000`
      ].join("\n");
    }
    if (m.hf_repo) {
      return [
        `# Fetch ${m.name} weights into your local HF cache`,
        `pip install huggingface_hub nibabel monai torch`,
        `python -c "from huggingface_hub import snapshot_download; print(snapshot_download('${m.hf_repo}'))"`,
        ``,
        `# Run on NIfTI (.nii.gz) via Brain Radiology FM Portal:`,
        `cd backend && python -m uvicorn server:app --host 127.0.0.1 --port 8000`
      ].join("\n");
    }
    return [
      `# Official repository & checkpoint setup for ${m.name}:`,
      `# ${m.link}`,
      `# ${m.weights?.[0]?.note || "Follow upstream README to place weights on your server."}`,
      `cd backend && python -m uvicorn server:app --host 127.0.0.1 --port 8000`
    ].join("\n");
  }

  /* ── theme ──────────────────────────────────────────────────────────────── */
  function syncThemeBtn() {
    const isDark = document.documentElement.dataset.theme === "dark";
    const btn = $("#themeBtn");
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(isDark));
    btn.title = isDark ? "PACS Darkroom active — switch to Lightbox theme" : "Lightbox active — switch to PACS Darkroom theme";
  }

  function initTheme() {
    const saved = localStorage.getItem("neuro_fm_theme");
    const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    syncThemeBtn();
    $("#themeBtn").onclick = () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("neuro_fm_theme", next);
      syncThemeBtn();
      if (S.activeJob) renderJobDetail(S.activeJob);
    };
  }

  /* ── navigation ─────────────────────────────────────────────────────────── */
  function go(view) {
    if (!["models", "run", "results", "papers", "connect"].includes(view)) view = "models";
    S.view = view;
    hideTip();
    $$("main > section").forEach(s => { s.hidden = s.id !== "view-" + view; });
    $$(".tabs button").forEach(b => {
      if (b.dataset.view === view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
    if (view === "results") refreshJobs();
    if (view === "papers") renderPapers();
  }

  /* ── backend HTTP ───────────────────────────────────────────────────────── */
  function headers(extra) {
    const hd = Object.assign({}, extra);
    if (S.key) hd["X-Portal-Key"] = S.key;
    if (S.hf) hd["X-HF-Token"] = S.hf;
    return hd;
  }
  async function api(path, opts = {}) {
    const res = await fetch(S.url + path, Object.assign({}, opts, { headers: headers(opts.headers) }));
    if (!res.ok) {
      let msg = res.status + " " + res.statusText;
      try { const j = await res.json(); if (j.detail) msg = j.detail; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }
  function fileUrl(jobId, nameOrUrl) {
    if (!nameOrUrl) return "";
    if (nameOrUrl.startsWith("blob:") || nameOrUrl.startsWith("data:") || nameOrUrl.startsWith("http")) return nameOrUrl;
    const q = S.key ? "?key=" + encodeURIComponent(S.key) : "";
    return `${S.url}/api/jobs/${jobId}/files/${encodeURIComponent(nameOrUrl)}${q}`;
  }

  async function probe() {
    if (S.mode === "demo") {
      S.health = null; S.ready = {}; S.weights = {}; S.perf = {};
      setConn("demo", "Demo mode (3D phantom)");
      renderCatalogue(); renderServerBox(); renderWeightsBox(); renderRunModelOptions(); renderHardwareBar();
      return;
    }
    setConn("", "Checking…");
    try {
      const [hlth, rdy, wts, prf] = await Promise.all([
        api("/api/health"),
        api("/api/models"),
        api("/api/weights").catch(() => ({})),
        api("/api/perf").catch(() => ({}))
      ]);
      S.health = hlth; S.ready = rdy; S.weights = wts; S.perf = prf;
      const where = hlth.mock ? "mock server" : (hlth.gpu || hlth.device);
      setConn("ok", `Connected · ${where}`);
    } catch (e) {
      S.health = { error: e.message }; S.ready = {}; S.weights = {}; S.perf = {};
      setConn("bad", "Backend unreachable");
    }
    renderCatalogue(); renderServerBox(); renderWeightsBox(); renderRunModelOptions(); renderHardwareBar();
  }
  function setConn(kind, text) {
    $("#connDot").className = "dot" + (kind ? " " + kind : "");
    $("#connText").textContent = text;
  }

  function isReady(m) {
    if (S.mode === "demo") return true;
    return Boolean(S.ready[m.id]?.ready);
  }
  function fitOf(m) {
    return window.Hardware.fit(m, S.reg.hardware_rules, S.health?.hardware || null, S.browserHw, S.perf, S.hwProfile);
  }
  function weightInfo(m) {
    return S.weights[m.id] || null;
  }

  /* ── hardware bar ───────────────────────────────────────────────────────── */
  function renderHardwareBar() {
    const bar = $("#hwBar");
    if (!bar || !S.reg) return;
    const srv = S.health?.hardware;
    const br = S.browserHw;
    const rules = S.reg.hardware_rules;
    const fits = S.reg.models.filter(m => fitOf(m).level === "ok").length;
    const total = S.reg.models.length;

    const parts = [];
    if (srv) {
      const gpu = srv.gpus?.[0] || srv.driver_gpus?.[0];
      parts.push(h("span", null, h("strong", null, "Server: "),
        gpu ? `${gpu.name} (${gpu.vram_total_gb} GB VRAM)` : (srv.mps_available ? "Apple Silicon MPS" : "CPU only (no CUDA GPU)")),
        h("span", { class: "sep" }, "·"),
        h("span", null, `${srv.cpu_cores || "?"} cores${srv.ram_total_gb ? `, ${srv.ram_total_gb} GB RAM` : ""}`),
        srv.weights_disk_free_gb != null ? [h("span", { class: "sep" }, "·"), h("span", null, `${srv.weights_disk_free_gb} GB free in HF cache`)] : null,
        h("span", { class: "sep" }, "·"),
        h("span", null, h("strong", null, `${fits} of ${total}`), " models fit target"));
    } else if (br) {
      const gtxt = br.gpuName
        ? `${br.gpuName}${br.vramGuessGb ? ` (~${br.vramGuessGb} GB est.)` : ""}`
        : "GPU hidden by browser";
      parts.push(h("span", null, h("strong", null, "This device: "), gtxt),
        br.cores ? [h("span", { class: "sep" }, "·"), h("span", null, `${br.cores} threads`)] : null,
        h("span", { class: "sep" }, "·"),
        h("span", null, h("strong", null, `${fits} of ${total}`), " models fit"),
        h("span", { class: "sep" }, "·"),
        h("span", { class: "muted" }, S.mode === "demo"
          ? "Browser Demo mode active — connect a GPU server under Connect for real NIfTI inference."
          : "Connect to your server for exact CUDA VRAM and cached weight checks."));
    }

    const profSel = h("select", {
      class: "hw-profile-sel",
      id: "hwProfileSel",
      "aria-label": "Target GPU VRAM profile for hardware fit",
      onchange: e => {
        S.hwProfile = e.target.value;
        localStorage.setItem("neuro_fm_hw_profile", S.hwProfile);
        renderHardwareBar();
        renderCatalogue();
        if ($("#compareModal")?.open) renderCompareModal();
      }
    }, (window.Hardware.HW_PROFILES || []).map(p =>
      h("option", { value: p.id, selected: p.id === S.hwProfile }, p.label)));

    parts.push(h("label", { class: "hw-profile-wrap", for: "hwProfileSel" }, "VRAM target:", profSel));

    const warns = (srv?.warnings || []).map(w => h("div", { class: "hw-warn" }, w));
    bar.replaceChildren(...parts.flat().filter(Boolean), ...warns);
    bar.title = rules.source;
  }

  /* ── Pin-to-Compare (up to 4 models) ────────────────────────────────────── */
  function savePinned() {
    try { sessionStorage.setItem("neuro_fm_pinned", JSON.stringify(S.pinned)); } catch {}
  }

  function isPinned(modelId) {
    return S.pinned.includes(modelId);
  }

  function togglePin(modelId) {
    const idx = S.pinned.indexOf(modelId);
    clearTimeout(S.dockMsgTimer);
    if (idx >= 0) {
      S.pinned.splice(idx, 1);
      S.dockMsg = "";
    } else if (S.pinned.length >= 4) {
      S.dockMsg = "Up to 4 models can be compared side-by-side — unpin a model below to add another.";
      S.dockMsgTimer = setTimeout(() => { S.dockMsg = ""; renderCompareDock(); }, 4200);
      renderCompareDock();
      return false;
    } else {
      S.pinned.push(modelId);
      S.dockMsg = "";
    }
    savePinned();
    renderCatalogue();
    renderCompareDock();
    if ($("#compareModal")?.open) {
      if (S.pinned.length) renderCompareModal();
      else $("#compareModal").close();
    }
    return true;
  }

  function clearPinned() {
    S.pinned = [];
    S.dockMsg = "";
    savePinned();
    renderCatalogue();
    renderCompareDock();
    if ($("#compareModal")?.open) $("#compareModal").close();
  }

  function pinnedModels() {
    if (!S.reg) return [];
    return S.pinned.map(id => S.reg.models.find(m => m.id === id)).filter(Boolean);
  }

  function renderCompareDock() {
    const dock = $("#compareDock");
    if (!dock || !S.reg) return;
    const list = pinnedModels();
    document.body.classList.toggle("has-cmp-dock", list.length > 0);
    if (!list.length) {
      dock.hidden = true;
      dock.replaceChildren();
      return;
    }
    dock.hidden = false;
    const pills = list.map(m =>
      h("span", { class: "cmp-pill" },
        h("span", { class: "swatch", style: { background: `var(--fam-${m.category})` } }),
        m.name,
        h("button", {
          type: "button",
          "aria-label": `Unpin ${m.name}`,
          title: `Unpin ${m.name}`,
          onclick: () => togglePin(m.id)
        }, "✕")));

    dock.replaceChildren(
      h("div", { class: "cmp-dock-list" },
        h("span", { class: "cmp-dock-title" }, `Compare 3D Models (${list.length}/4)`),
        ...pills),
      h("div", { class: "cmp-dock-actions" },
        h("button", { class: "btn small", type: "button", onclick: openCompareModal }, `Compare side-by-side (${list.length})`),
        h("button", { class: "btn ghost small", type: "button", onclick: () => exportModelsBibtex(list, "neurorad_fm_compared.bib") }, "↓ .bib"),
        h("button", { class: "btn ghost small", type: "button", onclick: () => exportModelsCsv(list, "neurorad_fm_compared.csv") }, "↓ .csv"),
        h("button", { class: "btn ghost small", type: "button", onclick: clearPinned }, "Clear")),
      S.dockMsg ? h("div", { class: "cmp-dock-msg", role: "status" }, S.dockMsg) : null
    );
  }

  function openCompareModal() {
    const dlg = $("#compareModal");
    if (!dlg || !S.pinned.length) return;
    renderCompareModal();
    if (!dlg.open) dlg.showModal();
  }

  function renderCompareModal() {
    const dlg = $("#compareModal");
    if (!dlg || !S.reg) return;
    const list = pinnedModels();
    if (!list.length) { dlg.close(); return; }

    const remaining = S.reg.models.filter(m => !isPinned(m.id));
    const addSelect = list.length < 4 && remaining.length ? h("select", {
      class: "cmp-add-sel",
      "aria-label": "Add another model to comparison",
      onchange: e => {
        if (e.target.value) togglePin(e.target.value);
      }
    },
      h("option", { value: "" }, "+ Add model to compare…"),
      ...remaining.map(m => h("option", { value: m.id }, `${m.name} (${modBadgeLabel(m.modality)})`))) : null;

    const headCells = [
      h("th", { scope: "col" }, "Specification"),
      ...list.map(m => h("th", { scope: "col" },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "flex-start" } },
          h("div", null,
            h("div", { style: { fontFamily: "var(--display)", fontWeight: "700", fontSize: "0.96rem" } }, m.name),
            h("div", { class: "small muted", style: { fontWeight: "400" } }, m.developer)),
          h("button", {
            class: "icon-btn",
            style: { width: "26px", height: "26px", fontSize: "0.75rem" },
            type: "button",
            "aria-label": `Remove ${m.name} from comparison`,
            title: "Unpin model",
            onclick: () => togglePin(m.id)
          }, "✕")),
        h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" } },
          h("span", { class: "badge", style: { borderLeft: `3px solid var(--fam-${m.category})` } }, S.reg.categories[m.category]?.label || m.category),
          h("button", {
            class: "btn small",
            style: { padding: "3px 9px", fontSize: "0.76rem" },
            type: "button",
            onclick: () => { dlg.close(); openInRun(m.id); }
          }, "Run →"))))
    ];

    const specRows = [
      ["Modality & Scan", m => h("div", null,
        h("span", { class: `badge mod-${m.modality}` }, modBadgeLabel(m.modality)),
        m.seq_hint ? h("div", { class: "small muted", style: { marginTop: "4px" } }, m.seq_hint) : null)],
      ["3D Input Grid", m => h("code", null, m.voxel_spec || "3D NIfTI")],
      ["VRAM & Fit", m => {
        const fit = fitOf(m);
        const cls = fit.level === "ok" ? "badge ok" : fit.level === "warn" ? "badge warn" : fit.level === "bad" ? "badge bad" : "badge";
        const wGb = m.runtime_weights_gb || m.weights_gb || 0;
        return h("div", null,
          h("div", { class: "mono", style: { fontWeight: "700", fontSize: "0.82rem" } }, `~${fit.needVram} GB VRAM (${fit.tier.label})`),
          h("div", { class: "small muted" }, `Weights: ~${wGb} GB${m.runtime_weights_gb > m.weights_gb ? " (incl. encoder)" : ""}`),
          h("div", { style: { marginTop: "4px" } }, h("span", { class: cls }, fit.short)));
      }],
      ["Architecture", m => h("div", null,
        h("div", { style: { fontWeight: "600" } }, m.arch),
        h("div", { class: "small muted mono" }, m.embed_dim ? `${m.embed_dim}-d latent embedding` : "Dense 3D voxel / task head"))],
      ["Portal Tasks", m => h("div", { class: "badges" },
        m.tasks.map(t => h("span", { class: "badge accent" }, S.reg.tasks[t]?.label || t)))],
      ["Licence", m => h("div", null,
        h("span", { class: m.commercial_use ? "badge ok" : "badge" }, m.commercial_use ? "Commercial OK" : "Research / Non-Comm"),
        h("div", { class: "small muted", style: { marginTop: "4px" } }, m.licence))],
      ["Gating & Repo", m => h("div", null,
        h("span", { class: m.gated ? "badge warn" : "badge ok" }, m.gated ? "Gated HF (token req.)" : (m.hf_repo ? "Ungated Public HF" : "Ungated GitHub / CLI")),
        h("div", { class: "small", style: { marginTop: "4px" } },
          h("a", { href: m.link, target: "_blank", rel: "noopener noreferrer" }, m.hf_repo || "Repository ↗")))],
      ["Paper & DOI", m => {
        const copyBtn = h("button", {
          class: "btn ghost small",
          style: { marginTop: "6px", padding: "2px 8px", fontSize: "0.74rem" },
          type: "button",
          onclick: () => {
            navigator.clipboard?.writeText(bibtexFor(m));
            copyBtn.textContent = "BibTeX copied!";
            setTimeout(() => { copyBtn.textContent = "Copy BibTeX"; }, 1300);
          }
        }, "Copy BibTeX");
        return h("div", null,
          m.paper_url
            ? h("a", { href: m.paper_url, target: "_blank", rel: "noopener noreferrer", style: { fontWeight: "700" } }, `${m.paper_label || "Paper"} ↗`)
            : (m.paper_label || "—"),
          m.paper_url ? h("div", { class: "small muted mono", style: { fontSize: "0.72rem", marginTop: "2px", wordBreak: "break-all" } },
            m.paper_url.replace(/^https?:\/\/(doi\.org\/)?/i, "")) : null,
          copyBtn);
      }],
      ["Clinical Summary", m => h("p", { class: "small", style: { color: "var(--ink-2)" } }, m.notes)]
    ];

    dlg.replaceChildren(
      h("div", { class: "cmp-modal-in" },
        h("div", { class: "cmp-modal-head" },
          h("div", null,
            h("h2", { id: "cmpTitle" }, `Side-by-Side 3D Model Comparison (${list.length} / 4)`),
            h("p", { class: "small muted" }, "Comparing modality, 3D input voxel grid, VRAM requirement, architecture, portal tasks, licence, HF gating, and verified DOI.")),
          h("div", { class: "cmp-modal-tools" },
            addSelect,
            h("button", { class: "btn ghost small", type: "button", onclick: () => exportModelsBibtex(list, "neurorad_fm_compared.bib") }, `↓ Export BibTeX (${list.length} .bib)`),
            h("button", { class: "btn ghost small", type: "button", onclick: () => exportModelsCsv(list, "neurorad_fm_compared.csv") }, `↓ Export CSV (${list.length})`),
            h("button", { class: "icon-btn", type: "button", "aria-label": "Close comparison modal", onclick: () => dlg.close() }, "✕"))),
        h("div", { class: "cmp-table-wrap" },
          h("table", { class: "cmp-table" },
            h("thead", null, h("tr", null, headCells)),
            h("tbody", null, specRows.map(([label, cellFn]) =>
              h("tr", null, h("th", { scope: "row" }, label), ...list.map(m => h("td", null, cellFn(m))))))))
      )
    );
  }

  /* ── catalogue & clinical scenario quick-filter chips ───────────────────── */
  function activeScenarioObj() {
    return CLINICAL_SCENARIOS.find(s => s.id === S.filter.scenario) || CLINICAL_SCENARIOS[0];
  }

  function hasActiveFilters() {
    const f = S.filter;
    return Boolean(f.q || f.scenario !== "all" || f.cat !== "all" || f.modality !== "all" || f.commercial || f.ungated || f.ready || f.hwFit);
  }

  function resetAllFilters() {
    S.filter = { q: "", scenario: "all", cat: "all", modality: "all", commercial: false, ungated: false, ready: false, hwFit: false };
    $("#q").value = "";
    $("#fCommercial").checked = false;
    $("#fUngated").checked = false;
    $("#fReady").checked = false;
    $("#fHw").checked = false;
    syncSearchKbdHints();
    renderFilters();
    renderCatalogue();
  }

  function matches(m) {
    const f = S.filter;
    const sc = activeScenarioObj();
    if (!sc.match(m)) return false;
    if (f.cat !== "all" && m.category !== f.cat) return false;
    if (f.modality !== "all" && m.modality !== f.modality) return false;
    if (f.commercial && !m.commercial_use) return false;
    if (f.ungated && m.gated) return false;
    if (f.ready && !isReady(m)) return false;
    if (f.hwFit && fitOf(m).level !== "ok") return false;
    if (f.q) {
      const hay = `${m.name} ${m.developer} ${m.arch} ${m.notes} ${m.licence} ${m.seq_hint || ""} ${m.paper_label || ""} ${m.paper_url || ""} ${m.citation || ""} ${m.hf_repo || ""}`.toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  }

  function renderScenarioChips() {
    const bar = $("#scenarioChips");
    if (!bar || !S.reg) return;
    bar.replaceChildren(...CLINICAL_SCENARIOS.map(sc => {
      const cnt = S.reg.models.filter(sc.match).length;
      return h("button", {
        type: "button",
        class: "scenario-chip",
        "aria-pressed": String(S.filter.scenario === sc.id),
        onclick: () => {
          S.filter.scenario = sc.id;
          S.filter.cat = "all";
          S.filter.modality = "all";
          renderFilters();
          renderCatalogue();
        }
      }, sc.label(S.reg), h("span", { class: "chip-n" }, cnt));
    }));
  }

  function renderFilters() {
    if (!S.reg) return;
    const cats = S.reg.categories;
    const ul = $("#famList");
    ul.replaceChildren();
    const addFam = (key, label, color, n) => {
      const b = h("button", {
        type: "button",
        "aria-pressed": String(S.filter.cat === key),
        onclick: () => { S.filter.cat = key; renderFilters(); renderCatalogue(); }
      },
        color ? h("span", { class: "swatch", style: { background: color } }) : null,
        label, h("span", { class: "n" }, n));
      ul.append(h("li", null, b));
    };
    addFam("all", "All families", null, S.reg.models.length);
    for (const [k, c] of Object.entries(cats)) {
      addFam(k, c.label, `var(--fam-${k})`, S.reg.models.filter(m => m.category === k).length);
    }

    const ml = $("#modList");
    if (ml && S.reg.modalities) {
      ml.replaceChildren();
      const addMod = (key, label, n) => {
        const b = h("button", {
          type: "button",
          "aria-pressed": String(S.filter.modality === key),
          onclick: () => { S.filter.modality = key; renderFilters(); renderCatalogue(); }
        }, label, h("span", { class: "n" }, n));
        ml.append(h("li", null, b));
      };
      addMod("all", "All modalities", S.reg.models.length);
      for (const [k, md] of Object.entries(S.reg.modalities)) {
        addMod(k, md.label, S.reg.models.filter(m => m.modality === k).length);
      }
    }
  }

  function modBadgeLabel(mod) {
    if (mod === "mri_multi") return "3D Brain MRI";
    if (mod === "mri_ct")    return "MRI + Head CT";
    if (mod === "ct")        return "Head CT";
    if (mod === "fmri")      return "4D fMRI / Graph";
    return mod;
  }

  function slideCard(m) {
    const rdy = S.ready[m.id];
    const pinned = isPinned(m.id);
    const spec = [
      m.arch,
      m.embed_dim ? `${m.embed_dim}-d` : null,
      m.voxel_spec || null
    ].filter(Boolean);
    const fit = fitOf(m);
    const wi = weightInfo(m);
    const wBadge = wi
      ? (wi.overall === "cached"  ? h("span", { class: "badge ok", title: "Weights cached on server" }, "Cached")
       : wi.overall === "missing" ? h("span", { class: "badge", title: `${wi.missing_gb} GB to download` }, `${m.weights_gb} GB`)
       : wi.overall === "manual"  ? h("span", { class: "badge warn", title: wi.parts.find(p => p.note)?.note || "" }, "External repo")
       : null)
      : (m.weights_gb ? h("span", { class: "badge", title: "Approximate checkpoint size" }, `~${m.weights_gb} GB`) : null);
    const fitCls = fit.level === "ok" ? "badge ok" : fit.level === "warn" ? "badge warn" : fit.level === "bad" ? "badge bad" : "badge";

    return h("article", { class: `slide fam-${m.category}${pinned ? " is-pinned" : ""}` },
      h("div", { class: "slide-frosted", "aria-hidden": "true" }),
      h("div", { class: "slide-body" },
        h("div", { class: "slide-top" },
          h("div", { style: { minWidth: 0 } },
            h("div", { class: "slide-name" }, m.name),
            h("div", { class: "slide-org" }, m.developer)),
          h("button", {
            class: "pin-btn",
            type: "button",
            "aria-pressed": String(pinned),
            "aria-label": pinned ? `Unpin ${m.name} from comparison` : `Pin ${m.name} to compare (up to 4)`,
            title: pinned ? "Pinned to 3D Comparator (click to unpin)" : "Pin to side-by-side 3D Comparator (up to 4 models)",
            onclick: () => togglePin(m.id)
          }, pinned ? "✓ Pinned" : "+ Compare")),
        h("div", { class: "slide-spec" }, spec.map((s, i) => h("span", null, i ? "· " + s : s))),
        h("p", { class: "slide-notes" }, m.notes),
        h("div", { class: "badges" },
          m.modality ? h("span", { class: `badge mod-${m.modality}`, title: m.seq_hint || "" }, modBadgeLabel(m.modality)) : null,
          h("span", { class: m.commercial_use ? "badge ok" : "badge" }, m.commercial_use ? "Commercial OK" : m.licence),
          m.gated ? h("span", { class: "badge warn", title: "Accept licence on Hugging Face before downloading" }, "Gated HF") : null,
          h("span", { class: fitCls, title: fit.detail }, fit.short),
          wBadge,
          S.mode !== "demo" && rdy ? h("span", { class: rdy.ready ? "badge accent" : "badge", title: rdy.reason || "" }, rdy.ready ? "Server ready" : "Setup needed") : null),
        h("div", { class: "slide-actions" },
          h("button", { class: "link-btn", type: "button", onclick: () => openInRun(m.id) }, "Run →"),
          m.paper_url ? h("a", { class: "paper-chip", href: m.paper_url, target: "_blank", rel: "noopener noreferrer", title: m.citation || m.paper_label }, `📄 ${m.paper_label || "Paper"}`) : null,
          h("button", { class: "link-btn muted", type: "button", onclick: () => openDrawer(m) }, "Details & CLI"))));
  }

  function renderRackToolbar(shown) {
    const bar = $("#rackToolbar");
    if (!bar || !S.reg) return;
    const total = S.reg.models.length;
    const filtered = hasActiveFilters();

    bar.replaceChildren(
      h("div", { class: "rack-status" },
        h("span", null,
          "Showing ", h("strong", null, shown.length), ` of ${total} neuroimaging models`),
        filtered ? h("button", {
          class: "link-btn",
          type: "button",
          onclick: resetAllFilters
        }, "Reset filters") : null),
      h("div", { class: "rack-exports" },
        h("button", {
          class: "btn ghost small",
          type: "button",
          disabled: !shown.length,
          title: "Download BibTeX citations (.bib) for all currently filtered models",
          onclick: () => exportModelsBibtex(shown, filtered ? "neurorad_fm_filtered.bib" : "neurorad_fm_all28.bib")
        }, `↓ Export BibTeX (${shown.length} .bib)`),
        h("button", {
          class: "btn ghost small",
          type: "button",
          disabled: !shown.length,
          title: "Download structured model metadata & hardware specs (.csv) for filtered models",
          onclick: () => exportModelsCsv(shown, filtered ? "neurorad_fm_filtered.csv" : "neurorad_fm_all28.csv")
        }, `↓ Export CSV (${shown.length})`))
    );
  }

  function renderCatalogue() {
    if (!S.reg) return;
    renderScenarioChips();
    const rack = $("#rack");
    rack.replaceChildren();
    const shown = S.reg.models.filter(matches);
    renderRackToolbar(shown);

    const openCnt = S.reg.models.filter(m => !m.gated).length;
    const commCnt = S.reg.models.filter(m => m.commercial_use).length;
    const ctCnt   = S.reg.models.filter(m => m.modality === "ct" || m.modality === "mri_ct").length;
    $("#counts").replaceChildren(
      h("div", null, h("strong", null, S.reg.models.length), "3D neuro FMs"),
      h("div", null, h("strong", null, openCnt), "ungated weights"),
      h("div", null, h("strong", null, ctCnt), "Head CT capable"),
      h("div", null, h("strong", null, commCnt), "permissive licence"));

    if (!shown.length) {
      rack.append(h("div", { class: "empty" },
        "No neuroimaging models match those filters. ",
        h("button", { class: "link-btn", type: "button", onclick: resetAllFilters }, "Reset all filters")));
      return;
    }
    for (const [k, c] of Object.entries(S.reg.categories)) {
      const list = shown.filter(m => m.category === k);
      if (!list.length) continue;
      rack.append(h("section", { class: "group" },
        h("div", { class: "group-head" }, h("h2", null, c.label), h("p", null, c.blurb)),
        h("div", { class: "grid" }, list.map(slideCard))));
    }
  }

  /* ── model detail drawer ────────────────────────────────────────────────── */
  function openDrawer(m) {
    const dlg = $("#drawer");
    const rdy = S.ready[m.id];
    const tasks = m.tasks.map(t => S.reg.tasks[t]?.label || t).join(", ");
    const fit = fitOf(m);
    const wi = weightInfo(m);
    const wLine = wi
      ? (wi.overall === "cached"  ? `Cached on server (~${m.weights_gb} GB)`
       : wi.overall === "missing" ? `Not yet downloaded (~${wi.missing_gb} GB)`
       : wi.overall === "manual"  ? `External repo (~${m.weights_gb} GB) — ${wi.parts.find(p => p.note)?.note || "see repository"}`
       : `~${m.weights_gb} GB`)
      : `~${m.weights_gb} GB${m.runtime_weights_gb > m.weights_gb ? ` (${m.runtime_weights_gb} GB incl. companion encoder)` : ""}`;

    const rows = [
      ["Developer", m.developer],
      ["Family", S.reg.categories[m.category]?.label],
      ["Modality", S.reg.modalities?.[m.modality]?.label || m.modality],
      ["Recommended input", m.seq_hint || "3D NIfTI (.nii.gz)"],
      ["Architecture", m.arch],
      ["Embedding dim", m.embed_dim || "Task-specific (segmentation / synthesis)"],
      ["Voxel geometry", m.voxel_spec],
      ["Weights", wLine],
      ["Hardware fit", `${fit.short} — ${fit.detail}`],
      fit.measuredLine ? ["Measured speed", fit.measuredLine] : null,
      ["Tasks in portal", tasks],
      ["Licence", `${m.licence}${m.commercial_use ? " (commercial use allowed)" : " (research / non-commercial — check card)"}`],
      ["HF access", m.gated ? "Gated — accept terms on Hugging Face & pass token" : (m.hf_repo ? "Public Hugging Face download" : "Public GitHub / package checkpoint")],
      ["Paper", m.paper_url ? h("a", { href: m.paper_url, target: "_blank", rel: "noopener noreferrer" }, `${m.paper_label || "Read paper"} ↗`) : "—"],
      ["Weights / code", h("a", { href: m.link, target: "_blank", rel: "noopener noreferrer" }, m.hf_repo || m.link)],
      S.mode !== "demo" && rdy ? ["Server status", rdy.ready ? "Ready" : rdy.reason] : null
    ].filter(Boolean);

    const cliTxt = quickstartSnippet(m);
    const bibTxt = bibtexFor(m);

    const copyCliBtn = h("button", {
      class: "cli-copy", type: "button",
      onclick: () => {
        navigator.clipboard?.writeText(cliTxt);
        copyCliBtn.textContent = "Copied!";
        setTimeout(() => { copyCliBtn.textContent = "Copy"; }, 1400);
      }
    }, "Copy");

    const copyBibBtn = h("button", {
      class: "btn ghost small", type: "button",
      onclick: () => {
        navigator.clipboard?.writeText(bibTxt);
        copyBibBtn.textContent = "BibTeX copied!";
        setTimeout(() => { copyBibBtn.textContent = "Copy BibTeX"; }, 1400);
      }
    }, "Copy BibTeX");

    const pinDrawerBtn = h("button", {
      class: "btn ghost small", type: "button",
      "aria-pressed": String(isPinned(m.id)),
      onclick: () => {
        togglePin(m.id);
        const nowPinned = isPinned(m.id);
        pinDrawerBtn.setAttribute("aria-pressed", String(nowPinned));
        pinDrawerBtn.textContent = nowPinned ? "✓ Pinned to Compare" : "+ Pin to Compare";
      }
    }, isPinned(m.id) ? "✓ Pinned to Compare" : "+ Pin to Compare");

    dlg.replaceChildren(h("div", { class: "drawer-in" },
      h("div", { class: "drawer-head" },
        h("div", null, h("h2", { id: "drawerTitle" }, m.name), h("p", { class: "muted small" }, m.developer)),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Close details drawer", onclick: () => dlg.close() }, "✕")),
      h("p", null, m.notes),
      m.citation ? h("p", { class: "small muted" }, "Citation: ", m.citation) : null,
      h("dl", { class: "kv" }, rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
      h("div", null,
        h("h3", { style: { marginBottom: "6px" } }, "Local Python / CLI quickstart"),
        h("div", { class: "cli-wrap" }, copyCliBtn, h("pre", { class: "cmd" }, cliTxt))),
      h("div", { style: { display: "flex", gap: "10px", marginTop: "auto", flexWrap: "wrap" } },
        h("button", { class: "btn", type: "button", onclick: () => { dlg.close(); openInRun(m.id); } }, "Run in portal"),
        pinDrawerBtn,
        m.paper_url ? h("a", { class: "btn ghost small", href: m.paper_url, target: "_blank", rel: "noopener noreferrer" }, `Paper (${m.paper_label}) ↗`) : null,
        copyBibBtn,
        h("a", { class: "btn ghost small", href: m.link, target: "_blank", rel: "noopener noreferrer" }, "Weights / Repo ↗"))));
    if (!dlg.open) dlg.showModal();
  }

  /* ── Papers, Citations & Benchmarks view (focus-preserving search) ──────── */
  function filteredPapers() {
    const q = (S.paperQ || "").toLowerCase();
    return S.reg.models.filter(m => {
      if (!q) return true;
      return `${m.name} ${m.developer} ${m.citation || ""} ${m.paper_label || ""} ${m.paper_url || ""} ${m.modality}`.toLowerCase().includes(q);
    });
  }

  function updatePapersTable() {
    const tblHost = $("#papersTableHost");
    const countEl = $("#papersCountTitle");
    const expBibBtn = $("#papersExportBib");
    const expCsvBtn = $("#papersExportCsv");
    if (!tblHost || !S.reg) return;

    const models = filteredPapers();
    if (countEl) countEl.textContent = `Open-weight brain radiology foundation models (${models.length})`;
    if (expBibBtn) {
      expBibBtn.textContent = `↓ Export BibTeX (${models.length} .bib)`;
      expBibBtn.disabled = !models.length;
    }
    if (expCsvBtn) {
      expCsvBtn.textContent = `↓ Export CSV (${models.length})`;
      expCsvBtn.disabled = !models.length;
    }

    if (!models.length) {
      tblHost.replaceChildren(h("div", { class: "empty" }, "No publications match that filter."));
      return;
    }

    tblHost.replaceChildren(
      h("div", { class: "w-table-wrap" },
        h("table", { class: "tbl w-table" },
          h("thead", null, h("tr", null, ["Model", "Modality", "Family", "Publication / Preprint", "Weights / Code", "BibTeX"].map(c => h("th", null, c)))),
          h("tbody", null, models.map(m => {
            const bibBtn = h("button", {
              class: "btn ghost small", type: "button",
              onclick: () => {
                navigator.clipboard?.writeText(bibtexFor(m));
                bibBtn.textContent = "Copied!";
                setTimeout(() => { bibBtn.textContent = "Copy BibTeX"; }, 1300);
              }
            }, "Copy BibTeX");
            return h("tr", null,
              h("td", null, h("strong", null, m.name), h("div", { class: "small muted" }, m.developer)),
              h("td", null, h("span", { class: `badge mod-${m.modality}` }, modBadgeLabel(m.modality))),
              h("td", { class: "small" }, S.reg.categories[m.category]?.label || m.category),
              h("td", { class: "small" },
                m.paper_url ? h("a", { href: m.paper_url, target: "_blank", rel: "noopener noreferrer" }, `${m.paper_label} ↗`) : (m.paper_label || "—"),
                m.citation ? h("div", { class: "muted", style: { fontSize: "0.78rem" } }, m.citation) : null),
              h("td", { class: "small" }, h("a", { href: m.link, target: "_blank", rel: "noopener noreferrer" }, m.hf_repo || "GitHub / Release")),
              h("td", null, bibBtn)
            );
          }))))
    );
  }

  function renderPapers() {
    const root = $("#papersView");
    if (!root || !S.reg) return;

    if (!$("#papersTableHost")) {
      const searchInput = h("input", {
        id: "paperSearch",
        class: "search",
        type: "search",
        value: S.paperQ,
        placeholder: "Filter papers by model, author, journal, MRI/CT, or DOI…",
        oninput: e => {
          S.paperQ = e.target.value;
          syncSearchKbdHints();
          updatePapersTable();
        }
      });

      const benches = (S.reg.benchmarks || []).map(b =>
        h("div", { class: "bench-card" },
          h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "flex-start" } },
            h("h3", null, b.name),
            h("span", { class: "badge accent" }, b.modality)),
          h("p", null, b.scope),
          h("div", { style: { display: "flex", gap: "12px", marginTop: "auto", paddingTop: "6px", fontSize: "0.83rem" } },
            b.paper_url ? h("a", { href: b.paper_url, target: "_blank", rel: "noopener noreferrer" }, `${b.paper_label || "Paper"} ↗`) : null,
            b.data_url ? h("a", { href: b.data_url, target: "_blank", rel: "noopener noreferrer" }, "Dataset / Challenge ↗") : null)));

      const refs = (S.reg.literature_references || []).map(r =>
        h("div", { class: "bench-card" },
          h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "flex-start" } },
            h("h3", null, r.name),
            h("span", { class: "badge warn" }, r.status)),
          h("div", { class: "small muted" }, r.developer),
          h("p", null, r.scope),
          r.paper_url ? h("a", { class: "small", href: r.paper_url, target: "_blank", rel: "noopener noreferrer", style: { marginTop: "auto" } }, `${r.paper_label || "Reference"} ↗`) : null));

      root.replaceChildren(
        h("div", { style: { marginTop: "20px" } },
          h("h3", { id: "papersCountTitle", style: { marginBottom: "10px" } }, ""),
          h("div", { class: "rack-toolbar", style: { marginBottom: "12px" } },
            h("div", { class: "search-wrap", style: { flex: "1 1 320px", maxWidth: "460px" } },
              h("label", { class: "sr-only", for: "paperSearch" }, "Filter papers (press / to focus)"),
              searchInput,
              h("kbd", { class: "kbd-hint", id: "paperKbdHint", "aria-hidden": "true" }, "/")),
            h("div", { class: "rack-exports" },
              h("button", {
                id: "papersExportBib",
                class: "btn ghost small",
                type: "button",
                onclick: () => exportModelsBibtex(filteredPapers(), S.paperQ ? "neurorad_fm_papers_filtered.bib" : "neurorad_fm_all28.bib")
              }, "↓ Export BibTeX"),
              h("button", {
                id: "papersExportCsv",
                class: "btn ghost small",
                type: "button",
                onclick: () => exportModelsCsv(filteredPapers(), S.paperQ ? "neurorad_fm_papers_filtered.csv" : "neurorad_fm_all28.csv")
              }, "↓ Export CSV"))),
          h("div", { id: "papersTableHost" })),
        benches.length ? h("div", { style: { marginTop: "32px" } },
          h("h3", null, "Key neuroimaging benchmarks & open archives"),
          h("p", { class: "small muted", style: { marginTop: "4px" } }, "Standard 3D tumor, stroke, intracranial hemorrhage, neurodegeneration, and fMRI datasets used to pretrain and evaluate these models."),
          h("div", { class: "bench-grid" }, benches)) : null,
        refs.length ? h("div", { style: { marginTop: "32px" } },
          h("h3", null, "Ecosystem suites & closed-weight literature references"),
          h("p", { class: "small muted", style: { marginTop: "4px" } }, "Core neuroimaging infrastructure and proprietary models included for citation completeness."),
          h("div", { class: "bench-grid" }, refs)) : null
      );
    } else if ($("#paperSearch") && $("#paperSearch").value !== S.paperQ) {
      $("#paperSearch").value = S.paperQ;
    }

    syncSearchKbdHints();
    updatePapersTable();
  }

  /* ── run form ───────────────────────────────────────────────────────────── */
  function openInRun(modelId) {
    const m = S.reg?.models.find(x => x.id === modelId);
    const sc = activeScenarioObj();
    const preferredTask = (m && sc.preferTask && m.tasks.includes(sc.preferTask)) ? sc.preferTask : null;
    go("run");
    $("#rModel").value = modelId;
    onModelChange(preferredTask);
  }

  function renderRunModelOptions() {
    if (!S.reg) return;
    const sel = $("#rModel");
    const cur = sel.value;
    sel.replaceChildren();
    for (const [k, c] of Object.entries(S.reg.categories)) {
      const og = h("optgroup", { label: c.label });
      for (const m of S.reg.models.filter(m => m.category === k)) {
        const suffix = S.mode !== "demo" && S.ready[m.id] && !S.ready[m.id].ready ? " (setup needed)" : "";
        og.append(h("option", { value: m.id }, `${m.name} — ${m.developer}${suffix}`));
      }
      sel.append(og);
    }
    if (cur && S.reg.models.some(m => m.id === cur)) sel.value = cur;
    onModelChange();
  }

  function currentModel() {
    return S.reg.models.find(m => m.id === $("#rModel").value) || S.reg.models[0];
  }
  function currentTask() {
    const b = $("#rTasks button[aria-pressed='true']");
    return b ? b.dataset.task : currentModel().tasks[0];
  }

  function onModelChange(preferredTask) {
    const m = currentModel();
    const rdy = S.ready[m.id];
    const hint = $("#rModelHint");
    hint.textContent = S.mode === "demo"
      ? `${m.arch} · ${m.voxel_spec} · Demo mode synthesizes a 3D brain phantom in your browser.`
      : (rdy && !rdy.ready ? `Not ready on server: ${rdy.reason}` : `${m.arch} · ${m.voxel_spec} · ${m.licence}`);

    const activeTask = (typeof preferredTask === "string" && m.tasks.includes(preferredTask)) ? preferredTask : m.tasks[0];
    const bar = $("#rTasks");
    bar.replaceChildren(...m.tasks.map(t => h("button", {
      type: "button", "data-task": t, "aria-pressed": String(t === activeTask),
      onclick: () => { $$("#rTasks button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.task === t))); onTaskChange(); }
    }, S.reg.tasks[t]?.label || t)));
    onTaskChange();
  }

  function onTaskChange() {
    const m = currentModel(), t = currentTask(), td = S.reg.tasks[t];
    $("#rTaskDesc").textContent = "Produces: " + td.outputs.join(" · ");
    const multi = td.input === "volumes";
    $("#rInputTitle").textContent = multi
      ? (S.mode === "demo" ? "Input cohort volumes (optional in Demo mode)" : "Input cohort volumes (.nii / .nii.gz / slices)")
      : (S.mode === "demo" ? "Input 3D brain scan (optional in Demo mode)" : "Input 3D brain scan (.nii.gz / DICOM / slice)");
    $("#multiVolInput").hidden = !multi;
    $("#singleVolInput").hidden = multi;
    renderParams(m, t);
    renderRunAside(m, t);
  }

  function renderParams(m, t) {
    const box = $("#rParams");
    box.replaceChildren();

    if (t === "zeroshot_neuro") {
      const defaultKey = m.modality === "ct" ? "ct_triage" : "mri_tumor";
      const presetSel = h("select", {
        id: "pPreset",
        onchange: e => {
          const pr = NEURO_PROMPTS[e.target.value];
          if (pr && $("#pPrompts")) $("#pPrompts").value = pr.lines.join("\n");
        }
      }, Object.entries(NEURO_PROMPTS).map(([k, v]) => h("option", { value: k, selected: k === defaultKey }, v.label)));

      box.append(
        h("div", { class: "field", style: { marginBottom: "10px" } },
          h("label", { for: "pPreset" }, "Clinical neuroradiology prompt preset"),
          presetSel),
        h("div", { class: "field" },
          h("label", { for: "pPrompts" }, "Candidate findings or sequences (one per line)"),
          h("textarea", { id: "pPrompts" }, NEURO_PROMPTS[defaultKey].lines.join("\n")),
          h("span", { class: "hint" }, "Each finding is scored against the 3D study or slice volume and softmax-normalized.")));
    } else if (t === "report_vqa") {
      box.append(h("div", { class: "field" },
        h("label", { for: "pClinPrompt" }, "Clinical history / neuroradiology VQA question"),
        h("textarea", { id: "pClinPrompt" }, "62-year-old presenting with subacute headache and left-sided weakness. Evaluate for mass lesion, acute ischemia, hemorrhage, or midline shift."),
        h("span", { class: "hint" }, "Passed alongside the 3D volume to generate Findings, Impression, and a targeted VQA answer.")));
    } else if (t === "brain_health") {
      box.append(h("div", { class: "param-grid" },
        h("div", { class: "field" },
          h("label", { for: "pChronoAge" }, "Chronological age (years, optional)"),
          h("input", { type: "number", id: "pChronoAge", value: 62, min: 1, max: 110 }),
          h("span", { class: "hint" }, "Used to compute individualized Brain-Age Gap (BAG = Predicted − Chronological).")),
        h("div", { class: "field" },
          h("label", { for: "pNormSpace" }, "Preprocessing"),
          h("select", { id: "pNormSpace" },
            h("option", { value: "auto", selected: true }, "Auto RAS+ reorient & z-score"),
            h("option", { value: "native" }, "Already skull-stripped / MNI152")))));
    } else if (t === "synth_register") {
      const opts = m.id === "brainmorph"
        ? ["MNI152 1mm Nonlinear (Diffeomorphic)", "MNI152 1mm Affine", "Rigid AC-PC Alignment"]
        : ["T2-FLAIR (synthesized)", "T1w MPRAGE (synthesized)", "T2w (synthesized)", "Synthetic Head CT (pseudo-CT)"];
      box.append(h("div", { class: "field" },
        h("label", { for: "pTargetMod" }, m.id === "brainmorph" ? "Registration transform" : "Target synthesized sequence"),
        h("select", { id: "pTargetMod" }, opts.map((o, i) => h("option", { value: o, selected: i === 0 }, o)))));
    } else if (t === "segment_brain") {
      box.append(h("div", { class: "param-grid" },
        h("div", { class: "field" },
          h("label", { for: "pSegMode" }, "Segmentation protocol"),
          h("select", { id: "pSegMode" },
            h("option", { value: "auto", selected: true }, "Whole-brain + focal lesion ROI"),
            h("option", { value: "parcellation" }, "Anatomical parcellation only"),
            h("option", { value: "lesion_center" }, "3D center-point lesion prompt"))),
        h("div", { class: "field" },
          h("label", { for: "pFastMode" }, "Resampling"),
          h("select", { id: "pFastMode" },
            h("option", { value: "1mm", selected: true }, "1.0 mm isotropic (standard)"),
            h("option", { value: "fast" }, "1.5–3.0 mm fast preview")))));
    } else if (t === "decode_fmri") {
      box.append(h("div", { class: "param-grid" },
        h("div", { class: "field" },
          h("label", { for: "pAtlas" }, "Parcellation atlas"),
          h("select", { id: "pAtlas" },
            h("option", { value: "AAL-424", selected: true }, "AAL-424 (BrainLM default)"),
            h("option", { value: "Schaefer-400" }, "Schaefer-400 (Yeo-7)"),
            h("option", { value: "MMP-360" }, "HCP-MMP 360"))),
        h("div", { class: "field" },
          h("label", { for: "pTrSec" }, "Repetition time TR (s)"),
          h("input", { type: "number", id: "pTrSec", value: 0.8, step: 0.1, min: 0.2, max: 5.0 }))));
    } else {
      box.append(h("div", { class: "param-grid" },
        h("div", { class: "field" },
          h("label", { for: "pBatch" }, "Batch size (volumes)"),
          h("input", { type: "number", id: "pBatch", value: 2, min: 1, max: 32 }))));
    }
  }

  function collectParams(t) {
    const p = {};
    if ($("#pBatch"))      p.batch_size = +$("#pBatch").value || 2;
    if ($("#pPrompts"))    p.prompts = $("#pPrompts").value.split("\n").map(s => s.trim()).filter(Boolean);
    if ($("#pClinPrompt")) p.clinical_prompt = $("#pClinPrompt").value.trim();
    if ($("#pChronoAge"))  p.chronological_age = +$("#pChronoAge").value || 62;
    if ($("#pNormSpace"))  p.norm_space = $("#pNormSpace").value;
    if ($("#pTargetMod"))  p.target_modality = $("#pTargetMod").value;
    if ($("#pSegMode"))    p.seg_mode = $("#pSegMode").value;
    if ($("#pFastMode"))   p.resampling = $("#pFastMode").value;
    if ($("#pAtlas"))      p.atlas = $("#pAtlas").value;
    if ($("#pTrSec"))      p.tr_sec = +$("#pTrSec").value || 0.8;
    return p;
  }

  function renderRunAside(m, t) {
    const td = S.reg.tasks[t];
    const fit = fitOf(m);
    const wi = weightInfo(m);
    $("#runAside").replaceChildren(
      h("h3", null, m.name),
      h("p", { class: "small muted" }, m.notes),
      m.seq_hint ? h("p", { class: "small" }, h("strong", null, "Expected scan: "), m.seq_hint) : null,
      m.paper_url ? h("p", { class: "small" }, "Paper: ", h("a", { href: m.paper_url, target: "_blank", rel: "noopener noreferrer" }, `${m.paper_label || "Read publication"} ↗`)) : null,
      h("div", null, h("h3", { style: { marginBottom: "6px" } }, "Outputs"),
        h("ul", null, td.outputs.map(o => h("li", null, o)))),
      h("div", null, h("h3", { style: { marginBottom: "4px" } }, "Hardware & weights"),
        h("p", { class: "small muted" }, `${fit.short} — ${fit.detail}`),
        fit.measuredLine ? h("p", { class: "small", style: { marginTop: "4px" } }, fit.measuredLine) : null,
        wi && wi.overall === "missing" ? h("p", { class: "small", style: { marginTop: "4px" } },
          `First run will download ~${wi.missing_gb} GB from Hugging Face (or pre-fetch under Connect).`) : null),
      m.gated ? h("div", { class: "alert warn" },
        "Gated Hugging Face weights: accept the licence on ",
        h("a", { href: m.link, target: "_blank", rel: "noopener noreferrer" }, m.hf_repo || "the model page"),
        " and authenticate via `hf auth login` or add your token under Connect.") : null);
  }

  /* multi-volume drop zone */
  function initDrop() {
    const drop = $("#drop"), inp = $("#volFiles");
    drop.onclick = () => inp.click();
    drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } };
    inp.onchange = () => { addVols(inp.files); inp.value = ""; };
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", e => addVols(e.dataTransfer.files));

    $$("#singleVolInput .seg-ctl button").forEach(b => b.onclick = () => {
      S.volSource = b.dataset.src;
      $$("#singleVolInput .seg-ctl button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      $("#volPathField").hidden = S.volSource !== "path";
      $("#volUploadField").hidden = S.volSource !== "upload";
    });
  }
  function addVols(fileList) {
    for (const f of fileList) S.volFiles.push(f);
    renderVolThumbs();
  }
  function renderVolThumbs() {
    const box = $("#volThumbs");
    box.replaceChildren(...S.volFiles.map((f, i) => {
      const isImg = /^image\//.test(f.type);
      let imgEl = null;
      if (isImg) {
        const blobUrl = URL.createObjectURL(f);
        imgEl = h("img", { src: blobUrl, alt: "", onload: () => URL.revokeObjectURL(blobUrl) });
      }
      return h("span", { class: "thumb" },
        imgEl || h("span", { class: "vol-pill" }, "3D"),
        f.name.slice(0, 24),
        h("button", { type: "button", "aria-label": `Remove ${f.name}`, onclick: () => { S.volFiles.splice(i, 1); renderVolThumbs(); } }, "✕"));
    }));
  }

  async function submitRun(ev) {
    ev.preventDefault();
    const m = currentModel(), t = currentTask(), params = collectParams(t);
    const msg = $("#runMsg"), btn = $("#runBtn");
    msg.textContent = "";

    if (S.mode === "demo") {
      const res = window.Demo.run(m, t, params, { volNames: S.volFiles.map(f => f.name) });
      const job = {
        id: "demo-" + Date.now().toString(36), model_id: m.id, task: t, status: "done",
        stage: "Finished (3D brain phantom demo)", progress: 1, created: Date.now() / 1000, finished: Date.now() / 1000,
        log: [
          "Demo mode — analytical 3D brain phantom (128³ voxels) generated in browser.",
          "Connect a FastAPI backend under Connect to run real NIfTI (.nii.gz) / DICOM inference."
        ],
        result: res
      };
      S.demoJobs.unshift(job);
      S.activeJob = job;
      go("results");
      return;
    }

    const fd = new FormData();
    fd.append("model_id", m.id);
    fd.append("task", t);
    fd.append("params", JSON.stringify(params));
    if (S.reg.tasks[t].input === "volumes") {
      if (!S.volFiles.length) { msg.textContent = "Add at least one NIfTI volume or slice image."; return; }
      S.volFiles.forEach(f => fd.append("volumes", f));
    } else if (S.volSource === "upload") {
      const f = $("#volFile").files[0];
      if (!f) { msg.textContent = "Choose a .nii.gz / .nii / slice file."; return; }
      fd.append("volume", f);
    } else {
      const p = $("#volPath").value.trim();
      if (!p) { msg.textContent = "Enter a NIfTI / DICOM path on the backend server."; return; }
      fd.append("volume_path", p);
    }

    btn.disabled = true; msg.textContent = "Submitting to GPU queue…";
    try {
      const { id } = await api("/api/jobs", { method: "POST", body: fd });
      S.activeJob = { id };
      go("results");
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  /* ── results ────────────────────────────────────────────────────────────── */
  async function refreshJobs() {
    clearTimeout(S.pollTimer);
    let serverJobs = [];
    if (S.mode !== "demo") {
      try { serverJobs = await api("/api/jobs"); } catch {}
    }
    S.jobs = [...S.demoJobs, ...serverJobs];
    renderJobList();

    const target = S.activeJob?.id || S.jobs[0]?.id;
    if (!target) {
      $("#jobView").replaceChildren(h("div", { class: "empty" }, "No neuroimaging jobs yet. Pick a model under Models or Run to test in Demo or Server mode."));
      return;
    }
    await selectJob(target);
  }

  function renderJobList() {
    const ul = $("#jobList");
    ul.replaceChildren(...S.jobs.map(j => {
      const m = S.reg.models.find(x => x.id === j.model_id);
      const st = j.status === "done" ? "ok" : j.status === "failed" ? "bad" : "warn";
      return h("li", null, h("button", {
        class: "jobitem", type: "button",
        "aria-current": String(S.activeJob?.id === j.id),
        onclick: () => selectJob(j.id)
      },
        h("div", { class: "jobitem-top" }, h("span", null, m?.name || j.model_id), h("span", { class: `badge ${st}` }, j.status)),
        h("div", { class: "jobitem-sub" }, h("span", null, S.reg.tasks[j.task]?.label || j.task),
          h("span", null, new Date(j.created * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })))));
    }));
  }

  async function selectJob(id) {
    clearTimeout(S.pollTimer);
    let job = S.demoJobs.find(j => j.id === id);
    if (!job) {
      try { job = await api(`/api/jobs/${id}`); }
      catch (e) { $("#jobView").replaceChildren(h("div", { class: "alert bad" }, e.message)); return; }
    }
    S.activeJob = job;
    renderJobList();
    renderJobDetail(job);
    if (job.status === "queued" || job.status === "running") {
      S.pollTimer = setTimeout(() => selectJob(id), 1500);
    }
  }

  function renderJobDetail(job) {
    const box = $("#jobView");
    const m = S.reg.models.find(x => x.id === job.model_id);
    const head = h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", flexWrap: "wrap", marginBottom: "14px" } },
      h("div", null,
        h("h2", null, `${m?.name || job.model_id} · ${S.reg.tasks[job.task]?.label || job.task}`),
        h("p", { class: "small muted" }, job.stage || job.status)),
      !job.id.startsWith("demo-") && job.status !== "running" ? h("button", {
        class: "btn ghost small", type: "button",
        onclick: async () => { await api(`/api/jobs/${job.id}`, { method: "DELETE" }); S.activeJob = null; refreshJobs(); }
      }, "Delete") : null);

    const prog = (job.status === "queued" || job.status === "running")
      ? h("div", { style: { marginBottom: "16px" } }, h("div", { class: "progress" }, h("div", { style: { width: Math.round((job.progress || 0) * 100) + "%" } })))
      : null;

    const err = job.error ? h("div", { class: "alert bad", style: { marginBottom: "14px" } }, job.error) : null;

    const ctx = {
      fileUrl: name => {
        const f = job.result?.files?.find(x => x.name === name);
        return f?.url || fileUrl(job.id, name);
      }
    };

    const res = job.result;
    const summary = res?.summary?.length
      ? h("div", { class: "summary" }, res.summary.map(s => h("div", null, s.label, h("strong", null, s.value))))
      : null;
    const panels = (res?.panels || []).map(p => window.Viewers.render(p, ctx));
    const dls = res?.files?.length
      ? h("div", { class: "downloads" }, res.files.map(f => h("a", {
          class: "btn ghost small", href: f.url || fileUrl(job.id, f.name), download: f.name
        }, `↓ ${f.label || f.name}`)))
      : null;
    const log = job.log?.length
      ? h("details", { style: { marginTop: "18px" }, open: job.status !== "done" },
          h("summary", { class: "small muted", style: { cursor: "pointer" } }, "Execution log"),
          h("pre", { class: "log" }, job.log.join("\n")))
      : null;

    box.replaceChildren(...[head, prog, err, summary, ...panels, dls, log].filter(Boolean));
  }

  /* ── connect view & weights manager ─────────────────────────────────────── */
  function initConnect() {
    $("#cUrl").value = S.url;
    $("#cKey").value = S.key;
    $("#cRemember").checked = Boolean(localStorage.getItem("neuro_fm_key"));
    $("#cHf").value = S.hf;
    $$("#connForm input[name='mode']").forEach(r => {
      r.checked = r.value === S.mode;
      r.onchange = () => { $("#serverFields").hidden = r.value === "demo"; };
    });
    $("#serverFields").hidden = S.mode === "demo";

    $("#connForm").onsubmit = async e => {
      e.preventDefault();
      S.mode = $("#connForm input[name='mode']:checked").value;
      S.url = ($("#cUrl").value.trim() || "http://127.0.0.1:8000").replace(/\/+$/, "");
      S.key = $("#cKey").value;
      S.hf = $("#cHf").value.trim();
      localStorage.setItem("neuro_fm_mode", S.mode);
      localStorage.setItem("neuro_fm_url", S.url);
      if ($("#cRemember").checked) localStorage.setItem("neuro_fm_key", S.key);
      else localStorage.removeItem("neuro_fm_key");
      sessionStorage.setItem("neuro_fm_hf", S.hf);
      $("#connMsg").textContent = "Testing connection…";
      await probe();
      $("#connMsg").textContent = S.mode === "demo" ? "Using in-browser 3D phantom demo mode." : (S.health?.ok ? "Connected." : S.health?.error || "");
    };

    $("#launchCard").replaceChildren(
      h("h3", null, "Start your local GPU backend"),
      h("p", { class: "small muted" }, "Clone this repository on your workstation or research server and start FastAPI:"),
      h("pre", { class: "cmd" }, [
        "cd backend",
        "pip install -r requirements-server.txt          # mock mode + NIfTI slice preview",
        "# pip install -r requirements.txt               # full PyTorch + MONAI + HF inference",
        "cp config.example.yaml config.yaml              # set portal_key & allowed_scan_roots",
        "python -m uvicorn server:app --host 127.0.0.1 --port 8000"
      ].join("\n")),
      h("p", { class: "small muted" },
        "Want to verify all 28 models without downloading weights? Set ",
        h("code", null, "PORTAL_MOCK=1"),
        " to run the backend's analytical 3D brain phantom pipeline end-to-end."));
  }

  function renderServerBox() {
    const box = $("#serverStatus");
    if (S.mode === "demo") {
      box.replaceChildren(h("h3", null, "Server status"),
        h("p", { class: "small muted" }, "Demo mode is active — analytical 3D brain MRI/CT phantoms are generated in your browser. Switch to My GPU server to run real NIfTI/DICOM inference."));
      return;
    }
    if (!S.health) return;
    if (S.health.error) {
      box.replaceChildren(h("h3", null, "Server status"),
        h("div", { class: "alert bad" }, S.health.error),
        h("p", { class: "small muted" }, "Ensure uvicorn is running and CORS origins in config.yaml include this page's origin."));
      return;
    }
    const pkgs = Object.entries(S.health.packages || {}).map(([k, ok]) =>
      h("span", { class: ok ? "badge ok" : "badge" }, `${k}${ok ? " ✓" : " —"}`));
    const readyCount = Object.values(S.ready).filter(r => r.ready).length;
    const hw = S.health.hardware || {};
    const gpuList = hw.gpus?.length ? hw.gpus : (hw.driver_gpus || []);
    const gpuLine = gpuList.length
      ? gpuList.map(g => `${g.name} (${g.vram_total_gb} GB${g.vram_free_gb != null ? `, ${g.vram_free_gb} GB free` : ""})`).join("; ")
      : (hw.mps_available ? "Apple Silicon MPS" : (S.health.gpu || "None usable by PyTorch"));
    box.replaceChildren(
      h("h3", null, "Server status"),
      h("dl", { class: "kv" },
        h("dt", null, "Execution"), h("dd", null, S.health.mock ? "Mock mode (3D analytical phantom)" : `Real inference on ${S.health.device}`),
        h("dt", null, "GPU"), h("dd", null, gpuLine),
        h("dt", null, "CPU / RAM"), h("dd", null, `${hw.cpu_cores || "?"} cores · ${hw.ram_total_gb ? hw.ram_total_gb + " GB RAM" : "—"}`),
        h("dt", null, "HF cache"), h("dd", null, `${S.health.hf_cache || "default"}${hw.weights_disk_free_gb != null ? ` (${hw.weights_disk_free_gb} GB free)` : ""}`),
        h("dt", null, "HF login"), h("dd", null, S.health.hf_logged_in ? "Logged in on server" : (S.hf ? "Using browser token" : "Not logged in (public models still work)")),
        h("dt", null, "Models ready"), h("dd", null, `${readyCount} / ${S.reg.models.length}`),
        h("dt", null, "Scan roots"), h("dd", null, S.health.scan_roots?.length ? S.health.scan_roots.join(", ") : "None (browser upload only)")),
      ...(hw.warnings || []).map(w => h("div", { class: "alert warn" }, w)),
      h("div", null, h("div", { class: "small muted", style: { marginBottom: "6px" } }, "Installed neuroimaging packages"), h("div", { class: "badges" }, pkgs)));
  }

  function renderWeightsBox() {
    const card = $("#weightsCard");
    if (!card) return;
    clearTimeout(S.weightsTimer);
    if (S.mode === "demo" || !S.health?.ok) { card.hidden = true; return; }
    card.hidden = false;

    const models = S.reg.models;
    const cachedN = models.filter(m => S.weights[m.id]?.overall === "cached").length;
    const cachedGb = models.filter(m => S.weights[m.id]?.overall === "cached").reduce((s, m) => s + (m.weights_gb || 0), 0);
    const totalGb = models.reduce((s, m) => s + (m.weights_gb || 0), 0);
    const anyActive = Object.values(S.weights).some(w => w.download === "queued" || w.download === "downloading");

    const checkBtn = h("button", {
      class: "btn ghost small", type: "button",
      onclick: async () => {
        checkBtn.disabled = true; checkBtn.textContent = "Checking HF access…";
        try {
          await api("/api/weights/access", { method: "POST" });
          S.weights = await api("/api/weights");
          renderWeightsBox(); renderCatalogue();
        } finally { checkBtn.disabled = false; checkBtn.textContent = "Check gated HF access"; }
      }
    }, "Check gated HF access");

    const rows = models.map(m => {
      const w = S.weights[m.id] || { overall: "unknown", parts: [], download: "idle" };
      const stBadge = w.overall === "cached"  ? h("span", { class: "badge ok" }, "On server")
                    : w.overall === "partial" ? h("span", { class: "badge warn" }, "Partial")
                    : w.overall === "manual"  ? h("span", { class: "badge warn" }, "External repo")
                    : w.overall === "missing" ? h("span", { class: "badge" }, "Not downloaded")
                    : h("span", { class: "badge" }, "Unknown");

      const acc = w.parts.map(p => p.access);
      const accCell = !m.gated ? (m.hf_repo ? "Public HF" : "GitHub / pip")
        : acc.includes("no-access") ? h("a", { href: m.link, target: "_blank", rel: "noopener noreferrer", class: "badge warn" }, "Request on HF ↗")
        : acc.includes("ok") ? h("span", { class: "badge ok" }, "Granted")
        : "Gated (unchecked)";

      let act;
      if (w.download === "downloading" || w.download === "queued") {
        act = h("span", { class: "small muted" }, `${w.download === "queued" ? "Queued" : "Downloading"}… ${Math.round((w.progress || 0) * 100)}%`);
      } else if (w.overall === "cached") {
        act = h("span", { class: "small muted" }, "✓ Ready");
      } else if (w.overall === "manual") {
        act = h("a", { class: "small", href: m.link, target: "_blank", rel: "noopener noreferrer" }, "Instructions ↗");
      } else {
        act = h("button", {
          class: "btn ghost small", type: "button",
          onclick: async () => {
            S.weights[m.id] = await api(`/api/weights/${m.id}/download`, { method: "POST" });
            renderWeightsBox();
          }
        }, `Download (${w.missing_gb || m.weights_gb} GB)`);
      }

      return h("tr", null,
        h("td", null, h("strong", null, m.name),
          w.download === "error" && w.message ? h("div", { class: "small", style: { color: "var(--bad)" } }, w.message) : null),
        h("td", { class: "num" }, m.weights_gb ? `${m.weights_gb} GB` : "—"),
        h("td", null, accCell),
        h("td", null, stBadge),
        h("td", null, act));
    });

    card.replaceChildren(
      h("div", { class: "panel-head", style: { marginBottom: 0 } },
        h("div", null, h("h3", null, "Model weights on this server"),
          h("p", { class: "small muted" }, `Stored in the standard Hugging Face cache (${S.health.hf_cache || "~/.cache/huggingface/hub"}) — never inside git.`)),
        checkBtn),
      h("div", { class: "w-summary" },
        h("span", null, h("strong", null, `${cachedN} / ${models.length}`), " cached on server"),
        h("span", null, h("strong", null, `${cachedGb.toFixed(1)} GB`), ` cached (all ${models.length} models: ~${totalGb.toFixed(0)} GB)`),
        S.health.hardware?.weights_disk_free_gb != null
          ? h("span", null, h("strong", null, `${S.health.hardware.weights_disk_free_gb} GB`), " free disk space") : null),
      h("div", { class: "w-table-wrap" },
        h("table", { class: "tbl w-table" },
          h("thead", null, h("tr", null, ["Model", "Size", "Access", "Cache", ""].map(c => h("th", null, c)))),
          h("tbody", null, rows))));

    if (anyActive) {
      S.weightsTimer = setTimeout(async () => {
        try { S.weights = await api("/api/weights"); renderWeightsBox(); renderCatalogue(); } catch {}
      }, 2000);
    }
  }

  /* ── global keyboard shortcuts (`/` search focus & `Escape` dismissal) ──── */
  function syncSearchKbdHints() {
    const qHint = $("#qKbdHint");
    if (qHint && $("#q")) qHint.hidden = Boolean($("#q").value);
    const pHint = $("#paperKbdHint");
    if (pHint && $("#paperSearch")) pHint.hidden = Boolean($("#paperSearch").value);
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function initKeyboardShortcuts() {
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        hideTip();
        const cmp = $("#compareModal");
        const drw = $("#drawer");
        if (cmp?.open) { cmp.close(); return; }
        if (drw?.open) { drw.close(); return; }
        const active = document.activeElement;
        if (active && (active.id === "q" || active.id === "paperSearch")) {
          if (active.value) {
            active.value = "";
            active.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            active.blur();
          }
        }
        return;
      }

      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isEditableTarget(e.target)) return;
        if ($("#compareModal")?.open || $("#drawer")?.open) return;
        e.preventDefault();
        if (S.view === "papers") {
          const ps = $("#paperSearch");
          if (ps) { ps.focus(); ps.select(); }
          return;
        }
        if (S.view !== "models") go("models");
        const qInput = $("#q");
        if (qInput) { qInput.focus(); qInput.select(); }
      }
    });
  }

  /* ── boot ───────────────────────────────────────────────────────────────── */
  async function boot() {
    initTheme();
    initKeyboardShortcuts();
    $$("[data-view]").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
    window.addEventListener("hashchange", () => go(location.hash.slice(1)));

    const res = await fetch("models.json");
    S.reg = await res.json();
    const validIds = new Set(S.reg.models.map(m => m.id));
    S.pinned = S.pinned.filter(id => validIds.has(id)).slice(0, 4);
    $("#regDate").textContent = S.reg.version;

    $("#q").oninput = e => {
      S.filter.q = e.target.value;
      syncSearchKbdHints();
      renderCatalogue();
    };
    $("#fCommercial").onchange = e => { S.filter.commercial = e.target.checked; renderCatalogue(); };
    $("#fUngated").onchange = e => { S.filter.ungated = e.target.checked; renderCatalogue(); };
    $("#fReady").onchange = e => { S.filter.ready = e.target.checked; renderCatalogue(); };
    $("#fHw").onchange = e => { S.filter.hwFit = e.target.checked; renderCatalogue(); };
    $("#rModel").onchange = () => onModelChange();
    $("#runForm").onsubmit = submitRun;
    $("#refreshJobs").onclick = refreshJobs;
    $("#drawer").onclick = e => { if (e.target === $("#drawer")) $("#drawer").close(); };
    $("#compareModal").onclick = e => { if (e.target === $("#compareModal")) $("#compareModal").close(); };

    initDrop();
    initConnect();
    renderFilters();
    renderRunModelOptions();
    renderCompareDock();
    go(location.hash.slice(1) || "models");
    window.Hardware.detectBrowser().then(bw => {
      S.browserHw = bw;
      renderHardwareBar();
      renderCatalogue();
      if ($("#compareModal")?.open) renderCompareModal();
    });
    probe();
  }

  boot();
})();
