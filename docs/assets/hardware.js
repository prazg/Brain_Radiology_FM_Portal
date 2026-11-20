/* Hardware detection and model-fit advice for 3D Brain Radiology FMs.
 *
 * Two machines may be involved:
 *   1. "This device" — detected in the browser via WebGL / WebGPU / navigator,
 *      or overridden via the reading-room VRAM profile selector.
 *      Browsers hide exact VRAM, so when a GPU name contains a known NVIDIA/AMD/Intel
 *      chip (RTX 3090/4090/5090, A100, L40S, T4, RX 7900 XTX, etc.) we estimate VRAM
 *      from a lookup table (ordering Laptop variants before desktop chips).
 *   2. "Server" — reported by /api/health via torch.cuda, nvidia-smi, or Apple MPS.
 */
(function () {
  "use strict";

  const GPU_VRAM_HINTS = [
    [/B200/i, 192], [/MI300/i, 192], [/H200/i, 141], [/MI250/i, 128],
    [/H100/i, 80], [/A100.*80/i, 80], [/A800.*80/i, 80], [/MI210/i, 64], [/A100/i, 40], [/A800/i, 40],
    [/RTX\s*PRO\s*6000/i, 96], [/L40S?/i, 48], [/RTX\s*6000\s*Ada/i, 48], [/A6000/i, 48], [/A40\b/i, 48], [/RTX\s*8000/i, 48], [/W7900/i, 48],
    [/RTX\s*5090.*Laptop/i, 24], [/RTX\s*5090/i, 32], [/V100.*32/i, 32], [/W7800/i, 32],
    [/RTX\s*4090.*Laptop/i, 16], [/RTX\s*4090/i, 24], [/RTX\s*3090/i, 24], [/RTX\s*A5000/i, 24],
    [/L4\b/i, 24], [/L20\b/i, 48], [/A30\b/i, 24], [/A10G?/i, 24], [/TITAN\s*RTX/i, 24], [/RX\s*7900\s*XTX/i, 24],
    [/RX\s*7900\s*XT/i, 20], [/RTX\s*4000\s*Ada/i, 20], [/RTX\s*A4500/i, 20],
    [/RTX\s*5080.*Laptop/i, 16], [/RTX\s*5080/i, 16], [/RTX\s*5070\s*Ti/i, 16],
    [/RTX\s*4080.*Laptop/i, 12], [/RTX\s*4080/i, 16], [/RTX\s*4070\s*Ti\s*SUPER/i, 16],
    [/RTX\s*4060\s*Ti.*16/i, 16], [/RTX\s*3080.*Laptop.*16/i, 16], [/RTX\s*A4000/i, 16],
    [/T4\b/i, 16], [/V100/i, 16], [/P100/i, 16], [/A16\b/i, 16],
    [/RX\s*7800\s*XT/i, 16], [/RX\s*6950/i, 16], [/RX\s*6900/i, 16], [/RX\s*6800/i, 16], [/Arc\s*A770/i, 16],
    [/RTX\s*5070(?!\s*Ti)/i, 12], [/RTX\s*4070.*Laptop/i, 8], [/RTX\s*4070/i, 12],
    [/RTX\s*3080.*12/i, 12], [/RTX\s*3060(?!\s*Ti|\s*Laptop)/i, 12], [/TITAN\s*Xp/i, 12],
    [/RX\s*7700\s*XT/i, 12], [/RX\s*6700\s*XT/i, 12], [/Arc\s*B580/i, 12],
    [/RTX\s*3080.*Laptop/i, 8], [/RTX\s*3080/i, 10],
    [/RTX\s*4060/i, 8], [/RTX\s*3070/i, 8], [/RTX\s*3060\s*Ti/i, 8], [/RTX\s*2080/i, 8], [/RTX\s*2070/i, 8],
    [/GTX\s*1080/i, 8], [/GTX\s*1070/i, 8], [/RX\s*7600/i, 8], [/RX\s*6600/i, 8], [/Arc\s*A750/i, 8],
    [/RTX\s*4050/i, 6], [/RTX\s*3060.*Laptop/i, 6], [/RTX\s*3050/i, 6], [/RTX\s*2060/i, 6],
    [/RTX\s*A2000/i, 6], [/GTX\s*1660/i, 6], [/GTX\s*1060/i, 6],
    [/GTX\s*1650/i, 4], [/GTX\s*1050/i, 4], [/T1000/i, 4], [/T600/i, 4], [/MX\d{3}/i, 2]
  ];

  const HW_PROFILES = [
    { id: "auto", label: "Auto-detect device" },
    { id: "cpu",  label: "CPU-only workstation" },
    { id: "8",    label: "8 GB GPU (RTX 4060 / 3070)" },
    { id: "12",   label: "12 GB GPU (RTX 4070 / 3060)" },
    { id: "16",   label: "16 GB GPU (RTX 4080 / T4)" },
    { id: "24",   label: "24 GB GPU (RTX 4090 / L4 / A10G)" },
    { id: "48",   label: "48+ GB GPU (A6000 / L40S / A100)" }
  ];

  function cleanRenderer(raw) {
    if (!raw) return null;
    let s = raw.replace(/^ANGLE \((.+)\)$/, "$1");
    const parts = s.split(",").map(p => p.trim());
    if (parts.length >= 2 && /^(NVIDIA|AMD|ATI|Intel|Apple|Google|Mesa|Microsoft)/i.test(parts[0])) s = parts[1];
    return s.replace(/\s*\(0x[0-9A-Fa-f]+\).*$/, "").replace(/Direct3D.*$/i, "").replace(/\s+/g, " ").trim();
  }

  function guessVram(name) {
    if (!name) return null;
    for (const [re, gb] of GPU_VRAM_HINTS) if (re.test(name)) return gb;
    return null;
  }

  async function detectBrowser() {
    const out = {
      source: "browser",
      cores: navigator.hardwareConcurrency || null,
      ramApproxGb: navigator.deviceMemory || null,
      gpuName: null,
      gpuIntegrated: false,
      gpuApple: false,
      vramGuessGb: null,
      platform: navigator.userAgentData?.platform || navigator.platform || null
    };
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        const raw = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        out.gpuName = cleanRenderer(raw);
      }
    } catch {}
    if (!out.gpuName && navigator.gpu?.requestAdapter) {
      try {
        const a = await navigator.gpu.requestAdapter();
        const info = a?.info || (a?.requestAdapterInfo ? await a.requestAdapterInfo() : null);
        if (info?.description || info?.device) out.gpuName = info.description || info.device;
      } catch {}
    }
    if (out.gpuName) {
      out.gpuApple = /Apple M\d|Apple GPU/i.test(out.gpuName);
      out.gpuIntegrated = /Intel|UHD|Iris|Radeon Graphics|Vega \d|SwiftShader|llvmpipe|Basic Render Driver|Software|VirGL/i.test(out.gpuName) && !/Arc/i.test(out.gpuName);
      out.vramGuessGb = guessVram(out.gpuName);
    }
    return out;
  }

  function tier(model, rules) {
    const gb = model.runtime_weights_gb || model.weights_gb || 0;
    for (const t of rules.tiers) if (gb <= t.max_gb) return t;
    return rules.tiers[rules.tiers.length - 1];
  }

  function minVramGb(model, rules) {
    const gb = model.runtime_weights_gb || model.weights_gb || 0;
    const raw = gb + (rules.vram_headroom_gb || 2.5);
    return Math.max(4, Math.ceil(raw / 2) * 2);
  }

  function minRamGb(model, rules) {
    const gb = model.runtime_weights_gb || model.weights_gb || 0;
    return Math.max(8, Math.ceil(gb * (rules.ram_factor || 2.0) + 4));
  }

  function fitForVramTarget(vramGb, labelPrefix, t, needVram, needRam, wGb, measuredLine) {
    if (vramGb >= needVram) {
      const tight = vramGb < needVram + 2;
      return {
        level: "ok", tier: t, needVram, needRam, measuredLine,
        short: tight ? `Fits ${vramGb} GB (tight)` : `Fits ${vramGb} GB GPU`,
        detail: `${labelPrefix} (${vramGb} GB VRAM) — weights ~${wGb} GB (est. >= ${needVram} GB VRAM${tight ? "; keep batch size = 1" : ""}).`
      };
    }
    if (t.id === "small") {
      return {
        level: "ok", tier: t, needVram, needRam, measuredLine,
        short: "CPU feasible",
        detail: `Weights ~${wGb} GB (${t.cpu})`
      };
    }
    return {
      level: "bad", tier: t, needVram, needRam, measuredLine,
      short: `Needs ~${needVram} GB VRAM`,
      detail: `${labelPrefix} has ${vramGb} GB VRAM; 3D inference + weights (~${wGb} GB) need ~${needVram} GB VRAM.`
    };
  }

  function fit(model, rules, serverHw, browserHw, perf, hwProfile) {
    const t = tier(model, rules);
    const needVram = minVramGb(model, rules);
    const needRam = minRamGb(model, rules);
    const wGb = model.runtime_weights_gb || model.weights_gb || 0;

    const measured = perf?.[model.id];
    let measuredLine = null;
    if (measured) {
      const parts = [];
      for (const [task, devs] of Object.entries(measured)) {
        const d = devs.cuda || devs.cpu;
        if (!d) continue;
        const unit = task === "embed_volumes" ? "scans/s" : "vol/s";
        const bits = [];
        if (d.items_per_s) bits.push(`${d.items_per_s} ${unit}`);
        if (d.peak_vram_gb) bits.push(`peak ${d.peak_vram_gb} GB VRAM`);
        if (bits.length) parts.push(`${task.replace(/_/g, " ")}: ${bits.join(", ")} on ${d.gpu || "CPU"}`);
      }
      if (parts.length) measuredLine = "Measured on this server — " + parts.join("; ");
    }

    if (hwProfile && hwProfile !== "auto") {
      if (hwProfile === "cpu") {
        return {
          level: t.id === "small" ? "ok" : t.id === "medium" ? "warn" : "bad",
          tier: t, needVram, needRam, measuredLine,
          short: t.id === "small" ? "CPU feasible" : t.id === "medium" ? "Slow on CPU" : "GPU required",
          detail: `Target profile: CPU-only (~${needRam} GB system RAM recommended). ${t.cpu}`
        };
      }
      const targetVram = Number(hwProfile) || 24;
      return fitForVramTarget(targetVram, "Selected GPU profile", t, needVram, needRam, wGb, measuredLine);
    }

    if (serverHw) {
      const gpus = (serverHw.gpus && serverHw.gpus.length) ? serverHw.gpus : (serverHw.driver_gpus || []);
      const bestVram = gpus.reduce((m, g) => Math.max(m, g.vram_total_gb || 0), 0);
      const bestGpu = gpus.find(g => g.vram_total_gb === bestVram);
      const ram = serverHw.ram_total_gb;

      if (bestGpu) {
        if (bestVram >= needVram) {
          const tight = bestVram < needVram + 2;
          return {
            level: "ok", tier: t, needVram, needRam, measuredLine,
            short: tight ? "Fits GPU (tight)" : "Fits server GPU",
            detail: `${bestGpu.name} (${bestVram} GB VRAM) — weights ~${wGb} GB${tight ? "; keep sliding-window batch size = 1" : ""}.`
          };
        }
        if (t.id === "small" && (!ram || ram >= needRam)) {
          return {
            level: "ok", tier: t, needVram, needRam, measuredLine,
            short: "CPU feasible",
            detail: `Server GPU has ${bestVram} GB (${bestGpu.name}), but ${model.name} (~${wGb} GB) runs comfortably on server CPU.`
          };
        }
        return {
          level: "bad", tier: t, needVram, needRam, measuredLine,
          short: `Needs ~${needVram} GB VRAM`,
          detail: `Server GPU has ${bestVram} GB (${bestGpu.name}); 3D inference + weights (~${wGb} GB) need ~${needVram} GB VRAM.`
        };
      }

      if (serverHw.mps_available) {
        const mpsFits = !ram || ram >= needRam;
        return {
          level: !mpsFits ? "bad" : (t.id === "xlarge" ? "warn" : "ok"),
          tier: t, needVram, needRam, measuredLine,
          short: !mpsFits ? `Needs ~${needRam} GB unified RAM` : (t.id === "xlarge" ? "Best on CUDA GPU" : "Fits Apple MPS"),
          detail: `Apple Silicon MPS server${ram ? ` (${ram} GB unified memory)` : ""} — weights ~${wGb} GB.`
        };
      }

      const ramBad = ram && ram < needRam;
      if (ramBad) {
        return {
          level: "bad", tier: t, needVram, needRam, measuredLine,
          short: `Needs ~${needRam} GB RAM`,
          detail: `Server has no CUDA GPU and ${ram} GB RAM; loading ~${wGb} GB of weights on CPU needs ~${needRam} GB.`
        };
      }
      return {
        level: t.id === "small" ? "ok" : t.id === "medium" ? "warn" : "bad",
        tier: t, needVram, needRam, measuredLine,
        short: t.id === "small" ? "CPU feasible" : t.id === "medium" ? "Slow on CPU" : "GPU required",
        detail: `No CUDA GPU usable on the server. ${t.cpu}`
      };
    }

    if (browserHw) {
      if (browserHw.vramGuessGb) {
        if (browserHw.vramGuessGb >= needVram) {
          return {
            level: "ok", tier: t, needVram, needRam, measuredLine,
            short: `Likely fits (~${browserHw.vramGuessGb} GB)`,
            detail: `Browser reports ${browserHw.gpuName} (~${browserHw.vramGuessGb} GB VRAM est.); weights ~${wGb} GB. Connect backend to confirm CUDA.`
          };
        }
        if (t.id === "small") {
          return {
            level: "ok", tier: t, needVram, needRam, measuredLine,
            short: "CPU feasible",
            detail: `${browserHw.gpuName} (~${browserHw.vramGuessGb} GB) is small, but ${model.name} (~${wGb} GB) runs on CPU.`
          };
        }
        return {
          level: "warn", tier: t, needVram, needRam, measuredLine,
          short: `Needs ~${needVram} GB VRAM`,
          detail: `This device appears to have ~${browserHw.vramGuessGb} GB (${browserHw.gpuName}); run the backend on a larger GPU for this model.`
        };
      }
      if (browserHw.gpuApple) {
        const lowUnified = browserHw.ramApproxGb && browserHw.ramApproxGb < needRam;
        return {
          level: (t.id === "xlarge" || lowUnified) ? "warn" : "ok",
          tier: t, needVram, needRam, measuredLine,
          short: (t.id === "xlarge" || lowUnified) ? `Best on ${needVram}+ GB GPU` : "Apple Silicon / MPS",
          detail: `${browserHw.gpuName} detected (unified memory). Small/medium 3D encoders and SynthSeg run well locally; large 3D VLMs prefer a 24+ GB CUDA server.`
        };
      }
      if (browserHw.gpuIntegrated || !browserHw.gpuName) {
        return {
          level: t.id === "small" ? "ok" : "warn", tier: t, needVram, needRam, measuredLine,
          short: t.id === "small" ? "CPU feasible" : `Server GPU (~${needVram} GB)`,
          detail: `No discrete GPU detected in browser${browserHw.gpuName ? ` (${browserHw.gpuName})` : ""}. ${t.cpu}`
        };
      }
      if (t.id === "small") {
        return {
          level: "ok", tier: t, needVram, needRam, measuredLine,
          short: "CPU / 6 GB GPU",
          detail: `${browserHw.gpuName} detected (exact VRAM hidden by browser). Lightweight checkpoint (~${wGb} GB) runs on CPU or any 6+ GB GPU.`
        };
      }
      return {
        level: "unknown", tier: t, needVram, needRam, measuredLine,
        short: t.label,
        detail: `${browserHw.gpuName} detected (browsers hide exact VRAM — select a target GPU profile above to check fit). Rule of thumb: ${t.label}, ~${wGb} GB weights.`
      };
    }

    return {
      level: t.id === "small" ? "ok" : "unknown",
      tier: t, needVram, needRam, measuredLine,
      short: t.label, detail: t.cpu
    };
  }

  window.Hardware = { detectBrowser, fit, minVramGb, minRamGb, tier, HW_PROFILES };
})();
