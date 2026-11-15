/* Brain Radiology FM Portal — single-page workstation controller (vanilla JS, zero build step). */
(function () {
  "use strict";
  const { h } = window.Viewers;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const S = {
    reg: null,
    view: "models",
    filter: { q: "", cat: "all", modality: "all", commercial: false, ungated: false, ready: false, hwFit: false },
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

  function bibtexFor(m) {
    const yr = (m.paper_label?.match(/20\d\d/) || ["2025"])[0];
    const firstAuthor = (m.citation || m.developer || "Author").split(",")[0].trim();
    const titlePart = m.citation ? (m.citation.split(",")[1] || m.name).trim() : m.name;
    return [
      `@article{${m.id}_${yr},`,
      `  title   = {${titlePart}},`,
      `  author  = {${firstAuthor} and others},`,
      `  journal = {${m.paper_label || "Preprint"}},`,
      `  year    = {${yr}},`,
      `  url     = {${m.paper_url || m.link}}`,
      `}`
    ].join("\n");
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
  function initTheme() {
    const saved = localStorage.getItem("neuro_fm_theme");
    const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    $("#themeBtn").onclick = () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("neuro_fm_theme", next);
      if (S.activeJob) renderJobDetail(S.activeJob);
    };
  }

  /* ── navigation ─────────────────────────────────────────────────────────── */
  function go(view) {
    if (!["models", "run", "results", "papers", "connect"].includes(view)) view = "models";
    S.view = view;
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
    return window.Hardware.fit(m, S.reg.hardware_rules, S.health?.hardware || null, S.browserHw, S.perf);
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
      const gpu = srv.gpus?.[0];
      parts.push(h("span", null, h("strong", null, "Server: "),
        gpu ? `${gpu.name} (${gpu.vram_total_gb} GB VRAM)` : "CPU only (no CUDA GPU)"),
        h("span", { class: "sep" }, "·"),
        h("span", null, `${srv.cpu_cores || "?"} cores${srv.ram_total_gb ? `, ${srv.ram_total_gb} GB RAM` : ""}`),
        srv.weights_disk_free_gb != null ? [h("span", { class: "sep" }, "·"), h("span", null, `${srv.weights_disk_free_gb} GB free in HF cache`)] : null,
        h("span", { class: "sep" }, "·"),
        h("span", null, h("strong", null, `${fits} of ${total}`), " models fit this server"));
    } else if (br) {
      const gtxt = br.gpuName
        ? `${br.gpuName}${br.vramGuessGb ? ` (~${br.vramGuessGb} GB est.)` : ""}`
        : "GPU hidden by browser";
      parts.push(h("span", null, h("strong", null, "This device: "), gtxt),
        br.cores ? [h("span", { class: "sep" }, "·"), h("span", null, `${br.cores} threads`)] : null,
        h("span", { class: "sep" }, "·"),
        h("span", { class: "muted" }, S.mode === "demo"
          ? "Running in browser Demo mode — connect your GPU server under Connect for real NIfTI inference."
          : "Connect to your server for exact CUDA VRAM and cached weight checks."));
    }

    const warns = (srv?.warnings || []).map(w => h("div", { class: "hw-warn" }, w));
    bar.replaceChildren(...parts.flat().filter(Boolean), ...warns);
    bar.title = rules.source;
  }

  /* ── catalogue ──────────────────────────────────────────────────────────── */
  function matches(m) {
    const f = S.filter;
    if (f.cat !== "all" && m.category !== f.cat) return false;
    if (f.modality !== "all" && m.modality !== f.modality) return false;
    if (f.commercial && !m.commercial_use) return false;
    if (f.ungated && m.gated) return false;
    if (f.ready && !isReady(m)) return false;
    if (f.hwFit && fitOf(m).level !== "ok") return false;
    if (f.q) {
      const hay = `${m.name} ${m.developer} ${m.arch} ${m.notes} ${m.licence} ${m.seq_hint || ""} ${m.paper_label || ""} ${m.citation || ""} ${m.hf_repo || ""}`.toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  }

  function renderFilters() {
    const cats = S.reg.categories;
    const ul = $("#famList");
    ul.replaceChildren();
    const addFam = (key, label, color, n) => {
      const b = h("button", { "aria-pressed": String(S.filter.cat === key), onclick: () => { S.filter.cat = key; renderFilters(); renderCatalogue(); } },
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
        const b = h("button", { "aria-pressed": String(S.filter.modality === key), onclick: () => { S.filter.modality = key; renderFilters(); renderCatalogue(); } },
          label, h("span", { class: "n" }, n));
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

    return h("article", { class: `slide fam-${m.category}` },
      h("div", { class: "slide-frosted", "aria-hidden": "true" }),
      h("div", { class: "slide-body" },
        h("div", { class: "slide-top" },
          h("div", null, h("div", { class: "slide-name" }, m.name), h("div", { class: "slide-org" }, m.developer))),
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
          m.paper_url ? h("a", { class: "paper-chip", href: m.paper_url, target: "_blank", rel: "noopener", title: m.citation || m.paper_label }, `📄 ${m.paper_label || "Paper"}`) : null,
          h("button", { class: "link-btn muted", type: "button", onclick: () => openDrawer(m) }, "Details & CLI"))));
  }

  function renderCatalogue() {
    if (!S.reg) return;
    const rack = $("#rack");
    rack.replaceChildren();
    const shown = S.reg.models.filter(matches);

    const openCnt = S.reg.models.filter(m => !m.gated).length;
    const commCnt = S.reg.models.filter(m => m.commercial_use).length;
    const ctCnt   = S.reg.models.filter(m => m.modality === "ct" || m.modality === "mri_ct").length;
    $("#counts").replaceChildren(
      h("div", null, h("strong", null, S.reg.models.length), "3D neuro FMs"),
      h("div", null, h("strong", null, openCnt), "ungated weights"),
      h("div", null, h("strong", null, ctCnt), "Head CT capable"),
      h("div", null, h("strong", null, commCnt), "permissive licence"));

    if (!shown.length) {
      rack.append(h("div", { class: "empty" }, "No neuroimaging models match those filters."));
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
      ["Paper", m.paper_url ? h("a", { href: m.paper_url, target: "_blank", rel: "noopener" }, `${m.paper_label || "Read paper"} ↗`) : "—"],
      ["Weights / code", h("a", { href: m.link, target: "_blank", rel: "noopener" }, m.hf_repo || m.link)],
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

    dlg.replaceChildren(h("div", { class: "drawer-in" },
      h("div", { class: "drawer-head" },
        h("div", null, h("h2", { id: "drawerTitle" }, m.name), h("p", { class: "muted small" }, m.developer)),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => dlg.close() }, "✕")),
      h("p", null, m.notes),
      m.citation ? h("p", { class: "small muted" }, "Citation: ", m.citation) : null,
      h("dl", { class: "kv" }, rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
      h("div", null,
        h("h3", { style: { marginBottom: "6px" } }, "Local Python / CLI quickstart"),
        h("div", { class: "cli-wrap" }, copyCliBtn, h("pre", { class: "cmd" }, cliTxt))),
      h("div", { style: { display: "flex", gap: "10px", marginTop: "auto", flexWrap: "wrap" } },
        h("button", { class: "btn", type: "button", onclick: () => { dlg.close(); openInRun(m.id); } }, "Run in portal"),
        m.paper_url ? h("a", { class: "btn ghost", href: m.paper_url, target: "_blank", rel: "noopener" }, `Paper (${m.paper_label}) ↗`) : null,
        copyBibBtn,
        h("a", { class: "btn ghost", href: m.link, target: "_blank", rel: "noopener" }, "Weights / Repo ↗"))));
    dlg.showModal();
  }

  /* ── Papers, Citations & Benchmarks view ────────────────────────────────── */
  function renderPapers() {
    const root = $("#papersView");
    if (!root || !S.reg) return;
    const q = (S.paperQ || "").toLowerCase();
    const models = S.reg.models.filter(m => {
      if (!q) return true;
      return `${m.name} ${m.developer} ${m.citation || ""} ${m.paper_label || ""} ${m.modality}`.toLowerCase().includes(q);
    });

    const searchInput = h("input", {
      class: "search", type: "search", value: S.paperQ,
      placeholder: "Filter papers by model, author, journal, MRI/CT, or year…",
      style: { maxWidth: "440px", marginBottom: "14px" },
      oninput: e => { S.paperQ = e.target.value; renderPapers(); }
    });

    const tbl = h("div", { class: "w-table-wrap" },
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
              m.paper_url ? h("a", { href: m.paper_url, target: "_blank", rel: "noopener" }, `${m.paper_label} ↗`) : (m.paper_label || "—"),
              m.citation ? h("div", { class: "muted", style: { fontSize: "0.78rem" } }, m.citation) : null),
            h("td", { class: "small" }, h("a", { href: m.link, target: "_blank", rel: "noopener" }, m.hf_repo || "GitHub / Release")),
            h("td", null, bibBtn)
          );
        }))));

    const benches = (S.reg.benchmarks || []).map(b =>
      h("div", { class: "bench-card" },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "flex-start" } },
          h("h3", null, b.name),
          h("span", { class: "badge accent" }, b.modality)),
        h("p", null, b.scope),
        h("div", { style: { display: "flex", gap: "12px", marginTop: "auto", paddingTop: "6px", fontSize: "0.83rem" } },
          b.paper_url ? h("a", { href: b.paper_url, target: "_blank", rel: "noopener" }, `${b.paper_label || "Paper"} ↗`) : null,
          b.data_url ? h("a", { href: b.data_url, target: "_blank", rel: "noopener" }, "Dataset / Challenge ↗") : null)));

    const refs = (S.reg.literature_references || []).map(r =>
      h("div", { class: "bench-card" },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "flex-start" } },
          h("h3", null, r.name),
          h("span", { class: "badge warn" }, r.status)),
        h("div", { class: "small muted" }, r.developer),
        h("p", null, r.scope),
        r.paper_url ? h("a", { class: "small", href: r.paper_url, target: "_blank", rel: "noopener", style: { marginTop: "auto" } }, `${r.paper_label || "Reference"} ↗`) : null));

    root.replaceChildren(
      h("div", { style: { marginTop: "20px" } },
        h("h3", { style: { marginBottom: "10px" } }, `Open-weight brain radiology foundation models (${models.length})`),
        searchInput,
        tbl),
      benches.length ? h("div", { style: { marginTop: "32px" } },
        h("h3", null, "Key neuroimaging benchmarks & open archives"),
        h("p", { class: "small muted", style: { marginTop: "4px" } }, "Standard 3D tumor, stroke, intracranial hemorrhage, neurodegeneration, and fMRI datasets used to pretrain and evaluate these models."),
        h("div", { class: "bench-grid" }, benches)) : null,
      refs.length ? h("div", { style: { marginTop: "32px" } },
        h("h3", null, "Ecosystem suites & closed-weight literature references"),
        h("p", { class: "small muted", style: { marginTop: "4px" } }, "Core neuroimaging infrastructure and proprietary models included for citation completeness."),
        h("div", { class: "bench-grid" }, refs)) : null
    );
  }

  /* ── run form ───────────────────────────────────────────────────────────── */
  function openInRun(modelId) {
    go("run");
    $("#rModel").value = modelId;
    onModelChange();
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

  function onModelChange() {
    const m = currentModel();
    const rdy = S.ready[m.id];
    const hint = $("#rModelHint");
    hint.textContent = S.mode === "demo"
      ? `${m.arch} · ${m.voxel_spec} · Demo mode synthesizes a 3D brain phantom in your browser.`
      : (rdy && !rdy.ready ? `Not ready on server: ${rdy.reason}` : `${m.arch} · ${m.voxel_spec} · ${m.licence}`);

    const bar = $("#rTasks");
    bar.replaceChildren(...m.tasks.map((t, i) => h("button", {
      type: "button", "data-task": t, "aria-pressed": String(i === 0),
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
      m.paper_url ? h("p", { class: "small" }, "Paper: ", h("a", { href: m.paper_url, target: "_blank", rel: "noopener" }, `${m.paper_label || "Read publication"} ↗`)) : null,
      h("div", null, h("h3", { style: { marginBottom: "6px" } }, "Outputs"),
        h("ul", null, td.outputs.map(o => h("li", null, o)))),
      h("div", null, h("h3", { style: { marginBottom: "4px" } }, "Hardware & weights"),
        h("p", { class: "small muted" }, `${fit.short} — ${fit.detail}`),
        fit.measuredLine ? h("p", { class: "small", style: { marginTop: "4px" } }, fit.measuredLine) : null,
        wi && wi.overall === "missing" ? h("p", { class: "small", style: { marginTop: "4px" } },
          `First run will download ~${wi.missing_gb} GB from Hugging Face (or pre-fetch under Connect).`) : null),
      m.gated ? h("div", { class: "alert warn" },
        "Gated Hugging Face weights: accept the licence on ",
        h("a", { href: m.link, target: "_blank", rel: "noopener" }, m.hf_repo || "the model page"),
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
      return h("span", { class: "thumb" },
        isImg ? h("img", { src: URL.createObjectURL(f), alt: "" }) : h("span", { class: "vol-pill" }, "3D"),
        f.name.slice(0, 24),
        h("button", { type: "button", "aria-label": "Remove", onclick: () => { S.volFiles.splice(i, 1); renderVolThumbs(); } }, "✕"));
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
    const gpuLine = hw.gpus?.length
      ? hw.gpus.map(g => `${g.name} (${g.vram_total_gb} GB${g.vram_free_gb != null ? `, ${g.vram_free_gb} GB free` : ""})`).join("; ")
      : (S.health.gpu || "None usable by PyTorch");
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
        : acc.includes("no-access") ? h("a", { href: m.link, target: "_blank", rel: "noopener", class: "badge warn" }, "Request on HF ↗")
        : acc.includes("ok") ? h("span", { class: "badge ok" }, "Granted")
        : "Gated (unchecked)";

      let act;
      if (w.download === "downloading" || w.download === "queued") {
        act = h("span", { class: "small muted" }, `${w.download === "queued" ? "Queued" : "Downloading"}… ${Math.round((w.progress || 0) * 100)}%`);
      } else if (w.overall === "cached") {
        act = h("span", { class: "small muted" }, "✓ Ready");
      } else if (w.overall === "manual") {
        act = h("a", { class: "small", href: m.link, target: "_blank", rel: "noopener" }, "Instructions ↗");
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

  /* ── boot ───────────────────────────────────────────────────────────────── */
  async function boot() {
    initTheme();
    $$("[data-view]").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
    window.addEventListener("hashchange", () => go(location.hash.slice(1)));

    const res = await fetch("models.json");
    S.reg = await res.json();
    $("#regDate").textContent = S.reg.version;

    $("#q").oninput = e => { S.filter.q = e.target.value; renderCatalogue(); };
    $("#fCommercial").onchange = e => { S.filter.commercial = e.target.checked; renderCatalogue(); };
    $("#fUngated").onchange = e => { S.filter.ungated = e.target.checked; renderCatalogue(); };
    $("#fReady").onchange = e => { S.filter.ready = e.target.checked; renderCatalogue(); };
    $("#fHw").onchange = e => { S.filter.hwFit = e.target.checked; renderCatalogue(); };
    $("#rModel").onchange = onModelChange;
    $("#runForm").onsubmit = submitRun;
    $("#refreshJobs").onclick = refreshJobs;
    $("#drawer").onclick = e => { if (e.target === $("#drawer")) $("#drawer").close(); };

    initDrop();
    initConnect();
    renderFilters();
    renderRunModelOptions();
    go(location.hash.slice(1) || "models");
    window.Hardware.detectBrowser().then(bw => { S.browserHw = bw; renderHardwareBar(); renderCatalogue(); });
    probe();
  }

  boot();
})();
