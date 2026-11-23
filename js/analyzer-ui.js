// Zantiks MWP CSV Analyzer - 5-Step Wizard UI, Plate/Maze Maps, Pure-SVG Charts, Per-Well Table & Exporters
// Classic script: depends on js/analyzer-core.js (window.ZANTIKS_ANALYZER_CORE), js/helpers.js, js/export-utils.js.
"use strict";

(function () {
  const UNASSIGNED = "Unassigned";
  const ALL_WELLS = "All Wells";
  const DEFAULT_PALETTE = [
    "#0969da", "#1a7f37", "#bf8700", "#8250df",
    "#cf222e", "#0e7490", "#bf3989", "#57606a"
  ];
  const UNASSIGNED_COLOR = "#6e7781";

  const ANALYZER_PAGES = [
    { id: "data", label: "Data" },
    { id: "qc", label: "QC" },
    { id: "groups", label: "Groups" },
    { id: "plots", label: "Plots" },
    { id: "export", label: "Export" }
  ];

  function getCore() {
    return window.ZANTIKS_ANALYZER_CORE || null;
  }

  function getPalette() {
    const core = getCore();
    return (core && Array.isArray(core.GROUP_PALETTE) && core.GROUP_PALETTE.length)
      ? core.GROUP_PALETTE
      : DEFAULT_PALETTE;
  }

  // ---------------------------------------------------------------------------
  // 1. UI State
  // ---------------------------------------------------------------------------
  const ui = {
    currentPage: "data",
    summaryParsed: null,
    zchangeParsed: null,
    xyParsed: null,
    context: null,
    contextFilename: "",
    activeDemoId: "",

    groups: {},          // { [wellId]: groupName } (omitted when unassigned)
    groupOrder: [],      // ordered named groups (excluding UNASSIGNED)
    groupColors: {},     // { [groupName]: hex }
    excludedWells: new Set(),
    hiddenGroups: new Set(),

    plateMetric: "totalDist",
    activeBrushGroup: UNASSIGNED,
    brushTool: "group",        // "group" | "exclude"
    selectedWell: null,

    activeChartTab: "timeseries", // "timeseries" | "comparison" | "zchange"
    tsMetric: "dist",
    tsBinGroupSize: 1,
    tsShowSem: true,
    tsShowPhases: true,
    tsShowStim: true,

    compView: "",
    qcFilter: "flagged",
    qcSort: "severity",

    tableGroupFilter: "__ALL__",
    tableStatusFilter: "all",
    tableSortKey: "well",
    tableSortDir: 1,

    prismMetric: "total_dist",
    analysis: null
  };

  // Drag-painting interaction state for Step 3 Group Painter SVG
  let _painting = false;
  let _paintExcludeValue = true;
  let _paintedInStroke = new Set();

  // ---------------------------------------------------------------------------
  // 2. Formatting & Color Helpers
  // ---------------------------------------------------------------------------
  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function fmtNum(val, decimals) {
    if (val === null || val === undefined || !Number.isFinite(Number(val))) return "—";
    const d = decimals !== undefined ? decimals : 1;
    const n = Number(val);
    if (Math.abs(n) >= 1000 && d > 0) return n.toFixed(0);
    return n.toFixed(d);
  }

  function fmtDurationNice(sec) {
    const core = getCore();
    if (core && typeof core.formatDuration === "function") return core.formatDuration(sec);
    if (typeof formatDuration === "function") return formatDuration(sec);
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${String(r).padStart(2, "0")}s`;
  }

  function fmtAxisTime(sec, maxSec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    if (maxSec >= 7200) {
      const h = (s / 3600);
      return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
    }
    if (maxSec >= 180) {
      const m = Math.floor(s / 60);
      const r = s % 60;
      return r === 0 ? `${m}m` : `${m}:${String(r).padStart(2, "0")}`;
    }
    return `${s}s`;
  }

  function getGroupColor(name) {
    if (!name || name === UNASSIGNED) return UNASSIGNED_COLOR;
    if (name === ALL_WELLS) return "#0969da";
    if (ui.groupColors[name]) return ui.groupColors[name];
    const pal = getPalette();
    let idx = ui.groupOrder.indexOf(name);
    if (idx < 0) idx = Object.keys(ui.groupColors).length;
    const col = pal[idx % pal.length];
    ui.groupColors[name] = col;
    return col;
  }

  function hexToRgba(hex, alpha) {
    const clean = String(hex || "#0969da").replace("#", "");
    const full = clean.length === 3
      ? clean.split("").map(c => c + c).join("")
      : clean.padEnd(6, "0").slice(0, 6);
    const num = parseInt(full, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Smooth scientific sequential ramp on light background (#eff6ff -> #93c5fd -> #2563eb -> #1e3a8a)
  function heatColor(tRaw) {
    const t = Math.max(0, Math.min(1, Number.isFinite(tRaw) ? tRaw : 0));
    const stops = [
      [0.00, [239, 246, 255]],
      [0.35, [147, 197, 253]],
      [0.72, [37, 99, 235]],
      [1.00, [30, 58, 138]]
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (t <= t1) {
        const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
        const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
        const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
        return {
          fill: `rgb(${r}, ${g}, ${b})`,
          text: t >= 0.52 ? "#ffffff" : "#1f2328"
        };
      }
    }
    return { fill: "rgb(30, 58, 138)", text: "#ffffff" };
  }

  function phaseBandStyle(span, idx) {
    const hint = String(span.colorHint || span.kind || span.phase || "").toLowerCase();
    if (hint.includes("acclim") || hint.includes("baseline")) {
      return { fill: "rgba(226, 232, 240, 0.42)", text: "#475569" };
    }
    if (hint.includes("dark") || hint === "night") {
      return { fill: "rgba(148, 163, 184, 0.23)", text: "#334155" };
    }
    if (hint.includes("light") || hint.includes("white") || hint === "day") {
      return { fill: "rgba(254, 240, 138, 0.36)", text: "#854d0e" };
    }
    if (hint.includes("ppi")) {
      return { fill: "rgba(221, 214, 254, 0.34)", text: "#5b21b6" };
    }
    if (hint.includes("pulse") || hint.includes("startle") || hint.includes("vib") || hint.includes("tap")) {
      return { fill: "rgba(254, 215, 170, 0.36)", text: "#9a3412" };
    }
    if (hint.includes("blue")) return { fill: "rgba(191, 219, 254, 0.34)", text: "#1e40af" };
    if (hint.includes("green")) return { fill: "rgba(187, 247, 208, 0.34)", text: "#166534" };
    if (hint.includes("red")) return { fill: "rgba(254, 202, 202, 0.30)", text: "#991b1b" };
    if (hint.includes("uv")) return { fill: "rgba(233, 213, 255, 0.34)", text: "#6b21a8" };
    if (hint.includes("temp") || hint.includes("ramp")) return { fill: "rgba(254, 215, 170, 0.28)", text: "#9a3412" };
    return idx % 2 === 0
      ? { fill: "rgba(241, 245, 249, 0.50)", text: "#475569" }
      : { fill: "rgba(226, 232, 240, 0.26)", text: "#475569" };
  }

  function niceTicks(minVal, maxVal, targetCount) {
    const count = Math.max(2, targetCount || 5);
    let lo = Number.isFinite(minVal) ? minVal : 0;
    let hi = Number.isFinite(maxVal) ? maxVal : 1;
    if (hi < lo) { const tmp = lo; lo = hi; hi = tmp; }
    if (Math.abs(hi - lo) < 1e-9) {
      hi = lo === 0 ? 1 : lo * 1.2 + 1;
    }
    const rawStep = (hi - lo) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    let step;
    if (norm <= 1.2) step = 1 * mag;
    else if (norm <= 2.2) step = 2 * mag;
    else if (norm <= 3.5) step = 2.5 * mag;
    else if (norm <= 6.5) step = 5 * mag;
    else step = 10 * mag;

    const tickMin = Math.floor(lo / step) * step;
    const tickMax = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = tickMin; v <= tickMax + step * 0.001 && ticks.length < 16; v += step) {
      ticks.push(Math.abs(v) < 1e-10 ? 0 : Number(v.toPrecision(10)));
    }
    return { min: tickMin, max: tickMax, step, ticks };
  }

  function fmtTick(v, step) {
    if (!Number.isFinite(v)) return "";
    if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1)}k`;
    if (step >= 1 && Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
    if (step >= 0.1) return v.toFixed(1);
    return v.toFixed(2);
  }

  function deterministicJitter(wellId, span) {
    const s = String(wellId || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const u = ((h >>> 0) % 1000) / 1000;
    return (u - 0.5) * 2 * span;
  }

  function toast(msg) {
    if (typeof showToast === "function") {
      showToast(msg);
      return;
    }
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
  }

  function downloadTextFile(text, filename, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    if (typeof triggerDownload === "function") {
      triggerDownload(blob, filename);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  function downloadSvgElement(svgEl, filename) {
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const vb = (clone.getAttribute("viewBox") || "0 0 880 380").split(/\s+/).map(Number);
    const w = vb[2] || 880;
    const h = vb[3] || 380;
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    clone.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", String(vb[0] || 0));
    bg.setAttribute("y", String(vb[1] || 0));
    bg.setAttribute("width", String(w));
    bg.setAttribute("height", String(h));
    bg.setAttribute("fill", "#ffffff");
    clone.insertBefore(bg, clone.firstChild);
    clone.querySelectorAll(".az-hover-ephemeral").forEach(n => n.remove());

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    downloadTextFile(xml, filename, "image/svg+xml;charset=utf-8");
    toast(`Downloaded ${filename}`);
  }

  function positionTooltip(tooltipEl, stageEl, clientX, clientY, html) {
    if (!tooltipEl || !stageEl) return;
    tooltipEl.innerHTML = html;
    tooltipEl.style.display = "block";
    const stageRect = stageEl.getBoundingClientRect();
    const ttRect = tooltipEl.getBoundingClientRect();
    let left = clientX - stageRect.left + 12;
    let top = clientY - stageRect.top - 12;
    if (left + ttRect.width > stageRect.width - 6) {
      left = clientX - stageRect.left - ttRect.width - 12;
    }
    if (left < 6) left = 6;
    if (top + ttRect.height > stageRect.height - 6) {
      top = stageRect.height - ttRect.height - 6;
    }
    if (top < 6) top = 6;
    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
  }

  function hideTooltip(tooltipEl) {
    if (tooltipEl) tooltipEl.style.display = "none";
  }

  function getExportBasename() {
    if (ui.summaryParsed && ui.summaryParsed.filename) {
      return ui.summaryParsed.filename.replace(/\.csv$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_");
    }
    return "zantiks_analysis";
  }

  // ---------------------------------------------------------------------------
  // 3. 5-Step Wizard Navigation & URL Hash Sync
  // ---------------------------------------------------------------------------
  function pageIndexOf(id) {
    return ANALYZER_PAGES.findIndex(p => p.id === id);
  }

  function updateWizardNavControls() {
    const idx = Math.max(0, pageIndexOf(ui.currentPage));
    const last = ANALYZER_PAGES.length - 1;
    const prevBtn = document.getElementById("wizPrevBtn");
    const nextBtn = document.getElementById("wizNextBtn");
    if (prevBtn) {
      prevBtn.disabled = idx === 0;
      prevBtn.textContent = idx === 0 ? "\u2190 Back" : `\u2190 ${ANALYZER_PAGES[idx - 1].label}`;
    }
    if (nextBtn) {
      if (idx === last) {
        nextBtn.textContent = "Export Prism CSV";
        nextBtn.disabled = !ui.summaryParsed;
      } else {
        nextBtn.textContent = `Next: ${ANALYZER_PAGES[idx + 1].label} \u2192`;
        nextBtn.disabled = false;
      }
    }
    setText("wizProgress", `${idx + 1} / ${ANALYZER_PAGES.length}`);
  }

  function goToPage(id, opts) {
    const idx = pageIndexOf(id);
    if (idx < 0) return;
    const changed = ui.currentPage !== id;
    ui.currentPage = id;

    document.querySelectorAll(".wizard-page").forEach(sec => {
      sec.classList.toggle("active", sec.getAttribute("data-page") === id);
    });
    document.querySelectorAll("#analyzerStepper .stepper-item").forEach((btn, i) => {
      btn.classList.toggle("active", i === idx);
      btn.classList.toggle("done", i < idx);
      if (i === idx) btn.setAttribute("aria-current", "step");
      else btn.removeAttribute("aria-current");
    });
    document.querySelectorAll(".run-summary .summary-row").forEach(row => {
      row.classList.toggle("current", row.getAttribute("data-goto") === id);
    });

    updateWizardNavControls();

    try {
      if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
    } catch (_) {}

    if (changed && !(opts && opts.initial)) {
      window.scrollTo(0, 0);
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Data & Context Loaders
  // ---------------------------------------------------------------------------
  function syncGroupRegistryFromMap(groupMap, paletteOverride) {
    const seen = [];
    const set = new Set();
    if (groupMap && typeof groupMap === "object") {
      for (const g of Object.values(groupMap)) {
        const name = String(g || "").trim();
        if (name && name !== UNASSIGNED && name !== ALL_WELLS && !set.has(name)) {
          set.add(name);
          seen.push(name);
        }
      }
    }
    ui.groupOrder = seen;
    ui.groupColors = {};
    const pal = getPalette();
    seen.forEach((name, idx) => {
      ui.groupColors[name] = (paletteOverride && paletteOverride[name]) || pal[idx % pal.length];
    });
    ui.activeBrushGroup = seen.length > 0 ? seen[0] : UNASSIGNED;
    ui.brushTool = "group";
    ui.hiddenGroups.clear();
  }

  function applyLoadedSummary(parsed, opts) {
    ui.summaryParsed = parsed;
    ui.selectedWell = parsed.wells && parsed.wells.length ? parsed.wells[0] : null;
    ui.hiddenGroups.clear();

    if (opts && opts.preserveGroups) {
      const nextGroups = {};
      for (const w of parsed.wells) {
        if (ui.groups[w] && ui.groups[w] !== UNASSIGNED && ui.groups[w] !== ALL_WELLS) {
          nextGroups[w] = ui.groups[w];
        }
      }
      ui.groups = nextGroups;
      ui.excludedWells = new Set([...ui.excludedWells].filter(w => parsed.wells.includes(w)));
    } else if (!opts || !opts.keepExplicitGroups) {
      ui.groups = {};
      ui.groupOrder = [];
      ui.groupColors = {};
      ui.activeBrushGroup = UNASSIGNED;
      ui.excludedWells = new Set();
    }

    if (parsed.hasDist || parsed.hasZoneDist) ui.tsMetric = "dist";
    else if (parsed.hasMsd) ui.tsMetric = "msd";
    else if (parsed.hasZones) ui.tsMetric = "z1_pct";
    else ui.tsMetric = "dist";

    ui.plateMetric = (parsed.hasDist || parsed.hasZoneDist) ? "totalDist" : (parsed.hasMsd ? "meanMsd" : "totalDist");
    ui.tsBinGroupSize = 1;
    const smoothSel = document.getElementById("tsSmoothSel");
    if (smoothSel) smoothSel.value = "1";
    ui.compView = "";
    ui.tableGroupFilter = "__ALL__";
    ui.tableStatusFilter = "all";
  }

  function loadDemoDataset(presetId) {
    const core = getCore();
    if (!core || typeof core.generateDemoDataset !== "function") {
      toast("Analyzer engine not loaded");
      return;
    }
    const demo = core.generateDemoDataset(presetId);
    if (!demo) {
      toast(`Unknown demo preset: ${presetId}`);
      return;
    }

    ui.activeDemoId = presetId;
    ui.xyParsed = null;
    ui.zchangeParsed = null;

    const parsedSummary = core.parseZantiksCsv(demo.summaryCsvText, demo.summaryFilename || `${presetId}.csv`);
    if (demo.zchangeCsvText) {
      ui.zchangeParsed = core.parseZantiksCsv(demo.zchangeCsvText, demo.zchangeFilename || `${presetId}_ZCHANGE.csv`);
    }
    ui.context = demo.experimentContext || (demo.experimentPayload ? core.parseExperimentContext(demo.experimentPayload) : null);
    ui.contextFilename = ui.context ? `${demo.name || presetId} (Demo Context)` : "";

    ui.groups = {};
    for (const w of parsedSummary.wells) {
      const g = demo.defaultGroups && demo.defaultGroups[w];
      if (g && g !== UNASSIGNED && g !== ALL_WELLS) ui.groups[w] = g;
    }
    syncGroupRegistryFromMap(ui.groups, demo.groupPalette);
    ui.excludedWells = new Set(demo.defaultExcluded || []);

    applyLoadedSummary(parsedSummary, { keepExplicitGroups: true });

    const sel = document.getElementById("demoPresetSelect");
    if (sel) sel.value = presetId;

    recomputeAndRender();
    toast(`Loaded demo: ${demo.name || presetId}`);
  }

  function loadLatestBuilderConfig() {
    const core = getCore();
    if (!core || typeof core.loadLatestBuilderContext !== "function") return;
    const ctx = core.loadLatestBuilderContext();
    if (!ctx || !ctx.valid) {
      toast("No saved Script Builder config found in this browser yet.");
      return;
    }
    ui.context = ctx;
    ui.contextFilename = "Latest Builder Config (localStorage)";
    if (ui.summaryParsed) recomputeAndRender();
    else renderAll();
    toast(`Attached Builder config: ${ctx.plateName || ctx.plateId} · ${ctx.stimName || ctx.stimId}`);
  }

  function clearAllData() {
    ui.summaryParsed = null;
    ui.zchangeParsed = null;
    ui.xyParsed = null;
    ui.context = null;
    ui.contextFilename = "";
    ui.activeDemoId = "";
    ui.groups = {};
    ui.groupOrder = [];
    ui.groupColors = {};
    ui.excludedWells = new Set();
    ui.hiddenGroups = new Set();
    ui.selectedWell = null;
    ui.analysis = null;
    ui.compView = "";
    ui.brushTool = "group";
    ui.activeBrushGroup = UNASSIGNED;

    const sel = document.getElementById("demoPresetSelect");
    if (sel) sel.value = "";
    const smoothSel = document.getElementById("tsSmoothSel");
    if (smoothSel) smoothSel.value = "1";
    ui.tsBinGroupSize = 1;

    goToPage("data");
    renderAll();
    toast("Cleared analyzer workspace");
  }

  async function handleIncomingFiles(fileList) {
    const core = getCore();
    if (!core) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;

    let loadedAny = false;
    const msgs = [];

    for (const file of files) {
      const name = file.name || "file";
      try {
        if (/\.zip$/i.test(name)) {
          const buf = await file.arrayBuffer();
          const ctx = await core.loadContextFromZip(buf);
          ui.context = ctx;
          ui.contextFilename = name;
          loadedAny = true;
          msgs.push(`Context (${name})`);
        } else if (/\.json$/i.test(name)) {
          const text = await file.text();
          const obj = JSON.parse(text);
          if (obj && (obj.format === "zantiks-plate-map" || (obj.groups && !obj.experiment))) {
            applyPlateMapObject(obj);
            loadedAny = true;
            msgs.push(`Plate Map (${name})`);
          } else {
            const ctx = core.parseExperimentContext(obj);
            if (ctx && ctx.valid) {
              ui.context = ctx;
              ui.contextFilename = name;
              loadedAny = true;
              msgs.push(`Context (${name})`);
            } else {
              toast(`Unrecognized JSON format in ${name}`);
            }
          }
        } else {
          const text = await file.text();
          const parsed = core.parseZantiksCsv(text, name);
          if (parsed.kind === "summary") {
            const hadSameWells = ui.summaryParsed &&
              ui.summaryParsed.wells.length === parsed.wells.length &&
              ui.summaryParsed.wells.every((w, i) => w === parsed.wells[i]);
            ui.activeDemoId = "";
            const demoSel = document.getElementById("demoPresetSelect");
            if (demoSel) demoSel.value = "";
            applyLoadedSummary(parsed, { preserveGroups: hadSameWells });
            loadedAny = true;
            msgs.push(`Summary CSV (${parsed.wells.length} wells)`);
          } else if (parsed.kind === "zchange") {
            ui.zchangeParsed = parsed;
            loadedAny = true;
            msgs.push(`_ZCHANGE (${parsed.events ? parsed.events.length : parsed.rowCount} events)`);
          } else if (parsed.kind === "xy") {
            ui.xyParsed = parsed;
            loadedAny = true;
            msgs.push(`_XY CSV (${parsed.rowCount} frames)`);
          } else {
            toast(`Could not parse ${name}: missing Zantiks RUNTIME/TIME & metric columns.`);
          }
        }
      } catch (err) {
        toast(`Failed to load ${name}: ${(err && err.message) || "Invalid file"}`);
      }
    }

    if (loadedAny) {
      if (ui.summaryParsed) recomputeAndRender();
      else renderAll();
      if (msgs.length) toast(`Loaded: ${msgs.join(" · ")}`);
    }
  }

  function applyPlateMapObject(obj) {
    if (!obj || typeof obj !== "object") return;
    const rawGroups = obj.groups && typeof obj.groups === "object" ? obj.groups : {};
    const nextGroups = { ...ui.groups };
    for (const [w, g] of Object.entries(rawGroups)) {
      const clean = String(g || "").trim();
      if (clean && clean !== UNASSIGNED && clean !== ALL_WELLS) nextGroups[w] = clean;
      else delete nextGroups[w];
    }
    ui.groups = nextGroups;
    syncGroupRegistryFromMap(ui.groups, obj.groupColors || obj.groupPalette);
    if (Array.isArray(obj.excludedWells)) {
      ui.excludedWells = new Set(obj.excludedWells.map(String));
    }
  }

  function savePlateMapJson() {
    if (!ui.summaryParsed) return;
    const payload = {
      format: "zantiks-plate-map",
      version: 1,
      savedAt: new Date().toISOString(),
      plateId: (ui.analysis && ui.analysis.layout && ui.analysis.layout.id) || "custom",
      groupOrder: [...ui.groupOrder],
      groupColors: { ...ui.groupColors },
      groups: { ...ui.groups },
      excludedWells: [...ui.excludedWells]
    };
    downloadTextFile(
      JSON.stringify(payload, null, 2) + "\n",
      `${getExportBasename()}_plate_map.json`,
      "application/json;charset=utf-8"
    );
    toast("Saved plate map (.json)");
  }

  // ---------------------------------------------------------------------------
  // 5. Core Analysis Recompute & Master Render
  // ---------------------------------------------------------------------------
  function recomputeAndRender() {
    const core = getCore();
    if (!core || !ui.summaryParsed) {
      ui.analysis = null;
      renderAll();
      return;
    }

    ui.analysis = core.computeAnalysis({
      parsed: ui.summaryParsed,
      zchange: ui.zchangeParsed,
      context: ui.context,
      groups: ui.groups,
      excludedWells: ui.excludedWells,
      metric: ui.tsMetric,
      binGroupSize: ui.tsBinGroupSize,
      groupOrder: ui.groupOrder
    });

    if (ui.analysis && ui.analysis.activeMetric) {
      ui.tsMetric = ui.analysis.activeMetric;
    }

    const views = (ui.analysis && ui.analysis.comparisonViews) || [];
    if (!views.some(v => v.id === ui.compView)) {
      if (ui.activeDemoId === "ppi_24w" && views.some(v => v.id === "ppi")) {
        ui.compView = "ppi";
      } else if (ui.activeDemoId === "ymaze_15" && views.some(v => v.id === "sab")) {
        ui.compView = "sab";
      } else if (views.length) {
        ui.compView = views[0].id;
      } else {
        ui.compView = "phase_totals";
      }
    }

    const prismOpts = typeof core.getAvailablePrismMetrics === "function"
      ? core.getAvailablePrismMetrics(ui.analysis)
      : [{ id: "total_dist", label: "Total Distance (mm)" }];
    if (!prismOpts.some(m => m.id === ui.prismMetric)) {
      ui.prismMetric = prismOpts.length ? prismOpts[0].id : "total_dist";
    }

    renderAll();
  }

  function renderAll() {
    const hasSummary = Boolean(ui.summaryParsed && ui.analysis);

    // Toggle empty-state vs content on Steps 2-5
    document.querySelectorAll("[data-requires-csv-empty]").forEach(el => {
      el.style.display = hasSummary ? "none" : "";
    });
    document.querySelectorAll("[data-requires-csv-body]").forEach(el => {
      el.style.display = hasSummary ? "" : "none";
    });

    // Topbar badge
    const modeBadge = document.getElementById("analyzerModeBadge");
    if (modeBadge) {
      if (hasSummary && ui.analysis.layout) {
        modeBadge.textContent = ui.analysis.layout.name || `${ui.summaryParsed.wells.length} Wells`;
      } else if (ui.context && ui.context.plateName) {
        modeBadge.textContent = ui.context.plateName;
      } else {
        modeBadge.textContent = "Offline QC";
      }
    }

    renderStep1Data();
    renderDatasetSummarySidebar();
    updateWizardNavControls();

    if (!hasSummary) return;

    renderKpiStrip();
    renderPlateControls();
    renderAllPlateMaps();
    renderWellInspector();
    renderTempAndQcDiagnostics();
    renderChartToolbars();
    renderAllPlotTabs();
    renderWellTable();
  }

  // ---------------------------------------------------------------------------
  // 6. Step 1: Data & Context Overview + Right Sidebar Dataset Summary
  // ---------------------------------------------------------------------------
  function renderStep1Data() {
    // Active demo card highlight
    document.querySelectorAll("#step1DemoCards [data-demo]").forEach(btn => {
      btn.classList.toggle("active", Boolean(ui.activeDemoId) && btn.getAttribute("data-demo") === ui.activeDemoId);
    });

    // Context badge
    const badge = document.getElementById("contextBadge");
    const badgeText = document.getElementById("contextBadgeText");
    const clearCtxBtn = document.getElementById("clearContextBtn");
    if (badge && badgeText) {
      if (ui.context && ui.context.valid) {
        const c = ui.context;
        const parts = [];
        if (c.plateName || c.plateId) parts.push(c.plateName || c.plateId);
        if (c.stimName || c.stimId) parts.push(c.stimName || c.stimId);
        if (c.organismLabel) parts.push(c.organismLabel);
        if (Number.isFinite(c.targetTempC)) parts.push(`${c.targetTempC.toFixed(1)}°C`);
        if (c.studyTag) parts.push(`#${c.studyTag}`);
        badge.classList.add("is-loaded");
        badgeText.textContent = `Context: ${parts.join(" · ")}`;
        badge.title = ui.contextFilename || "Experiment context loaded";
        if (clearCtxBtn) clearCtxBtn.style.display = "";
      } else {
        badge.classList.remove("is-loaded");
        const core = getCore();
        const hasLocal = Boolean(core && core.loadLatestBuilderContext && core.loadLatestBuilderContext());
        badgeText.textContent = hasLocal
          ? "Builder config available in browser"
          : (ui.summaryParsed ? "Auto-detected from CSV" : "No Builder context attached");
        badge.title = "";
        if (clearCtxBtn) clearCtxBtn.style.display = "none";
      }
    }

    // File chips
    const chipsWrap = document.getElementById("loadedFileChips");
    if (chipsWrap) {
      const chips = [];
      if (ui.summaryParsed) {
        const p = ui.summaryParsed;
        chips.push(
          `<span class="az-file-chip">` +
            `<span class="az-file-chip-kind">CSV</span>` +
            `<span class="az-file-chip-name" title="${esc(p.filename)}">${esc(p.filename)}</span>` +
            `<span class="az-file-chip-meta">${p.wells.length}w · ${p.rowCount} rows</span>` +
            `<button type="button" class="az-file-chip-rm" data-rm-file="summary" aria-label="Remove summary CSV">&times;</button>` +
          `</span>`
        );
      }
      if (ui.zchangeParsed) {
        const z = ui.zchangeParsed;
        const evCount = z.events ? z.events.length : z.rowCount;
        chips.push(
          `<span class="az-file-chip">` +
            `<span class="az-file-chip-kind is-zchange">ZCHANGE</span>` +
            `<span class="az-file-chip-name" title="${esc(z.filename)}">${esc(z.filename)}</span>` +
            `<span class="az-file-chip-meta">${evCount} events</span>` +
            `<button type="button" class="az-file-chip-rm" data-rm-file="zchange" aria-label="Remove ZCHANGE CSV">&times;</button>` +
          `</span>`
        );
      }
      if (ui.xyParsed) {
        const xy = ui.xyParsed;
        chips.push(
          `<span class="az-file-chip">` +
            `<span class="az-file-chip-kind is-xy">XY</span>` +
            `<span class="az-file-chip-name" title="${esc(xy.filename)}">${esc(xy.filename)}</span>` +
            `<span class="az-file-chip-meta">${xy.rowCount} frames</span>` +
            `<button type="button" class="az-file-chip-rm" data-rm-file="xy" aria-label="Remove XY CSV">&times;</button>` +
          `</span>`
        );
      }

      if (chips.length) {
        chipsWrap.innerHTML = chips.join("");
        chipsWrap.querySelectorAll("[data-rm-file]").forEach(btn => {
          btn.addEventListener("click", () => {
            const k = btn.getAttribute("data-rm-file");
            if (k === "summary") {
              ui.summaryParsed = null;
              ui.analysis = null;
              ui.activeDemoId = "";
              const dsel = document.getElementById("demoPresetSelect");
              if (dsel) dsel.value = "";
            } else if (k === "zchange") {
              ui.zchangeParsed = null;
            } else if (k === "xy") {
              ui.xyParsed = null;
            }
            recomputeAndRender();
          });
        });
      } else {
        chipsWrap.innerHTML = `<span class="az-empty-chip-hint">No CSV files loaded yet. Drop files above or pick one of the demo datasets below.</span>`;
      }
    }

    // Overview grid
    const ovGrid = document.getElementById("loadedOverviewGrid");
    if (ui.summaryParsed && ui.analysis) {
      const a = ui.analysis;
      const k = a.kpis;
      const caps = a.capabilities || {};
      const metricTags = [];
      if (caps.hasDist) metricTags.push("DIST");
      if (caps.hasMsd) metricTags.push("MSD");
      if (caps.hasZones) metricTags.push(`Z1–Z${caps.maxZone || 2}`);
      if (caps.hasZchange) metricTags.push("ZCHANGE");

      const first = a.layout.wells[0] || "";
      const last = a.layout.wells[a.layout.wells.length - 1] || "";
      const range = a.layout.wells.length > 1 ? `${first}–${last}` : first;

      setText("loadedOverviewHint", `${a.layout.name || "Plate"} · ${k.rowCount} rows · ${fmtDurationNice(k.durationSec)}`);
      if (ovGrid) {
        ovGrid.style.display = "";
        const phaseTxt = a.phases && a.phases.length ? a.phases.slice(0, 3).join(", ") + (a.phases.length > 3 ? "…" : "") : "Single phase";
        const tempTxt = caps.hasTemp && Number.isFinite(k.tempMean) ? `Temp ${k.tempMean.toFixed(1)} °C` : "No TEMP_C";
        ovGrid.innerHTML =
          `<div class="az-ov-cell"><div class="az-ov-label">Plate / Maze</div><div class="az-ov-val">${esc(a.layout.name || "Plate")}</div><div class="az-ov-sub">${k.totalWells} arena${k.totalWells === 1 ? "" : "s"} (${esc(range)})</div></div>` +
          `<div class="az-ov-cell"><div class="az-ov-label">Rows &amp; Duration</div><div class="az-ov-val">${k.rowCount} rows · ${esc(fmtDurationNice(k.durationSec))}</div><div class="az-ov-sub">${fmtNum(k.binDurationSec, k.binDurationSec >= 10 ? 0 : 1)}s bins</div></div>` +
          `<div class="az-ov-cell"><div class="az-ov-label">Detected Metrics</div><div class="az-ov-val">${esc(metricTags.join(", ") || "Summary")}</div><div class="az-ov-sub">${caps.hasVmr ? "VMR ready" : (caps.hasPpi ? "% PPI ready" : (caps.hasSab ? "SAB % ready" : "Standard tracking"))}</div></div>` +
          `<div class="az-ov-cell"><div class="az-ov-label">Phases &amp; Temp</div><div class="az-ov-val">${esc(phaseTxt)}</div><div class="az-ov-sub">${esc(tempTxt)}</div></div>`;
      }
    } else {
      setText("loadedOverviewHint", ui.context && ui.context.valid ? "Context loaded · waiting for CSV" : "Waiting for CSV");
      if (ovGrid) ovGrid.style.display = "none";
    }
  }

  function renderDatasetSummarySidebar() {
    const a = ui.analysis;
    const p = ui.summaryParsed;

    if (ui.context && ui.context.valid) {
      setText("summaryStatusLine", "Context attached · 100% offline");
    } else if (a) {
      setText("summaryStatusLine", "Live analysis · 100% offline");
    } else {
      setText("summaryStatusLine", "100% offline in this browser");
    }

    if (!a || !p) {
      setText("statActiveWells", "—");
      setText("statDuration", "—");
      setText("statGroups", "—");
      setText("statFlagged", "—");

      setText("sumDataTitle", "No CSV loaded");
      setText("sumDataSub", ui.context && ui.context.valid
        ? `Context: ${ui.context.plateName || ui.context.plateId}`
        : "Drop CSV or pick a demo");
      setText("sumQcTitle", "—");
      setText("sumQcSub", "");
      const qcRow = document.getElementById("sumQcRow");
      if (qcRow) qcRow.classList.remove("has-warn");
      setText("sumGroupsTitle", "—");
      setText("sumGroupsSub", "");
      setText("sumPlotsTitle", "Time Series");
      setText("sumPlotsSub", "Load CSV to plot");
      setText("sumExportTitle", "Prism · CSV · Py");
      setText("sumExportSub", "");
      return;
    }

    const k = a.kpis;
    const grpCount = a.groups ? a.groups.length : 0;
    const unexcludedFlagged = (k.flaggedWells || []).filter(w => !ui.excludedWells.has(w));

    setText("statActiveWells", `${k.activeWells} / ${k.totalWells}`);
    setText("statDuration", fmtDurationNice(k.durationSec));
    setText("statGroups", `${grpCount} group${grpCount === 1 ? "" : "s"}`);
    setText("statFlagged", k.flaggedCount > 0 ? `${k.flaggedCount} flagged` : "0 clean");

    // Row 1: Data
    setText("sumDataTitle", p.filename || "Summary CSV");
    setText("sumDataSub", `${a.layout.name || "Plate"} · ${k.rowCount} rows${ui.zchangeParsed ? " + _ZCHANGE" : ""}`);

    // Row 2: QC
    const qcRow = document.getElementById("sumQcRow");
    if (qcRow) qcRow.classList.toggle("has-warn", unexcludedFlagged.length > 0);
    if (unexcludedFlagged.length > 0) {
      setText("sumQcTitle", `${unexcludedFlagged.length} flagged to review`);
    } else if (k.excludedWells > 0) {
      setText("sumQcTitle", `${k.excludedWells} excluded · clean`);
    } else {
      setText("sumQcTitle", "All wells clean");
    }
    const qcParts = [];
    if (k.emptyCount > 0) qcParts.push(`${k.emptyCount} empty`);
    if (k.spikeCount > 0) qcParts.push(`${k.spikeCount} spike`);
    if (a.capabilities.hasTemp && Number.isFinite(k.tempMean)) qcParts.push(`${k.tempMean.toFixed(1)} °C`);
    setText("sumQcSub", qcParts.join(" · ") || "No anomalies");

    // Row 3: Groups
    const grpNames = (a.groups || []).map(g => g.group);
    setText("sumGroupsTitle", grpNames.length === 1 && grpNames[0] === ALL_WELLS
      ? "All Wells (1 group)"
      : `${grpNames.length} group${grpNames.length === 1 ? "" : "s"}`);
    setText("sumGroupsSub", grpNames.slice(0, 3).join(", ") + (grpNames.length > 3 ? "…" : ""));

    // Row 4: Plots
    const tabLabels = { timeseries: "Time Series", comparison: "Phase & Group", zchange: "Zone Events" };
    setText("sumPlotsTitle", tabLabels[ui.activeChartTab] || "Time Series");
    const tsLbl = (a.timeSeries && a.timeSeries.metricLabel) ? a.timeSeries.metricLabel.split(" ")[0] : "Distance";
    setText("sumPlotsSub", `${tsLbl} · ${ui.tsBinGroupSize}x bin${ui.tsBinGroupSize > 1 ? "s" : ""}`);

    // Row 5: Export
    setText("sumExportTitle", "Ready to export");
    setText("sumExportSub", `${k.activeWells} active wells · Prism / CSV / Py`);
  }

  // ---------------------------------------------------------------------------
  // 7. Step 2: QC KPI Strip
  // ---------------------------------------------------------------------------
  function renderKpiStrip() {
    const a = ui.analysis;
    if (!a) return;
    const k = a.kpis;
    const p = ui.summaryParsed;

    setText("kpiActiveWells", `${k.activeWells} / ${k.totalWells}`);
    const grpCount = a.groups ? a.groups.length : 0;
    setText("kpiActiveWellsSub", `${k.excludedWells} excluded · ${grpCount} group${grpCount === 1 ? "" : "s"}`);

    const emptyWells = (p.qcSummary && p.qcSummary.emptyWells) || [];
    const spikeWells = (p.qcSummary && p.qcSummary.spikeWells) || [];
    const unexcludedEmpty = emptyWells.filter(w => !ui.excludedWells.has(w));
    const unexcludedSpike = spikeWells.filter(w => !ui.excludedWells.has(w));
    const unexcludedFlagged = (k.flaggedWells || []).filter(w => !ui.excludedWells.has(w));

    setText("kpiEmptyCount", String(k.emptyCount));
    setText("kpiEmptyList", emptyWells.length
      ? `${emptyWells.slice(0, 6).join(", ")}${emptyWells.length > 6 ? "…" : ""}${unexcludedEmpty.length === 0 ? " (all excluded)" : ""}`
      : "All wells active");
    const emptyCard = document.getElementById("kpiEmptyCard");
    if (emptyCard) emptyCard.classList.toggle("is-warn", unexcludedEmpty.length > 0);

    setText("kpiSpikeCount", String(k.spikeCount));
    setText("kpiSpikeList", spikeWells.length
      ? `${spikeWells.slice(0, 6).join(", ")}${spikeWells.length > 6 ? "…" : ""}${unexcludedSpike.length === 0 ? " (all excluded)" : ""}`
      : "No reflection spikes");
    const spikeCard = document.getElementById("kpiSpikeCard");
    if (spikeCard) spikeCard.classList.toggle("is-alert", unexcludedSpike.length > 0);

    const exclBtn = document.getElementById("excludeFlaggedBtn");
    if (exclBtn) {
      exclBtn.disabled = unexcludedFlagged.length === 0;
      exclBtn.textContent = unexcludedFlagged.length > 0
        ? `Exclude Flagged (${unexcludedFlagged.length})`
        : "Exclude Flagged";
    }
    const qcExclBtn = document.getElementById("qcExcludeFlaggedBtn");
    if (qcExclBtn) {
      qcExclBtn.disabled = unexcludedFlagged.length === 0;
    }
    const restBtn = document.getElementById("restoreAllWellsBtn");
    if (restBtn) {
      restBtn.style.display = k.excludedWells > 0 ? "" : "none";
    }

    if (a.capabilities.hasTemp && Number.isFinite(k.tempMin) && Number.isFinite(k.tempMax)) {
      setText("kpiTempRange", `${k.tempMin.toFixed(1)}–${k.tempMax.toFixed(1)} °C`);
      const targetPart = Number.isFinite(k.targetTempC) ? ` · target ${k.targetTempC.toFixed(1)} °C` : "";
      setText("kpiTempSub", `Mean ${k.tempMean.toFixed(1)} °C${targetPart}`);
    } else {
      setText("kpiTempRange", "N/A");
      setText("kpiTempSub", "No TEMP_C column in CSV");
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Plate / Maze Controls & Shared True-Scale SVG Renderer (Steps 2 & 3)
  // ---------------------------------------------------------------------------
  function getPlateMetricOptions() {
    const a = ui.analysis;
    if (!a) return [];
    const caps = a.capabilities || {};
    const opts = [];
    if (caps.hasDist) {
      opts.push({ id: "totalDist", label: "Total Distance (mm)", unit: "mm", dec: 1 });
      opts.push({ id: "meanDist", label: "Mean Dist / Bin (mm)", unit: "mm", dec: 2 });
    }
    if (caps.hasMsd) opts.push({ id: "meanMsd", label: "Mean MSD", unit: "px", dec: 2 });
    if (caps.hasZones) {
      opts.push({ id: "z1Pct", label: "Zone 1 Time (%)", unit: "%", dec: 1 });
      opts.push({ id: "z2Pct", label: "Zone 2 Time (%)", unit: "%", dec: 1 });
    }
    if (caps.hasPpi) opts.push({ id: "ppiPct", label: "% PPI", unit: "%", dec: 1 });
    if (caps.hasZchange) {
      opts.push({ id: "transitions", label: "Zone Entries", unit: "", dec: 0 });
      if (caps.hasSab) opts.push({ id: "sabPct", label: "Spontaneous Alternation (%)", unit: "%", dec: 1 });
    }
    if (!opts.length) opts.push({ id: "totalDist", label: "Total Distance (mm)", unit: "mm", dec: 1 });
    return opts;
  }

  function getWellHeatmapMetricValue(wSum, metricId) {
    if (!wSum) return null;
    if (wSum.heatmapValues && Number.isFinite(wSum.heatmapValues[metricId])) {
      return wSum.heatmapValues[metricId];
    }
    switch (metricId) {
      case "totalDist": return Number.isFinite(wSum.totalDist) ? wSum.totalDist : null;
      case "meanDist": return Number.isFinite(wSum.meanDist) ? wSum.meanDist : null;
      case "meanMsd": return Number.isFinite(wSum.meanMsd) ? wSum.meanMsd : null;
      case "z1Pct": return wSum.zones && Number.isFinite(wSum.zones.z1Pct) ? wSum.zones.z1Pct : null;
      case "z2Pct": return wSum.zones && Number.isFinite(wSum.zones.z2Pct) ? wSum.zones.z2Pct : null;
      case "ppiPct": return wSum.startle && Number.isFinite(wSum.startle.ppiPct) ? wSum.startle.ppiPct : null;
      case "transitions": return wSum.zchange && Number.isFinite(wSum.zchange.totalEntries) ? wSum.zchange.totalEntries : null;
      case "sabPct": return wSum.zchange && Number.isFinite(wSum.zchange.sabPct) ? wSum.zchange.sabPct : null;
      default: return Number.isFinite(wSum.heatmapValue) ? wSum.heatmapValue : null;
    }
  }

  function formatPlateSubtitle(layout) {
    if (!layout) return "Plate";
    const name = layout.name || "Plate";
    const count = layout.wells.length;
    const first = layout.wells[0] || "";
    const last = layout.wells[count - 1] || "";
    const range = count > 1 ? `${first}–${last}` : first;
    const hasCountInName = new RegExp(`\\b${count}\\b`).test(name);
    return hasCountInName
      ? `${name} (${range})`
      : `${name} · ${count} arena${count === 1 ? "" : "s"} (${range})`;
  }

  function renderPlateControls() {
    const a = ui.analysis;
    if (!a) return;

    const plateLbl = formatPlateSubtitle(a.layout);
    setText("qcPlateSubtitle", `${plateLbl} · Click well to inspect, Shift+click to toggle exclusion`);
    setText("brushPlateSubtitle", `${plateLbl} · Click or drag across wells to paint`);

    // Step 2 Heatmap metric selector
    const mSel = document.getElementById("plateMetricSel");
    if (mSel) {
      const opts = getPlateMetricOptions();
      if (!opts.some(o => o.id === ui.plateMetric)) ui.plateMetric = opts[0].id;
      mSel.innerHTML = opts.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("");
      mSel.value = ui.plateMetric;
    }

    // Step 3 Group Brush swatches
    const swWrap = document.getElementById("groupSwatchList");
    if (swWrap) {
      const counts = {};
      for (const w of ui.summaryParsed.wells) {
        const g = ui.groups[w] || UNASSIGNED;
        counts[g] = (counts[g] || 0) + 1;
      }
      const allGroups = [...ui.groupOrder, UNASSIGNED];
      swWrap.innerHTML = allGroups.map(g => {
        const col = getGroupColor(g);
        const isActive = ui.brushTool === "group" && ui.activeBrushGroup === g;
        return (
          `<button type="button" class="az-swatch-btn${isActive ? " active" : ""}" data-swatch-group="${esc(g)}">` +
            `<span class="az-swatch-dot" style="background:${col};"></span>` +
            `<span>${esc(g)}</span>` +
            `<span class="az-swatch-count">(${counts[g] || 0})</span>` +
          `</button>`
        );
      }).join("");

      swWrap.querySelectorAll("[data-swatch-group]").forEach(btn => {
        btn.addEventListener("click", () => {
          ui.brushTool = "group";
          ui.activeBrushGroup = btn.getAttribute("data-swatch-group") || UNASSIGNED;
          renderPlateControls();
        });
      });
    }

    const nameInp = document.getElementById("activeGroupNameInput");
    const delBtn = document.getElementById("deleteGroupBtn");
    const isNamed = ui.activeBrushGroup && ui.activeBrushGroup !== UNASSIGNED;
    if (nameInp) {
      if (document.activeElement !== nameInp) {
        nameInp.value = isNamed ? ui.activeBrushGroup : "";
      }
      nameInp.disabled = !isNamed;
    }
    if (delBtn) delBtn.disabled = !isNamed;

    const exBrushBtn = document.getElementById("brushExcludeBtn");
    if (exBrushBtn) exBrushBtn.classList.toggle("active", ui.brushTool === "exclude");

    const ind = document.getElementById("activeBrushIndicator");
    if (ind) {
      if (ui.brushTool === "exclude") {
        ind.className = "badge-warn";
        ind.textContent = "Brush: Toggle Exclude";
      } else {
        ind.className = "badge-custom";
        ind.textContent = `Brush: ${ui.activeBrushGroup || UNASSIGNED}`;
      }
    }
  }

  function renderAllPlateMaps() {
    renderPlateSvgInto(document.getElementById("qcPlateSvg"), "heatmap");
    renderPlateSvgInto(document.getElementById("brushPlateSvg"), "brush");
  }

  function renderPlateSvgInto(svg, mode) {
    const a = ui.analysis;
    if (!svg || !a || !a.layout) return;

    const layout = a.layout;
    const isPetri = layout.id === "petri";
    const plateW = isPetri ? 132 : (layout.plateW || 127.8);
    const plateH = isPetri ? 88 : (layout.plateH || 85.5);
    const wells = layout.wells || ui.summaryParsed.wells;
    const wellsById = a.wellsById || {};

    const opts = getPlateMetricOptions();
    const activeOpt = opts.find(o => o.id === ui.plateMetric) || opts[0] || { unit: "", dec: 1 };
    let vMin = Infinity;
    let vMax = -Infinity;
    const valsByWell = {};
    for (const w of wells) {
      const ws = wellsById[w];
      const val = getWellHeatmapMetricValue(ws, ui.plateMetric);
      valsByWell[w] = val;
      if (Number.isFinite(val) && !(ws && ws.excluded)) {
        if (val < vMin) vMin = val;
        if (val > vMax) vMax = val;
      }
    }
    if (!Number.isFinite(vMin) || !Number.isFinite(vMax)) { vMin = 0; vMax = 1; }
    if (Math.abs(vMax - vMin) < 1e-9) vMax = vMin + 1;

    if (mode === "heatmap") {
      setText("heatLegendMin", `${fmtNum(vMin, activeOpt.dec)}${activeOpt.unit ? " " + activeOpt.unit : ""}`);
      setText("heatLegendMax", `${fmtNum(vMax, activeOpt.dec)}${activeOpt.unit ? " " + activeOpt.unit : ""}`);
    }

    const showGridHeaders = !layout.isMaze && layout.rows > 1 && layout.cols > 1 && layout.wellCoords;
    const padL = showGridHeaders ? 8 : 3;
    const padT = showGridHeaders ? 7 : 3;
    svg.setAttribute("viewBox", `${-padL} ${-padT} ${plateW + padL + 3} ${plateH + padT + 3}`);

    let markup = "";
    const ch = isPetri ? 0 : 4.2;
    if (ch > 0) {
      markup += `<path d="M ${ch} 0 L ${plateW - 3} 0 Q ${plateW} 0 ${plateW} 3 L ${plateW} ${plateH - 3} Q ${plateW} ${plateH} ${plateW - 3} ${plateH} L 3 ${plateH} Q 0 ${plateH} 0 ${plateH - 3} L 0 ${ch} Z" fill="#ffffff" stroke="#afb8c1" stroke-width="1"/>`;
    } else {
      markup += `<rect x="0" y="0" width="${plateW}" height="${plateH}" rx="7" fill="#ffffff" stroke="#afb8c1" stroke-width="1"/>`;
    }

    if (showGridHeaders) {
      const seenRows = new Map();
      const seenCols = new Map();
      for (const w of wells) {
        const wc = layout.wellCoords[w];
        if (!wc) continue;
        const m = /^([A-Z]+)(\d+)$/.exec(w);
        if (m) {
          if (!seenRows.has(m[1])) seenRows.set(m[1], wc.y);
          if (!seenCols.has(m[2])) seenCols.set(m[2], wc.x);
        }
      }
      const hdrSize = layout.cols >= 12 ? 3.1 : 3.6;
      for (const [rl, ry] of seenRows.entries()) {
        markup += `<text x="-3.8" y="${ry.toFixed(2)}" font-size="${hdrSize}" font-weight="600" fill="#59636e" text-anchor="middle" dominant-baseline="central" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(rl)}</text>`;
      }
      for (const [cl, cx] of seenCols.entries()) {
        markup += `<text x="${cx.toFixed(2)}" y="-3.2" font-size="${hdrSize}" font-weight="600" fill="#59636e" text-anchor="middle" dominant-baseline="central" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(cl)}</text>`;
      }
    }

    const wellVisualStyle = (w) => {
      const ws = wellsById[w];
      const grp = (ws && ws.group) || ui.groups[w] || UNASSIGNED;
      const gCol = getGroupColor(grp);
      const isExcl = ui.excludedWells.has(w);
      const qc = (ws && ws.qc) || {};
      const isEmpty = Boolean(qc.isEmpty);
      const isSpike = Boolean(qc.isSpikeGlitch);
      const isSel = mode === "heatmap" && ui.selectedWell === w;

      let fill = "#eff6ff";
      let stroke = "#8c959f";
      let strokeWidth = 0.75;
      let strokeDash = "";
      let textColor = "#1f2328";
      let opacity = 1;

      if (mode === "brush") {
        if (grp === UNASSIGNED || grp === ALL_WELLS) {
          fill = "#f6f8fa";
          stroke = "#afb8c1";
          textColor = "#59636e";
        } else {
          fill = hexToRgba(gCol, 0.24);
          stroke = gCol;
          strokeWidth = 1.1;
          textColor = "#1f2328";
        }
      } else {
        const val = valsByWell[w];
        if (isEmpty) {
          fill = "#f3f4f6";
          stroke = "#8c959f";
          strokeDash = ' stroke-dasharray="1.8,1.2"';
          textColor = "#59636e";
        } else if (Number.isFinite(val)) {
          const t = (val - vMin) / (vMax - vMin);
          const hc = heatColor(t);
          fill = hc.fill;
          textColor = hc.text;
          stroke = (grp !== UNASSIGNED && grp !== ALL_WELLS) ? gCol : "#0969da";
          strokeWidth = (grp !== UNASSIGNED && grp !== ALL_WELLS) ? 1.15 : 0.75;
        } else {
          fill = "#f6f8fa";
          stroke = "#afb8c1";
        }
      }

      if (isSpike && !isExcl) {
        stroke = "#cf222e";
        strokeWidth = 1.35;
      }
      if (isExcl) {
        fill = "#eef1f4";
        stroke = "#8c959f";
        strokeDash = ' stroke-dasharray="1.5,1.2"';
        textColor = "#6e7781";
        opacity = 0.58;
      }
      if (isSel) {
        strokeWidth = 1.65;
        if (!isSpike) stroke = "#0969da";
      }

      return { fill, stroke, strokeWidth, strokeDash, textColor, opacity, isExcl, isEmpty, isSpike, isSel, grp, gCol };
    };

    const hasMazeShapes = Boolean(layout.isMaze && Array.isArray(layout.mazeShapes) && layout.mazeShapes.length > 0);

    if (hasMazeShapes) {
      const shapesByWell = new Map();
      for (const s of layout.mazeShapes) {
        const wId = "A" + s.arena;
        if (!shapesByWell.has(wId)) shapesByWell.set(wId, []);
        shapesByWell.get(wId).push(s);
      }

      for (const w of wells) {
        const shapes = shapesByWell.get(w) || [];
        if (!shapes.length) continue;
        const st = wellVisualStyle(w);
        let sumX = 0, sumY = 0;
        let hubShape = null;
        let inner = "";
        for (const s of shapes) {
          sumX += s.x;
          sumY += s.y;
          if (s.type === "TRIANGLE") hubShape = s;
          const rot = s.angle && s.type !== "DISC" ? ` transform="rotate(${s.angle} ${s.x.toFixed(2)} ${s.y.toFixed(2)})"` : "";
          const common = `fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.strokeWidth}"${st.strokeDash}`;
          if (s.type === "DISC") {
            inner += `<circle cx="${s.x.toFixed(2)}" cy="${s.y.toFixed(2)}" r="${s.w.toFixed(2)}" ${common}/>`;
          } else if (s.type === "SQUARE") {
            const half = s.w / 2;
            inner += `<rect x="${(s.x - half).toFixed(2)}" y="${(s.y - half).toFixed(2)}" width="${s.w.toFixed(2)}" height="${s.w.toFixed(2)}"${rot} ${common}/>`;
          } else if (s.type === "TRIANGLE" && typeof buildTrianglePointsAttr === "function") {
            const pts = buildTrianglePointsAttr(s.x, s.y, s.w);
            inner += `<polygon points="${pts}"${rot} ${common}/>`;
          } else {
            const hw = s.w / 2, hh = s.h / 2;
            inner += `<rect x="${(s.x - hw).toFixed(2)}" y="${(s.y - hh).toFixed(2)}" width="${s.w.toFixed(2)}" height="${s.h.toFixed(2)}"${rot} ${common}/>`;
          }
        }
        const cx = hubShape ? hubShape.x : (sumX / shapes.length);
        const cy = hubShape ? hubShape.y : (sumY / shapes.length);
        const wc = layout.wellCoords && layout.wellCoords[w];
        const hitR = wc ? Math.max(5.5, Math.min(18, wc.r || 9)) : 9;
        const badge = buildWellQcOverlay(cx, cy, Math.min(8, hitR * 0.72), st);
        const lblW = Math.max(5.8, w.length * 2.2 + 2.2);
        const selRing = st.isSel
          ? `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(hitR + 1.1).toFixed(2)}" fill="none" stroke="#0969da" stroke-width="0.9" stroke-dasharray="2.2,1.5" opacity="0.8"/>`
          : "";
        markup +=
          `<g class="az-well-hit" data-well="${esc(w)}" opacity="${st.opacity}">` +
            `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${hitR.toFixed(2)}" fill="transparent" stroke="none"/>` +
            selRing +
            inner +
            `<rect x="${(cx - lblW / 2).toFixed(2)}" y="${(cy - 2.3).toFixed(2)}" width="${lblW.toFixed(2)}" height="4.6" rx="1.6" fill="rgba(255,255,255,0.88)" stroke="rgba(31,35,40,0.16)" stroke-width="0.35" pointer-events="none"/>` +
            `<text class="az-well-lbl" x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-size="2.8" fill="#1f2328">${esc(w)}</text>` +
            badge +
          `</g>`;
      }
    } else {
      const coords = layout.wellCoords || buildFallbackWellCoords(wells, plateW, plateH);
      const isDense = wells.length >= 48;

      for (const w of wells) {
        const wc = coords[w];
        if (!wc) continue;
        const st = wellVisualStyle(w);
        const cx = wc.x;
        const cy = wc.y;
        const r = wc.r || (Math.min(wc.w || 10, wc.h || 10) / 2);
        const isSquare = wc.shape === "SQUARE" || wc.shape === "RECT" || layout.shape === "SQUARE";
        const isTile = wc.shape === "RECT" || layout.isMaze;

        let shapeSvg = "";
        if (isSquare || isTile) {
          const bw = wc.w || (r * 2);
          const bh = wc.h || (r * 2);
          const rx = isTile ? Math.min(2.6, Math.min(bw, bh) * 0.2) : 0.8;
          shapeSvg = `<rect x="${(cx - bw / 2).toFixed(2)}" y="${(cy - bh / 2).toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" rx="${rx.toFixed(2)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.strokeWidth}"${st.strokeDash}/>`;
          if (st.isSel) {
            shapeSvg += `<rect x="${(cx - bw / 2 - 1.1).toFixed(2)}" y="${(cy - bh / 2 - 1.1).toFixed(2)}" width="${(bw + 2.2).toFixed(2)}" height="${(bh + 2.2).toFixed(2)}" rx="${(rx + 0.8).toFixed(2)}" fill="none" stroke="#0969da" stroke-width="0.9" opacity="0.7"/>`;
          }
        } else {
          shapeSvg = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.strokeWidth}"${st.strokeDash}/>`;
          if (st.isSel) {
            shapeSvg += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(r + 1.2).toFixed(2)}" fill="none" stroke="#0969da" stroke-width="0.9" opacity="0.75"/>`;
          }
        }

        const lblSize = Math.max(2.15, Math.min(4.8, r * (isDense ? 0.62 : 0.50)));
        const badge = buildWellQcOverlay(cx, cy, r, st);

        markup +=
          `<g class="az-well-hit" data-well="${esc(w)}" opacity="${st.opacity}">` +
            shapeSvg +
            `<text class="az-well-lbl" x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-size="${lblSize.toFixed(2)}" fill="${st.textColor}">${esc(w)}</text>` +
            badge +
          `</g>`;
      }
    }

    svg.innerHTML = markup;
  }

  function buildWellQcOverlay(cx, cy, r, st) {
    let out = "";
    if (st.isExcl) {
      const d = Math.max(2.2, r * 0.58);
      out += `<line x1="${(cx - d).toFixed(2)}" y1="${(cy - d).toFixed(2)}" x2="${(cx + d).toFixed(2)}" y2="${(cy + d).toFixed(2)}" stroke="#59636e" stroke-width="0.95" stroke-linecap="round" pointer-events="none"/>`;
      out += `<line x1="${(cx + d).toFixed(2)}" y1="${(cy - d).toFixed(2)}" x2="${(cx - d).toFixed(2)}" y2="${(cy + d).toFixed(2)}" stroke="#59636e" stroke-width="0.95" stroke-linecap="round" pointer-events="none"/>`;
    }
    if (st.isSpike && !st.isExcl) {
      const bx = cx + r * 0.66;
      const by = cy - r * 0.66;
      const br = Math.max(1.5, Math.min(2.6, r * 0.34));
      out += `<circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="${br.toFixed(2)}" fill="#cf222e" stroke="#ffffff" stroke-width="0.45" pointer-events="none"/>`;
      out += `<text x="${bx.toFixed(2)}" y="${(by + 0.1).toFixed(2)}" font-size="${(br * 1.45).toFixed(2)}" font-weight="800" fill="#ffffff" text-anchor="middle" dominant-baseline="central" pointer-events="none">!</text>`;
    }
    return out;
  }

  function buildFallbackWellCoords(wells, plateW, plateH) {
    const n = wells.length;
    const cols = Math.ceil(Math.sqrt(n * 1.5));
    const rows = Math.ceil(n / cols);
    const padX = 10, padY = 9;
    const stepX = (plateW - 2 * padX) / Math.max(1, cols);
    const stepY = (plateH - 2 * padY) / Math.max(1, rows);
    const r = Math.min(stepX, stepY) * 0.38;
    const out = {};
    wells.forEach((w, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      out[w] = {
        x: padX + (col + 0.5) * stepX,
        y: padY + (row + 0.5) * stepY,
        r,
        w: stepX * 0.78,
        h: stepY * 0.78,
        shape: "RECT",
        row,
        col
      };
    });
    return out;
  }

  function renderWellInspector() {
    const textEl = document.getElementById("qcWellInspectorText");
    const btnEl = document.getElementById("qcWellInspectorExcludeBtn");
    if (!textEl || !btnEl || !ui.analysis) return;

    const w = ui.selectedWell;
    const ws = w && ui.analysis.wellsById ? ui.analysis.wellsById[w] : null;
    if (!ws) {
      textEl.innerHTML = "Click any well on the plate map to inspect its QC metrics or toggle exclusion.";
      btnEl.style.display = "none";
      return;
    }

    const parts = [
      `<strong>${esc(ws.well)}</strong>`,
      `<span>${esc(ws.group || UNASSIGNED)}</span>`
    ];
    if (Number.isFinite(ws.totalDist)) parts.push(`Dist ${fmtNum(ws.totalDist, 1)} mm`);
    if (Number.isFinite(ws.meanMsd)) parts.push(`MSD ${fmtNum(ws.meanMsd, 2)}`);
    if (ws.zones && Number.isFinite(ws.zones.z2Pct)) parts.push(`Z2 ${fmtNum(ws.zones.z2Pct, 1)}%`);
    if (ws.startle && Number.isFinite(ws.startle.ppiPct)) parts.push(`PPI ${fmtNum(ws.startle.ppiPct, 1)}%`);
    if (ws.zchange && Number.isFinite(ws.zchange.sabPct)) parts.push(`SAB ${fmtNum(ws.zchange.sabPct, 1)}%`);
    if (ws.qc && ws.qc.isEmpty) parts.push(`<span class="az-pill az-pill-empty">Empty</span>`);
    if (ws.qc && ws.qc.isSpikeGlitch) parts.push(`<span class="az-pill az-pill-spike">${ws.qc.spikeCount} Spike${ws.qc.spikeCount === 1 ? "" : "s"}</span>`);
    if (ws.excluded) parts.push(`<span class="az-pill az-pill-excl">Excluded</span>`);

    textEl.innerHTML = parts.join(" · ");
    btnEl.style.display = "";
    btnEl.textContent = ws.excluded ? "Restore Well" : "Exclude Well";
  }

  function paintWell(wellId, isStartOfStroke) {
    if (!wellId || !ui.summaryParsed) return;
    if (_paintedInStroke.has(wellId)) return;
    _paintedInStroke.add(wellId);
    ui.selectedWell = wellId;

    if (ui.brushTool === "exclude") {
      if (isStartOfStroke) {
        _paintExcludeValue = !ui.excludedWells.has(wellId);
      }
      if (_paintExcludeValue) ui.excludedWells.add(wellId);
      else ui.excludedWells.delete(wellId);
    } else {
      if (!ui.activeBrushGroup || ui.activeBrushGroup === UNASSIGNED) {
        delete ui.groups[wellId];
      } else {
        ui.groups[wellId] = ui.activeBrushGroup;
      }
    }
    recomputeAndRender();
  }

  function showPlateTooltipInto(tt, stage, wellId, clientX, clientY) {
    if (!ui.analysis || !ui.analysis.wellsById || !ui.analysis.wellsById[wellId]) {
      hideTooltip(tt);
      return;
    }
    const ws = ui.analysis.wellsById[wellId];
    const gCol = getGroupColor(ws.group);
    let rows = `<div class="az-tt-title">${esc(ws.well)} · <span class="az-tt-swatch" style="background:${gCol};"></span>${esc(ws.group || UNASSIGNED)}</div>`;
    if (Number.isFinite(ws.totalDist)) {
      rows += `<div class="az-tt-row"><span>Total Dist</span><span class="az-tt-val">${fmtNum(ws.totalDist, 1)} mm</span></div>`;
    }
    if (Number.isFinite(ws.meanMsd)) {
      rows += `<div class="az-tt-row"><span>Mean MSD</span><span class="az-tt-val">${fmtNum(ws.meanMsd, 2)}</span></div>`;
    }
    if (ws.zones && Number.isFinite(ws.zones.z2Pct)) {
      rows += `<div class="az-tt-row"><span>Z1 / Z2</span><span class="az-tt-val">${fmtNum(ws.zones.z1Pct, 0)}% / ${fmtNum(ws.zones.z2Pct, 0)}%</span></div>`;
    }
    if (ws.startle && Number.isFinite(ws.startle.ppiPct)) {
      rows += `<div class="az-tt-row"><span>% PPI</span><span class="az-tt-val">${fmtNum(ws.startle.ppiPct, 1)}%</span></div>`;
    }
    if (ws.zchange && Number.isFinite(ws.zchange.totalEntries)) {
      rows += `<div class="az-tt-row"><span>Zone Entries</span><span class="az-tt-val">${ws.zchange.totalEntries}${Number.isFinite(ws.zchange.sabPct) ? ` (SAB ${fmtNum(ws.zchange.sabPct, 0)}%)` : ""}</span></div>`;
    }
    if (ws.excluded) {
      rows += `<div class="az-tt-row"><span>Status</span><span class="az-tt-val">Excluded</span></div>`;
    } else if (ws.qc && ws.qc.isSpikeGlitch) {
      rows += `<div class="az-tt-row"><span>QC</span><span class="az-tt-val">Spike Glitch (${ws.qc.spikeCount})</span></div>`;
    } else if (ws.qc && ws.qc.isEmpty) {
      rows += `<div class="az-tt-row"><span>QC</span><span class="az-tt-val">Empty / Dead</span></div>`;
    }
    positionTooltip(tt, stage, clientX, clientY, rows);
  }

  // ---------------------------------------------------------------------------
  // 9. Step 2: Temperature Curve & QC Diagnostics Table
  // ---------------------------------------------------------------------------
  function buildQcPillsHtml(w) {
    const out = [];
    if (w.qc && w.qc.isEmpty) out.push(`<span class="az-pill az-pill-empty">Empty/Dead</span>`);
    if (w.qc && w.qc.isSpikeGlitch) out.push(`<span class="az-pill az-pill-spike">Spike (${w.qc.spikeCount})</span>`);
    if (w.excluded) out.push(`<span class="az-pill az-pill-excl">Excluded</span>`);
    if (!out.length) out.push(`<span class="az-pill az-pill-ok">OK</span>`);
    return out.join("");
  }

  function renderTempAndQcDiagnostics() {
    const svg = document.getElementById("tempChartSvg");
    const stage = document.getElementById("tempChartStage");
    const tt = document.getElementById("tempTooltip");
    const hint = document.getElementById("tempChartHint");
    const a = ui.analysis;
    if (!svg || !a) return;

    const ta = a.tempAnalysis || {};
    const pts = ta.points || [];
    const W = 880, H = 225;
    const m = { left: 58, right: 20, top: 18, bottom: 34 };
    const pw = W - m.left - m.right;
    const ph = H - m.top - m.bottom;

    if (!ta.hasTemp || pts.length === 0) {
      if (hint) hint.textContent = "No TEMP_C measurements found in CSV";
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#59636e">This CSV does not contain a TEMP_C column.</text>`;
    } else {
      const targetC = Number.isFinite(ta.targetTempC) ? ta.targetTempC : null;
      if (hint) {
        const devTxt = (targetC !== null && Number.isFinite(ta.maxDeviationC))
          ? ` · max Δ ${ta.maxDeviationC.toFixed(2)} °C from ${targetC.toFixed(1)} °C target`
          : "";
        hint.textContent = `${ta.min.toFixed(1)}–${ta.max.toFixed(1)} °C (mean ${ta.mean.toFixed(1)} °C)${devTxt}`;
      }

      const xMin = pts[0].relTime;
      const xMax = Math.max(xMin + 1, pts[pts.length - 1].relTime);
      let yLo = ta.min;
      let yHi = ta.max;
      if (targetC !== null) {
        yLo = Math.min(yLo, targetC - 0.6);
        yHi = Math.max(yHi, targetC + 0.6);
      }
      if (yHi - yLo < 2.4) {
        const mid = (yHi + yLo) / 2;
        yLo = mid - 1.2;
        yHi = mid + 1.2;
      }
      const yTicksObj = niceTicks(yLo - 0.2, yHi + 0.2, 4);
      const yMin = yTicksObj.min;
      const yMax = Math.max(yMin + 0.5, yTicksObj.max);

      const sx = (t) => m.left + ((t - xMin) / (xMax - xMin)) * pw;
      const sy = (v) => m.top + ph - ((v - yMin) / (yMax - yMin)) * ph;

      let out = "";
      if (targetC !== null) {
        const byTop = Math.max(m.top, sy(targetC + 0.5));
        const byBot = Math.min(m.top + ph, sy(targetC - 0.5));
        out += `<rect x="${m.left}" y="${byTop.toFixed(1)}" width="${pw}" height="${Math.max(1, byBot - byTop).toFixed(1)}" fill="rgba(26, 127, 55, 0.09)"/>`;
      }

      for (const tv of yTicksObj.ticks) {
        const yy = sy(tv);
        if (yy < m.top - 1 || yy > m.top + ph + 1) continue;
        out += `<line x1="${m.left}" y1="${yy.toFixed(1)}" x2="${m.left + pw}" y2="${yy.toFixed(1)}" stroke="#edf1f5" stroke-width="1"/>`;
        out += `<text x="${m.left - 8}" y="${(yy + 3.5).toFixed(1)}" font-size="10.5" fill="#59636e" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${tv.toFixed(1)}°</text>`;
      }

      const xTicksObj = niceTicks(xMin, xMax, 7);
      for (const xt of xTicksObj.ticks) {
        if (xt < xMin - 1e-6 || xt > xMax + 1e-6) continue;
        const xx = sx(xt);
        out += `<line x1="${xx.toFixed(1)}" y1="${m.top + ph}" x2="${xx.toFixed(1)}" y2="${m.top + ph + 4}" stroke="#94a3b8" stroke-width="1"/>`;
        out += `<text x="${xx.toFixed(1)}" y="${m.top + ph + 17}" font-size="10.5" fill="#59636e" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(fmtAxisTime(xt, xMax))}</text>`;
      }

      out += `<line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;
      out += `<line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;

      const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.relTime).toFixed(1)} ${sy(p.tempC).toFixed(1)}`).join(" ");
      out += `<path d="${d}" fill="none" stroke="#ea580c" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`;

      if (targetC !== null && targetC >= yMin && targetC <= yMax) {
        const ty = sy(targetC);
        const tgtTxt = `Target ${targetC.toFixed(1)} °C`;
        const pillW = tgtTxt.length * 6.1 + 12;
        out += `<line x1="${m.left}" y1="${ty.toFixed(1)}" x2="${m.left + pw}" y2="${ty.toFixed(1)}" stroke="#1a7f37" stroke-width="1.3" stroke-dasharray="5,4"/>`;
        out += `<rect x="${(m.left + pw - pillW - 2).toFixed(1)}" y="${(ty - 17).toFixed(1)}" width="${pillW.toFixed(1)}" height="14" rx="3" fill="rgba(255,255,255,0.92)" stroke="#d0e8d6" stroke-width="0.6"/>`;
        out += `<text x="${m.left + pw - 7}" y="${(ty - 7).toFixed(1)}" font-size="10" font-weight="600" fill="#1a7f37" text-anchor="end">${esc(tgtTxt)}</text>`;
      }

      out += `<g class="az-hover-ephemeral" id="tempHoverLayer"></g>`;
      out += `<rect id="tempHoverHit" x="${m.left}" y="${m.top}" width="${pw}" height="${ph}" fill="transparent" style="cursor:crosshair;"/>`;
      svg.innerHTML = out;

      const hit = svg.querySelector("#tempHoverHit");
      const hLayer = svg.querySelector("#tempHoverLayer");
      if (hit && hLayer) {
        hit.addEventListener("mousemove", (e) => {
          const rect = svg.getBoundingClientRect();
          if (!rect.width) return;
          const svgX = ((e.clientX - rect.left) / rect.width) * W;
          const relT = xMin + ((svgX - m.left) / pw) * (xMax - xMin);
          let best = pts[0];
          let bestD = Infinity;
          for (const p of pts) {
            const dist = Math.abs(p.relTime - relT);
            if (dist < bestD) { bestD = dist; best = p; }
          }
          const xx = sx(best.relTime);
          const yy = sy(best.tempC);
          hLayer.innerHTML =
            `<line x1="${xx.toFixed(1)}" y1="${m.top}" x2="${xx.toFixed(1)}" y2="${m.top + ph}" stroke="#59636e" stroke-width="1" stroke-dasharray="3,2"/>` +
            `<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="4" fill="#ea580c" stroke="#ffffff" stroke-width="1.5"/>`;
          const deltaStr = targetC !== null
            ? `<div class="az-tt-row"><span>vs Target</span><span class="az-tt-val">${best.tempC - targetC >= 0 ? "+" : ""}${(best.tempC - targetC).toFixed(2)} °C</span></div>`
            : "";
          const html =
            `<div class="az-tt-title">${esc(fmtAxisTime(best.relTime, xMax))}${best.phase ? " · " + esc(best.phase) : ""}</div>` +
            `<div class="az-tt-row"><span>TEMP_C</span><span class="az-tt-val">${best.tempC.toFixed(2)} °C</span></div>` +
            deltaStr;
          positionTooltip(tt, stage, e.clientX, e.clientY, html);
        });
        hit.addEventListener("mouseleave", () => {
          hLayer.innerHTML = "";
          hideTooltip(tt);
        });
      }
    }

    // QC Diagnostics & Anomaly Table
    const tbody = document.getElementById("qcAnomalyBody");
    if (!tbody) return;
    let rows = [...(a.wells || [])];
    if (ui.qcFilter === "flagged") {
      rows = rows.filter(w => w.excluded || (w.qc && (w.qc.isEmpty || w.qc.isSpikeGlitch)));
    }

    const severityScore = (w) => {
      let s = 0;
      if (w.qc && w.qc.isSpikeGlitch) s += 30;
      if (w.qc && w.qc.isEmpty) s += 20;
      if (w.excluded) s += 5;
      return s;
    };

    rows.sort((x, y) => {
      if (ui.qcSort === "spikes") return ((y.qc && y.qc.spikeCount) || 0) - ((x.qc && x.qc.spikeCount) || 0);
      if (ui.qcSort === "dist_asc") return (x.totalDist || 0) - (y.totalDist || 0);
      if (ui.qcSort === "dist_desc") return (y.totalDist || 0) - (x.totalDist || 0);
      if (ui.qcSort === "well") return x.well.localeCompare(y.well, undefined, { numeric: true });
      return severityScore(y) - severityScore(x) || x.well.localeCompare(y.well, undefined, { numeric: true });
    });

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:18px;">No QC anomalies detected across all wells. Switch filter to "All Wells" to inspect every well.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(w => {
      const gCol = getGroupColor(w.group);
      return (
        `<tr class="${w.excluded ? "is-excluded" : ""}">` +
          `<td><input type="checkbox" class="az-chk" data-qc-chk="${esc(w.well)}" aria-label="Exclude ${esc(w.well)}"${w.excluded ? " checked" : ""}></td>` +
          `<td class="az-well-id-cell">${esc(w.well)}</td>` +
          `<td><span class="az-group-tag" style="background:${hexToRgba(gCol, 0.14)};color:${gCol};"><span class="az-swatch-dot" style="background:${gCol};"></span>${esc(w.group)}</span></td>` +
          `<td>${buildQcPillsHtml(w)}</td>` +
          `<td class="num">${fmtNum(w.totalDist, 1)} mm</td>` +
          `<td class="num">${fmtNum(w.qc && w.qc.maxBinDist, 1)} mm</td>` +
          `<td class="num">${(w.qc && w.qc.spikeCount) || 0}</td>` +
          `<td><button type="button" class="btn btn-xs${w.excluded ? "" : " btn-danger-soft"}" data-qc-toggle="${esc(w.well)}">${w.excluded ? "Restore" : "Exclude"}</button></td>` +
        `</tr>`
      );
    }).join("");

    tbody.querySelectorAll("[data-qc-chk]").forEach(chk => {
      chk.addEventListener("change", () => {
        const well = chk.getAttribute("data-qc-chk");
        if (chk.checked) ui.excludedWells.add(well);
        else ui.excludedWells.delete(well);
        recomputeAndRender();
      });
    });

    tbody.querySelectorAll("[data-qc-toggle]").forEach(btn => {
      btn.addEventListener("click", () => {
        const well = btn.getAttribute("data-qc-toggle");
        if (ui.excludedWells.has(well)) ui.excludedWells.delete(well);
        else ui.excludedWells.add(well);
        recomputeAndRender();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 10. Step 4: Plot Toolbars & 3-Tab Pure-SVG Charting Studio
  // ---------------------------------------------------------------------------
  function renderChartToolbars() {
    const a = ui.analysis;
    if (!a) return;

    const tsSel = document.getElementById("tsMetricSel");
    if (tsSel) {
      const avail = (a.availableMetrics && a.availableMetrics.length)
        ? a.availableMetrics
        : [{ id: "dist", label: "Distance (mm)" }];
      tsSel.innerHTML = avail.map(m => {
        const id = typeof m === "string" ? m : m.id;
        const lbl = typeof m === "string" ? m : (m.label || m.id);
        return `<option value="${esc(id)}">${esc(lbl)}</option>`;
      }).join("");
      tsSel.value = ui.tsMetric;
    }

    const compSel = document.getElementById("compViewSel");
    if (compSel) {
      const views = (a.comparisonViews && a.comparisonViews.length)
        ? a.comparisonViews
        : [{ id: "phase_totals", label: "Total Distance" }];
      compSel.innerHTML = views.map(v => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join("");
      compSel.value = ui.compView;
    }

    const core = getCore();
    const prismSel = document.getElementById("prismMetricSel");
    if (prismSel) {
      const pOpts = (core && typeof core.getAvailablePrismMetrics === "function")
        ? core.getAvailablePrismMetrics(a)
        : [{ id: "total_dist", label: "Total Distance (mm)" }];
      prismSel.innerHTML = pOpts.map(m => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join("");
      prismSel.value = ui.prismMetric;
    }

    document.querySelectorAll("#chartTabsBar [data-chart-tab]").forEach(btn => {
      const isAct = btn.getAttribute("data-chart-tab") === ui.activeChartTab;
      btn.classList.toggle("active", isAct);
      btn.setAttribute("aria-selected", isAct ? "true" : "false");
    });
    document.querySelectorAll(".az-tab-pane").forEach(pane => {
      pane.classList.toggle("active", pane.id === `tabPane-${ui.activeChartTab}`);
    });
  }

  function renderAllPlotTabs() {
    if (!ui.analysis) return;
    renderTimeSeriesChart();
    renderComparisonChart();
    renderZchangeTab();
  }

  function renderGroupLegend(containerId, groupsList) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!groupsList || !groupsList.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = groupsList.map(g => {
      const name = g.group;
      const col = getGroupColor(name);
      const muted = ui.hiddenGroups.has(name);
      return (
        `<button type="button" class="az-legend-item${muted ? " is-muted" : ""}" data-legend-group="${esc(name)}" title="Click to toggle visibility">` +
          `<span class="az-legend-swatch" style="background:${col};"></span>` +
          `<span>${esc(name)}</span>` +
          `<span class="az-legend-n">(n=${g.n})</span>` +
        `</button>`
      );
    }).join("");

    el.querySelectorAll("[data-legend-group]").forEach(btn => {
      btn.addEventListener("click", () => {
        const g = btn.getAttribute("data-legend-group");
        if (ui.hiddenGroups.has(g)) ui.hiddenGroups.delete(g);
        else ui.hiddenGroups.add(g);
        renderAllPlotTabs();
      });
    });
  }

  // Tab 1: Time Series (Mean ± SEM)
  function renderTimeSeriesChart() {
    const svg = document.getElementById("tsChartSvg");
    const stage = document.getElementById("tsChartStage");
    const tt = document.getElementById("tsTooltip");
    const a = ui.analysis;
    if (!svg || !a || !a.timeSeries) return;

    const ts = a.timeSeries;
    const allSeries = ts.series || [];
    renderGroupLegend("tsLegend", allSeries);
    const visSeries = allSeries.filter(s => !ui.hiddenGroups.has(s.group) && s.n > 0);

    const W = 880, H = 320;
    const m = { left: 62, right: 22, top: 28, bottom: 42 };
    const pw = W - m.left - m.right;
    const ph = H - m.top - m.bottom;

    const xAxis = ts.xAxis || [];
    const nPts = xAxis.length;
    if (nPts === 0 || visSeries.length === 0) {
      svg.innerHTML =
        `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#59636e">` +
        `${nPts === 0 ? "No time-series bins available for this CSV." : "All groups are hidden or excluded — restore wells or toggle a group in the legend."}</text>`;
      return;
    }

    const xTimes = xAxis.map((pt, idx) =>
      typeof pt === "number" ? pt : (Number.isFinite(pt.relTime) ? pt.relTime : idx * (ts.effectiveBinSec || 1))
    );
    const xMin = xTimes[0];
    const xMax = Math.max(xMin + 1, xTimes[nPts - 1]);

    let yLo = 0;
    let yHi = -Infinity;
    for (const s of visSeries) {
      for (const v of (s.values || [])) {
        if (!v || !Number.isFinite(v.mean)) continue;
        const hi = ui.tsShowSem && Number.isFinite(v.sem) ? v.mean + v.sem : v.mean;
        const lo = ui.tsShowSem && Number.isFinite(v.sem) ? v.mean - v.sem : v.mean;
        if (hi > yHi) yHi = hi;
        if (lo < yLo) yLo = lo;
      }
    }
    if (!Number.isFinite(yHi) || yHi <= yLo) yHi = Math.max(1, yLo + 10);
    const isPct = String(ts.unit || "").includes("%");
    if (isPct) { yLo = 0; yHi = Math.max(100, yHi); }

    const yTicksObj = niceTicks(Math.min(0, yLo), yHi * 1.08, 5);
    const yMin = yTicksObj.min;
    const yMax = Math.max(yMin + 1e-6, yTicksObj.max);

    const sx = (t) => m.left + ((t - xMin) / (xMax - xMin)) * pw;
    const sy = (v) => m.top + ph - ((v - yMin) / (yMax - yMin)) * ph;

    let out = `<defs><clipPath id="tsPlotClip"><rect x="${m.left}" y="${m.top}" width="${pw}" height="${ph}"/></clipPath></defs>`;

    if (ui.tsShowPhases && Array.isArray(ts.phaseSpans) && ts.phaseSpans.length > 0) {
      ts.phaseSpans.forEach((sp, idx) => {
        const bx0 = Math.max(m.left, sx(sp.startRelTime));
        const bx1 = Math.min(m.left + pw, sx(sp.endRelTime));
        const bw = Math.max(0, bx1 - bx0);
        if (bw < 0.5) return;
        const st = phaseBandStyle(sp, idx);
        out += `<rect x="${bx0.toFixed(1)}" y="${m.top}" width="${bw.toFixed(1)}" height="${ph}" fill="${st.fill}"/>`;
        if (bw >= 44) {
          const maxChars = Math.max(4, Math.floor(bw / 6.5));
          const rawLbl = sp.label || sp.phase || "";
          const lbl = rawLbl.length > maxChars ? rawLbl.slice(0, maxChars - 1) + "…" : rawLbl;
          out += `<text x="${(bx0 + bw / 2).toFixed(1)}" y="${m.top - 9}" font-size="10.5" font-weight="600" fill="${st.text}" text-anchor="middle">${esc(lbl)}</text>`;
        }
      });
    }

    for (const tv of yTicksObj.ticks) {
      const yy = sy(tv);
      if (yy < m.top - 1 || yy > m.top + ph + 1) continue;
      out += `<line x1="${m.left}" y1="${yy.toFixed(1)}" x2="${m.left + pw}" y2="${yy.toFixed(1)}" stroke="${tv === 0 ? "#cbd5e1" : "#edf1f5"}" stroke-width="1"/>`;
      out += `<text x="${m.left - 8}" y="${(yy + 3.5).toFixed(1)}" font-size="10.5" fill="#59636e" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(fmtTick(tv, yTicksObj.step))}</text>`;
    }

    const xTicksObj = niceTicks(xMin, xMax, 7);
    for (const xt of xTicksObj.ticks) {
      if (xt < xMin - 1e-6 || xt > xMax + 1e-6) continue;
      const xx = sx(xt);
      out += `<line x1="${xx.toFixed(1)}" y1="${m.top + ph}" x2="${xx.toFixed(1)}" y2="${m.top + ph + 5}" stroke="#94a3b8" stroke-width="1"/>`;
      out += `<text x="${xx.toFixed(1)}" y="${m.top + ph + 18}" font-size="10.5" fill="#59636e" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(fmtAxisTime(xt, xMax))}</text>`;
    }

    if (ui.tsShowStim && Array.isArray(ts.stimulusMarkers) && ts.stimulusMarkers.length > 0) {
      let lastPx = -999;
      for (const sm of ts.stimulusMarkers) {
        const xx = sx(sm.relTime);
        if (xx < m.left || xx > m.left + pw) continue;
        if (xx - lastPx < 6) continue;
        lastPx = xx;
        const col = sm.type === "ppi" ? "#8250df" : "#d97706";
        out += `<line x1="${xx.toFixed(1)}" y1="${m.top}" x2="${xx.toFixed(1)}" y2="${m.top + ph}" stroke="${col}" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>`;
        out += `<polygon points="${xx.toFixed(1)},${m.top + 1} ${(xx - 3.5).toFixed(1)},${m.top + 7} ${(xx + 3.5).toFixed(1)},${m.top + 7}" fill="${col}" opacity="0.85"/>`;
      }
    }

    out += `<line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;
    out += `<line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;

    const yTitle = ts.metricLabel || ts.metric || "Value";
    out += `<text transform="rotate(-90)" x="${-(m.top + ph / 2)}" y="16" font-size="11" font-weight="600" fill="#59636e" text-anchor="middle">${esc(yTitle)}</text>`;
    const binLbl = ts.binGroupSize > 1 ? `Time (${fmtNum(ts.effectiveBinSec, 0)}s smoothed bins)` : `Time (${fmtNum(ts.rawBinSec || ts.effectiveBinSec, 1)}s bins)`;
    out += `<text x="${m.left + pw / 2}" y="${H - 8}" font-size="11" font-weight="600" fill="#59636e" text-anchor="middle">${esc(binLbl)}</text>`;

    let ribbons = "";
    let lines = "";
    for (const s of visSeries) {
      const col = getGroupColor(s.group);
      const vals = s.values || [];

      if (ui.tsShowSem && s.n > 1) {
        let segUpper = [];
        let segLower = [];
        const flushRibbon = () => {
          if (segUpper.length >= 2) {
            const d = "M " + segUpper.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ") +
              " L " + segLower.reverse().map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ") + " Z";
            ribbons += `<path d="${d}" fill="${col}" fill-opacity="0.16" stroke="none"/>`;
          }
          segUpper = [];
          segLower = [];
        };
        for (let i = 0; i < nPts; i++) {
          const v = vals[i];
          if (!v || !Number.isFinite(v.mean)) { flushRibbon(); continue; }
          const sem = Number.isFinite(v.sem) ? v.sem : 0;
          const xx = sx(xTimes[i]);
          segUpper.push([xx, sy(v.mean + sem)]);
          segLower.push([xx, sy(Math.max(yMin, v.mean - sem))]);
        }
        flushRibbon();
      }

      let pathD = "";
      let open = false;
      for (let i = 0; i < nPts; i++) {
        const v = vals[i];
        if (!v || !Number.isFinite(v.mean)) { open = false; continue; }
        const xx = sx(xTimes[i]);
        const yy = sy(v.mean);
        pathD += (open ? " L " : " M ") + `${xx.toFixed(1)} ${yy.toFixed(1)}`;
        open = true;
      }
      if (pathD) {
        lines += `<path d="${pathD.trim()}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      if (nPts === 1 && vals[0] && Number.isFinite(vals[0].mean)) {
        lines += `<circle cx="${sx(xTimes[0]).toFixed(1)}" cy="${sy(vals[0].mean).toFixed(1)}" r="4" fill="${col}" stroke="#ffffff" stroke-width="1.2"/>`;
      }
    }

    out += `<g clip-path="url(#tsPlotClip)">${ribbons}${lines}</g>`;
    out += `<g class="az-hover-ephemeral" id="tsHoverLayer"></g>`;
    out += `<rect id="tsHoverHit" x="${m.left}" y="${m.top}" width="${pw}" height="${ph}" fill="transparent" style="cursor:crosshair;"/>`;
    svg.innerHTML = out;

    const hit = svg.querySelector("#tsHoverHit");
    const hoverLayer = svg.querySelector("#tsHoverLayer");
    if (hit && hoverLayer) {
      hit.addEventListener("mousemove", (e) => {
        const rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        const svgX = ((e.clientX - rect.left) / rect.width) * W;
        const relT = xMin + ((svgX - m.left) / pw) * (xMax - xMin);
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < nPts; i++) {
          const d = Math.abs(xTimes[i] - relT);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        const xx = sx(xTimes[bestIdx]);
        const ptMeta = xAxis[bestIdx];
        const phaseTxt = (ptMeta && ptMeta.phase) ? ` · ${ptMeta.phase}` : "";
        let markerHtml = `<line x1="${xx.toFixed(1)}" y1="${m.top}" x2="${xx.toFixed(1)}" y2="${m.top + ph}" stroke="#59636e" stroke-width="1" stroke-dasharray="3,2"/>`;
        let ttHtml = `<div class="az-tt-title">${esc(fmtAxisTime(xTimes[bestIdx], xMax))}${esc(phaseTxt)}</div>`;
        for (const s of visSeries) {
          const v = s.values[bestIdx];
          if (!v || !Number.isFinite(v.mean)) continue;
          const col = getGroupColor(s.group);
          const yy = sy(v.mean);
          markerHtml += `<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="4" fill="${col}" stroke="#ffffff" stroke-width="1.5"/>`;
          const semTxt = Number.isFinite(v.sem) && s.n > 1 ? ` ± ${fmtNum(v.sem, 2)}` : "";
          ttHtml += `<div class="az-tt-row"><span><span class="az-tt-swatch" style="background:${col};"></span>${esc(s.group)}</span><span class="az-tt-val">${fmtNum(v.mean, 2)}${semTxt}${ts.unit ? " " + esc(ts.unit) : ""}</span></div>`;
        }
        hoverLayer.innerHTML = markerHtml;
        positionTooltip(tt, stage, e.clientX, e.clientY, ttHtml);
      });
      hit.addEventListener("mouseleave", () => {
        hoverLayer.innerHTML = "";
        hideTooltip(tt);
      });
    }
  }

  // Tab 2: Phase & Group Comparison (Grouped Bars + SEM + Jittered Well Scatter Dots)
  function buildComparisonDataset(viewId) {
    const a = ui.analysis;
    if (!a) return null;
    const activeGroups = (a.groups || []).filter(g => !ui.hiddenGroups.has(g.group) && g.n > 0);
    const activeWells = (a.wells || []).filter(w => !w.excluded && !ui.hiddenGroups.has(w.group));

    const statOf = (vals) => {
      const clean = vals.filter(v => Number.isFinite(v));
      const n = clean.length;
      if (!n) return { mean: null, sem: 0, n: 0 };
      const mean = clean.reduce((s, x) => s + x, 0) / n;
      const variance = n > 1 ? clean.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
      return { mean, sem: n > 1 ? Math.sqrt(variance / n) : 0, n };
    };

    const buildFromCategories = (cats, yLabel, unit, refLine) => {
      const categories = cats.map(c => {
        const bars = activeGroups.map(g => {
          const pts = [];
          for (const w of activeWells) {
            if (w.group !== g.group) continue;
            const v = c.getWellVal(w);
            if (Number.isFinite(v)) pts.push({ well: w.well, value: v });
          }
          const st = statOf(pts.map(p => p.value));
          return { group: g.group, mean: st.mean, sem: st.sem, n: st.n, points: pts };
        });
        return { id: c.id, label: c.label, bars };
      });
      return { categories, yLabel, unit, refLine: refLine || null, groups: activeGroups };
    };

    if (viewId === "phase_dist" || viewId === "phase_totals" || viewId === "phase_mean") {
      const phases = (a.phases && a.phases.length) ? a.phases : ["ALL"];
      const multiPhase = phases.length > 1;
      const isMean = viewId === "phase_mean" || (viewId === "phase_totals" && multiPhase);
      const cats = phases.map(ph => ({
        id: ph,
        label: ph === "ALL" ? "Full Assay" : ph,
        getWellVal: (w) => {
          if (ph === "ALL") return isMean ? w.meanDist : w.totalDist;
          const entry = w.phaseDist && w.phaseDist[ph];
          if (!entry) return null;
          if (typeof entry === "number") return entry;
          return isMean ? entry.mean : entry.total;
        }
      }));
      return buildFromCategories(cats, isMean ? "Mean Distance (mm / bin)" : "Total Distance (mm)", "mm");
    }

    if (viewId === "msd") {
      return buildFromCategories(
        [{ id: "msd", label: "Mean MSD", getWellVal: w => w.meanMsd }],
        "Mean Pixel Activity (MSD)",
        "px"
      );
    }

    if (viewId === "vmr") {
      const cats = [
        { id: "light", label: "Light Mean", getWellVal: w => w.vmr && w.vmr.lightMean },
        { id: "dark", label: "Dark Mean", getWellVal: w => w.vmr && w.vmr.darkMean },
        { id: "burst", label: "Dark-Onset Burst", getWellVal: w => w.vmr && w.vmr.darkOnsetBurst }
      ].filter(c => activeWells.some(w => Number.isFinite(c.getWellVal(w))));
      if (cats.length) {
        return buildFromCategories(cats, "Visual Motor Response (mm / bin)", "mm");
      }
    }

    if (viewId === "zones" || viewId === "thigmotaxis" || viewId === "zone_pref") {
      const maxZ = (a.capabilities && a.capabilities.maxZone) || 2;
      const zLabels = (a.layout && a.layout.zoneLabels) || [];
      const cats = [];
      for (let z = 1; z <= maxZ; z++) {
        cats.push({
          id: `Z${z}`,
          label: zLabels[z - 1] || `Zone ${z}`,
          getWellVal: w => {
            if (!w.zones) return null;
            if (w.zones.pct && Number.isFinite(w.zones.pct[z])) return w.zones.pct[z];
            if (z === 1 && Number.isFinite(w.zones.z1Pct)) return w.zones.z1Pct;
            if (z === 2 && Number.isFinite(w.zones.z2Pct)) return w.zones.z2Pct;
            return null;
          }
        });
      }
      return buildFromCategories(cats, "Zone Occupancy (%)", "%", maxZ === 2 ? { value: 50, label: "50% equal split" } : null);
    }

    if (viewId === "ppi") {
      return buildFromCategories(
        [{ id: "ppi", label: "% Prepulse Inhibition", getWellVal: w => w.startle && w.startle.ppiPct }],
        "% PPI (1 - PPI / Pulse Alone)",
        "%",
        { value: 0, label: "0% baseline" }
      );
    }

    if (viewId === "startle") {
      const hasPpi = a.capabilities && a.capabilities.hasPpi;
      const cats = hasPpi
        ? [
            { id: "pulse", label: "Pulse Alone", getWellVal: w => w.startle && w.startle.pulseAloneMean },
            { id: "ppi_tr", label: "PPI Trial", getWellVal: w => w.startle && w.startle.ppiTrialMean }
          ]
        : [
            { id: "base", label: "Baseline", getWellVal: w => w.startle && w.startle.baselineMean },
            { id: "iti", label: "ITI", getWellVal: w => w.startle && w.startle.itiMean },
            { id: "stim", label: "Stimulus", getWellVal: w => w.startle && w.startle.stimMean }
          ].filter(c => activeWells.some(w => Number.isFinite(c.getWellVal(w))));
      if (cats.length) {
        return buildFromCategories(cats, "Startle Response (mm / bin)", "mm");
      }
    }

    if (viewId === "sab") {
      return buildFromCategories(
        [{ id: "sab", label: "Spontaneous Alternation (SAB %)", getWellVal: w => w.zchange && w.zchange.sabPct }],
        "Spontaneous Alternation (%)",
        "%",
        { value: 50, label: "50% chance" }
      );
    }

    return buildFromCategories(
      [{ id: "total", label: "Total Distance", getWellVal: w => w.totalDist }],
      "Total Distance (mm)",
      "mm"
    );
  }

  function renderComparisonChart() {
    const svg = document.getElementById("compChartSvg");
    const stage = document.getElementById("compChartStage");
    const tt = document.getElementById("compTooltip");
    const summaryStrip = document.getElementById("compSummaryStrip");
    const a = ui.analysis;
    if (!svg || !a) return;

    renderGroupLegend("compLegend", a.groups || []);
    const ds = buildComparisonDataset(ui.compView);

    const W = 880, H = 300;
    const m = { left: 62, right: 24, top: 22, bottom: 44 };
    const pw = W - m.left - m.right;
    const ph = H - m.top - m.bottom;

    if (!ds || !ds.categories.length || !ds.groups.length) {
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#59636e">No active group data to compare.</text>`;
      if (summaryStrip) summaryStrip.innerHTML = "";
      return;
    }

    let yLo = 0;
    let yHi = -Infinity;
    let anyVal = false;
    for (const cat of ds.categories) {
      for (const bar of cat.bars) {
        if (Number.isFinite(bar.mean)) {
          anyVal = true;
          yHi = Math.max(yHi, bar.mean + bar.sem);
          yLo = Math.min(yLo, bar.mean - bar.sem);
        }
        for (const pt of bar.points) {
          anyVal = true;
          yHi = Math.max(yHi, pt.value);
          yLo = Math.min(yLo, pt.value);
        }
      }
    }
    if (ds.refLine) {
      yHi = Math.max(yHi, ds.refLine.value);
      yLo = Math.min(yLo, ds.refLine.value);
    }
    if (!anyVal) {
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#59636e">No measurements available for this comparison view.</text>`;
      if (summaryStrip) summaryStrip.innerHTML = "";
      return;
    }

    const span = Math.max(1e-6, yHi - yLo);
    const padTop = span * 0.12;
    const padBot = yLo < 0 ? span * 0.12 : 0;
    const yTicksObj = niceTicks(yLo - padBot, yHi + padTop, 5);
    const yMin = yTicksObj.min;
    const yMax = Math.max(yMin + 1e-6, yTicksObj.max);
    const sy = (v) => m.top + ph - ((v - yMin) / (yMax - yMin)) * ph;
    const zeroY = sy(Math.max(yMin, Math.min(yMax, 0)));

    let out = "";
    for (const tv of yTicksObj.ticks) {
      const yy = sy(tv);
      if (yy < m.top - 1 || yy > m.top + ph + 1) continue;
      out += `<line x1="${m.left}" y1="${yy.toFixed(1)}" x2="${m.left + pw}" y2="${yy.toFixed(1)}" stroke="${tv === 0 ? "#94a3b8" : "#edf1f5"}" stroke-width="1"/>`;
      out += `<text x="${m.left - 8}" y="${(yy + 3.5).toFixed(1)}" font-size="10.5" fill="#59636e" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(fmtTick(tv, yTicksObj.step))}</text>`;
    }

    let refPillMarkup = "";
    if (ds.refLine && ds.refLine.value >= yMin && ds.refLine.value <= yMax) {
      const ry = sy(ds.refLine.value);
      out += `<line x1="${m.left}" y1="${ry.toFixed(1)}" x2="${m.left + pw}" y2="${ry.toFixed(1)}" stroke="#8c959f" stroke-width="1.2" stroke-dasharray="5,4"/>`;
      const rTxt = String(ds.refLine.label || "");
      if (rTxt) {
        const pillW = Math.max(52, rTxt.length * 5.9 + 12);
        const pillH = 14;
        const pillY = Math.max(m.top + 2, ry - pillH - 3);
        const pillX = m.left + pw - pillW - 2;
        refPillMarkup =
          `<g pointer-events="none">` +
            `<rect x="${pillX.toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH}" rx="3" fill="rgba(255,255,255,0.94)" stroke="#e5e9f0" stroke-width="0.7"/>` +
            `<text x="${(m.left + pw - 7).toFixed(1)}" y="${(pillY + 10.2).toFixed(1)}" font-size="9.5" font-weight="600" fill="#59636e" text-anchor="end">${esc(rTxt)}</text>` +
          `</g>`;
      }
    }

    out += `<line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;
    out += `<line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;
    out += `<text transform="rotate(-90)" x="${-(m.top + ph / 2)}" y="16" font-size="11" font-weight="600" fill="#59636e" text-anchor="middle">${esc(ds.yLabel)}</text>`;

    const singleCat = ds.categories.length === 1;
    const nCats = ds.categories.length;
    const nGrps = ds.groups.length;
    const catSlotW = pw / Math.max(1, singleCat ? nGrps : nCats);

    let dotsMarkup = "";

    if (singleCat) {
      const cat = ds.categories[0];
      const barW = Math.min(80, Math.max(24, catSlotW * 0.44));
      cat.bars.forEach((bar, gi) => {
        const cx = m.left + (gi + 0.5) * catSlotW;
        const col = getGroupColor(bar.group);
        if (Number.isFinite(bar.mean)) {
          const yVal = sy(bar.mean);
          const yTop = Math.min(zeroY, yVal);
          const bh = Math.max(1, Math.abs(zeroY - yVal));
          out += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${col}" fill-opacity="0.22" stroke="${col}" stroke-width="1.5"/>`;
          if (bar.n > 1 && bar.sem > 0) {
            const eTop = sy(bar.mean + bar.sem);
            const eBot = sy(bar.mean - bar.sem);
            out += `<line x1="${cx.toFixed(1)}" y1="${eTop.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${eBot.toFixed(1)}" stroke="${col}" stroke-width="1.6"/>`;
            out += `<line x1="${(cx - 6).toFixed(1)}" y1="${eTop.toFixed(1)}" x2="${(cx + 6).toFixed(1)}" y2="${eTop.toFixed(1)}" stroke="${col}" stroke-width="1.6"/>`;
            out += `<line x1="${(cx - 6).toFixed(1)}" y1="${eBot.toFixed(1)}" x2="${(cx + 6).toFixed(1)}" y2="${eBot.toFixed(1)}" stroke="${col}" stroke-width="1.6"/>`;
          }
        }
        const jSpan = barW * 0.34;
        for (const pt of bar.points) {
          const dx = cx + deterministicJitter(pt.well, jSpan);
          const dy = sy(pt.value);
          dotsMarkup += `<circle class="az-scatter-dot" cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="4" fill="${col}" stroke="#ffffff" stroke-width="1.1" style="cursor:pointer;" data-dot-well="${esc(pt.well)}" data-dot-group="${esc(bar.group)}" data-dot-cat="${esc(cat.label)}" data-dot-val="${pt.value}" data-dot-unit="${esc(ds.unit)}"/>`;
        }
        const lbl = bar.group.length > 18 ? bar.group.slice(0, 17) + "…" : bar.group;
        out += `<text x="${cx.toFixed(1)}" y="${m.top + ph + 19}" font-size="11.5" font-weight="600" fill="#1f2328" text-anchor="middle">${esc(lbl)}</text>`;
        out += `<text x="${cx.toFixed(1)}" y="${m.top + ph + 33}" font-size="10" fill="#59636e" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">n=${bar.n}</text>`;
      });
    } else {
      const innerPad = Math.min(20, catSlotW * 0.14);
      const availW = Math.max(16, catSlotW - innerPad * 2);
      const gap = nGrps > 1 ? Math.min(8, availW * 0.08) : 0;
      const barW = Math.min(54, Math.max(12, (availW - gap * (nGrps - 1)) / nGrps));
      const clusterW = barW * nGrps + gap * (nGrps - 1);

      ds.categories.forEach((cat, ci) => {
        const catCenter = m.left + (ci + 0.5) * catSlotW;
        const startX = catCenter - clusterW / 2;

        cat.bars.forEach((bar, gi) => {
          const cx = startX + gi * (barW + gap) + barW / 2;
          const col = getGroupColor(bar.group);
          if (Number.isFinite(bar.mean)) {
            const yVal = sy(bar.mean);
            const yTop = Math.min(zeroY, yVal);
            const bh = Math.max(1, Math.abs(zeroY - yVal));
            out += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2.5" fill="${col}" fill-opacity="0.22" stroke="${col}" stroke-width="1.4"/>`;
            if (bar.n > 1 && bar.sem > 0) {
              const eTop = sy(bar.mean + bar.sem);
              const eBot = sy(bar.mean - bar.sem);
              const cap = Math.min(5, barW * 0.28);
              out += `<line x1="${cx.toFixed(1)}" y1="${eTop.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${eBot.toFixed(1)}" stroke="${col}" stroke-width="1.4"/>`;
              out += `<line x1="${(cx - cap).toFixed(1)}" y1="${eTop.toFixed(1)}" x2="${(cx + cap).toFixed(1)}" y2="${eTop.toFixed(1)}" stroke="${col}" stroke-width="1.4"/>`;
              out += `<line x1="${(cx - cap).toFixed(1)}" y1="${eBot.toFixed(1)}" x2="${(cx + cap).toFixed(1)}" y2="${eBot.toFixed(1)}" stroke="${col}" stroke-width="1.4"/>`;
            }
          }
          const jSpan = barW * 0.30;
          for (const pt of bar.points) {
            const dx = cx + deterministicJitter(pt.well, jSpan);
            const dy = sy(pt.value);
            dotsMarkup += `<circle class="az-scatter-dot" cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="3.6" fill="${col}" stroke="#ffffff" stroke-width="1" style="cursor:pointer;" data-dot-well="${esc(pt.well)}" data-dot-group="${esc(bar.group)}" data-dot-cat="${esc(cat.label)}" data-dot-val="${pt.value}" data-dot-unit="${esc(ds.unit)}"/>`;
          }
        });

        const maxChars = Math.max(6, Math.floor(catSlotW / 7.2));
        const lbl = cat.label.length > maxChars ? cat.label.slice(0, maxChars - 1) + "…" : cat.label;
        out += `<text x="${catCenter.toFixed(1)}" y="${m.top + ph + 20}" font-size="11.5" font-weight="600" fill="#1f2328" text-anchor="middle">${esc(lbl)}</text>`;
      });
    }

    svg.innerHTML = out + dotsMarkup + refPillMarkup;

    svg.querySelectorAll(".az-scatter-dot").forEach(dot => {
      dot.addEventListener("mouseenter", (e) => {
        const w = dot.getAttribute("data-dot-well");
        const g = dot.getAttribute("data-dot-group");
        const c = dot.getAttribute("data-dot-cat");
        const v = parseFloat(dot.getAttribute("data-dot-val"));
        const u = dot.getAttribute("data-dot-unit") || "";
        const col = getGroupColor(g);
        const html =
          `<div class="az-tt-title">${esc(w)} · <span class="az-tt-swatch" style="background:${col};"></span>${esc(g)}</div>` +
          `<div class="az-tt-row"><span>${esc(c)}</span><span class="az-tt-val">${fmtNum(v, 2)}${u ? " " + esc(u) : ""}</span></div>`;
        positionTooltip(tt, stage, e.clientX, e.clientY, html);
      });
      dot.addEventListener("mouseleave", () => hideTooltip(tt));
      dot.addEventListener("click", () => {
        ui.selectedWell = dot.getAttribute("data-dot-well");
        renderAllPlateMaps();
        renderWellInspector();
      });
    });

    if (summaryStrip) {
      const cards = ds.groups.map(g => {
        const col = getGroupColor(g.group);
        let mainVal = "—";
        let subTxt = `n = ${g.n} active`;
        if (ui.compView === "ppi" && g.startle && g.startle.ppiPct && Number.isFinite(g.startle.ppiPct.mean)) {
          mainVal = `${fmtNum(g.startle.ppiPct.mean, 1)} ± ${fmtNum(g.startle.ppiPct.sem, 1)}%`;
          const pA = g.startle.pulseAloneMean ? fmtNum(g.startle.pulseAloneMean.mean, 1) : "—";
          const pP = g.startle.ppiTrialMean ? fmtNum(g.startle.ppiTrialMean.mean, 1) : "—";
          subTxt = `n=${g.n} · Pulse ${pA} vs PPI ${pP} mm`;
        } else if (ui.compView === "sab" && g.zchange && g.zchange.sabPct && Number.isFinite(g.zchange.sabPct.mean)) {
          mainVal = `${fmtNum(g.zchange.sabPct.mean, 1)} ± ${fmtNum(g.zchange.sabPct.sem, 1)}%`;
          subTxt = `n=${g.n} · Mean entries ${g.zchange.totalEntries ? fmtNum(g.zchange.totalEntries.mean, 0) : "—"}`;
        } else if (ui.compView === "vmr" && g.vmr && g.vmr.darkMinusLight && Number.isFinite(g.vmr.darkMinusLight.mean)) {
          const sign = g.vmr.darkMinusLight.mean >= 0 ? "+" : "";
          mainVal = `${sign}${fmtNum(g.vmr.darkMinusLight.mean, 2)} mm/bin`;
          subTxt = `n=${g.n} · Dark − Light VMR Δ`;
        } else if ((ui.compView === "zones" || ui.compView === "thigmotaxis" || ui.compView === "zone_pref") && g.zones && g.zones.z2Pct && Number.isFinite(g.zones.z2Pct.mean)) {
          mainVal = `Z2 ${fmtNum(g.zones.z2Pct.mean, 1)} ± ${fmtNum(g.zones.z2Pct.sem, 1)}%`;
          const pi = g.zones.preferenceIndex && Number.isFinite(g.zones.preferenceIndex.mean) ? fmtNum(g.zones.preferenceIndex.mean, 2) : "—";
          subTxt = `n=${g.n} · Pref Index ${pi}`;
        } else if (ui.compView === "msd" && g.meanMsd && Number.isFinite(g.meanMsd.mean)) {
          mainVal = `${fmtNum(g.meanMsd.mean, 2)} ± ${fmtNum(g.meanMsd.sem, 2)}`;
          subTxt = `n=${g.n} · Mean MSD`;
        } else if (g.totalDist && Number.isFinite(g.totalDist.mean)) {
          mainVal = `${fmtNum(g.totalDist.mean, 1)} ± ${fmtNum(g.totalDist.sem, 1)} mm`;
          subTxt = `n=${g.n} · Total Dist (${g.excludedCount || 0} excl)`;
        }
        return (
          `<div class="az-stat-mini">` +
            `<div class="az-stat-mini-head"><span class="az-swatch-dot" style="background:${col};"></span><span>${esc(g.group)}</span></div>` +
            `<div class="az-stat-mini-val">${esc(mainVal)}</div>` +
            `<div class="az-stat-mini-sub">${esc(subTxt)}</div>` +
          `</div>`
        );
      });
      summaryStrip.innerHTML = cards.join("");
    }
  }

  // Tab 3: Zone Events (_ZCHANGE)
  function renderZchangeTab() {
    const emptyEl = document.getElementById("zchangeEmptyHint");
    const contentEl = document.getElementById("zchangeContent");
    const a = ui.analysis;
    if (!emptyEl || !contentEl || !a) return;

    const zs = a.zchangeSummary;
    const hasZ = Boolean(ui.zchangeParsed && a.capabilities && a.capabilities.hasZchange && zs);
    emptyEl.style.display = hasZ ? "none" : "";
    contentEl.style.display = hasZ ? "" : "none";
    if (!hasZ) return;

    const activeArenasList = (zs.perArena || []).filter(p => !p.excluded);
    const activeArenasCount = activeArenasList.length;
    const activeEntriesTotal = activeArenasList.reduce((acc, p) => acc + (p.totalEntries || 0), 0);
    const meanEntriesPerArena = activeArenasCount > 0 ? activeEntriesTotal / activeArenasCount : 0;
    const meanSab = zs.overallSabPct && Number.isFinite(zs.overallSabPct.mean) ? zs.overallSabPct.mean : null;
    const semSab = zs.overallSabPct && Number.isFinite(zs.overallSabPct.sem) ? zs.overallSabPct.sem : null;

    setText("zchangeSummaryHint", `${activeEntriesTotal} zone entries across ${activeArenasCount} active arena${activeArenasCount === 1 ? "" : "s"}`);

    const kpiWrap = document.getElementById("zchangeKpis");
    if (kpiWrap) {
      kpiWrap.innerHTML =
        `<div class="az-stat-mini"><div class="az-stat-mini-head">Zone Entries</div><div class="az-stat-mini-val">${activeEntriesTotal}</div><div class="az-stat-mini-sub">Active arenas (${zs.totalEvents || 0} raw events)</div></div>` +
        `<div class="az-stat-mini"><div class="az-stat-mini-head">Mean / Arena</div><div class="az-stat-mini-val">${fmtNum(meanEntriesPerArena, 1)}</div><div class="az-stat-mini-sub">${activeArenasCount} arenas included</div></div>` +
        `<div class="az-stat-mini"><div class="az-stat-mini-head">Mean SAB %</div><div class="az-stat-mini-val">${meanSab !== null ? fmtNum(meanSab, 1) + "%" : "N/A"}</div><div class="az-stat-mini-sub">${semSab !== null ? "± " + fmtNum(semSab, 1) + "% · " : ""}50% = chance</div></div>` +
        `<div class="az-stat-mini"><div class="az-stat-mini-head">Distinct Zones</div><div class="az-stat-mini-val">${(zs.zones && zs.zones.length) || 0}</div><div class="az-stat-mini-sub">${(zs.zones || []).map(z => "Z" + z).join(", ")}</div></div>`;
    }

    renderTransitionMatrixSvg(zs);
    renderZchangeArenaSvg(zs);
  }

  function renderTransitionMatrixSvg(zs) {
    const svg = document.getElementById("zchangeMatrixSvg");
    if (!svg) return;
    const zones = zs.zones || [];
    const matrix = zs.includedTransitionMatrix || zs.allTransitionMatrix || [];
    const W = 360, H = 250;
    if (!zones.length) {
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="#59636e">No zone transitions recorded.</text>`;
      return;
    }

    const m = { left: 54, right: 16, top: 44, bottom: 20 };
    const size = Math.min(W - m.left - m.right, H - m.top - m.bottom);
    const cell = size / zones.length;
    const startX = m.left + ((W - m.left - m.right) - size) / 2;
    const startY = m.top;

    const getCellCount = (rIdx, cIdx) => {
      if (Array.isArray(matrix) && Array.isArray(matrix[rIdx])) return matrix[rIdx][cIdx] || 0;
      const fz = zones[rIdx], tz = zones[cIdx];
      return (matrix[fz] && matrix[fz][tz]) || 0;
    };

    let maxCnt = 1;
    for (let r = 0; r < zones.length; r++) {
      for (let c = 0; c < zones.length; c++) {
        const cnt = getCellCount(r, c);
        if (cnt > maxCnt) maxCnt = cnt;
      }
    }

    let out = `<text x="${(startX + size / 2).toFixed(1)}" y="16" font-size="11" font-weight="600" fill="#59636e" text-anchor="middle">To Zone</text>`;
    out += `<text transform="rotate(-90)" x="${-(startY + size / 2)}" y="16" font-size="11" font-weight="600" fill="#59636e" text-anchor="middle">From Zone</text>`;

    zones.forEach((z, idx) => {
      const cx = startX + (idx + 0.5) * cell;
      const cy = startY + (idx + 0.5) * cell;
      out += `<text x="${cx.toFixed(1)}" y="${(startY - 8).toFixed(1)}" font-size="11" font-weight="700" fill="#1f2328" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">Z${z}</text>`;
      out += `<text x="${(startX - 10).toFixed(1)}" y="${(cy + 4).toFixed(1)}" font-size="11" font-weight="700" fill="#1f2328" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">Z${z}</text>`;
    });

    zones.forEach((fz, r) => {
      let rowSum = 0;
      for (let c = 0; c < zones.length; c++) rowSum += getCellCount(r, c);
      zones.forEach((tz, c) => {
        const cnt = getCellCount(r, c);
        const x = startX + c * cell;
        const y = startY + r * cell;
        const isDiag = fz === tz;
        const hc = isDiag && cnt === 0
          ? { fill: "#f6f8fa", text: "#8c959f" }
          : heatColor(cnt / maxCnt);
        out += `<rect x="${(x + 1.5).toFixed(1)}" y="${(y + 1.5).toFixed(1)}" width="${(cell - 3).toFixed(1)}" height="${(cell - 3).toFixed(1)}" rx="4" fill="${hc.fill}" stroke="#d0d7de" stroke-width="0.8"/>`;
        out += `<text x="${(x + cell / 2).toFixed(1)}" y="${(y + cell / 2 - (rowSum > 0 && cnt > 0 && cell >= 42 ? 4 : 0) + 4).toFixed(1)}" font-size="${cell >= 44 ? 12 : 10}" font-weight="700" fill="${hc.text}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${cnt}</text>`;
        if (rowSum > 0 && cnt > 0 && cell >= 42) {
          const pct = Math.round((cnt / rowSum) * 100);
          out += `<text x="${(x + cell / 2).toFixed(1)}" y="${(y + cell / 2 + 12).toFixed(1)}" font-size="9.5" fill="${hc.text}" opacity="0.85" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${pct}%</text>`;
        }
      });
    });

    svg.innerHTML = out;
  }

  function renderZchangeArenaSvg(zs) {
    const svg = document.getElementById("zchangeArenaSvg");
    const stage = document.getElementById("zchangeArenaStage");
    const tt = document.getElementById("zchangeTooltip");
    const a = ui.analysis;
    if (!svg || !a) return;

    const W = 460, H = 250;
    const m = { left: 48, right: 16, top: 22, bottom: 44 };
    const pw = W - m.left - m.right;
    const ph = H - m.top - m.bottom;

    const activeWells = (a.wells || []).filter(w => !w.excluded && w.zchange);
    if (!activeWells.length) {
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="#59636e">No active arena transition data.</text>`;
      return;
    }

    const useSab = activeWells.some(w => Number.isFinite(w.zchange.sabPct));
    const values = activeWells.map(w => useSab ? (w.zchange.sabPct || 0) : (w.zchange.totalEntries || 0));
    const maxV = useSab ? 100 : Math.max(5, ...values);
    const yTicksObj = niceTicks(0, maxV, 4);
    const yMax = Math.max(1, yTicksObj.max);
    const sy = (v) => m.top + ph - (v / yMax) * ph;

    let out = "";
    for (const tv of yTicksObj.ticks) {
      const yy = sy(tv);
      out += `<line x1="${m.left}" y1="${yy.toFixed(1)}" x2="${m.left + pw}" y2="${yy.toFixed(1)}" stroke="#edf1f5" stroke-width="1"/>`;
      out += `<text x="${m.left - 6}" y="${(yy + 3.5).toFixed(1)}" font-size="10" fill="#59636e" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${fmtTick(tv, yTicksObj.step)}${useSab ? "%" : ""}</text>`;
    }

    out += `<line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;
    out += `<line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;
    out += `<text transform="rotate(-90)" x="${-(m.top + ph / 2)}" y="14" font-size="10.5" font-weight="600" fill="#59636e" text-anchor="middle">${useSab ? "SAB (%)" : "Zone Entries"}</text>`;

    const slot = pw / activeWells.length;
    const barW = Math.min(26, Math.max(6, slot * 0.68));
    activeWells.forEach((w, i) => {
      const val = useSab ? w.zchange.sabPct : w.zchange.totalEntries;
      const cx = m.left + (i + 0.5) * slot;
      const col = getGroupColor(w.group);
      if (Number.isFinite(val)) {
        const yy = sy(val);
        const bh = Math.max(1, m.top + ph - yy);
        out += `<rect class="az-zc-bar" x="${(cx - barW / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${col}" fill-opacity="0.76" style="cursor:pointer;" data-zc-well="${esc(w.well)}"/>`;
      }
      if (activeWells.length <= 24 || i % 2 === 0) {
        const fontSz = activeWells.length > 16 ? 8.5 : 9.5;
        out += `<text x="${cx.toFixed(1)}" y="${m.top + ph + 14}" font-size="${fontSz}" fill="#59636e" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(w.well)}</text>`;
      }
    });

    if (useSab) {
      const ry = sy(50);
      out += `<line x1="${m.left}" y1="${ry.toFixed(1)}" x2="${m.left + pw}" y2="${ry.toFixed(1)}" stroke="#59636e" stroke-width="1.2" stroke-dasharray="4,3" pointer-events="none"/>`;
      out += `<rect x="${(m.left + pw - 66).toFixed(1)}" y="${(ry - 16).toFixed(1)}" width="64" height="13" rx="3" fill="rgba(255,255,255,0.94)" stroke="#e5e9f0" stroke-width="0.6" pointer-events="none"/>`;
      out += `<text x="${m.left + pw - 5}" y="${(ry - 6.5).toFixed(1)}" font-size="9.5" font-weight="600" fill="#59636e" text-anchor="end" pointer-events="none">50% chance</text>`;
    }

    svg.innerHTML = out;

    svg.querySelectorAll(".az-zc-bar").forEach(bar => {
      bar.addEventListener("mousemove", (e) => {
        const wellId = bar.getAttribute("data-zc-well");
        const ws = a.wellsById && a.wellsById[wellId];
        if (!ws || !ws.zchange) return;
        const col = getGroupColor(ws.group);
        const html =
          `<div class="az-tt-title">${esc(ws.well)} · <span class="az-tt-swatch" style="background:${col};"></span>${esc(ws.group)}</div>` +
          `<div class="az-tt-row"><span>Zone Entries</span><span class="az-tt-val">${ws.zchange.totalEntries || 0}</span></div>` +
          `<div class="az-tt-row"><span>Arm Entries</span><span class="az-tt-val">${ws.zchange.armEntries || 0}</span></div>` +
          (Number.isFinite(ws.zchange.sabPct) ? `<div class="az-tt-row"><span>SAB %</span><span class="az-tt-val">${fmtNum(ws.zchange.sabPct, 1)}% (${ws.zchange.alternations || 0}/${ws.zchange.triads || 0})</span></div>` : "");
        positionTooltip(tt, stage, e.clientX, e.clientY, html);
      });
      bar.addEventListener("mouseleave", () => hideTooltip(tt));
    });
  }

  // ---------------------------------------------------------------------------
  // 11. Step 5: Per-Well Summary Table
  // ---------------------------------------------------------------------------
  function renderWellTable() {
    const a = ui.analysis;
    if (!a) return;

    const grpFilter = document.getElementById("tableGroupFilter");
    if (grpFilter) {
      const presentGroups = (a.groups || []).map(g => g.group);
      const opts = [
        `<option value="__ALL__">All Groups</option>`,
        ...presentGroups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`)
      ];
      if (!presentGroups.includes(ui.tableGroupFilter)) ui.tableGroupFilter = "__ALL__";
      grpFilter.innerHTML = opts.join("");
      grpFilter.value = ui.tableGroupFilter;
    }

    const caps = a.capabilities || {};
    const cols = [
      { key: "exclude", label: "Excl.", sortable: false, num: false },
      { key: "well", label: "Well", sortable: true, num: false },
      { key: "group", label: "Group", sortable: true, num: false },
      { key: "qc", label: "QC", sortable: false, num: false },
      { key: "totalDist", label: "Total Dist (mm)", sortable: true, num: true },
      { key: "meanDist", label: "Mean / Bin", sortable: true, num: true }
    ];
    if (caps.hasMsd) cols.push({ key: "meanMsd", label: "Mean MSD", sortable: true, num: true });
    if (caps.hasZones) {
      cols.push({ key: "z1Pct", label: "Z1 %", sortable: true, num: true });
      cols.push({ key: "z2Pct", label: "Z2 %", sortable: true, num: true });
      if ((caps.maxZone || 2) === 2) cols.push({ key: "prefIdx", label: "Pref Idx", sortable: true, num: true });
    }
    if (caps.hasVmr) cols.push({ key: "vmrDelta", label: "VMR Δ", sortable: true, num: true });
    if (caps.hasPpi) cols.push({ key: "ppiPct", label: "% PPI", sortable: true, num: true });
    if (caps.hasZchange) {
      cols.push({ key: "transitions", label: "Entries", sortable: true, num: true });
      if (caps.hasSab) cols.push({ key: "sabPct", label: "SAB %", sortable: true, num: true });
    }

    const thead = document.getElementById("wellTableHead");
    if (thead) {
      thead.innerHTML = "<tr>" + cols.map(c => {
        const cls = [c.num ? "num" : "", c.sortable ? "sortable" : ""].filter(Boolean).join(" ");
        const arrow = c.sortable && ui.tableSortKey === c.key ? (ui.tableSortDir > 0 ? " ▲" : " ▼") : "";
        return `<th class="${cls}"${c.sortable ? ` data-sort-key="${c.key}"` : ""}>${esc(c.label)}${arrow}</th>`;
      }).join("") + "</tr>";

      thead.querySelectorAll("[data-sort-key]").forEach(th => {
        th.addEventListener("click", () => {
          const k = th.getAttribute("data-sort-key");
          if (ui.tableSortKey === k) ui.tableSortDir *= -1;
          else { ui.tableSortKey = k; ui.tableSortDir = k === "well" || k === "group" ? 1 : -1; }
          renderWellTable();
        });
      });
    }

    const getSortVal = (w, key) => {
      switch (key) {
        case "well": return w.well;
        case "group": return w.group || UNASSIGNED;
        case "totalDist": return w.totalDist ?? -Infinity;
        case "meanDist": return w.meanDist ?? -Infinity;
        case "meanMsd": return w.meanMsd ?? -Infinity;
        case "z1Pct": return (w.zones && w.zones.z1Pct) ?? -Infinity;
        case "z2Pct": return (w.zones && w.zones.z2Pct) ?? -Infinity;
        case "prefIdx": return (w.zones && w.zones.preferenceIndex) ?? -Infinity;
        case "vmrDelta": return (w.vmr && w.vmr.darkMinusLight) ?? -Infinity;
        case "ppiPct": return (w.startle && w.startle.ppiPct) ?? -Infinity;
        case "transitions": return (w.zchange && w.zchange.totalEntries) ?? -Infinity;
        case "sabPct": return (w.zchange && w.zchange.sabPct) ?? -Infinity;
        default: return w.well;
      }
    };

    let list = [...(a.wells || [])];
    if (ui.tableGroupFilter !== "__ALL__") {
      list = list.filter(w => (w.group || UNASSIGNED) === ui.tableGroupFilter);
    }
    if (ui.tableStatusFilter === "active") list = list.filter(w => !w.excluded);
    else if (ui.tableStatusFilter === "excluded") list = list.filter(w => w.excluded);
    else if (ui.tableStatusFilter === "flagged") list = list.filter(w => w.qc && (w.qc.isEmpty || w.qc.isSpikeGlitch));

    list.sort((x, y) => {
      const vx = getSortVal(x, ui.tableSortKey);
      const vy = getSortVal(y, ui.tableSortKey);
      if (typeof vx === "string" && typeof vy === "string") {
        return vx.localeCompare(vy, undefined, { numeric: true }) * ui.tableSortDir;
      }
      return ((vx || 0) - (vy || 0)) * ui.tableSortDir;
    });

    setText("wellTableCountHint", `Showing ${list.length} of ${(a.wells || []).length} wells`);

    const tbody = document.getElementById("wellTableBody");
    if (!tbody) return;
    const allGroupChoices = [...ui.groupOrder, UNASSIGNED];

    tbody.innerHTML = list.map(w => {
      const g = w.group || UNASSIGNED;
      const gCol = getGroupColor(g);
      const selVal = allGroupChoices.includes(g) ? g : UNASSIGNED;
      const groupSelHtml = allGroupChoices.length > 1
        ? `<select class="az-select az-table-grp-sel" data-row-group="${esc(w.well)}" aria-label="Group for ${esc(w.well)}">` +
            allGroupChoices.map(gn => `<option value="${esc(gn)}"${gn === selVal ? " selected" : ""}>${esc(gn)}</option>`).join("") +
          `</select>`
        : `<span class="az-group-tag" style="background:${hexToRgba(gCol, 0.14)};color:${gCol};"><span class="az-swatch-dot" style="background:${gCol};"></span>${esc(g)}</span>`;

      let cells =
        `<td><input type="checkbox" class="az-chk" data-row-excl="${esc(w.well)}" aria-label="Exclude ${esc(w.well)}"${w.excluded ? " checked" : ""}></td>` +
        `<td class="az-well-id-cell">${esc(w.well)}</td>` +
        `<td>${groupSelHtml}</td>` +
        `<td>${buildQcPillsHtml(w)}</td>` +
        `<td class="num">${fmtNum(w.totalDist, 1)}</td>` +
        `<td class="num">${fmtNum(w.meanDist, 2)}</td>`;
      if (caps.hasMsd) cells += `<td class="num">${fmtNum(w.meanMsd, 2)}</td>`;
      if (caps.hasZones) {
        cells += `<td class="num">${fmtNum(w.zones && w.zones.z1Pct, 1)}%</td>`;
        cells += `<td class="num">${fmtNum(w.zones && w.zones.z2Pct, 1)}%</td>`;
        if ((caps.maxZone || 2) === 2) cells += `<td class="num">${fmtNum(w.zones && w.zones.preferenceIndex, 2)}</td>`;
      }
      if (caps.hasVmr) {
        const d = w.vmr && w.vmr.darkMinusLight;
        cells += `<td class="num">${Number.isFinite(d) ? (d >= 0 ? "+" : "") + fmtNum(d, 2) : "—"}</td>`;
      }
      if (caps.hasPpi) cells += `<td class="num">${w.startle && Number.isFinite(w.startle.ppiPct) ? fmtNum(w.startle.ppiPct, 1) + "%" : "—"}</td>`;
      if (caps.hasZchange) {
        cells += `<td class="num">${w.zchange && Number.isFinite(w.zchange.totalEntries) ? w.zchange.totalEntries : "—"}</td>`;
        if (caps.hasSab) cells += `<td class="num">${w.zchange && Number.isFinite(w.zchange.sabPct) ? fmtNum(w.zchange.sabPct, 1) + "%" : "—"}</td>`;
      }
      return `<tr class="${w.excluded ? "is-excluded" : ""}" data-well-row="${esc(w.well)}">${cells}</tr>`;
    }).join("");

    tbody.querySelectorAll("[data-row-excl]").forEach(chk => {
      chk.addEventListener("change", () => {
        const well = chk.getAttribute("data-row-excl");
        if (chk.checked) ui.excludedWells.add(well);
        else ui.excludedWells.delete(well);
        recomputeAndRender();
      });
    });

    tbody.querySelectorAll("[data-row-group]").forEach(sel => {
      sel.addEventListener("change", () => {
        const well = sel.getAttribute("data-row-group");
        if (!sel.value || sel.value === UNASSIGNED || sel.value === ALL_WELLS) {
          delete ui.groups[well];
        } else {
          ui.groups[well] = sel.value;
        }
        recomputeAndRender();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 12. Group Brush Actions
  // ---------------------------------------------------------------------------
  function addNewGroup() {
    let idx = ui.groupOrder.length + 1;
    let name = `Group ${idx}`;
    while (ui.groupOrder.includes(name)) {
      idx++;
      name = `Group ${idx}`;
    }
    ui.groupOrder.push(name);
    getGroupColor(name);
    ui.activeBrushGroup = name;
    ui.brushTool = "group";
    renderPlateControls();
    const inp = document.getElementById("activeGroupNameInput");
    if (inp) { inp.focus(); inp.select(); }
  }

  function renameActiveGroup(rawNewName) {
    const oldName = ui.activeBrushGroup;
    if (!oldName || oldName === UNASSIGNED) return;
    const nextName = String(rawNewName || "").trim().slice(0, 32);
    if (!nextName || nextName === oldName || nextName === UNASSIGNED || nextName === ALL_WELLS) return;
    if (ui.groupOrder.includes(nextName)) {
      toast(`Group "${nextName}" already exists`);
      renderPlateControls();
      return;
    }
    const idx = ui.groupOrder.indexOf(oldName);
    if (idx >= 0) ui.groupOrder[idx] = nextName;
    ui.groupColors[nextName] = ui.groupColors[oldName] || getGroupColor(oldName);
    delete ui.groupColors[oldName];
    for (const w of Object.keys(ui.groups)) {
      if (ui.groups[w] === oldName) ui.groups[w] = nextName;
    }
    if (ui.hiddenGroups.has(oldName)) {
      ui.hiddenGroups.delete(oldName);
      ui.hiddenGroups.add(nextName);
    }
    ui.activeBrushGroup = nextName;
    recomputeAndRender();
  }

  function deleteActiveGroup() {
    const target = ui.activeBrushGroup;
    if (!target || target === UNASSIGNED) return;
    ui.groupOrder = ui.groupOrder.filter(g => g !== target);
    delete ui.groupColors[target];
    ui.hiddenGroups.delete(target);
    for (const w of Object.keys(ui.groups)) {
      if (ui.groups[w] === target) delete ui.groups[w];
    }
    ui.activeBrushGroup = ui.groupOrder.length ? ui.groupOrder[0] : UNASSIGNED;
    recomputeAndRender();
  }

  function autoAssignGroups(axis) {
    if (!ui.summaryParsed || !ui.analysis || !ui.analysis.layout) return;
    if (ui.groupOrder.length === 0) {
      ui.groupOrder = ["Group 1", "Group 2", "Group 3"];
      ui.groupOrder.forEach(getGroupColor);
      ui.activeBrushGroup = ui.groupOrder[0];
    }
    const nGrps = ui.groupOrder.length;
    const coords = ui.analysis.layout.wellCoords || {};
    const wells = ui.summaryParsed.wells;

    const quantize = (v) => Math.round((Number(v) || 0) / 4) * 4;
    const useGeom = Boolean(ui.analysis.layout.isMaze);
    const getPos = (w, i) => {
      const wc = coords[w];
      if (!wc) return axis === "row" ? Math.floor(i / 6) : (i % 6);
      if (useGeom) return axis === "row" ? quantize(wc.y) : quantize(wc.x);
      return axis === "row" ? wc.row : wc.col;
    };

    const distinctVals = [...new Set(wells.map((w, i) => getPos(w, i)))].sort((a, b) => a - b);
    wells.forEach((w, i) => {
      const idx = distinctVals.indexOf(getPos(w, i));
      const gIdx = Math.min(nGrps - 1, Math.floor((Math.max(0, idx) * nGrps) / Math.max(1, distinctVals.length)));
      ui.groups[w] = ui.groupOrder[gIdx];
    });
    recomputeAndRender();
    toast(`Filled ${nGrps} groups by ${axis}`);
  }

  function excludeAllFlaggedWells() {
    if (!ui.analysis || !ui.analysis.kpis) return;
    const flagged = ui.analysis.kpis.flaggedWells || [];
    let added = 0;
    for (const w of flagged) {
      if (!ui.excludedWells.has(w)) {
        ui.excludedWells.add(w);
        added++;
      }
    }
    if (added > 0) {
      recomputeAndRender();
      toast(`Excluded ${added} QC-flagged well${added === 1 ? "" : "s"}`);
    } else {
      toast("No remaining flagged wells to exclude");
    }
  }

  function triggerPrismExport() {
    const core = getCore();
    if (!core || !ui.analysis) return;
    const csv = core.buildPrismGroupedCsv(ui.analysis, ui.prismMetric);
    downloadTextFile(csv, `${getExportBasename()}_prism_${ui.prismMetric}.csv`, "text/csv;charset=utf-8");
    toast("Downloaded Prism Grouped CSV");
  }

  // ---------------------------------------------------------------------------
  // 13. Event Binding & Initialization
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // Wizard step navigation
    document.querySelectorAll("[data-goto]").forEach(el => {
      el.addEventListener("click", () => goToPage(el.getAttribute("data-goto")));
    });

    const prevBtn = document.getElementById("wizPrevBtn");
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        const idx = pageIndexOf(ui.currentPage);
        if (idx > 0) goToPage(ANALYZER_PAGES[idx - 1].id);
      });
    }

    const nextBtn = document.getElementById("wizNextBtn");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        const idx = pageIndexOf(ui.currentPage);
        if (idx < ANALYZER_PAGES.length - 1) {
          goToPage(ANALYZER_PAGES[idx + 1].id);
        } else {
          triggerPrismExport();
        }
      });
    }

    window.addEventListener("hashchange", () => {
      const id = location.hash.slice(1);
      if (pageIndexOf(id) >= 0) goToPage(id);
    });

    // Topbar & Sidebar actions
    const demoSel = document.getElementById("demoPresetSelect");
    if (demoSel) {
      demoSel.addEventListener("change", () => {
        if (demoSel.value) loadDemoDataset(demoSel.value);
      });
    }

    const useCtxBtn = document.getElementById("useBuilderConfigBtn");
    if (useCtxBtn) useCtxBtn.addEventListener("click", loadLatestBuilderConfig);
    const step1CtxBtn = document.getElementById("step1BuilderConfigBtn");
    if (step1CtxBtn) step1CtxBtn.addEventListener("click", loadLatestBuilderConfig);

    const clearBtn = document.getElementById("clearAllBtn");
    if (clearBtn) clearBtn.addEventListener("click", clearAllData);
    const sbClearBtn = document.getElementById("sidebarClearBtn");
    if (sbClearBtn) sbClearBtn.addEventListener("click", clearAllData);
    const sbDemoBtn = document.getElementById("sidebarQuickDemoBtn");
    if (sbDemoBtn) sbDemoBtn.addEventListener("click", () => loadDemoDataset("ld_24w"));

    const clearCtxBtn = document.getElementById("clearContextBtn");
    if (clearCtxBtn) {
      clearCtxBtn.addEventListener("click", () => {
        ui.context = null;
        ui.contextFilename = "";
        if (ui.summaryParsed) recomputeAndRender();
        else renderAll();
        toast("Detached Builder context");
      });
    }

    // Demo cards & empty-state demo buttons
    document.querySelectorAll("[data-demo]").forEach(btn => {
      btn.addEventListener("click", () => loadDemoDataset(btn.getAttribute("data-demo")));
    });

    const loadYmazeBtn = document.getElementById("loadYmazeDemoFromTabBtn");
    if (loadYmazeBtn) {
      loadYmazeBtn.addEventListener("click", () => {
        ui.activeChartTab = "zchange";
        loadDemoDataset("ymaze_15");
      });
    }

    // File dropzone & picker
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("analyzerFileInput");
    const browseBtn = document.getElementById("browseFilesBtn");

    if (browseBtn && fileInput) {
      browseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        fileInput.value = "";
        fileInput.click();
      });
    }
    if (dropZone && fileInput) {
      dropZone.addEventListener("click", () => {
        fileInput.value = "";
        fileInput.click();
      });
      dropZone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileInput.value = "";
          fileInput.click();
        }
      });
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("is-dragover");
      });
      dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragover"));
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("is-dragover");
        if (e.dataTransfer && e.dataTransfer.files) {
          handleIncomingFiles(e.dataTransfer.files);
        }
      });
    }
    if (fileInput) {
      fileInput.addEventListener("change", () => {
        if (fileInput.files && fileInput.files.length) {
          handleIncomingFiles(fileInput.files);
        }
      });
    }

    // Step 2: QC controls & Heatmap SVG interaction
    const exclFlagBtn = document.getElementById("excludeFlaggedBtn");
    if (exclFlagBtn) exclFlagBtn.addEventListener("click", excludeAllFlaggedWells);
    const qcExclBtn = document.getElementById("qcExcludeFlaggedBtn");
    if (qcExclBtn) qcExclBtn.addEventListener("click", excludeAllFlaggedWells);
    const restAllBtn = document.getElementById("restoreAllWellsBtn");
    if (restAllBtn) {
      restAllBtn.addEventListener("click", () => {
        ui.excludedWells.clear();
        recomputeAndRender();
        toast("Restored all excluded wells");
      });
    }

    const plateMetricSel = document.getElementById("plateMetricSel");
    if (plateMetricSel) {
      plateMetricSel.addEventListener("change", () => {
        ui.plateMetric = plateMetricSel.value;
        renderAllPlateMaps();
      });
    }

    const inspBtn = document.getElementById("qcWellInspectorExcludeBtn");
    if (inspBtn) {
      inspBtn.addEventListener("click", () => {
        if (!ui.selectedWell) return;
        if (ui.excludedWells.has(ui.selectedWell)) ui.excludedWells.delete(ui.selectedWell);
        else ui.excludedWells.add(ui.selectedWell);
        recomputeAndRender();
      });
    }

    const qcSvg = document.getElementById("qcPlateSvg");
    if (qcSvg) {
      qcSvg.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const target = e.target && e.target.closest ? e.target.closest("[data-well]") : null;
        if (!target) return;
        const wellId = target.getAttribute("data-well");
        if (!wellId) return;
        ui.selectedWell = wellId;
        if (e.shiftKey || e.altKey) {
          if (ui.excludedWells.has(wellId)) ui.excludedWells.delete(wellId);
          else ui.excludedWells.add(wellId);
          recomputeAndRender();
        } else {
          renderAllPlateMaps();
          renderWellInspector();
        }
      });

      qcSvg.addEventListener("pointermove", (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const target = el && el.closest ? el.closest("[data-well]") : null;
        const wellId = target ? target.getAttribute("data-well") : null;
        const tt = document.getElementById("qcPlateTooltip");
        const stage = document.getElementById("qcPlateSvgWrap");
        if (wellId) showPlateTooltipInto(tt, stage, wellId, e.clientX, e.clientY);
        else hideTooltip(tt);
      });

      qcSvg.addEventListener("pointerleave", () => {
        hideTooltip(document.getElementById("qcPlateTooltip"));
      });
    }

    const qcFilterSel = document.getElementById("qcFilterSel");
    if (qcFilterSel) {
      qcFilterSel.addEventListener("change", () => { ui.qcFilter = qcFilterSel.value; renderTempAndQcDiagnostics(); });
    }
    const qcSortSel = document.getElementById("qcSortSel");
    if (qcSortSel) {
      qcSortSel.addEventListener("change", () => { ui.qcSort = qcSortSel.value; renderTempAndQcDiagnostics(); });
    }

    // Step 3: Group Brush controls & Painter SVG interaction
    const addGrpBtn = document.getElementById("addGroupBtn");
    if (addGrpBtn) addGrpBtn.addEventListener("click", addNewGroup);
    const delGrpBtn = document.getElementById("deleteGroupBtn");
    if (delGrpBtn) delGrpBtn.addEventListener("click", deleteActiveGroup);

    const renameInp = document.getElementById("activeGroupNameInput");
    if (renameInp) {
      renameInp.addEventListener("change", () => renameActiveGroup(renameInp.value));
      renameInp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          renameActiveGroup(renameInp.value);
          renameInp.blur();
        }
      });
    }

    const exBrushBtn = document.getElementById("brushExcludeBtn");
    if (exBrushBtn) {
      exBrushBtn.addEventListener("click", () => {
        ui.brushTool = ui.brushTool === "exclude" ? "group" : "exclude";
        renderPlateControls();
      });
    }

    const rowBtn = document.getElementById("autoAssignRowsBtn");
    if (rowBtn) rowBtn.addEventListener("click", () => autoAssignGroups("row"));
    const colBtn = document.getElementById("autoAssignColsBtn");
    if (colBtn) colBtn.addEventListener("click", () => autoAssignGroups("col"));

    const saveMapBtn = document.getElementById("savePlateMapBtn");
    if (saveMapBtn) saveMapBtn.addEventListener("click", savePlateMapJson);
    const loadMapBtn = document.getElementById("loadPlateMapBtn");
    const mapInput = document.getElementById("plateMapFileInput");
    if (loadMapBtn && mapInput) {
      loadMapBtn.addEventListener("click", () => { mapInput.value = ""; mapInput.click(); });
      mapInput.addEventListener("change", async () => {
        const f = mapInput.files && mapInput.files[0];
        if (!f) return;
        try {
          const obj = JSON.parse(await f.text());
          applyPlateMapObject(obj);
          recomputeAndRender();
          toast(`Loaded plate map from ${f.name}`);
        } catch (err) {
          toast("Invalid plate map JSON file");
        }
      });
    }

    const brushSvg = document.getElementById("brushPlateSvg");
    if (brushSvg) {
      brushSvg.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const target = e.target && e.target.closest ? e.target.closest("[data-well]") : null;
        if (!target) return;
        const wellId = target.getAttribute("data-well");
        if (!wellId) return;
        e.preventDefault();
        _painting = true;
        _paintedInStroke = new Set();
        paintWell(wellId, true);
      });

      brushSvg.addEventListener("pointermove", (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const target = el && el.closest ? el.closest("[data-well]") : null;
        const wellId = target ? target.getAttribute("data-well") : null;
        if (_painting && wellId) paintWell(wellId, false);
        const tt = document.getElementById("brushPlateTooltip");
        const stage = document.getElementById("brushPlateSvgWrap");
        if (wellId) showPlateTooltipInto(tt, stage, wellId, e.clientX, e.clientY);
        else hideTooltip(tt);
      });

      brushSvg.addEventListener("pointerleave", () => {
        hideTooltip(document.getElementById("brushPlateTooltip"));
      });

      window.addEventListener("pointerup", () => {
        _painting = false;
        _paintedInStroke.clear();
      });
    }

    // Step 4: Plot tabs & chart controls
    document.querySelectorAll("#chartTabsBar [data-chart-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        ui.activeChartTab = btn.getAttribute("data-chart-tab") || "timeseries";
        renderChartToolbars();
        renderAllPlotTabs();
        renderDatasetSummarySidebar();
      });
    });

    const tsMetricSel = document.getElementById("tsMetricSel");
    if (tsMetricSel) {
      tsMetricSel.addEventListener("change", () => {
        ui.tsMetric = tsMetricSel.value;
        recomputeAndRender();
      });
    }
    const tsSmoothSel = document.getElementById("tsSmoothSel");
    if (tsSmoothSel) {
      tsSmoothSel.addEventListener("change", () => {
        ui.tsBinGroupSize = Math.max(1, parseInt(tsSmoothSel.value, 10) || 1);
        recomputeAndRender();
      });
    }
    const bindChk = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", () => { ui[key] = Boolean(el.checked); renderTimeSeriesChart(); });
    };
    bindChk("tsShowSem", "tsShowSem");
    bindChk("tsShowPhases", "tsShowPhases");
    bindChk("tsShowStim", "tsShowStim");

    const compSel = document.getElementById("compViewSel");
    if (compSel) {
      compSel.addEventListener("change", () => {
        ui.compView = compSel.value;
        renderComparisonChart();
      });
    }

    const bindSvgDl = (btnId, svgId, suffix) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.addEventListener("click", () => {
          downloadSvgElement(document.getElementById(svgId), `${getExportBasename()}_${suffix}.svg`);
        });
      }
    };
    bindSvgDl("downloadTsSvgBtn", "tsChartSvg", "timeseries");
    bindSvgDl("downloadCompSvgBtn", "compChartSvg", "comparison");
    bindSvgDl("downloadTempSvgBtn", "tempChartSvg", "temperature");
    bindSvgDl("downloadZchangeSvgBtn", "zchangeMatrixSvg", "zchange_matrix");

    // Step 5: Table filters & Export Hub
    const tGrp = document.getElementById("tableGroupFilter");
    if (tGrp) tGrp.addEventListener("change", () => { ui.tableGroupFilter = tGrp.value; renderWellTable(); });
    const tSt = document.getElementById("tableStatusFilter");
    if (tSt) tSt.addEventListener("change", () => { ui.tableStatusFilter = tSt.value; renderWellTable(); });

    const prismSel = document.getElementById("prismMetricSel");
    if (prismSel) prismSel.addEventListener("change", () => { ui.prismMetric = prismSel.value; });

    const bindExport = (id, fn) => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener("click", fn);
    };

    bindExport("exportTidyBtn", () => {
      const core = getCore();
      if (!core || !ui.analysis || !ui.summaryParsed) return;
      const csv = core.buildTidyLongCsv(ui.analysis, ui.summaryParsed, ui.groups, ui.excludedWells);
      downloadTextFile(csv, `${getExportBasename()}_tidy_long.csv`, "text/csv;charset=utf-8");
      toast("Downloaded Tidy Long CSV");
    });

    bindExport("exportSummaryBtn", () => {
      const core = getCore();
      if (!core || !ui.analysis) return;
      const csv = core.buildWellSummaryCsv(ui.analysis);
      downloadTextFile(csv, `${getExportBasename()}_well_summary.csv`, "text/csv;charset=utf-8");
      toast("Downloaded Well Summary CSV");
    });

    bindExport("exportPrismBtn", triggerPrismExport);

    bindExport("copyPrismBtn", () => {
      const core = getCore();
      if (!core || !ui.analysis) return;
      const tsv = typeof core.buildPrismGroupedTsv === "function"
        ? core.buildPrismGroupedTsv(ui.analysis, ui.prismMetric)
        : core.buildPrismGroupedCsv(ui.analysis, ui.prismMetric, { delimiter: "\t" });
      copyTextToClipboard(tsv).then(() => toast("Copied Prism table to clipboard (tab-separated)"));
    });

    bindExport("exportPythonBtn", () => {
      const core = getCore();
      if (!core || !ui.analysis || !ui.summaryParsed) return;
      const py = core.buildPythonTemplate(ui.analysis, ui.summaryParsed);
      downloadTextFile(py, `${getExportBasename()}_analysis.py`, "text/x-python;charset=utf-8");
      toast("Downloaded Python analysis script (.py)");
    });
  }

  function init() {
    if (typeof loadInitialPlateConfig === "function") {
      try { loadInitialPlateConfig(); } catch (_) {}
    }
    bindEvents();

    const fromHash = location.hash.slice(1);
    goToPage(pageIndexOf(fromHash) >= 0 ? fromHash : "data", { initial: true });
    renderAll();

    window.ZANTIKS_ANALYZER_UI = {
      getState: () => ui,
      loadDemo: loadDemoDataset,
      loadLatestBuilderConfig,
      clearAll: clearAllData,
      goToPage,
      recomputeAndRender
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
