// Zantiks MWP Data Prep & Analyzer - 5-Step Wizard UI, Multi-Run Pooling, Multi-Factor Painter, Route C Plots, Quick Screening Stats & v2 Exporters
// Classic script: depends on js/analyzer-core.js (window.ZANTIKS_ANALYZER_CORE), js/helpers.js, js/export-utils.js.
"use strict";

(function () {
  const UNASSIGNED = "Unassigned";
  const ALL_WELLS = "All Wells";
  const PRIMARY_LAYER = "__PRIMARY__";
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

  let _runSeq = 1;
  function nextRunInternalId() {
    return `run_${_runSeq++}`;
  }

  // ---------------------------------------------------------------------------
  // 1. Unified Multi-Run UI State (mirrors active run on legacy top-level keys)
  // ---------------------------------------------------------------------------
  const ui = {
    currentPage: "data",

    // v2 Multi-run & Data Prep state
    runs: [],                  // Array<RunRecord>
    activeRunId: null,         // internal run.id
    scope: "active",           // "active" | "pooled"
    unitOfAnalysis: "wells",   // "wells" | "plates"
    normalizeToControl: false,
    controlGroupName: "",
    qcThresholds: null,        // { presetId, emptyDistMm, spikeMaxSpeedMmS, spikeMinMm, spikeMadMult }
    trimWindow: { trimStartSec: 0, trimEndSec: null },
    windowAuc: { startSec: null, endSec: null },
    xyFreezeSpeedMmS: 0.5,
    primaryTestFamily: "parametric", // "parametric" | "nonparametric"
    hasViewedStats: false,
    lastStatsSnapshot: null,

    // Pending context/companions attached before any Summary CSV is dropped
    pendingContext: null,
    pendingContextFilename: "",
    pendingZchange: null,
    pendingXy: null,

    // Legacy v1 top-level mirrors (always synced to active run for backward compat)
    summaryParsed: null,
    zchangeParsed: null,
    xyParsed: null,
    context: null,
    contextFilename: "",
    activeDemoId: "",
    groups: {},
    groupOrder: [],
    groupColors: {},
    factorNames: [],
    wellFactors: {},
    excludedWells: new Set(),
    excludeMeta: {},

    hiddenGroups: new Set(),

    // Step 2 / Step 3 UI controls
    plateMetric: "totalDist",
    activeFactorLayer: PRIMARY_LAYER, // PRIMARY_LAYER or factorName
    activeBrushGroup: UNASSIGNED,
    activeBrushFactorVal: UNASSIGNED,
    brushTool: "group",               // "group" | "exclude"
    selectedWell: null,

    // Step 4 Plots controls
    activeChartTab: "timeseries",     // "timeseries" | "comparison" | "zchange" | "spatial"
    tsMetric: "dist",
    tsBinGroupSize: 1,
    tsTraceView: "full",              // "full" | "peri" | "habituation"
    tsPeriType: "ALL",
    tsShowSem: true,
    tsShowPhases: true,
    tsShowStim: true,

    compView: "",
    compShowStats: true,
    qcFilter: "flagged",
    qcSort: "severity",

    // Step 5 Table & Export controls
    tableGroupFilter: "__ALL__",
    tableStatusFilter: "all",
    tableSortKey: "well",
    tableSortDir: 1,
    prismMetric: "total_dist",

    analysis: null
  };

  let _painting = false;
  let _paintExcludeValue = true;
  let _paintedInStroke = new Set();

  function getActiveRun() {
    if (!ui.runs.length) return null;
    const hit = ui.runs.find(r => r.id === ui.activeRunId || r.runId === ui.activeRunId);
    return hit || ui.runs[0];
  }

  function getRunByIdOrLabel(idOrLabel) {
    if (!idOrLabel) return getActiveRun();
    return ui.runs.find(r => r.id === idOrLabel || r.runId === idOrLabel) || getActiveRun();
  }

  function getActiveRunAnalysis() {
    const a = ui.analysis;
    if (!a) return null;
    if (a.scope === "pooled" && Array.isArray(a.runAnalyses) && a.runAnalyses.length) {
      const hit = a.runAnalyses.find(x => x.id === ui.activeRunId || x.runId === ui.activeRunId);
      return (hit && hit.analysis) || a.runAnalyses[0].analysis;
    }
    return a;
  }

  function syncLegacyStateAliases() {
    const run = getActiveRun();
    if (run) {
      ui.activeRunId = run.id;
      ui.summaryParsed = run.summaryParsed || null;
      ui.zchangeParsed = run.zchangeParsed || null;
      ui.xyParsed = run.xyParsed || null;
      ui.context = run.context || ui.pendingContext || null;
      ui.contextFilename = run.contextFilename || ui.pendingContextFilename || "";
      ui.groups = run.groups;
      ui.groupOrder = run.groupOrder;
      ui.groupColors = run.groupColors;
      ui.factorNames = run.factorNames;
      ui.wellFactors = run.wellFactors;
      ui.excludedWells = run.excludedWells;
      ui.excludeMeta = run.excludeMeta;
    } else {
      ui.activeRunId = null;
      ui.summaryParsed = null;
      ui.zchangeParsed = ui.pendingZchange || null;
      ui.xyParsed = ui.pendingXy || null;
      ui.context = ui.pendingContext || null;
      ui.contextFilename = ui.pendingContextFilename || "";
      ui.groups = {};
      ui.groupOrder = [];
      ui.groupColors = {};
      ui.factorNames = [];
      ui.wellFactors = {};
      ui.excludedWells = new Set();
      ui.excludeMeta = {};
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Formatting, Sexagesimal Time Axis & Color Helpers
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

  function setTextWithTitle(id, text) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = text;
      el.title = text || "";
    }
  }

  function fmtNum(val, decimals) {
    if (val === null || val === undefined || !Number.isFinite(Number(val))) return "—";
    const d = decimals !== undefined ? decimals : 1;
    const n = Number(val);
    if (Math.abs(n) >= 1000 && d > 0) return n.toFixed(0);
    return n.toFixed(d);
  }

  function fmtStat(val, digits) {
    const core = getCore();
    if (core && core.stats && typeof core.stats.formatStatNum === "function") {
      return core.stats.formatStatNum(val, digits !== undefined ? digits : 2);
    }
    if (val === null || val === undefined || !Number.isFinite(Number(val))) return "—";
    return Number(val).toFixed(digits !== undefined ? digits : 2);
  }

  function fmtPVal(p) {
    const core = getCore();
    if (core && core.stats && typeof core.stats.formatPVal === "function") {
      return core.stats.formatPVal(p);
    }
    if (p === null || p === undefined || !Number.isFinite(Number(p))) return "—";
    const n = Number(p);
    if (n < 0.0001) return "< 0.0001";
    if (n < 0.001) return n.toFixed(4);
    return n.toFixed(3);
  }

  function fmtNUnit(n, analysis) {
    const count = Number.isFinite(Number(n)) ? Number(n) : 0;
    const isPlates = Boolean(analysis && analysis.nUnit === "plates");
    const unit = isPlates ? (count === 1 ? "plate" : "plates") : (count === 1 ? "well" : "wells");
    return `${count} ${unit}`;
  }

  function resetWorkspaceControlsDom() {
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const rmInvalid = (id) => { const el = document.getElementById(id); if (el) el.classList.remove("is-invalid"); };
    setVal("tsSmoothSel", "1");
    setVal("tsWinStartInput", "");
    setVal("tsWinEndInput", "");
    setVal("qcTrimStartInput", "0");
    setVal("qcTrimEndInput", "");
    setVal("xyFreezeInput", "0.5");
    setVal("compTestFamilySel", ui.primaryTestFamily || "parametric");
    const normChk = document.getElementById("normControlChk");
    if (normChk) normChk.checked = false;
    ["tsWinStartInput", "tsWinEndInput", "qcTrimStartInput", "qcTrimEndInput"].forEach(rmInvalid);
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

  // Sexagesimal Elapsed Time tick formatter (preserved verbatim: 0m, 5m, 10m, 15m, 20m — never clock-like ":")
  function fmtAxisTime(sec, maxSec, stepSec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    if (s === 0) {
      if (maxSec >= 7200) return "0h";
      if (stepSec && stepSec < 60) return "0s";
      if (maxSec >= 180) return "0m";
      return "0s";
    }
    if (maxSec >= 7200) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (m === 0) return `${h}h`;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    if (maxSec >= 180) {
      const m = Math.floor(s / 60);
      const r = s % 60;
      if (r === 0) return `${m}m`;
      return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
    }
    return `${s}s`;
  }

  const TIME_TICK_STEPS_SEC = [
    1, 2, 5, 10, 15, 20, 30,
    60, 120, 180, 300, 600, 900, 1200, 1800,
    3600, 7200, 10800, 14400, 21600, 28800, 43200, 86400
  ];

  function niceTimeTicks(minSec, maxSec, targetCount) {
    const count = Math.max(2, targetCount || 5);
    let lo = Number.isFinite(minSec) ? minSec : 0;
    let hi = Number.isFinite(maxSec) ? maxSec : 60;
    if (hi < lo) { const tmp = lo; lo = hi; hi = tmp; }
    const span = Math.max(1, hi - lo);
    const ideal = span / count;

    let step = TIME_TICK_STEPS_SEC[TIME_TICK_STEPS_SEC.length - 1];
    if (ideal > step) {
      step = Math.ceil(ideal / 86400) * 86400;
    } else {
      let bestScore = Infinity;
      for (const cand of TIME_TICK_STEPS_SEC) {
        const first = Math.ceil((lo - 1e-6) / cand) * cand;
        const last = Math.floor((hi + 1e-6) / cand) * cand;
        const nTicks = last >= first ? Math.floor((last - first) / cand) + 1 : 0;
        if (nTicks < 2 || nTicks > 11) continue;
        let score = Math.abs(nTicks - (count + 1));
        if (Math.abs(span % cand) < 1e-6) score -= 0.45;
        if (cand >= 60 && cand % 300 === 0) score -= 0.1;
        if (score < bestScore) {
          bestScore = score;
          step = cand;
        }
      }
    }

    const firstTick = Math.ceil((lo - 1e-6) / step) * step;
    const ticks = [];
    for (let v = firstTick; v <= hi + 1e-6 && ticks.length < 16; v += step) {
      ticks.push(Math.abs(v) < 1e-9 ? 0 : Math.round(v));
    }
    if (!ticks.length) ticks.push(Math.round(lo), Math.round(hi));
    return { min: lo, max: hi, step, ticks };
  }

  function getGroupColor(name) {
    if (!name || name === UNASSIGNED) return UNASSIGNED_COLOR;
    if (name === ALL_WELLS) return "#0969da";
    const run = getActiveRun();
    if (run && run.groupColors && run.groupColors[name]) return run.groupColors[name];
    for (const r of ui.runs) {
      if (r.groupColors && r.groupColors[name]) return r.groupColors[name];
    }
    const pal = getPalette();
    let idx = (run && run.groupOrder) ? run.groupOrder.indexOf(name) : -1;
    if (idx < 0) {
      let h = 0;
      for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
      idx = h % pal.length;
    }
    const col = pal[idx % pal.length];
    if (run && run.groupColors) run.groupColors[name] = col;
    return col;
  }

  function getFactorLevelColor(factorName, levelVal, levelOrder) {
    if (!levelVal || levelVal === UNASSIGNED) return UNASSIGNED_COLOR;
    const pal = getPalette();
    const idx = Array.isArray(levelOrder) ? levelOrder.indexOf(levelVal) : -1;
    if (idx >= 0) return pal[idx % pal.length];
    let h = 0;
    const s = `${factorName}:${levelVal}`;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return pal[h % pal.length];
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
        return { fill: `rgb(${r}, ${g}, ${b})`, text: t >= 0.52 ? "#ffffff" : "#1f2328" };
      }
    }
    return { fill: "rgb(30, 58, 138)", text: "#ffffff" };
  }

  // High-contrast scientific ramp for 2D _XY occupancy heatmaps (slate -> sky -> blue -> amber -> crimson)
  function spatialHeatColor(tRaw) {
    const t = Math.max(0, Math.min(1, Number.isFinite(tRaw) ? tRaw : 0));
    if (t <= 0.005) return "#f8fafc";
    const stops = [
      [0.00, [241, 245, 249]],
      [0.22, [147, 197, 253]],
      [0.50, [37, 99, 235]],
      [0.78, [245, 158, 11]],
      [1.00, [220, 38, 38]]
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (t <= t1) {
        const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
        const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
        const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
        return `rgb(${r},${g},${b})`;
      }
    }
    return "rgb(220,38,38)";
  }

  function phaseBandStyle(span, idx) {
    const hint = String(span.colorHint || span.kind || span.phase || "").toLowerCase();
    const phaseText = String(span.phase || "").toLowerCase();
    if (hint.includes("dawn") || phaseText.includes("dawn")) return { fill: "rgba(253, 186, 116, 0.30)", text: "#9a3412" };
    if (hint.includes("dusk") || phaseText.includes("dusk")) return { fill: "rgba(165, 180, 252, 0.28)", text: "#3730a3" };
    if (hint.includes("transition")) return { fill: "rgba(203, 213, 225, 0.34)", text: "#475569" };
    if (hint.includes("acclim") || hint.includes("baseline")) return { fill: "rgba(226, 232, 240, 0.42)", text: "#475569" };
    if (hint.includes("dark") || hint === "night") return { fill: "rgba(148, 163, 184, 0.23)", text: "#334155" };
    if (hint.includes("light") || hint.includes("white") || hint === "day") return { fill: "rgba(254, 240, 138, 0.36)", text: "#854d0e" };
    if (hint.includes("ppi")) return { fill: "rgba(221, 214, 254, 0.34)", text: "#5b21b6" };
    if (hint.includes("pulse") || hint.includes("startle") || hint.includes("vib") || hint.includes("tap")) return { fill: "rgba(254, 215, 170, 0.36)", text: "#9a3412" };
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
    if (Math.abs(hi - lo) < 1e-9) hi = lo === 0 ? 1 : lo * 1.2 + 1;
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

  function deterministicJitter(keyStr, span) {
    const s = String(keyStr || "");
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
    const vb = (clone.getAttribute("viewBox") || "0 0 880 320").split(/\s+/).map(Number);
    const w = vb[2] || 880;
    const h = vb[3] || 320;
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
    if (left + ttRect.width > stageRect.width - 6) left = clientX - stageRect.left - ttRect.width - 12;
    if (left < 6) left = 6;
    if (top + ttRect.height > stageRect.height - 6) top = stageRect.height - ttRect.height - 6;
    if (top < 6) top = 6;
    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
  }

  function hideTooltip(tooltipEl) {
    if (tooltipEl) tooltipEl.style.display = "none";
  }

  function getExportBasename() {
    const core = getCore();
    const isPooled = ui.runs.length > 1 && ui.scope === "pooled";
    const run = getActiveRun();
    if (core && typeof core.computeExportBasename === "function") {
      return core.computeExportBasename({
        scope: isPooled ? "pooled" : "active",
        runs: ui.runs,
        activeRunId: ui.activeRunId,
        filename: run && run.filename ? run.filename : ""
      });
    }
    if (isPooled) {
      return `zantiks_pooled_${ui.runs.length}runs`;
    }
    if (run && run.filename) {
      return run.filename
        .replace(/\.csv$/i, "")
        .replace(/[^A-Za-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "zantiks_analysis";
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
        nextBtn.disabled = ui.runs.length === 0;
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

    if (changed && !(opts && opts.initial)) window.scrollTo(0, 0);

    if (id === "plots" && ui.analysis && ui.activeChartTab === "comparison") {
      renderComparisonChart();
    } else if (id === "export" && ui.analysis) {
      updateWellTableScrollHint();
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Run Creation, Multi-Factor Registry & Demo / File Loaders
  // ---------------------------------------------------------------------------
  function buildFactorLevelOrder(factorNames, wellFactors) {
    const out = {};
    for (const fn of (factorNames || [])) {
      const seen = [];
      const set = new Set();
      const map = (wellFactors && wellFactors[fn]) || {};
      for (const v of Object.values(map)) {
        const clean = String(v || "").trim();
        if (clean && clean !== UNASSIGNED && !set.has(clean)) {
          set.add(clean);
          seen.push(clean);
        }
      }
      out[fn] = seen;
    }
    return out;
  }

  function buildGroupRegistryForRun(groupMap, explicitOrder, paletteOverride) {
    const seen = [];
    const set = new Set();
    for (const g of (explicitOrder || [])) {
      const name = String(g || "").trim();
      if (name && name !== UNASSIGNED && name !== ALL_WELLS && !set.has(name)) {
        set.add(name);
        seen.push(name);
      }
    }
    if (groupMap && typeof groupMap === "object") {
      for (const g of Object.values(groupMap)) {
        const name = String(g || "").trim();
        if (name && name !== UNASSIGNED && name !== ALL_WELLS && !set.has(name)) {
          set.add(name);
          seen.push(name);
        }
      }
    }
    const colors = {};
    const pal = getPalette();
    seen.forEach((name, idx) => {
      colors[name] = (paletteOverride && paletteOverride[name]) || pal[idx % pal.length];
    });
    return { groupOrder: seen, groupColors: colors };
  }

  function ensureUniqueRunLabel(baseLabel, excludeInternalId) {
    const existing = new Set(ui.runs.filter(r => r.id !== excludeInternalId).map(r => r.runId));
    let cand = String(baseLabel || "Run_1").trim() || "Run_1";
    if (!existing.has(cand)) return cand;
    let n = 2;
    while (existing.has(`${cand}_${n}`)) n++;
    return `${cand}_${n}`;
  }

  function createRunRecord(opts) {
    const core = getCore();
    const sp = opts.summaryParsed;
    const filename = opts.filename || (sp && sp.filename) || "data.csv";
    const inferred = (core && typeof core.inferRunMeta === "function")
      ? core.inferRunMeta(filename, sp, opts.lastModifiedMs)
      : { runId: filename.replace(/\.csv$/i, ""), date: new Date().toISOString().slice(0, 10) };

    const groups = {};
    if (opts.groups && typeof opts.groups === "object") {
      for (const [w, g] of Object.entries(opts.groups)) {
        const clean = String(g || "").trim();
        if (clean && clean !== UNASSIGNED && clean !== ALL_WELLS) groups[w] = clean;
      }
    }
    const reg = buildGroupRegistryForRun(groups, opts.groupOrder, opts.groupPalette || opts.groupColors);
    const factorNames = Array.isArray(opts.factorNames) ? opts.factorNames.map(s => String(s).trim()).filter(Boolean) : [];
    const wellFactors = {};
    for (const fn of factorNames) {
      wellFactors[fn] = (opts.wellFactors && opts.wellFactors[fn]) ? { ...opts.wellFactors[fn] } : {};
    }

    const internalId = opts.id || nextRunInternalId();
    const runId = opts.runId || ensureUniqueRunLabel(inferred.runId, internalId);
    const date = opts.date || inferred.date || new Date().toISOString().slice(0, 10);

    return {
      id: internalId,
      runId,
      date,
      filename,
      summaryParsed: sp,
      zchangeParsed: opts.zchangeParsed || null,
      xyParsed: opts.xyParsed || null,
      context: opts.context || null,
      contextFilename: opts.contextFilename || "",
      groups,
      groupOrder: reg.groupOrder,
      groupColors: reg.groupColors,
      factorNames,
      wellFactors,
      factorLevelOrder: buildFactorLevelOrder(factorNames, wellFactors),
      excludedWells: new Set(opts.excludedWells || []),
      excludeMeta: opts.excludeMeta ? { ...opts.excludeMeta } : {}
    };
  }

  function syncQcPresetFromContext(ctx) {
    const core = getCore();
    if (!core || typeof core.normalizeQcThresholds !== "function") return;
    if (ctx && ctx.organismId && core.ORGANISM_QC_PRESETS && core.ORGANISM_QC_PRESETS[ctx.organismId]) {
      ui.qcThresholds = core.normalizeQcThresholds(ctx.organismId, ctx);
    } else if (!ui.qcThresholds) {
      ui.qcThresholds = core.normalizeQcThresholds("default", ctx);
    }
  }

  function resetMetricDefaultsForActiveRun() {
    const run = getActiveRun();
    const parsed = run ? run.summaryParsed : null;
    if (!parsed) return;
    ui.selectedWell = parsed.wells && parsed.wells.length ? parsed.wells[0] : null;
    ui.hiddenGroups.clear();

    if (parsed.hasDist || parsed.hasZoneDist) ui.tsMetric = "dist";
    else if (parsed.hasMsd) ui.tsMetric = "msd";
    else if (parsed.hasZones) ui.tsMetric = "z1_pct";
    else ui.tsMetric = "dist";

    ui.plateMetric = (parsed.hasDist || parsed.hasZoneDist) ? "totalDist" : (parsed.hasMsd ? "meanMsd" : "totalDist");
    ui.tsBinGroupSize = 1;
    ui.tsTraceView = "full";
    ui.tsPeriType = "ALL";
    const smoothSel = document.getElementById("tsSmoothSel");
    if (smoothSel) smoothSel.value = "1";
    ui.compView = "";
    ui.tableGroupFilter = "__ALL__";
    ui.tableStatusFilter = "all";
    ui.activeFactorLayer = PRIMARY_LAYER;
    ui.activeBrushGroup = run.groupOrder.length ? run.groupOrder[0] : UNASSIGNED;
    ui.brushTool = "group";
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
    ui.pendingContext = null;
    ui.pendingContextFilename = "";
    ui.pendingZchange = null;
    ui.pendingXy = null;
    ui.trimWindow = { trimStartSec: 0, trimEndSec: null };
    ui.windowAuc = { startSec: null, endSec: null };
    ui.normalizeToControl = false;
    ui.unitOfAnalysis = "wells";
    ui.xyFreezeSpeedMmS = 0.5;
    ui.hasViewedStats = false;
    ui.lastStatsSnapshot = null;
    ui.controlGroupName = demo.defaultControlGroup || "";

    if (demo.isMultiRun && Array.isArray(demo.runs) && demo.runs.length > 0) {
      ui.runs = [];
      for (const dr of demo.runs) {
        const sp = core.parseZantiksCsv(dr.summaryCsvText, dr.summaryFilename || `${dr.runId}.csv`);
        const zc = dr.zchangeCsvText ? core.parseZantiksCsv(dr.zchangeCsvText, dr.zchangeFilename || `${dr.runId}_ZCHANGE.csv`) : null;
        const xy = dr.xyCsvText ? core.parseZantiksCsv(dr.xyCsvText, dr.xyFilename || `${dr.runId}_XY.csv`) : null;
        const ctx = dr.experimentContext || (dr.experimentPayload ? core.parseExperimentContext(dr.experimentPayload) : null);
        ui.runs.push(createRunRecord({
          id: dr.id,
          runId: dr.runId,
          date: dr.date,
          filename: dr.summaryFilename || `${dr.runId}.csv`,
          summaryParsed: sp,
          zchangeParsed: zc,
          xyParsed: xy,
          context: ctx,
          contextFilename: ctx ? `${dr.runId} (Demo Context)` : "",
          groups: dr.defaultGroups,
          groupOrder: dr.groupOrder,
          groupPalette: dr.groupPalette,
          factorNames: dr.factorNames,
          wellFactors: dr.wellFactors,
          excludedWells: dr.defaultExcluded || []
        }));
      }
      ui.activeRunId = ui.runs[0].id;
      ui.scope = "pooled";
    } else {
      const sp = core.parseZantiksCsv(demo.summaryCsvText, demo.summaryFilename || `${presetId}.csv`);
      const zc = demo.zchangeCsvText ? core.parseZantiksCsv(demo.zchangeCsvText, demo.zchangeFilename || `${presetId}_ZCHANGE.csv`) : null;
      const xy = demo.xyCsvText ? core.parseZantiksCsv(demo.xyCsvText, demo.xyFilename || `${presetId}_XY.csv`) : null;
      const ctx = demo.experimentContext || (demo.experimentPayload ? core.parseExperimentContext(demo.experimentPayload) : null);
      const rec = createRunRecord({
        filename: demo.summaryFilename || `${presetId}.csv`,
        summaryParsed: sp,
        zchangeParsed: zc,
        xyParsed: xy,
        context: ctx,
        contextFilename: ctx ? `${demo.name || presetId} (Demo Context)` : "",
        groups: demo.defaultGroups,
        groupOrder: demo.groupOrder,
        groupPalette: demo.groupPalette,
        factorNames: demo.factorNames,
        wellFactors: demo.wellFactors,
        excludedWells: demo.defaultExcluded || []
      });
      ui.runs = [rec];
      ui.activeRunId = rec.id;
      ui.scope = "active";
    }

    syncLegacyStateAliases();
    ui.qcThresholds = core.normalizeQcThresholds(
      (ui.context && ui.context.organismId) ? ui.context.organismId : "default",
      ui.context
    );
    resetMetricDefaultsForActiveRun();

    const sel = document.getElementById("demoPresetSelect");
    if (sel) sel.value = presetId;
    resetWorkspaceControlsDom();

    recomputeAndRender({ onDatasetLoad: true });
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
    const run = getActiveRun();
    if (run) {
      run.context = ctx;
      run.contextFilename = "Latest Builder Config (localStorage)";
    } else {
      ui.pendingContext = ctx;
      ui.pendingContextFilename = "Latest Builder Config (localStorage)";
    }
    syncLegacyStateAliases();
    syncQcPresetFromContext(ctx);
    if (ui.runs.length) recomputeAndRender();
    else renderAll();
    toast(`Attached Builder config: ${ctx.plateName || ctx.plateId} · ${ctx.stimName || ctx.stimId}`);
  }

  function clearAllData(opts) {
    const core = getCore();
    ui.runs = [];
    ui.activeRunId = null;
    ui.scope = "active";
    ui.unitOfAnalysis = "wells";
    ui.normalizeToControl = false;
    ui.controlGroupName = "";
    ui.trimWindow = { trimStartSec: 0, trimEndSec: null };
    ui.windowAuc = { startSec: null, endSec: null };
    ui.xyFreezeSpeedMmS = 0.5;
    ui.primaryTestFamily = "parametric";
    ui.hasViewedStats = false;
    ui.lastStatsSnapshot = null;
    ui.qcThresholds = core ? core.normalizeQcThresholds("default", null) : null;
    ui.pendingContext = null;
    ui.pendingContextFilename = "";
    ui.pendingZchange = null;
    ui.pendingXy = null;
    ui.activeDemoId = "";
    ui.hiddenGroups = new Set();
    ui.selectedWell = null;
    ui.analysis = null;
    ui.activeChartTab = "timeseries";
    ui.compView = "";
    ui.brushTool = "group";
    ui.activeFactorLayer = PRIMARY_LAYER;
    ui.activeBrushGroup = UNASSIGNED;
    ui.activeBrushFactorVal = UNASSIGNED;
    ui.tsTraceView = "full";
    ui.tsBinGroupSize = 1;

    syncLegacyStateAliases();

    const sel = document.getElementById("demoPresetSelect");
    if (sel) sel.value = "";
    resetWorkspaceControlsDom();

    if (!(opts && opts.stayOnPage)) goToPage("data");
    renderAll();
    if (!(opts && opts.silent)) toast("Cleared analyzer workspace");
  }

  function matchCompanionToRun(filename, compKind) {
    if (!ui.runs.length) {
      return { run: null, matchKind: "no_runs", warning: "" };
    }
    const rawName = String(filename || "");
    const rawStem = rawName.replace(/\.[^.]+$/, "").toLowerCase();
    const normStem = rawStem.replace(/(?:_zchange|_xy|_summary)$/i, "");

    const runEntries = ui.runs.map(r => {
      const rStemRaw = String(r.filename || "").replace(/\.[^.]+$/, "").toLowerCase();
      const rStem = rStemRaw.replace(/(?:_summary)$/i, "");
      const rId = String(r.runId || "").trim().toLowerCase();
      return { run: r, rStemRaw, rStem, rId };
    });

    // 1. Exact stem match
    const exactStem = runEntries.filter(e =>
      normStem && (e.rStem === normStem || e.rStemRaw === normStem || e.rStem === rawStem || e.rStemRaw === rawStem)
    );
    if (exactStem.length === 1) {
      return { run: exactStem[0].run, matchKind: "exact", warning: "" };
    }
    if (exactStem.length > 1) {
      return {
        run: null,
        matchKind: "ambiguous",
        warning: `Ambiguous companion "${rawName}": matches multiple runs (${exactStem.map(e => e.run.runId).join(", ")}). Not attached.`
      };
    }

    // 2. Exact normalized runId match
    const exactId = runEntries.filter(e =>
      e.rId && (normStem === e.rId || rawStem === e.rId)
    );
    if (exactId.length === 1) {
      return { run: exactId[0].run, matchKind: "runId", warning: "" };
    }
    if (exactId.length > 1) {
      return {
        run: null,
        matchKind: "ambiguous",
        warning: `Ambiguous companion "${rawName}": matches multiple run IDs (${exactId.map(e => e.run.runId).join(", ")}). Not attached.`
      };
    }

    // 3. Longest delimiter-bounded prefix match (next char must be [-_.\s], never alphanumeric)
    const isDelimitedPrefix = (str, prefix) => {
      if (!str || !prefix || str.length <= prefix.length || !str.startsWith(prefix)) return false;
      const nextCh = str.charAt(prefix.length);
      return nextCh === "_" || nextCh === "-" || nextCh === "." || /\s/.test(nextCh);
    };

    const prefixMatches = [];
    for (const e of runEntries) {
      let bestLen = 0;
      const candidates = [e.rStem, e.rStemRaw, e.rId].filter(Boolean);
      for (const cand of candidates) {
        if (isDelimitedPrefix(normStem, cand)) bestLen = Math.max(bestLen, cand.length);
        if (isDelimitedPrefix(cand, normStem)) bestLen = Math.max(bestLen, normStem.length);
      }
      if (bestLen > 0) prefixMatches.push({ run: e.run, len: bestLen });
    }
    if (prefixMatches.length > 0) {
      prefixMatches.sort((a, b) => b.len - a.len);
      const topLen = prefixMatches[0].len;
      const topRuns = prefixMatches.filter(m => m.len === topLen);
      if (topRuns.length === 1) {
        return { run: topRuns[0].run, matchKind: "prefix", warning: "" };
      }
      return {
        run: null,
        matchKind: "ambiguous",
        warning: `Ambiguous companion "${rawName}": tied prefix match across ${topRuns.map(m => m.run.runId).join(", ")}. Not attached.`
      };
    }

    // 4. Fallback ONLY for single loaded run or generic experiment context JSON
    if (ui.runs.length === 1) {
      return { run: ui.runs[0], matchKind: "single_run", warning: "" };
    }
    const isGenericContext = (compKind === "context" || /\.json$/i.test(rawName)) &&
      /^(?:experiment|experiment_context)$/i.test(rawStem);
    if (isGenericContext) {
      return { run: getActiveRun(), matchKind: "generic", warning: "" };
    }

    // 5. Unmatched in multi-run mode: never silently overwrite any run
    return {
      run: null,
      matchKind: "unmatched",
      warning: `Unmatched companion "${rawName}": no loaded run matched (${ui.runs.map(r => r.runId).join(", ")}). Not attached.`
    };
  }

  async function handleIncomingFiles(fileList, opts) {
    const core = getCore();
    if (!core) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const appendMode = Boolean(opts && opts.appendMode);

    // Pre-read & classify files so Summary CSVs are ingested first before companion _ZCHANGE/_XY/.zip
    const summaries = [];
    const companions = [];
    const plateMaps = [];

    for (const file of files) {
      const name = file.name || "file";
      try {
        if (/\.zip$/i.test(name)) {
          const buf = await file.arrayBuffer();
          const ctx = await core.loadContextFromZip(buf);
          companions.push({ kind: "context", name, data: ctx });
        } else if (/\.json$/i.test(name)) {
          const text = await file.text();
          const obj = JSON.parse(text);
          if (obj && (obj.format === "zantiks-plate-map" || (obj.groups && !obj.experiment))) {
            plateMaps.push({ name, data: obj });
          } else {
            const ctx = core.parseExperimentContext(obj);
            if (ctx && ctx.valid) companions.push({ kind: "context", name, data: ctx });
            else toast(`Unrecognized JSON format in ${name}`);
          }
        } else {
          const text = await file.text();
          const parsed = core.parseZantiksCsv(text, name);
          if (parsed.kind === "summary") {
            summaries.push({ name, parsed, lastModified: file.lastModified });
          } else if (parsed.kind === "zchange") {
            companions.push({ kind: "zchange", name, data: parsed });
          } else if (parsed.kind === "xy") {
            companions.push({ kind: "xy", name, data: parsed });
          } else {
            toast(`Could not parse ${name}: missing Zantiks RUNTIME/TIME & metric columns.`);
          }
        }
      } catch (err) {
        toast(`Failed to load ${name}: ${(err && err.message) || "Invalid file"}`);
      }
    }

    let loadedAny = false;
    const msgs = [];

    if (summaries.length > 0) {
      const activeRun = getActiveRun();
      const firstNew = summaries[0];
      const sameWellSetAsActive = activeRun && activeRun.summaryParsed &&
        activeRun.summaryParsed.wells.length === firstNew.parsed.wells.length &&
        activeRun.summaryParsed.wells.every((w, i) => w === firstNew.parsed.wells[i]);
      const differentName = activeRun && activeRun.filename !== firstNew.name;

      // Replace existing runs when starting from empty, replacing a demo (unless appendMode),
      // or dropping a single CSV with a different plate layout on the main dropzone.
      const shouldReplace = !appendMode && (
        ui.runs.length === 0 ||
        Boolean(ui.activeDemoId) ||
        summaries.length >= 2 ||
        (!sameWellSetAsActive) ||
        (!differentName && ui.runs.length === 1)
      );

      const preservedGroups = (!shouldReplace && activeRun) ? activeRun.groups : (sameWellSetAsActive && !ui.activeDemoId && activeRun ? activeRun.groups : null);
      const preservedOrder = (!shouldReplace && activeRun) ? activeRun.groupOrder : (sameWellSetAsActive && !ui.activeDemoId && activeRun ? activeRun.groupOrder : null);
      const preservedColors = (!shouldReplace && activeRun) ? activeRun.groupColors : (sameWellSetAsActive && !ui.activeDemoId && activeRun ? activeRun.groupColors : null);
      const preservedFactors = (!shouldReplace && activeRun) ? activeRun.factorNames : null;
      const preservedWellFactors = (!shouldReplace && activeRun) ? activeRun.wellFactors : null;

      if (shouldReplace) {
        ui.runs = [];
        ui.activeDemoId = "";
        ui.trimWindow = { trimStartSec: 0, trimEndSec: null };
        ui.windowAuc = { startSec: null, endSec: null };
        ui.normalizeToControl = false;
        ui.controlGroupName = "";
        ui.unitOfAnalysis = "wells";
        ui.xyFreezeSpeedMmS = 0.5;
        ui.hasViewedStats = false;
        ui.lastStatsSnapshot = null;
        resetWorkspaceControlsDom();
        const demoSel = document.getElementById("demoPresetSelect");
        if (demoSel) demoSel.value = "";
      } else {
        ui.activeDemoId = "";
        const demoSel = document.getElementById("demoPresetSelect");
        if (demoSel) demoSel.value = "";
      }

      for (let i = 0; i < summaries.length; i++) {
        const s = summaries[i];
        const useCtx = (i === 0 && ui.pendingContext) ? ui.pendingContext : null;
        const useCtxName = (i === 0 && ui.pendingContext) ? ui.pendingContextFilename : "";
        const useZc = (i === 0 && ui.pendingZchange) ? ui.pendingZchange : null;
        const useXy = (i === 0 && ui.pendingXy) ? ui.pendingXy : null;

        const rec = createRunRecord({
          filename: s.name,
          summaryParsed: s.parsed,
          lastModifiedMs: s.lastModified,
          zchangeParsed: useZc,
          xyParsed: useXy,
          context: useCtx,
          contextFilename: useCtxName,
          groups: preservedGroups || {},
          groupOrder: preservedOrder || [],
          groupColors: preservedColors || {},
          factorNames: preservedFactors || [],
          wellFactors: preservedWellFactors || {}
        });
        ui.runs.push(rec);
        if (i === 0) {
          ui.pendingContext = null;
          ui.pendingContextFilename = "";
          ui.pendingZchange = null;
          ui.pendingXy = null;
        }
        msgs.push(`${rec.runId} (${s.parsed.wells.length}w)`);
      }

      ui.activeRunId = ui.runs[ui.runs.length - 1].id;
      if (ui.runs.length > 1) ui.scope = "pooled";
      else ui.scope = "active";

      syncLegacyStateAliases();
      syncQcPresetFromContext(ui.context);
      resetMetricDefaultsForActiveRun();
      loadedAny = true;
    }

    const warnings = [];
    for (const comp of companions) {
      const match = matchCompanionToRun(comp.name, comp.kind);
      const targetRun = match.run;
      if (!targetRun && match.matchKind !== "no_runs") {
        if (match.warning) warnings.push(match.warning);
        continue;
      }
      const destTag = targetRun ? ` → ${targetRun.runId}` : "";
      if (comp.kind === "context") {
        if (targetRun) {
          targetRun.context = comp.data;
          targetRun.contextFilename = comp.name;
        } else {
          ui.pendingContext = comp.data;
          ui.pendingContextFilename = comp.name;
        }
        syncQcPresetFromContext(comp.data);
        msgs.push(`Context (${comp.name}${destTag})`);
        loadedAny = true;
      } else if (comp.kind === "zchange") {
        if (targetRun) targetRun.zchangeParsed = comp.data;
        else ui.pendingZchange = comp.data;
        msgs.push(`_ZCHANGE (${comp.data.events ? comp.data.events.length : comp.data.rowCount} events${destTag})`);
        loadedAny = true;
      } else if (comp.kind === "xy") {
        if (targetRun) targetRun.xyParsed = comp.data;
        else ui.pendingXy = comp.data;
        msgs.push(`_XY (${comp.data.rowCount} frames${destTag})`);
        loadedAny = true;
      }
    }

    for (const pm of plateMaps) {
      applyPlateMapObject(pm.data);
      msgs.push(`Plate Map (${pm.name})`);
      loadedAny = true;
    }

    if (loadedAny) {
      syncLegacyStateAliases();
      if (ui.runs.length > 0) recomputeAndRender({ onDatasetLoad: summaries.length > 0 });
      else renderAll();
    }
    if (msgs.length && warnings.length) {
      toast(`Loaded: ${msgs.join(" · ")} · Warning: ${warnings.join(" · ")}`);
    } else if (warnings.length) {
      toast(`Warning: ${warnings.join(" · ")}`);
    } else if (msgs.length) {
      toast(`Loaded: ${msgs.join(" · ")}`);
    }
  }

  function applyPlateMapObject(obj) {
    if (!obj || typeof obj !== "object") return;
    const run = getActiveRun();
    if (!run) return;
    const validWells = (run.summaryParsed && Array.isArray(run.summaryParsed.wells))
      ? new Set(run.summaryParsed.wells)
      : null;
    const keepWell = (w) => !validWells || validWells.has(w);

    const rawGroups = obj.groups && typeof obj.groups === "object" ? obj.groups : {};
    const nextGroups = {};
    for (const [w, g] of Object.entries(rawGroups)) {
      if (!keepWell(w)) continue;
      const clean = String(g || "").trim();
      if (clean && clean !== UNASSIGNED && clean !== ALL_WELLS) nextGroups[w] = clean;
    }
    run.groups = nextGroups;
    const reg = buildGroupRegistryForRun(nextGroups, obj.groupOrder, obj.groupColors || obj.groupPalette);
    run.groupOrder = reg.groupOrder;
    run.groupColors = reg.groupColors;

    if (Array.isArray(obj.factorNames) && obj.wellFactors && typeof obj.wellFactors === "object") {
      run.factorNames = obj.factorNames.map(s => String(s).trim()).filter(Boolean);
      run.wellFactors = {};
      for (const fn of run.factorNames) {
        const srcMap = (obj.wellFactors[fn] && typeof obj.wellFactors[fn] === "object") ? obj.wellFactors[fn] : {};
        const filtered = {};
        for (const [w, v] of Object.entries(srcMap)) {
          if (keepWell(w)) filtered[w] = v;
        }
        run.wellFactors[fn] = filtered;
      }
      run.factorLevelOrder = buildFactorLevelOrder(run.factorNames, run.wellFactors);
    }

    if (Array.isArray(obj.excludedWells)) {
      run.excludedWells = new Set(obj.excludedWells.map(String).filter(keepWell));
    }
    if (obj.excludeMeta && typeof obj.excludeMeta === "object") {
      const filteredMeta = {};
      for (const [w, m] of Object.entries(obj.excludeMeta)) {
        if (keepWell(w)) filteredMeta[w] = m;
      }
      run.excludeMeta = filteredMeta;
    }
    ui.activeFactorLayer = PRIMARY_LAYER;
    ui.activeBrushGroup = run.groupOrder.length ? run.groupOrder[0] : UNASSIGNED;
    syncLegacyStateAliases();
  }

  function savePlateMapJson() {
    const run = getActiveRun();
    if (!run) return;
    const payload = {
      format: "zantiks-plate-map",
      version: 2,
      savedAt: new Date().toISOString(),
      plateId: (ui.analysis && ui.analysis.layout && ui.analysis.layout.id) || "custom",
      groupOrder: [...run.groupOrder],
      groupColors: { ...run.groupColors },
      groups: { ...run.groups },
      factorNames: [...run.factorNames],
      wellFactors: JSON.parse(JSON.stringify(run.wellFactors || {})),
      excludedWells: [...run.excludedWells],
      excludeMeta: { ...run.excludeMeta }
    };
    downloadTextFile(
      JSON.stringify(payload, null, 2) + "\n",
      `${getExportBasename()}_plate_map.json`,
      "application/json;charset=utf-8"
    );
    toast("Saved plate map (.json) with factors");
  }

  // ---------------------------------------------------------------------------
  // 5. Core Analysis Recompute & Master Render
  // ---------------------------------------------------------------------------
  function getRawWindowAucOption() {
    const s = ui.windowAuc && ui.windowAuc.startSec;
    const e = ui.windowAuc && ui.windowAuc.endSec;
    if (Number.isFinite(s) && Number.isFinite(e)) {
      return { startSec: s, endSec: e };
    }
    return null;
  }

  function getActiveWindowAucConfig() {
    const s = ui.windowAuc && ui.windowAuc.startSec;
    const e = ui.windowAuc && ui.windowAuc.endSec;
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
      return { startSec: s, endSec: e };
    }
    return null;
  }

  function collectUnionGroupOrder() {
    const out = [];
    const set = new Set();
    for (const r of ui.runs) {
      for (const g of (r.groupOrder || [])) {
        if (g && !set.has(g)) { set.add(g); out.push(g); }
      }
    }
    return out;
  }

  function computeCurrentStatsSnapshot() {
    if (ui.lastStatsSnapshot && ui.lastStatsSnapshot.result) return ui.lastStatsSnapshot;
    const core = getCore();
    const a = ui.analysis;
    if (!core || !core.stats || !a) return null;
    const viewId = ui.compView || (a.comparisonViews && a.comparisonViews[0] && a.comparisonViews[0].id) || "phase_totals";
    const ds = buildComparisonDataset(viewId);
    if (!ds || !ds.categories.length || ds.groups.length < 2) return null;
    const cat = ds.categories[0];
    const gData = cat.bars.map(b => ({ group: b.group, values: b.points.map(p => p.value) }));
    const res = core.stats.screenComparisonGroups(gData, {
      primaryTestFamily: ui.primaryTestFamily,
      nUnit: a.nUnit || "wells",
      runCount: a.runCount || 1,
      factorNames: a.factorNames || [],
      flaggedInPlateMeans: (a.pooledMeta && a.pooledMeta.flaggedInPlateMeans) || null
    });
    const vEntry = (a.comparisonViews || []).find(v => v.id === viewId);
    const metricLabel = vEntry ? `${vEntry.label}${ds.categories.length > 1 ? ` — ${cat.label}` : ""}` : cat.label;
    return { metricLabel, result: res };
  }

  function buildExportPayload() {
    return {
      exportBasename: getExportBasename(),
      analysis: ui.analysis,
      scope: ui.runs.length > 1 ? ui.scope : "active",
      unitOfAnalysis: ui.runs.length > 1 && ui.scope === "pooled" ? ui.unitOfAnalysis : "wells",
      primaryTestFamily: ui.primaryTestFamily,
      statsSnapshot: computeCurrentStatsSnapshot(),
      activeRunId: ui.activeRunId,
      runs: ui.runs,
      parsed: ui.summaryParsed,
      summaryParsed: ui.summaryParsed,
      zchangeParsed: ui.zchangeParsed,
      xyParsed: ui.xyParsed,
      context: ui.context,
      groups: ui.groups,
      factorNames: ui.factorNames,
      wellFactors: ui.wellFactors,
      excludedWells: [...ui.excludedWells],
      excludeMeta: ui.excludeMeta,
      qcThresholds: ui.qcThresholds,
      trimWindow: ui.trimWindow,
      windowAuc: getActiveWindowAucConfig()
    };
  }

  function recomputeAndRender(opts) {
    const core = getCore();
    syncLegacyStateAliases();

    if (!core || ui.runs.length === 0) {
      ui.analysis = null;
      ui.lastStatsSnapshot = null;
      renderAll();
      return;
    }

    const effectiveScope = ui.runs.length > 1 ? ui.scope : "active";
    const effectiveUnit = (ui.runs.length > 1 && effectiveScope === "pooled") ? ui.unitOfAnalysis : "wells";
    if (!ui.qcThresholds) {
      ui.qcThresholds = core.normalizeQcThresholds("default", ui.context);
    }

    ui.analysis = core.analyzePooledRuns(ui.runs, {
      scope: effectiveScope,
      unitOfAnalysis: effectiveUnit,
      activeRunId: ui.activeRunId,
      normalizeToControl: ui.normalizeToControl,
      controlGroupName: ui.controlGroupName || undefined,
      qcThresholds: ui.qcThresholds,
      trimWindow: ui.trimWindow,
      windowAuc: getRawWindowAucOption(),
      tsMetric: ui.tsMetric,
      tsBinGroupSize: ui.tsBinGroupSize,
      xyFreezeSpeedMmS: ui.xyFreezeSpeedMmS,
      groupOrder: collectUnionGroupOrder()
    });
    ui.lastStatsSnapshot = null;

    if (ui.analysis && ui.analysis.activeMetric) {
      ui.tsMetric = ui.analysis.activeMetric;
    }
    if (ui.analysis && ui.analysis.pooledMeta && ui.analysis.pooledMeta.controlGroupName && !ui.controlGroupName) {
      ui.controlGroupName = ui.analysis.pooledMeta.controlGroupName;
    }

    if (opts && opts.onDatasetLoad && ui.analysis && ui.analysis.capabilities) {
      if (ui.activeChartTab === "spatial" && !ui.analysis.capabilities.hasXy) ui.activeChartTab = "timeseries";
      if (ui.activeChartTab === "zchange" && !ui.analysis.capabilities.hasZchange) ui.activeChartTab = "timeseries";
      const fDetails = document.getElementById("factorLayersDetails");
      const activeRun = getActiveRun();
      if (fDetails) fDetails.open = Boolean(activeRun && activeRun.factorNames && activeRun.factorNames.length > 0);
    }

    // Validate trace view (if no periStimulus, fall back to full)
    if (ui.tsTraceView !== "full") {
      const ps = ui.analysis && ui.analysis.periStimulus;
      if (!ps) ui.tsTraceView = "full";
      else if (ui.tsTraceView === "habituation" && !ps.hasHabituation) ui.tsTraceView = "peri";
    }

    // Validate comparison view
    const views = (ui.analysis && ui.analysis.comparisonViews) || [];
    if (!views.some(v => v.id === ui.compView)) {
      if (ui.activeDemoId === "ppi_24w" && views.some(v => v.id === "ppi")) {
        ui.compView = "ppi";
      } else if (ui.activeDemoId === "ymaze_15" && views.some(v => v.id === "sab")) {
        ui.compView = "sab";
      } else if (ui.normalizeToControl && views.some(v => v.id === "normalized_ctrl")) {
        ui.compView = "normalized_ctrl";
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
    const hasSummary = Boolean(ui.runs.length > 0 && ui.analysis);

    document.querySelectorAll("[data-requires-csv-empty]").forEach(el => {
      el.style.display = hasSummary ? "none" : "";
    });
    document.querySelectorAll("[data-requires-csv-body]").forEach(el => {
      el.style.display = hasSummary ? "" : "none";
    });

    const modeBadge = document.getElementById("analyzerModeBadge");
    if (modeBadge) {
      if (hasSummary && ui.runs.length > 1) {
        const pm = ui.analysis.pooledMeta || {};
        modeBadge.textContent = pm.hasMixedLayouts && pm.layoutSummary
          ? pm.layoutSummary
          : `${ui.runs.length} Runs · ${ui.analysis.layout.name || "Pool"}`;
      } else if (hasSummary && ui.analysis.layout) {
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

    renderRunSwitchers();
    renderKpiStrip();
    renderQcThresholdsCard();
    renderPlateControls();
    renderAllPlateMaps();
    renderWellInspector();
    renderTempAndQcDiagnostics();
    renderPlotScopeBar();
    renderChartToolbars();
    renderAllPlotTabs();
    renderExportAuditSummary();
    renderWellTable();
  }

  // ---------------------------------------------------------------------------
  // 6. Step 1: Data, Multi-Run List & Right Sidebar Dataset Summary
  // ---------------------------------------------------------------------------
  function renderStep1Data() {
    document.querySelectorAll("#step1DemoCards [data-demo]").forEach(btn => {
      btn.classList.toggle("active", Boolean(ui.activeDemoId) && btn.getAttribute("data-demo") === ui.activeDemoId);
    });

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
          : (ui.runs.length ? "Auto-detected from CSV" : "No Builder context attached");
        badge.title = "";
        if (clearCtxBtn) clearCtxBtn.style.display = "none";
      }
    }

    // Loaded file chips (for active run / quick visibility)
    const chipsWrap = document.getElementById("loadedFileChips");
    if (chipsWrap) {
      const chips = [];
      for (const r of ui.runs) {
        const p = r.summaryParsed;
        if (p) {
          chips.push(
            `<span class="az-file-chip">` +
              `<span class="az-file-chip-kind">${ui.runs.length > 1 ? esc(r.runId) : "CSV"}</span>` +
              `<span class="az-file-chip-name" title="${esc(r.filename)}">${esc(r.filename)}</span>` +
              `<span class="az-file-chip-meta">${p.wells.length}w · ${p.rowCount} rows</span>` +
              `<button type="button" class="az-file-chip-rm" data-rm-file="summary" data-rm-run="${esc(r.id)}" aria-label="Remove ${esc(r.runId)}">&times;</button>` +
            `</span>`
          );
        }
        if (r.zchangeParsed) {
          const z = r.zchangeParsed;
          chips.push(
            `<span class="az-file-chip">` +
              `<span class="az-file-chip-kind is-zchange">ZCHANGE</span>` +
              `<span class="az-file-chip-name" title="${esc(z.filename)}">${esc(z.filename)}</span>` +
              `<span class="az-file-chip-meta">${z.events ? z.events.length : z.rowCount} events</span>` +
              `<button type="button" class="az-file-chip-rm" data-rm-file="zchange" data-rm-comp="zchange" data-comp-run="${esc(r.id)}" aria-label="Remove ZCHANGE CSV">&times;</button>` +
            `</span>`
          );
        }
        if (r.xyParsed) {
          const xy = r.xyParsed;
          chips.push(
            `<span class="az-file-chip">` +
              `<span class="az-file-chip-kind is-xy">XY</span>` +
              `<span class="az-file-chip-name" title="${esc(xy.filename)}">${esc(xy.filename)}</span>` +
              `<span class="az-file-chip-meta">${xy.rowCount} frames</span>` +
              `<button type="button" class="az-file-chip-rm" data-rm-file="xy" data-rm-comp="xy" data-comp-run="${esc(r.id)}" aria-label="Remove XY CSV">&times;</button>` +
            `</span>`
          );
        }
      }
      if (!ui.runs.length && ui.pendingZchange) {
        chips.push(`<span class="az-file-chip"><span class="az-file-chip-kind is-zchange">ZCHANGE</span><span class="az-file-chip-name">${esc(ui.pendingZchange.filename)}</span></span>`);
      }
      if (!ui.runs.length && ui.pendingXy) {
        chips.push(`<span class="az-file-chip"><span class="az-file-chip-kind is-xy">XY</span><span class="az-file-chip-name">${esc(ui.pendingXy.filename)}</span></span>`);
      }

      if (chips.length) {
        chipsWrap.innerHTML = chips.join("");
        chipsWrap.querySelectorAll("[data-rm-run]").forEach(btn => {
          btn.addEventListener("click", () => removeRun(btn.getAttribute("data-rm-run")));
        });
        chipsWrap.querySelectorAll("[data-rm-comp]").forEach(btn => {
          btn.addEventListener("click", () => {
            const kind = btn.getAttribute("data-rm-comp");
            const r = getRunByIdOrLabel(btn.getAttribute("data-comp-run"));
            if (r) {
              if (kind === "zchange") r.zchangeParsed = null;
              if (kind === "xy") r.xyParsed = null;
              recomputeAndRender();
            }
          });
        });
      } else {
        chipsWrap.innerHTML = `<span class="az-empty-chip-hint">No CSV files loaded yet. Drop files above or pick one of the demo datasets below.</span>`;
      }
    }

    // Editable Loaded Runs list (shown cleanly whenever >= 1 run is loaded)
    const runsWrap = document.getElementById("loadedRunsList");
    if (runsWrap) {
      if (ui.runs.length > 0) {
        runsWrap.style.display = "";
        runsWrap.innerHTML = ui.runs.map((r, idx) => {
          const isAct = r.id === ui.activeRunId;
          const sp = r.summaryParsed;
          const tags = [];
          if (r.zchangeParsed) tags.push(`<span class="az-file-chip-kind is-zchange">ZCHANGE</span>`);
          if (r.xyParsed) tags.push(`<span class="az-file-chip-kind is-xy">XY</span>`);
          return (
            `<div class="az-run-item${isAct ? " is-active" : ""}" data-run-row="${esc(r.id)}">` +
              `<div class="az-run-item-left">` +
                `<button type="button" class="az-run-select-btn" data-select-run="${esc(r.id)}">${isAct ? "Active" : `Run ${idx + 1}`}</button>` +
                `<div class="az-run-field"><label for="runId_${idx}">Run ID</label><input type="text" id="runId_${idx}" data-run-id-edit="${esc(r.id)}" value="${esc(r.runId)}" maxlength="32" autocomplete="off"></div>` +
                `<div class="az-run-field"><label for="runDate_${idx}">Date</label><input type="date" id="runDate_${idx}" data-run-date-edit="${esc(r.id)}" value="${esc(r.date)}"></div>` +
              `</div>` +
              `<div class="az-run-item-right">` +
                tags.join("") +
                `<span>${sp ? `${sp.wells.length}w · ${sp.rowCount} rows` : ""}</span>` +
                `<button type="button" class="az-file-chip-rm" data-rm-run="${esc(r.id)}" title="Remove run">&times;</button>` +
              `</div>` +
            `</div>`
          );
        }).join("");

        runsWrap.querySelectorAll("[data-select-run]").forEach(btn => {
          btn.addEventListener("click", () => switchActiveRun(btn.getAttribute("data-select-run")));
        });
        runsWrap.querySelectorAll("[data-run-id-edit]").forEach(inp => {
          inp.addEventListener("change", () => {
            const r = getRunByIdOrLabel(inp.getAttribute("data-run-id-edit"));
            if (!r) return;
            const next = String(inp.value || "").trim().slice(0, 32);
            if (next) { r.runId = ensureUniqueRunLabel(next, r.id); recomputeAndRender(); }
          });
        });
        runsWrap.querySelectorAll("[data-run-date-edit]").forEach(inp => {
          inp.addEventListener("change", () => {
            const r = getRunByIdOrLabel(inp.getAttribute("data-run-date-edit"));
            if (!r) return;
            r.date = inp.value || r.date;
            recomputeAndRender();
          });
        });
        runsWrap.querySelectorAll("[data-rm-run]").forEach(btn => {
          btn.addEventListener("click", () => removeRun(btn.getAttribute("data-rm-run")));
        });
      } else {
        runsWrap.style.display = "none";
        runsWrap.innerHTML = "";
      }
    }

    // Overview grid
    const ovGrid = document.getElementById("loadedOverviewGrid");
    if (ui.runs.length > 0 && ui.analysis) {
      const a = ui.analysis;
      const k = a.kpis;
      const caps = a.capabilities || {};
      const metricTags = [];
      if (caps.hasDist) metricTags.push("DIST");
      if (caps.hasMsd) metricTags.push("MSD");
      if (caps.hasZones) metricTags.push(`Z1–Z${caps.maxZone || 2}`);
      if (caps.hasZchange) metricTags.push("ZCHANGE");
      if (caps.hasXy) metricTags.push("XY");

      const first = a.layout.wells[0] || "";
      const last = a.layout.wells[a.layout.wells.length - 1] || "";
      const range = a.layout.wells.length > 1 ? `${first}–${last}` : first;
      const pm = a.pooledMeta || {};
      const mixedLayouts = Boolean(ui.runs.length > 1 && pm.hasMixedLayouts);
      const layoutLabel = mixedLayouts
        ? (pm.layoutSummary || `${ui.runs.length} runs (mixed layouts)`)
        : (ui.runs.length > 1 ? `${ui.runs.length} × ${a.layout.name || "Plate"}` : (a.layout.name || "Plate"));
      const runLbl = ui.runs.length > 1 ? `${ui.runs.length} runs pooled · ` : "";

      setText("loadedOverviewHint", `${runLbl}${mixedLayouts ? (pm.layoutSummary || "Mixed layouts") : (a.layout.name || "Plate")} · ${k.rowCount} rows · ${fmtDurationNice(k.durationSec)}`);
      if (ovGrid) {
        ovGrid.style.display = "";
        const phaseTxt = a.phases && a.phases.length ? a.phases.slice(0, 3).join(", ") + (a.phases.length > 3 ? "…" : "") : "Single phase";
        const tempTxt = caps.hasTemp && Number.isFinite(k.tempMean) ? `Temp ${k.tempMean.toFixed(1)} °C` : "No TEMP_C";
        const readyTags = [];
        if (caps.hasVmr) readyTags.push("VMR");
        if (caps.hasPpi) readyTags.push("% PPI");
        if (caps.hasHabituation) readyTags.push("Habit");
        if (caps.hasSab) readyTags.push("SAB %");
        if (caps.hasXy) readyTags.push("Spatial");
        const wellSub = mixedLayouts
          ? `${k.totalWells} total wells across mixed plates`
          : `${k.totalWells} total wells (${range})`;
        ovGrid.innerHTML =
          `<div class="az-ov-cell"><div class="az-ov-label">${ui.runs.length > 1 ? "Pooled Plates" : "Plate / Maze"}</div><div class="az-ov-val">${esc(layoutLabel)}</div><div class="az-ov-sub">${esc(wellSub)}</div></div>` +
          `<div class="az-ov-cell"><div class="az-ov-label">Rows &amp; Duration</div><div class="az-ov-val">${k.rowCount} rows · ${esc(fmtDurationNice(k.durationSec))}</div><div class="az-ov-sub">${fmtNum(k.binDurationSec, k.binDurationSec >= 10 ? 0 : 1)}s bins</div></div>` +
          `<div class="az-ov-cell"><div class="az-ov-label">Detected Metrics</div><div class="az-ov-val">${esc(metricTags.join(", ") || "Summary")}</div><div class="az-ov-sub">${readyTags.length ? readyTags.join(" · ") + " ready" : "Standard tracking"}</div></div>` +
          `<div class="az-ov-cell"><div class="az-ov-label">Phases &amp; Temp</div><div class="az-ov-val">${esc(phaseTxt)}</div><div class="az-ov-sub">${esc(tempTxt)}</div></div>`;
      }
    } else {
      setText("loadedOverviewHint", ui.context && ui.context.valid ? "Context loaded · waiting for CSV" : "Waiting for CSV");
      if (ovGrid) ovGrid.style.display = "none";
    }
  }

  function switchActiveRun(runInternalId) {
    const hit = ui.runs.find(r => r.id === runInternalId || r.runId === runInternalId);
    if (!hit) return;
    ui.activeRunId = hit.id;
    syncLegacyStateAliases();
    if (ui.activeFactorLayer !== PRIMARY_LAYER && !hit.factorNames.includes(ui.activeFactorLayer)) {
      ui.activeFactorLayer = PRIMARY_LAYER;
    }
    ui.activeBrushGroup = hit.groupOrder.length ? hit.groupOrder[0] : UNASSIGNED;
    recomputeAndRender();
  }

  function removeRun(runInternalId) {
    ui.runs = ui.runs.filter(r => r.id !== runInternalId);
    if (ui.runs.length === 0) {
      clearAllData({ stayOnPage: true, silent: true });
      return;
    }
    if (!ui.runs.some(r => r.id === ui.activeRunId)) ui.activeRunId = ui.runs[0].id;
    if (ui.runs.length <= 1) {
      ui.scope = "active";
      ui.unitOfAnalysis = "wells";
      ui.normalizeToControl = false;
      if (ui.compView === "normalized_ctrl") ui.compView = "";
      const normChk = document.getElementById("normControlChk");
      if (normChk) normChk.checked = false;
    }
    syncLegacyStateAliases();
    recomputeAndRender({ onDatasetLoad: true });
  }

  function renderDatasetSummarySidebar() {
    const a = ui.analysis;
    const p = ui.summaryParsed;

    if (ui.context && ui.context.valid) {
      setText("summaryStatusLine", "Context attached · 100% offline");
    } else if (a) {
      setText("summaryStatusLine", ui.runs.length > 1 ? `${ui.runs.length} runs pooled · offline` : "Live analysis · 100% offline");
    } else {
      setText("summaryStatusLine", "100% offline in this browser");
    }

    if (!a || !p) {
      setText("statActiveWells", "—");
      setText("statDuration", "—");
      setText("statGroups", "—");
      setText("statFlagged", "—");
      setTextWithTitle("sumDataTitle", "No CSV loaded");
      setTextWithTitle("sumDataSub", ui.context && ui.context.valid
        ? `Context: ${ui.context.plateName || ui.context.plateId}`
        : "Drop CSV or pick a demo");
      setTextWithTitle("sumQcTitle", "—");
      setTextWithTitle("sumQcSub", "");
      const qcRow = document.getElementById("sumQcRow");
      if (qcRow) qcRow.classList.remove("has-warn");
      setTextWithTitle("sumGroupsTitle", "—");
      setTextWithTitle("sumGroupsSub", "");
      setTextWithTitle("sumPlotsTitle", "Time Series");
      setTextWithTitle("sumPlotsSub", "Load CSV to plot");
      setTextWithTitle("sumExportTitle", "Prism · CSV · Log · Py");
      setTextWithTitle("sumExportSub", "");
      return;
    }

    const k = a.kpis;
    const grpCount = a.groups ? a.groups.length : 0;
    const unexcludedFlagged = (a.wells || []).filter(w => !w.excluded && w.qc && (w.qc.isEmpty || w.qc.isSpikeGlitch)).length;

    setText("statActiveWells", `${k.activeWells} / ${k.totalWells}`);
    setText("statDuration", fmtDurationNice(k.durationSec));
    setText("statGroups", `${grpCount} group${grpCount === 1 ? "" : "s"}`);
    setText("statFlagged", k.flaggedCount > 0 ? `${k.flaggedCount} flagged` : "0 clean");

    // Row 1: Data
    if (ui.runs.length > 1) {
      setTextWithTitle("sumDataTitle", `${ui.runs.length} runs (${ui.scope === "pooled" ? "Pooled" : "Active"})`);
      setTextWithTitle("sumDataSub", ui.runs.map(r => r.runId).slice(0, 3).join(", ") + (a.capabilities.hasXy ? " + _XY" : ""));
    } else {
      setTextWithTitle("sumDataTitle", p.filename || "Summary CSV");
      const extras = [ui.zchangeParsed ? "_ZCHANGE" : "", ui.xyParsed ? "_XY" : ""].filter(Boolean).join(" + ");
      setTextWithTitle("sumDataSub", `${a.layout.name || "Plate"} · ${k.rowCount} rows${extras ? " + " + extras : ""}`);
    }

    // Row 2: QC
    const qcRow = document.getElementById("sumQcRow");
    if (qcRow) qcRow.classList.toggle("has-warn", unexcludedFlagged > 0);
    if (unexcludedFlagged > 0) setTextWithTitle("sumQcTitle", `${unexcludedFlagged} flagged to review`);
    else if (k.excludedWells > 0) setTextWithTitle("sumQcTitle", `${k.excludedWells} excluded · clean`);
    else setTextWithTitle("sumQcTitle", "All wells clean");

    const qcParts = [];
    if (k.emptyCount > 0) qcParts.push(`${k.emptyCount} empty`);
    if (k.spikeCount > 0) qcParts.push(`${k.spikeCount} spike`);
    if (a.capabilities.hasTemp && Number.isFinite(k.tempMean)) qcParts.push(`${k.tempMean.toFixed(1)} °C`);
    setTextWithTitle("sumQcSub", qcParts.join(" · ") || "No anomalies");

    // Row 3: Groups
    const grpNames = (a.groups || []).map(g => g.group);
    const fNames = a.factorNames || [];
    setTextWithTitle("sumGroupsTitle", grpNames.length === 1 && grpNames[0] === ALL_WELLS
      ? "All Wells (1 group)"
      : `${grpNames.length} group${grpNames.length === 1 ? "" : "s"}${fNames.length ? ` · ${fNames.length}F` : ""}`);
    setTextWithTitle("sumGroupsSub", fNames.length ? fNames.join(" × ") : (grpNames.slice(0, 3).join(", ") + (grpNames.length > 3 ? "…" : "")));

    // Row 4: Plots
    const tabLabels = { timeseries: "Time Series", comparison: "Phase & Group", zchange: "Zone Events", spatial: "Spatial (_XY)" };
    setTextWithTitle("sumPlotsTitle", tabLabels[ui.activeChartTab] || "Time Series");
    const tsLbl = (a.timeSeries && a.timeSeries.metricLabel) ? a.timeSeries.metricLabel.split(" ")[0] : "Distance";
    setTextWithTitle("sumPlotsSub", `${tsLbl} · ${ui.tsBinGroupSize}x bin${ui.normalizeToControl ? " · % Ctrl" : ""}`);

    // Row 5: Export
    setTextWithTitle("sumExportTitle", "Ready to export");
    setTextWithTitle("sumExportSub", `${k.activeWells} active wells · UTF-8 BOM`);
  }

  // ---------------------------------------------------------------------------
  // 7. Step 2: Run Switchers, QC KPI Strip & Organism Thresholds
  // ---------------------------------------------------------------------------
  function renderRunSwitchers() {
    const multi = ui.runs.length > 1;
    const qcBar = document.getElementById("qcRunSwitcher");
    const grpBar = document.getElementById("groupsRunSwitcher");

    const buildRunPillsHtml = (prefix) => {
      return (
        `<div class="az-run-pills">` +
          `<span class="az-run-pill-lbl">Inspecting plate:</span>` +
          ui.runs.map(r => {
            const act = r.id === ui.activeRunId;
            return (
              `<button type="button" class="az-run-pill${act ? " active" : ""}" data-${prefix}-run="${esc(r.id)}">` +
                `<span>${esc(r.runId)}</span>` +
                `<span class="az-run-pill-meta">${esc(r.date || "")}</span>` +
              `</button>`
            );
          }).join("") +
        `</div>`
      );
    };

    if (qcBar) {
      qcBar.style.display = multi ? "" : "none";
      if (multi) {
        qcBar.innerHTML =
          buildRunPillsHtml("qc-sw") +
          `<button type="button" class="btn btn-xs btn-warn" id="excludeFlaggedAllRunsBtn">Exclude Flagged (All ${ui.runs.length} Runs)</button>`;
        qcBar.querySelectorAll("[data-qc-sw-run]").forEach(btn => {
          btn.addEventListener("click", () => switchActiveRun(btn.getAttribute("data-qc-sw-run")));
        });
        const allBtn = document.getElementById("excludeFlaggedAllRunsBtn");
        if (allBtn) allBtn.addEventListener("click", excludeFlaggedAcrossAllRuns);
      }
    }

    if (grpBar) {
      grpBar.style.display = multi ? "" : "none";
      if (multi) {
        grpBar.innerHTML =
          buildRunPillsHtml("grp-sw") +
          `<button type="button" class="btn btn-xs btn-primary" id="copyMapAllRunsBtn">Copy Map to All Runs</button>`;
        grpBar.querySelectorAll("[data-grp-sw-run]").forEach(btn => {
          btn.addEventListener("click", () => switchActiveRun(btn.getAttribute("data-grp-sw-run")));
        });
        const copyBtn = document.getElementById("copyMapAllRunsBtn");
        if (copyBtn) copyBtn.addEventListener("click", copyActiveMapToAllRuns);
      }
    }
  }

  function renderKpiStrip() {
    const a = getActiveRunAnalysis();
    const run = getActiveRun();
    if (!a || !run) return;
    const k = a.kpis;
    const emptyWells = (a.wells || []).filter(w => w.qc && w.qc.isEmpty).map(w => w.well);
    const spikeWells = (a.wells || []).filter(w => w.qc && w.qc.isSpikeGlitch).map(w => w.well);
    const flaggedWells = (a.wells || []).filter(w => w.qc && (w.qc.isEmpty || w.qc.isSpikeGlitch)).map(w => w.well);

    setText("kpiActiveWells", `${k.activeWells} / ${k.totalWells}`);
    const grpCount = a.groups ? a.groups.length : 0;
    setText("kpiActiveWellsSub", `${k.excludedWells} excluded · ${grpCount} group${grpCount === 1 ? "" : "s"}`);

    const unexcludedEmpty = emptyWells.filter(w => !run.excludedWells.has(w));
    const unexcludedSpike = spikeWells.filter(w => !run.excludedWells.has(w));
    const unexcludedFlagged = flaggedWells.filter(w => !run.excludedWells.has(w));

    setText("kpiEmptyCount", String(emptyWells.length));
    setText("kpiEmptyList", emptyWells.length
      ? `${emptyWells.slice(0, 6).join(", ")}${emptyWells.length > 6 ? "…" : ""}${unexcludedEmpty.length === 0 ? " (all excluded)" : ""}`
      : "All wells active");
    const emptyCard = document.getElementById("kpiEmptyCard");
    if (emptyCard) emptyCard.classList.toggle("is-warn", unexcludedEmpty.length > 0);

    setText("kpiSpikeCount", String(spikeWells.length));
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
    if (qcExclBtn) qcExclBtn.disabled = unexcludedFlagged.length === 0;

    const restBtn = document.getElementById("restoreAllWellsBtn");
    if (restBtn) restBtn.disabled = k.excludedWells === 0;

    const actionNote = document.getElementById("qcActionBarNote");
    if (actionNote) {
      const rPrefix = ui.runs.length > 1 ? `${run.runId}: ` : "";
      actionNote.textContent = unexcludedFlagged.length > 0
        ? `${rPrefix}${unexcludedFlagged.length} flagged well${unexcludedFlagged.length === 1 ? "" : "s"} awaiting review · ${k.excludedWells} excluded`
        : `${rPrefix}No unexcluded QC flags · ${k.excludedWells} excluded`;
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

  function renderQcThresholdsCard() {
    const core = getCore();
    const a = getActiveRunAnalysis();
    if (!core || !a) return;
    const th = a.qcThresholds || ui.qcThresholds || core.normalizeQcThresholds("default", ui.context);

    const presetSel = document.getElementById("qcOrganismPresetSel");
    if (presetSel) {
      if (presetSel.options.length === 0 && Array.isArray(core.ORGANISM_QC_PRESET_LIST)) {
        presetSel.innerHTML = core.ORGANISM_QC_PRESET_LIST.map(p =>
          `<option value="${esc(p.id)}">${esc(p.label)}</option>`
        ).join("") + `<option value="custom">Custom</option>`;
      }
      presetSel.value = th.presetId || th.id || "default";
    }

    const syncNum = (id, val) => {
      const el = document.getElementById(id);
      if (el && document.activeElement !== el) el.value = val === null || val === undefined ? "" : String(val);
    };
    syncNum("qcEmptyDistInput", th.emptyDistMm);
    syncNum("qcMaxSpeedInput", th.spikeMaxSpeedMmS);
    syncNum("qcSpikeMinInput", th.spikeMinMm);
    syncNum("qcMadMultInput", th.spikeMadMult);
    syncNum("qcTrimStartInput", ui.trimWindow.trimStartSec || 0);
    syncNum("qcTrimEndInput", ui.trimWindow.trimEndSec != null ? ui.trimWindow.trimEndSec : "");

    const trim = a.trimInfo;
    const trimInvalid = Boolean(trim && trim.invalid);
    const tsInp = document.getElementById("qcTrimStartInput");
    const teInp = document.getElementById("qcTrimEndInput");
    if (tsInp) tsInp.classList.toggle("is-invalid", trimInvalid);
    if (teInp) teInp.classList.toggle("is-invalid", trimInvalid);

    const hintEl = document.getElementById("qcThresholdHint");
    if (hintEl) hintEl.classList.toggle("az-inline-warn", trimInvalid);
    if (trimInvalid) {
      setText("qcThresholdHint", trim.warning || "Invalid trim window: start must be less than end (showing full assay).");
    } else if (trim && trim.active) {
      const sLbl = trim.trimStartSec != null ? `${trim.trimStartSec}s` : "0s";
      const eLbl = trim.trimEndSec != null ? `${trim.trimEndSec}s` : "end";
      setText("qcThresholdHint", `Trim active (${sLbl} → ${eLbl}) · keeping ${trim.keptRows}/${trim.originalRows} rows`);
    } else {
      setText("qcThresholdHint", `Preset: ${th.label || th.presetId} · non-destructive trimming preserves raw CSV values`);
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Plate / Maze Controls, Multi-Factor Layers & Shared SVG Renderer
  // ---------------------------------------------------------------------------
  function getPlateMetricOptions() {
    const a = getActiveRunAnalysis();
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
    if (caps.hasXy) opts.push({ id: "immobilityPct", label: "Immobility (%)", unit: "%", dec: 1 });
    if (caps.hasZchange) {
      opts.push({ id: "transitions", label: "Zone Entries", unit: "", dec: 0 });
      if (caps.hasSab) opts.push({ id: "sabPct", label: "Spontaneous Alternation (%)", unit: "%", dec: 1 });
    }
    if (!opts.length) opts.push({ id: "totalDist", label: "Total Distance (mm)", unit: "mm", dec: 1 });
    return opts;
  }

  function getWellHeatmapMetricValue(wSum, metricId) {
    if (!wSum) return null;
    if (wSum.heatmapValues && Number.isFinite(wSum.heatmapValues[metricId])) return wSum.heatmapValues[metricId];
    switch (metricId) {
      case "totalDist": return Number.isFinite(wSum.totalDist) ? wSum.totalDist : null;
      case "meanDist": return Number.isFinite(wSum.meanDist) ? wSum.meanDist : null;
      case "meanMsd": return Number.isFinite(wSum.meanMsd) ? wSum.meanMsd : null;
      case "z1Pct": return wSum.zones && Number.isFinite(wSum.zones.z1Pct) ? wSum.zones.z1Pct : null;
      case "z2Pct": return wSum.zones && Number.isFinite(wSum.zones.z2Pct) ? wSum.zones.z2Pct : null;
      case "ppiPct": return wSum.startle && Number.isFinite(wSum.startle.ppiPct) ? wSum.startle.ppiPct : null;
      case "immobilityPct": return wSum.xy && Number.isFinite(wSum.xy.immobilityPct) ? wSum.xy.immobilityPct : null;
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
    const a = getActiveRunAnalysis();
    const run = getActiveRun();
    if (!a || !run) return;

    const plateLbl = formatPlateSubtitle(a.layout);
    const runPrefix = ui.runs.length > 1 ? `${run.runId} · ` : "";
    setText("qcPlateSubtitle", `${runPrefix}${plateLbl} · Click well to inspect, Shift+click to toggle exclusion`);

    const isFactorMode = ui.activeFactorLayer !== PRIMARY_LAYER && run.factorNames.includes(ui.activeFactorLayer);
    if (!isFactorMode) ui.activeFactorLayer = PRIMARY_LAYER;

    setText("brushPlateSubtitle", `${runPrefix}${plateLbl} · Painting ${isFactorMode ? `factor "${ui.activeFactorLayer}"` : "Primary Group"}`);
    setText("activeLayerHint", isFactorMode ? `Factor: ${ui.activeFactorLayer}` : "Primary Group");
    setText("swatchSectionLbl", isFactorMode ? `Levels for "${ui.activeFactorLayer}"` : "Group Swatches");
    setText("activeGroupNameLabel", isFactorMode ? `Rename selected "${ui.activeFactorLayer}" level` : "Rename selected group");
    setText("addGroupBtn", isFactorMode ? "+ Add Level" : "+ Add Group");
    setText("deleteGroupBtn", isFactorMode ? "Remove Level" : "Remove Group");

    // Step 2 Heatmap metric selector
    const mSel = document.getElementById("plateMetricSel");
    if (mSel) {
      const opts = getPlateMetricOptions();
      if (!opts.some(o => o.id === ui.plateMetric)) ui.plateMetric = opts[0].id;
      mSel.innerHTML = opts.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("");
      mSel.value = ui.plateMetric;
    }

    // Step 3 Factor Layer pills
    const flBar = document.getElementById("factorLayerBar");
    if (flBar) {
      const pills = [
        `<button type="button" class="az-factor-pill${!isFactorMode ? " active" : ""}" data-factor-layer="${PRIMARY_LAYER}">Primary Group</button>`,
        ...run.factorNames.map(fn => (
          `<button type="button" class="az-factor-pill${ui.activeFactorLayer === fn ? " active" : ""}" data-factor-layer="${esc(fn)}">` +
            `<span>${esc(fn)}</span>` +
            `<span class="az-factor-rm" data-rm-factor="${esc(fn)}" title="Remove factor ${esc(fn)}">&times;</span>` +
          `</button>`
        ))
      ];
      flBar.innerHTML = pills.join("");
      flBar.querySelectorAll("[data-factor-layer]").forEach(btn => {
        btn.addEventListener("click", (e) => {
          if (e.target && e.target.closest && e.target.closest("[data-rm-factor]")) return;
          const layer = btn.getAttribute("data-factor-layer") || PRIMARY_LAYER;
          ui.activeFactorLayer = layer;
          ui.brushTool = "group";
          if (layer !== PRIMARY_LAYER) {
            const lvls = run.factorLevelOrder[layer] || [];
            ui.activeBrushFactorVal = lvls.length ? lvls[0] : UNASSIGNED;
          }
          renderPlateControls();
          renderAllPlateMaps();
        });
      });
      flBar.querySelectorAll("[data-rm-factor]").forEach(rm => {
        rm.addEventListener("click", (e) => {
          e.stopPropagation();
          removeFactorLayer(rm.getAttribute("data-rm-factor"));
        });
      });
    }

    const combBtn = document.getElementById("combineFactorsBtn");
    if (combBtn) combBtn.style.display = run.factorNames.length > 0 ? "" : "none";

    const fDetails = document.getElementById("factorLayersDetails");
    const fSummary = document.getElementById("factorLayersSummary");
    if (fDetails && run.factorNames.length > 0) {
      fDetails.open = true;
    }
    if (fSummary) {
      fSummary.textContent = run.factorNames.length > 0
        ? `Active factors (${run.factorNames.length}) & combine`
        : "Custom factor layers & combine";
    }

    // Step 3 Swatches (Primary Groups OR Active Factor Levels)
    const swWrap = document.getElementById("groupSwatchList");
    if (swWrap) {
      const counts = {};
      if (isFactorMode) {
        const fn = ui.activeFactorLayer;
        const fMap = run.wellFactors[fn] || {};
        for (const w of run.summaryParsed.wells) {
          const v = fMap[w] || UNASSIGNED;
          counts[v] = (counts[v] || 0) + 1;
        }
        const lvls = run.factorLevelOrder[fn] || [];
        if (!lvls.includes(ui.activeBrushFactorVal) && ui.activeBrushFactorVal !== UNASSIGNED) {
          ui.activeBrushFactorVal = lvls.length ? lvls[0] : UNASSIGNED;
        }
        const allItems = [...lvls, UNASSIGNED];
        swWrap.innerHTML = allItems.map(lv => {
          const col = getFactorLevelColor(fn, lv, lvls);
          const isAct = ui.brushTool === "group" && ui.activeBrushFactorVal === lv;
          return (
            `<button type="button" class="az-swatch-btn${isAct ? " active" : ""}" data-swatch-val="${esc(lv)}">` +
              `<span class="az-swatch-dot" style="background:${col};"></span>` +
              `<span>${esc(lv)}</span>` +
              `<span class="az-swatch-count">(${counts[lv] || 0})</span>` +
            `</button>`
          );
        }).join("");
        swWrap.querySelectorAll("[data-swatch-val]").forEach(btn => {
          btn.addEventListener("click", () => {
            ui.brushTool = "group";
            ui.activeBrushFactorVal = btn.getAttribute("data-swatch-val") || UNASSIGNED;
            renderPlateControls();
          });
        });
      } else {
        for (const w of run.summaryParsed.wells) {
          const g = run.groups[w] || UNASSIGNED;
          counts[g] = (counts[g] || 0) + 1;
        }
        const allGroups = [...run.groupOrder, UNASSIGNED];
        swWrap.innerHTML = allGroups.map(g => {
          const col = getGroupColor(g);
          const isAct = ui.brushTool === "group" && ui.activeBrushGroup === g;
          return (
            `<button type="button" class="az-swatch-btn${isAct ? " active" : ""}" data-swatch-group="${esc(g)}">` +
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
    }

    const nameInp = document.getElementById("activeGroupNameInput");
    const delBtn = document.getElementById("deleteGroupBtn");
    const curSelVal = isFactorMode ? ui.activeBrushFactorVal : ui.activeBrushGroup;
    const isNamed = Boolean(curSelVal && curSelVal !== UNASSIGNED);
    if (nameInp) {
      if (document.activeElement !== nameInp) nameInp.value = isNamed ? curSelVal : "";
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
      } else if (isFactorMode) {
        ind.className = "badge-custom";
        ind.textContent = `${ui.activeFactorLayer}: ${ui.activeBrushFactorVal || UNASSIGNED}`;
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
    const a = getActiveRunAnalysis();
    const run = getActiveRun();
    if (!svg || !a || !a.layout || !run) return;

    const layout = a.layout;
    const isPetri = layout.id === "petri";
    const plateW = isPetri ? 132 : (layout.plateW || 127.8);
    const plateH = isPetri ? 88 : (layout.plateH || 85.5);
    const wells = layout.wells || run.summaryParsed.wells;
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

    const isFactorBrush = mode === "brush" && ui.activeFactorLayer !== PRIMARY_LAYER && run.factorNames.includes(ui.activeFactorLayer);
    const activeFactorMap = isFactorBrush ? (run.wellFactors[ui.activeFactorLayer] || {}) : null;
    const activeFactorOrder = isFactorBrush ? (run.factorLevelOrder[ui.activeFactorLayer] || []) : null;

    const wellVisualStyle = (w) => {
      const ws = wellsById[w];
      const grp = (ws && ws.group) || run.groups[w] || UNASSIGNED;
      const gCol = getGroupColor(grp);
      const isExcl = run.excludedWells.has(w);
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
        if (isFactorBrush) {
          const fv = activeFactorMap[w] || UNASSIGNED;
          if (fv === UNASSIGNED) {
            fill = "#f6f8fa"; stroke = "#afb8c1"; textColor = "#59636e";
          } else {
            const fc = getFactorLevelColor(ui.activeFactorLayer, fv, activeFactorOrder);
            fill = hexToRgba(fc, 0.25); stroke = fc; strokeWidth = 1.1; textColor = "#1f2328";
          }
        } else if (grp === UNASSIGNED || grp === ALL_WELLS) {
          fill = "#f6f8fa"; stroke = "#afb8c1"; textColor = "#59636e";
        } else {
          fill = hexToRgba(gCol, 0.24); stroke = gCol; strokeWidth = 1.1; textColor = "#1f2328";
        }
      } else {
        const val = valsByWell[w];
        if (isEmpty) {
          fill = "#f3f4f6"; stroke = "#8c959f"; strokeDash = ' stroke-dasharray="1.8,1.2"'; textColor = "#59636e";
        } else if (Number.isFinite(val)) {
          const t = (val - vMin) / (vMax - vMin);
          const hc = heatColor(t);
          fill = hc.fill; textColor = hc.text;
          stroke = (grp !== UNASSIGNED && grp !== ALL_WELLS) ? gCol : "#0969da";
          strokeWidth = (grp !== UNASSIGNED && grp !== ALL_WELLS) ? 1.15 : 0.75;
        } else {
          fill = "#f6f8fa"; stroke = "#afb8c1";
        }
      }

      if (isSpike && !isExcl) { stroke = "#cf222e"; strokeWidth = 1.35; }
      if (isExcl) {
        fill = "#eef1f4"; stroke = "#8c959f"; strokeDash = ' stroke-dasharray="1.5,1.2"'; textColor = "#6e7781"; opacity = 0.58;
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
        let sumX = 0, sumY = 0, hubShape = null, inner = "";
        for (const s of shapes) {
          sumX += s.x; sumY += s.y;
          if (s.type === "TRIANGLE") hubShape = s;
          const rot = s.angle && s.type !== "DISC" ? ` transform="rotate(${s.angle} ${s.x.toFixed(2)} ${s.y.toFixed(2)})"` : "";
          const common = `fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.strokeWidth}"${st.strokeDash}`;
          if (s.type === "DISC") inner += `<circle cx="${s.x.toFixed(2)}" cy="${s.y.toFixed(2)}" r="${s.w.toFixed(2)}" ${common}/>`;
          else if (s.type === "SQUARE") {
            const half = s.w / 2;
            inner += `<rect x="${(s.x - half).toFixed(2)}" y="${(s.y - half).toFixed(2)}" width="${s.w.toFixed(2)}" height="${s.w.toFixed(2)}"${rot} ${common}/>`;
          } else if (s.type === "TRIANGLE" && typeof buildTrianglePointsAttr === "function") {
            inner += `<polygon points="${buildTrianglePointsAttr(s.x, s.y, s.w)}"${rot} ${common}/>`;
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
            selRing + inner +
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
        const cx = wc.x, cy = wc.y;
        const r = wc.r || (Math.min(wc.w || 10, wc.h || 10) / 2);
        const isSquare = wc.shape === "SQUARE" || wc.shape === "RECT" || layout.shape === "SQUARE";
        const isTile = wc.shape === "RECT" || layout.isMaze;

        let shapeSvg = "";
        if (isSquare || isTile) {
          const bw = wc.w || (r * 2), bh = wc.h || (r * 2);
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
      out[w] = { x: padX + (col + 0.5) * stepX, y: padY + (row + 0.5) * stepY, r, w: stepX * 0.78, h: stepY * 0.78, shape: "RECT", row, col };
    });
    return out;
  }

  function renderWellInspector() {
    const textEl = document.getElementById("qcWellInspectorText");
    const btnEl = document.getElementById("qcWellInspectorExcludeBtn");
    const a = getActiveRunAnalysis();
    if (!textEl || !btnEl || !a) return;

    const w = ui.selectedWell;
    const ws = w && a.wellsById ? a.wellsById[w] : null;
    if (!ws) {
      textEl.innerHTML = "Click any well on the plate map to inspect its QC metrics or toggle exclusion.";
      btnEl.style.display = "none";
      return;
    }

    const parts = [`<strong>${esc(ws.well)}</strong>`, `<span>${esc(ws.group || UNASSIGNED)}</span>`];
    if (Number.isFinite(ws.totalDist)) parts.push(`Dist ${fmtNum(ws.totalDist, 1)} mm`);
    if (Number.isFinite(ws.meanMsd)) parts.push(`MSD ${fmtNum(ws.meanMsd, 2)}`);
    if (ws.zones && Number.isFinite(ws.zones.z2Pct)) parts.push(`Z2 ${fmtNum(ws.zones.z2Pct, 1)}%`);
    if (ws.startle && Number.isFinite(ws.startle.ppiPct)) parts.push(`PPI ${fmtNum(ws.startle.ppiPct, 1)}%`);
    if (ws.xy && Number.isFinite(ws.xy.immobilityPct)) parts.push(`Immob ${fmtNum(ws.xy.immobilityPct, 1)}%`);
    if (ws.zchange && Number.isFinite(ws.zchange.sabPct)) parts.push(`SAB ${fmtNum(ws.zchange.sabPct, 1)}%`);
    if (ws.qc && ws.qc.isEmpty) parts.push(`<span class="az-pill az-pill-empty">Empty</span>`);
    if (ws.qc && ws.qc.isSpikeGlitch) parts.push(`<span class="az-pill az-pill-spike">${ws.qc.spikeCount} Spike${ws.qc.spikeCount === 1 ? "" : "s"}</span>`);
    if (ws.excluded) parts.push(`<span class="az-pill az-pill-excl">Excluded (${esc(ws.qcReason || "manual")})</span>`);

    textEl.innerHTML = parts.join(" · ");
    btnEl.style.display = "";
    btnEl.textContent = ws.excluded ? "Restore Well" : "Exclude Well";
  }

  function setWellExcluded(run, wellId, isExcluded, source, reason) {
    if (!run || !wellId) return;
    if (isExcluded) {
      const wasExcluded = run.excludedWells.has(wellId);
      const prevMeta = run.excludeMeta && run.excludeMeta[wellId];
      const src = source || "manual";
      const isManualAfterStats = src === "manual" && ui.hasViewedStats;
      run.excludedWells.add(wellId);
      run.excludeMeta[wellId] = {
        source: src,
        reason: reason || "manual_exclude",
        afterStatsViewed: isManualAfterStats || Boolean(wasExcluded && prevMeta && prevMeta.afterStatsViewed),
        afterStatsAt: isManualAfterStats
          ? new Date().toISOString()
          : (wasExcluded && prevMeta && prevMeta.afterStatsAt ? prevMeta.afterStatsAt : null)
      };
    } else {
      run.excludedWells.delete(wellId);
      delete run.excludeMeta[wellId];
    }
  }

  function paintWell(wellId, isStartOfStroke) {
    const run = getActiveRun();
    if (!wellId || !run) return;
    if (_paintedInStroke.has(wellId)) return;
    _paintedInStroke.add(wellId);
    ui.selectedWell = wellId;

    if (ui.brushTool === "exclude") {
      if (isStartOfStroke) _paintExcludeValue = !run.excludedWells.has(wellId);
      setWellExcluded(run, wellId, _paintExcludeValue, "manual", "manual_exclude");
    } else if (ui.activeFactorLayer !== PRIMARY_LAYER && run.factorNames.includes(ui.activeFactorLayer)) {
      const fn = ui.activeFactorLayer;
      if (!run.wellFactors[fn]) run.wellFactors[fn] = {};
      if (!ui.activeBrushFactorVal || ui.activeBrushFactorVal === UNASSIGNED) {
        delete run.wellFactors[fn][wellId];
      } else {
        run.wellFactors[fn][wellId] = ui.activeBrushFactorVal;
      }
    } else {
      if (!ui.activeBrushGroup || ui.activeBrushGroup === UNASSIGNED) {
        delete run.groups[wellId];
      } else {
        run.groups[wellId] = ui.activeBrushGroup;
      }
    }
    recomputeAndRender();
  }

  function showPlateTooltipInto(tt, stage, wellId, clientX, clientY) {
    const a = getActiveRunAnalysis();
    const run = getActiveRun();
    if (!a || !a.wellsById || !a.wellsById[wellId]) {
      hideTooltip(tt);
      return;
    }
    const ws = a.wellsById[wellId];
    const gCol = getGroupColor(ws.group);
    let rows = `<div class="az-tt-title">${esc(ws.well)} · <span class="az-tt-swatch" style="background:${gCol};"></span>${esc(ws.group || UNASSIGNED)}</div>`;
    if (run && run.factorNames.length) {
      const fPairs = run.factorNames.map(fn => `${fn}=${(run.wellFactors[fn] && run.wellFactors[fn][wellId]) || "—"}`).join(", ");
      rows += `<div class="az-tt-row"><span>Factors</span><span class="az-tt-val">${esc(fPairs)}</span></div>`;
    }
    if (Number.isFinite(ws.totalDist)) rows += `<div class="az-tt-row"><span>Total Dist</span><span class="az-tt-val">${fmtNum(ws.totalDist, 1)} mm</span></div>`;
    if (Number.isFinite(ws.meanMsd)) rows += `<div class="az-tt-row"><span>Mean MSD</span><span class="az-tt-val">${fmtNum(ws.meanMsd, 2)}</span></div>`;
    if (ws.zones && Number.isFinite(ws.zones.z2Pct)) rows += `<div class="az-tt-row"><span>Z1 / Z2</span><span class="az-tt-val">${fmtNum(ws.zones.z1Pct, 0)}% / ${fmtNum(ws.zones.z2Pct, 0)}%</span></div>`;
    if (ws.startle && Number.isFinite(ws.startle.ppiPct)) rows += `<div class="az-tt-row"><span>% PPI</span><span class="az-tt-val">${fmtNum(ws.startle.ppiPct, 1)}%</span></div>`;
    if (ws.xy && Number.isFinite(ws.xy.immobilityPct)) rows += `<div class="az-tt-row"><span>Immobility</span><span class="az-tt-val">${fmtNum(ws.xy.immobilityPct, 1)}%</span></div>`;
    if (ws.zchange && Number.isFinite(ws.zchange.totalEntries)) rows += `<div class="az-tt-row"><span>Zone Entries</span><span class="az-tt-val">${ws.zchange.totalEntries}${Number.isFinite(ws.zchange.sabPct) ? ` (SAB ${fmtNum(ws.zchange.sabPct, 0)}%)` : ""}</span></div>`;
    if (ws.excluded) rows += `<div class="az-tt-row"><span>Status</span><span class="az-tt-val">Excluded (${esc(ws.qcReason || "manual")})</span></div>`;
    else if (ws.qc && ws.qc.isSpikeGlitch) rows += `<div class="az-tt-row"><span>QC</span><span class="az-tt-val">Spike Glitch (${ws.qc.spikeCount})</span></div>`;
    else if (ws.qc && ws.qc.isEmpty) rows += `<div class="az-tt-row"><span>QC</span><span class="az-tt-val">Empty / Dead</span></div>`;
    positionTooltip(tt, stage, clientX, clientY, rows);
  }

  // ---------------------------------------------------------------------------
  // 9. Step 2: Temperature Curve (with niceTimeTicks) & QC Diagnostics Table
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
    const a = getActiveRunAnalysis();
    const run = getActiveRun();
    if (!svg || !a || !run) return;

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
      const durEnd = (a.kpis && Number.isFinite(a.kpis.durationSec)) ? a.kpis.durationSec : 0;
      const xMax = Math.max(xMin + 1, pts[pts.length - 1].relTime, durEnd);
      let yLo = ta.min, yHi = ta.max;
      if (targetC !== null) { yLo = Math.min(yLo, targetC - 0.6); yHi = Math.max(yHi, targetC + 0.6); }
      if (yHi - yLo < 2.4) { const mid = (yHi + yLo) / 2; yLo = mid - 1.2; yHi = mid + 1.2; }
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

      const xTicksObj = niceTimeTicks(xMin, xMax, 5);
      for (const xt of xTicksObj.ticks) {
        if (xt < xMin - 1e-6 || xt > xMax + 1e-6) continue;
        const xx = sx(xt);
        out += `<line x1="${xx.toFixed(1)}" y1="${m.top + ph}" x2="${xx.toFixed(1)}" y2="${m.top + ph + 4}" stroke="#94a3b8" stroke-width="1"/>`;
        out += `<text x="${xx.toFixed(1)}" y="${m.top + ph + 17}" font-size="10.5" fill="#59636e" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(fmtAxisTime(xt, xMax, xTicksObj.step))}</text>`;
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
          let best = pts[0], bestD = Infinity;
          for (const p of pts) {
            const dist = Math.abs(p.relTime - relT);
            if (dist < bestD) { bestD = dist; best = p; }
          }
          const xx = sx(best.relTime), yy = sy(best.tempC);
          hLayer.innerHTML =
            `<line x1="${xx.toFixed(1)}" y1="${m.top}" x2="${xx.toFixed(1)}" y2="${m.top + ph}" stroke="#59636e" stroke-width="1" stroke-dasharray="3,2"/>` +
            `<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="4" fill="#ea580c" stroke="#ffffff" stroke-width="1.5"/>`;
          const deltaStr = targetC !== null
            ? `<div class="az-tt-row"><span>vs Target</span><span class="az-tt-val">${best.tempC - targetC >= 0 ? "+" : ""}${(best.tempC - targetC).toFixed(2)} °C</span></div>`
            : "";
          const html =
            `<div class="az-tt-title">t = ${esc(fmtAxisTime(best.relTime, xMax))}${best.phase ? " · " + esc(best.phase) : ""}</div>` +
            `<div class="az-tt-row"><span>TEMP_C</span><span class="az-tt-val">${best.tempC.toFixed(2)} °C</span></div>` +
            deltaStr;
          positionTooltip(tt, stage, e.clientX, e.clientY, html);
        });
        hit.addEventListener("mouseleave", () => { hLayer.innerHTML = ""; hideTooltip(tt); });
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
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:18px;">No QC anomalies detected across all wells. Switch filter to "All Wells" to inspect every well.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(w => {
      const gCol = getGroupColor(w.group);
      const reasonCode = w.qcReason || (w.qc && w.qc.qcReason) || "ok";
      const srcTag = w.excludeSource ? ` (${w.excludeSource})` : "";
      const postBadge = w.afterStatsViewed ? `<span class="az-poststats-badge" title="Manually excluded after viewing screening stats">After stats</span>` : "";
      return (
        `<tr class="${w.excluded ? "is-excluded" : ""}">` +
          `<td><input type="checkbox" class="az-chk" data-qc-chk="${esc(w.well)}" aria-label="Exclude ${esc(w.well)}"${w.excluded ? " checked" : ""}></td>` +
          `<td class="az-well-id-cell">${esc(w.well)}</td>` +
          `<td><span class="az-group-tag" style="background:${hexToRgba(gCol, 0.14)};color:${gCol};"><span class="az-swatch-dot" style="background:${gCol};"></span>${esc(w.group)}</span></td>` +
          `<td>${buildQcPillsHtml(w)}</td>` +
          `<td><span class="az-reason-code">${esc(reasonCode)}${esc(srcTag)}</span>${postBadge}</td>` +
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
        setWellExcluded(run, well, chk.checked, "manual", "manual_exclude");
        recomputeAndRender();
      });
    });

    tbody.querySelectorAll("[data-qc-toggle]").forEach(btn => {
      btn.addEventListener("click", () => {
        const well = btn.getAttribute("data-qc-toggle");
        setWellExcluded(run, well, !run.excludedWells.has(well), "manual", "manual_exclude");
        recomputeAndRender();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 10. Step 4: Scope Bar, Toolbars & 4-Tab Pure-SVG Charting Studio
  // ---------------------------------------------------------------------------
  function renderPlotScopeBar() {
    const bar = document.getElementById("plotScopeBar");
    const a = ui.analysis;
    if (!bar || !a) return;
    const multi = ui.runs.length > 1;
    bar.style.display = multi ? "" : "none";
    if (!multi) return;

    const pooledBtn = document.getElementById("plotScopePooledBtn");
    const activeBtn = document.getElementById("plotScopeActiveBtn");
    const run = getActiveRun();
    if (pooledBtn) {
      pooledBtn.textContent = `Pooled (${ui.runs.length} runs)`;
      pooledBtn.classList.toggle("active", ui.scope === "pooled");
    }
    if (activeBtn) {
      activeBtn.textContent = `Active: ${run ? run.runId : "Run"}`;
      activeBtn.classList.toggle("active", ui.scope !== "pooled");
    }

    const unitWrap = document.getElementById("plotUnitToggleWrap");
    const unitWellsBtn = document.getElementById("unitWellsBtn");
    const unitPlatesBtn = document.getElementById("unitPlatesBtn");
    const unitActive = multi && ui.scope === "pooled";
    if (unitWrap) unitWrap.classList.toggle("is-disabled", !unitActive);
    if (unitWellsBtn) {
      unitWellsBtn.disabled = !unitActive;
      unitWellsBtn.classList.toggle("active", ui.unitOfAnalysis !== "plates");
    }
    if (unitPlatesBtn) {
      unitPlatesBtn.disabled = !unitActive;
      unitPlatesBtn.classList.toggle("active", ui.unitOfAnalysis === "plates");
    }

    const normChk = document.getElementById("normControlChk");
    if (normChk) normChk.checked = ui.normalizeToControl;

    const pm = a.pooledMeta || {};
    const ctrlWrap = document.getElementById("normControlGroupWrap");
    const ctrlSel = document.getElementById("normControlGroupSel");
    if (ctrlWrap && ctrlSel) {
      const avail = pm.availableControlGroups || (a.groups || []).map(g => g.group);
      const normEnabled = ui.normalizeToControl && avail.length > 0;
      ctrlWrap.classList.toggle("is-disabled", !normEnabled);
      ctrlSel.disabled = !normEnabled;
      ctrlSel.innerHTML = avail.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
      ctrlSel.value = pm.controlGroupName || ui.controlGroupName || avail[0] || "";
    }

    const shiftBadge = document.getElementById("batchShiftBadge");
    if (shiftBadge) {
      const shift = pm.batchDiagnostics ? pm.batchDiagnostics.plateShiftPct : null;
      if (Number.isFinite(shift) && shift > 0) {
        shiftBadge.style.display = "";
        shiftBadge.className = ui.normalizeToControl ? "badge-custom" : (shift >= 10 ? "badge-warn" : "badge-hw");
        shiftBadge.textContent = ui.normalizeToControl
          ? `Normalized to ${pm.controlGroupName || "Control"} (raw shift +${shift.toFixed(1)}%)`
          : `Inter-plate shift +${shift.toFixed(1)}%`;
      } else {
        shiftBadge.style.display = "none";
      }
    }
  }

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

    // Peri-stimulus / Habituation trace view selector
    const ps = a.periStimulus;
    const tvWrap = document.getElementById("tsTraceViewWrap");
    const tvSel = document.getElementById("tsTraceViewSel");
    const ptWrap = document.getElementById("tsPeriTypeWrap");
    const ptSel = document.getElementById("tsPeriTypeSel");
    if (tvWrap && tvSel) {
      tvWrap.style.display = ps ? "" : "none";
      if (ps) {
        const opts = [
          `<option value="full">Full Trace</option>`,
          `<option value="peri">Peri-Stimulus (t = 0)</option>`
        ];
        if (ps.hasHabituation) opts.push(`<option value="habituation">Trial Habituation (T1..T${ps.trialCount})</option>`);
        tvSel.innerHTML = opts.join("");
        tvSel.value = ui.tsTraceView;
      }
    }
    if (ptWrap && ptSel) {
      const showTypes = Boolean(ps && ui.tsTraceView === "peri" && ps.availableTypes && ps.availableTypes.length > 1);
      ptWrap.style.display = showTypes ? "" : "none";
      if (showTypes) {
        ptSel.innerHTML = ps.availableTypes.map(k => `<option value="${esc(k)}">${esc((ps.byType[k] && ps.byType[k].label) || k)}</option>`).join("");
        if (!ps.availableTypes.includes(ui.tsPeriType)) ui.tsPeriType = ps.defaultType || "ALL";
        ptSel.value = ui.tsPeriType;
      }
    }

    const winWrap = document.getElementById("tsWindowAucWrap");
    if (winWrap) winWrap.style.display = ui.tsTraceView === "full" ? "" : "none";
    const winCfg = getActiveWindowAucConfig();
    const winWarn = a.windowAucWarning || "";
    const winS = document.getElementById("tsWinStartInput");
    const winE = document.getElementById("tsWinEndInput");
    if (winS) winS.classList.toggle("is-invalid", Boolean(winWarn));
    if (winE) winE.classList.toggle("is-invalid", Boolean(winWarn));
    const winClear = document.getElementById("tsWinClearBtn");
    const winReadout = document.getElementById("tsWinAucReadout");
    if (winClear) winClear.disabled = !(winCfg || winWarn);
    if (winReadout) {
      winReadout.classList.toggle("az-inline-warn", Boolean(winWarn));
      if (winWarn) {
        winReadout.textContent = winWarn;
      } else {
        winReadout.textContent = winCfg ? `Shaded ${winCfg.startSec}–${winCfg.endSec}s (see Phase & Group → Window AUC)` : "";
      }
    }

    const compSel = document.getElementById("compViewSel");
    if (compSel) {
      const views = (a.comparisonViews && a.comparisonViews.length)
        ? a.comparisonViews
        : [{ id: "phase_totals", label: "Total Distance" }];
      compSel.innerHTML = views.map(v => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join("");
      compSel.value = ui.compView;
    }

    const showStatsChk = document.getElementById("compShowStatsChk");
    if (showStatsChk) showStatsChk.checked = ui.compShowStats;
    const tfWrap = document.getElementById("compTestFamilyWrap");
    const tfSel = document.getElementById("compTestFamilySel");
    if (tfWrap) tfWrap.classList.toggle("is-disabled", !ui.compShowStats);
    if (tfSel) {
      tfSel.disabled = !ui.compShowStats;
      tfSel.value = ui.primaryTestFamily || "parametric";
    }

    const xyInp = document.getElementById("xyFreezeInput");
    if (xyInp && document.activeElement !== xyInp) xyInp.value = String(ui.xyFreezeSpeedMmS);

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
    renderSpatialTab();
  }

  function renderGroupLegend(containerId, groupsList) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!groupsList || !groupsList.length) { el.innerHTML = ""; return; }
    el.innerHTML = groupsList.map(g => {
      const name = g.group;
      const col = getGroupColor(name);
      const muted = ui.hiddenGroups.has(name);
      return (
        `<button type="button" class="az-legend-item${muted ? " is-muted" : ""}" data-legend-group="${esc(name)}" title="Click to toggle visibility">` +
          `<span class="az-legend-swatch" style="background:${col};"></span>` +
          `<span>${esc(name)}</span>` +
          `<span class="az-legend-n">(n=${esc(fmtNUnit(g.n, ui.analysis))})</span>` +
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

  // Tab 1: Time Series (Full Trace + Window AUC Band, OR Peri-Stimulus t=0, OR Trial Habituation)
  function renderTimeSeriesChart() {
    const svg = document.getElementById("tsChartSvg");
    const stage = document.getElementById("tsChartStage");
    const tt = document.getElementById("tsTooltip");
    const a = ui.analysis;
    if (!svg || !a || !a.timeSeries) return;

    if (ui.tsTraceView === "peri" && a.periStimulus) {
      renderPeriStimulusChart(svg, stage, tt, a.periStimulus);
      return;
    }
    if (ui.tsTraceView === "habituation" && a.periStimulus && a.periStimulus.hasHabituation) {
      renderTrialHabituationChart(svg, stage, tt, a.periStimulus);
      return;
    }

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
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#59636e">${nPts === 0 ? "No time-series bins available for this CSV." : "All groups are hidden or excluded — restore wells or toggle a group in the legend."}</text>`;
      return;
    }

    const xStarts = xAxis.map((pt, idx) =>
      typeof pt === "number" ? pt : (Number.isFinite(pt.relTime) ? pt.relTime : idx * (ts.effectiveBinSec || 1))
    );
    const xEnds = xAxis.map((pt, idx) => {
      if (pt && Number.isFinite(pt.endTime)) return pt.endTime;
      if (idx + 1 < xStarts.length) return xStarts[idx + 1];
      return xStarts[idx] + (ts.effectiveBinSec || 0);
    });
    const xTimes = xStarts.map((s, idx) => (xEnds[idx] > s ? (s + xEnds[idx]) / 2 : s));
    const xMin = xStarts[0];
    const xMax = Math.max(xMin + 1, xEnds[nPts - 1]);

    let yLo = 0, yHi = -Infinity;
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
    const isPct = String(ts.unit || "") === "%";
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

    // Optional Window AUC highlight overlay
    const winCfg = getActiveWindowAucConfig();
    if (winCfg) {
      const wx0 = Math.max(m.left, sx(winCfg.startSec));
      const wx1 = Math.min(m.left + pw, sx(winCfg.endSec));
      if (wx1 > wx0 + 1) {
        const aucTxt = `AUC ${winCfg.startSec}–${winCfg.endSec}s`;
        const pillW = Math.max(72, Math.round(aucTxt.length * 6.0 + 14));
        const pillX = Math.min(m.left + pw - pillW - 2, wx0 + 4);
        out += `<rect x="${wx0.toFixed(1)}" y="${m.top}" width="${(wx1 - wx0).toFixed(1)}" height="${ph}" fill="rgba(9, 105, 218, 0.11)" stroke="#0969da" stroke-width="1" stroke-dasharray="4,3"/>`;
        out += `<rect x="${pillX.toFixed(1)}" y="${(m.top + 4).toFixed(1)}" width="${pillW}" height="14" rx="3" fill="rgba(255,255,255,0.94)" stroke="#54aeff" stroke-width="0.6"/>`;
        out += `<text x="${(pillX + 5).toFixed(1)}" y="${(m.top + 14).toFixed(1)}" font-size="9.5" font-weight="700" fill="#0969da">${esc(aucTxt)}</text>`;
      }
    }

    for (const tv of yTicksObj.ticks) {
      const yy = sy(tv);
      if (yy < m.top - 1 || yy > m.top + ph + 1) continue;
      out += `<line x1="${m.left}" y1="${yy.toFixed(1)}" x2="${m.left + pw}" y2="${yy.toFixed(1)}" stroke="${tv === 0 ? "#cbd5e1" : "#edf1f5"}" stroke-width="1"/>`;
      out += `<text x="${m.left - 8}" y="${(yy + 3.5).toFixed(1)}" font-size="10.5" fill="#59636e" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(fmtTick(tv, yTicksObj.step))}</text>`;
    }

    // 100% baseline reference line when Control-normalized
    if (ui.normalizeToControl && 100 >= yMin && 100 <= yMax) {
      const ry = sy(100);
      out += `<line x1="${m.left}" y1="${ry.toFixed(1)}" x2="${m.left + pw}" y2="${ry.toFixed(1)}" stroke="#59636e" stroke-width="1.1" stroke-dasharray="4,3"/>`;
    }

    // Sexagesimal Elapsed Time ticks (preserved!)
    const xTicksObj = niceTimeTicks(xMin, xMax, 5);
    for (const xt of xTicksObj.ticks) {
      if (xt < xMin - 1e-6 || xt > xMax + 1e-6) continue;
      const xx = sx(xt);
      out += `<line x1="${xx.toFixed(1)}" y1="${m.top + ph}" x2="${xx.toFixed(1)}" y2="${m.top + ph + 5}" stroke="#94a3b8" stroke-width="1"/>`;
      out += `<text x="${xx.toFixed(1)}" y="${m.top + ph + 18}" font-size="10.5" fill="#59636e" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(fmtAxisTime(xt, xMax, xTicksObj.step))}</text>`;
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
    const rawBin = ts.rawBinSec || ts.effectiveBinSec;
    const fmtBinSec = (sec) => {
      const n = Number(sec);
      if (!Number.isFinite(n)) return "1s";
      return Math.abs(n - Math.round(n)) < 1e-6 ? `${Math.round(n)}s` : `${n.toFixed(1)}s`;
    };
    const binLbl = ts.binGroupSize > 1
      ? `Elapsed Time (${fmtBinSec(ts.effectiveBinSec)} smoothed bins)`
      : `Elapsed Time (${fmtBinSec(rawBin)} bins)`;
    out += `<text x="${m.left + pw / 2}" y="${H - 8}" font-size="11" font-weight="600" fill="#59636e" text-anchor="middle">${esc(binLbl)}</text>`;

    let ribbons = "";
    let lines = "";
    for (const s of visSeries) {
      const col = getGroupColor(s.group);
      const vals = s.values || [];

      if (ui.tsShowSem && s.n > 1) {
        let segUpper = [], segLower = [];
        const flushRibbon = () => {
          if (segUpper.length >= 2) {
            const d = "M " + segUpper.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ") +
              " L " + segLower.reverse().map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ") + " Z";
            ribbons += `<path d="${d}" fill="${col}" fill-opacity="0.16" stroke="none"/>`;
          }
          segUpper = []; segLower = [];
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

      let pathD = "", open = false;
      for (let i = 0; i < nPts; i++) {
        const v = vals[i];
        if (!v || !Number.isFinite(v.mean)) { open = false; continue; }
        const xx = sx(xTimes[i]), yy = sy(v.mean);
        pathD += (open ? " L " : " M ") + `${xx.toFixed(1)} ${yy.toFixed(1)}`;
        open = true;
      }
      if (pathD) lines += `<path d="${pathD.trim()}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
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
        let bestIdx = 0, bestDist = Infinity;
        for (let i = 0; i < nPts; i++) {
          const d = Math.abs(xTimes[i] - relT);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        const xx = sx(xTimes[bestIdx]);
        const ptMeta = xAxis[bestIdx];
        const phaseTxt = (ptMeta && ptMeta.phase) ? ` · ${ptMeta.phase}` : "";
        let markerHtml = `<line x1="${xx.toFixed(1)}" y1="${m.top}" x2="${xx.toFixed(1)}" y2="${m.top + ph}" stroke="#59636e" stroke-width="1" stroke-dasharray="3,2"/>`;
        let ttHtml = `<div class="az-tt-title">t = ${esc(fmtAxisTime(xTimes[bestIdx], xMax))}${esc(phaseTxt)}</div>`;
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
      hit.addEventListener("mouseleave", () => { hoverLayer.innerHTML = ""; hideTooltip(tt); });
    }
  }

  function renderPeriStimulusChart(svg, stage, tt, ps) {
    const bucket = (ps.byType && ps.byType[ui.tsPeriType]) || (ps.byType && ps.byType[ps.defaultType]) || ps;
    const allSeries = bucket.series || [];
    renderGroupLegend("tsLegend", allSeries);
    const visSeries = allSeries.filter(s => !ui.hiddenGroups.has(s.group) && s.n > 0);
    const offsets = bucket.offsetsSec || ps.offsetsSec || [];

    const W = 880, H = 320;
    const m = { left: 62, right: 22, top: 28, bottom: 42 };
    const pw = W - m.left - m.right;
    const ph = H - m.top - m.bottom;

    if (!offsets.length || !visSeries.length) {
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#59636e">No peri-stimulus aligned bins available.</text>`;
      return;
    }

    const xMin = offsets[0], xMax = Math.max(xMin + 1, offsets[offsets.length - 1]);
    let yLo = 0, yHi = -Infinity;
    for (const s of visSeries) {
      for (const v of (s.values || [])) {
        if (!v || !Number.isFinite(v.mean)) continue;
        yHi = Math.max(yHi, v.mean + (ui.tsShowSem ? (v.sem || 0) : 0));
        yLo = Math.min(yLo, v.mean - (ui.tsShowSem ? (v.sem || 0) : 0));
      }
    }
    if (!Number.isFinite(yHi) || yHi <= yLo) yHi = 10;
    const yTicksObj = niceTicks(Math.min(0, yLo), yHi * 1.12, 5);
    const yMin = yTicksObj.min, yMax = Math.max(yMin + 1e-6, yTicksObj.max);

    const sx = (t) => m.left + ((t - xMin) / (xMax - xMin)) * pw;
    const sy = (v) => m.top + ph - ((v - yMin) / (yMax - yMin)) * ph;

    let out = "";
    for (const tv of yTicksObj.ticks) {
      const yy = sy(tv);
      out += `<line x1="${m.left}" y1="${yy.toFixed(1)}" x2="${m.left + pw}" y2="${yy.toFixed(1)}" stroke="${tv === 0 ? "#cbd5e1" : "#edf1f5"}" stroke-width="1"/>`;
      out += `<text x="${m.left - 8}" y="${(yy + 3.5).toFixed(1)}" font-size="10.5" fill="#59636e" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(fmtTick(tv, yTicksObj.step))}</text>`;
    }

    // t = 0 stimulus onset vertical line
    if (0 >= xMin && 0 <= xMax) {
      const zx = sx(0);
      out += `<line x1="${zx.toFixed(1)}" y1="${m.top}" x2="${zx.toFixed(1)}" y2="${m.top + ph}" stroke="#d97706" stroke-width="1.6" stroke-dasharray="4,3"/>`;
      out += `<rect x="${(zx - 40).toFixed(1)}" y="${(m.top - 18).toFixed(1)}" width="80" height="14" rx="3" fill="#fff8c5" stroke="#d4a72c" stroke-width="0.6"/>`;
      out += `<text x="${zx.toFixed(1)}" y="${(m.top - 8).toFixed(1)}" font-size="9.5" font-weight="700" fill="#9a6700" text-anchor="middle">Stimulus t = 0s</text>`;
    }

    for (const xt of offsets) {
      const xx = sx(xt);
      out += `<line x1="${xx.toFixed(1)}" y1="${m.top + ph}" x2="${xx.toFixed(1)}" y2="${m.top + ph + 4}" stroke="#94a3b8" stroke-width="1"/>`;
      out += `<text x="${xx.toFixed(1)}" y="${m.top + ph + 17}" font-size="10.5" fill="#59636e" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${xt > 0 ? "+" : ""}${xt}s</text>`;
    }

    out += `<line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;
    out += `<line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;
    out += `<text transform="rotate(-90)" x="${-(m.top + ph / 2)}" y="16" font-size="11" font-weight="600" fill="#59636e" text-anchor="middle">${esc(ps.metric === "msd" ? "Activity (MSD)" : "Distance (mm/bin)")}</text>`;
    out += `<text x="${m.left + pw / 2}" y="${H - 8}" font-size="11" font-weight="600" fill="#59636e" text-anchor="middle">Time Relative to Stimulus Onset (${bucket.trialCount || ps.trialCount} aligned trials)</text>`;

    for (const s of visSeries) {
      const col = getGroupColor(s.group);
      const vals = s.values || [];
      if (ui.tsShowSem && s.n > 1) {
        let segUp = [], segLo = [];
        const flushRibbon = () => {
          if (segUp.length >= 2) {
            const rd = "M " + segUp.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ") +
              " L " + segLo.reverse().map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ") + " Z";
            out += `<path d="${rd}" fill="${col}" fill-opacity="0.16"/>`;
          }
          segUp = []; segLo = [];
        };
        offsets.forEach((t, i) => {
          const v = vals[i];
          if (!v || !Number.isFinite(v.mean)) { flushRibbon(); return; }
          const sem = Number.isFinite(v.sem) ? v.sem : 0;
          segUp.push([sx(t), sy(v.mean + sem)]);
          segLo.push([sx(t), sy(Math.max(yMin, v.mean - sem))]);
        });
        flushRibbon();
      }
      let d = "", open = false;
      offsets.forEach((t, i) => {
        const v = vals[i];
        if (!v || !Number.isFinite(v.mean)) { open = false; return; }
        d += (open ? " L " : " M ") + `${sx(t).toFixed(1)} ${sy(v.mean).toFixed(1)}`;
        open = true;
      });
      if (d) out += `<path d="${d.trim()}" fill="none" stroke="${col}" stroke-width="2.2"/>`;
      offsets.forEach((t, i) => {
        const v = vals[i];
        if (v && Number.isFinite(v.mean)) {
          out += `<circle cx="${sx(t).toFixed(1)}" cy="${sy(v.mean).toFixed(1)}" r="3.4" fill="${col}" stroke="#ffffff" stroke-width="1"/>`;
        }
      });
    }

    svg.innerHTML = out;
    hideTooltip(tt);
  }

  function renderTrialHabituationChart(svg, stage, tt, ps) {
    const hByG = ps.habituationByGroup || {};
    const groupNames = Object.keys(hByG);
    const legendList = groupNames.map(g => ({
      group: g,
      n: (hByG[g].trialSeries && hByG[g].trialSeries[0]) ? hByG[g].trialSeries[0].n : 0
    }));
    renderGroupLegend("tsLegend", legendList);
    const visGroups = groupNames.filter(g => !ui.hiddenGroups.has(g));
    const trialLabels = ps.trialLabels || [];

    const W = 880, H = 320;
    const m = { left: 62, right: 24, top: 28, bottom: 44 };
    const pw = W - m.left - m.right;
    const ph = H - m.top - m.bottom;

    if (!trialLabels.length || !visGroups.length) {
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#59636e">No repeated stimulus trials for habituation.</text>`;
      return;
    }

    let yLo = 0, yHi = -Infinity;
    for (const g of visGroups) {
      for (const pt of (hByG[g].trialSeries || [])) {
        if (pt && Number.isFinite(pt.mean)) {
          yHi = Math.max(yHi, pt.mean + (pt.sem || 0));
        }
      }
    }
    if (!Number.isFinite(yHi) || yHi <= 0) yHi = 10;
    const yTicksObj = niceTicks(0, yHi * 1.15, 5);
    const yMin = yTicksObj.min, yMax = Math.max(yMin + 1e-6, yTicksObj.max);

    const sx = (idx) => m.left + (trialLabels.length === 1 ? pw / 2 : (idx / (trialLabels.length - 1)) * pw);
    const sy = (v) => m.top + ph - ((v - yMin) / (yMax - yMin)) * ph;

    let out = "";
    for (const tv of yTicksObj.ticks) {
      const yy = sy(tv);
      out += `<line x1="${m.left}" y1="${yy.toFixed(1)}" x2="${m.left + pw}" y2="${yy.toFixed(1)}" stroke="${tv === 0 ? "#cbd5e1" : "#edf1f5"}" stroke-width="1"/>`;
      out += `<text x="${m.left - 8}" y="${(yy + 3.5).toFixed(1)}" font-size="10.5" fill="#59636e" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(fmtTick(tv, yTicksObj.step))}</text>`;
    }

    trialLabels.forEach((lbl, idx) => {
      const xx = sx(idx);
      out += `<line x1="${xx.toFixed(1)}" y1="${m.top + ph}" x2="${xx.toFixed(1)}" y2="${m.top + ph + 4}" stroke="#94a3b8" stroke-width="1"/>`;
      out += `<text x="${xx.toFixed(1)}" y="${m.top + ph + 18}" font-size="11" font-weight="600" fill="#59636e" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(lbl)}</text>`;
    });

    out += `<line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;
    out += `<line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="#94a3b8" stroke-width="1"/>`;
    out += `<text transform="rotate(-90)" x="${-(m.top + ph / 2)}" y="16" font-size="11" font-weight="600" fill="#59636e" text-anchor="middle">Peak Response (${esc(ps.unit || "mm")})</text>`;
    out += `<text x="${m.left + pw / 2}" y="${H - 8}" font-size="11" font-weight="600" fill="#59636e" text-anchor="middle">Repeated Stimulus Trials (Trial Habituation Curve)</text>`;

    for (const g of visGroups) {
      const col = getGroupColor(g);
      const pts = hByG[g].trialSeries || [];
      let d = "", open = false;
      pts.forEach((pt, i) => {
        if (!pt || !Number.isFinite(pt.mean)) { open = false; return; }
        d += (open ? " L " : " M ") + `${sx(i).toFixed(1)} ${sy(pt.mean).toFixed(1)}`;
        open = true;
      });
      if (d) out += `<path d="${d.trim()}" fill="none" stroke="${col}" stroke-width="2.2"/>`;
      pts.forEach((pt, i) => {
        if (!pt || !Number.isFinite(pt.mean)) return;
        const xx = sx(i), yy = sy(pt.mean);
        if (ui.tsShowSem && pt.sem > 0) {
          out += `<line x1="${xx.toFixed(1)}" y1="${sy(pt.mean + pt.sem).toFixed(1)}" x2="${xx.toFixed(1)}" y2="${sy(Math.max(yMin, pt.mean - pt.sem)).toFixed(1)}" stroke="${col}" stroke-width="1.5"/>`;
        }
        out += `<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="4.2" fill="${col}" stroke="#ffffff" stroke-width="1.3"/>`;
      });
    }

    svg.innerHTML = out;
    hideTooltip(tt);
  }

  // Tab 2: Phase & Group Comparison + Quick Screening Statistics
  function buildComparisonDataset(viewId) {
    const a = ui.analysis;
    if (!a) return null;
    const activeGroups = (a.groups || []).filter(g => !ui.hiddenGroups.has(g.group) && g.n > 0);
    const usePlates = a.nUnit === "plates" && Array.isArray(a.plateSummaryRows) && a.plateSummaryRows.length > 0;
    const activeWells = usePlates
      ? a.plateSummaryRows.filter(r => !ui.hiddenGroups.has(r.group))
      : (a.wells || []).filter(w => !w.excluded && !ui.hiddenGroups.has(w.group));

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
            if (Number.isFinite(v)) {
              const ptLabel = usePlates
                ? `${w.runId} mean (${w.nWells}w)`
                : (w.runId && ui.runs.length > 1 ? `${w.runId}:${w.well}` : w.well);
              pts.push({ well: w.well, label: ptLabel, value: v });
            }
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
      return buildFromCategories([{ id: "msd", label: "Mean MSD", getWellVal: w => w.meanMsd }], "Mean Pixel Activity (MSD)", "px");
    }

    if (viewId === "vmr") {
      const includeBurst = !(a.capabilities && a.capabilities.hasVmrBurst === false);
      const cats = [
        { id: "light", label: "Light Mean", getWellVal: w => w.vmr && w.vmr.lightMean },
        { id: "dark", label: "Dark Mean", getWellVal: w => w.vmr && w.vmr.darkMean },
        ...(includeBurst ? [{ id: "burst", label: "Dark-Onset Burst", getWellVal: w => w.vmr && w.vmr.darkOnsetBurst }] : [])
      ].filter(c => activeWells.some(w => Number.isFinite(c.getWellVal(w))));
      if (cats.length) return buildFromCategories(cats, "Visual Motor Response (mm / bin)", "mm");
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
        "% PPI (1 - PPI / Pulse Alone)", "%", { value: 0, label: "0% baseline" }
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
      if (cats.length) return buildFromCategories(cats, "Startle Response (mm / bin)", "mm");
    }

    if (viewId === "habituation") {
      return buildFromCategories(
        [{ id: "habit", label: "Trial Habituation Index", getWellVal: w => w.habituation && w.habituation.habituationIndex }],
        "Habituation Index (%)", "%", { value: 0, label: "0% (no change)" }
      );
    }

    if (viewId === "window_auc") {
      const wCfg = a.windowAucConfig || getActiveWindowAucConfig();
      const lbl = wCfg ? `Window AUC (${wCfg.startSec}–${wCfg.endSec}s)` : "Window AUC";
      return buildFromCategories(
        [{ id: "wauc", label: lbl, getWellVal: w => w.windowAuc && w.windowAuc.auc }],
        `${lbl} (mm·s)`, "mm·s"
      );
    }

    if (viewId === "xy_spatial") {
      return buildFromCategories(
        [
          { id: "immob", label: "Immobility %", getWellVal: w => w.xy && w.xy.immobilityPct },
          { id: "center", label: "Center Occupancy %", getWellVal: w => w.xy && w.xy.centerOccupancyPct }
        ],
        "Spatial Occupancy & Immobility (%)", "%", { value: 50, label: "50%" }
      );
    }

    if (viewId === "normalized_ctrl") {
      const ctrlName = (a.pooledMeta && a.pooledMeta.controlGroupName) || "Control";
      return buildFromCategories(
        [{ id: "norm", label: `% of ${ctrlName}`, getWellVal: w => w.normalized && w.normalized.totalDistPctCtrl }],
        `Total Distance (% of ${ctrlName})`, "%", { value: 100, label: "100% Control" }
      );
    }

    if (viewId === "sab") {
      return buildFromCategories(
        [{ id: "sab", label: "Spontaneous Alternation (SAB %)", getWellVal: w => w.zchange && w.zchange.sabPct }],
        "Spontaneous Alternation (%)", "%", { value: 50, label: "50% chance" }
      );
    }

    return buildFromCategories([{ id: "total", label: "Total Distance", getWellVal: w => w.totalDist }], "Total Distance (mm)", "mm");
  }

  function renderComparisonChart() {
    const svg = document.getElementById("compChartSvg");
    const stage = document.getElementById("compChartStage");
    const tt = document.getElementById("compTooltip");
    const summaryStrip = document.getElementById("compSummaryStrip");
    const statsPanel = document.getElementById("compStatsPanel");
    const a = ui.analysis;
    const core = getCore();
    if (!svg || !a) return;

    renderGroupLegend("compLegend", a.groups || []);
    const ds = buildComparisonDataset(ui.compView);

    // Run screening statistics per category when enabled
    const catStats = [];
    const statsOpts = {
      primaryTestFamily: ui.primaryTestFamily || "parametric",
      nUnit: a.nUnit || "wells",
      runCount: a.runCount || 1,
      factorNames: a.factorNames || [],
      flaggedInPlateMeans: (a.pooledMeta && a.pooledMeta.flaggedInPlateMeans) || null
    };
    if (ui.compShowStats && core && core.stats && ds && ds.categories.length && ds.groups.length >= 2) {
      for (const cat of ds.categories) {
        const gData = cat.bars.map(b => ({ group: b.group, values: b.points.map(p => p.value) }));
        const res = core.stats.screenComparisonGroups(gData, statsOpts);
        catStats.push({ catLabel: cat.label, res });
      }
      const firstValid = catStats.find(c => c.res && c.res.valid);
      if (firstValid) {
        const vEntry = (a.comparisonViews || []).find(v => v.id === ui.compView);
        const metricLabel = vEntry
          ? `${vEntry.label}${ds.categories.length > 1 ? ` — ${firstValid.catLabel}` : ""}`
          : firstValid.catLabel;
        ui.lastStatsSnapshot = { metricLabel, result: firstValid.res };
        if (ui.currentPage === "plots" && ui.activeChartTab === "comparison") {
          ui.hasViewedStats = true;
        }
      }
    }

    const singleCat = ds && ds.categories.length === 1;
    // Pick up to 3 significant brackets sorted by span ascending (adjacent pairs below wide spanning pairs)
    const groupIdxMap = new Map((ds ? ds.groups : []).map((g, i) => [typeof g === "string" ? g : g.group, i]));
    const sigBrackets = (singleCat && catStats[0] && catStats[0].res && catStats[0].res.valid)
      ? (catStats[0].res.brackets || [])
          .filter(b => b.sig && b.sig !== "ns")
          .slice(0, 3)
          .sort((a, b) => {
            const spanA = Math.abs((groupIdxMap.get(a.groupB) ?? 0) - (groupIdxMap.get(a.groupA) ?? 0));
            const spanB = Math.abs((groupIdxMap.get(b.groupB) ?? 0) - (groupIdxMap.get(b.groupA) ?? 0));
            return spanA - spanB;
          })
      : [];

    const bracketTopSpace = sigBrackets.length > 0 ? (18 + sigBrackets.length * 20) : 0;
    const W = 880, H = 300 + bracketTopSpace;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const m = { left: 62, right: 24, top: 22 + bracketTopSpace, bottom: 44 };
    const pw = W - m.left - m.right;
    const ph = H - m.top - m.bottom;

    if (!ds || !ds.categories.length || !ds.groups.length) {
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#59636e">No active group data to compare.</text>`;
      if (summaryStrip) summaryStrip.innerHTML = "";
      if (statsPanel) statsPanel.style.display = "none";
      return;
    }

    let yLo = 0, yHi = -Infinity, anyVal = false;
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
    if (ds.refLine) { yHi = Math.max(yHi, ds.refLine.value); yLo = Math.min(yLo, ds.refLine.value); }
    if (!anyVal) {
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#59636e">No measurements available for this comparison view.</text>`;
      if (summaryStrip) summaryStrip.innerHTML = "";
      if (statsPanel) statsPanel.style.display = "none";
      return;
    }

    const span = Math.max(1e-6, yHi - yLo);
    const yTicksObj = niceTicks(yLo - (yLo < 0 ? span * 0.12 : 0), yHi + span * 0.12, 5);
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

    const nCats = ds.categories.length;
    const nGrps = ds.groups.length;
    const catSlotW = pw / Math.max(1, singleCat ? nGrps : nCats);
    let dotsMarkup = "";
    const singleGroupX = {};

    if (singleCat) {
      const cat = ds.categories[0];
      const barW = Math.min(80, Math.max(24, catSlotW * 0.44));
      cat.bars.forEach((bar, gi) => {
        const cx = m.left + (gi + 0.5) * catSlotW;
        singleGroupX[bar.group] = cx;
        const col = getGroupColor(bar.group);
        if (Number.isFinite(bar.mean)) {
          const yVal = sy(bar.mean);
          const yTop = Math.min(zeroY, yVal);
          const bh = Math.max(1, Math.abs(zeroY - yVal));
          out += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${col}" fill-opacity="0.22" stroke="${col}" stroke-width="1.5"/>`;
          if (bar.n > 1 && bar.sem > 0) {
            const eTop = sy(bar.mean + bar.sem), eBot = sy(bar.mean - bar.sem);
            out += `<line x1="${cx.toFixed(1)}" y1="${eTop.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${eBot.toFixed(1)}" stroke="${col}" stroke-width="1.6"/>`;
            out += `<line x1="${(cx - 6).toFixed(1)}" y1="${eTop.toFixed(1)}" x2="${(cx + 6).toFixed(1)}" y2="${eTop.toFixed(1)}" stroke="${col}" stroke-width="1.6"/>`;
            out += `<line x1="${(cx - 6).toFixed(1)}" y1="${eBot.toFixed(1)}" x2="${(cx + 6).toFixed(1)}" y2="${eBot.toFixed(1)}" stroke="${col}" stroke-width="1.6"/>`;
          }
        }
        const jSpan = barW * 0.34;
        for (const pt of bar.points) {
          const dx = cx + deterministicJitter(pt.label || pt.well, jSpan);
          const dy = sy(pt.value);
          dotsMarkup += `<circle class="az-scatter-dot" cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="3.9" fill="${col}" stroke="#ffffff" stroke-width="1.1" style="cursor:pointer;" data-dot-well="${esc(pt.label || pt.well)}" data-dot-group="${esc(bar.group)}" data-dot-cat="${esc(cat.label)}" data-dot-val="${pt.value}" data-dot-unit="${esc(ds.unit)}"/>`;
        }
        const lbl = bar.group.length > 18 ? bar.group.slice(0, 17) + "…" : bar.group;
        out += `<text x="${cx.toFixed(1)}" y="${m.top + ph + 18}" font-size="11.5" font-weight="600" fill="#1f2328" text-anchor="middle">${esc(lbl)}</text>`;
        out += `<text x="${cx.toFixed(1)}" y="${m.top + ph + 32}" font-size="10" fill="#59636e" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">n=${esc(fmtNUnit(bar.n, a))}</text>`;
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
              const eTop = sy(bar.mean + bar.sem), eBot = sy(bar.mean - bar.sem);
              const cap = Math.min(5, barW * 0.28);
              out += `<line x1="${cx.toFixed(1)}" y1="${eTop.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${eBot.toFixed(1)}" stroke="${col}" stroke-width="1.4"/>`;
              out += `<line x1="${(cx - cap).toFixed(1)}" y1="${eTop.toFixed(1)}" x2="${(cx + cap).toFixed(1)}" y2="${eTop.toFixed(1)}" stroke="${col}" stroke-width="1.4"/>`;
              out += `<line x1="${(cx - cap).toFixed(1)}" y1="${eBot.toFixed(1)}" x2="${(cx + cap).toFixed(1)}" y2="${eBot.toFixed(1)}" stroke="${col}" stroke-width="1.4"/>`;
            }
          }
          const jSpan = barW * 0.30;
          for (const pt of bar.points) {
            const dx = cx + deterministicJitter(pt.label || pt.well, jSpan);
            const dy = sy(pt.value);
            dotsMarkup += `<circle class="az-scatter-dot" cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="3.5" fill="${col}" stroke="#ffffff" stroke-width="1" style="cursor:pointer;" data-dot-well="${esc(pt.label || pt.well)}" data-dot-group="${esc(bar.group)}" data-dot-cat="${esc(cat.label)}" data-dot-val="${pt.value}" data-dot-unit="${esc(ds.unit)}"/>`;
          }
        });

        const maxChars = Math.max(6, Math.floor(catSlotW / 7.2));
        const lbl = cat.label.length > maxChars ? cat.label.slice(0, maxChars - 1) + "…" : cat.label;
        out += `<text x="${catCenter.toFixed(1)}" y="${m.top + ph + 20}" font-size="11.5" font-weight="600" fill="#1f2328" text-anchor="middle">${esc(lbl)}</text>`;
      });
    }

    // Stacked non-overlapping significance brackets in reserved top headroom
    let bracketsMarkup = "";
    if (sigBrackets.length > 0) {
      sigBrackets.forEach((br, bi) => {
        const x1 = singleGroupX[br.groupA];
        const x2 = singleGroupX[br.groupB];
        if (!Number.isFinite(x1) || !Number.isFinite(x2)) return;
        const lx = Math.min(x1, x2), rx = Math.max(x1, x2);
        const by = m.top - 8 - bi * 20;
        const tickH = 5;
        bracketsMarkup +=
          `<g class="az-sig-bracket" pointer-events="none">` +
            `<path d="M ${lx.toFixed(1)} ${(by + tickH).toFixed(1)} L ${lx.toFixed(1)} ${by.toFixed(1)} L ${rx.toFixed(1)} ${by.toFixed(1)} L ${rx.toFixed(1)} ${(by + tickH).toFixed(1)}" fill="none" stroke="#1f2328" stroke-width="1.2"/>` +
            `<text x="${((lx + rx) / 2).toFixed(1)}" y="${(by - 3).toFixed(1)}" font-size="11" font-weight="700" fill="#1f2328" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(br.sig)}</text>` +
          `</g>`;
      });
    }

    svg.innerHTML = out + dotsMarkup + refPillMarkup + bracketsMarkup;

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
    });

    // Summary strip
    if (summaryStrip) {
      const cards = ds.groups.map(g => {
        const col = getGroupColor(g.group);
        const nTag = `n=${fmtNUnit(g.n, a)}${a.nUnit === "plates" && g.wellLevelN ? ` (${g.wellLevelN}w)` : ""}`;
        let mainVal = "—", subTxt = `${nTag} active`;
        if (ui.compView === "ppi" && g.startle && g.startle.ppiPct && Number.isFinite(g.startle.ppiPct.mean)) {
          mainVal = `${fmtNum(g.startle.ppiPct.mean, 1)} ± ${fmtNum(g.startle.ppiPct.sem, 1)}%`;
          subTxt = `${nTag} · Pulse ${g.startle.pulseAloneMean ? fmtNum(g.startle.pulseAloneMean.mean, 1) : "—"} vs PPI ${g.startle.ppiTrialMean ? fmtNum(g.startle.ppiTrialMean.mean, 1) : "—"} mm`;
        } else if (ui.compView === "habituation" && g.habituation && g.habituation.habituationIndex && Number.isFinite(g.habituation.habituationIndex.mean)) {
          mainVal = `${fmtNum(g.habituation.habituationIndex.mean, 1)} ± ${fmtNum(g.habituation.habituationIndex.sem, 1)}%`;
          subTxt = `${nTag} · Habituation index`;
        } else if (ui.compView === "window_auc" && g.windowAuc && g.windowAuc.auc && Number.isFinite(g.windowAuc.auc.mean)) {
          mainVal = `${fmtNum(g.windowAuc.auc.mean, 1)} ± ${fmtNum(g.windowAuc.auc.sem, 1)} mm·s`;
          subTxt = `${nTag} · Window mean ${g.windowAuc.mean ? fmtNum(g.windowAuc.mean.mean, 2) : "—"} mm/bin`;
        } else if (ui.compView === "normalized_ctrl" && g.normalized && g.normalized.totalDistPctCtrl && Number.isFinite(g.normalized.totalDistPctCtrl.mean)) {
          mainVal = `${fmtNum(g.normalized.totalDistPctCtrl.mean, 1)} ± ${fmtNum(g.normalized.totalDistPctCtrl.sem, 1)}%`;
          subTxt = `${nTag} · % of ${g.normalized.controlGroup || "Control"}`;
        } else if (ui.compView === "xy_spatial" && g.xy && g.xy.immobilityPct && Number.isFinite(g.xy.immobilityPct.mean)) {
          mainVal = `Immob ${fmtNum(g.xy.immobilityPct.mean, 1)}%`;
          subTxt = `${nTag} · Speed ${g.xy.meanSpeedMmS ? fmtNum(g.xy.meanSpeedMmS.mean, 2) : "—"} mm/s`;
        } else if (ui.compView === "sab" && g.zchange && g.zchange.sabPct && Number.isFinite(g.zchange.sabPct.mean)) {
          mainVal = `${fmtNum(g.zchange.sabPct.mean, 1)} ± ${fmtNum(g.zchange.sabPct.sem, 1)}%`;
          subTxt = `${nTag} · Mean entries ${g.zchange.totalEntries ? fmtNum(g.zchange.totalEntries.mean, 0) : "—"}`;
        } else if (ui.compView === "vmr" && g.vmr && g.vmr.darkMinusLight && Number.isFinite(g.vmr.darkMinusLight.mean)) {
          const sign = g.vmr.darkMinusLight.mean >= 0 ? "+" : "";
          mainVal = `${sign}${fmtNum(g.vmr.darkMinusLight.mean, 2)} mm/bin`;
          subTxt = `${nTag} · Dark − Light VMR Δ`;
        } else if ((ui.compView === "zones" || ui.compView === "thigmotaxis" || ui.compView === "zone_pref") && g.zones && g.zones.z2Pct && Number.isFinite(g.zones.z2Pct.mean)) {
          mainVal = `Z2 ${fmtNum(g.zones.z2Pct.mean, 1)} ± ${fmtNum(g.zones.z2Pct.sem, 1)}%`;
          const pi = g.zones.preferenceIndex && Number.isFinite(g.zones.preferenceIndex.mean) ? fmtNum(g.zones.preferenceIndex.mean, 2) : "—";
          subTxt = `${nTag} · Pref Index ${pi}`;
        } else if (g.totalDist && Number.isFinite(g.totalDist.mean)) {
          mainVal = `${fmtNum(g.totalDist.mean, 1)} ± ${fmtNum(g.totalDist.sem, 1)} mm`;
          subTxt = `${nTag} · Total Dist (${g.excludedCount || 0} excl)`;
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

    renderScreeningStatsPanel(statsPanel, catStats);
  }

  function renderScreeningStatsPanel(panel, catStats) {
    if (!panel) return;
    if (!ui.compShowStats || !catStats.length) {
      panel.style.display = "none";
      panel.innerHTML = "";
      return;
    }

    const firstRes = catStats[0] && catStats[0].res;
    const renderNoticeBanners = (res) => {
      if (!res) return "";
      const items = [];
      if (res.flaggedInPlateMeansNotice) {
        items.push(`<div class="az-stats-notice is-warn"><strong>QC Flagged Wells in Plate Means:</strong> ${esc(res.flaggedInPlateMeansNotice)}</div>`);
      }
      if (res.pseudoreplicationNotice) {
        items.push(`<div class="az-stats-notice"><strong>Unit of Analysis:</strong> ${esc(res.pseudoreplicationNotice)}</div>`);
      }
      if (res.lowReplicateNotice) {
        items.push(`<div class="az-stats-notice"><strong>Low Replicate Count:</strong> ${esc(res.lowReplicateNotice)}</div>`);
      }
      if (res.multiFactorNotice) {
        items.push(`<div class="az-stats-notice is-info"><strong>Multi-Factor Design:</strong> ${esc(res.multiFactorNotice)}</div>`);
      }
      return items.length ? `<div class="az-stats-notices">${items.join("")}</div>` : "";
    };

    const renderStatChip = (row) => {
      const isSig = row.sig && row.sig !== "ns";
      const pStr = fmtPVal(row.p);
      const pDisp = pStr === "—" ? "p = —" : (pStr.startsWith("<") ? `p ${pStr}` : `p = ${pStr}`);
      const mTag = (row.method === "exact" || row.method === "asymptotic")
        ? `<span class="az-method-tag${row.method === "exact" ? " is-exact" : ""}">${esc(row.method)}</span>`
        : "";
      return (
        `<span class="az-stats-chip">` +
          `<span>${esc(row.test)}:</span>` +
          `<code>${esc(row.stat)}</code>` +
          `<code>${esc(pDisp)}</code>` +
          mTag +
          `<span class="az-sig-pill${isSig ? " is-sig" : ""}">${esc(row.sig || "ns")}</span>` +
          `<span style="color:var(--text-muted);">${esc(row.effect || "")}</span>` +
        `</span>`
      );
    };

    const validCats = catStats.filter(c => c.res && c.res.valid);
    if (!validCats.length) {
      const reason = (firstRes && firstRes.reason) || "Need at least 2 groups with n >= 2 included observations to run screening stats.";
      panel.style.display = "";
      panel.innerHTML =
        `<div class="az-stats-title">Quick Screening Statistics</div>` +
        renderNoticeBanners(firstRes) +
        `<div class="az-stats-disclaimer" style="margin-top:4px;">${esc(reason)}</div>`;
      return;
    }

    const famLabel = ui.primaryTestFamily === "nonparametric"
      ? "Primary: Non-Parametric"
      : "Primary: Parametric";
    const unitBadge = (firstRes && firstRes.nUnit === "plates") ? "n = plates" : "n = wells";

    const sections = validCats.map(({ catLabel, res }) => {
      const primaryList = (Array.isArray(res.primaryRows) && res.primaryRows.length) ? res.primaryRows : (res.summaryRows || []);
      const omniHtml = primaryList.map(renderStatChip).join("");

      let pairwiseHtml = "";
      if (res.kind === "multi_group" && Array.isArray(res.pairwise) && res.pairwise.length > 0) {
        const isNonParam = res.primaryTestFamily === "nonparametric";
        if (isNonParam) {
          pairwiseHtml =
            `<div class="az-stats-table-wrap"><table class="az-table"><thead><tr>` +
              `<th>Pairwise Comparison (Mann-Whitney U + Holm)</th><th class="num">U</th><th>Method</th><th class="num">p (raw)</th><th class="num">p (Holm)</th><th class="num">Effect r</th><th>Sig</th>` +
            `</tr></thead><tbody>` +
            res.pairwise.map(pw => {
              const isSig = pw.sig && pw.sig !== "ns";
              const mLbl = pw.method || "—";
              return (
                `<tr>` +
                  `<td><strong>${esc(pw.groupA)}</strong> vs <strong>${esc(pw.groupB)}</strong></td>` +
                  `<td class="num">${esc(fmtStat(pw.U, 1))}</td>` +
                  `<td><span class="az-method-tag${mLbl === "exact" ? " is-exact" : ""}">${esc(mLbl)}</span></td>` +
                  `<td class="num">${esc(fmtPVal(pw.p))}</td>` +
                  `<td class="num"><strong>${esc(fmtPVal(pw.pAdj))}</strong></td>` +
                  `<td class="num">${esc(fmtStat(pw.rEffect, 2))}</td>` +
                  `<td><span class="az-sig-pill${isSig ? " is-sig" : ""}">${esc(pw.sig || "ns")}</span></td>` +
                `</tr>`
              );
            }).join("") +
            `</tbody></table></div>`;
        } else {
          pairwiseHtml =
            `<div class="az-stats-table-wrap"><table class="az-table"><thead><tr>` +
              `<th>Pairwise Comparison (Welch t + Holm)</th><th class="num">Mean Δ</th><th class="num">t (df)</th><th class="num">p (raw)</th><th class="num">p (Holm)</th><th class="num">Cohen's d</th><th>Sig</th>` +
            `</tr></thead><tbody>` +
            res.pairwise.map(pw => {
              const isSig = pw.sig && pw.sig !== "ns";
              const tCell = pw.t !== null && Number.isFinite(pw.t)
                ? `${fmtStat(pw.t, 2)} (${fmtStat(pw.df, 1)})`
                : "—";
              return (
                `<tr>` +
                  `<td><strong>${esc(pw.groupA)}</strong> vs <strong>${esc(pw.groupB)}</strong></td>` +
                  `<td class="num">${esc(fmtStat(pw.meanDiff, 2))}</td>` +
                  `<td class="num">${esc(tCell)}</td>` +
                  `<td class="num">${esc(fmtPVal(pw.p))}</td>` +
                  `<td class="num"><strong>${esc(fmtPVal(pw.pAdj))}</strong></td>` +
                  `<td class="num">${esc(fmtStat(pw.cohensD, 2))}</td>` +
                  `<td><span class="az-sig-pill${isSig ? " is-sig" : ""}">${esc(pw.sig || "ns")}</span></td>` +
                `</tr>`
              );
            }).join("") +
            `</tbody></table></div>`;
        }
      }

      const ccRows = Array.isArray(res.crossCheckRows) ? res.crossCheckRows : [];
      const crossCheckHtml = ccRows.length
        ? `<details class="az-stats-crosscheck">` +
            `<summary>Cross-check alternative test (${esc(ccRows[0].test)})</summary>` +
            `<div class="az-stats-crosscheck-body">${ccRows.map(renderStatChip).join("")}</div>` +
          `</details>`
        : "";

      const heading = validCats.length > 1 ? `<div class="az-stats-head"><span class="az-stats-title">${esc(catLabel)}</span></div>` : "";
      return `${heading}<div class="az-stats-omnibus">${omniHtml}</div>${pairwiseHtml}${crossCheckHtml}`;
    }).join("");

    panel.style.display = "";
    panel.innerHTML =
      `<div class="az-stats-head"><span class="az-stats-title">Quick Screening Statistics (Two-Sided)</span><span class="card-hint">${esc(famLabel)} · ${esc(unitBadge)}</span></div>` +
      renderNoticeBanners(validCats[0].res) +
      sections +
      `<div class="az-stats-disclaimer">Quick screening stats — confirm publication models in Prism / R / Python; equivalent <code>scipy.stats</code> code is included in <code>.py</code> export.</div>`;
  }

  // Tab 3: Zone Events (_ZCHANGE)
  function renderZchangeTab() {
    const emptyEl = document.getElementById("zchangeEmptyHint");
    const contentEl = document.getElementById("zchangeContent");
    const a = ui.analysis;
    if (!emptyEl || !contentEl || !a) return;

    const zs = a.zchangeSummary;
    const hasZ = Boolean(a.capabilities && a.capabilities.hasZchange && zs);
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
        const hc = isDiag && cnt === 0 ? { fill: "#f6f8fa", text: "#8c959f" } : heatColor(cnt / maxCnt);
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
      const wKey = w.wellKey || w.well;
      if (Number.isFinite(val)) {
        const yy = sy(val);
        const bh = Math.max(1, m.top + ph - yy);
        out += `<rect class="az-zc-bar" x="${(cx - barW / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${col}" fill-opacity="0.76" style="cursor:pointer;" data-zc-well="${esc(wKey)}"/>`;
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
        const k = bar.getAttribute("data-zc-well");
        const ws = (a.wellsByKey && a.wellsByKey[k]) || (a.wellsById && a.wellsById[k]);
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

  // Tab 4: Spatial Phenotyping (_XY) Multi-Panel 2D Occupancy Heatmaps
  function renderSpatialTab() {
    const emptyEl = document.getElementById("spatialEmptyHint");
    const contentEl = document.getElementById("spatialContent");
    const a = ui.analysis;
    if (!emptyEl || !contentEl || !a) return;

    const xy = a.xyAnalysis;
    const hasXy = Boolean(a.capabilities && a.capabilities.hasXy && xy && xy.hasXy);
    emptyEl.style.display = hasXy ? "none" : "";
    contentEl.style.display = hasXy ? "" : "none";
    if (!hasXy) return;

    const fpsTxt = Number.isFinite(xy.estimatedFps) ? ` · ~${xy.estimatedFps.toFixed(1)} fps` : "";
    setText("spatialSummaryHint", `${xy.frameCount} frames (${fmtDurationNice(xy.durationSec)})${fpsTxt}`);

    const svg = document.getElementById("spatialHeatmapSvg");
    const strip = document.getElementById("spatialSummaryStrip");
    const groupNames = Object.keys(xy.groupHeatmaps || {});
    const isRound = !(a.layout && a.layout.shape === "SQUARE");

    if (svg) {
      const W = 880, H = 290;
      if (!groupNames.length) {
        svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#59636e">No active wells with _XY coordinates.</text>`;
      } else {
        const nP = groupNames.length;
        const cols = Math.min(4, nP);
        const rows = Math.ceil(nP / cols);
        const padX = 24, padTop = 18, padBot = 34;
        const slotW = (W - padX * 2) / cols;
        const slotH = (H - padTop - padBot) / rows;
        const boxSize = Math.min(slotW - 28, slotH - 36, 175);

        let defs = "<defs>";
        let panels = "";

        groupNames.forEach((gName, idx) => {
          const hm = xy.groupHeatmaps[gName];
          const colIdx = idx % cols;
          const rowIdx = Math.floor(idx / cols);
          const cx = padX + (colIdx + 0.5) * slotW;
          const topY = padTop + rowIdx * slotH + 22;
          const x0 = cx - boxSize / 2;
          const y0 = topY;
          const r = boxSize / 2;
          const clipId = `xyClip_${idx}`;

          if (isRound) {
            defs += `<clipPath id="${clipId}"><circle cx="${cx.toFixed(1)}" cy="${(y0 + r).toFixed(1)}" r="${r.toFixed(1)}"/></clipPath>`;
          } else {
            defs += `<clipPath id="${clipId}"><rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${boxSize.toFixed(1)}" height="${boxSize.toFixed(1)}" rx="6"/></clipPath>`;
          }

          const gCol = getGroupColor(gName);
          const shortName = gName.length > 20 ? gName.slice(0, 19) + "…" : gName;
          const fullTitle = `${shortName} (n=${hm.n})`;
          const dotX = Math.max(padX + 6, cx - (fullTitle.length * 3.35) - 7);
          panels += `<circle cx="${dotX.toFixed(1)}" cy="${(y0 - 10.5).toFixed(1)}" r="4" fill="${gCol}"/>`;
          panels += `<text x="${(cx + 5).toFixed(1)}" y="${(y0 - 7).toFixed(1)}" font-size="11" font-weight="600" fill="#1f2328" text-anchor="middle">${esc(fullTitle)}</text>`;

          // Render 24x24 occupancy grid cells
          const gSize = hm.size || 24;
          const cell = boxSize / gSize;
          const maxV = Math.max(1e-6, hm.maxVal || 1);
          let cells = "";
          for (let gy = 0; gy < gSize; gy++) {
            const row = hm.grid[gy] || [];
            for (let gx = 0; gx < gSize; gx++) {
              const val = row[gx] || 0;
              if (val <= 0) continue;
              const fill = spatialHeatColor(Math.pow(val / maxV, 0.72));
              cells += `<rect x="${(x0 + gx * cell).toFixed(1)}" y="${(y0 + gy * cell).toFixed(1)}" width="${(cell + 0.4).toFixed(1)}" height="${(cell + 0.4).toFixed(1)}" fill="${fill}"/>`;
            }
          }

          if (isRound) {
            panels += `<circle cx="${cx.toFixed(1)}" cy="${(y0 + r).toFixed(1)}" r="${r.toFixed(1)}" fill="#f8fafc"/>`;
            panels += `<g clip-path="url(#${clipId})">${cells}</g>`;
            // Inner 50%-area concentric circle (r * 0.707)
            panels += `<circle cx="${cx.toFixed(1)}" cy="${(y0 + r).toFixed(1)}" r="${(r * Math.SQRT1_2).toFixed(1)}" fill="none" stroke="rgba(31,35,40,0.45)" stroke-width="1" stroke-dasharray="3,3"/>`;
            panels += `<circle cx="${cx.toFixed(1)}" cy="${(y0 + r).toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${gCol}" stroke-width="1.6"/>`;
          } else {
            panels += `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${boxSize.toFixed(1)}" height="${boxSize.toFixed(1)}" rx="6" fill="#f8fafc"/>`;
            panels += `<g clip-path="url(#${clipId})">${cells}</g>`;
            const inS = boxSize * Math.SQRT1_2;
            panels += `<rect x="${(cx - inS / 2).toFixed(1)}" y="${(y0 + (boxSize - inS) / 2).toFixed(1)}" width="${inS.toFixed(1)}" height="${inS.toFixed(1)}" fill="none" stroke="rgba(31,35,40,0.45)" stroke-width="1" stroke-dasharray="3,3"/>`;
            panels += `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${boxSize.toFixed(1)}" height="${boxSize.toFixed(1)}" rx="6" fill="none" stroke="${gCol}" stroke-width="1.6"/>`;
          }
        });

        // Colorbar legend at bottom
        defs +=
          `<linearGradient id="xyScaleGrad" x1="0%" y1="0%" x2="100%" y2="0%">` +
            `<stop offset="0%" stop-color="#f1f5f9"/>` +
            `<stop offset="25%" stop-color="#93c5fd"/>` +
            `<stop offset="52%" stop-color="#2563eb"/>` +
            `<stop offset="78%" stop-color="#f59e0b"/>` +
            `<stop offset="100%" stop-color="#dc2626"/>` +
          `</linearGradient></defs>`;

        const barW = 200, barX = (W - barW) / 2, barY = H - 20;
        const legend =
          `<text x="${(barX - 8).toFixed(1)}" y="${(barY + 8).toFixed(1)}" font-size="10" fill="#59636e" text-anchor="end">Low occupancy</text>` +
          `<rect x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barW}" height="9" rx="4" fill="url(#xyScaleGrad)" stroke="#d0d7de" stroke-width="0.7"/>` +
          `<text x="${(barX + barW + 8).toFixed(1)}" y="${(barY + 8).toFixed(1)}" font-size="10" fill="#59636e" text-anchor="start">High occupancy · dashed = inner 50% area</text>`;

        svg.innerHTML = defs + panels + legend;
      }
    }

    if (strip) {
      const grpStats = xy.groups || {};
      strip.innerHTML = groupNames.map(gName => {
        const gs = grpStats[gName];
        if (!gs) return "";
        const col = getGroupColor(gName);
        return (
          `<div class="az-stat-mini">` +
            `<div class="az-stat-mini-head"><span class="az-swatch-dot" style="background:${col};"></span><span>${esc(gName)} (n=${gs.n} ${gs.n === 1 ? "well" : "wells"})</span></div>` +
            `<div class="az-stat-mini-val">Immob ${fmtNum(gs.immobilityPct && gs.immobilityPct.mean, 1)}% · Center ${fmtNum(gs.centerOccupancyPct && gs.centerOccupancyPct.mean, 1)}%</div>` +
            `<div class="az-stat-mini-sub">Speed ${fmtNum(gs.meanSpeedMmS && gs.meanSpeedMmS.mean, 2)} mm/s · Burst P95 ${fmtNum(gs.burstSpeedP95MmS && gs.burstSpeedP95MmS.mean, 1)} mm/s</div>` +
          `</div>`
        );
      }).join("");
    }
  }

  // ---------------------------------------------------------------------------
  // 11. Step 5: Audit Summary Pill & Per-Well Summary Table
  // ---------------------------------------------------------------------------
  function renderExportAuditSummary() {
    const el = document.getElementById("cleaningLogAuditSummary");
    if (!el || !ui.analysis) return;
    let autoEx = 0, manEx = 0, postStats = 0;
    const targetRuns = (ui.runs.length > 1 && ui.scope === "pooled") ? ui.runs : (getActiveRun() ? [getActiveRun()] : []);
    for (const r of targetRuns) {
      for (const w of r.excludedWells) {
        const meta = r.excludeMeta && r.excludeMeta[w];
        if (meta && meta.source === "auto") autoEx++;
        else manEx++;
        if (meta && meta.afterStatsViewed) postStats++;
      }
    }
    const postPart = postStats > 0 ? ` · ${postStats} post-stats` : "";
    el.className = postStats > 0 ? "badge-warn" : "badge-custom";
    el.textContent = `${targetRuns.length} run${targetRuns.length === 1 ? "" : "s"} · ${autoEx} auto-excl · ${manEx} manual-excl${postPart} · UTF-8 BOM`;
  }

  function updateWellTableScrollHint() {
    const hint = document.getElementById("wellTableScrollHint");
    const tbl = document.getElementById("wellSummaryTable");
    const wrap = tbl && tbl.closest ? tbl.closest(".az-table-wrap") : null;
    if (!hint || !wrap) return;
    requestAnimationFrame(() => {
      hint.style.display = wrap.scrollWidth > wrap.clientWidth + 4 ? "" : "none";
    });
  }

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
    const isPooledMulti = ui.runs.length > 1 && a.scope === "pooled";
    const fNames = a.factorNames || [];

    const cols = [{ key: "exclude", label: "Excl.", sortable: false, num: false }];
    if (isPooledMulti) cols.push({ key: "runId", label: "Run", sortable: true, num: false });
    cols.push({ key: "well", label: "Well", sortable: true, num: false });
    cols.push({ key: "group", label: "Group", sortable: true, num: false });
    for (const fn of fNames) cols.push({ key: `factor:${fn}`, label: fn, sortable: true, num: false });
    cols.push({ key: "qc", label: "QC", sortable: false, num: false });
    cols.push({ key: "qcReason", label: "QC Reason", sortable: false, num: false });
    cols.push({ key: "totalDist", label: "Total Dist (mm)", sortable: true, num: true });
    cols.push({ key: "meanDist", label: "Mean / Bin", sortable: true, num: true });

    if (ui.normalizeToControl && a.wells.some(w => w.normalized && w.normalized.totalDistPctCtrl !== null)) {
      cols.push({ key: "normPct", label: "% Ctrl", sortable: true, num: true });
    }
    if (caps.hasMsd) cols.push({ key: "meanMsd", label: "Mean MSD", sortable: true, num: true });
    if (caps.hasZones) {
      cols.push({ key: "z1Pct", label: "Z1 %", sortable: true, num: true });
      cols.push({ key: "z2Pct", label: "Z2 %", sortable: true, num: true });
      if ((caps.maxZone || 2) === 2) cols.push({ key: "prefIdx", label: "Pref Idx", sortable: true, num: true });
    }
    if (caps.hasVmr) cols.push({ key: "vmrDelta", label: "VMR Δ", sortable: true, num: true });
    if (caps.hasPpi) cols.push({ key: "ppiPct", label: "% PPI", sortable: true, num: true });
    if (caps.hasHabituation) cols.push({ key: "habitIdx", label: "Habit %", sortable: true, num: true });
    if (caps.hasWindowAuc) cols.push({ key: "winAuc", label: "Win AUC", sortable: true, num: true });
    if (caps.hasXy) cols.push({ key: "immobPct", label: "Immob %", sortable: true, num: true });
    if (caps.hasZchange) {
      cols.push({ key: "transitions", label: "Entries", sortable: true, num: true });
      if (caps.hasSab) cols.push({ key: "sabPct", label: "SAB %", sortable: true, num: true });
    }

    const thead = document.getElementById("wellTableHead");
    if (thead) {
      thead.innerHTML = "<tr>" + cols.map(c => {
        const isSorted = c.sortable && ui.tableSortKey === c.key;
        const cls = [
          c.num ? "num" : "",
          c.sortable ? "sortable" : "",
          isSorted ? "is-sorted" : "",
          c.key === "qcReason" ? "az-col-qcreason" : ""
        ].filter(Boolean).join(" ");
        const indHtml = c.sortable
          ? `<span class="sort-ind" aria-hidden="true">${isSorted ? (ui.tableSortDir > 0 ? "▲" : "▼") : "▲"}</span>`
          : "";
        return `<th class="${cls}"${c.sortable ? ` data-sort-key="${esc(c.key)}"` : ""}>${esc(c.label)}${indHtml}</th>`;
      }).join("") + "</tr>";

      thead.querySelectorAll("[data-sort-key]").forEach(th => {
        th.addEventListener("click", () => {
          const k = th.getAttribute("data-sort-key");
          if (ui.tableSortKey === k) ui.tableSortDir *= -1;
          else { ui.tableSortKey = k; ui.tableSortDir = (k === "well" || k === "group" || k === "runId" || k.startsWith("factor:")) ? 1 : -1; }
          renderWellTable();
        });
      });
    }

    const getSortVal = (w, key) => {
      if (key.startsWith("factor:")) return (w.factors && w.factors[key.slice(7)]) || "";
      switch (key) {
        case "runId": return w.runId || "";
        case "well": return w.well;
        case "group": return w.group || UNASSIGNED;
        case "totalDist": return w.totalDist ?? -Infinity;
        case "meanDist": return w.meanDist ?? -Infinity;
        case "normPct": return (w.normalized && w.normalized.totalDistPctCtrl) ?? -Infinity;
        case "meanMsd": return w.meanMsd ?? -Infinity;
        case "z1Pct": return (w.zones && w.zones.z1Pct) ?? -Infinity;
        case "z2Pct": return (w.zones && w.zones.z2Pct) ?? -Infinity;
        case "prefIdx": return (w.zones && w.zones.preferenceIndex) ?? -Infinity;
        case "vmrDelta": return (w.vmr && w.vmr.darkMinusLight) ?? -Infinity;
        case "ppiPct": return (w.startle && w.startle.ppiPct) ?? -Infinity;
        case "habitIdx": return (w.habituation && w.habituation.habituationIndex) ?? -Infinity;
        case "winAuc": return (w.windowAuc && w.windowAuc.auc) ?? -Infinity;
        case "immobPct": return (w.xy && w.xy.immobilityPct) ?? -Infinity;
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
    const unionGroups = collectUnionGroupOrder();
    const allGroupChoices = [...unionGroups, UNASSIGNED];

    tbody.innerHTML = list.map(w => {
      const g = w.group || UNASSIGNED;
      const gCol = getGroupColor(g);
      const selVal = allGroupChoices.includes(g) ? g : UNASSIGNED;
      const runAttr = w.runId ? ` data-row-run="${esc(w.runId)}"` : "";
      const groupSelHtml = allGroupChoices.length > 1
        ? `<select class="az-select az-table-grp-sel" data-row-group="${esc(w.well)}"${runAttr} aria-label="Group for ${esc(w.well)}">` +
            allGroupChoices.map(gn => `<option value="${esc(gn)}"${gn === selVal ? " selected" : ""}>${esc(gn)}</option>`).join("") +
          `</select>`
        : `<span class="az-group-tag" style="background:${hexToRgba(gCol, 0.14)};color:${gCol};"><span class="az-swatch-dot" style="background:${gCol};"></span>${esc(g)}</span>`;

      let cells = `<td><input type="checkbox" class="az-chk" data-row-excl="${esc(w.well)}"${runAttr} aria-label="Exclude ${esc(w.well)}"${w.excluded ? " checked" : ""}></td>`;
      if (isPooledMulti) cells += `<td><span class="az-reason-code">${esc(w.runId || "")}</span></td>`;
      cells += `<td class="az-well-id-cell">${esc(w.well)}</td><td>${groupSelHtml}</td>`;
      for (const fn of fNames) {
        const fv = (w.factors && w.factors[fn]) || "—";
        cells += `<td>${esc(fv)}</td>`;
      }
      const qReason = w.qcReason || (w.qc && w.qc.qcReason) || "ok";
      const postTag = w.afterStatsViewed ? `<span class="az-poststats-badge">After stats</span>` : "";
      cells += `<td>${buildQcPillsHtml(w)}</td><td class="az-col-qcreason"><span class="az-reason-code">${esc(qReason)}</span>${postTag}</td>`;
      cells += `<td class="num">${fmtNum(w.totalDist, 1)}</td><td class="num">${fmtNum(w.meanDist, 2)}</td>`;
      if (ui.normalizeToControl && a.wells.some(x => x.normalized && x.normalized.totalDistPctCtrl !== null)) {
        cells += `<td class="num">${w.normalized && Number.isFinite(w.normalized.totalDistPctCtrl) ? fmtNum(w.normalized.totalDistPctCtrl, 1) + "%" : "—"}</td>`;
      }
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
      if (caps.hasHabituation) cells += `<td class="num">${w.habituation && Number.isFinite(w.habituation.habituationIndex) ? fmtNum(w.habituation.habituationIndex, 1) + "%" : "—"}</td>`;
      if (caps.hasWindowAuc) cells += `<td class="num">${w.windowAuc && Number.isFinite(w.windowAuc.auc) ? fmtNum(w.windowAuc.auc, 1) : "—"}</td>`;
      if (caps.hasXy) cells += `<td class="num">${w.xy && Number.isFinite(w.xy.immobilityPct) ? fmtNum(w.xy.immobilityPct, 1) + "%" : "—"}</td>`;
      if (caps.hasZchange) {
        cells += `<td class="num">${w.zchange && Number.isFinite(w.zchange.totalEntries) ? w.zchange.totalEntries : "—"}</td>`;
        if (caps.hasSab) cells += `<td class="num">${w.zchange && Number.isFinite(w.zchange.sabPct) ? fmtNum(w.zchange.sabPct, 1) + "%" : "—"}</td>`;
      }
      return `<tr class="${w.excluded ? "is-excluded" : ""}" data-well-row="${esc(w.well)}">${cells}</tr>`;
    }).join("");

    tbody.querySelectorAll("[data-row-excl]").forEach(chk => {
      chk.addEventListener("change", () => {
        const well = chk.getAttribute("data-row-excl");
        const targetRun = getRunByIdOrLabel(chk.getAttribute("data-row-run"));
        setWellExcluded(targetRun, well, chk.checked, "manual", "manual_exclude");
        recomputeAndRender();
      });
    });

    tbody.querySelectorAll("[data-row-group]").forEach(sel => {
      sel.addEventListener("change", () => {
        const well = sel.getAttribute("data-row-group");
        const targetRun = getRunByIdOrLabel(sel.getAttribute("data-row-run"));
        if (!targetRun) return;
        if (!sel.value || sel.value === UNASSIGNED || sel.value === ALL_WELLS) delete targetRun.groups[well];
        else {
          targetRun.groups[well] = sel.value;
          if (!targetRun.groupOrder.includes(sel.value)) targetRun.groupOrder.push(sel.value);
        }
        recomputeAndRender();
      });
    });

    updateWellTableScrollHint();
  }

  // ---------------------------------------------------------------------------
  // 12. Group Brush, Multi-Factor Layers & Multi-Run Actions
  // ---------------------------------------------------------------------------
  function addFactorLayer(rawName, defaultLevels) {
    const run = getActiveRun();
    if (!run) return;
    const clean = String(rawName || "").trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
    if (!clean) return;
    if (!run.factorNames.includes(clean)) {
      run.factorNames.push(clean);
      run.wellFactors[clean] = {};
      run.factorLevelOrder[clean] = Array.isArray(defaultLevels) && defaultLevels.length
        ? defaultLevels.slice()
        : [`${clean}_A`, `${clean}_B`];
    }
    ui.activeFactorLayer = clean;
    ui.activeBrushFactorVal = run.factorLevelOrder[clean][0] || UNASSIGNED;
    ui.brushTool = "group";
    recomputeAndRender();
  }

  function removeFactorLayer(fn) {
    const run = getActiveRun();
    if (!run) return;
    run.factorNames = run.factorNames.filter(x => x !== fn);
    delete run.wellFactors[fn];
    delete run.factorLevelOrder[fn];
    if (ui.activeFactorLayer === fn) ui.activeFactorLayer = PRIMARY_LAYER;
    recomputeAndRender();
  }

  function applyFactorPreset(pairs) {
    const run = getActiveRun();
    if (!run) return;
    for (const [fn, lvls] of pairs) {
      if (!run.factorNames.includes(fn)) {
        run.factorNames.push(fn);
        run.wellFactors[fn] = {};
        run.factorLevelOrder[fn] = lvls.slice();
      }
    }
    const firstFn = pairs[0][0];
    ui.activeFactorLayer = firstFn;
    ui.activeBrushFactorVal = (run.factorLevelOrder[firstFn] && run.factorLevelOrder[firstFn][0]) || UNASSIGNED;
    ui.brushTool = "group";
    recomputeAndRender();
    toast(`Added factors: ${pairs.map(p => p[0]).join(" × ")}`);
  }

  function combineFactorsIntoGroups() {
    const core = getCore();
    const run = getActiveRun();
    if (!core || !run || !run.factorNames.length) return;
    const res = core.synthesizeGroupsFromFactors(run.summaryParsed.wells, run.factorNames, run.wellFactors);
    if (!res || !res.groupOrder.length) {
      toast("Paint at least one factor level onto the plate first.");
      return;
    }
    run.groups = { ...res.groups };
    const reg = buildGroupRegistryForRun(run.groups, res.groupOrder, run.groupColors);
    run.groupOrder = reg.groupOrder;
    run.groupColors = reg.groupColors;
    ui.activeFactorLayer = PRIMARY_LAYER;
    ui.activeBrushGroup = run.groupOrder[0] || UNASSIGNED;
    ui.brushTool = "group";
    recomputeAndRender();
    toast(`Combined ${run.factorNames.join(" × ")} into ${run.groupOrder.length} groups`);
  }

  function copyActiveMapToAllRuns() {
    const src = getActiveRun();
    if (!src || ui.runs.length < 2) return;
    let copied = 0;
    let trimmedAny = false;
    for (const r of ui.runs) {
      if (r.id === src.id) continue;
      const validWells = (r.summaryParsed && Array.isArray(r.summaryParsed.wells))
        ? new Set(r.summaryParsed.wells)
        : null;
      const keepWell = (w) => !validWells || validWells.has(w);

      const nextGroups = {};
      for (const [w, g] of Object.entries(src.groups || {})) {
        if (keepWell(w)) nextGroups[w] = g;
        else trimmedAny = true;
      }
      r.groups = nextGroups;
      const reg = buildGroupRegistryForRun(nextGroups, src.groupOrder, src.groupColors);
      r.groupOrder = reg.groupOrder;
      r.groupColors = reg.groupColors;

      r.factorNames = [...src.factorNames];
      r.wellFactors = {};
      for (const fn of r.factorNames) {
        const fSrc = (src.wellFactors && src.wellFactors[fn]) || {};
        const fDst = {};
        for (const [w, v] of Object.entries(fSrc)) {
          if (keepWell(w)) fDst[w] = v;
          else trimmedAny = true;
        }
        r.wellFactors[fn] = fDst;
      }
      r.factorLevelOrder = buildFactorLevelOrder(r.factorNames, r.wellFactors);
      copied++;
    }
    recomputeAndRender();
    const extra = trimmedAny ? " (filtered to matching wells)" : "";
    toast(`Copied group & factor map from ${src.runId} to ${copied} other run${copied === 1 ? "" : "s"}${extra}`);
  }

  function addNewGroupOrLevel() {
    const run = getActiveRun();
    if (!run) return;
    if (ui.activeFactorLayer !== PRIMARY_LAYER && run.factorNames.includes(ui.activeFactorLayer)) {
      const fn = ui.activeFactorLayer;
      const list = run.factorLevelOrder[fn] || (run.factorLevelOrder[fn] = []);
      let idx = list.length + 1;
      let name = `${fn}_${idx}`;
      while (list.includes(name)) { idx++; name = `${fn}_${idx}`; }
      list.push(name);
      ui.activeBrushFactorVal = name;
      ui.brushTool = "group";
    } else {
      let idx = run.groupOrder.length + 1;
      let name = `Group ${idx}`;
      while (run.groupOrder.includes(name)) { idx++; name = `Group ${idx}`; }
      run.groupOrder.push(name);
      getGroupColor(name);
      ui.activeBrushGroup = name;
      ui.brushTool = "group";
    }
    renderPlateControls();
    const inp = document.getElementById("activeGroupNameInput");
    if (inp) { inp.focus(); inp.select(); }
  }

  function renameActiveGroupOrLevel(rawNewName) {
    const run = getActiveRun();
    if (!run) return;
    const nextName = String(rawNewName || "").trim().slice(0, 32);
    if (!nextName || nextName === UNASSIGNED || nextName === ALL_WELLS) return;

    if (ui.activeFactorLayer !== PRIMARY_LAYER && run.factorNames.includes(ui.activeFactorLayer)) {
      const fn = ui.activeFactorLayer;
      const oldName = ui.activeBrushFactorVal;
      if (!oldName || oldName === UNASSIGNED || nextName === oldName) return;
      const list = run.factorLevelOrder[fn] || [];
      if (list.includes(nextName)) { toast(`Level "${nextName}" already exists`); renderPlateControls(); return; }
      const idx = list.indexOf(oldName);
      if (idx >= 0) list[idx] = nextName;
      const fMap = run.wellFactors[fn] || {};
      for (const w of Object.keys(fMap)) { if (fMap[w] === oldName) fMap[w] = nextName; }
      ui.activeBrushFactorVal = nextName;
      recomputeAndRender();
      return;
    }

    const oldName = ui.activeBrushGroup;
    if (!oldName || oldName === UNASSIGNED || nextName === oldName) return;
    if (run.groupOrder.includes(nextName)) { toast(`Group "${nextName}" already exists`); renderPlateControls(); return; }
    const idx = run.groupOrder.indexOf(oldName);
    if (idx >= 0) run.groupOrder[idx] = nextName;
    run.groupColors[nextName] = run.groupColors[oldName] || getGroupColor(oldName);
    delete run.groupColors[oldName];
    for (const w of Object.keys(run.groups)) { if (run.groups[w] === oldName) run.groups[w] = nextName; }
    if (ui.hiddenGroups.has(oldName)) { ui.hiddenGroups.delete(oldName); ui.hiddenGroups.add(nextName); }
    if (ui.controlGroupName === oldName) ui.controlGroupName = nextName;
    ui.activeBrushGroup = nextName;
    recomputeAndRender();
  }

  function deleteActiveGroupOrLevel() {
    const run = getActiveRun();
    if (!run) return;
    if (ui.activeFactorLayer !== PRIMARY_LAYER && run.factorNames.includes(ui.activeFactorLayer)) {
      const fn = ui.activeFactorLayer;
      const target = ui.activeBrushFactorVal;
      if (!target || target === UNASSIGNED) return;
      run.factorLevelOrder[fn] = (run.factorLevelOrder[fn] || []).filter(v => v !== target);
      const fMap = run.wellFactors[fn] || {};
      for (const w of Object.keys(fMap)) { if (fMap[w] === target) delete fMap[w]; }
      ui.activeBrushFactorVal = run.factorLevelOrder[fn][0] || UNASSIGNED;
      recomputeAndRender();
      return;
    }

    const target = ui.activeBrushGroup;
    if (!target || target === UNASSIGNED) return;
    run.groupOrder = run.groupOrder.filter(g => g !== target);
    delete run.groupColors[target];
    ui.hiddenGroups.delete(target);
    if (ui.controlGroupName === target) ui.controlGroupName = "";
    for (const w of Object.keys(run.groups)) { if (run.groups[w] === target) delete run.groups[w]; }
    ui.activeBrushGroup = run.groupOrder.length ? run.groupOrder[0] : UNASSIGNED;
    recomputeAndRender();
  }

  function autoAssignGroupsOrLevels(axis) {
    const run = getActiveRun();
    const a = getActiveRunAnalysis();
    if (!run || !a || !a.layout) return;

    const isFactor = ui.activeFactorLayer !== PRIMARY_LAYER && run.factorNames.includes(ui.activeFactorLayer);
    let levels;
    if (isFactor) {
      const fn = ui.activeFactorLayer;
      if (!run.factorLevelOrder[fn] || !run.factorLevelOrder[fn].length) {
        run.factorLevelOrder[fn] = [`${fn}_A`, `${fn}_B`];
      }
      levels = run.factorLevelOrder[fn];
    } else {
      if (run.groupOrder.length === 0) {
        run.groupOrder = ["Group 1", "Group 2", "Group 3"];
        run.groupOrder.forEach(getGroupColor);
        ui.activeBrushGroup = run.groupOrder[0];
      }
      levels = run.groupOrder;
    }

    const nLvls = levels.length;
    const coords = a.layout.wellCoords || {};
    const wells = run.summaryParsed.wells;
    const quantize = (v) => Math.round((Number(v) || 0) / 4) * 4;
    const useGeom = Boolean(a.layout.isMaze);
    const getPos = (w, i) => {
      const wc = coords[w];
      if (!wc) return axis === "row" ? Math.floor(i / 6) : (i % 6);
      if (useGeom) return axis === "row" ? quantize(wc.y) : quantize(wc.x);
      return axis === "row" ? wc.row : wc.col;
    };

    const distinctVals = [...new Set(wells.map((w, i) => getPos(w, i)))].sort((a, b) => a - b);
    const targetMap = isFactor ? (run.wellFactors[ui.activeFactorLayer] || (run.wellFactors[ui.activeFactorLayer] = {})) : run.groups;
    wells.forEach((w, i) => {
      const idx = distinctVals.indexOf(getPos(w, i));
      const gIdx = Math.min(nLvls - 1, Math.floor((Math.max(0, idx) * nLvls) / Math.max(1, distinctVals.length)));
      targetMap[w] = levels[gIdx];
    });
    recomputeAndRender();
    toast(`Filled ${nLvls} ${isFactor ? ui.activeFactorLayer + " levels" : "groups"} by ${axis}`);
  }

  function excludeAllFlaggedWells() {
    const a = getActiveRunAnalysis();
    const run = getActiveRun();
    if (!a || !run) return;
    let added = 0;
    for (const w of (a.wells || [])) {
      if (w.qc && (w.qc.isEmpty || w.qc.isSpikeGlitch) && !run.excludedWells.has(w.well)) {
        setWellExcluded(run, w.well, true, "auto", w.qc.qcReason || "qc_flagged");
        added++;
      }
    }
    if (added > 0) {
      recomputeAndRender();
      toast(`Excluded ${added} QC-flagged well${added === 1 ? "" : "s"} on ${run.runId}`);
    } else {
      toast("No remaining flagged wells to exclude on this run");
    }
  }

  function excludeFlaggedAcrossAllRuns() {
    if (!ui.analysis || !Array.isArray(ui.analysis.runAnalyses)) {
      excludeAllFlaggedWells();
      return;
    }
    let added = 0;
    for (const item of ui.analysis.runAnalyses) {
      const r = getRunByIdOrLabel(item.id);
      if (!r || !item.analysis) continue;
      for (const w of (item.analysis.wells || [])) {
        if (w.qc && (w.qc.isEmpty || w.qc.isSpikeGlitch) && !r.excludedWells.has(w.well)) {
          setWellExcluded(r, w.well, true, "auto", w.qc.qcReason || "qc_flagged");
          added++;
        }
      }
    }
    if (added > 0) {
      recomputeAndRender();
      toast(`Auto-excluded ${added} QC-flagged well${added === 1 ? "" : "s"} across ${ui.runs.length} runs`);
    } else {
      toast("No remaining flagged wells across any run");
    }
  }

  function triggerPrismExport() {
    const core = getCore();
    if (!core || !ui.analysis) return;
    const csv = typeof core.exportPrismGroupedCsv === "function"
      ? core.exportPrismGroupedCsv(buildExportPayload(), ui.prismMetric, { includeBom: true })
      : core.buildPrismGroupedCsv(ui.analysis, ui.prismMetric);
    downloadTextFile(csv, `${getExportBasename()}_prism_${ui.prismMetric}.csv`, "text/csv;charset=utf-8");
    toast("Downloaded Prism Grouped CSV (UTF-8 BOM)");
  }

  // ---------------------------------------------------------------------------
  // 13. Event Binding & Initialization
  // ---------------------------------------------------------------------------
  function bindEvents() {
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
        if (idx < ANALYZER_PAGES.length - 1) goToPage(ANALYZER_PAGES[idx + 1].id);
        else triggerPrismExport();
      });
    }

    window.addEventListener("hashchange", () => {
      const id = location.hash.slice(1);
      if (pageIndexOf(id) >= 0) goToPage(id);
    });

    // Topbar & Sidebar actions
    const demoSel = document.getElementById("demoPresetSelect");
    if (demoSel) demoSel.addEventListener("change", () => { if (demoSel.value) loadDemoDataset(demoSel.value); });

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
        const run = getActiveRun();
        if (run) { run.context = null; run.contextFilename = ""; }
        ui.pendingContext = null;
        ui.pendingContextFilename = "";
        syncLegacyStateAliases();
        if (ui.runs.length) recomputeAndRender();
        else renderAll();
        toast("Detached Builder context");
      });
    }

    document.querySelectorAll("[data-demo]").forEach(btn => {
      btn.addEventListener("click", () => loadDemoDataset(btn.getAttribute("data-demo")));
    });

    const loadYmazeBtn = document.getElementById("loadYmazeDemoFromTabBtn");
    if (loadYmazeBtn) loadYmazeBtn.addEventListener("click", () => { ui.activeChartTab = "zchange"; loadDemoDataset("ymaze_15"); });
    const loadSpatialBtn = document.getElementById("loadMultiDemoFromSpatialBtn");
    if (loadSpatialBtn) loadSpatialBtn.addEventListener("click", () => { ui.activeChartTab = "spatial"; loadDemoDataset("ld_multi_2p"); });

    // File dropzone & pickers
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("analyzerFileInput");
    const addRunInput = document.getElementById("addRunFileInput");
    const browseBtn = document.getElementById("browseFilesBtn");
    const addRunBtn = document.getElementById("addRunCsvBtn");

    if (browseBtn && fileInput) {
      browseBtn.addEventListener("click", (e) => { e.stopPropagation(); fileInput.value = ""; fileInput.click(); });
    }
    if (addRunBtn && addRunInput) {
      addRunBtn.addEventListener("click", (e) => { e.stopPropagation(); addRunInput.value = ""; addRunInput.click(); });
      addRunInput.addEventListener("change", () => {
        if (addRunInput.files && addRunInput.files.length) handleIncomingFiles(addRunInput.files, { appendMode: true });
      });
    }
    if (dropZone && fileInput) {
      dropZone.addEventListener("click", () => { fileInput.value = ""; fileInput.click(); });
      dropZone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.value = ""; fileInput.click(); }
      });
      dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("is-dragover"); });
      dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragover"));
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("is-dragover");
        if (e.dataTransfer && e.dataTransfer.files) handleIncomingFiles(e.dataTransfer.files);
      });
    }
    if (fileInput) {
      fileInput.addEventListener("change", () => {
        if (fileInput.files && fileInput.files.length) handleIncomingFiles(fileInput.files);
      });
    }

    // Step 2: QC Thresholds & Trim Window controls
    const orgSel = document.getElementById("qcOrganismPresetSel");
    if (orgSel) {
      orgSel.addEventListener("change", () => {
        const core = getCore();
        if (!core || orgSel.value === "custom") return;
        ui.qcThresholds = core.normalizeQcThresholds(orgSel.value, ui.context);
        recomputeAndRender();
      });
    }

    const resetThBtn = document.getElementById("qcResetThresholdsBtn");
    if (resetThBtn) {
      resetThBtn.addEventListener("click", () => {
        const core = getCore();
        if (!core) return;
        const pid = (ui.context && ui.context.organismId) ? ui.context.organismId : "default";
        ui.qcThresholds = core.normalizeQcThresholds(pid, ui.context);
        ui.trimWindow = { trimStartSec: 0, trimEndSec: null };
        recomputeAndRender();
        toast("Reset QC thresholds & trim window");
      });
    }

    const readQcInputs = () => {
      const core = getCore();
      if (!core) return;
      const cur = ui.qcThresholds || core.normalizeQcThresholds("default", ui.context);
      const valNum = (id, fb) => {
        const el = document.getElementById(id);
        const v = el ? parseFloat(el.value) : NaN;
        return Number.isFinite(v) ? v : fb;
      };
      ui.qcThresholds = core.normalizeQcThresholds({
        presetId: cur.presetId,
        emptyDistMm: Math.max(0, valNum("qcEmptyDistInput", cur.emptyDistMm)),
        spikeMaxSpeedMmS: Math.max(1, valNum("qcMaxSpeedInput", cur.spikeMaxSpeedMmS)),
        spikeMinMm: Math.max(1, valNum("qcSpikeMinInput", cur.spikeMinMm)),
        spikeMadMult: Math.max(1, valNum("qcMadMultInput", cur.spikeMadMult))
      }, ui.context);
      const rawTrimEndEl = document.getElementById("qcTrimEndInput");
      const rawTrimEnd = rawTrimEndEl && rawTrimEndEl.value.trim() !== "" ? parseFloat(rawTrimEndEl.value) : NaN;
      ui.trimWindow = {
        trimStartSec: Math.max(0, valNum("qcTrimStartInput", 0)),
        trimEndSec: Number.isFinite(rawTrimEnd) && rawTrimEnd > 0 ? rawTrimEnd : null
      };
      recomputeAndRender();
    };
    ["qcEmptyDistInput", "qcMaxSpeedInput", "qcSpikeMinInput", "qcMadMultInput", "qcTrimStartInput", "qcTrimEndInput"].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("change", readQcInputs);
        el.addEventListener("blur", () => {
          // Restore active fallback value if a required numeric QC input was cleared or negative
          if (id === "qcTrimEndInput") {
            const v = parseFloat(el.value);
            if (el.value.trim() !== "" && (!Number.isFinite(v) || v <= 0)) {
              el.value = ui.trimWindow && ui.trimWindow.trimEndSec != null ? String(ui.trimWindow.trimEndSec) : "";
            }
          } else {
            const v = parseFloat(el.value);
            const minVal = id === "qcEmptyDistInput" || id === "qcTrimStartInput" ? 0 : 1;
            if (el.value.trim() === "" || !Number.isFinite(v) || v < minVal) {
              renderQcThresholdsCard();
            }
          }
        });
      }
    });

    // Step 2: QC Exclude & Plate Heatmap interaction
    const exclFlagBtn = document.getElementById("excludeFlaggedBtn");
    if (exclFlagBtn) exclFlagBtn.addEventListener("click", excludeAllFlaggedWells);
    const qcExclBtn = document.getElementById("qcExcludeFlaggedBtn");
    if (qcExclBtn) qcExclBtn.addEventListener("click", excludeAllFlaggedWells);
    const restAllBtn = document.getElementById("restoreAllWellsBtn");
    if (restAllBtn) {
      restAllBtn.addEventListener("click", () => {
        const run = getActiveRun();
        if (!run) return;
        run.excludedWells.clear();
        run.excludeMeta = {};
        recomputeAndRender();
        toast("Restored all excluded wells");
      });
    }

    const plateMetricSel = document.getElementById("plateMetricSel");
    if (plateMetricSel) plateMetricSel.addEventListener("change", () => { ui.plateMetric = plateMetricSel.value; renderAllPlateMaps(); });

    const inspBtn = document.getElementById("qcWellInspectorExcludeBtn");
    if (inspBtn) {
      inspBtn.addEventListener("click", () => {
        const run = getActiveRun();
        if (!run || !ui.selectedWell) return;
        setWellExcluded(run, ui.selectedWell, !run.excludedWells.has(ui.selectedWell), "manual", "manual_exclude");
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
          const run = getActiveRun();
          if (run) setWellExcluded(run, wellId, !run.excludedWells.has(wellId), "manual", "manual_exclude");
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
      qcSvg.addEventListener("pointerleave", () => hideTooltip(document.getElementById("qcPlateTooltip")));
    }

    const qcFilterSel = document.getElementById("qcFilterSel");
    if (qcFilterSel) qcFilterSel.addEventListener("change", () => { ui.qcFilter = qcFilterSel.value; renderTempAndQcDiagnostics(); });
    const qcSortSel = document.getElementById("qcSortSel");
    if (qcSortSel) qcSortSel.addEventListener("change", () => { ui.qcSort = qcSortSel.value; renderTempAndQcDiagnostics(); });

    // Step 3: Multi-Factor & Group Brush controls
    const newFactorInp = document.getElementById("newFactorInput");
    const addFactorBtn = document.getElementById("addFactorBtn");
    if (addFactorBtn && newFactorInp) {
      const submitFactor = () => {
        if (!newFactorInp.value.trim()) return;
        addFactorLayer(newFactorInp.value.trim());
        newFactorInp.value = "";
      };
      addFactorBtn.addEventListener("click", submitFactor);
      newFactorInp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitFactor(); } });
    }

    const gtBtn = document.getElementById("presetGenoTreatBtn");
    if (gtBtn) gtBtn.addEventListener("click", () => applyFactorPreset([["genotype", ["WT", "Mutant"]], ["treatment", ["Vehicle", "Drug"]]]));
    const tdBtn = document.getElementById("presetTreatDoseBtn");
    if (tdBtn) tdBtn.addEventListener("click", () => applyFactorPreset([["treatment", ["Vehicle", "Drug"]], ["dose", ["Low", "High"]]]));
    const combBtn = document.getElementById("combineFactorsBtn");
    if (combBtn) combBtn.addEventListener("click", combineFactorsIntoGroups);

    const addGrpBtn = document.getElementById("addGroupBtn");
    if (addGrpBtn) addGrpBtn.addEventListener("click", addNewGroupOrLevel);
    const delGrpBtn = document.getElementById("deleteGroupBtn");
    if (delGrpBtn) delGrpBtn.addEventListener("click", deleteActiveGroupOrLevel);

    const renameInp = document.getElementById("activeGroupNameInput");
    if (renameInp) {
      renameInp.addEventListener("change", () => renameActiveGroupOrLevel(renameInp.value));
      renameInp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); renameActiveGroupOrLevel(renameInp.value); renameInp.blur(); }
      });
    }

    const exBrushBtn = document.getElementById("brushExcludeBtn");
    if (exBrushBtn) exBrushBtn.addEventListener("click", () => { ui.brushTool = ui.brushTool === "exclude" ? "group" : "exclude"; renderPlateControls(); });
    const rowBtn = document.getElementById("autoAssignRowsBtn");
    if (rowBtn) rowBtn.addEventListener("click", () => autoAssignGroupsOrLevels("row"));
    const colBtn = document.getElementById("autoAssignColsBtn");
    if (colBtn) colBtn.addEventListener("click", () => autoAssignGroupsOrLevels("col"));

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
          applyPlateMapObject(JSON.parse(await f.text()));
          recomputeAndRender();
          toast(`Loaded plate map from ${f.name}`);
        } catch (_) { toast("Invalid plate map JSON file"); }
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
      brushSvg.addEventListener("pointerleave", () => hideTooltip(document.getElementById("brushPlateTooltip")));
      window.addEventListener("pointerup", () => { _painting = false; _paintedInStroke.clear(); });
    }

    // Step 4: Scope, Unit of Analysis, Normalization, Plot Tabs, Window AUC, Screening Stats & Spatial
    const pooledBtn = document.getElementById("plotScopePooledBtn");
    const activeBtn = document.getElementById("plotScopeActiveBtn");
    if (pooledBtn) pooledBtn.addEventListener("click", () => { ui.scope = "pooled"; recomputeAndRender(); });
    if (activeBtn) activeBtn.addEventListener("click", () => { ui.scope = "active"; recomputeAndRender(); });

    const unitWellsBtn = document.getElementById("unitWellsBtn");
    const unitPlatesBtn = document.getElementById("unitPlatesBtn");
    if (unitWellsBtn) unitWellsBtn.addEventListener("click", () => { ui.unitOfAnalysis = "wells"; recomputeAndRender(); });
    if (unitPlatesBtn) unitPlatesBtn.addEventListener("click", () => { ui.unitOfAnalysis = "plates"; recomputeAndRender(); });

    const normChk = document.getElementById("normControlChk");
    if (normChk) {
      normChk.addEventListener("change", () => {
        ui.normalizeToControl = Boolean(normChk.checked);
        if (ui.normalizeToControl) ui.compView = "normalized_ctrl";
        recomputeAndRender();
      });
    }
    const normSel = document.getElementById("normControlGroupSel");
    if (normSel) normSel.addEventListener("change", () => { ui.controlGroupName = normSel.value; recomputeAndRender(); });

    document.querySelectorAll("#chartTabsBar [data-chart-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        ui.activeChartTab = btn.getAttribute("data-chart-tab") || "timeseries";
        renderChartToolbars();
        renderAllPlotTabs();
        renderDatasetSummarySidebar();
      });
    });

    const tsMetricSel = document.getElementById("tsMetricSel");
    if (tsMetricSel) tsMetricSel.addEventListener("change", () => { ui.tsMetric = tsMetricSel.value; recomputeAndRender(); });
    const tsSmoothSel = document.getElementById("tsSmoothSel");
    if (tsSmoothSel) tsSmoothSel.addEventListener("change", () => { ui.tsBinGroupSize = Math.max(1, parseInt(tsSmoothSel.value, 10) || 1); recomputeAndRender(); });
    const tvSel = document.getElementById("tsTraceViewSel");
    if (tvSel) tvSel.addEventListener("change", () => { ui.tsTraceView = tvSel.value; renderChartToolbars(); renderTimeSeriesChart(); });
    const ptSel = document.getElementById("tsPeriTypeSel");
    if (ptSel) ptSel.addEventListener("change", () => { ui.tsPeriType = ptSel.value; renderTimeSeriesChart(); });

    const readWindowAuc = () => {
      const sEl = document.getElementById("tsWinStartInput");
      const eEl = document.getElementById("tsWinEndInput");
      const s = sEl && sEl.value.trim() !== "" ? parseFloat(sEl.value) : NaN;
      const e = eEl && eEl.value.trim() !== "" ? parseFloat(eEl.value) : NaN;
      if (Number.isFinite(s) && Number.isFinite(e)) {
        ui.windowAuc = { startSec: Math.max(0, s), endSec: Math.max(0, e) };
      } else {
        ui.windowAuc = { startSec: null, endSec: null };
      }
      recomputeAndRender();
    };
    const wsInp = document.getElementById("tsWinStartInput");
    const weInp = document.getElementById("tsWinEndInput");
    const wcBtn = document.getElementById("tsWinClearBtn");
    if (wsInp) wsInp.addEventListener("change", readWindowAuc);
    if (weInp) weInp.addEventListener("change", readWindowAuc);
    if (wcBtn) {
      wcBtn.addEventListener("click", () => {
        if (wsInp) { wsInp.value = ""; wsInp.classList.remove("is-invalid"); }
        if (weInp) { weInp.value = ""; weInp.classList.remove("is-invalid"); }
        ui.windowAuc = { startSec: null, endSec: null };
        recomputeAndRender();
      });
    }

    const bindChk = (id, key, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", () => { ui[key] = Boolean(el.checked); fn(); });
    };
    bindChk("tsShowSem", "tsShowSem", renderTimeSeriesChart);
    bindChk("tsShowPhases", "tsShowPhases", renderTimeSeriesChart);
    bindChk("tsShowStim", "tsShowStim", renderTimeSeriesChart);
    bindChk("compShowStatsChk", "compShowStats", () => { renderChartToolbars(); renderComparisonChart(); });

    const compSel = document.getElementById("compViewSel");
    if (compSel) compSel.addEventListener("change", () => { ui.compView = compSel.value; renderComparisonChart(); });
    const compTfSel = document.getElementById("compTestFamilySel");
    if (compTfSel) {
      compTfSel.addEventListener("change", () => {
        ui.primaryTestFamily = compTfSel.value === "nonparametric" ? "nonparametric" : "parametric";
        renderComparisonChart();
      });
    }

    window.addEventListener("resize", () => {
      if (ui.currentPage === "export") updateWellTableScrollHint();
    });

    const xyFreezeInp = document.getElementById("xyFreezeInput");
    if (xyFreezeInp) {
      xyFreezeInp.addEventListener("change", () => {
        const v = parseFloat(xyFreezeInp.value);
        ui.xyFreezeSpeedMmS = Number.isFinite(v) && v >= 0.05 ? v : 0.5;
        recomputeAndRender();
      });
    }

    const bindSvgDl = (btnId, svgId, suffix) => {
      const btn = document.getElementById(btnId);
      if (btn) btn.addEventListener("click", () => downloadSvgElement(document.getElementById(svgId), `${getExportBasename()}_${suffix}.svg`));
    };
    bindSvgDl("downloadTsSvgBtn", "tsChartSvg", "timeseries");
    bindSvgDl("downloadCompSvgBtn", "compChartSvg", "comparison");
    bindSvgDl("downloadTempSvgBtn", "tempChartSvg", "temperature");
    bindSvgDl("downloadZchangeSvgBtn", "zchangeMatrixSvg", "zchange_matrix");
    bindSvgDl("downloadSpatialSvgBtn", "spatialHeatmapSvg", "spatial_heatmaps");

    // Step 5: Table filters & v2 Exporters
    const tGrp = document.getElementById("tableGroupFilter");
    if (tGrp) tGrp.addEventListener("change", () => { ui.tableGroupFilter = tGrp.value; renderWellTable(); });
    const tSt = document.getElementById("tableStatusFilter");
    if (tSt) tSt.addEventListener("change", () => { ui.tableStatusFilter = tSt.value; renderWellTable(); });

    const prismSel = document.getElementById("prismMetricSel");
    if (prismSel) prismSel.addEventListener("change", () => { ui.prismMetric = prismSel.value; });

    const bindExport = (id, fn) => { const btn = document.getElementById(id); if (btn) btn.addEventListener("click", fn); };

    bindExport("exportTidyBtn", () => {
      const core = getCore();
      if (!core || !ui.analysis) return;
      const csv = typeof core.exportTidyLongCsv === "function"
        ? core.exportTidyLongCsv(buildExportPayload(), { includeBom: true })
        : core.buildTidyLongCsv(ui.analysis, ui.summaryParsed, ui.groups, ui.excludedWells);
      downloadTextFile(csv, `${getExportBasename()}_tidy_long.csv`, "text/csv;charset=utf-8");
      toast("Downloaded Tidy Long CSV (UTF-8 BOM)");
    });

    bindExport("exportSummaryBtn", () => {
      const core = getCore();
      if (!core || !ui.analysis) return;
      const csv = typeof core.exportWellSummaryCsv === "function"
        ? core.exportWellSummaryCsv(buildExportPayload(), { includeBom: true })
        : core.buildWellSummaryCsv(ui.analysis);
      downloadTextFile(csv, `${getExportBasename()}_well_summary.csv`, "text/csv;charset=utf-8");
      toast("Downloaded Well Summary CSV (UTF-8 BOM)");
    });

    bindExport("exportPrismBtn", triggerPrismExport);

    bindExport("copyPrismBtn", () => {
      const core = getCore();
      if (!core || !ui.analysis) return;
      const tsv = typeof core.exportPrismGroupedTsv === "function"
        ? core.exportPrismGroupedTsv(buildExportPayload(), ui.prismMetric)
        : core.buildPrismGroupedTsv(ui.analysis, ui.prismMetric);
      copyTextToClipboard(tsv).then(() => toast("Copied Prism table to clipboard (tab-separated)"));
    });

    bindExport("exportCleaningLogBtn", () => {
      const core = getCore();
      if (!core || !ui.analysis || typeof core.exportCleaningLogTxt !== "function") return;
      const txt = core.exportCleaningLogTxt(buildExportPayload());
      downloadTextFile(txt, `${getExportBasename()}_cleaning_log.txt`, "text/plain;charset=utf-8");
      toast("Downloaded Methods-ready cleaning_log.txt");
    });

    bindExport("exportPythonBtn", () => {
      const core = getCore();
      if (!core || !ui.analysis) return;
      const py = typeof core.exportPythonScript === "function"
        ? core.exportPythonScript(buildExportPayload())
        : core.buildPythonTemplate(ui.analysis, ui.summaryParsed);
      downloadTextFile(py, `${getExportBasename()}_analysis.py`, "text/x-python;charset=utf-8");
      toast("Downloaded Python verification script (.py)");
    });
  }

  function init() {
    const core = getCore();
    if (core && typeof core.normalizeQcThresholds === "function") {
      ui.qcThresholds = core.normalizeQcThresholds("default", null);
    }
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
      recomputeAndRender,
      switchActiveRun,
      buildExportPayload,
      getExportBasename,
      matchCompanionToRun
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
