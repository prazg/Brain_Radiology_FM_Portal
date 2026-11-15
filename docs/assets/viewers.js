/* Result-panel renderers for Brain Radiology FM Portal.
 * Every backend runner and the in-browser Demo return `panels: [...]`;
 * `Viewers.render(panel, ctx)` builds the interactive PACS / quantitative DOM. */
(function () {
  "use strict";

  const CAT = ["#0c7792", "#e07a22", "#16a34a", "#7c3aed", "#e11d48", "#0284c7", "#ca8a04", "#9333ea", "#14b8a6", "#64748b"];

  const STOPS = {
    viridis: [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
    magma:   [[0,0,4],[81,18,124],[183,55,121],[252,137,97],[252,253,191]],
    rdbu:    [[33,102,172],[146,197,222],[247,247,247],[244,165,130],[178,24,43]]
  };

  function ramp(name, t) {
    const s = STOPS[name] || STOPS.viridis;
    const x = Math.max(0, Math.min(1, t)) * (s.length - 1);
    const i = Math.min(s.length - 2, Math.floor(x)), f = x - i;
    return [
      Math.round(s[i][0] + (s[i + 1][0] - s[i][0]) * f),
      Math.round(s[i][1] + (s[i + 1][1] - s[i][1]) * f),
      Math.round(s[i][2] + (s[i + 1][2] - s[i][2]) * f)
    ];
  }

  function hexRgb(hex) {
    const h = (hex || "#38bdf8").replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  let tipEl;
  function tip(ev, text) {
    if (!tipEl) tipEl = document.body.appendChild(h("div", { class: "tip", hidden: true }));
    if (!text) { tipEl.hidden = true; return; }
    tipEl.textContent = text;
    tipEl.hidden = false;
    tipEl.style.left = Math.min(window.innerWidth - 330, ev.clientX + 12) + "px";
    tipEl.style.top = (ev.clientY + 12) + "px";
  }

  function panelShell(title, tools) {
    const body = h("div");
    const root = h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h3", null, title), tools ? h("div", { class: "panel-tools" }, tools) : null),
      body);
    return { root, body };
  }

  function loadImg(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("Could not load slice image"));
      im.src = url;
    });
  }

  function imgToPixels(im) {
    const c = h("canvas", { width: im.naturalWidth, height: im.naturalHeight });
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
  }

  /* ── Tri-planar PACS lightbox (Axial / Coronal / Sagittal + 3D mask overlay) */
  const WL_PRESETS = {
    standard:  { label: "Standard W/L", low: 0,   high: 255, gamma: 1.0, invert: false },
    flair:     { label: "FLAIR / Edema", low: 28, high: 235, gamma: 0.82, invert: false },
    ct_brain:  { label: "Head CT (W80/L40)", low: 45, high: 195, gamma: 0.95, invert: false },
    ct_stroke: { label: "Stroke CT (W40/L40)", low: 72, high: 168, gamma: 0.88, invert: false },
    invert:    { label: "Inverted", low: 0, high: 255, gamma: 1.0, invert: true }
  };

  function renderTriplanar(p, ctx) {
    const hasMasks = Boolean(p.masks && p.masks.axial);
    const labels = p.labels || [];
    const labelById = {};
    for (const lb of labels) labelById[lb.id] = { ...lb, rgb: hexRgb(lb.color) };

    const wlSel = h("select", { "aria-label": "Window/Level preset" },
      Object.entries(WL_PRESETS).map(([k, v]) => h("option", { value: k, selected: k === (p.preset || "standard") }, v.label)));

    const structSel = labels.length ? h("select", { "aria-label": "Highlight structure" },
      h("option", { value: "all" }, "All structures"),
      labels.map(lb => h("option", { value: String(lb.id) }, lb.name))
    ) : null;

    const alphaRange = hasMasks ? h("input", { type: "range", min: 0, max: 100, value: 58, "aria-label": "Mask opacity" }) : null;

    const tools = [
      h("label", null, "Window ", wlSel),
      structSel ? h("label", null, "ROI ", structSel) : null,
      alphaRange ? h("label", null, "Mask ", alphaRange) : null
    ];

    const { root, body } = panelShell(p.title || "Tri-planar 3D view", tools);
    const grid = h("div", { class: "tri-grid" });
    const legend = h("div", { class: "legend" });
    body.append(grid, legend);
    if (p.meta) body.append(h("p", { class: "small muted", style: { marginTop: "8px" } }, p.meta));

    const planeDefs = [
      { key: "axial",    title: "AXIAL (Z)",    orient: "R · L" },
      { key: "coronal",  title: "CORONAL (Y)",  orient: "R · L" },
      { key: "sagittal", title: "SAGITTAL (X)", orient: "A · P" }
    ];

    const panes = planeDefs.map(pd => {
      const cv = h("canvas", { width: 192, height: 192 });
      const pane = h("div", { class: "tri-pane" },
        cv,
        h("span", { class: "tri-label" }, pd.title),
        h("span", { class: "tri-orient" }, pd.orient)
      );
      grid.append(pane);
      return { ...pd, cv, basePx: null, maskPx: null };
    });

    function drawAll() {
      const wl = WL_PRESETS[wlSel.value] || WL_PRESETS.standard;
      const alpha = alphaRange ? (+alphaRange.value) / 100 : 0;
      const onlyId = structSel && structSel.value !== "all" ? +structSel.value : null;

      for (const pn of panes) {
        if (!pn.basePx) continue;
        const { w, h: hh, data } = pn.basePx;
        pn.cv.width = w; pn.cv.height = hh;
        const g = pn.cv.getContext("2d");
        const out = g.createImageData(w, hh);
        const od = out.data;
        const md = pn.maskPx && pn.maskPx.w === w && pn.maskPx.h === hh ? pn.maskPx.data : null;

        const span = Math.max(1, wl.high - wl.low);
        for (let i = 0; i < data.length; i += 4) {
          // Base slice intensity (supports greyscale or RGB heatmap)
          let r = data[i], gg = data[i + 1], b = data[i + 2];
          const isGrey = Math.abs(r - gg) < 4 && Math.abs(gg - b) < 4;
          if (isGrey) {
            let norm = Math.max(0, Math.min(1, (r - wl.low) / span));
            if (wl.gamma !== 1.0) norm = Math.pow(norm, wl.gamma);
            if (wl.invert) norm = 1.0 - norm;
            r = gg = b = Math.round(norm * 255);
          } else if (wl.invert) {
            r = 255 - r; gg = 255 - gg; b = 255 - b;
          }

          if (md && alpha > 0) {
            const lid = md[i]; // R channel stores exact integer label ID (0 = background)
            if (lid > 0 && (onlyId === null || lid === onlyId)) {
              const info = labelById[lid];
              const col = info ? info.rgb : hexRgb(CAT[(lid - 1) % CAT.length]);
              r  = Math.round(r  * (1 - alpha) + col[0] * alpha);
              gg = Math.round(gg * (1 - alpha) + col[1] * alpha);
              b  = Math.round(b  * (1 - alpha) + col[2] * alpha);
            }
          }
          od[i] = r; od[i + 1] = gg; od[i + 2] = b; od[i + 3] = 255;
        }
        g.putImageData(out, 0, 0);
      }

      legend.replaceChildren();
      if (labels.length) {
        for (const lb of labels) {
          legend.append(h("span", null, h("i", { style: { background: lb.color } }), lb.name));
        }
      }
    }

    panes.forEach(pn => {
      const bUrl = ctx.fileUrl(p.planes?.[pn.key]);
      const mUrl = p.masks?.[pn.key] ? ctx.fileUrl(p.masks[pn.key]) : null;
      Promise.all([
        bUrl ? loadImg(bUrl).then(imgToPixels) : Promise.resolve(null),
        mUrl ? loadImg(mUrl).then(imgToPixels).catch(() => null) : Promise.resolve(null)
      ]).then(([bPx, mPx]) => {
        pn.basePx = bPx;
        pn.maskPx = mPx;
        drawAll();
      }).catch(() => {
        pn.cv.replaceWith(h("p", { class: "small muted", style: { padding: "24px" } }, "Slice unavailable"));
      });

      pn.cv.addEventListener("mousemove", ev => {
        if (!pn.basePx) return;
        const r = pn.cv.getBoundingClientRect();
        const x = Math.max(0, Math.min(pn.basePx.w - 1, Math.floor((ev.clientX - r.left) / r.width * pn.basePx.w)));
        const y = Math.max(0, Math.min(pn.basePx.h - 1, Math.floor((ev.clientY - r.top) / r.height * pn.basePx.h)));
        const idx = (y * pn.basePx.w + x) * 4;
        const val = pn.basePx.data[idx];
        let labelTxt = "";
        if (pn.maskPx && pn.maskPx.w === pn.basePx.w) {
          const lid = pn.maskPx.data[idx];
          if (lid > 0) labelTxt = ` · ${labelById[lid]?.name || ("Label " + lid)}`;
        }
        tip(ev, `${pn.title} (${x}, ${y}) · I=${val}${labelTxt}`);
      });
      pn.cv.addEventListener("mouseleave", () => tip(null, null));
    });

    wlSel.onchange = drawAll;
    if (structSel) structSel.onchange = drawAll;
    if (alphaRange) alphaRange.oninput = drawAll;
    return root;
  }

  /* ── Structured Neuroradiology Report & VQA card ───────────────────────── */
  function renderReport(p) {
    const copyBtn = h("button", {
      class: "btn ghost small", type: "button",
      onclick: () => {
        const lines = [
          p.indication ? `CLINICAL INDICATION: ${p.indication}` : null,
          p.technique  ? `TECHNIQUE: ${p.technique}` : null,
          p.findings   ? `\nFINDINGS:\n${p.findings}` : null,
          p.impression ? `\nIMPRESSION:\n${p.impression}` : null,
          p.vqa_answer ? `\nCLINICAL VQA (${p.vqa_question || "Prompt"}):\n${p.vqa_answer}` : null
        ].filter(Boolean).join("\n");
        navigator.clipboard?.writeText(lines);
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy report"; }, 1400);
      }
    }, "Copy report");

    const { root, body } = panelShell(p.title || "Structured neuroradiology report", copyBtn);
    const card = h("div", { class: "rad-report" });
    if (p.indication) card.append(h("div", { class: "rad-sec" }, h("h4", null, "Clinical indication"), h("p", null, p.indication)));
    if (p.technique)  card.append(h("div", { class: "rad-sec" }, h("h4", null, "Technique"), h("p", null, p.technique)));
    if (p.findings)   card.append(h("div", { class: "rad-sec" }, h("h4", null, "Findings"), h("p", null, p.findings)));
    if (p.impression) card.append(h("div", { class: "rad-sec rad-impression" }, h("h4", null, "Impression"), h("p", null, p.impression)));
    if (p.vqa_answer) card.append(h("div", { class: "rad-sec" }, h("h4", null, p.vqa_question ? `VQA — ${p.vqa_question}` : "Clinical VQA Answer"), h("p", null, p.vqa_answer)));
    body.append(card);
    return root;
  }

  /* ── 2D PCA / embedding scatter ────────────────────────────────────────── */
  function renderScatter(p) {
    const { root, body } = panelShell(p.title);
    const W = 540, H = 360, pad = 34;
    const c = h("canvas", { width: W, height: H });
    const pts = p.points || [];
    if (!pts.length) { body.append(h("p", { class: "muted small" }, "Need at least two volumes to project.")); return root; }

    const xs = pts.map(d => d.x), ys = pts.map(d => d.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = x => pad + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
    const sy = y => H - pad - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * pad);

    const g = c.getContext("2d");
    const line = getComputedStyle(document.documentElement).getPropertyValue("--line-2").trim() || "#ccc";
    g.strokeStyle = line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pad, H - pad); g.lineTo(W - pad, H - pad); g.moveTo(pad, pad); g.lineTo(pad, H - pad); g.stroke();

    const groups = [...new Set(pts.map(d => d.group ?? 0))];
    const screen = pts.map(d => ({ sx: sx(d.x), sy: sy(d.y), d }));
    for (const s of screen) {
      g.fillStyle = CAT[groups.indexOf(s.d.group ?? 0) % CAT.length];
      g.beginPath(); g.arc(s.sx, s.sy, 6, 0, Math.PI * 2); g.fill();
    }

    c.addEventListener("mousemove", ev => {
      const r = c.getBoundingClientRect();
      const mx = (ev.clientX - r.left) * (W / r.width), my = (ev.clientY - r.top) * (H / r.height);
      let best = null, bd = 196;
      for (const s of screen) { const d = (s.sx - mx) ** 2 + (s.sy - my) ** 2; if (d < bd) { bd = d; best = s.d; } }
      tip(ev, best ? `${best.label}  (${best.x.toFixed(2)}, ${best.y.toFixed(2)})` : null);
    });
    c.addEventListener("mouseleave", () => tip(null, null));

    body.append(h("div", { class: "canvas-wrap" }, c));
    if (p.axes) body.append(h("div", { class: "legend" }, `${p.axes[0]} vs ${p.axes[1]}`));
    return root;
  }

  /* ── Similarity or functional connectivity matrix ──────────────────────── */
  function renderMatrix(p) {
    const { root, body } = panelShell(p.title);
    const Z = p.values || [], n = Z.length;
    if (!n) return root;
    const cell = Math.max(12, Math.min(34, Math.floor(440 / n)));
    const pad = 118, W = pad + n * cell, H = 18 + n * cell;
    const c = h("canvas", { width: W, height: H });
    const g = c.getContext("2d");
    const flat = Z.flat(), lo = p.min ?? Math.min(...flat), hi = p.max ?? Math.max(...flat);
    const cmap = p.cmap || "viridis";
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const [r, gg, b] = ramp(cmap, (Z[i][j] - lo) / (hi - lo || 1));
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(pad + j * cell, 18 + i * cell, cell - 1, cell - 1);
    }
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink-2").trim() || "#444";
    g.font = "11px JetBrains Mono, monospace"; g.textBaseline = "middle";
    (p.labels || []).forEach((lb, i) => {
      if (cell >= 14 || i % 2 === 0) g.fillText(String(lb).slice(0, 15), 4, 18 + i * cell + cell / 2);
    });
    c.addEventListener("mousemove", ev => {
      const r = c.getBoundingClientRect();
      const j = Math.floor(((ev.clientX - r.left) * (W / r.width) - pad) / cell);
      const i = Math.floor(((ev.clientY - r.top) * (H / r.height) - 18) / cell);
      tip(ev, (i >= 0 && i < n && j >= 0 && j < n) ? `${p.labels?.[i] ?? i} × ${p.labels?.[j] ?? j}: ${Z[i][j].toFixed(3)}` : null);
    });
    c.addEventListener("mouseleave", () => tip(null, null));
    body.append(h("div", { class: "canvas-wrap" }, c));
    return root;
  }

  /* ── Horizontal bars (probabilities, network z-scores, BrainAge metrics) ─ */
  function renderBars(p) {
    const { root, body } = panelShell(p.title);
    const items = p.items || [];
    const max = p.max ?? Math.max(1, ...items.map(d => Math.abs(d.value)));
    body.append(h("div", { class: "bars" }, items.map(d => {
      const pct = Math.max(0, Math.min(100, (Math.abs(d.value) / max) * 100));
      const txt = p.unit === "%" ? (d.value * 100).toFixed(1) + "%" : (typeof d.value === "number" ? d.value.toFixed(p.decimals ?? 3) : String(d.value)) + (p.unit ? " " + p.unit : "");
      return h("div", { class: "bar-row" },
        h("span", { title: d.label }, d.label),
        h("div", { class: "bar-track" }, h("div", { class: "bar-fill", style: { width: pct + "%", background: d.color || null } })),
        h("span", { class: "bar-val" }, txt));
    })));
    return root;
  }

  /* ── 1D embedding barcode ──────────────────────────────────────────────── */
  function renderVector(p) {
    const { root, body } = panelShell(p.title);
    const v = p.values || [], W = 640, H = 68;
    const c = h("canvas", { width: W, height: H });
    const g = c.getContext("2d");
    const m = Math.max(...v.map(Math.abs)) || 1;
    for (let x = 0; x < W; x++) {
      const val = v[Math.floor((x / W) * v.length)] || 0;
      const [r, gg, b] = ramp("rdbu", 0.5 + 0.5 * (val / m));
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(x, 0, 1, H);
    }
    body.append(h("div", { class: "canvas-wrap", style: { minHeight: "auto" } }, c),
      h("div", { class: "legend" }, `${p.dim}-d patient volume embedding (first ${v.length} values shown) · L2 norm ${p.norm?.toFixed(3) ?? "—"}`));
    return root;
  }

  /* ── Table / Image / Note ──────────────────────────────────────────────── */
  function renderTable(p) {
    const { root, body } = panelShell(p.title);
    const cols = p.columns || [];
    body.append(h("div", { style: { overflowX: "auto" } },
      h("table", { class: "tbl" },
        h("thead", null, h("tr", null, cols.map(c => h("th", null, c)))),
        h("tbody", null, (p.rows || []).map(r => h("tr", null, r.map(v =>
          h("td", { class: typeof v === "number" ? "num" : null }, typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(3)) : v))))))));
    return root;
  }

  function renderImage(p, ctx) {
    const { root, body } = panelShell(p.title);
    body.append(h("div", { class: "canvas-wrap" },
      h("img", { src: ctx.fileUrl(p.file), alt: p.title, style: { maxWidth: "100%", maxHeight: "520px" } })));
    if (p.caption) body.append(h("p", { class: "small muted", style: { marginTop: "8px" } }, p.caption));
    return root;
  }

  function renderNote(p) {
    const { root, body } = panelShell(p.title);
    body.append(h("p", { class: "small", style: { color: "var(--ink-2)" } }, p.text));
    return root;
  }

  const DISPATCH = {
    triplanar: renderTriplanar,
    report:    renderReport,
    scatter:   renderScatter,
    matrix:    renderMatrix,
    bars:      renderBars,
    vector:    renderVector,
    table:     renderTable,
    image:     renderImage,
    note:      renderNote
  };

  window.Viewers = {
    h,
    render(panel, ctx) {
      const fn = DISPATCH[panel.type];
      return fn ? fn(panel, ctx) : renderNote({ title: panel.title || panel.type, text: "Unsupported panel type: " + panel.type });
    }
  };
})();
