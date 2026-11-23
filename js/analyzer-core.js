// Zantiks MWP CSV Analyzer - Core pure analysis engine
// Classic script: exposes window.ZANTIKS_ANALYZER_CORE (no ES modules, no external deps, works offline over file://).
// Compatible with shared Builder globals (FACTORY_PLATES, ORGANISM_PRESETS, STIMULI, LED_COLORS,
// buildBuiltinMazeShapes, sanitizeCustomMaze, compileMultiTrackSlices, computeTempRampSteps,
// readExperimentFromZip, STORAGE_KEY_EXPERIMENT) and includes self-contained fallbacks.
(function (global) {
  "use strict";

  const SBS_W_MM = 127.8;
  const SBS_H_MM = 85.5;
  const DEFAULT_STORAGE_KEY = "zantiks_mwp_experiment_v1";
  const DEFAULT_EXPERIMENT_FORMAT = "zanscript-builder-experiment";
  const EXPERIMENT_ZIP_ENTRY = "experiment.json";

  const GROUP_PALETTE = [
    "#0969da", // GitHub blue
    "#1a7f37", // GitHub green
    "#bf8700", // Amber
    "#8250df", // Purple
    "#cf222e", // Crimson
    "#0e7490", // Teal
    "#bf3989", // Magenta
    "#57606a"  // Slate
  ];

  // Fallback plate catalog if js/catalogs.js is not loaded before analyzer-core.js
  const FALLBACK_PLATES = {
    "6well": { id: "6well", shortCode: "6w", name: "6-Well", rows: 2, cols: 3, shape: "DISC", xOffset: 24.76, yOffset: 23.16, colStep: 39.12, rowStep: 39.12, r: 17.72, rDz: 12.73 },
    "12well": { id: "12well", shortCode: "12w", name: "12-Well", rows: 3, cols: 4, shape: "DISC", xOffset: 24.94, yOffset: 16.79, colStep: 26.01, rowStep: 26.01, r: 11.4, rDz: 8.5 },
    "24well": { id: "24well", shortCode: "24w", name: "24-Well", rows: 4, cols: 6, shape: "DISC", xOffset: 15.2, yOffset: 13.5, colStep: 19.47, rowStep: 19.16, r: 8.13, rDz: 5.6 },
    "24costar": { id: "24costar", shortCode: "24c", name: "24-Well Costar", rows: 4, cols: 6, shape: "DISC", xOffset: 17.46, yOffset: 13.78, colStep: 19.3, rowStep: 19.3, r: 8.13, rDz: 5.65 },
    "24square": { id: "24square", shortCode: "24sq", name: "24-Well Square", rows: 4, cols: 6, shape: "SQUARE", xOffset: 18.5, yOffset: 14.4, colStep: 18, rowStep: 18, r: 16.5, rDz: 12 },
    "48well": { id: "48well", shortCode: "48w", name: "48-Well", rows: 6, cols: 8, shape: "DISC", xOffset: 18.4, yOffset: 10.28, colStep: 12.92, rowStep: 12.92, r: 5.19, rDz: 3.45 },
    "96well": { id: "96well", shortCode: "96w", name: "96-Well", rows: 8, cols: 12, shape: "DISC", xOffset: 14.15, yOffset: 11.24, colStep: 9, rowStep: 9, r: 3.5, rDz: 2.47 },
    "96square": { id: "96square", shortCode: "96sq", name: "96-Well Square", rows: 8, cols: 12, shape: "SQUARE", xOffset: 14.15, yOffset: 9.65, colStep: 9, rowStep: 9, r: 7.5, rDz: 4.5 },
    "petri": { id: "petri", shortCode: "pd", name: "Petri Dish", rows: 1, cols: 1, shape: "DISC", xOffset: 67, yOffset: 43, colStep: 19.3, rowStep: 19.3, r: 44, rDz: 31.8 },
    "ymaze4": { id: "ymaze4", shortCode: "ym4", name: "4-Unit Y-Maze", rows: 2, cols: 2, shape: "MAZE", isMaze: true, defaultZones: 4 },
    "ymaze2": { id: "ymaze2", shortCode: "ym2", name: "2-Unit Y-Maze", rows: 1, cols: 2, shape: "MAZE", isMaze: true, defaultZones: 4 },
    "choice12": { id: "choice12", shortCode: "ch12", name: "12-Choice Chamber", rows: 2, cols: 6, shape: "MAZE", isMaze: true, defaultZones: 3 },
    "social10": { id: "social10", shortCode: "soc10", name: "10-Lane Social", rows: 1, cols: 10, shape: "MAZE", isMaze: true, defaultZones: 5 },
    "custom_maze": { id: "custom_maze", shortCode: "cmz", name: "Custom 3D Maze", rows: 1, cols: 1, shape: "MAZE", isMaze: true, isCustomMaze: true, defaultZones: 4 }
  };

  const FALLBACK_STIMULI = {
    baseline: "None (Baseline)",
    ld_transitions: "Light / Dark Cycles",
    light_off_startle: "Light-Off Startle",
    light_on_pulse: "Light-On Flash",
    vibration_startle: "Vibration Startle",
    acoustic_startle: "Acoustic Startle",
    ppi: "Prepulse Inhibition (PPI)",
    circadian: "Long-Term Cycle",
    multi_phase: "Multi-Track Timeline",
    temp_ramp: "Temperature Step / Ramp"
  };

  const FALLBACK_ORGANISMS = {
    daphnia: "Daphnia magna",
    drosophila: "Drosophila (Adult)",
    celegans: "C. elegans",
    planaria: "Planaria",
    zebrafish: "Zebrafish Larvae",
    custom: "Custom"
  };

  function getPlateCatalog() {
    if (typeof FACTORY_PLATES !== "undefined" && FACTORY_PLATES) return FACTORY_PLATES;
    return FALLBACK_PLATES;
  }

  function getOrganismLabel(id) {
    if (typeof ORGANISM_PRESETS !== "undefined" && Array.isArray(ORGANISM_PRESETS)) {
      const hit = ORGANISM_PRESETS.find(o => o.id === id);
      if (hit) return hit.label;
    }
    return FALLBACK_ORGANISMS[id] || (id ? String(id) : "Unknown");
  }

  function getStimulusName(id) {
    if (typeof STIMULI !== "undefined" && Array.isArray(STIMULI)) {
      const hit = STIMULI.find(s => s.id === id);
      if (hit) return hit.name;
    }
    return FALLBACK_STIMULI[id] || (id ? String(id) : "Custom Protocol");
  }

  // ---------------------------------------------------------------------------
  // Math & Formatting Utilities
  // ---------------------------------------------------------------------------
  function roundNum(v, digits) {
    if (!Number.isFinite(v)) return null;
    const p = Math.pow(10, digits == null ? 3 : digits);
    return Math.round(v * p) / p;
  }

  function computeMedian(arr) {
    if (!arr || arr.length === 0) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function computeMad(arr, med) {
    if (!arr || arr.length === 0) return 0;
    const m = med == null ? computeMedian(arr) : med;
    const devs = arr.map(x => Math.abs(x - m));
    return computeMedian(devs);
  }

  function computeStats(rawValues) {
    const vals = [];
    for (let i = 0; i < rawValues.length; i++) {
      if (Number.isFinite(rawValues[i])) vals.push(rawValues[i]);
    }
    const n = vals.length;
    if (n === 0) {
      return { mean: null, sem: null, sd: null, n: 0, min: null, max: null, values: [] };
    }
    let sum = 0;
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      sum += v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const mean = sum / n;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const d = vals[i] - mean;
      sq += d * d;
    }
    const sd = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
    const sem = n > 1 ? sd / Math.sqrt(n) : 0;
    return { mean, sem, sd, n, min: mn, max: mx, values: vals };
  }

  function formatDuration(totalSec) {
    if (!Number.isFinite(totalSec) || totalSec < 0) return "0m 00s";
    const sec = Math.round(totalSec);
    if (sec >= 3600) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      return `${h}h ${String(m).padStart(2, "0")}m`;
    }
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }

  function makeWellLabels(rows, cols) {
    const out = [];
    for (let r = 0; r < rows; r++) {
      const rowCh = String.fromCharCode(65 + r);
      for (let c = 1; c <= cols; c++) out.push(rowCh + c);
    }
    return out;
  }

  function parseTimeSeconds(raw) {
    if (raw == null) return NaN;
    const s = String(raw).trim();
    if (!s) return NaN;
    const num = Number(s);
    if (Number.isFinite(num)) return num;
    // Support HH:MM:SS(.sss) or MM:SS(.sss)
    const parts = s.split(":");
    if (parts.length === 2 || parts.length === 3) {
      const nums = parts.map(p => Number(p));
      if (nums.every(Number.isFinite)) {
        return parts.length === 3
          ? nums[0] * 3600 + nums[1] * 60 + nums[2]
          : nums[0] * 60 + nums[1];
      }
    }
    return NaN;
  }

  function parseNumeric(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function csvEscape(val, delimiter) {
    const sep = delimiter || ",";
    if (val === null || val === undefined) return "";
    const s = String(val);
    if (s.includes(sep) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function normalizeExcludedSet(excludedWells) {
    if (!excludedWells) return new Set();
    if (excludedWells instanceof Set || (typeof excludedWells.has === "function" && typeof excludedWells[Symbol.iterator] === "function")) {
      return new Set([...excludedWells].map(w => String(w).toUpperCase()));
    }
    if (Array.isArray(excludedWells)) return new Set(excludedWells.map(w => String(w).toUpperCase()));
    if (typeof excludedWells === "object") {
      const s = new Set();
      for (const [k, v] of Object.entries(excludedWells)) {
        if (v) s.add(String(k).toUpperCase());
      }
      return s;
    }
    return new Set();
  }

  // ---------------------------------------------------------------------------
  // 1. RFC-4180 CSV Tokenizer & Zantiks CSV Parser
  // ---------------------------------------------------------------------------
  function parseCsvRows(rawText) {
    if (typeof rawText !== "string") return [];
    let text = rawText;
    // Strip UTF-8 BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    const len = text.length;

    for (let i = 0; i < len; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < len && text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          if (field.length === 0) {
            inQuotes = true;
          } else {
            field += ch;
          }
        } else if (ch === ",") {
          row.push(field);
          field = "";
        } else if (ch === "\r") {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
          if (i + 1 < len && text[i + 1] === "\n") i++;
        } else if (ch === "\n") {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
        } else {
          field += ch;
        }
      }
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function trimTrailingEmptyCells(cells) {
    let end = cells.length;
    while (end > 0 && String(cells[end - 1] || "").trim() === "") end--;
    return cells.slice(0, end);
  }

  function classifyHeaderCandidate(cells) {
    const trimmed = trimTrailingEmptyCells(cells);
    if (trimmed.length < 2) return null;
    const upper = trimmed.map(c => String(c || "").trim().toUpperCase());

    const hasTime = upper.some(h => h === "RUNTIME" || h === "TIME" || h === "TIME_S" || h === "SECONDS");
    const hasTimeBin = upper.includes("TIME_BIN");

    // 1. Zone-change event CSV: TIME/RUNTIME + ARENA + ZONE (or ACTION + ARENA/ZONE)
    // Handles both sparse Zantiks SETUP_ZCHANGE_HEADERS ("TIME,,,ARENA,ACTION,ZONE")
    // and compact ("TIME,ARENA,ACTION,ZONE")
    const hasArenaCol = upper.some(h => h === "ARENA" || h === "WELL" || h === "ARENA_ID");
    const hasZoneCol = upper.some(h => h === "ZONE" || h === "ZONE_ID");
    const hasActionCol = upper.some(h => h === "ACTION" || h === "EVENT" || h === "STATE");
    if (hasTime && ((hasArenaCol && hasZoneCol) || (hasActionCol && (hasArenaCol || hasZoneCol)))) {
      return { kind: "zchange", headers: trimmed, upper };
    }

    // 2. Per-frame XY CSV: RUNTIME/TIME + X_<well> & Y_<well>
    let xCount = 0;
    let yCount = 0;
    for (let i = 0; i < upper.length; i++) {
      if (/^X_[A-Z0-9]+$/.test(upper[i])) xCount++;
      else if (/^Y_[A-Z0-9]+$/.test(upper[i])) yCount++;
    }
    if ((hasTime || hasTimeBin) && xCount > 0 && yCount > 0) {
      return { kind: "xy", headers: trimmed, upper };
    }

    // 3. Summary CSV: RUNTIME/TIME/TIME_BIN + at least one metric/arena column
    let metricCols = 0;
    for (let i = 0; i < upper.length; i++) {
      const h = upper[i];
      if (/^(DIST|MSD)_[A-Z0-9]+$/.test(h) || /^(ZD|ZC|ZT)_[A-Z0-9]+_Z\d+$/.test(h)) {
        metricCols++;
      }
    }
    if ((hasTime || hasTimeBin) && metricCols > 0) {
      return { kind: "summary", headers: trimmed, upper };
    }

    // 4. Fallback summary CSV with bare well columns (e.g. RUNTIME,PHASE,A1,A2,...)
    if (hasTime || hasTimeBin) {
      const metaHints = upper.some(h => ["UNIT_ID", "TEMP_C", "TEMPERATURE", "TEMPERATURE1", "PHASE", "TRIAL", "TIME_BIN", "DAY", "HOUR"].includes(h));
      let bareWellCols = 0;
      for (let i = 0; i < upper.length; i++) {
        if (/^[A-H]\d{1,2}$/.test(upper[i])) bareWellCols++;
      }
      if (metaHints && bareWellCols >= 1) {
        return { kind: "summary", headers: trimmed, upper, bareWellFallback: true };
      }
    }

    return null;
  }

  function extractSystemMeta(preLines) {
    const meta = {};
    for (const line of preLines) {
      const clean = line.trim();
      if (!clean) continue;
      const parts = clean.split(",");
      if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
        const key = parts[0].replace(/^#\s*/, "").replace(/:$/, "").trim();
        const val = parts.slice(1).map(s => s.trim()).filter(Boolean).join(", ");
        if (key && val && !meta[key]) meta[key] = val;
      } else if (clean.includes(":")) {
        const idx = clean.indexOf(":");
        const key = clean.slice(0, idx).replace(/^#\s*/, "").trim();
        const val = clean.slice(idx + 1).trim();
        if (key && val && !meta[key]) meta[key] = val;
      }
    }
    return meta;
  }

  function normalizeArenaId(raw) {
    const s = String(raw || "").trim().toUpperCase();
    if (!s) return "";
    // "ARENA 1" / "ARENA_1" / "ARENA1" -> "A1"
    const mArena = s.match(/^ARENA[\s_-]*(\d+)$/);
    if (mArena) return "A" + parseInt(mArena[1], 10);
    // Pure integer "1" -> "A1"
    if (/^\d+$/.test(s)) return "A" + parseInt(s, 10);
    // Standard well/arena like "A1", "D6", "H12", "A15"
    const mWell = s.match(/^([A-Z]+)\s*0*(\d+)$/);
    if (mWell) return mWell[1] + parseInt(mWell[2], 10);
    return s;
  }

  function normalizeZoneNum(raw) {
    const s = String(raw || "").trim().toUpperCase();
    if (!s) return null;
    const m = s.match(/^(?:ZONE[\s_-]*|Z)?(\d+)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }

  function normalizeZchangeAction(raw) {
    const s = String(raw || "").trim().toUpperCase();
    if (!s) return "CHANGE";
    if (s === "ENTER" || s === "ENTERED" || s === "IN" || s === "ENTRY" || s.startsWith("ENTER")) return "ENTER";
    if (s === "EXIT" || s === "EXITED" || s === "OUT" || s === "LEAVE" || s.startsWith("EXIT")) return "EXIT";
    return "CHANGE";
  }

  function sortWellIdsNaturally(wellList) {
    return wellList.slice().sort((a, b) => {
      const ma = String(a).match(/^([A-Z]+)(\d+)$/i);
      const mb = String(b).match(/^([A-Z]+)(\d+)$/i);
      if (ma && mb) {
        const ra = ma[1].toUpperCase();
        const rb = mb[1].toUpperCase();
        if (ra !== rb) return ra < rb ? -1 : 1;
        return parseInt(ma[2], 10) - parseInt(mb[2], 10);
      }
      return String(a).localeCompare(String(b));
    });
  }

  function inferLayoutFromWells(wells, maxZone) {
    const catalog = getPlateCatalog();
    const list = Array.isArray(wells) ? wells : [];
    const n = list.length;
    if (n === 0) {
      return { id: "auto", name: "No Arenas", isMaze: false, shape: "DISC", rows: 0, cols: 0, wells: [], maxZone: maxZone || 0 };
    }

    const wellSet = new Set(list);
    const sameSet = (targetArr) => targetArr.length === n && targetArr.every(w => wellSet.has(w));

    // 1. Check single arena -> Petri Dish (unless maze zones > 2)
    if (n === 1 && list[0] === "A1") {
      if (maxZone > 2) {
        return { id: "custom_maze", name: `1-Arena Maze (${maxZone} zones)`, isMaze: true, shape: "MAZE", rows: 1, cols: 1, wells: ["A1"], maxZone };
      }
      const p = catalog.petri || FALLBACK_PLATES.petri;
      return { id: "petri", name: p.name, isMaze: false, shape: p.shape, rows: 1, cols: 1, wells: ["A1"], maxZone: maxZone || 2 };
    }

    // 2. Check standard multi-well plates
    const stdChecks = ["6well", "12well", "24well", "48well", "96well"];
    for (const pid of stdChecks) {
      const p = catalog[pid];
      if (!p) continue;
      if (sameSet(makeWellLabels(p.rows, p.cols))) {
        return { id: pid, name: p.name, isMaze: false, shape: p.shape, rows: p.rows, cols: p.cols, wells: makeWellLabels(p.rows, p.cols), maxZone: maxZone || 2 };
      }
    }

    // 3. Check linear A1..A<N> maze arenas
    const isLinearA = list.every((w, i) => /^A\d+$/.test(w)) && list.every((_, i) => wellSet.has("A" + (i + 1)));
    if (isLinearA) {
      if (n === 4 && (maxZone === 4 || maxZone === 0)) {
        const p = catalog.ymaze4 || FALLBACK_PLATES.ymaze4;
        return { id: "ymaze4", name: p.name, isMaze: true, shape: "MAZE", rows: 2, cols: 2, wells: list.slice(), maxZone: maxZone || 4 };
      }
      if (n === 2 && (maxZone === 4 || maxZone === 0)) {
        const p = catalog.ymaze2 || FALLBACK_PLATES.ymaze2;
        return { id: "ymaze2", name: p.name, isMaze: true, shape: "MAZE", rows: 1, cols: 2, wells: list.slice(), maxZone: maxZone || 4 };
      }
      if (n === 12 && maxZone === 3) {
        const p = catalog.choice12 || FALLBACK_PLATES.choice12;
        return { id: "choice12", name: p.name, isMaze: true, shape: "MAZE", rows: 2, cols: 6, wells: list.slice(), maxZone: 3 };
      }
      if (n === 10 && maxZone === 5) {
        const p = catalog.social10 || FALLBACK_PLATES.social10;
        return { id: "social10", name: p.name, isMaze: true, shape: "MAZE", rows: 1, cols: 10, wells: list.slice(), maxZone: 5 };
      }
      // Generic multi-arena maze (e.g., 15-arena Y-Maze A1..A15)
      const cols = n <= 5 ? n : (n === 15 ? 5 : Math.ceil(Math.sqrt(n * 1.45)));
      const rows = Math.ceil(n / cols);
      const label = maxZone === 4 && n === 15
        ? "15-Arena Y-Maze"
        : `${n}-Arena Maze${maxZone > 0 ? ` (${maxZone} zones)` : ""}`;
      return { id: "auto_maze", name: label, isMaze: true, shape: "MAZE", rows, cols, wells: list.slice(), maxZone: maxZone || 0 };
    }

    // 4. General grid <RowLetter><ColNum>
    let maxRowIdx = -1;
    let maxColNum = 0;
    let allGrid = true;
    for (const w of list) {
      const m = w.match(/^([A-Z])(\d+)$/);
      if (!m) { allGrid = false; break; }
      maxRowIdx = Math.max(maxRowIdx, m[1].charCodeAt(0) - 65);
      maxColNum = Math.max(maxColNum, parseInt(m[2], 10));
    }
    if (allGrid && maxRowIdx >= 0 && maxColNum >= 1) {
      return {
        id: "auto_grid",
        name: `${maxRowIdx + 1}x${maxColNum} Grid (${n} wells)`,
        isMaze: false,
        shape: "DISC",
        rows: maxRowIdx + 1,
        cols: maxColNum,
        wells: list.slice(),
        maxZone: maxZone || 0
      };
    }

    // 5. Fallback arbitrary labels
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.45)));
    const rows = Math.max(1, Math.ceil(n / cols));
    return {
      id: "auto",
      name: `${n} Arenas`,
      isMaze: maxZone > 2,
      shape: "DISC",
      rows,
      cols,
      wells: list.slice(),
      maxZone: maxZone || 0
    };
  }

  function parseZantiksCsv(text, filename) {
    const fname = filename || "data.csv";
    const warnings = [];
    const rawRows = parseCsvRows(String(text || ""));
    if (rawRows.length === 0) {
      return {
        kind: "unknown",
        filename: fname,
        headers: [],
        preHeaderLines: [],
        systemMeta: {},
        rowCount: 0,
        wells: [],
        maxZone: 0,
        zones: [],
        hasDist: false,
        hasMsd: false,
        hasZones: false,
        hasZoneDist: false,
        hasZoneCount: false,
        hasZoneTime: false,
        hasTemp: false,
        hasPhase: false,
        hasTrial: false,
        hasDay: false,
        binDurationSec: 1,
        startRuntimeSec: 0,
        durationSec: 0,
        inferredLayout: inferLayoutFromWells([], 0),
        rows: [],
        events: [],
        qc: {},
        qcSummary: { totalWells: 0, okCount: 0, emptyWells: [], spikeWells: [], flaggedWells: [] },
        tempSeries: { hasTemp: false, min: null, max: null, mean: null, std: null, points: [] },
        warnings: ["File is empty."]
      };
    }

    // Scan forward for real Zantiks header row
    let headerRowIdx = -1;
    let detected = null;
    const scanLimit = Math.min(rawRows.length, 60);
    for (let i = 0; i < scanLimit; i++) {
      const cand = classifyHeaderCandidate(rawRows[i]);
      if (cand) {
        headerRowIdx = i;
        detected = cand;
        break;
      }
    }

    if (headerRowIdx < 0 || !detected) {
      return {
        kind: "unknown",
        filename: fname,
        headers: rawRows[0] ? trimTrailingEmptyCells(rawRows[0]) : [],
        preHeaderLines: [],
        systemMeta: {},
        rowCount: 0,
        wells: [],
        maxZone: 0,
        zones: [],
        hasDist: false,
        hasMsd: false,
        hasZones: false,
        hasZoneDist: false,
        hasZoneCount: false,
        hasZoneTime: false,
        hasTemp: false,
        hasPhase: false,
        hasTrial: false,
        hasDay: false,
        binDurationSec: 1,
        startRuntimeSec: 0,
        durationSec: 0,
        inferredLayout: inferLayoutFromWells([], 0),
        rows: [],
        events: [],
        qc: {},
        qcSummary: { totalWells: 0, okCount: 0, emptyWells: [], spikeWells: [], flaggedWells: [] },
        tempSeries: { hasTemp: false, min: null, max: null, mean: null, std: null, points: [] },
        warnings: ["Unrecognized CSV format: no Zantiks RUNTIME/TIME header with arena metrics or zone events found."]
      };
    }

    const preHeaderLines = rawRows
      .slice(0, headerRowIdx)
      .map(r => trimTrailingEmptyCells(r).join(",").trim())
      .filter(Boolean);
    const systemMeta = extractSystemMeta(preHeaderLines);
    const headers = detected.headers;
    const upper = detected.upper;

    // -------------------------------------------------------------------------
    // Branch A: _ZCHANGE Event CSV
    // -------------------------------------------------------------------------
    if (detected.kind === "zchange") {
      const idxTime = upper.findIndex(h => h === "TIME" || h === "RUNTIME" || h === "TIME_S");
      const idxArena = upper.findIndex(h => h === "ARENA" || h === "WELL" || h === "ARENA_ID");
      const idxAction = upper.findIndex(h => h === "ACTION" || h === "EVENT" || h === "STATE");
      const idxZone = upper.findIndex(h => h === "ZONE" || h === "ZONE_ID");

      const events = [];
      const wellSet = new Set();
      let maxZone = 0;

      for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
        const cols = rawRows[r];
        if (!cols || cols.every(c => String(c || "").trim() === "")) continue;
        const time = idxTime >= 0 ? parseTimeSeconds(cols[idxTime]) : NaN;
        const arena = idxArena >= 0 ? normalizeArenaId(cols[idxArena]) : "";
        const zone = idxZone >= 0 ? normalizeZoneNum(cols[idxZone]) : null;
        const rawAction = idxAction >= 0 ? String(cols[idxAction] || "").trim() : "";
        const action = normalizeZchangeAction(rawAction);
        if (!arena || zone === null || !Number.isFinite(time)) continue;

        wellSet.add(arena);
        if (zone > maxZone) maxZone = zone;
        events.push({
          index: events.length,
          time,
          arena,
          action,
          rawAction: rawAction || action,
          zone
        });
      }

      const wells = sortWellIdsNaturally([...wellSet]);
      const zones = [];
      for (let z = 1; z <= maxZone; z++) zones.push(z);
      const startTime = events.length ? events[0].time : 0;
      const endTime = events.length ? events[events.length - 1].time : 0;

      return {
        kind: "zchange",
        filename: fname,
        headers,
        preHeaderLines,
        systemMeta,
        rowCount: events.length,
        wells,
        maxZone,
        zones,
        hasDist: false,
        hasMsd: false,
        hasZones: maxZone > 0,
        hasZoneDist: false,
        hasZoneCount: false,
        hasZoneTime: false,
        hasTemp: false,
        hasPhase: false,
        hasTrial: false,
        hasDay: false,
        binDurationSec: 0,
        startRuntimeSec: startTime,
        durationSec: Math.max(0, endTime - startTime),
        inferredLayout: inferLayoutFromWells(wells, maxZone),
        rows: [],
        events,
        qc: {},
        qcSummary: { totalWells: wells.length, okCount: wells.length, emptyWells: [], spikeWells: [], flaggedWells: [] },
        tempSeries: { hasTemp: false, min: null, max: null, mean: null, std: null, points: [] },
        warnings
      };
    }

    // -------------------------------------------------------------------------
    // Branch B: _XY Per-Frame Coordinates CSV
    // -------------------------------------------------------------------------
    if (detected.kind === "xy") {
      const idxTime = upper.findIndex(h => h === "RUNTIME" || h === "TIME" || h === "TIME_S");
      const xyMap = {};
      const wellOrder = [];
      for (let i = 0; i < upper.length; i++) {
        const m = upper[i].match(/^([XY])_([A-Z0-9]+)$/);
        if (!m) continue;
        const axis = m[1].toLowerCase();
        const w = m[2];
        if (!xyMap[w]) {
          xyMap[w] = { x: -1, y: -1 };
          wellOrder.push(w);
        }
        xyMap[w][axis] = i;
      }

      const rows = [];
      let firstTime = null;
      for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
        const cols = rawRows[r];
        if (!cols || cols.every(c => String(c || "").trim() === "")) continue;
        const runtime = idxTime >= 0 ? parseTimeSeconds(cols[idxTime]) : rows.length;
        if (!Number.isFinite(runtime)) continue;
        if (firstTime === null) firstTime = runtime;
        const xy = {};
        for (const w of wellOrder) {
          const x = xyMap[w].x >= 0 ? parseNumeric(cols[xyMap[w].x]) : null;
          const y = xyMap[w].y >= 0 ? parseNumeric(cols[xyMap[w].y]) : null;
          xy[w] = { x, y };
        }
        rows.push({
          index: rows.length,
          runtime,
          relTime: Number((runtime - firstTime).toFixed(4)),
          xy
        });
      }

      const dts = [];
      for (let i = 1; i < Math.min(rows.length, 200); i++) {
        const dt = rows[i].runtime - rows[i - 1].runtime;
        if (dt > 0) dts.push(dt);
      }
      const medDt = dts.length ? computeMedian(dts) : 1 / 30;
      const durationSec = rows.length > 1 ? Math.max(0, rows[rows.length - 1].runtime - rows[0].runtime) : 0;

      return {
        kind: "xy",
        filename: fname,
        headers,
        preHeaderLines,
        systemMeta,
        rowCount: rows.length,
        wells: wellOrder,
        maxZone: 0,
        zones: [],
        hasDist: false,
        hasMsd: false,
        hasZones: false,
        hasZoneDist: false,
        hasZoneCount: false,
        hasZoneTime: false,
        hasTemp: false,
        hasPhase: false,
        hasTrial: false,
        hasDay: false,
        binDurationSec: roundNum(medDt, 4) || 0.0333,
        estimatedFps: medDt > 0 ? roundNum(1 / medDt, 1) : null,
        startRuntimeSec: firstTime || 0,
        durationSec,
        inferredLayout: inferLayoutFromWells(wellOrder, 0),
        rows,
        events: [],
        qc: {},
        qcSummary: { totalWells: wellOrder.length, okCount: wellOrder.length, emptyWells: [], spikeWells: [], flaggedWells: [] },
        tempSeries: { hasTemp: false, min: null, max: null, mean: null, std: null, points: [] },
        warnings
      };
    }

    // -------------------------------------------------------------------------
    // Branch C: Summary CSV (Step 4 Main Assay or Step 3 Track Check)
    // -------------------------------------------------------------------------
    const metaIdx = {
      runtime: upper.findIndex(h => h === "RUNTIME" || h === "TIME" || h === "TIME_S"),
      unitId: upper.findIndex(h => h === "UNIT_ID" || h === "APPARATUS_ID" || h === "UNIT"),
      tempC: upper.findIndex(h => h === "TEMP_C" || h === "TEMPERATURE1" || h === "TEMPERATURE" || h === "TEMP"),
      phase: upper.findIndex(h => h === "PHASE" || h === "CONDITION" || h === "STAGE"),
      trial: upper.findIndex(h => h === "TRIAL" || h === "CYCLE" || h === "BLOCK"),
      day: upper.findIndex(h => h === "DAY"),
      hour: upper.findIndex(h => h === "HOUR"),
      timeBin: upper.findIndex(h => h === "TIME_BIN" || h === "BIN")
    };

    const distCols = {};
    const msdCols = {};
    const zdCols = {};
    const zcCols = {};
    const ztCols = {};
    const wellOrder = [];
    const seenWells = new Set();
    let maxZone = 0;

    const addWell = (w) => {
      if (!seenWells.has(w)) {
        seenWells.add(w);
        wellOrder.push(w);
      }
    };

    for (let i = 0; i < upper.length; i++) {
      const h = upper[i];
      let m;
      if ((m = h.match(/^DIST_([A-Z0-9]+)$/))) {
        addWell(m[1]);
        distCols[m[1]] = i;
      } else if ((m = h.match(/^MSD_([A-Z0-9]+)$/))) {
        addWell(m[1]);
        msdCols[m[1]] = i;
      } else if ((m = h.match(/^(ZD|ZC|ZT)_([A-Z0-9]+)_Z(\d+)$/))) {
        const prefix = m[1];
        const w = m[2];
        const z = parseInt(m[3], 10);
        addWell(w);
        if (z > maxZone) maxZone = z;
        const target = prefix === "ZD" ? zdCols : (prefix === "ZC" ? zcCols : ztCols);
        if (!target[w]) target[w] = {};
        target[w][z] = i;
      } else if (detected.bareWellFallback && /^[A-H]\d{1,2}$/.test(h)) {
        addWell(h);
        distCols[h] = i;
      }
    }

    const hasDist = Object.keys(distCols).length > 0;
    const hasMsd = Object.keys(msdCols).length > 0;
    const hasZoneDist = Object.keys(zdCols).length > 0;
    const hasZoneCount = Object.keys(zcCols).length > 0;
    const hasZoneTime = Object.keys(ztCols).length > 0;
    const hasZones = maxZone > 0 && (hasZoneDist || hasZoneCount || hasZoneTime);
    const zones = [];
    for (let z = 1; z <= maxZone; z++) zones.push(z);

    const rows = [];
    let firstRuntime = null;
    let anyTemp = false;
    let anyPhase = false;
    let anyTrial = false;
    let anyDay = false;

    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
      const cols = rawRows[r];
      if (!cols || cols.every(c => String(c || "").trim() === "")) continue;

      const rawRuntime = metaIdx.runtime >= 0 ? parseTimeSeconds(cols[metaIdx.runtime]) : NaN;
      const timeBin = metaIdx.timeBin >= 0 ? parseNumeric(cols[metaIdx.timeBin]) : null;

      // Extract metric payloads and verify at least one numeric cell exists (skips footer comments)
      let hasAnyMetricVal = false;
      const dist = hasDist ? {} : null;
      const msd = hasMsd ? {} : null;
      const zd = hasZoneDist ? {} : null;
      const zc = hasZoneCount ? {} : null;
      const zt = hasZoneTime ? {} : null;

      if (hasDist) {
        for (const w of wellOrder) {
          const ci = distCols[w];
          const v = ci != null ? parseNumeric(cols[ci]) : null;
          dist[w] = v;
          if (v !== null) hasAnyMetricVal = true;
        }
      }
      if (hasMsd) {
        for (const w of wellOrder) {
          const ci = msdCols[w];
          const v = ci != null ? parseNumeric(cols[ci]) : null;
          msd[w] = v;
          if (v !== null) hasAnyMetricVal = true;
        }
      }
      if (hasZoneDist) {
        for (const w of wellOrder) {
          zd[w] = {};
          const map = zdCols[w] || {};
          for (let z = 1; z <= maxZone; z++) {
            const v = map[z] != null ? parseNumeric(cols[map[z]]) : null;
            zd[w][z] = v;
            if (v !== null) hasAnyMetricVal = true;
          }
        }
      }
      if (hasZoneCount) {
        for (const w of wellOrder) {
          zc[w] = {};
          const map = zcCols[w] || {};
          for (let z = 1; z <= maxZone; z++) {
            const v = map[z] != null ? parseNumeric(cols[map[z]]) : null;
            zc[w][z] = v;
            if (v !== null) hasAnyMetricVal = true;
          }
        }
      }
      if (hasZoneTime) {
        for (const w of wellOrder) {
          zt[w] = {};
          const map = ztCols[w] || {};
          for (let z = 1; z <= maxZone; z++) {
            const v = map[z] != null ? parseNumeric(cols[map[z]]) : null;
            zt[w][z] = v;
            if (v !== null) hasAnyMetricVal = true;
          }
        }
      }

      if (!Number.isFinite(rawRuntime) && !hasAnyMetricVal) continue;

      const runtime = Number.isFinite(rawRuntime)
        ? rawRuntime
        : (timeBin !== null ? timeBin : rows.length);
      if (firstRuntime === null) firstRuntime = runtime;

      const unitId = metaIdx.unitId >= 0 ? String(cols[metaIdx.unitId] || "").trim() : "";
      const tempC = metaIdx.tempC >= 0 ? parseNumeric(cols[metaIdx.tempC]) : null;
      const phase = metaIdx.phase >= 0 ? String(cols[metaIdx.phase] || "").trim() : "";
      const trial = metaIdx.trial >= 0 ? parseNumeric(cols[metaIdx.trial]) : null;
      const day = metaIdx.day >= 0 ? parseNumeric(cols[metaIdx.day]) : null;
      const hour = metaIdx.hour >= 0 ? parseNumeric(cols[metaIdx.hour]) : null;

      if (tempC !== null) anyTemp = true;
      if (phase) anyPhase = true;
      if (trial !== null) anyTrial = true;
      if (day !== null) anyDay = true;

      rows.push({
        index: rows.length,
        runtime,
        relTime: Number((runtime - firstRuntime).toFixed(3)),
        unitId,
        tempC,
        phase,
        trial,
        day,
        hour,
        timeBin: timeBin !== null ? timeBin : (rows.length + 1),
        dist,
        msd,
        zd,
        zc,
        zt
      });
    }

    // Estimate bin duration from consecutive runtime deltas
    const dts = [];
    for (let i = 1; i < rows.length; i++) {
      const dt = rows[i].runtime - rows[i - 1].runtime;
      if (dt > 0 && Number.isFinite(dt)) dts.push(dt);
    }
    const binDurationSec = dts.length > 0 ? Math.max(0.05, Number(computeMedian(dts).toFixed(3))) : 1;
    const durationSec = rows.length > 0
      ? Number(((rows[rows.length - 1].relTime) + binDurationSec).toFixed(3))
      : 0;

    // Temperature time series & summary
    const tempPoints = [];
    const tempVals = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.tempC !== null) {
        tempVals.push(row.tempC);
        tempPoints.push({
          index: row.index,
          runtime: row.runtime,
          relTime: row.relTime,
          tempC: row.tempC,
          phase: row.phase
        });
      }
    }
    const tempStats = computeStats(tempVals);
    const tempSeries = {
      hasTemp: tempVals.length > 0,
      min: tempStats.min !== null ? roundNum(tempStats.min, 2) : null,
      max: tempStats.max !== null ? roundNum(tempStats.max, 2) : null,
      mean: tempStats.mean !== null ? roundNum(tempStats.mean, 2) : null,
      std: tempStats.sd !== null ? roundNum(tempStats.sd, 3) : null,
      points: tempPoints
    };

    // Per-well QC diagnostics
    const qc = {};
    const emptyWells = [];
    const spikeWells = [];
    const flaggedWells = [];

    for (const w of wellOrder) {
      const distVals = [];
      const distByRow = [];
      const msdVals = [];
      let totalDist = 0;
      let totalMsd = 0;
      let maxBinDist = 0;
      let activeBins = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        let dVal = null;
        if (hasDist) {
          dVal = row.dist[w];
        } else if (hasZoneDist && row.zd && row.zd[w]) {
          let s = 0;
          let anyZ = false;
          for (let z = 1; z <= maxZone; z++) {
            if (row.zd[w][z] !== null) { s += row.zd[w][z]; anyZ = true; }
          }
          dVal = anyZ ? s : null;
        }
        const mVal = hasMsd ? row.msd[w] : null;
        distByRow.push(dVal);

        if (dVal !== null) {
          distVals.push(dVal);
          totalDist += dVal;
          if (dVal > maxBinDist) maxBinDist = dVal;
          if (dVal > 0.05) activeBins++;
        }
        if (mVal !== null) {
          msdVals.push(mVal);
          totalMsd += mVal;
          if (!hasDist && !hasZoneDist && mVal > 0.05) activeBins++;
        }
      }

      const useDistForQc = hasDist || hasZoneDist;
      const primaryVals = useDistForQc ? distVals : msdVals;
      const primaryTotal = useDistForQc ? totalDist : totalMsd;
      const meanDist = distVals.length ? totalDist / distVals.length : 0;
      const meanMsd = msdVals.length ? totalMsd / msdVals.length : null;
      const meanSpeedMmS = binDurationSec > 0 ? meanDist / binDurationSec : meanDist;
      const maxSpeedMmS = binDurationSec > 0 ? maxBinDist / binDurationSec : maxBinDist;
      const activePct = rows.length > 0 ? (activeBins / rows.length) * 100 : 0;

      const isEmpty = primaryVals.length === 0 || primaryTotal < 0.1 || activeBins === 0;
      const medianBinDist = primaryVals.length ? computeMedian(primaryVals) : 0;
      const madBinDist = primaryVals.length ? computeMad(primaryVals, medianBinDist) : 0;
      const spikeThreshold = Math.max(50, medianBinDist + 10 * madBinDist);

      const spikeBins = [];
      if (useDistForQc && !isEmpty) {
        for (let i = 0; i < distByRow.length; i++) {
          const v = distByRow[i];
          if (v === null) continue;
          const speed = binDurationSec > 0 ? v / binDurationSec : v;
          if (v > spikeThreshold || speed > 150) {
            spikeBins.push(i);
          }
        }
      } else if (!useDistForQc && hasMsd && !isEmpty) {
        const msdThresh = Math.max(500, medianBinDist + 10 * madBinDist);
        for (let i = 0; i < rows.length; i++) {
          const v = rows[i].msd[w];
          if (v !== null && v > msdThresh) spikeBins.push(i);
        }
      }

      const spikeCount = spikeBins.length;
      const isSpikeGlitch = spikeCount > 0;
      const flags = [];
      if (isEmpty) flags.push("empty");
      if (isSpikeGlitch) flags.push("spike");

      let status = "ok";
      let reason = "OK";
      if (isSpikeGlitch && isEmpty) {
        status = "spike";
        reason = `Empty + ${spikeCount} spike(s)`;
      } else if (isSpikeGlitch) {
        status = "spike";
        reason = `${spikeCount} reflection spike${spikeCount === 1 ? "" : "s"} (max ${maxBinDist.toFixed(1)} mm/bin)`;
      } else if (isEmpty) {
        status = "empty";
        reason = `Empty / dead (${totalDist.toFixed(2)} mm total, ${activeBins} active bins)`;
      }

      if (isEmpty) emptyWells.push(w);
      if (isSpikeGlitch) spikeWells.push(w);
      if (isEmpty || isSpikeGlitch) flaggedWells.push(w);

      qc[w] = {
        well: w,
        totalDist: roundNum(totalDist, 3),
        meanDist: roundNum(meanDist, 3),
        meanSpeedMmS: roundNum(meanSpeedMmS, 3),
        maxBinDist: roundNum(maxBinDist, 3),
        maxSpeedMmS: roundNum(maxSpeedMmS, 3),
        totalMsd: hasMsd ? roundNum(totalMsd, 3) : null,
        meanMsd: hasMsd && meanMsd !== null ? roundNum(meanMsd, 3) : null,
        activeBins,
        activePct: roundNum(activePct, 1),
        medianBinDist: roundNum(medianBinDist, 3),
        madBinDist: roundNum(madBinDist, 3),
        spikeThreshold: roundNum(spikeThreshold, 2),
        isEmpty,
        spikeCount,
        spikeBins,
        isSpikeGlitch,
        status,
        flags,
        reason
      };
    }

    const qcSummary = {
      totalWells: wellOrder.length,
      okCount: wellOrder.length - flaggedWells.length,
      emptyWells,
      spikeWells,
      flaggedWells
    };

    return {
      kind: "summary",
      filename: fname,
      headers,
      preHeaderLines,
      systemMeta,
      rowCount: rows.length,
      wells: wellOrder,
      maxZone,
      zones,
      hasDist,
      hasMsd,
      hasZones,
      hasZoneDist,
      hasZoneCount,
      hasZoneTime,
      hasTemp: anyTemp,
      hasPhase: anyPhase,
      hasTrial: anyTrial,
      hasDay: anyDay,
      binDurationSec,
      startRuntimeSec: firstRuntime || 0,
      durationSec,
      inferredLayout: inferLayoutFromWells(wellOrder, maxZone),
      rows,
      events: [],
      qc,
      qcSummary,
      tempSeries,
      warnings
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Experiment Context, ZIP & localStorage Loader
  // ---------------------------------------------------------------------------
  function buildZoneLabels(plateId, maxZone, zoneMode) {
    const zCount = Math.max(0, maxZone || 0);
    if (zCount === 0) return [];
    if (plateId === "ymaze4" || plateId === "ymaze2" || (zCount === 4 && String(plateId || "").includes("ymaze"))) {
      return ["Arm 1 (Z1)", "Arm 2 (Z2)", "Arm 3 (Z3)", "Center (Z4)"].slice(0, zCount);
    }
    if (plateId === "choice12" && zCount === 3) {
      return ["Top Well (Z1)", "Bridge (Z2)", "Bottom Well (Z3)"];
    }
    if (plateId === "social10" && zCount === 5) {
      return ["End A (Z1)", "Near A (Z2)", "Center (Z3)", "Near B (Z4)", "End B (Z5)"];
    }
    if (zCount === 2) {
      if (zoneMode === "half_tb") return ["Bottom Half (Z1)", "Top Half (Z2)"];
      if (zoneMode === "half_lr") return ["Right Half (Z1)", "Left Half (Z2)"];
      return ["Outer Ring (Z1)", "Inner Center (Z2)"];
    }
    const out = [];
    for (let z = 1; z <= zCount; z++) out.push(`Zone ${z} (Z${z})`);
    return out;
  }

  function fallbackTempRampSteps(startRaw, endRaw, stepRaw) {
    if (typeof computeTempRampSteps === "function") {
      return computeTempRampSteps(startRaw, endRaw, stepRaw);
    }
    const startT = Math.min(40, Math.max(10, Number((parseFloat(startRaw) || 20).toFixed(1))));
    const endT = Math.min(40, Math.max(10, Number((parseFloat(endRaw) || 30).toFixed(1))));
    const step = Math.min(20, Math.max(0.5, Number((Math.abs(parseFloat(stepRaw)) || 2).toFixed(1))));
    if (Math.abs(endT - startT) < 0.01) return [startT];
    const dir = endT > startT ? 1 : -1;
    const steps = [];
    let cur = startT;
    while ((dir > 0 ? cur <= endT + 0.001 : cur >= endT - 0.001) && steps.length < 24) {
      steps.push(Number(cur.toFixed(1)));
      cur += dir * step;
    }
    const last = steps[steps.length - 1];
    if (Math.abs(last - endT) > 0.01 && steps.length < 25) steps.push(endT);
    return steps;
  }

  function buildContextSchedule(stimId, sp, inputs, timelineClips) {
    const phaseSchedule = [];
    const stimulusEvents = [];
    const tempSchedule = [];
    const thermEnabled = inputs.chk_thermostat !== false;
    const baseTemp = parseNumeric(inputs.thermostatTemp);
    const defaultTemp = baseTemp !== null ? baseTemp : 22;
    const ledColor = String(inputs.ledColor || "WHITE").toUpperCase();
    const activeLightTag = ledColor === "WHITE" ? "LIGHT" : ledColor;

    let t = 0;

    if (stimId === "baseline") {
      const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
      const dur = Math.max(bin, parseInt(sp.durationSec, 10) || 600);
      const isDark = sp.baseLight === "DARK";
      phaseSchedule.push({ startSec: 0, endSec: dur, phase: isDark ? "DARK" : activeLightTag, label: isDark ? "DARK" : activeLightTag, kind: isDark ? "dark" : "light", tempC: thermEnabled ? defaultTemp : null });
      if (thermEnabled) tempSchedule.push({ startSec: 0, endSec: dur, tempC: defaultTemp, label: `${defaultTemp}°C` });
    } else if (stimId === "ld_transitions") {
      const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
      const phaseSec = Math.max(bin, parseInt(sp.ldPhaseSec, 10) || 300);
      const cycles = Math.max(1, parseInt(sp.ldCycles, 10) || 2);
      const startLight = sp.ldStart !== "DARK";
      for (let c = 1; c <= cycles; c++) {
        const firstIsLight = startLight;
        for (let half = 0; half < 2; half++) {
          const isLight = half === 0 ? firstIsLight : !firstIsLight;
          const ph = isLight ? activeLightTag : "DARK";
          phaseSchedule.push({ startSec: t, endSec: t + phaseSec, phase: ph, label: `${ph} (C${c})`, kind: isLight ? "light" : "dark", tempC: thermEnabled ? defaultTemp : null });
          t += phaseSec;
        }
      }
      if (thermEnabled) tempSchedule.push({ startSec: 0, endSec: t, tempC: defaultTemp, label: `${defaultTemp}°C` });
    } else if (stimId === "light_off_startle" || stimId === "light_on_pulse" || stimId === "vibration_startle" || stimId === "acoustic_startle") {
      const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
      const preSec = Math.max(0, parseInt(sp.preBaselineSec, 10) || 60);
      const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
      const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
      const pulseDur = (stimId === "light_off_startle" || stimId === "light_on_pulse")
        ? Math.max(bin, Math.round((parseFloat(sp.pulseDurSec) || 1) / bin) * bin)
        : bin;
      if (preSec > 0) {
        phaseSchedule.push({ startSec: 0, endSec: preSec, phase: "BASELINE", label: "Baseline", kind: "baseline", tempC: thermEnabled ? defaultTemp : null });
        t += preSec;
      }
      const stimTag = stimId === "light_off_startle" ? "STARTLE"
        : (stimId === "light_on_pulse" ? `${activeLightTag}_FLASH`
        : (stimId === "vibration_startle" ? "VIBRATION" : "AUDIO_PULSE"));
      const stimType = stimId === "vibration_startle" ? "vib"
        : (stimId === "acoustic_startle" ? "audio" : "light_pulse");
      for (let p = 1; p <= pulses; p++) {
        phaseSchedule.push({ startSec: t, endSec: t + pulseDur, phase: stimTag, label: `${stimTag} #${p}`, kind: "stim", stimType, tempC: thermEnabled ? defaultTemp : null });
        stimulusEvents.push({ timeSec: t, label: `${stimTag} #${p}`, type: stimType, detail: stimTag });
        t += pulseDur;
        phaseSchedule.push({ startSec: t, endSec: t + itiSec, phase: "ITI", label: `ITI #${p}`, kind: "iti", tempC: thermEnabled ? defaultTemp : null });
        t += itiSec;
      }
      if (thermEnabled) tempSchedule.push({ startSec: 0, endSec: t, tempC: defaultTemp, label: `${defaultTemp}°C` });
    } else if (stimId === "ppi") {
      const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
      const preSec = Math.max(0, parseInt(sp.preBaselineSec, 10) || 60);
      const pairs = Math.max(1, parseInt(sp.ppiPairs, 10) || 5);
      const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
      const isAlt = (sp.ppiPattern || "alternating") === "alternating";
      if (preSec > 0) {
        phaseSchedule.push({ startSec: 0, endSec: preSec, phase: "BASELINE", label: "Baseline", kind: "baseline", tempC: thermEnabled ? defaultTemp : null });
        t += preSec;
      }
      let tr = 0;
      for (let b = 1; b <= pairs; b++) {
        if (isAlt) {
          tr++;
          phaseSchedule.push({ startSec: t, endSec: t + bin, phase: "PULSE_ALONE", label: `Pulse Alone #${tr}`, kind: "stim", stimType: "pulse_alone", tempC: thermEnabled ? defaultTemp : null });
          stimulusEvents.push({ timeSec: t, label: `Pulse #${tr}`, type: "pulse_alone", detail: "PULSE_ALONE" });
          t += bin;
          phaseSchedule.push({ startSec: t, endSec: t + itiSec, phase: "ITI", label: `ITI #${tr}`, kind: "iti", tempC: thermEnabled ? defaultTemp : null });
          t += itiSec;
        }
        tr++;
        phaseSchedule.push({ startSec: t, endSec: t + bin, phase: "PPI_TRIAL", label: `PPI #${tr}`, kind: "stim", stimType: "ppi", tempC: thermEnabled ? defaultTemp : null });
        stimulusEvents.push({ timeSec: t, label: `PPI #${tr}`, type: "ppi", detail: "PPI_TRIAL" });
        t += bin;
        phaseSchedule.push({ startSec: t, endSec: t + itiSec, phase: "ITI", label: `ITI #${tr}`, kind: "iti", tempC: thermEnabled ? defaultTemp : null });
        t += itiSec;
      }
      if (thermEnabled) tempSchedule.push({ startSec: 0, endSec: t, tempC: defaultTemp, label: `${defaultTemp}°C` });
    } else if (stimId === "temp_ramp") {
      const steps = fallbackTempRampSteps(sp.rampStartTemp, sp.rampEndTemp, sp.rampStepTemp);
      const holdSec = Math.max(1, parseInt(sp.rampHoldSec, 10) || 300);
      for (const tempVal of steps) {
        phaseSchedule.push({ startSec: t, endSec: t + holdSec, phase: `TEMP_${tempVal}C`, label: `${tempVal}°C`, kind: "temp", tempC: tempVal });
        tempSchedule.push({ startSec: t, endSec: t + holdSec, tempC: tempVal, label: `${tempVal}°C` });
        t += holdSec;
      }
    } else if (stimId === "multi_phase" && typeof compileMultiTrackSlices === "function") {
      const cycles = Math.max(1, parseInt(sp.mpCycles, 10) || 1);
      const comp = compileMultiTrackSlices(timelineClips || [], sp.mpTimelineSec, sp.timeBinSec, defaultTemp);
      for (let c = 0; c < cycles; c++) {
        for (const sl of comp.slices) {
          const s0 = t + sl.startSec;
          const s1 = t + sl.endSec;
          const slTemp = sl.effectiveTemp !== null ? sl.effectiveTemp : (thermEnabled ? defaultTemp : null);
          const isDark = sl.topLights.length === 0 && sl.bottomLights.length === 0;
          phaseSchedule.push({ startSec: s0, endSec: s1, phase: sl.csvTag, label: sl.overlayText, kind: isDark ? "dark" : "light", tempC: slTemp });
          if (slTemp !== null) {
            tempSchedule.push({ startSec: s0, endSec: s1, tempC: slTemp, label: `${slTemp}°C` });
          }
          if (sl.vibTrigger) {
            stimulusEvents.push({ timeSec: s0, label: `Vib ${sl.vibCode}`, type: "vib", detail: sl.csvTag });
          }
          if (sl.audioTrigger) {
            stimulusEvents.push({ timeSec: s0, label: `Audio ${sl.audioFile}`, type: "audio", detail: sl.csvTag });
          }
        }
        t += comp.totalSec;
      }
    } else if (stimId === "circadian") {
      const lightHrs = Math.max(0, parseInt(sp.lightHours, 10) || 16);
      const darkHrs = Math.max(0, parseInt(sp.darkHours, 10) || 8);
      const days = Math.max(1, parseInt(sp.numDays, 10) || 2);
      for (let d = 1; d <= days; d++) {
        if (lightHrs > 0) {
          phaseSchedule.push({ startSec: t, endSec: t + lightHrs * 3600, phase: activeLightTag, label: `Day ${d} ${activeLightTag}`, kind: "light", tempC: thermEnabled ? defaultTemp : null });
          t += lightHrs * 3600;
        }
        if (darkHrs > 0) {
          phaseSchedule.push({ startSec: t, endSec: t + darkHrs * 3600, phase: "DARK", label: `Day ${d} DARK`, kind: "dark", tempC: thermEnabled ? defaultTemp : null });
          t += darkHrs * 3600;
        }
      }
      if (thermEnabled) tempSchedule.push({ startSec: 0, endSec: t, tempC: defaultTemp, label: `${defaultTemp}°C` });
    }

    const targetTempC = tempSchedule.length > 0
      ? tempSchedule[0].tempC
      : (thermEnabled ? defaultTemp : null);

    return { targetTempC, tempSchedule, phaseSchedule, stimulusEvents };
  }

  function parseExperimentContext(objOrJson, sourceLabel) {
    let raw = objOrJson;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch (_) {
        return null;
      }
    }
    if (!raw || typeof raw !== "object") return null;

    // Accept either wrapped { format, version, experiment, plateGeometry } or direct experiment object
    const isWrapped = Boolean(raw.experiment && typeof raw.experiment === "object");
    if (isWrapped && raw.format && raw.format !== DEFAULT_EXPERIMENT_FORMAT) {
      return null;
    }
    const exp = isWrapped ? raw.experiment : raw;
    if (!exp || typeof exp !== "object" || (!exp.plateId && !exp.stimId && !exp.inputs)) {
      return null;
    }

    const catalog = getPlateCatalog();
    const inputs = exp.inputs && typeof exp.inputs === "object" ? exp.inputs : {};
    const stimParams = exp.stimParams && typeof exp.stimParams === "object" ? exp.stimParams : {};
    const plateId = catalog[exp.plateId] ? exp.plateId : (exp.plateId || "24well");
    const plateDef = catalog[plateId] || catalog["24well"] || FALLBACK_PLATES["24well"];
    const zoneMode = ["concentric", "half_tb", "half_lr"].includes(inputs.zoneMode) ? inputs.zoneMode : "concentric";

    // Resolve maze shapes & wells
    let mazeShapes = null;
    let wells;
    let numZones;
    let geo = null;

    if (plateDef.isMaze) {
      if (plateDef.isCustomMaze && exp.customMaze && Array.isArray(exp.customMaze.shapes)) {
        if (typeof sanitizeCustomMaze === "function") {
          mazeShapes = sanitizeCustomMaze(exp.customMaze).shapes;
        } else {
          mazeShapes = exp.customMaze.shapes.map((s, idx) => ({
            id: s.id || (idx + 1),
            type: String(s.type || "RECTANGLE").toUpperCase(),
            x: Number(s.x) || 64,
            y: Number(s.y) || 43,
            w: Number(s.w) || 10,
            h: Number(s.h) || Number(s.w) || 10,
            angle: Number(s.angle) || 0,
            arena: Math.max(1, parseInt(s.arena, 10) || 1),
            zone: Math.max(1, parseInt(s.zone, 10) || 1)
          }));
        }
      } else if (typeof buildBuiltinMazeShapes === "function") {
        mazeShapes = buildBuiltinMazeShapes(plateId);
      } else {
        mazeShapes = [];
      }

      let maxA = 0;
      let maxZ = 0;
      for (const s of mazeShapes) {
        if (s.arena > maxA) maxA = s.arena;
        if (s.zone > maxZ) maxZ = s.zone;
      }
      const numArenas = Math.max(1, maxA || (plateDef.rows * plateDef.cols) || 1);
      numZones = Math.max(1, maxZ || plateDef.defaultZones || 4);
      wells = [];
      for (let i = 1; i <= numArenas; i++) wells.push("A" + i);
    } else {
      const savedGeo = raw.plateGeometry && raw.plateGeometry.plateId === plateId ? raw.plateGeometry : null;
      geo = {
        xOffset: parseNumeric(savedGeo && savedGeo.xOffset) ?? plateDef.xOffset,
        yOffset: parseNumeric(savedGeo && savedGeo.yOffset) ?? plateDef.yOffset,
        colStep: parseNumeric(savedGeo && savedGeo.colStep) ?? plateDef.colStep,
        rowStep: parseNumeric(savedGeo && savedGeo.rowStep) ?? plateDef.rowStep,
        r: parseNumeric(savedGeo && savedGeo.r) ?? plateDef.r,
        rDz: parseNumeric(savedGeo && savedGeo.rDz) ?? plateDef.rDz
      };
      wells = makeWellLabels(plateDef.rows, plateDef.cols);
      numZones = 2;
    }

    const stimId = exp.stimId || "ld_transitions";
    const sched = buildContextSchedule(stimId, stimParams, inputs, exp.timelineClips);
    const zoneLabels = buildZoneLabels(plateId, numZones, zoneMode);
    const customLabel = (plateDef.isCustomMaze && exp.customMaze && exp.customMaze.name)
      ? String(exp.customMaze.name)
      : (plateDef.isCustomMaze ? `${plateDef.name} (${wells.length} arenas)` : plateDef.name);

    return {
      valid: true,
      source: sourceLabel || (raw.source || "json"),
      savedAt: raw.savedAt || null,
      researcher: String(inputs.userName || "").trim(),
      studyTag: String(inputs.expPrefix || "").trim(),
      hw: inputs.hwVersion === "Z2" ? "Z2" : "Z3",
      organismId: exp.organism || "custom",
      organismLabel: getOrganismLabel(exp.organism),
      plateId,
      plateName: customLabel,
      plate: {
        id: plateId,
        name: customLabel,
        shortCode: plateDef.shortCode || plateId,
        rows: plateDef.rows,
        cols: plateDef.cols,
        shape: plateDef.shape,
        isMaze: Boolean(plateDef.isMaze),
        isCustomMaze: Boolean(plateDef.isCustomMaze),
        wells,
        numWells: wells.length,
        numZones,
        geo,
        mazeShapes,
        zoneMode
      },
      zoneMode,
      zoneLabels,
      stimId,
      stimName: getStimulusName(stimId),
      stimParams,
      ledColor: String(inputs.ledColor || "WHITE").toUpperCase(),
      ledBrightness: parseNumeric(inputs.ledBrightness) ?? 100,
      ledMount: String(inputs.ledMount || "OVERHEAD").toUpperCase(),
      thermostatEnabled: inputs.chk_thermostat !== false || stimId === "temp_ramp",
      targetTempC: sched.targetTempC,
      tempSchedule: sched.tempSchedule,
      phaseSchedule: sched.phaseSchedule,
      stimulusEvents: sched.stimulusEvents,
      raw
    };
  }

  async function readExperimentJsonFromZipFallback(buffer) {
    const ab = buffer instanceof ArrayBuffer
      ? buffer
      : (ArrayBuffer.isView(buffer) ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : null);
    if (!ab || ab.byteLength < 22) throw new Error("Not a valid .zip file.");

    const bytes = new Uint8Array(ab);
    const dv = new DataView(ab);
    let eocd = -1;
    const minOff = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= minOff; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Not a valid .zip file.");

    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();

    for (let n = 0; n < count; n++) {
      if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;

      if (!(name === EXPERIMENT_ZIP_ENTRY || name.endsWith("/" + EXPERIMENT_ZIP_ENTRY))) continue;
      if (localOff + 30 > bytes.length || dv.getUint32(localOff, true) !== 0x04034b50) {
        throw new Error("Corrupted local header in .zip file.");
      }
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = bytes.subarray(start, start + compSize);
      if (method === 0) {
        return decoder.decode(data);
      }
      if (method === 8 && typeof DecompressionStream === "function") {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return await new Response(stream).text();
      }
      throw new Error("Compressed .zip method unsupported; unzip and load experiment.json directly.");
    }
    throw new Error("No experiment.json found in this .zip archive.");
  }

  async function loadContextFromZip(arrayBuffer) {
    const ab = arrayBuffer instanceof ArrayBuffer
      ? arrayBuffer
      : (ArrayBuffer.isView(arrayBuffer)
          ? arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength)
          : null);
    if (!ab) throw new Error("Expected ArrayBuffer or TypedArray for .zip input.");

    let text;
    if (typeof readExperimentFromZip === "function") {
      text = await readExperimentFromZip(ab);
    } else {
      text = await readExperimentJsonFromZipFallback(ab);
    }
    const ctx = parseExperimentContext(text, "zip");
    if (!ctx) throw new Error("experiment.json inside .zip is not a valid Script Builder experiment.");
    return ctx;
  }

  function loadLatestBuilderContext() {
    try {
      if (typeof localStorage === "undefined") return null;
      const key = (typeof STORAGE_KEY_EXPERIMENT !== "undefined" && STORAGE_KEY_EXPERIMENT)
        ? STORAGE_KEY_EXPERIMENT
        : DEFAULT_STORAGE_KEY;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return parseExperimentContext(raw, "localStorage");
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Plate / Maze Layout Resolver (for Interactive SVG Plate Map)
  // ---------------------------------------------------------------------------
  function build15YMazeShapes() {
    const out = [];
    let nid = 1;
    const xCenters = [16.7, 40.3, 63.9, 87.5, 111.1];
    const yCenters = [16.75, 42.75, 68.75];
    const R = 5.6;
    const L = 9.4;
    const W = 3.6;
    const yAdj = R / 2;
    const xAdj = 1.732 * yAdj;
    let arena = 1;
    for (let r = 0; r < yCenters.length; r++) {
      for (let c = 0; c < xCenters.length; c++) {
        const cx = xCenters[c];
        const cy = yCenters[r];
        const flip = (r % 2 === 1);
        if (!flip) {
          out.push({ id: nid++, type: "RECTANGLE", x: roundNum(cx - xAdj, 2), y: roundNum(cy - yAdj, 2), w: L, h: W, angle: 30, arena, zone: 1 });
          out.push({ id: nid++, type: "RECTANGLE", x: roundNum(cx + xAdj, 2), y: roundNum(cy - yAdj, 2), w: L, h: W, angle: 150, arena, zone: 2 });
          out.push({ id: nid++, type: "RECTANGLE", x: roundNum(cx, 2), y: roundNum(cy + R, 2), w: L, h: W, angle: 270, arena, zone: 3 });
          out.push({ id: nid++, type: "TRIANGLE", x: roundNum(cx, 2), y: roundNum(cy, 2), w: W, h: W, angle: 0, arena, zone: 4 });
        } else {
          out.push({ id: nid++, type: "RECTANGLE", x: roundNum(cx, 2), y: roundNum(cy - R, 2), w: W, h: L, angle: 0, arena, zone: 1 });
          out.push({ id: nid++, type: "RECTANGLE", x: roundNum(cx + xAdj, 2), y: roundNum(cy + yAdj, 2), w: L, h: W, angle: 30, arena, zone: 2 });
          out.push({ id: nid++, type: "RECTANGLE", x: roundNum(cx - xAdj, 2), y: roundNum(cy + yAdj, 2), w: L, h: W, angle: 150, arena, zone: 3 });
          out.push({ id: nid++, type: "TRIANGLE", x: roundNum(cx, 2), y: roundNum(cy, 2), w: W, h: W, angle: 180, arena, zone: 4 });
        }
        arena++;
      }
    }
    return out;
  }

  function computeMazeWellCoords(wells, shapes) {
    const coords = {};
    const byArena = {};
    for (const s of (shapes || [])) {
      const a = s.arena || 1;
      if (!byArena[a]) byArena[a] = [];
      byArena[a].push(s);
    }

    for (let i = 0; i < wells.length; i++) {
      const w = wells[i];
      const m = w.match(/(\d+)$/);
      const arenaNum = m ? parseInt(m[1], 10) : (i + 1);
      const list = byArena[arenaNum] || [];
      if (list.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let sumX = 0, sumY = 0;
        for (const s of list) {
          const halfW = s.type === "DISC" ? s.w : (s.w / 2);
          const halfH = s.type === "DISC" ? s.w : ((s.h || s.w) / 2);
          minX = Math.min(minX, s.x - halfW);
          maxX = Math.max(maxX, s.x + halfW);
          minY = Math.min(minY, s.y - halfH);
          maxY = Math.max(maxY, s.y + halfH);
          sumX += s.x;
          sumY += s.y;
        }
        const bw = Math.max(4, maxX - minX);
        const bh = Math.max(4, maxY - minY);
        coords[w] = {
          x: roundNum(sumX / list.length, 2),
          y: roundNum(sumY / list.length, 2),
          r: roundNum(Math.min(bw, bh) / 2, 2),
          w: roundNum(bw, 2),
          h: roundNum(bh, 2),
          shape: "MAZE",
          row: 0,
          col: i,
          arenaNum
        };
      }
    }
    return coords;
  }

  function computeGridWellCoords(wells, rows, cols, shape, geo) {
    const coords = {};
    const useStdGeo = geo && Number.isFinite(geo.xOffset) && Number.isFinite(geo.yOffset) &&
      Number.isFinite(geo.colStep) && Number.isFinite(geo.rowStep) && Number.isFinite(geo.r);

    const padX = 11;
    const padY = 9;
    const availW = SBS_W_MM - padX * 2;
    const availH = SBS_H_MM - padY * 2;
    const autoColStep = cols > 1 ? availW / (cols - 1) : 0;
    const autoRowStep = rows > 1 ? availH / (rows - 1) : 0;
    const cellW = cols > 1 ? Math.min(autoColStep, availW / cols) : availW * 0.7;
    const cellH = rows > 1 ? Math.min(autoRowStep, availH / rows) : availH * 0.7;
    const autoRadius = Math.max(2.2, Math.min(cellW, cellH) * 0.42);

    for (let i = 0; i < wells.length; i++) {
      const w = wells[i];
      let rIdx = Math.floor(i / Math.max(1, cols));
      let cIdx = i % Math.max(1, cols);

      const m = w.match(/^([A-Z])(\d+)$/);
      if (m && rows > 1 && m[1].charCodeAt(0) - 65 < rows && parseInt(m[2], 10) - 1 < cols) {
        rIdx = m[1].charCodeAt(0) - 65;
        cIdx = parseInt(m[2], 10) - 1;
      }

      if (useStdGeo) {
        const cx = geo.xOffset + cIdx * geo.colStep;
        const cy = geo.yOffset + rIdx * geo.rowStep;
        const radius = shape === "SQUARE" ? geo.r / 2 : geo.r;
        const side = shape === "SQUARE" ? geo.r : geo.r * 2;
        coords[w] = {
          x: roundNum(cx, 2),
          y: roundNum(cy, 2),
          r: roundNum(radius, 2),
          w: roundNum(side, 2),
          h: roundNum(side, 2),
          shape: shape || "DISC",
          row: rIdx,
          col: cIdx,
          arenaNum: i + 1
        };
      } else {
        const cx = cols === 1 ? SBS_W_MM / 2 : (padX + (cIdx / (cols - 1)) * availW);
        const cy = rows === 1 ? SBS_H_MM / 2 : (padY + (rIdx / (rows - 1)) * availH);
        coords[w] = {
          x: roundNum(cx, 2),
          y: roundNum(cy, 2),
          r: roundNum(autoRadius, 2),
          w: roundNum(autoRadius * 2, 2),
          h: roundNum(autoRadius * 2, 2),
          shape: shape === "SQUARE" ? "SQUARE" : "DISC",
          row: rIdx,
          col: cIdx,
          arenaNum: i + 1
        };
      }
    }
    return coords;
  }

  function getPlateLayout(parsed, context) {
    const catalog = getPlateCatalog();
    const parsedWells = (parsed && Array.isArray(parsed.wells) && parsed.wells.length > 0) ? parsed.wells : null;
    const ctxPlate = (context && context.plate) ? context.plate : null;

    // Check if context plate matches parsed CSV wells
    let contextMatchesCsv = false;
    if (ctxPlate && parsedWells) {
      const s = new Set(parsedWells);
      contextMatchesCsv = ctxPlate.wells.length === parsedWells.length && ctxPlate.wells.every(w => s.has(w));
    }

    if (ctxPlate && (!parsedWells || contextMatchesCsv)) {
      const wells = parsedWells || ctxPlate.wells;
      const maxZone = Math.max(parsed ? (parsed.maxZone || 0) : 0, ctxPlate.numZones || 0);
      const isMaze = Boolean(ctxPlate.isMaze);
      const mazeShapes = isMaze ? (ctxPlate.mazeShapes || []) : null;
      const wellCoords = isMaze && mazeShapes && mazeShapes.length > 0
        ? computeMazeWellCoords(wells, mazeShapes)
        : computeGridWellCoords(wells, ctxPlate.rows || 1, ctxPlate.cols || wells.length, ctxPlate.shape, ctxPlate.geo);

      // Fill any missing arena coords with fallback grid
      if (isMaze && Object.keys(wellCoords).length < wells.length) {
        const fallbackCoords = computeGridWellCoords(wells, ctxPlate.rows || 1, ctxPlate.cols || wells.length, "DISC", null);
        for (const w of wells) if (!wellCoords[w]) wellCoords[w] = fallbackCoords[w];
      }

      return {
        id: ctxPlate.id,
        name: ctxPlate.name,
        isMaze,
        shape: ctxPlate.shape,
        rows: ctxPlate.rows,
        cols: ctxPlate.cols,
        wells: wells.slice(),
        plateW: SBS_W_MM,
        plateH: SBS_H_MM,
        geo: ctxPlate.geo || null,
        mazeShapes,
        wellCoords,
        zoneMode: context.zoneMode || "concentric",
        maxZone,
        zoneLabels: buildZoneLabels(ctxPlate.id, maxZone, context.zoneMode || "concentric")
      };
    }

    // Infer directly from parsed CSV
    const inf = (parsed && parsed.inferredLayout) ? parsed.inferredLayout : inferLayoutFromWells(parsedWells || [], parsed ? parsed.maxZone : 0);
    const plateDef = catalog[inf.id] || null;
    const wells = inf.wells || [];
    const maxZone = (parsed && parsed.maxZone) || inf.maxZone || 0;
    let mazeShapes = null;
    let geo = null;

    if (plateDef && plateDef.isMaze && typeof buildBuiltinMazeShapes === "function") {
      mazeShapes = buildBuiltinMazeShapes(plateDef.id);
    } else if (inf.id === "auto_maze" && wells.length === 15 && maxZone === 4) {
      mazeShapes = build15YMazeShapes();
    } else if (plateDef && !plateDef.isMaze) {
      geo = {
        xOffset: plateDef.xOffset,
        yOffset: plateDef.yOffset,
        colStep: plateDef.colStep,
        rowStep: plateDef.rowStep,
        r: plateDef.r,
        rDz: plateDef.rDz
      };
    }

    const wellCoords = (inf.isMaze && mazeShapes && mazeShapes.length > 0)
      ? computeMazeWellCoords(wells, mazeShapes)
      : computeGridWellCoords(wells, inf.rows || 1, inf.cols || Math.max(1, wells.length), inf.shape, geo);

    return {
      id: inf.id,
      name: inf.name,
      isMaze: Boolean(inf.isMaze),
      shape: inf.shape,
      rows: inf.rows,
      cols: inf.cols,
      wells: wells.slice(),
      plateW: SBS_W_MM,
      plateH: SBS_H_MM,
      geo,
      mazeShapes,
      wellCoords,
      zoneMode: (context && context.zoneMode) || "concentric",
      maxZone,
      zoneLabels: buildZoneLabels(inf.id, maxZone, (context && context.zoneMode) || "concentric")
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Built-in Realistic Demo Datasets (Seeded & Exact Builder Schemas)
  // ---------------------------------------------------------------------------
  function createPrng(seed) {
    let s = (seed >>> 0) || 1;
    return function next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function nextNormal(rng) {
    const u1 = Math.max(1e-9, rng());
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function getDemoPresets() {
    return [
      {
        id: "ld_24w",
        name: "24-Well Light/Dark Cycles (VMR)",
        shortName: "L/D 24-Well",
        description: "2x300s Light/Dark cycles (10s bins) · 3 drug groups · DIST + MSD + Z1/Z2 · 1 empty (D5) & 1 spike glitch (D6)"
      },
      {
        id: "ppi_24w",
        name: "24-Well Prepulse Inhibition (PPI)",
        shortName: "PPI 24-Well",
        description: "Alternating PULSE_ALONE & PPI_TRIAL (1s bins) · Control vs Low Dose vs MK-801 sensorimotor gating (% PPI)"
      },
      {
        id: "ymaze_15",
        name: "15-Arena Y-Maze (Z1–Z4 + _ZCHANGE)",
        shortName: "Y-Maze 15",
        description: "15 Y-Mazes (A1–A15, 4 zones) · Summary + _ZCHANGE event CSV · Spontaneous Alternation (SAB %) & Transition Matrix"
      }
    ];
  }

  function generateLd24Demo() {
    const rng = createPrng(20260401);
    const wells = makeWellLabels(4, 6); // A1..D6
    const binSec = 10;
    const phaseBins = 30; // 300s per phase
    const cycles = 2;
    const totalRows = cycles * 2 * phaseBins; // 120 rows

    const defaultGroups = {};
    for (const w of wells) {
      const col = parseInt(w.slice(1), 10);
      if (col <= 2) defaultGroups[w] = "Control";
      else if (col <= 4) defaultGroups[w] = "Drug 1uM";
      else defaultGroups[w] = "Drug 10uM";
    }
    const groupPalette = {
      "Control": GROUP_PALETTE[0],
      "Drug 1uM": GROUP_PALETTE[1],
      "Drug 10uM": GROUP_PALETTE[2]
    };

    // Individual biological variability per well
    const wellFactor = {};
    for (const w of wells) {
      wellFactor[w] = 0.86 + rng() * 0.28;
    }

    const glitchBins = new Map([
      [18, 268.4],
      [44, 342.7],
      [79, 294.1],
      [105, 412.6]
    ]);

    const header = [
      "RUNTIME", "UNIT_ID", "TEMP_C", "PHASE", "TRIAL", "TIME_BIN",
      ...wells.map(w => `DIST_${w}`),
      ...wells.map(w => `MSD_${w}`),
      ...wells.flatMap(w => [`ZD_${w}_Z1`, `ZD_${w}_Z2`]),
      ...wells.flatMap(w => [`ZC_${w}_Z1`, `ZC_${w}_Z2`]),
      ...wells.flatMap(w => [`ZT_${w}_Z1`, `ZT_${w}_Z2`])
    ];

    const lines = [header.join(",")];
    const startRuntime = 180; // 120s acclim + 60s autoref

    for (let i = 0; i < totalRows; i++) {
      const cycle = Math.floor(i / (phaseBins * 2)) + 1;
      const inCycle = i % (phaseBins * 2);
      const isDark = inCycle >= phaseBins;
      const phase = isDark ? "DARK" : "LIGHT";
      const inPhaseBin = isDark ? (inCycle - phaseBins) : inCycle;
      const runtime = startRuntime + (i + 1) * binSec;

      // Realistic Peltier curve settling to 28.0 °C
      const tempC = 28.0 - 0.35 * Math.exp(-i / 18) + 0.09 * Math.sin(i / 7) + nextNormal(rng) * 0.03;

      const distRow = [];
      const msdRow = [];
      const zdRow = [];
      const zcRow = [];
      const ztRow = [];

      for (const w of wells) {
        if (w === "D5") {
          // Empty / dead well
          distRow.push("0.00");
          msdRow.push("0.00");
          zdRow.push("0.00", "0.00");
          zcRow.push("0", "0");
          ztRow.push("0.00", "0.00");
          continue;
        }

        const grp = defaultGroups[w];
        const f = wellFactor[w];
        let baseDist;
        let z2Frac;

        if (grp === "Control") {
          if (!isDark) {
            baseDist = (13.5 + 3.0 * Math.exp(-inPhaseBin / 3)) * f;
            z2Frac = 0.38;
          } else {
            // Classic zebrafish VMR: sharp dark-onset hyperactivity burst decaying to elevated plateau
            baseDist = (25.5 + 16.5 * Math.exp(-inPhaseBin / 4.2)) * f;
            z2Frac = 0.25; // stronger wall-hugging (thigmotaxis) in dark
          }
        } else if (grp === "Drug 1uM") {
          if (!isDark) {
            baseDist = (11.5 + 2.0 * Math.exp(-inPhaseBin / 3)) * f;
            z2Frac = 0.48; // anxiolytic: more inner-zone exploration
          } else {
            baseDist = (18.5 + 10.5 * Math.exp(-inPhaseBin / 4.0)) * f;
            z2Frac = 0.42;
          }
        } else {
          // Drug 10uM: sedated / blunted VMR
          if (!isDark) {
            baseDist = 6.2 * f;
            z2Frac = 0.52;
          } else {
            baseDist = (9.2 + 3.5 * Math.exp(-inPhaseBin / 3.5)) * f;
            z2Frac = 0.49;
          }
        }

        // Keep healthy wells cleanly within 0.5..47.5 mm/bin so zero false glitch spikes occur
        let d = Math.max(0.4, Math.min(47.2, baseDist + nextNormal(rng) * (baseDist * 0.11)));
        let m = Math.max(1.0, d * 4.2 + 8 + nextNormal(rng) * 4.5);

        if (w === "D6" && glitchBins.has(i)) {
          // Reflection glitch spike
          d = glitchBins.get(i);
          m = d * 5.8;
        }

        const z2Share = Math.min(0.92, Math.max(0.06, z2Frac + nextNormal(rng) * 0.06));
        const z1Share = 1 - z2Share;
        const zt2 = binSec * z2Share;
        const zt1 = binSec - zt2;
        const zd2 = d * z2Share;
        const zd1 = d - zd2;
        const crossRate = Math.max(0, Math.round((d / 12) + rng() * 1.6));
        const zc1 = Math.max(0, Math.round(crossRate * (0.45 + rng() * 0.2)));
        const zc2 = Math.max(0, crossRate - zc1 + (d > 5 ? 1 : 0));

        distRow.push(d.toFixed(2));
        msdRow.push(m.toFixed(2));
        zdRow.push(zd1.toFixed(2), zd2.toFixed(2));
        zcRow.push(String(zc1), String(zc2));
        ztRow.push(zt1.toFixed(2), zt2.toFixed(2));
      }

      lines.push([
        runtime.toFixed(1),
        "MWP-Z3-0142",
        tempC.toFixed(2),
        phase,
        String(cycle),
        String(i + 1),
        ...distRow,
        ...msdRow,
        ...zdRow,
        ...zcRow,
        ...ztRow
      ].join(","));
    }

    const experimentPayload = {
      format: DEFAULT_EXPERIMENT_FORMAT,
      version: 1,
      savedAt: "2026-04-01T10:15:00.000Z",
      experiment: {
        organism: "zebrafish",
        plateId: "24well",
        stimId: "ld_transitions",
        inputs: {
          userName: "Demo Assay",
          expPrefix: "vmr_dose",
          hwVersion: "Z3",
          ledColor: "WHITE",
          ledMount: "OVERHEAD",
          ledBrightness: "100",
          targetSize: "2",
          detThreshold: "6",
          msdThreshold: "6",
          autorefTimeout: "60",
          thermostatTemp: "28",
          chk_thermostat: true,
          chk_dist: true,
          chk_msd: true,
          chk_zones: true,
          chk_xy: false,
          zoneMode: "concentric",
          videoMode: "1fps",
          chk_tracks: true,
          chk_heatmap: false
        },
        stimParams: {
          acclimSec: 120,
          timeBinSec: 10,
          ldStart: "LIGHT",
          ldPhaseSec: 300,
          ldCycles: 2
        },
        timelineClips: [],
        showUnderTracks: false
      },
      plateGeometry: { plateId: "24well", ...FALLBACK_PLATES["24well"] }
    };

    return {
      presetId: "ld_24w",
      name: "24-Well Light/Dark Cycles (VMR)",
      description: "24-well zebrafish VMR assay (2x300s Light/Dark, 10s bins) with 3 dose groups, empty well D5, and reflection-glitch well D6.",
      summaryFilename: "demo_vmr_ld_2x300s_24w.csv",
      summaryCsvText: lines.join("\n") + "\n",
      zchangeFilename: null,
      zchangeCsvText: null,
      experimentPayload,
      experimentContext: parseExperimentContext(experimentPayload, "demo"),
      defaultGroups,
      groupPalette,
      defaultExcluded: []
    };
  }

  function generatePpi24Demo() {
    const rng = createPrng(20260402);
    const wells = makeWellLabels(4, 6);
    const binSec = 1;
    const preBins = 20;
    const itiBins = 15;
    const pairs = 5; // 10 alternating trials

    const defaultGroups = {};
    for (const w of wells) {
      const col = parseInt(w.slice(1), 10);
      if (col <= 2) defaultGroups[w] = "Control";
      else if (col <= 4) defaultGroups[w] = "Low Dose";
      else defaultGroups[w] = "MK-801";
    }
    const groupPalette = {
      "Control": GROUP_PALETTE[0],
      "Low Dose": GROUP_PALETTE[3],
      "MK-801": GROUP_PALETTE[4]
    };

    const wellFactor = {};
    for (const w of wells) wellFactor[w] = 0.85 + rng() * 0.30;

    // Build trial schedule
    const schedule = [];
    for (let i = 0; i < preBins; i++) schedule.push({ phase: "BASELINE", trial: 0 });
    let tr = 0;
    for (let pair = 0; pair < pairs; pair++) {
      tr++;
      schedule.push({ phase: "PULSE_ALONE", trial: tr, pairIdx: pair });
      for (let k = 0; k < itiBins; k++) schedule.push({ phase: "ITI", trial: tr, postStim: k + 1 });
      tr++;
      schedule.push({ phase: "PPI_TRIAL", trial: tr, pairIdx: pair });
      for (let k = 0; k < itiBins; k++) schedule.push({ phase: "ITI", trial: tr, postStim: k + 1 });
    }

    const header = [
      "RUNTIME", "UNIT_ID", "TEMP_C", "PHASE", "TRIAL", "TIME_BIN",
      ...wells.map(w => `DIST_${w}`),
      ...wells.map(w => `MSD_${w}`)
    ];
    const lines = [header.join(",")];
    const startRuntime = 120;

    for (let i = 0; i < schedule.length; i++) {
      const step = schedule[i];
      const runtime = startRuntime + (i + 1) * binSec;
      const tempC = 28.0 + 0.06 * Math.sin(i / 14) + nextNormal(rng) * 0.02;

      const distRow = [];
      const msdRow = [];

      for (const w of wells) {
        const grp = defaultGroups[w];
        const f = wellFactor[w];
        let d;
        if (step.phase === "BASELINE") {
          d = Math.max(0.3, (2.2 + nextNormal(rng) * 0.6) * f);
        } else if (step.phase === "ITI") {
          const tail = step.postStim <= 2 ? (3.0 / step.postStim) : 0;
          d = Math.max(0.3, (2.1 + tail + nextNormal(rng) * 0.55) * f);
        } else if (step.phase === "PULSE_ALONE") {
          // Slight natural startle habituation across pairs (stays cleanly < 45 mm/s)
          const habit = 1 - step.pairIdx * 0.035;
          const baseStartle = grp === "MK-801" ? 29.0 : 27.5;
          d = Math.max(12.0, Math.min(44.0, (baseStartle * habit + nextNormal(rng) * 2.4) * f));
        } else {
          // PPI_TRIAL: distinct group inhibition
          const habit = 1 - step.pairIdx * 0.03;
          let targetStartle;
          if (grp === "Control") targetStartle = 7.6;      // ~72% PPI
          else if (grp === "Low Dose") targetStartle = 14.5; // ~47% PPI
          else targetStartle = 24.4;                         // ~15% PPI (impaired gating)
          d = Math.max(2.5, Math.min(42.0, (targetStartle * habit + nextNormal(rng) * 1.7) * f));
        }
        const m = Math.max(2.0, d * 5.2 + 6 + nextNormal(rng) * 3.0);
        distRow.push(d.toFixed(2));
        msdRow.push(m.toFixed(2));
      }

      lines.push([
        runtime.toFixed(1),
        "MWP-Z3-0142",
        tempC.toFixed(2),
        step.phase,
        String(step.trial),
        String(i + 1),
        ...distRow,
        ...msdRow
      ].join(","));
    }

    const experimentPayload = {
      format: DEFAULT_EXPERIMENT_FORMAT,
      version: 1,
      savedAt: "2026-04-02T11:30:00.000Z",
      experiment: {
        organism: "zebrafish",
        plateId: "24well",
        stimId: "ppi",
        inputs: {
          userName: "Demo Assay",
          expPrefix: "ppi_screen",
          hwVersion: "Z3",
          ledColor: "WHITE",
          ledMount: "OVERHEAD",
          ledBrightness: "100",
          targetSize: "2",
          detThreshold: "6",
          msdThreshold: "6",
          autorefTimeout: "60",
          thermostatTemp: "28",
          chk_thermostat: true,
          chk_dist: true,
          chk_msd: true,
          chk_zones: false,
          chk_xy: false,
          videoMode: "1fps",
          chk_tracks: true,
          chk_heatmap: false
        },
        stimParams: {
          acclimSec: 60,
          timeBinSec: 1,
          preBaselineSec: 20,
          itiSec: 15,
          ppiPairs: 5,
          ppiIsiMs: 300,
          ppiPrepulse: "U3",
          ppiPulse: "U0",
          ppiPattern: "alternating",
          ppiAmbient: "DARK"
        },
        timelineClips: [],
        showUnderTracks: false
      },
      plateGeometry: { plateId: "24well", ...FALLBACK_PLATES["24well"] }
    };

    return {
      presetId: "ppi_24w",
      name: "24-Well Prepulse Inhibition (PPI)",
      description: "24-well alternating PULSE_ALONE and PPI_TRIAL vibration startle protocol showing strong Control PPI (~72%) vs impaired MK-801 gating (~15%).",
      summaryFilename: "demo_ppi_300ms_5x_24w.csv",
      summaryCsvText: lines.join("\n") + "\n",
      zchangeFilename: null,
      zchangeCsvText: null,
      experimentPayload,
      experimentContext: parseExperimentContext(experimentPayload, "demo"),
      defaultGroups,
      groupPalette,
      defaultExcluded: []
    };
  }

  function generateYMaze15Demo() {
    const rng = createPrng(20260403);
    const wells = [];
    for (let i = 1; i <= 15; i++) wells.push("A" + i);
    const binSec = 10;
    const totalRows = 60; // 600s
    const totalSec = totalRows * binSec;

    const defaultGroups = {};
    for (let i = 0; i < wells.length; i++) {
      if (i < 5) defaultGroups[wells[i]] = "Control";
      else if (i < 10) defaultGroups[wells[i]] = "Scopolamine";
      else defaultGroups[wells[i]] = "Rescue";
    }
    const groupPalette = {
      "Control": GROUP_PALETTE[0],
      "Scopolamine": GROUP_PALETTE[4],
      "Rescue": GROUP_PALETTE[1]
    };

    // Simulate continuous-time arm-center walk per arena so Summary CSV & _ZCHANGE are 100% consistent!
    const allEvents = [];
    // Per bin & per arena accumulators
    const binDist = Array.from({ length: totalRows }, () => ({}));
    const binZd = Array.from({ length: totalRows }, () => ({}));
    const binZc = Array.from({ length: totalRows }, () => ({}));
    const binZt = Array.from({ length: totalRows }, () => ({}));
    for (let b = 0; b < totalRows; b++) {
      for (const w of wells) {
        binDist[b][w] = 0;
        binZd[b][w] = [0, 0, 0, 0];
        binZc[b][w] = [0, 0, 0, 0];
        binZt[b][w] = [0, 0, 0, 0];
      }
    }

    const startOffset = 120; // acclim + autoref offset in RUNTIME

    for (const w of wells) {
      const grp = defaultGroups[w];
      // Target spontaneous alternation probability when leaving center after visiting prevArm -> curArm
      const pAlt = grp === "Control" ? 0.72 : (grp === "Scopolamine" ? 0.44 : 0.64);
      const pReenterSame = grp === "Scopolamine" ? 0.14 : 0.04;
      const baseSpeed = (grp === "Scopolamine" ? 2.1 : 2.5) * (0.88 + rng() * 0.24); // mm/s

      let curZone = 1 + Math.floor(rng() * 3); // start in Arm 1, 2, or 3
      let lastArm = curZone;
      let prevArm = null;
      let t = 0;

      // Record initial zone entry at t=0.2s
      allEvents.push({ time: startOffset + 0.2, arena: w, action: "ENTER", zone: curZone });
      binZc[0][w][curZone - 1] += 1;

      while (t < totalSec) {
        const dwell = curZone === 4
          ? (1.2 + rng() * 2.4)       // short transit through center hub (Z4)
          : (7.5 + rng() * 11.5);     // arm exploration (Z1..Z3)
        const nextT = Math.min(totalSec, t + dwell);

        // Split [t, nextT] across 10s bins
        let segStart = t;
        while (segStart < nextT) {
          const bIdx = Math.min(totalRows - 1, Math.floor(segStart / binSec));
          const binEnd = (bIdx + 1) * binSec;
          const segEnd = Math.min(nextT, binEnd);
          const dt = segEnd - segStart;
          const speedNoise = Math.max(0.4, baseSpeed + nextNormal(rng) * 0.45);
          const segDist = dt * speedNoise;

          binZt[bIdx][w][curZone - 1] += dt;
          binZd[bIdx][w][curZone - 1] += segDist;
          binDist[bIdx][w] += segDist;
          segStart = segEnd;
        }

        if (nextT >= totalSec) break;
        t = nextT;

        // Choose next zone
        let nextZone;
        if (curZone !== 4) {
          // From an arm, transition into Center Hub (Z4)
          nextZone = 4;
        } else {
          // From Center Hub (Z4), choose one of the 3 arms (1, 2, 3)
          const otherArms = [1, 2, 3].filter(a => a !== lastArm);
          const u = rng();
          if (u < pReenterSame) {
            nextZone = lastArm;
          } else if (prevArm !== null && prevArm !== lastArm) {
            const altArm = otherArms.find(a => a !== prevArm) || otherArms[0];
            const backArm = prevArm;
            nextZone = rng() < pAlt ? altArm : backArm;
          } else {
            nextZone = otherArms[Math.floor(rng() * otherArms.length)];
          }
          prevArm = lastArm;
          lastArm = nextZone;
        }

        allEvents.push({ time: startOffset + t, arena: w, action: "EXIT", zone: curZone });
        allEvents.push({ time: startOffset + t + 0.05, arena: w, action: "ENTER", zone: nextZone });

        const enterBin = Math.min(totalRows - 1, Math.floor(t / binSec));
        binZc[enterBin][w][nextZone - 1] += 1;
        curZone = nextZone;
      }
    }

    // Build Summary CSV matching Builder schema
    const header = [
      "RUNTIME", "UNIT_ID", "TEMP_C", "PHASE", "TIME_BIN",
      ...wells.map(w => `DIST_${w}`),
      ...wells.flatMap(w => [1, 2, 3, 4].map(z => `ZD_${w}_Z${z}`)),
      ...wells.flatMap(w => [1, 2, 3, 4].map(z => `ZC_${w}_Z${z}`)),
      ...wells.flatMap(w => [1, 2, 3, 4].map(z => `ZT_${w}_Z${z}`))
    ];
    const sumLines = [header.join(",")];
    for (let b = 0; b < totalRows; b++) {
      const runtime = startOffset + (b + 1) * binSec;
      const tempC = 22.0 + 0.08 * Math.sin(b / 9) + nextNormal(rng) * 0.025;
      sumLines.push([
        runtime.toFixed(1),
        "MWP-Z3-0142",
        tempC.toFixed(2),
        "LIGHT",
        String(b + 1),
        ...wells.map(w => binDist[b][w].toFixed(2)),
        ...wells.flatMap(w => binZd[b][w].map(v => v.toFixed(2))),
        ...wells.flatMap(w => binZc[b][w].map(v => String(v))),
        ...wells.flatMap(w => binZt[b][w].map(v => v.toFixed(2)))
      ].join(","));
    }

    // Build _ZCHANGE CSV matching exact Builder SETUP_ZCHANGE_HEADERS ("TIME,,,ARENA,ACTION,ZONE")
    allEvents.sort((a, b) => a.time - b.time);
    const zcLines = ["TIME,,,ARENA,ACTION,ZONE"];
    for (const ev of allEvents) {
      zcLines.push(`${ev.time.toFixed(2)},,,${ev.arena},${ev.action},Z${ev.zone}`);
    }

    const shapes15 = build15YMazeShapes();
    const experimentPayload = {
      format: DEFAULT_EXPERIMENT_FORMAT,
      version: 1,
      savedAt: "2026-04-03T09:45:00.000Z",
      experiment: {
        organism: "daphnia",
        plateId: "custom_maze",
        stimId: "baseline",
        inputs: {
          userName: "Demo Assay",
          expPrefix: "ymaze_sab",
          hwVersion: "Z3",
          ledColor: "WHITE",
          ledMount: "OVERHEAD",
          ledBrightness: "80",
          targetSize: "4",
          detThreshold: "8",
          msdThreshold: "6",
          autorefTimeout: "60",
          thermostatTemp: "22",
          chk_thermostat: true,
          chk_dist: true,
          chk_msd: false,
          chk_zones: true,
          chk_zchange: true,
          chk_xy: false,
          videoMode: "1fps",
          chk_tracks: true,
          chk_heatmap: false
        },
        stimParams: {
          baseLight: "LIGHT",
          acclimSec: 60,
          durationSec: 600,
          timeBinSec: 10
        },
        timelineClips: [],
        showUnderTracks: false,
        customMaze: {
          templateId: "single_ymaze",
          name: "15-Arena Y-Maze",
          arenaBmp: "a15YMaze",
          zoneBmp: "z15YMaze",
          colorBy: "zone",
          shapes: shapes15
        }
      },
      plateGeometry: null
    };

    return {
      presetId: "ymaze_15",
      name: "15-Arena Y-Maze (Z1–Z4 + _ZCHANGE)",
      description: "15-arena Y-Maze summary CSV (Z1–Z3 arms, Z4 center) paired with _ZCHANGE transition event log showing Spontaneous Alternation (SAB %) differences.",
      summaryFilename: "demo_ymaze_baseline_15a.csv",
      summaryCsvText: sumLines.join("\n") + "\n",
      zchangeFilename: "demo_ymaze_baseline_15a_ZCHANGE.csv",
      zchangeCsvText: zcLines.join("\n") + "\n",
      experimentPayload,
      experimentContext: parseExperimentContext(experimentPayload, "demo"),
      defaultGroups,
      groupPalette,
      defaultExcluded: []
    };
  }

  function generateDemoDataset(presetId) {
    if (presetId === "ppi_24w") return generatePpi24Demo();
    if (presetId === "ymaze_15") return generateYMaze15Demo();
    return generateLd24Demo();
  }

  // ---------------------------------------------------------------------------
  // 5. Phase Classification & Protocol Analysis Engine
  // ---------------------------------------------------------------------------
  function classifyPhase(phaseRaw) {
    const p = String(phaseRaw || "").trim().toUpperCase();
    if (!p) return { kind: "other", colorHint: "neutral", isLight: false, isDark: false, isStim: false, stimType: null };

    if (/^PULSE_ALONE\b/.test(p)) {
      return { kind: "stim", colorHint: "stim", isLight: false, isDark: false, isStim: true, stimType: "pulse_alone" };
    }
    if (/^PPI_TRIAL\b/.test(p)) {
      return { kind: "stim", colorHint: "ppi", isLight: false, isDark: false, isStim: true, stimType: "ppi" };
    }
    if (/^(STARTLE|VIBRATION|AUDIO_PULSE)\b/.test(p) || /(_FLASH|_HZ|_VU[0-3]|_AUD)$/.test(p)) {
      const stimType = /VIB|_VU[0-3]/.test(p) ? "vib" : (/AUD/.test(p) ? "audio" : "light_pulse");
      return { kind: "stim", colorHint: "stim", isLight: false, isDark: false, isStim: true, stimType };
    }
    if (/^DARK\b/.test(p) || /^S\d+_DARK(_|$)/.test(p) || /^DUSK\b/.test(p)) {
      return { kind: "dark", colorHint: "dark", isLight: false, isDark: true, isStim: false, stimType: null };
    }
    if (/^TEMP_[\d.]+C$/.test(p)) {
      return { kind: "temp", colorHint: "temp", isLight: false, isDark: false, isStim: false, stimType: null };
    }
    if (/^BASELINE\b/.test(p)) {
      return { kind: "baseline", colorHint: "baseline", isLight: false, isDark: false, isStim: false, stimType: null };
    }
    if (/^ITI\b/.test(p)) {
      return { kind: "iti", colorHint: "iti", isLight: false, isDark: false, isStim: false, stimType: null };
    }
    if (/^(LIGHT|WHITE|BLUE|GREEN|RED|UV|DAWN)\b/.test(p) || /^S\d+_/.test(p)) {
      let colorHint = "light";
      if (/BLUE/.test(p)) colorHint = "blue";
      else if (/GREEN/.test(p)) colorHint = "green";
      else if (/RED/.test(p)) colorHint = "red";
      else if (/UV/.test(p)) colorHint = "uv";
      return { kind: "light", colorHint, isLight: true, isDark: false, isStim: false, stimType: null };
    }
    return { kind: "other", colorHint: "neutral", isLight: false, isDark: false, isStim: false, stimType: null };
  }

  function extractRowMetricValue(row, well, metricId, parsed) {
    if (metricId === "dist") {
      if (parsed.hasDist && row.dist) return row.dist[well];
      if (parsed.hasZoneDist && row.zd && row.zd[well]) {
        let sum = 0;
        let any = false;
        for (let z = 1; z <= parsed.maxZone; z++) {
          if (row.zd[well][z] !== null) { sum += row.zd[well][z]; any = true; }
        }
        return any ? sum : null;
      }
      return null;
    }
    if (metricId === "msd") {
      return (parsed.hasMsd && row.msd) ? row.msd[well] : null;
    }
    const m = String(metricId || "").match(/^z(\d+)_pct$/i);
    if (m && parsed.hasZones) {
      const zTarget = parseInt(m[1], 10);
      if (parsed.hasZoneTime && row.zt && row.zt[well]) {
        let total = 0;
        for (let z = 1; z <= parsed.maxZone; z++) {
          const v = row.zt[well][z];
          if (v !== null && v > 0) total += v;
        }
        if (total > 0 && row.zt[well][zTarget] !== null) {
          return (row.zt[well][zTarget] / total) * 100;
        }
        return null;
      }
      if (parsed.hasZoneDist && row.zd && row.zd[well]) {
        let total = 0;
        for (let z = 1; z <= parsed.maxZone; z++) {
          const v = row.zd[well][z];
          if (v !== null && v > 0) total += v;
        }
        if (total > 0 && row.zd[well][zTarget] !== null) {
          return (row.zd[well][zTarget] / total) * 100;
        }
        return null;
      }
    }
    return null;
  }

  function computeZchangePerArena(zchangeParsed, targetWells, fallbackMaxZone) {
    if (!zchangeParsed || zchangeParsed.kind !== "zchange" || !Array.isArray(zchangeParsed.events) || zchangeParsed.events.length === 0) {
      return null;
    }
    const maxZone = Math.max(zchangeParsed.maxZone || 0, fallbackMaxZone || 0, 2);
    const eventsByArena = {};
    for (const ev of zchangeParsed.events) {
      if (!eventsByArena[ev.arena]) eventsByArena[ev.arena] = [];
      eventsByArena[ev.arena].push(ev);
    }

    const hasExplicitEnter = zchangeParsed.events.some(e => e.action === "ENTER");
    const arenaList = targetWells && targetWells.length > 0 ? targetWells : zchangeParsed.wells;
    const byArena = {};

    for (const w of arenaList) {
      const evs = (eventsByArena[w] || []).slice().sort((a, b) => (a.time - b.time) || (a.index - b.index));
      const entryEvents = hasExplicitEnter ? evs.filter(e => e.action === "ENTER") : evs;

      const zoneEntries = {};
      for (let z = 1; z <= maxZone; z++) zoneEntries[z] = 0;
      const matrix = Array.from({ length: maxZone }, () => Array(maxZone).fill(0));

      // Collapse consecutive duplicate zone entries (tracking boundary jitter without leaving)
      const cleanZoneSeq = [];
      for (const ev of entryEvents) {
        if (ev.zone < 1 || ev.zone > maxZone) continue;
        zoneEntries[ev.zone]++;
        if (cleanZoneSeq.length === 0 || cleanZoneSeq[cleanZoneSeq.length - 1] !== ev.zone) {
          if (cleanZoneSeq.length > 0) {
            const prevZ = cleanZoneSeq[cleanZoneSeq.length - 1];
            matrix[prevZ - 1][ev.zone - 1]++;
          }
          cleanZoneSeq.push(ev.zone);
        }
      }

      // 3-arm Y-Maze Spontaneous Alternation (arms Z1, Z2, Z3; Z4 center hub preserved in cleanZoneSeq
      // so arm->center->same_arm re-entries count as non-alternating entries!)
      const armSequence = maxZone >= 3 ? cleanZoneSeq.filter(z => z >= 1 && z <= 3) : [];
      const triads = Math.max(0, armSequence.length - 2);
      let alternations = 0;
      for (let i = 0; i < triads; i++) {
        const a = armSequence[i];
        const b = armSequence[i + 1];
        const c = armSequence[i + 2];
        if (a !== b && b !== c && a !== c) alternations++;
      }
      const sabPct = triads > 0 ? (alternations / triads) * 100 : null;

      byArena[w] = {
        totalEvents: evs.length,
        totalEntries: entryEvents.length,
        zoneEntries,
        transitionMatrix: matrix,
        cleanZoneSeq,
        armSequence,
        armEntries: armSequence.length,
        triads,
        alternations,
        sabPct: sabPct !== null ? roundNum(sabPct, 2) : null
      };
    }

    return { maxZone, byArena, totalEvents: zchangeParsed.events.length };
  }

  function computeAnalysis(stateObj) {
    const opts = stateObj || {};
    const parsed = opts.parsed || null;
    const zchange = opts.zchange || null;
    const context = opts.context || null;
    const rawGroups = (opts.groups && typeof opts.groups === "object") ? opts.groups : {};
    const excludedSet = normalizeExcludedSet(opts.excludedWells);
    const binGroupSize = Math.max(1, Math.round(parseFloat(opts.binGroupSize) || 1));
    const layout = getPlateLayout(parsed || zchange, context);

    if (!parsed || parsed.kind !== "summary" || !Array.isArray(parsed.rows) || parsed.rows.length === 0) {
      // Still compute full _ZCHANGE metrics if a standalone _ZCHANGE file is loaded!
      const zcOnly = (zchange && zchange.kind === "zchange")
        ? computeZchangePerArena(zchange, zchange.wells, zchange.maxZone)
        : null;
      let zcSummary = null;
      let hasSabOnly = false;
      const wellsOnly = [];
      const wellsByIdOnly = {};
      const groupsOnly = [];

      if (zcOnly) {
        const mz = zcOnly.maxZone;
        const incMat = Array.from({ length: mz }, () => Array(mz).fill(0));
        const allMat = Array.from({ length: mz }, () => Array(mz).fill(0));
        const hasUserGrp = zchange.wells.some(w => rawGroups[w] && String(rawGroups[w]).trim() !== "");
        const groupMap = {};
        const groupNames = [];
        const seenG = new Set();
        for (const w of zchange.wells) {
          const g = hasUserGrp ? (rawGroups[w] && String(rawGroups[w]).trim() ? String(rawGroups[w]).trim() : "Unassigned") : "All Wells";
          groupMap[w] = g;
          if (!seenG.has(g)) { seenG.add(g); groupNames.push(g); }
        }
        let totalEntries = 0;
        const perArena = [];
        const includedSabVals = [];

        for (const w of zchange.wells) {
          const zc = zcOnly.byArena[w];
          const excluded = excludedSet.has(w.toUpperCase());
          const group = groupMap[w];
          if (zc) {
            totalEntries += zc.totalEntries;
            for (let r = 0; r < mz; r++) {
              for (let c = 0; c < mz; c++) {
                allMat[r][c] += zc.transitionMatrix[r][c] || 0;
                if (!excluded) incMat[r][c] += zc.transitionMatrix[r][c] || 0;
              }
            }
            if (!excluded && zc.sabPct !== null) includedSabVals.push(zc.sabPct);
            perArena.push({
              well: w, group, excluded,
              totalEvents: zc.totalEvents, totalEntries: zc.totalEntries,
              armEntries: zc.armEntries, triads: zc.triads,
              alternations: zc.alternations, sabPct: zc.sabPct,
              zoneEntries: zc.zoneEntries, transitionMatrix: zc.transitionMatrix
            });
          }
          const ws = {
            well: w, group, excluded,
            qc: { well: w, status: "ok", isEmpty: false, isSpikeGlitch: false, spikeCount: 0, flags: [], reason: "OK", activeBins: 0, activePct: 0, maxBinDist: 0, maxSpeedMmS: 0 },
            totalDist: null, meanDist: null, meanSpeedMmS: null, totalMsd: null, meanMsd: null,
            phaseDist: {}, phaseMsd: {}, vmr: null, zones: null, startle: null, zchange: zc || null,
            heatmapValue: zc ? (zc.sabPct !== null ? zc.sabPct : zc.totalEntries) : null,
            heatmapValues: { sabPct: zc ? zc.sabPct : null }
          };
          wellsOnly.push(ws);
          wellsByIdOnly[w] = ws;
        }

        for (const gName of groupNames) {
          const assigned = wellsOnly.filter(ws => ws.group === gName);
          const included = assigned.filter(ws => !ws.excluded);
          const gMat = Array.from({ length: mz }, () => Array(mz).fill(0));
          for (const ws of included) {
            if (!ws.zchange) continue;
            for (let r = 0; r < mz; r++) for (let c = 0; c < mz; c++) gMat[r][c] += ws.zchange.transitionMatrix[r][c] || 0;
          }
          groupsOnly.push({
            group: gName, n: included.length, totalAssigned: assigned.length,
            excludedCount: assigned.length - included.length, wells: included.map(ws => ws.well),
            totalDist: computeStats([]), meanDist: computeStats([]), meanSpeedMmS: computeStats([]), meanMsd: null,
            byPhase: {}, vmr: null, zones: null, startle: null,
            zchange: {
              totalEntries: computeStats(included.map(ws => ws.zchange ? ws.zchange.totalEntries : null)),
              armEntries: computeStats(included.map(ws => ws.zchange ? ws.zchange.armEntries : null)),
              sabPct: computeStats(included.map(ws => ws.zchange ? ws.zchange.sabPct : null)),
              transitionMatrix: gMat
            }
          });
        }

        hasSabOnly = mz >= 3 && perArena.some(a => a.triads > 0);
        const zonesArr = [];
        for (let z = 1; z <= mz; z++) zonesArr.push(z);
        zcSummary = {
          maxZone: mz, zones: zonesArr,
          zoneLabels: buildZoneLabels(layout.id, mz, layout.zoneMode),
          totalEvents: zcOnly.totalEvents, totalEntries,
          includedTransitionMatrix: incMat, allTransitionMatrix: allMat,
          hasSab: hasSabOnly, overallSabPct: computeStats(includedSabVals), perArena
        };
      }

      const excludedCountOnly = wellsOnly.filter(ws => ws.excluded).length;
      return {
        activeMetric: "dist",
        availableMetrics: [],
        layout,
        phases: [],
        capabilities: {
          hasDist: false, hasMsd: false, hasZones: false, hasZchange: Boolean(zcSummary),
          hasTemp: false, hasPhases: false, hasVmr: false, hasPpi: false, hasStartle: false,
          hasSab: hasSabOnly, maxZone: zcSummary ? zcSummary.maxZone : 0
        },
        kpis: {
          totalWells: layout.wells.length, activeWells: layout.wells.length - excludedCountOnly, excludedWells: excludedCountOnly,
          rowCount: zchange ? zchange.rowCount : 0, durationSec: zchange ? zchange.durationSec : 0, binDurationSec: 1,
          emptyCount: 0, spikeCount: 0, flaggedCount: 0, flaggedWells: [],
          tempMin: null, tempMax: null, tempMean: null, targetTempC: context ? context.targetTempC : null
        },
        timeSeries: {
          metric: "dist", metricLabel: "Distance (mm/bin)", unit: "mm",
          binGroupSize, rawBinSec: 1, effectiveBinSec: binGroupSize,
          xAxis: [], series: [], yMin: 0, yMax: 1, phaseSpans: [], stimulusMarkers: []
        },
        wells: wellsOnly,
        wellsById: wellsByIdOnly,
        groups: groupsOnly,
        zchangeSummary: zcSummary,
        tempAnalysis: {
          hasTemp: false, min: null, max: null, mean: null, std: null,
          targetTempC: context ? context.targetTempC : null,
          targetSchedule: context ? context.tempSchedule : [],
          maxDeviationC: null, points: []
        },
        anomalies: [],
        comparisonViews: hasSabOnly ? [{ id: "sab", label: "Y-Maze Alternation (SAB %)" }] : []
      };
    }

    const wells = parsed.wells;
    const rows = parsed.rows;
    const binSec = parsed.binDurationSec || 1;
    const hasDistLike = parsed.hasDist || parsed.hasZoneDist;

    // 1. Available metrics for time-series & plate heatmap
    const availableMetrics = [];
    if (hasDistLike) {
      availableMetrics.push({ id: "dist", label: "Distance (mm/bin)", shortLabel: "Distance", unit: "mm" });
    }
    if (parsed.hasMsd) {
      availableMetrics.push({ id: "msd", label: "Activity (MSD)", shortLabel: "MSD", unit: "px" });
    }
    if (parsed.hasZones && (parsed.hasZoneTime || parsed.hasZoneDist)) {
      const zLabels = layout.zoneLabels || [];
      for (let z = 1; z <= parsed.maxZone; z++) {
        const zLbl = zLabels[z - 1] || `Zone ${z}`;
        availableMetrics.push({
          id: `z${z}_pct`,
          label: `${zLbl} (%)`,
          shortLabel: `Z${z} %`,
          unit: "%"
        });
      }
    }
    const requestedMetric = String(opts.metric || "dist").toLowerCase();
    const activeMetricObj = availableMetrics.find(m => m.id === requestedMetric) || availableMetrics[0] || { id: "dist", label: "Distance (mm/bin)", shortLabel: "Distance", unit: "mm" };
    const activeMetric = activeMetricObj.id;

    // 2. Resolve group membership per well
    const hasAnyUserGroup = wells.some(w => rawGroups[w] && String(rawGroups[w]).trim() !== "");
    const wellGroupMap = {};
    const discoveredGroups = [];
    const discoveredSet = new Set();

    if (Array.isArray(opts.groupOrder)) {
      for (const gName of opts.groupOrder) {
        const clean = String(gName || "").trim();
        if (clean && !discoveredSet.has(clean)) {
          discoveredSet.add(clean);
          discoveredGroups.push(clean);
        }
      }
    }

    for (const w of wells) {
      const assigned = hasAnyUserGroup
        ? (rawGroups[w] && String(rawGroups[w]).trim() ? String(rawGroups[w]).trim() : "Unassigned")
        : "All Wells";
      wellGroupMap[w] = assigned;
      if (!discoveredSet.has(assigned)) {
        discoveredSet.add(assigned);
        discoveredGroups.push(assigned);
      }
    }
    // Keep only groups that have at least one well assigned
    const activeGroupNames = discoveredGroups.filter(g => wells.some(w => wellGroupMap[w] === g));

    // 3. Contiguous PHASE spans & stimulus markers
    const phaseSpans = [];
    const stimulusMarkers = [];
    const uniquePhases = [];
    const phaseSeen = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const ph = row.phase || "";
      if (ph && !phaseSeen.has(ph)) {
        phaseSeen.add(ph);
        uniquePhases.push(ph);
      }
      const prev = phaseSpans[phaseSpans.length - 1];
      const endRel = i + 1 < rows.length ? rows[i + 1].relTime : Number((row.relTime + binSec).toFixed(3));
      const endRun = i + 1 < rows.length ? rows[i + 1].runtime : Number((row.runtime + binSec).toFixed(3));

      if (prev && prev.phase === ph && (row.trial === prev.trial || !classifyPhase(ph).isStim)) {
        prev.endRow = i;
        prev.endRelTime = endRel;
        prev.endRuntime = endRun;
        prev.binCount++;
      } else {
        const cls = classifyPhase(ph);
        const span = {
          phase: ph || "RECORDING",
          label: ph || "Recording",
          kind: cls.kind,
          colorHint: cls.colorHint,
          isLight: cls.isLight,
          isDark: cls.isDark,
          isStim: cls.isStim,
          stimType: cls.stimType,
          startRelTime: row.relTime,
          endRelTime: endRel,
          startRuntime: row.runtime,
          endRuntime: endRun,
          startRow: i,
          endRow: i,
          binCount: 1,
          trial: row.trial
        };
        phaseSpans.push(span);
        if (cls.isStim) {
          const shortLbl = ph === "PULSE_ALONE" ? "Pulse"
            : (ph === "PPI_TRIAL" ? "PPI"
            : (ph === "VIBRATION" ? "Vib"
            : (ph === "AUDIO_PULSE" ? "Audio" : ph)));
          stimulusMarkers.push({
            relTime: row.relTime,
            runtime: row.runtime,
            rowIndex: i,
            phase: ph,
            label: row.trial != null ? `${shortLbl} #${row.trial}` : shortLbl,
            type: cls.stimType || "stim",
            trial: row.trial
          });
        }
      }
    }

    // If CSV had no PHASE markers but context provides stimulus schedule, project them
    if (stimulusMarkers.length === 0 && context && Array.isArray(context.stimulusEvents)) {
      for (const ev of context.stimulusEvents) {
        if (ev.timeSec <= parsed.durationSec) {
          stimulusMarkers.push({
            relTime: ev.timeSec,
            runtime: parsed.startRuntimeSec + ev.timeSec,
            rowIndex: Math.min(rows.length - 1, Math.max(0, Math.floor(ev.timeSec / binSec))),
            phase: ev.detail || ev.label,
            label: ev.label,
            type: ev.type || "stim",
            trial: null
          });
        }
      }
    }

    // Detect protocol capabilities from actual data
    const hasLightRows = rows.some(r => classifyPhase(r.phase).isLight);
    const hasDarkRows = rows.some(r => classifyPhase(r.phase).isDark);
    const hasVmr = hasDistLike && hasLightRows && hasDarkRows;
    const hasPulseAlone = rows.some(r => /^PULSE_ALONE\b/i.test(r.phase));
    const hasPpiTrial = rows.some(r => /^PPI_TRIAL\b/i.test(r.phase));
    const hasPpi = (hasDistLike || parsed.hasMsd) && hasPulseAlone && hasPpiTrial;
    const hasStartle = (hasDistLike || parsed.hasMsd) && rows.some(r => classifyPhase(r.phase).isStim);

    // Identify Light->Dark and Dark->Light onset burst row indices (first ~30s of new phase, at least 1 bin)
    const darkOnsetRowSet = new Set();
    const lightOnsetRowSet = new Set();
    const burstBins = Math.max(1, Math.round(30 / binSec));
    for (let s = 1; s < phaseSpans.length; s++) {
      const prevSpan = phaseSpans[s - 1];
      const curSpan = phaseSpans[s];
      if (prevSpan.isLight && curSpan.isDark) {
        const take = Math.min(curSpan.binCount, burstBins);
        for (let r = curSpan.startRow; r < curSpan.startRow + take; r++) darkOnsetRowSet.add(r);
      } else if (prevSpan.isDark && curSpan.isLight) {
        const take = Math.min(curSpan.binCount, burstBins);
        for (let r = curSpan.startRow; r < curSpan.startRow + take; r++) lightOnsetRowSet.add(r);
      }
    }

    // 4. Optional _ZCHANGE metrics
    const zchangeCalc = computeZchangePerArena(zchange, wells, parsed.maxZone);
    const hasZchange = Boolean(zchangeCalc);

    // 5. Per-well detailed metrics
    const wellSummaries = [];
    const wellsById = {};

    for (const w of wells) {
      const group = wellGroupMap[w];
      const excluded = excludedSet.has(w.toUpperCase());
      const qcInfo = parsed.qc[w] || {
        well: w, status: "ok", isEmpty: false, isSpikeGlitch: false,
        spikeCount: 0, flags: [], reason: "OK", activeBins: 0, activePct: 0,
        maxBinDist: 0, maxSpeedMmS: 0, totalDist: 0, meanDist: 0
      };

      const distVals = [];
      const msdVals = [];
      const phaseAcc = {};
      const lightVals = [];
      const darkVals = [];
      const darkBurstVals = [];
      const lightBurstVals = [];
      const baselineVals = [];
      const itiVals = [];
      const stimVals = [];
      const pulseAloneVals = [];
      const ppiTrialVals = [];
      const pulseAloneMsdVals = [];
      const ppiTrialMsdVals = [];
      const stimTrialList = [];

      const zTimeTotals = {};
      const zDistTotals = {};
      const zEntryTotals = {};
      if (parsed.hasZones) {
        for (let z = 1; z <= parsed.maxZone; z++) {
          zTimeTotals[z] = 0;
          zDistTotals[z] = 0;
          zEntryTotals[z] = 0;
        }
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const dVal = hasDistLike ? extractRowMetricValue(row, w, "dist", parsed) : null;
        const mVal = parsed.hasMsd ? row.msd[w] : null;
        const ph = row.phase || "";
        const cls = classifyPhase(ph);

        if (dVal !== null) distVals.push(dVal);
        if (mVal !== null) msdVals.push(mVal);

        if (ph) {
          if (!phaseAcc[ph]) phaseAcc[ph] = { distSum: 0, distN: 0, msdSum: 0, msdN: 0, bins: 0 };
          phaseAcc[ph].bins++;
          if (dVal !== null) { phaseAcc[ph].distSum += dVal; phaseAcc[ph].distN++; }
          if (mVal !== null) { phaseAcc[ph].msdSum += mVal; phaseAcc[ph].msdN++; }
        }

        const primaryStartleVal = dVal !== null ? dVal : mVal;
        if (dVal !== null) {
          if (cls.isLight) lightVals.push(dVal);
          if (cls.isDark) darkVals.push(dVal);
          if (darkOnsetRowSet.has(i)) darkBurstVals.push(dVal);
          if (lightOnsetRowSet.has(i)) lightBurstVals.push(dVal);
        }
        if (primaryStartleVal !== null) {
          if (cls.kind === "baseline") baselineVals.push(primaryStartleVal);
          if (cls.kind === "iti") itiVals.push(primaryStartleVal);
          if (cls.isStim) {
            stimVals.push(primaryStartleVal);
            stimTrialList.push({ phase: ph, val: primaryStartleVal });
          }
          if (/^PULSE_ALONE\b/i.test(ph)) {
            pulseAloneVals.push(primaryStartleVal);
            if (mVal !== null) pulseAloneMsdVals.push(mVal);
          }
          if (/^PPI_TRIAL\b/i.test(ph)) {
            ppiTrialVals.push(primaryStartleVal);
            if (mVal !== null) ppiTrialMsdVals.push(mVal);
          }
        }

        if (parsed.hasZones) {
          for (let z = 1; z <= parsed.maxZone; z++) {
            if (parsed.hasZoneTime && row.zt[w] && row.zt[w][z] !== null) zTimeTotals[z] += row.zt[w][z];
            if (parsed.hasZoneDist && row.zd[w] && row.zd[w][z] !== null) zDistTotals[z] += row.zd[w][z];
            if (parsed.hasZoneCount && row.zc[w] && row.zc[w][z] !== null) zEntryTotals[z] += row.zc[w][z];
          }
        }
      }

      const totalDist = distVals.length ? distVals.reduce((a, b) => a + b, 0) : null;
      const meanDist = distVals.length ? totalDist / distVals.length : null;
      const meanSpeedMmS = meanDist !== null && binSec > 0 ? meanDist / binSec : null;
      const totalMsd = msdVals.length ? msdVals.reduce((a, b) => a + b, 0) : null;
      const meanMsd = msdVals.length ? totalMsd / msdVals.length : null;

      const phaseDist = {};
      const phaseMsd = {};
      for (const [ph, acc] of Object.entries(phaseAcc)) {
        phaseDist[ph] = {
          total: acc.distN > 0 ? roundNum(acc.distSum, 3) : null,
          mean: acc.distN > 0 ? roundNum(acc.distSum / acc.distN, 3) : null,
          bins: acc.bins
        };
        if (parsed.hasMsd) {
          phaseMsd[ph] = {
            total: acc.msdN > 0 ? roundNum(acc.msdSum, 3) : null,
            mean: acc.msdN > 0 ? roundNum(acc.msdSum / acc.msdN, 3) : null,
            bins: acc.bins
          };
        }
      }

      // VMR metrics
      let vmr = null;
      if (hasVmr) {
        const lMean = computeStats(lightVals).mean;
        const dMean = computeStats(darkVals).mean;
        const dBurst = computeStats(darkBurstVals).mean;
        const lBurst = computeStats(lightBurstVals).mean;
        vmr = {
          lightMean: lMean !== null ? roundNum(lMean, 3) : null,
          darkMean: dMean !== null ? roundNum(dMean, 3) : null,
          darkMinusLight: (dMean !== null && lMean !== null) ? roundNum(dMean - lMean, 3) : null,
          darkToLightRatio: (dMean !== null && lMean !== null && lMean > 0.001) ? roundNum(dMean / lMean, 3) : null,
          darkOnsetBurst: dBurst !== null ? roundNum(dBurst, 3) : null,
          lightOnsetBurst: lBurst !== null ? roundNum(lBurst, 3) : null
        };
      }

      // Zone preference / Thigmotaxis metrics
      let zonesObj = null;
      if (parsed.hasZones) {
        const sumTime = Object.values(zTimeTotals).reduce((a, b) => a + b, 0);
        const sumZDist = Object.values(zDistTotals).reduce((a, b) => a + b, 0);
        const sumZEnt = Object.values(zEntryTotals).reduce((a, b) => a + b, 0);
        const pct = {};
        const timeSec = {};
        const distMm = {};
        const entries = {};

        for (let z = 1; z <= parsed.maxZone; z++) {
          timeSec[z] = roundNum(zTimeTotals[z], 2);
          distMm[z] = roundNum(zDistTotals[z], 2);
          entries[z] = Math.round(zEntryTotals[z]);
          if (parsed.hasZoneTime && sumTime > 0) {
            pct[z] = roundNum((zTimeTotals[z] / sumTime) * 100, 2);
          } else if (parsed.hasZoneDist && sumZDist > 0) {
            pct[z] = roundNum((zDistTotals[z] / sumZDist) * 100, 2);
          } else if (parsed.hasZoneCount && sumZEnt > 0) {
            pct[z] = roundNum((zEntryTotals[z] / sumZEnt) * 100, 2);
          } else {
            pct[z] = null;
          }
        }
        const z1Pct = pct[1] ?? null;
        const z2Pct = parsed.maxZone >= 2 ? (pct[2] ?? null) : null;
        const prefIndex = (z1Pct !== null && z2Pct !== null && (z1Pct + z2Pct) > 0)
          ? roundNum((z2Pct - z1Pct) / (z1Pct + z2Pct), 3)
          : null;
        zonesObj = {
          maxZone: parsed.maxZone,
          pct,
          timeSec,
          distMm,
          entries,
          z1Pct,
          z2Pct,
          preferenceIndex: prefIndex,
          thigmotaxisPct: z1Pct
        };
      }

      // Startle & % PPI metrics
      let startleObj = null;
      if (hasStartle) {
        const bMean = computeStats(baselineVals).mean;
        const iMean = computeStats(itiVals).mean;
        const sMean = computeStats(stimVals).mean;
        const paMean = computeStats(pulseAloneVals).mean;
        const ppMean = computeStats(ppiTrialVals).mean;
        const ppiPct = (hasPpi && paMean !== null && ppMean !== null && paMean > 0.001)
          ? roundNum((1 - ppMean / paMean) * 100, 2)
          : null;
        const paMsd = computeStats(pulseAloneMsdVals).mean;
        const ppMsd = computeStats(ppiTrialMsdVals).mean;
        const ppiMsdPct = (hasPpi && paMsd !== null && ppMsd !== null && paMsd > 0.001)
          ? roundNum((1 - ppMsd / paMsd) * 100, 2)
          : null;

        const habitSeq = hasPpi ? pulseAloneVals : stimVals;
        const habituationPct = (habitSeq.length >= 2 && habitSeq[0] > 0.001)
          ? roundNum((1 - habitSeq[habitSeq.length - 1] / habitSeq[0]) * 100, 2)
          : null;

        startleObj = {
          hasPpi,
          baselineMean: bMean !== null ? roundNum(bMean, 3) : null,
          itiMean: iMean !== null ? roundNum(iMean, 3) : null,
          stimMean: sMean !== null ? roundNum(sMean, 3) : null,
          pulseAloneMean: paMean !== null ? roundNum(paMean, 3) : null,
          ppiTrialMean: ppMean !== null ? roundNum(ppMean, 3) : null,
          ppiPct,
          pulseAloneMsd: paMsd !== null ? roundNum(paMsd, 3) : null,
          ppiTrialMsd: ppMsd !== null ? roundNum(ppMsd, 3) : null,
          ppiMsdPct,
          habituationPct
        };
      }

      const zcObj = zchangeCalc ? (zchangeCalc.byArena[w] || null) : null;

      // Heatmap lookup values for Plate Map coloring
      const heatmapValues = {
        dist: totalDist !== null ? roundNum(totalDist, 2) : null,
        meanDist: meanDist !== null ? roundNum(meanDist, 2) : null,
        msd: meanMsd !== null ? roundNum(meanMsd, 2) : null,
        z1_pct: zonesObj ? zonesObj.z1Pct : null,
        z2_pct: zonesObj ? zonesObj.z2Pct : null,
        preferenceIndex: zonesObj ? zonesObj.preferenceIndex : null,
        ppiPct: startleObj ? startleObj.ppiPct : null,
        sabPct: zcObj ? zcObj.sabPct : null
      };
      if (zonesObj) {
        for (let z = 1; z <= parsed.maxZone; z++) {
          heatmapValues[`z${z}_pct`] = zonesObj.pct[z];
        }
      }

      const heatmapValue = activeMetric === "dist"
        ? heatmapValues.dist
        : (activeMetric === "msd" ? heatmapValues.msd : (heatmapValues[activeMetric] ?? null));

      const summary = {
        well: w,
        group,
        excluded,
        qc: qcInfo,
        totalDist: totalDist !== null ? roundNum(totalDist, 2) : null,
        meanDist: meanDist !== null ? roundNum(meanDist, 3) : null,
        meanSpeedMmS: meanSpeedMmS !== null ? roundNum(meanSpeedMmS, 3) : null,
        totalMsd: totalMsd !== null ? roundNum(totalMsd, 2) : null,
        meanMsd: meanMsd !== null ? roundNum(meanMsd, 3) : null,
        phaseDist,
        phaseMsd,
        vmr,
        zones: zonesObj,
        startle: startleObj,
        zchange: zcObj,
        heatmapValue,
        heatmapValues
      };

      wellSummaries.push(summary);
      wellsById[w] = summary;
    }

    // 6. Group-level time series (Mean ± SEM, smoothed by binGroupSize)
    const xAxis = [];
    const chunkBounds = [];
    for (let start = 0; start < rows.length; start += binGroupSize) {
      const end = Math.min(rows.length - 1, start + binGroupSize - 1);
      chunkBounds.push([start, end]);

      const startRel = rows[start].relTime;
      const endRel = end + 1 < rows.length ? rows[end + 1].relTime : Number((rows[end].relTime + binSec).toFixed(3));
      const midRel = Number(((startRel + endRel) / 2).toFixed(3));

      let phaseLbl = rows[start].phase || "";
      let tempSum = 0;
      let tempN = 0;
      for (let r = start; r <= end; r++) {
        if (classifyPhase(rows[r].phase).isStim) phaseLbl = rows[r].phase;
        if (rows[r].tempC !== null) { tempSum += rows[r].tempC; tempN++; }
      }

      xAxis.push({
        index: xAxis.length,
        startRow: start,
        endRow: end,
        runtime: rows[start].runtime,
        relTime: startRel,
        midRelTime: midRel,
        endRelTime: endRel,
        phase: phaseLbl,
        trial: rows[start].trial,
        tempC: tempN > 0 ? roundNum(tempSum / tempN, 2) : null
      });
    }

    let yMin = Infinity;
    let yMax = -Infinity;
    const series = [];

    for (const gName of activeGroupNames) {
      const includedWells = wellSummaries
        .filter(ws => ws.group === gName && !ws.excluded)
        .map(ws => ws.well);

      const points = [];
      for (let c = 0; c < chunkBounds.length; c++) {
        const [rStart, rEnd] = chunkBounds[c];
        const wellChunkMeans = [];

        for (const w of includedWells) {
          let sum = 0;
          let cnt = 0;
          for (let r = rStart; r <= rEnd; r++) {
            const v = extractRowMetricValue(rows[r], w, activeMetric, parsed);
            if (v !== null) { sum += v; cnt++; }
          }
          if (cnt > 0) wellChunkMeans.push(sum / cnt);
        }

        const st = computeStats(wellChunkMeans);
        if (st.mean !== null) {
          const lo = st.mean - (st.sem || 0);
          const hi = st.mean + (st.sem || 0);
          if (lo < yMin) yMin = lo;
          if (hi > yMax) yMax = hi;
        }
        points.push({
          mean: st.mean !== null ? roundNum(st.mean, 3) : null,
          sem: st.sem !== null ? roundNum(st.sem, 3) : null,
          sd: st.sd !== null ? roundNum(st.sd, 3) : null,
          n: st.n,
          min: st.min !== null ? roundNum(st.min, 3) : null,
          max: st.max !== null ? roundNum(st.max, 3) : null
        });
      }

      series.push({
        group: gName,
        n: includedWells.length,
        values: points
      });
    }

    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    } else if (yMin === yMax) {
      yMin = Math.max(0, yMin - 1);
      yMax = yMax + 1;
    } else {
      yMin = Math.min(0, yMin);
    }

    // 7. Group-level summary statistics (excluding excludedWells)
    const groupSummaries = [];
    for (const gName of activeGroupNames) {
      const assigned = wellSummaries.filter(ws => ws.group === gName);
      const included = assigned.filter(ws => !ws.excluded);

      const byPhase = {};
      for (const ph of uniquePhases) {
        byPhase[ph] = {
          meanDist: computeStats(included.map(ws => ws.phaseDist[ph] ? ws.phaseDist[ph].mean : null)),
          totalDist: computeStats(included.map(ws => ws.phaseDist[ph] ? ws.phaseDist[ph].total : null)),
          meanMsd: parsed.hasMsd
            ? computeStats(included.map(ws => (ws.phaseMsd && ws.phaseMsd[ph]) ? ws.phaseMsd[ph].mean : null))
            : null
        };
      }

      const vmrGroup = hasVmr ? {
        lightMean: computeStats(included.map(ws => ws.vmr ? ws.vmr.lightMean : null)),
        darkMean: computeStats(included.map(ws => ws.vmr ? ws.vmr.darkMean : null)),
        darkMinusLight: computeStats(included.map(ws => ws.vmr ? ws.vmr.darkMinusLight : null)),
        darkOnsetBurst: computeStats(included.map(ws => ws.vmr ? ws.vmr.darkOnsetBurst : null)),
        lightOnsetBurst: computeStats(included.map(ws => ws.vmr ? ws.vmr.lightOnsetBurst : null))
      } : null;

      let zonesGroup = null;
      if (parsed.hasZones) {
        const pctStats = {};
        for (let z = 1; z <= parsed.maxZone; z++) {
          pctStats[z] = computeStats(included.map(ws => ws.zones ? ws.zones.pct[z] : null));
        }
        zonesGroup = {
          pct: pctStats,
          z1Pct: pctStats[1] || computeStats([]),
          z2Pct: pctStats[2] || computeStats([]),
          preferenceIndex: computeStats(included.map(ws => ws.zones ? ws.zones.preferenceIndex : null))
        };
      }

      const startleGroup = hasStartle ? {
        baselineMean: computeStats(included.map(ws => ws.startle ? ws.startle.baselineMean : null)),
        itiMean: computeStats(included.map(ws => ws.startle ? ws.startle.itiMean : null)),
        stimMean: computeStats(included.map(ws => ws.startle ? ws.startle.stimMean : null)),
        pulseAloneMean: computeStats(included.map(ws => ws.startle ? ws.startle.pulseAloneMean : null)),
        ppiTrialMean: computeStats(included.map(ws => ws.startle ? ws.startle.ppiTrialMean : null)),
        ppiPct: computeStats(included.map(ws => ws.startle ? ws.startle.ppiPct : null)),
        habituationPct: computeStats(included.map(ws => ws.startle ? ws.startle.habituationPct : null))
      } : null;

      let zchangeGroup = null;
      if (hasZchange) {
        const mz = zchangeCalc.maxZone;
        const gMat = Array.from({ length: mz }, () => Array(mz).fill(0));
        for (const ws of included) {
          if (!ws.zchange || !ws.zchange.transitionMatrix) continue;
          for (let r = 0; r < mz; r++) {
            for (let c = 0; c < mz; c++) {
              gMat[r][c] += ws.zchange.transitionMatrix[r][c] || 0;
            }
          }
        }
        zchangeGroup = {
          totalEntries: computeStats(included.map(ws => ws.zchange ? ws.zchange.totalEntries : null)),
          armEntries: computeStats(included.map(ws => ws.zchange ? ws.zchange.armEntries : null)),
          sabPct: computeStats(included.map(ws => ws.zchange ? ws.zchange.sabPct : null)),
          transitionMatrix: gMat
        };
      }

      groupSummaries.push({
        group: gName,
        n: included.length,
        totalAssigned: assigned.length,
        excludedCount: assigned.length - included.length,
        wells: included.map(ws => ws.well),
        totalDist: computeStats(included.map(ws => ws.totalDist)),
        meanDist: computeStats(included.map(ws => ws.meanDist)),
        meanSpeedMmS: computeStats(included.map(ws => ws.meanSpeedMmS)),
        meanMsd: parsed.hasMsd ? computeStats(included.map(ws => ws.meanMsd)) : null,
        byPhase,
        vmr: vmrGroup,
        zones: zonesGroup,
        startle: startleGroup,
        zchange: zchangeGroup
      });
    }

    // 8. Global _ZCHANGE summary
    let zchangeSummary = null;
    let hasSab = false;
    if (hasZchange) {
      const mz = zchangeCalc.maxZone;
      const incMat = Array.from({ length: mz }, () => Array(mz).fill(0));
      const allMat = Array.from({ length: mz }, () => Array(mz).fill(0));
      let totalEntries = 0;
      const perArena = [];
      const includedSabVals = [];

      for (const ws of wellSummaries) {
        const zc = ws.zchange;
        if (!zc) continue;
        totalEntries += zc.totalEntries;
        for (let r = 0; r < mz; r++) {
          for (let c = 0; c < mz; c++) {
            const v = zc.transitionMatrix[r][c] || 0;
            allMat[r][c] += v;
            if (!ws.excluded) incMat[r][c] += v;
          }
        }
        if (!ws.excluded && zc.sabPct !== null) includedSabVals.push(zc.sabPct);
        perArena.push({
          well: ws.well,
          group: ws.group,
          excluded: ws.excluded,
          totalEvents: zc.totalEvents,
          totalEntries: zc.totalEntries,
          armEntries: zc.armEntries,
          triads: zc.triads,
          alternations: zc.alternations,
          sabPct: zc.sabPct,
          zoneEntries: zc.zoneEntries,
          transitionMatrix: zc.transitionMatrix
        });
      }

      hasSab = mz >= 3 && perArena.some(a => a.triads > 0);
      const zonesArr = [];
      for (let z = 1; z <= mz; z++) zonesArr.push(z);
      zchangeSummary = {
        maxZone: mz,
        zones: zonesArr,
        zoneLabels: buildZoneLabels(layout.id, mz, layout.zoneMode),
        totalEvents: zchangeCalc.totalEvents,
        totalEntries,
        includedTransitionMatrix: incMat,
        allTransitionMatrix: allMat,
        hasSab,
        overallSabPct: computeStats(includedSabVals),
        perArena
      };
    }

    // 9. Temperature analysis against optional context target
    const targetTempC = context ? context.targetTempC : null;
    const targetSchedule = (context && Array.isArray(context.tempSchedule)) ? context.tempSchedule : [];
    let maxDeviationC = null;
    if (parsed.tempSeries.hasTemp && (targetTempC !== null || targetSchedule.length > 0)) {
      let maxDev = 0;
      for (const pt of parsed.tempSeries.points) {
        let tgt = targetTempC;
        if (targetSchedule.length > 0) {
          const hit = targetSchedule.find(s => pt.relTime >= s.startSec && pt.relTime <= s.endSec);
          if (hit && hit.tempC !== null) tgt = hit.tempC;
        }
        if (tgt !== null) {
          const dev = Math.abs(pt.tempC - tgt);
          if (dev > maxDev) maxDev = dev;
        }
      }
      maxDeviationC = roundNum(maxDev, 2);
    }

    const tempAnalysis = {
      hasTemp: parsed.tempSeries.hasTemp,
      min: parsed.tempSeries.min,
      max: parsed.tempSeries.max,
      mean: parsed.tempSeries.mean,
      std: parsed.tempSeries.std,
      targetTempC,
      targetSchedule,
      maxDeviationC,
      points: parsed.tempSeries.points
    };

    // 10. Sorted QC anomalies list (flagged wells first, ordered by severity)
    const anomalies = wellSummaries
      .map(ws => ({
        well: ws.well,
        group: ws.group,
        excluded: ws.excluded,
        status: ws.qc.status,
        isEmpty: ws.qc.isEmpty,
        isSpikeGlitch: ws.qc.isSpikeGlitch,
        spikeCount: ws.qc.spikeCount,
        maxBinDist: ws.qc.maxBinDist,
        totalDist: ws.totalDist,
        activeBins: ws.qc.activeBins,
        activePct: ws.qc.activePct,
        reason: ws.qc.reason
      }))
      .sort((a, b) => {
        const rank = (x) => x.isSpikeGlitch ? 0 : (x.isEmpty ? 1 : 2);
        const rDiff = rank(a) - rank(b);
        if (rDiff !== 0) return rDiff;
        if (a.isSpikeGlitch && b.isSpikeGlitch) return (b.maxBinDist || 0) - (a.maxBinDist || 0);
        return (a.totalDist || 0) - (b.totalDist || 0);
      });

    // 11. Comparison view catalog for Tab 2
    const comparisonViews = [{ id: "phase_totals", label: uniquePhases.length > 1 ? "Phase Mean Distance" : "Total Distance" }];
    if (hasVmr) comparisonViews.push({ id: "vmr", label: "VMR (Light vs Dark & Burst)" });
    if (parsed.hasZones) comparisonViews.push({ id: "zone_pref", label: parsed.maxZone === 2 ? "Zone Preference / Thigmotaxis" : `Zone Occupancy (Z1–Z${parsed.maxZone})` });
    if (hasPpi) comparisonViews.push({ id: "ppi", label: "Prepulse Inhibition (% PPI)" });
    else if (hasStartle) comparisonViews.push({ id: "startle", label: "Startle Response (Baseline vs Stim)" });
    if (hasSab) comparisonViews.push({ id: "sab", label: "Y-Maze Alternation (SAB %)" });

    const excludedCount = wellSummaries.filter(ws => ws.excluded).length;
    const kpis = {
      totalWells: wells.length,
      activeWells: wells.length - excludedCount,
      excludedWells: excludedCount,
      rowCount: rows.length,
      durationSec: parsed.durationSec,
      binDurationSec: binSec,
      emptyCount: parsed.qcSummary.emptyWells.length,
      spikeCount: parsed.qcSummary.spikeWells.length,
      flaggedCount: parsed.qcSummary.flaggedWells.length,
      flaggedWells: parsed.qcSummary.flaggedWells.slice(),
      tempMin: parsed.tempSeries.min,
      tempMax: parsed.tempSeries.max,
      tempMean: parsed.tempSeries.mean,
      targetTempC
    };

    return {
      activeMetric,
      availableMetrics,
      layout,
      phases: uniquePhases,
      capabilities: {
        hasDist: hasDistLike,
        hasMsd: parsed.hasMsd,
        hasZones: parsed.hasZones,
        hasZchange,
        hasTemp: parsed.tempSeries.hasTemp,
        hasPhases: uniquePhases.length > 0,
        hasVmr,
        hasPpi,
        hasStartle,
        hasSab,
        maxZone: parsed.maxZone
      },
      kpis,
      timeSeries: {
        metric: activeMetric,
        metricLabel: activeMetricObj.label,
        unit: activeMetricObj.unit,
        binGroupSize,
        rawBinSec: binSec,
        effectiveBinSec: roundNum(binSec * binGroupSize, 3),
        xAxis,
        series,
        yMin: roundNum(yMin, 3),
        yMax: roundNum(yMax, 3),
        phaseSpans,
        stimulusMarkers
      },
      wells: wellSummaries,
      wellsById,
      groups: groupSummaries,
      zchangeSummary,
      tempAnalysis,
      anomalies,
      comparisonViews
    };
  }

  // ---------------------------------------------------------------------------
  // 6. Exporters (Tidy Long CSV, Well Summary CSV, Prism Grouped CSV/TSV, Python)
  // ---------------------------------------------------------------------------
  function buildTidyLongCsv(analysis, parsed, groups, excludedSet) {
    if (!parsed || parsed.kind !== "summary" || !Array.isArray(parsed.rows)) return "";
    const excl = excludedSet
      ? normalizeExcludedSet(excludedSet)
      : new Set((analysis && analysis.wells ? analysis.wells : []).filter(w => w.excluded).map(w => w.well.toUpperCase()));
    const wells = parsed.wells;
    const hasDistLike = parsed.hasDist || parsed.hasZoneDist;

    const header = ["runtime_s", "rel_time_s", "time_bin", "phase", "trial", "temp_c", "well", "group", "excluded", "qc_status"];
    if (hasDistLike) header.push("dist_mm");
    if (parsed.hasMsd) header.push("msd");
    if (parsed.hasZones) {
      for (let z = 1; z <= parsed.maxZone; z++) {
        if (parsed.hasZoneDist) header.push(`zd_z${z}_mm`);
        if (parsed.hasZoneCount) header.push(`zc_z${z}`);
        if (parsed.hasZoneTime) header.push(`zt_z${z}_s`);
      }
    }

    const lines = [header.join(",")];
    const groupLookup = (w) => {
      if (groups && groups[w]) return String(groups[w]);
      if (analysis && analysis.wellsById && analysis.wellsById[w]) return analysis.wellsById[w].group;
      return "All Wells";
    };

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      for (let wi = 0; wi < wells.length; wi++) {
        const w = wells[wi];
        const qcStatus = (parsed.qc && parsed.qc[w]) ? parsed.qc[w].status : "ok";
        const isExcl = excl.has(w.toUpperCase()) ? "TRUE" : "FALSE";
        const cols = [
          row.runtime,
          row.relTime,
          row.timeBin,
          row.phase || "",
          row.trial !== null ? row.trial : "",
          row.tempC !== null ? row.tempC : "",
          w,
          groupLookup(w),
          isExcl,
          qcStatus
        ];
        if (hasDistLike) {
          const d = extractRowMetricValue(row, w, "dist", parsed);
          cols.push(d !== null ? d.toFixed(3) : "");
        }
        if (parsed.hasMsd) {
          const m = row.msd[w];
          cols.push(m !== null ? m.toFixed(3) : "");
        }
        if (parsed.hasZones) {
          for (let z = 1; z <= parsed.maxZone; z++) {
            if (parsed.hasZoneDist) cols.push(row.zd[w][z] !== null ? row.zd[w][z].toFixed(3) : "");
            if (parsed.hasZoneCount) cols.push(row.zc[w][z] !== null ? row.zc[w][z] : "");
            if (parsed.hasZoneTime) cols.push(row.zt[w][z] !== null ? row.zt[w][z].toFixed(3) : "");
          }
        }
        lines.push(cols.map(v => csvEscape(v, ",")).join(","));
      }
    }
    return lines.join("\n") + "\n";
  }

  function buildWellSummaryCsv(analysis) {
    if (!analysis || !Array.isArray(analysis.wells) || analysis.wells.length === 0) return "";
    const caps = analysis.capabilities || {};
    const phases = analysis.phases || [];

    const header = [
      "well", "group", "excluded", "qc_status", "qc_reason", "active_bins", "spike_count",
      "total_dist_mm", "mean_dist_mm_bin", "mean_speed_mm_s"
    ];
    if (caps.hasMsd) header.push("mean_msd");
    if (caps.hasVmr) header.push("vmr_light_mean", "vmr_dark_mean", "vmr_dark_minus_light", "vmr_dark_onset_burst");
    if (caps.hasZones) {
      for (let z = 1; z <= caps.maxZone; z++) header.push(`z${z}_pct`);
      if (caps.maxZone >= 2) header.push("zone_preference_index");
    }
    if (caps.hasPpi) header.push("pulse_alone_mean", "ppi_trial_mean", "ppi_pct");
    else if (caps.hasStartle) header.push("baseline_mean", "startle_mean", "habituation_pct");
    if (caps.hasZchange) header.push("zchange_entries", "arm_entries", "sab_pct");
    for (const ph of phases) {
      header.push(`phase_${ph.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}_mean_dist`);
    }

    const lines = [header.map(h => csvEscape(h, ",")).join(",")];
    for (const ws of analysis.wells) {
      const row = [
        ws.well,
        ws.group,
        ws.excluded ? "TRUE" : "FALSE",
        ws.qc ? ws.qc.status : "ok",
        ws.qc ? ws.qc.reason : "",
        ws.qc ? ws.qc.activeBins : "",
        ws.qc ? ws.qc.spikeCount : 0,
        ws.totalDist !== null ? ws.totalDist : "",
        ws.meanDist !== null ? ws.meanDist : "",
        ws.meanSpeedMmS !== null ? ws.meanSpeedMmS : ""
      ];
      if (caps.hasMsd) row.push(ws.meanMsd !== null ? ws.meanMsd : "");
      if (caps.hasVmr) {
        row.push(
          ws.vmr && ws.vmr.lightMean !== null ? ws.vmr.lightMean : "",
          ws.vmr && ws.vmr.darkMean !== null ? ws.vmr.darkMean : "",
          ws.vmr && ws.vmr.darkMinusLight !== null ? ws.vmr.darkMinusLight : "",
          ws.vmr && ws.vmr.darkOnsetBurst !== null ? ws.vmr.darkOnsetBurst : ""
        );
      }
      if (caps.hasZones) {
        for (let z = 1; z <= caps.maxZone; z++) {
          row.push(ws.zones && ws.zones.pct[z] !== null ? ws.zones.pct[z] : "");
        }
        if (caps.maxZone >= 2) {
          row.push(ws.zones && ws.zones.preferenceIndex !== null ? ws.zones.preferenceIndex : "");
        }
      }
      if (caps.hasPpi) {
        row.push(
          ws.startle && ws.startle.pulseAloneMean !== null ? ws.startle.pulseAloneMean : "",
          ws.startle && ws.startle.ppiTrialMean !== null ? ws.startle.ppiTrialMean : "",
          ws.startle && ws.startle.ppiPct !== null ? ws.startle.ppiPct : ""
        );
      } else if (caps.hasStartle) {
        row.push(
          ws.startle && ws.startle.baselineMean !== null ? ws.startle.baselineMean : "",
          ws.startle && ws.startle.stimMean !== null ? ws.startle.stimMean : "",
          ws.startle && ws.startle.habituationPct !== null ? ws.startle.habituationPct : ""
        );
      }
      if (caps.hasZchange) {
        row.push(
          ws.zchange ? ws.zchange.totalEntries : "",
          ws.zchange ? ws.zchange.armEntries : "",
          ws.zchange && ws.zchange.sabPct !== null ? ws.zchange.sabPct : ""
        );
      }
      for (const ph of phases) {
        const pd = ws.phaseDist && ws.phaseDist[ph];
        row.push(pd && pd.mean !== null ? pd.mean : "");
      }
      lines.push(row.map(v => csvEscape(v, ",")).join(","));
    }
    return lines.join("\n") + "\n";
  }

  function getAvailablePrismMetrics(analysis) {
    if (!analysis || !analysis.capabilities) return [];
    const caps = analysis.capabilities;
    const out = [];
    if (caps.hasDist) {
      out.push({ id: "total_dist", label: "Total Distance (mm)", unit: "mm" });
      out.push({ id: "mean_dist", label: "Mean Distance (mm/bin)", unit: "mm/bin" });
    }
    if (caps.hasMsd) {
      out.push({ id: "mean_msd", label: "Mean Activity (MSD)", unit: "px" });
    }
    if (caps.hasVmr) {
      out.push({ id: "vmr_delta", label: "VMR Dark - Light (mm/bin)", unit: "mm/bin" });
      out.push({ id: "vmr_burst", label: "VMR Dark-Onset Burst (mm/bin)", unit: "mm/bin" });
    }
    if (caps.hasZones) {
      out.push({ id: "z1_pct", label: "Zone 1 Occupancy (%)", unit: "%" });
      if (caps.maxZone >= 2) {
        out.push({ id: "z2_pct", label: "Zone 2 Occupancy (%)", unit: "%" });
        out.push({ id: "zone_pref", label: "Zone Preference Index ((Z2-Z1)/(Z1+Z2))", unit: "index" });
      }
    }
    if (caps.hasPpi) {
      out.push({ id: "ppi_pct", label: "Prepulse Inhibition (% PPI)", unit: "%" });
      out.push({ id: "pulse_alone", label: "Pulse-Alone Startle (mm/bin)", unit: "mm/bin" });
    } else if (caps.hasStartle) {
      out.push({ id: "startle_mean", label: "Mean Startle Response (mm/bin)", unit: "mm/bin" });
    }
    if (caps.hasSab) {
      out.push({ id: "sab_pct", label: "Y-Maze Alternation (SAB %)", unit: "%" });
    }
    for (const ph of (analysis.phases || [])) {
      out.push({ id: `phase:${ph}`, label: `Phase: ${ph} (Mean Dist)`, unit: "mm/bin" });
    }
    return out;
  }

  function extractWellMetricForPrism(ws, metricKey) {
    if (!ws) return null;
    if (metricKey === "total_dist" || metricKey === "dist") return ws.totalDist;
    if (metricKey === "mean_dist") return ws.meanDist;
    if (metricKey === "mean_msd" || metricKey === "msd") return ws.meanMsd;
    if (metricKey === "vmr_delta") return ws.vmr ? ws.vmr.darkMinusLight : null;
    if (metricKey === "vmr_burst") return ws.vmr ? ws.vmr.darkOnsetBurst : null;
    if (metricKey === "z1_pct") return ws.zones ? ws.zones.z1Pct : null;
    if (metricKey === "z2_pct") return ws.zones ? ws.zones.z2Pct : null;
    if (metricKey === "zone_pref") return ws.zones ? ws.zones.preferenceIndex : null;
    if (metricKey === "ppi_pct") return ws.startle ? ws.startle.ppiPct : null;
    if (metricKey === "pulse_alone") return ws.startle ? ws.startle.pulseAloneMean : null;
    if (metricKey === "startle_mean") return ws.startle ? ws.startle.stimMean : null;
    if (metricKey === "sab_pct") return ws.zchange ? ws.zchange.sabPct : null;
    if (String(metricKey || "").startsWith("phase:")) {
      const ph = metricKey.slice(6);
      return (ws.phaseDist && ws.phaseDist[ph]) ? ws.phaseDist[ph].mean : null;
    }
    const mz = String(metricKey || "").match(/^z(\d+)_pct$/i);
    if (mz && ws.zones) return ws.zones.pct[parseInt(mz[1], 10)] ?? null;
    return ws.totalDist;
  }

  function buildPrismGroupedCsv(analysis, metricKey, opts) {
    if (!analysis || !Array.isArray(analysis.groups) || analysis.groups.length === 0) return "";
    const delimiter = (opts && opts.delimiter) || ",";
    const avail = getAvailablePrismMetrics(analysis);
    const key = metricKey || (avail[0] ? avail[0].id : "total_dist");

    const columns = analysis.groups.map(g => {
      const vals = [];
      for (const w of g.wells) {
        const ws = analysis.wellsById[w];
        if (!ws || ws.excluded) continue;
        const v = extractWellMetricForPrism(ws, key);
        if (v !== null && Number.isFinite(v)) vals.push(v);
      }
      return { name: g.group, vals };
    });

    const maxLen = columns.reduce((mx, c) => Math.max(mx, c.vals.length), 0);
    const lines = [columns.map(c => csvEscape(c.name, delimiter)).join(delimiter)];
    for (let r = 0; r < maxLen; r++) {
      const row = columns.map(c => (r < c.vals.length ? csvEscape(c.vals[r], delimiter) : ""));
      lines.push(row.join(delimiter));
    }
    return lines.join("\n") + "\n";
  }

  function buildPrismGroupedTsv(analysis, metricKey) {
    return buildPrismGroupedCsv(analysis, metricKey, { delimiter: "\t" });
  }

  function buildPythonTemplate(analysis, parsed) {
    const fname = (parsed && parsed.filename) ? parsed.filename : "zantiks_summary.csv";
    const caps = (analysis && analysis.capabilities) || {};
    const wells = (analysis && analysis.wells) || [];

    const groupDictLines = [];
    const excludedList = [];
    for (const ws of wells) {
      groupDictLines.push(`    ${JSON.stringify(ws.well)}: ${JSON.stringify(ws.group)},`);
      if (ws.excluded) excludedList.push(JSON.stringify(ws.well));
    }

    const metricColPrefix = caps.hasDist ? "DIST_" : (caps.hasMsd ? "MSD_" : "DIST_");
    const metricLabel = caps.hasDist ? "Distance (mm / bin)" : "Activity (MSD)";

    const extraProtocolLines = [];
    if (caps.hasPpi) {
      extraProtocolLines.push(
        "",
        "    # --- Prepulse Inhibition (% PPI) per well ---",
        "    pa = long_df[long_df['PHASE'] == 'PULSE_ALONE'].groupby(['well', 'group'])['value'].mean()",
        "    pp = long_df[long_df['PHASE'] == 'PPI_TRIAL'].groupby(['well', 'group'])['value'].mean()",
        "    ppi_df = pd.DataFrame({'pulse_alone': pa, 'ppi_trial': pp}).dropna()",
        "    ppi_df['ppi_pct'] = (1.0 - ppi_df['ppi_trial'] / ppi_df['pulse_alone']) * 100.0",
        "    print('\\n% PPI Summary by Group:')",
        "    print(ppi_df.groupby('group')['ppi_pct'].agg(['count', 'mean', 'sem']))",
        "    ppi_df.reset_index().to_csv('well_ppi_summary.csv', index=False)"
      );
    } else if (caps.hasVmr) {
      extraProtocolLines.push(
        "",
        "    # --- Visual Motor Response (VMR: Light vs Dark) per well ---",
        "    is_dark = long_df['PHASE'].str.upper().str.contains('DARK', na=False)",
        "    vmr = long_df.assign(cond=np.where(is_dark, 'DARK', 'LIGHT')).groupby(['well', 'group', 'cond'])['value'].mean().unstack()",
        "    if {'LIGHT', 'DARK'}.issubset(vmr.columns):",
        "        vmr['dark_minus_light'] = vmr['DARK'] - vmr['LIGHT']",
        "        print('\\nVMR Summary by Group:')",
        "        print(vmr.groupby('group')[['LIGHT', 'DARK', 'dark_minus_light']].mean())",
        "        vmr.reset_index().to_csv('well_vmr_summary.csv', index=False)"
      );
    } else if (caps.hasZones) {
      extraProtocolLines.push(
        "",
        "    # --- Zone Occupancy (%) per well ---",
        "    zt_cols = [c for c in df.columns if c.startswith('ZT_')]",
        "    if zt_cols:",
        "        z_totals = df[zt_cols].sum()",
        "        print('\\nTotal zone time columns detected:', len(z_totals))"
      );
    }

    return [
      "#!/usr/bin/env python3",
      '"""',
      "Zantiks MWP Behavioral Analysis Script",
      `Generated by Zantiks MWP CSV Analyzer for: ${fname}`,
      '"""',
      "",
      "import io",
      "import numpy as np",
      "import pandas as pd",
      "import matplotlib.pyplot as plt",
      "",
      `CSV_PATH = ${JSON.stringify(fname)}`,
      `METRIC_PREFIX = ${JSON.stringify(metricColPrefix)}`,
      `METRIC_LABEL = ${JSON.stringify(metricLabel)}`,
      "",
      "WELL_GROUPS = {",
      ...groupDictLines,
      "}",
      `EXCLUDED_WELLS = {${excludedList.join(", ")}}`,
      "",
      "",
      "def load_zantiks_csv(path: str) -> pd.DataFrame:",
      '    """Load a Zantiks MWP CSV, skipping optional pre-header metadata lines and BOM."""',
      '    with open(path, "r", encoding="utf-8-sig") as f:',
      "        lines = f.readlines()",
      "    header_idx = 0",
      "    for idx, line in enumerate(lines[:60]):",
      "        upper = line.upper()",
      '        if ("RUNTIME" in upper or "TIME_BIN" in upper) and ("DIST_" in upper or "MSD_" in upper or "ZT_" in upper):',
      "            header_idx = idx",
      "            break",
      '    df = pd.read_csv(io.StringIO("".join(lines[header_idx:])))',
      "    df = df.loc[:, ~df.columns.str.startswith('Unnamed:')]",
      "    if 'RUNTIME' in df.columns:",
      "        df['RUNTIME'] = pd.to_numeric(df['RUNTIME'], errors='coerce')",
      "        df = df.dropna(subset=['RUNTIME']).reset_index(drop=True)",
      "        df['rel_time_s'] = df['RUNTIME'] - df['RUNTIME'].iloc[0]",
      "    else:",
      "        df['rel_time_s'] = np.arange(len(df))",
      "    return df",
      "",
      "",
      "def main() -> None:",
      "    df = load_zantiks_csv(CSV_PATH)",
      "    metric_cols = [c for c in df.columns if c.startswith(METRIC_PREFIX)]",
      "    meta_cols = [c for c in ['RUNTIME', 'rel_time_s', 'TEMP_C', 'PHASE', 'TRIAL', 'TIME_BIN'] if c in df.columns]",
      "",
      "    long_df = df.melt(id_vars=meta_cols, value_vars=metric_cols, var_name='col', value_name='value')",
      "    long_df['well'] = long_df['col'].str.replace(METRIC_PREFIX, '', regex=False)",
      "    long_df['value'] = pd.to_numeric(long_df['value'], errors='coerce')",
      "    long_df['group'] = long_df['well'].map(WELL_GROUPS).fillna('Unassigned')",
      "    long_df = long_df[~long_df['well'].isin(EXCLUDED_WELLS)].copy()",
      "",
      "    # --- Per-well summary ---",
      "    well_summary = long_df.groupby(['well', 'group'])['value'].agg(total='sum', mean='mean', max='max').reset_index()",
      "    print('Per-Group Summary:')",
      "    print(well_summary.groupby('group')[['total', 'mean']].agg(['count', 'mean', 'sem']))",
      "    well_summary.to_csv('well_summary_output.csv', index=False)",
      ...extraProtocolLines,
      "",
      "    # --- Time-series Mean +/- SEM plot ---",
      "    ts = long_df.groupby(['group', 'rel_time_s'])['value'].agg(['mean', 'sem']).reset_index()",
      "    fig, ax = plt.subplots(figsize=(10, 4.5), dpi=150)",
      "    if 'PHASE' in df.columns:",
      "        phases = df['PHASE'].fillna('').astype(str).values",
      "        times = df['rel_time_s'].values",
      "        dt = float(np.median(np.diff(times))) if len(times) > 1 else 1.0",
      "        start_i = 0",
      "        for i in range(1, len(phases) + 1):",
      "            if i == len(phases) or phases[i] != phases[start_i]:",
      "                if 'DARK' in phases[start_i].upper():",
      "                    t0 = times[start_i]",
      "                    t1 = times[i] if i < len(times) else times[-1] + dt",
      "                    ax.axvspan(t0, t1, color='#cbd5e1', alpha=0.35, zorder=0)",
      "                start_i = i",
      "",
      "    for grp, gdf in ts.groupby('group', sort=False):",
      "        ax.plot(gdf['rel_time_s'], gdf['mean'], linewidth=2, label=grp)",
      "        ax.fill_between(gdf['rel_time_s'], gdf['mean'] - gdf['sem'], gdf['mean'] + gdf['sem'], alpha=0.2)",
      "",
      "    ax.set_xlabel('Elapsed Time (s)')",
      "    ax.set_ylabel(METRIC_LABEL)",
      "    ax.set_title(f'Zantiks MWP Time Series — {CSV_PATH}')",
      "    ax.legend(frameon=False)",
      "    ax.spines['top'].set_visible(False)",
      "    ax.spines['right'].set_visible(False)",
      "    fig.tight_layout()",
      "    fig.savefig('zantiks_timeseries.png', dpi=200)",
      "    print('Saved zantiks_timeseries.png and well_summary_output.csv')",
      "",
      "",
      'if __name__ == "__main__":',
      "    main()",
      ""
    ].join("\n");
  }

  // ---------------------------------------------------------------------------
  // Public API Export
  // ---------------------------------------------------------------------------
  const API = {
    GROUP_PALETTE,
    SBS_W_MM,
    SBS_H_MM,
    formatDuration,
    getPlateLayout,
    getAvailablePrismMetrics,
    parseZantiksCsv,
    parseExperimentContext,
    loadContextFromZip,
    loadLatestBuilderContext,
    getDemoPresets,
    generateDemoDataset,
    computeAnalysis,
    buildTidyLongCsv,
    buildWellSummaryCsv,
    buildPrismGroupedCsv,
    buildPrismGroupedTsv,
    buildPythonTemplate
  };

  global.ZANTIKS_ANALYZER_CORE = API;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
})(typeof window !== "undefined" ? window : globalThis);
