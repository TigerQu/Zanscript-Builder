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
  const UTF8_BOM = "\uFEFF";
  const ANALYZER_VERSION = "2.0.0";

  function parseIntOr(val, fallback) {
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function parseFloatOr(val, fallback) {
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : fallback;
  }

  const ORGANISM_QC_PRESETS = {
    default:    { id: "default",    label: "Default (General)",  emptyDistMm: 0.1,  spikeMaxSpeedMmS: 150, spikeMinMm: 50, spikeMadMult: 10 },
    zebrafish:  { id: "zebrafish",  label: "Zebrafish Larvae",   emptyDistMm: 0.1,  spikeMaxSpeedMmS: 120, spikeMinMm: 50, spikeMadMult: 10 },
    daphnia:    { id: "daphnia",    label: "Daphnia magna",      emptyDistMm: 0.1,  spikeMaxSpeedMmS: 80,  spikeMinMm: 50, spikeMadMult: 10 },
    drosophila: { id: "drosophila", label: "Drosophila (Adult)", emptyDistMm: 0.2,  spikeMaxSpeedMmS: 180, spikeMinMm: 60, spikeMadMult: 10 },
    celegans:   { id: "celegans",   label: "C. elegans",         emptyDistMm: 0.05, spikeMaxSpeedMmS: 15,  spikeMinMm: 20, spikeMadMult: 10 },
    planaria:   { id: "planaria",   label: "Planaria",           emptyDistMm: 0.05, spikeMaxSpeedMmS: 20,  spikeMinMm: 25, spikeMadMult: 10 },
    custom:     { id: "custom",     label: "Custom",             emptyDistMm: 0.1,  spikeMaxSpeedMmS: 150, spikeMinMm: 50, spikeMadMult: 10 }
  };

  const ORGANISM_QC_PRESET_LIST = Object.values(ORGANISM_QC_PRESETS);

  function getOrganismQcPreset(organismId) {
    const key = String(organismId || "").trim().toLowerCase();
    return ORGANISM_QC_PRESETS[key] || ORGANISM_QC_PRESETS.default;
  }

  function normalizeQcThresholds(qcThresholds, context) {
    if (typeof qcThresholds === "string") {
      const p = getOrganismQcPreset(qcThresholds);
      return { ...p, presetId: p.id };
    }
    const basePresetId = (qcThresholds && qcThresholds.presetId && ORGANISM_QC_PRESETS[qcThresholds.presetId])
      ? qcThresholds.presetId
      : ((qcThresholds && qcThresholds.id && ORGANISM_QC_PRESETS[qcThresholds.id])
          ? qcThresholds.id
          : ((context && context.organismId && ORGANISM_QC_PRESETS[context.organismId])
              ? context.organismId
              : "default"));
    const base = ORGANISM_QC_PRESETS[basePresetId] || ORGANISM_QC_PRESETS.default;
    if (!qcThresholds || typeof qcThresholds !== "object") {
      return { ...base, presetId: base.id };
    }
    const numOr = (val, fallback, minVal) => {
      const n = Number(val);
      return Number.isFinite(n) && n >= minVal ? n : fallback;
    };
    const emptyDistMm = numOr(qcThresholds.emptyDistMm, base.emptyDistMm, 0);
    const spikeMaxSpeedMmS = numOr(qcThresholds.spikeMaxSpeedMmS, base.spikeMaxSpeedMmS, 1);
    const spikeMinMm = numOr(qcThresholds.spikeMinMm, base.spikeMinMm, 1);
    const spikeMadMult = numOr(qcThresholds.spikeMadMult, base.spikeMadMult, 1);
    const matchesBase = Math.abs(emptyDistMm - base.emptyDistMm) < 1e-6 &&
      Math.abs(spikeMaxSpeedMmS - base.spikeMaxSpeedMmS) < 1e-6 &&
      Math.abs(spikeMinMm - base.spikeMinMm) < 1e-6 &&
      Math.abs(spikeMadMult - base.spikeMadMult) < 1e-6;
    const resolvedId = matchesBase ? base.id : "custom";
    const resolvedLabel = matchesBase ? base.label : "Custom";
    return {
      id: resolvedId,
      presetId: resolvedId,
      label: resolvedLabel,
      emptyDistMm,
      spikeMaxSpeedMmS,
      spikeMinMm,
      spikeMadMult
    };
  }

  function filterRowsByTrimWindow(rows, trimWindow) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { rows: [], active: false, invalid: false, warning: "", trimStartSec: null, trimEndSec: null };
    }
    if (!trimWindow || typeof trimWindow !== "object") {
      return { rows, active: false, invalid: false, warning: "", trimStartSec: null, trimEndSec: null };
    }
    const rawStart = trimWindow.trimStartSec !== undefined ? trimWindow.trimStartSec : trimWindow.startSec;
    const rawEnd = trimWindow.trimEndSec !== undefined ? trimWindow.trimEndSec : trimWindow.endSec;
    const startSec = rawStart !== null && rawStart !== "" && rawStart !== undefined ? Number(rawStart) : null;
    const endSec = rawEnd !== null && rawEnd !== "" && rawEnd !== undefined ? Number(rawEnd) : null;
    const hasStart = startSec !== null && Number.isFinite(startSec) && startSec > 0;
    const hasEnd = endSec !== null && Number.isFinite(endSec) && endSec >= 0;
    if (!hasStart && !hasEnd) {
      return { rows, active: false, invalid: false, warning: "", trimStartSec: null, trimEndSec: null };
    }
    if (hasStart && hasEnd && startSec >= endSec) {
      return {
        rows,
        active: false,
        invalid: true,
        warning: `Trim Start (${startSec}s) must be less than Trim End (${endSec}s).`,
        trimStartSec: startSec,
        trimEndSec: endSec
      };
    }
    const filtered = rows.filter(r => {
      if (hasStart && r.relTime < startSec - 1e-6) return false;
      if (hasEnd && r.relTime > endSec + 1e-6) return false;
      return true;
    });
    if (filtered.length === 0) {
      return {
        rows,
        active: false,
        invalid: true,
        warning: "Trim window excludes all rows; keeping full recording.",
        trimStartSec: hasStart ? startSec : null,
        trimEndSec: hasEnd ? endSec : null
      };
    }
    return {
      rows: filtered,
      active: filtered.length !== rows.length,
      invalid: false,
      warning: "",
      trimStartSec: hasStart ? startSec : null,
      trimEndSec: hasEnd ? endSec : null
    };
  }

  function recomputeWellQc(parsed, qcThresholds, trimWindow) {
    const thresholds = normalizeQcThresholds(qcThresholds, null);
    if (!parsed || parsed.kind !== "summary" || !Array.isArray(parsed.wells)) {
      return {
        qc: {},
        qcSummary: { totalWells: 0, okCount: 0, emptyWells: [], spikeWells: [], flaggedWells: [] },
        thresholds
      };
    }

    const trimRes = filterRowsByTrimWindow(parsed.rows || [], trimWindow);
    const rows = trimRes.rows;
    const wellOrder = parsed.wells;
    const hasDist = Boolean(parsed.hasDist);
    const hasMsd = Boolean(parsed.hasMsd);
    const hasZoneDist = Boolean(parsed.hasZoneDist);
    const maxZone = parsed.maxZone || 0;
    const binDurationSec = parsed.binDurationSec || 1;

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
        if (hasDist && row.dist) {
          dVal = row.dist[w];
        } else if (hasZoneDist && row.zd && row.zd[w]) {
          let s = 0;
          let anyZ = false;
          for (let z = 1; z <= maxZone; z++) {
            if (row.zd[w][z] !== null) { s += row.zd[w][z]; anyZ = true; }
          }
          dVal = anyZ ? s : null;
        }
        const mVal = (hasMsd && row.msd) ? row.msd[w] : null;
        distByRow.push(dVal);

        if (dVal !== null && Number.isFinite(dVal)) {
          distVals.push(dVal);
          totalDist += dVal;
          if (dVal > maxBinDist) maxBinDist = dVal;
          if (dVal > 0.05) activeBins++;
        }
        if (mVal !== null && Number.isFinite(mVal)) {
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

      const isEmpty = primaryVals.length === 0 || primaryTotal < thresholds.emptyDistMm || activeBins === 0;
      const medianBinDist = primaryVals.length ? computeMedian(primaryVals) : 0;
      const madBinDist = primaryVals.length ? computeMad(primaryVals, medianBinDist) : 0;
      const spikeThreshold = Math.max(thresholds.spikeMinMm, medianBinDist + thresholds.spikeMadMult * madBinDist);

      const spikeBins = [];
      if (useDistForQc && !isEmpty) {
        for (let i = 0; i < distByRow.length; i++) {
          const v = distByRow[i];
          if (v === null) continue;
          const speed = binDurationSec > 0 ? v / binDurationSec : v;
          if (v > spikeThreshold || speed > thresholds.spikeMaxSpeedMmS) {
            spikeBins.push(i);
          }
        }
      } else if (!useDistForQc && hasMsd && !isEmpty) {
        const msdThresh = Math.max(500, medianBinDist + thresholds.spikeMadMult * madBinDist);
        for (let i = 0; i < rows.length; i++) {
          const v = rows[i].msd ? rows[i].msd[w] : null;
          if (v !== null && v > msdThresh) spikeBins.push(i);
        }
      }

      const spikeCount = spikeBins.length;
      const isSpikeGlitch = spikeCount > 0;
      const flags = [];
      if (isEmpty) flags.push("empty");
      if (isSpikeGlitch) flags.push("spike");

      let status = "ok";
      let qcReason = "ok";
      let reason = "OK";
      let evidence = `totalDist=${totalDist.toFixed(1)} mm, maxBin=${maxBinDist.toFixed(1)} mm`;
      if (isSpikeGlitch && isEmpty) {
        status = "spike";
        qcReason = "empty_well+spike_glitch";
        reason = `Empty + ${spikeCount} spike(s)`;
        evidence = `totalDist=${totalDist.toFixed(2)} mm, maxBin=${maxBinDist.toFixed(1)} mm, ${spikeCount} spikes`;
      } else if (isSpikeGlitch) {
        status = "spike";
        qcReason = "spike_glitch";
        reason = `${spikeCount} reflection spike${spikeCount === 1 ? "" : "s"} (max ${maxBinDist.toFixed(1)} mm/bin)`;
        evidence = `maxBin=${maxBinDist.toFixed(1)} mm (maxSpeed=${maxSpeedMmS.toFixed(1)} mm/s), ${spikeCount} spike${spikeCount === 1 ? "" : "s"}`;
      } else if (isEmpty) {
        status = "empty";
        qcReason = "empty_well";
        reason = `Empty / dead (${totalDist.toFixed(2)} mm total, ${activeBins} active bins)`;
        evidence = `totalDist=${totalDist.toFixed(2)} mm, activeBins=${activeBins}/${rows.length}`;
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
        empty: isEmpty,
        spikeCount,
        spikeBins,
        isSpikeGlitch,
        spikeGlitch: isSpikeGlitch,
        status,
        qcStatus: status,
        qcReason,
        flags,
        reason,
        evidence
      };
    }

    return {
      qc,
      qcSummary: {
        totalWells: wellOrder.length,
        okCount: wellOrder.length - flaggedWells.length,
        emptyWells,
        spikeWells,
        flaggedWells
      },
      thresholds
    };
  }

  function inferRunMeta(filename, parsed, lastModifiedMs) {
    const rawName = String(filename || (parsed && parsed.filename) || "").trim();
    const baseName = rawName.split(/[\\/]/).pop() || "";

    // 1. Infer ISO date (YYYY-MM-DD)
    let date = "";
    const tryExtractDate = (str) => {
      if (!str) return "";
      const s = String(str);
      let m = s.match(/(?:^|[^0-9])(20\d{2})[-_/.](0[1-9]|1[0-2])[-_/.](0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = s.match(/(?:^|[^0-9])(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      return "";
    };

    date = tryExtractDate(baseName);
    if (!date && parsed && parsed.systemMeta) {
      for (const v of Object.values(parsed.systemMeta)) {
        const hit = tryExtractDate(v);
        if (hit) { date = hit; break; }
      }
    }
    if (!date && Number.isFinite(lastModifiedMs) && lastModifiedMs > 0) {
      try {
        date = new Date(lastModifiedMs).toISOString().slice(0, 10);
      } catch (_) {}
    }
    if (!date) {
      date = new Date().toISOString().slice(0, 10);
    }

    // 2. Infer clean runId
    let stem = baseName
      .replace(/\.csv$/i, "")
      .replace(/(_ZCHANGE|_XY|_SUMMARY)$/i, "")
      .replace(/^(20\d{2}[-_.]?(?:0[1-9]|1[0-2])[-_.]?(?:0[1-9]|[12]\d|3[01]))[-_\s]*/i, "")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36);
    if (!stem) stem = "Run_1";

    return { runId: stem, date };
  }

  function extractWellFactors(well, factorNames, wellFactors) {
    const out = {};
    if (!Array.isArray(factorNames) || factorNames.length === 0 || !wellFactors || typeof wellFactors !== "object") {
      return out;
    }
    // Support both factor-major { genotype: { A1: "WT" } } and well-major { A1: { genotype: "WT" } }
    const wellMajorObj = wellFactors[well] && typeof wellFactors[well] === "object" && !Array.isArray(wellFactors[well])
      ? wellFactors[well]
      : null;

    for (const fName of factorNames) {
      const fMap = wellFactors[fName];
      let val = "";
      if (fMap && typeof fMap === "object" && well in fMap && fMap[well] != null) {
        val = String(fMap[well]).trim();
      } else if (wellMajorObj && fName in wellMajorObj && wellMajorObj[fName] != null) {
        val = String(wellMajorObj[fName]).trim();
      }
      out[fName] = val;
    }
    return out;
  }

  function synthesizeGroupsFromFactors(wells, factorNames, wellFactors, opts) {
    const sep = (opts && opts.separator) || " · ";
    const names = Array.isArray(factorNames) ? factorNames.map(s => String(s || "").trim()).filter(Boolean) : [];
    const groups = {};
    const groupOrder = [];
    const seen = new Set();

    for (const w of (wells || [])) {
      const fVals = extractWellFactors(w, names, wellFactors);
      const parts = names.map(fn => fVals[fn]).filter(Boolean);
      if (parts.length > 0) {
        const gName = parts.join(sep);
        groups[w] = gName;
        if (!seen.has(gName)) {
          seen.add(gName);
          groupOrder.push(gName);
        }
      }
    }
    return { groups, groupOrder };
  }

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

    // Per-well QC diagnostics (via reusable recomputeWellQc)
    const qcOut = recomputeWellQc({
      kind: "summary",
      wells: wellOrder,
      rows,
      hasDist,
      hasMsd,
      hasZoneDist,
      maxZone,
      binDurationSec
    }, ORGANISM_QC_PRESETS.default);
    const qc = qcOut.qc;
    const qcSummary = qcOut.qcSummary;

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
      const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
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
      const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
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
      const lightHrs = Math.max(0, parseIntOr(sp.lightHours, 16));
      const darkHrs = Math.max(0, parseIntOr(sp.darkHours, 8));
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
      if (thermEnabled && t > 0) tempSchedule.push({ startSec: 0, endSec: t, tempC: defaultTemp, label: `${defaultTemp}°C` });
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
      },
      {
        id: "ld_multi_2p",
        name: "L/D 2-Plate Pool (Multi-Factor + _XY)",
        shortName: "L/D 2-Plate Pool",
        description: "2 replicate 24-well runs (+18% batch drift) · genotype × treatment factors · QC flags + _XY spatial trajectories"
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

  function generateLdMulti2pDemo() {
    const wells = makeWellLabels(4, 6); // A1..D6
    const factorNames = ["genotype", "treatment"];
    const wellFactors = { genotype: {}, treatment: {} };
    for (const w of wells) {
      const rowCh = w[0];
      const col = parseInt(w.slice(1), 10);
      wellFactors.genotype[w] = (rowCh === "A" || rowCh === "B") ? "WT" : "Mutant";
      wellFactors.treatment[w] = col <= 3 ? "Vehicle" : "Drug";
    }
    const synth = synthesizeGroupsFromFactors(wells, factorNames, wellFactors);
    const defaultGroups = synth.groups;
    const groupOrder = ["WT · Vehicle", "WT · Drug", "Mutant · Vehicle", "Mutant · Drug"];
    const groupPalette = {
      "WT · Vehicle": GROUP_PALETTE[0],
      "WT · Drug": GROUP_PALETTE[1],
      "Mutant · Vehicle": GROUP_PALETTE[4],
      "Mutant · Drug": GROUP_PALETTE[3]
    };

    const buildPlateSummary = (plateCfg) => {
      const rng = createPrng(plateCfg.seed);
      const binSec = 10;
      const phaseBins = 30;
      const cycles = 2;
      const totalRows = cycles * 2 * phaseBins; // 120 rows
      const scale = plateCfg.batchScale;

      const wellFactor = {};
      for (const w of wells) wellFactor[w] = 0.89 + rng() * 0.22;

      const header = [
        "RUNTIME", "UNIT_ID", "TEMP_C", "PHASE", "TRIAL", "TIME_BIN",
        ...wells.map(w => `DIST_${w}`),
        ...wells.map(w => `MSD_${w}`),
        ...wells.flatMap(w => [`ZD_${w}_Z1`, `ZD_${w}_Z2`]),
        ...wells.flatMap(w => [`ZC_${w}_Z1`, `ZC_${w}_Z2`]),
        ...wells.flatMap(w => [`ZT_${w}_Z1`, `ZT_${w}_Z2`])
      ];
      const lines = [header.join(",")];
      const startRuntime = 180;

      for (let i = 0; i < totalRows; i++) {
        const cycle = Math.floor(i / (phaseBins * 2)) + 1;
        const inCycle = i % (phaseBins * 2);
        const isDark = inCycle >= phaseBins;
        const phase = isDark ? "DARK" : "LIGHT";
        const inPhaseBin = isDark ? (inCycle - phaseBins) : inCycle;
        const runtime = startRuntime + (i + 1) * binSec;
        const tempC = 28.0 + plateCfg.tempOffset - 0.28 * Math.exp(-i / 18) + 0.08 * Math.sin(i / 8) + nextNormal(rng) * 0.03;

        const distRow = [];
        const msdRow = [];
        const zdRow = [];
        const zcRow = [];
        const ztRow = [];

        for (const w of wells) {
          if (w === plateCfg.emptyWell) {
            distRow.push("0.00");
            msdRow.push("0.00");
            zdRow.push("0.00", "0.00");
            zcRow.push("0", "0");
            ztRow.push("0.00", "0.00");
            continue;
          }

          const grp = defaultGroups[w];
          const f = wellFactor[w] * scale;
          let baseDist;
          let z2Frac;

          if (grp === "WT · Vehicle") {
            baseDist = isDark ? (22.0 + 11.5 * Math.exp(-inPhaseBin / 4.2)) * f : (12.5 + 2.0 * Math.exp(-inPhaseBin / 3)) * f;
            z2Frac = isDark ? 0.34 : 0.44;
          } else if (grp === "WT · Drug") {
            baseDist = isDark ? (18.5 + 9.0 * Math.exp(-inPhaseBin / 4.0)) * f : (10.8 + 1.5 * Math.exp(-inPhaseBin / 3)) * f;
            z2Frac = isDark ? 0.48 : 0.54;
          } else if (grp === "Mutant · Vehicle") {
            baseDist = isDark ? (12.8 + 5.2 * Math.exp(-inPhaseBin / 3.6)) * f : (7.4 + 1.2 * Math.exp(-inPhaseBin / 3)) * f;
            z2Frac = isDark ? 0.20 : 0.24;
          } else {
            // Mutant · Drug (partial rescue)
            baseDist = isDark ? (19.6 + 9.8 * Math.exp(-inPhaseBin / 4.0)) * f : (11.2 + 1.8 * Math.exp(-inPhaseBin / 3)) * f;
            z2Frac = isDark ? 0.42 : 0.48;
          }

          let d = Math.max(0.4, Math.min(47.0, baseDist + nextNormal(rng) * (baseDist * 0.09)));
          let m = Math.max(1.0, d * 4.1 + 7 + nextNormal(rng) * 3.8);

          if (w === plateCfg.spikeWell && plateCfg.glitchBins.has(i)) {
            d = plateCfg.glitchBins.get(i);
            m = d * 5.6;
          }

          const z2Share = Math.min(0.90, Math.max(0.06, z2Frac + nextNormal(rng) * 0.05));
          const zt2 = binSec * z2Share;
          const zt1 = binSec - zt2;
          const zd2 = d * z2Share;
          const zd1 = d - zd2;
          const crossRate = Math.max(0, Math.round((d / 12) + rng() * 1.4));
          const zc1 = Math.max(0, Math.round(crossRate * 0.5));
          const zc2 = Math.max(0, crossRate - zc1 + (d > 5 ? 1 : 0));

          distRow.push(d.toFixed(2));
          msdRow.push(m.toFixed(2));
          zdRow.push(zd1.toFixed(2), zd2.toFixed(2));
          zcRow.push(String(zc1), String(zc2));
          ztRow.push(zt1.toFixed(2), zt2.toFixed(2));
        }

        lines.push([
          runtime.toFixed(1),
          plateCfg.unitId,
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
      return lines.join("\n") + "\n";
    };

    const buildPlate1Xy = () => {
      const rng = createPrng(20261120);
      const p24 = FALLBACK_PLATES["24well"];
      const dt = 0.5; // 2 Hz
      const frames = 120; // 60s window
      const R = p24.r; // 8.13 mm
      const Rmax = R * 0.94;
      const xyHeader = ["RUNTIME", ...wells.flatMap(w => [`X_${w}`, `Y_${w}`])];
      const xyLines = [xyHeader.join(",")];

      // Initialize per-well positions and state
      const stateByW = {};
      for (let idx = 0; idx < wells.length; idx++) {
        const w = wells[idx];
        const rIdx = Math.floor(idx / 6);
        const cIdx = idx % 6;
        const cx = p24.xOffset + cIdx * p24.colStep;
        const cy = p24.yOffset + rIdx * p24.rowStep;
        const grp = defaultGroups[w];
        const ang0 = rng() * Math.PI * 2;
        const rad0 = grp === "Mutant · Vehicle" ? R * 0.82 : R * 0.45;
        stateByW[w] = {
          cx, cy,
          x: cx + Math.cos(ang0) * rad0,
          y: cy + Math.sin(ang0) * rad0,
          angle: ang0,
          frozenLeft: 0
        };
      }

      for (let f = 0; f < frames; f++) {
        const runtime = 180 + f * dt;
        const cols = [runtime.toFixed(2)];
        for (const w of wells) {
          const st = stateByW[w];
          if (w === "B3") {
            // Empty well: stationary point
            cols.push(st.cx.toFixed(2), st.cy.toFixed(2));
            continue;
          }
          const grp = defaultGroups[w];
          const freezeProb = grp === "Mutant · Vehicle" ? 0.36 : (grp === "WT · Drug" ? 0.19 : (grp === "Mutant · Drug" ? 0.16 : 0.11));
          const wallBias = grp === "Mutant · Vehicle" ? 0.89 : (grp === "WT · Drug" ? 0.30 : (grp === "Mutant · Drug" ? 0.44 : 0.56));
          const baseSpd = grp === "Mutant · Vehicle" ? 2.1 : (grp === "WT · Vehicle" ? 3.8 : 3.2);

          let dx = 0;
          let dy = 0;
          if (st.frozenLeft > 0) {
            st.frozenLeft--;
            dx = nextNormal(rng) * 0.04;
            dy = nextNormal(rng) * 0.04;
          } else if (rng() < freezeProb * 0.35) {
            st.frozenLeft = 2 + Math.floor(rng() * 4);
            dx = nextNormal(rng) * 0.04;
            dy = nextNormal(rng) * 0.04;
          } else {
            const burst = rng() < 0.10 ? (2.2 + rng() * 1.4) : 1.0;
            const stepLen = Math.max(0.3, (baseSpd * burst + nextNormal(rng) * 0.6) * dt);
            st.angle += nextNormal(rng) * 0.85;

            // Radial guidance toward target zone (outer wall vs inner center)
            const rx = st.x - st.cx;
            const ry = st.y - st.cy;
            const rad = Math.hypot(rx, ry);
            const targetRad = wallBias * Rmax;
            if (rad > 0.2) {
              const pull = (targetRad - rad) * 0.55;
              dx = Math.cos(st.angle) * stepLen + (rx / rad) * pull;
              dy = Math.sin(st.angle) * stepLen + (ry / rad) * pull;
            } else {
              dx = Math.cos(st.angle) * stepLen;
              dy = Math.sin(st.angle) * stepLen;
            }
          }

          let nx = st.x + dx;
          let ny = st.y + dy;
          const nRad = Math.hypot(nx - st.cx, ny - st.cy);
          if (nRad > Rmax) {
            nx = st.cx + ((nx - st.cx) / nRad) * Rmax;
            ny = st.cy + ((ny - st.cy) / nRad) * Rmax;
            st.angle += Math.PI * (0.6 + rng() * 0.5);
          }
          st.x = nx;
          st.y = ny;
          cols.push(st.x.toFixed(2), st.y.toFixed(2));
        }
        xyLines.push(cols.join(","));
      }
      return xyLines.join("\n") + "\n";
    };

    const makeExpPayload = (dateIso, tag) => ({
      format: DEFAULT_EXPERIMENT_FORMAT,
      version: 1,
      savedAt: `${dateIso}T09:30:00.000Z`,
      experiment: {
        organism: "zebrafish",
        plateId: "24well",
        stimId: "ld_transitions",
        inputs: {
          userName: "Demo Pool",
          expPrefix: tag,
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
          chk_xy: tag === "plate1_pool",
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
    });

    const p1Csv = buildPlateSummary({
      seed: 202611201,
      unitId: "MWP-Z3-0142",
      batchScale: 1.0,
      tempOffset: 0.0,
      emptyWell: "B3",
      spikeWell: "D6",
      glitchBins: new Map([[16, 265.2], [52, 348.5], [96, 381.0]])
    });
    const p2Csv = buildPlateSummary({
      seed: 202611212,
      unitId: "MWP-Z3-0142",
      batchScale: 1.18, // Realistic +18% inter-plate baseline shift!
      tempOffset: 0.08,
      emptyWell: "C1",
      spikeWell: "A6",
      glitchBins: new Map([[22, 282.4], [64, 364.1], [108, 396.8]])
    });
    const p1XyCsv = buildPlate1Xy();
    const exp1 = makeExpPayload("2026-11-20", "plate1_pool");
    const exp2 = makeExpPayload("2026-11-21", "plate2_pool");

    const run1 = {
      id: "plate_1",
      runId: "Plate_1",
      date: "2026-11-20",
      summaryFilename: "2026-11-20_Plate_1_ld_24w.csv",
      summaryCsvText: p1Csv,
      zchangeFilename: null,
      zchangeCsvText: null,
      xyFilename: "2026-11-20_Plate_1_ld_24w_XY.csv",
      xyCsvText: p1XyCsv,
      experimentPayload: exp1,
      experimentContext: parseExperimentContext(exp1, "demo"),
      defaultGroups: { ...defaultGroups },
      groupOrder: groupOrder.slice(),
      factorNames: factorNames.slice(),
      wellFactors: { genotype: { ...wellFactors.genotype }, treatment: { ...wellFactors.treatment } },
      groupPalette: { ...groupPalette },
      defaultExcluded: []
    };

    const run2 = {
      id: "plate_2",
      runId: "Plate_2",
      date: "2026-11-21",
      summaryFilename: "2026-11-21_Plate_2_ld_24w.csv",
      summaryCsvText: p2Csv,
      zchangeFilename: null,
      zchangeCsvText: null,
      xyFilename: null,
      xyCsvText: null,
      experimentPayload: exp2,
      experimentContext: parseExperimentContext(exp2, "demo"),
      defaultGroups: { ...defaultGroups },
      groupOrder: groupOrder.slice(),
      factorNames: factorNames.slice(),
      wellFactors: { genotype: { ...wellFactors.genotype }, treatment: { ...wellFactors.treatment } },
      groupPalette: { ...groupPalette },
      defaultExcluded: []
    };

    return {
      presetId: "ld_multi_2p",
      isMultiRun: true,
      name: "L/D 2-Plate Pool (Multi-Factor + _XY)",
      description: "2 replicate 24-well Light/Dark runs (Plate_1 on 2026-11-20 + Plate_2 on 2026-11-21 with +18% batch drift), 2x2 genotype × treatment factors, QC flags on each plate, and _XY frame trajectories on Plate 1.",
      defaultControlGroup: "WT · Vehicle",
      runs: [run1, run2],
      // Single-run fallback aliases (Plate 1)
      summaryFilename: run1.summaryFilename,
      summaryCsvText: run1.summaryCsvText,
      zchangeFilename: null,
      zchangeCsvText: null,
      xyFilename: run1.xyFilename,
      xyCsvText: run1.xyCsvText,
      experimentPayload: run1.experimentPayload,
      experimentContext: run1.experimentContext,
      defaultGroups: run1.defaultGroups,
      groupOrder: run1.groupOrder,
      factorNames: run1.factorNames,
      wellFactors: run1.wellFactors,
      groupPalette: run1.groupPalette,
      defaultExcluded: []
    };
  }

  function generateDemoDataset(presetId) {
    if (presetId === "ppi_24w") return generatePpi24Demo();
    if (presetId === "ymaze_15") return generateYMaze15Demo();
    if (presetId === "ld_multi_2p") return generateLdMulti2pDemo();
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

  // ---------------------------------------------------------------------------
  // 5b. Behavioral Feature Extraction: _XY Spatial, Peri-Stimulus & Window AUC
  // ---------------------------------------------------------------------------
  function computePercentile(arr, p) {
    if (!arr || arr.length === 0) return null;
    const sorted = arr.slice().sort((a, b) => a - b);
    const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function analyzeXyData(xyParsed, layout, opts) {
    if (!xyParsed || xyParsed.kind !== "xy" || !Array.isArray(xyParsed.rows) || xyParsed.rows.length === 0) {
      return null;
    }
    const cfg = opts || {};
    const freezeSpeedMmS = Number.isFinite(Number(cfg.freezeSpeedMmS)) && Number(cfg.freezeSpeedMmS) >= 0
      ? Number(cfg.freezeSpeedMmS)
      : 0.5;
    const wellGridSize = Math.min(48, Math.max(8, parseInt(cfg.wellGridSize, 10) || 24));
    const plateGridW = Math.min(96, Math.max(12, parseInt(cfg.plateGridW, 10) || 48));
    const plateGridH = Math.min(64, Math.max(8, parseInt(cfg.plateGridH, 10) || 32));
    const excludedSet = normalizeExcludedSet(cfg.excludedWells);
    const rawGroups = (cfg.groups && typeof cfg.groups === "object") ? cfg.groups : {};
    const trimRes = filterRowsByTrimWindow(xyParsed.rows, cfg.trimWindow);
    const frames = trimRes.rows;
    const wells = xyParsed.wells || [];
    const wellCoords = (layout && layout.wellCoords) ? layout.wellCoords : {};
    const plateW = (layout && layout.plateW) || SBS_W_MM;
    const plateH = (layout && layout.plateH) || SBS_H_MM;

    const plateGrid = Array.from({ length: plateGridH }, () => Array(plateGridW).fill(0));
    let plateMaxCount = 0;

    const hasAnyUserGrp = wells.some(w => rawGroups[w] && String(rawGroups[w]).trim() !== "");
    const wellsById = {};
    const groupAccum = {};

    for (const w of wells) {
      const grp = hasAnyUserGrp
        ? (rawGroups[w] && String(rawGroups[w]).trim() ? String(rawGroups[w]).trim() : "Unassigned")
        : "All Wells";
      const excluded = excludedSet.has(w.toUpperCase());

      // Collect valid (t, x, y) points for this well
      const pts = [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < frames.length; i++) {
        const fr = frames[i];
        const pt = fr.xy && fr.xy[w];
        if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
        pts.push({ t: fr.runtime, relTime: fr.relTime, x: pt.x, y: pt.y });
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }

      const wGrid = Array.from({ length: wellGridSize }, () => Array(wellGridSize).fill(0));
      if (pts.length === 0) {
        wellsById[w] = {
          well: w, group: grp, excluded, frameCount: 0,
          immobilityPct: null, meanSpeedMmS: null, burstSpeedP95MmS: null,
          totalPathMm: 0, centerOccupancyPct: null, outerWallPct: null,
          meanWallDistMm: null, meanNormRadius: null,
          grid: wGrid, maxCell: 0, gridSize: wellGridSize
        };
        continue;
      }

      // Resolve well center & radius (use layout coords when points fall within the expected well)
      let cx = (minX + maxX) / 2;
      let cy = (minY + maxY) / 2;
      let R = Math.max(1.0, Math.max(maxX - minX, maxY - minY) / 2);
      const lc = wellCoords[w];
      if (lc && Number.isFinite(lc.x) && Number.isFinite(lc.y) && Number.isFinite(lc.r) && lc.r > 0) {
        const medDistToLayout = computeMedian(pts.map(p => Math.hypot(p.x - lc.x, p.y - lc.y)));
        if (medDistToLayout <= lc.r * 2.5) {
          cx = lc.x;
          cy = lc.y;
          R = lc.r;
        }
      }

      const rInner = R * Math.SQRT1_2; // Equal-area 50% inner circle
      const speeds = [];
      let immobileCount = 0;
      let totalPathMm = 0;
      let centerCount = 0;
      let wallDistSum = 0;
      let normRadSum = 0;

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const rx = p.x - cx;
        const ry = p.y - cy;
        const rad = Math.hypot(rx, ry);
        const normRad = Math.min(1.0, rad / Math.max(0.5, R));
        const wallDist = Math.max(0, R - rad);
        if (rad <= rInner) centerCount++;
        wallDistSum += wallDist;
        normRadSum += normRad;

        // Bin into normalized per-well grid [-R, +R] x [-R, +R]
        const gx = Math.min(wellGridSize - 1, Math.max(0, Math.floor(((rx / R) * 0.5 + 0.5) * wellGridSize)));
        const gy = Math.min(wellGridSize - 1, Math.max(0, Math.floor(((ry / R) * 0.5 + 0.5) * wellGridSize)));
        wGrid[gy][gx] += 1;

        // Bin into full-plate heatmap grid (included wells only)
        if (!excluded && p.x >= 0 && p.x <= plateW && p.y >= 0 && p.y <= plateH) {
          const px = Math.min(plateGridW - 1, Math.max(0, Math.floor((p.x / plateW) * plateGridW)));
          const py = Math.min(plateGridH - 1, Math.max(0, Math.floor((p.y / plateH) * plateGridH)));
          plateGrid[py][px] += 1;
          if (plateGrid[py][px] > plateMaxCount) plateMaxCount = plateGrid[py][px];
        }

        if (i > 0) {
          const dt = p.t - pts[i - 1].t;
          if (dt > 0 && dt < 30) {
            const step = Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
            const spd = step / dt;
            speeds.push(spd);
            totalPathMm += step;
            if (spd < freezeSpeedMmS) immobileCount++;
          }
        }
      }

      // Normalize per-well occupancy grid to probability density
      let maxCell = 0;
      const invN = 1 / pts.length;
      for (let gy = 0; gy < wellGridSize; gy++) {
        for (let gx = 0; gx < wellGridSize; gx++) {
          const prob = wGrid[gy][gx] * invN;
          wGrid[gy][gx] = roundNum(prob, 5);
          if (prob > maxCell) maxCell = prob;
        }
      }

      const immobilityPct = speeds.length > 0 ? roundNum((immobileCount / speeds.length) * 100, 2) : null;
      const meanSpeedMmS = speeds.length > 0 ? roundNum(speeds.reduce((a, b) => a + b, 0) / speeds.length, 3) : null;
      const burstSpeedP95MmS = speeds.length > 0 ? roundNum(computePercentile(speeds, 0.95), 3) : null;
      const centerOccupancyPct = roundNum((centerCount / pts.length) * 100, 2);
      const outerWallPct = centerOccupancyPct !== null ? roundNum(100 - centerOccupancyPct, 2) : null;
      const meanWallDistMm = roundNum(wallDistSum / pts.length, 3);
      const meanNormRadius = roundNum(normRadSum / pts.length, 3);

      const rec = {
        well: w,
        group: grp,
        excluded,
        frameCount: pts.length,
        centerX: roundNum(cx, 2),
        centerY: roundNum(cy, 2),
        radiusMm: roundNum(R, 2),
        immobilityPct,
        meanSpeedMmS,
        burstSpeedP95MmS,
        totalPathMm: roundNum(totalPathMm, 2),
        centerOccupancyPct,
        outerWallPct,
        meanWallDistMm,
        meanNormRadius,
        gridSize: wellGridSize,
        grid: wGrid,
        maxCell: roundNum(maxCell, 5)
      };
      wellsById[w] = rec;

      if (!excluded) {
        if (!groupAccum[grp]) groupAccum[grp] = [];
        groupAccum[grp].push(rec);
      }
    }

    // Normalize plate heatmap to [0, 1]
    const normPlateGrid = plateGrid.map(row =>
      row.map(c => (plateMaxCount > 0 ? roundNum(c / plateMaxCount, 4) : 0))
    );

    // Aggregate per-group heatmaps and summary stats
    const groupHeatmaps = {};
    const groupStats = {};
    for (const [gName, recs] of Object.entries(groupAccum)) {
      const avgGrid = Array.from({ length: wellGridSize }, () => Array(wellGridSize).fill(0));
      let gMax = 0;
      const invG = recs.length > 0 ? 1 / recs.length : 0;
      for (const r of recs) {
        for (let gy = 0; gy < wellGridSize; gy++) {
          for (let gx = 0; gx < wellGridSize; gx++) {
            avgGrid[gy][gx] += (r.grid[gy][gx] || 0) * invG;
          }
        }
      }
      for (let gy = 0; gy < wellGridSize; gy++) {
        for (let gx = 0; gx < wellGridSize; gx++) {
          avgGrid[gy][gx] = roundNum(avgGrid[gy][gx], 5);
          if (avgGrid[gy][gx] > gMax) gMax = avgGrid[gy][gx];
        }
      }
      groupHeatmaps[gName] = { size: wellGridSize, grid: avgGrid, maxVal: roundNum(gMax, 5), n: recs.length };
      groupStats[gName] = {
        n: recs.length,
        immobilityPct: computeStats(recs.map(r => r.immobilityPct)),
        meanSpeedMmS: computeStats(recs.map(r => r.meanSpeedMmS)),
        burstSpeedP95MmS: computeStats(recs.map(r => r.burstSpeedP95MmS)),
        centerOccupancyPct: computeStats(recs.map(r => r.centerOccupancyPct)),
        outerWallPct: computeStats(recs.map(r => r.outerWallPct)),
        meanWallDistMm: computeStats(recs.map(r => r.meanWallDistMm)),
        meanNormRadius: computeStats(recs.map(r => r.meanNormRadius))
      };
    }

    const durationSec = frames.length > 1 ? roundNum(Math.max(0, frames[frames.length - 1].runtime - frames[0].runtime), 2) : 0;
    return {
      hasXy: true,
      filename: xyParsed.filename || "",
      frameCount: frames.length,
      durationSec,
      estimatedFps: xyParsed.estimatedFps || null,
      freezeSpeedMmS,
      wellGridSize,
      plateGrid: {
        width: plateGridW,
        height: plateGridH,
        plateW,
        plateH,
        grid: normPlateGrid,
        rawMaxCount: plateMaxCount,
        maxVal: plateMaxCount > 0 ? 1 : 0
      },
      wellsById,
      groups: groupStats,
      groupHeatmaps
    };
  }

  function computeWindowAucForWell(rows, parsed, well, windowAuc, metricId, binSec) {
    if (!windowAuc || typeof windowAuc !== "object") return null;
    const startSec = Number(windowAuc.startSec);
    const endSec = Number(windowAuc.endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;

    const pts = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.relTime < startSec - 1e-6 || r.relTime > endSec + 1e-6) continue;
      const v = extractRowMetricValue(r, well, metricId, parsed);
      if (v !== null && Number.isFinite(v)) {
        pts.push({ t: r.relTime, y: v });
      }
    }
    if (pts.length === 0) {
      return { startSec, endSec, auc: null, mean: null, sum: null, bins: 0 };
    }
    let sum = 0;
    for (let i = 0; i < pts.length; i++) sum += pts[i].y;
    const mean = sum / pts.length;

    let auc = 0;
    if (pts.length === 1) {
      auc = pts[0].y * Math.min(binSec || 1, endSec - startSec);
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        const dt = Math.max(0, pts[i + 1].t - pts[i].t);
        auc += 0.5 * (pts[i].y + pts[i + 1].y) * dt;
      }
    }
    return {
      startSec,
      endSec,
      auc: roundNum(auc, 3),
      mean: roundNum(mean, 3),
      sum: roundNum(sum, 3),
      bins: pts.length
    };
  }

  function computePeriStimulusAndHabituation(rows, parsed, stimulusMarkers, wellSummaries, activeGroupNames, hasPpi, hasDistLike, binSec) {
    if (!Array.isArray(stimulusMarkers) || stimulusMarkers.length === 0 || !Array.isArray(rows) || rows.length === 0) {
      return { periStimulus: null, habituationByWell: {}, habituationByGroup: {} };
    }
    const metricId = hasDistLike ? "dist" : (parsed.hasMsd ? "msd" : null);
    if (!metricId) {
      return { periStimulus: null, habituationByWell: {}, habituationByGroup: {} };
    }

    // Estimate inter-stimulus spacing in bins to cap peri-stimulus window cleanly
    let minGapBins = 16;
    for (let i = 1; i < stimulusMarkers.length; i++) {
      const gap = stimulusMarkers[i].rowIndex - stimulusMarkers[i - 1].rowIndex;
      if (gap > 1 && gap < minGapBins) minGapBins = gap;
    }
    const preBins = Math.min(Math.max(1, Math.floor((minGapBins - 1) / 3)), Math.max(1, Math.round(5 / binSec)));
    const postBins = Math.min(Math.max(2, minGapBins - preBins - 1), Math.max(3, Math.round(10 / binSec)));
    const offsets = [];
    for (let k = -preBins; k <= postBins; k++) offsets.push(k);
    const offsetsSec = offsets.map(k => roundNum(k * binSec, 2));

    const buildAlignedSet = (markers, label) => {
      const series = [];
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const gName of activeGroupNames) {
        const incWells = wellSummaries.filter(ws => ws.group === gName && !ws.excluded).map(ws => ws.well);
        // Average across trials per well first, then mean +/- SEM across wells (proper animal-level N!)
        const perOffsetVals = offsets.map(() => []);
        for (const w of incWells) {
          for (let oi = 0; oi < offsets.length; oi++) {
            const off = offsets[oi];
            let wSum = 0;
            let wCnt = 0;
            for (const mk of markers) {
              const rIdx = mk.rowIndex + off;
              if (rIdx >= 0 && rIdx < rows.length) {
                const v = extractRowMetricValue(rows[rIdx], w, metricId, parsed);
                if (v !== null && Number.isFinite(v)) { wSum += v; wCnt++; }
              }
            }
            if (wCnt > 0) perOffsetVals[oi].push(wSum / wCnt);
          }
        }
        const values = perOffsetVals.map(arr => {
          const st = computeStats(arr);
          if (st.mean !== null) {
            yMin = Math.min(yMin, st.mean - (st.sem || 0));
            yMax = Math.max(yMax, st.mean + (st.sem || 0));
          }
          return {
            mean: st.mean !== null ? roundNum(st.mean, 3) : null,
            sem: st.sem !== null ? roundNum(st.sem, 3) : null,
            sd: st.sd !== null ? roundNum(st.sd, 3) : null,
            n: st.n
          };
        });
        series.push({ group: gName, n: incWells.length, values });
      }
      return {
        label,
        trialCount: markers.length,
        offsetsSec,
        series,
        yMin: Number.isFinite(yMin) ? roundNum(Math.min(0, yMin), 3) : 0,
        yMax: Number.isFinite(yMax) ? roundNum(yMax, 3) : 1
      };
    };

    const byType = { ALL: buildAlignedSet(stimulusMarkers, "All Stimuli") };
    const paMarkers = stimulusMarkers.filter(m => /^PULSE_ALONE\b/i.test(m.phase));
    const ppiMarkers = stimulusMarkers.filter(m => /^PPI_TRIAL\b/i.test(m.phase));
    if (hasPpi && paMarkers.length > 0) byType.PULSE_ALONE = buildAlignedSet(paMarkers, "Pulse Alone");
    if (hasPpi && ppiMarkers.length > 0) byType.PPI_TRIAL = buildAlignedSet(ppiMarkers, "PPI Trial");

    // Trial-by-trial peak extraction & Habituation Index
    // For PPI, track repeated PULSE_ALONE trials; otherwise track all stimulus trials
    const habitMarkers = (hasPpi && paMarkers.length >= 2) ? paMarkers : stimulusMarkers;
    const trialLabels = habitMarkers.map((m, idx) => `T${idx + 1}`);
    const habituationByWell = {};

    if (habitMarkers.length >= 2) {
      for (const ws of wellSummaries) {
        const w = ws.well;
        const trialPeaks = [];
        for (const mk of habitMarkers) {
          // Take peak value within the stimulus bin (and adjacent bin if multi-bin stim)
          let peak = null;
          const r0 = mk.rowIndex;
          const v0 = extractRowMetricValue(rows[r0], w, metricId, parsed);
          if (v0 !== null && Number.isFinite(v0)) peak = v0;
          trialPeaks.push(peak !== null ? roundNum(peak, 3) : null);
        }
        const finitePeaks = trialPeaks.filter(v => v !== null);
        let meanFirst2 = null;
        let meanLast2 = null;
        let habituationIndex = null;
        if (finitePeaks.length >= 4) {
          meanFirst2 = (finitePeaks[0] + finitePeaks[1]) / 2;
          meanLast2 = (finitePeaks[finitePeaks.length - 2] + finitePeaks[finitePeaks.length - 1]) / 2;
          habituationIndex = meanFirst2 > 1e-6 ? roundNum((1 - meanLast2 / meanFirst2) * 100, 2) : null;
        } else if (finitePeaks.length >= 2) {
          meanFirst2 = finitePeaks[0];
          meanLast2 = finitePeaks[finitePeaks.length - 1];
          habituationIndex = meanFirst2 > 1e-6 ? roundNum((1 - meanLast2 / meanFirst2) * 100, 2) : null;
        }
        habituationByWell[w] = {
          trialCount: habitMarkers.length,
          trialLabels,
          trialPeaks,
          meanFirst2: meanFirst2 !== null ? roundNum(meanFirst2, 3) : null,
          meanLast2: meanLast2 !== null ? roundNum(meanLast2, 3) : null,
          habituationIndex
        };
      }
    }

    const habituationByGroup = {};
    if (habitMarkers.length >= 2) {
      for (const gName of activeGroupNames) {
        const inc = wellSummaries.filter(ws => ws.group === gName && !ws.excluded);
        const trialSeries = habitMarkers.map((_, tIdx) => {
          const st = computeStats(inc.map(ws => {
            const hb = habituationByWell[ws.well];
            return hb ? hb.trialPeaks[tIdx] : null;
          }));
          return {
            trialNum: tIdx + 1,
            label: trialLabels[tIdx],
            mean: st.mean !== null ? roundNum(st.mean, 3) : null,
            sem: st.sem !== null ? roundNum(st.sem, 3) : null,
            sd: st.sd !== null ? roundNum(st.sd, 3) : null,
            n: st.n
          };
        });
        habituationByGroup[gName] = {
          trialCount: habitMarkers.length,
          trialLabels,
          trialSeries,
          habituationIndex: computeStats(inc.map(ws => {
            const hb = habituationByWell[ws.well];
            return hb ? hb.habituationIndex : null;
          }))
        };
      }
    }

    const defaultKey = (hasPpi && byType.PULSE_ALONE) ? "PULSE_ALONE" : "ALL";
    const periStimulus = {
      metric: metricId,
      unit: metricId === "dist" ? "mm" : "px",
      preBins,
      postBins,
      offsetsSec,
      defaultType: defaultKey,
      availableTypes: Object.keys(byType),
      byType,
      series: byType[defaultKey].series,
      yMin: byType[defaultKey].yMin,
      yMax: byType[defaultKey].yMax,
      trialCount: habitMarkers.length,
      trialLabels,
      hasHabituation: habitMarkers.length >= 2,
      habituationByGroup
    };

    return { periStimulus, habituationByWell, habituationByGroup };
  }

  // ---------------------------------------------------------------------------
  // 5c. Pure-JS Quick Screening Statistics (Lanczos, Lentz Beta/Gamma)
  // ---------------------------------------------------------------------------
  const STATS_DISCLAIMER = "Quick screening statistics (Welch t / Mann-Whitney U / One-way ANOVA + Holm-Bonferroni / Kruskal-Wallis). Verify assumptions and final publication statistics in GraphPad Prism, R, or Python (scipy/statsmodels).";

  const LANCZOS_COEFFS = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];

  function logGamma(z) {
    if (!Number.isFinite(z)) return NaN;
    if (z < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    }
    const zz = z - 1;
    let x = LANCZOS_COEFFS[0];
    for (let i = 1; i < LANCZOS_COEFFS.length; i++) {
      x += LANCZOS_COEFFS[i] / (zz + i);
    }
    const t = zz + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function betaCf(x, a, b) {
    const MAX_ITER = 200;
    const EPS = 1e-12;
    const FPMIN = 1e-300;
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAX_ITER; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      h *= d * c;

      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  function betaInc(x, a, b) {
    if (!Number.isFinite(x) || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return NaN;
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) {
      return Math.min(1, Math.max(0, (bt * betaCf(x, a, b)) / a));
    }
    return Math.min(1, Math.max(0, 1 - (bt * betaCf(1 - x, b, a)) / b));
  }

  function gammaPSeries(a, x) {
    const MAX_ITER = 200;
    const EPS = 1e-12;
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= MAX_ITER; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    return Math.min(1, Math.max(0, sum * Math.exp(-x + a * Math.log(x) - logGamma(a))));
  }

  function gammaQCf(a, x) {
    const MAX_ITER = 200;
    const EPS = 1e-12;
    const FPMIN = 1e-300;
    let b = x + 1 - a;
    let c = 1 / FPMIN;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i <= MAX_ITER; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return Math.min(1, Math.max(0, Math.exp(-x + a * Math.log(x) - logGamma(a)) * h));
  }

  function gammaP(a, x) {
    if (!Number.isFinite(a) || !Number.isFinite(x) || a <= 0 || x < 0) return NaN;
    if (x === 0) return 0;
    if (x < a + 1) return gammaPSeries(a, x);
    return 1 - gammaQCf(a, x);
  }

  function gammaQ(a, x) {
    if (!Number.isFinite(a) || !Number.isFinite(x) || a <= 0 || x < 0) return NaN;
    if (x === 0) return 1;
    if (x < a + 1) return 1 - gammaPSeries(a, x);
    return gammaQCf(a, x);
  }

  function normalTwoTailedP(z) {
    if (!Number.isFinite(z)) return 0;
    const az = Math.abs(z);
    if (az === 0) return 1;
    return gammaQ(0.5, 0.5 * az * az);
  }

  function tTwoTailedP(t, df) {
    if (!Number.isFinite(df) || df <= 0) return NaN;
    if (!Number.isFinite(t)) return 0;
    if (t === 0) return 1;
    const x = df / (df + t * t);
    return betaInc(x, df / 2, 0.5);
  }

  function fUpperTailP(F, df1, df2) {
    if (!Number.isFinite(df1) || !Number.isFinite(df2) || df1 <= 0 || df2 <= 0) return NaN;
    if (!Number.isFinite(F)) return 0;
    if (F <= 0) return 1;
    const x = df2 / (df2 + df1 * F);
    return betaInc(x, df2 / 2, df1 / 2);
  }

  function chi2UpperTailP(x, df) {
    if (!Number.isFinite(df) || df <= 0) return NaN;
    if (!Number.isFinite(x)) return 0;
    if (x <= 0) return 1;
    return gammaQ(df / 2, x / 2);
  }

  function pToStars(p) {
    if (p === null || !Number.isFinite(p)) return "ns";
    if (p < 0.001) return "***";
    if (p < 0.01) return "**";
    if (p < 0.05) return "*";
    return "ns";
  }

  function cleanFiniteNumbers(arr) {
    const out = [];
    if (!Array.isArray(arr)) return out;
    for (let i = 0; i < arr.length; i++) {
      const v = Number(arr[i]);
      if (Number.isFinite(v)) out.push(v);
    }
    return out;
  }

  function computeMidranks(values) {
    const indexed = values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const ranks = new Array(values.length);
    const tieSizes = [];
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
      const count = j - i + 1;
      const avgRank = (i + j + 2) / 2; // 1-based midrank
      for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
      if (count > 1) tieSizes.push(count);
      i = j + 1;
    }
    return { ranks, tieSizes };
  }

  function formatStatNum(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "—";
    const d = digits == null ? 3 : digits;
    return Number(v).toFixed(d).replace(/\.?0+$/, (m) => (m.startsWith(".") ? "" : m));
  }

  function formatPVal(p) {
    if (p === null || p === undefined || !Number.isFinite(p)) return "—";
    if (p < 0.0001) return "< 0.0001";
    if (p < 0.001) return p.toFixed(5);
    if (p < 0.01) return p.toFixed(4);
    return p.toFixed(3);
  }

  function exactBinomialBigInt(n, k) {
    const kk = Math.min(k, n - k);
    let res = 1n;
    for (let i = 1; i <= kk; i++) {
      res = (res * BigInt(n - kk + i)) / BigInt(i);
    }
    return res;
  }

  // Exact two-sided Mann-Whitney U p-value via BigInt partition DP (no ties; nA, nB <= 25).
  // Recurrence: c(a, b, u) = c(a - 1, b, u - b) + c(a, b - 1, u), sum_u c(a, b, u) = C(a + b, a).
  function mannWhitneyUExactP(nA, nB, uMinRaw) {
    const uMin = Math.floor(Math.max(0, uMinRaw) + 1e-9);
    const maxU = nA * nB;
    if (uMin * 2 >= maxU) return 1.0;

    // 2D rolling array over a = 0..nA: prev[b][u], cur[b][u] for u = 0..uMin
    let prev = Array.from({ length: nB + 1 }, () => {
      const arr = new Array(uMin + 1).fill(0n);
      arr[0] = 1n;
      return arr;
    });

    for (let a = 1; a <= nA; a++) {
      const cur = Array.from({ length: nB + 1 }, () => new Array(uMin + 1).fill(0n));
      cur[0][0] = 1n;
      for (let b = 1; b <= nB; b++) {
        const lim = Math.min(uMin, a * b);
        const curB = cur[b];
        const curBm1 = cur[b - 1];
        const prevB = prev[b];
        for (let u = 0; u <= lim; u++) {
          curB[u] = curBm1[u] + (u >= b ? prevB[u - b] : 0n);
        }
      }
      prev = cur;
    }

    let cum = 0n;
    const row = prev[nB];
    for (let u = 0; u <= uMin; u++) cum += row[u];
    const total = exactBinomialBigInt(nA + nB, nA);
    if (total <= 0n) return 1.0;
    return Math.min(1.0, (2.0 * Number(cum)) / Number(total));
  }

  // Exact two-sided Wilcoxon signed-rank p-value via BigInt 0/1 subset-sum DP over {1..nNz}.
  function wilcoxonExactP(nNz, wMinRaw) {
    if (nNz <= 0) return 1.0;
    const wMax = Math.floor(Math.max(0, wMinRaw) + 1e-9);
    const totalSum = (nNz * (nNz + 1)) / 2;
    if (wMax * 2 >= totalSum) return 1.0;

    const dp = new Array(wMax + 1).fill(0n);
    dp[0] = 1n;
    for (let k = 1; k <= nNz; k++) {
      const upper = Math.min(wMax, (k * (k + 1)) / 2);
      for (let s = upper; s >= k; s--) {
        dp[s] += dp[s - k];
      }
    }
    let cum = 0n;
    for (let s = 0; s <= wMax; s++) cum += dp[s];
    const total = 1n << BigInt(nNz);
    return Math.min(1.0, (2.0 * Number(cum)) / Number(total));
  }

  function welchTTest(aRaw, bRaw) {
    const a = cleanFiniteNumbers(aRaw);
    const b = cleanFiniteNumbers(bRaw);
    const nA = a.length;
    const nB = b.length;
    if (nA < 2 || nB < 2) {
      return {
        test: "Welch's t-test", t: null, df: null, p: null, sig: "ns",
        cohensD: null, meanA: null, meanB: null, meanDiff: null, nA, nB,
        note: "Requires n >= 2 per group"
      };
    }
    const sA = computeStats(a);
    const sB = computeStats(b);
    let sqA = 0;
    for (let i = 0; i < nA; i++) { const d = a[i] - sA.mean; sqA += d * d; }
    let sqB = 0;
    for (let i = 0; i < nB; i++) { const d = b[i] - sB.mean; sqB += d * d; }
    const vA = sqA / (nA - 1);
    const vB = sqB / (nB - 1);
    const seA = vA / nA;
    const seB = vB / nB;
    const se2 = seA + seB;
    const rawDiff = sA.mean - sB.mean;
    const diff = Math.abs(rawDiff - Math.round(rawDiff)) <= 1e-13 ? Math.round(rawDiff) : rawDiff;

    let t = null;
    let df = null;
    let p = null;
    let note = null;
    if (se2 <= 1e-18) {
      df = nA + nB - 2;
      if (Math.abs(rawDiff) <= 1e-12) {
        t = 0;
        p = 1;
        note = "All values identical";
      } else {
        t = null;
        p = null;
        note = "Zero variance in both groups";
      }
    } else {
      t = rawDiff / Math.sqrt(se2);
      const denom = (seA * seA) / (nA - 1) + (seB * seB) / (nB - 1);
      const rawDf = denom > 0 ? (se2 * se2) / denom : (nA + nB - 2);
      df = Math.abs(rawDf - Math.round(rawDf)) <= 1e-13 ? Math.round(rawDf) : rawDf;
      p = tTwoTailedP(t, rawDf);
      if (!Number.isFinite(t)) t = null;
      if (!Number.isFinite(df)) df = null;
      if (!Number.isFinite(p)) p = null;
    }

    const pooledVar = ((nA - 1) * vA + (nB - 1) * vB) / (nA + nB - 2);
    const cohensD = pooledVar > 1e-18
      ? rawDiff / Math.sqrt(pooledVar)
      : (Math.abs(rawDiff) <= 1e-12 ? 0 : null);

    return {
      test: "Welch's t-test",
      t,
      df,
      p,
      sig: pToStars(p),
      cohensD: Number.isFinite(cohensD) ? cohensD : null,
      meanA: sA.mean,
      meanB: sB.mean,
      meanDiff: diff,
      nA,
      nB,
      ...(note ? { note } : {})
    };
  }

  function mannWhitneyU(aRaw, bRaw) {
    const a = cleanFiniteNumbers(aRaw);
    const b = cleanFiniteNumbers(bRaw);
    const nA = a.length;
    const nB = b.length;
    if (nA < 1 || nB < 1 || (nA + nB) < 2) {
      return {
        test: "Mann-Whitney U", U: null, U1: null, U2: null, z: null, p: null,
        method: "none", hasTies: false, sig: "ns", rEffect: null, nA, nB,
        note: "Insufficient sample size"
      };
    }
    const combined = a.concat(b);
    const N = combined.length;
    const { ranks, tieSizes } = computeMidranks(combined);
    const hasTies = tieSizes.length > 0;
    let rA = 0;
    for (let i = 0; i < nA; i++) rA += ranks[i];
    const U1 = rA - (nA * (nA + 1)) / 2;
    const U2 = nA * nB - U1;
    const U = Math.min(U1, U2);

    let tieSum = 0;
    for (const t of tieSizes) tieSum += t * t * t - t;
    const meanU = (nA * nB) / 2;
    const varU = N > 1 ? ((nA * nB) / 12) * ((N + 1) - tieSum / (N * (N - 1))) : 0;

    let z = 0;
    if (varU > 1e-18) {
      const diff = U1 - meanU;
      const absCorr = Math.max(0, Math.abs(diff) - 0.5);
      z = (diff >= 0 ? 1 : -1) * (absCorr / Math.sqrt(varU));
    }

    let method = "asymptotic";
    let p = 1;
    if (!hasTies && nA <= 25 && nB <= 25) {
      method = "exact";
      p = mannWhitneyUExactP(nA, nB, U);
    } else if (varU > 1e-18) {
      method = "asymptotic";
      p = normalTwoTailedP(z);
    } else {
      method = "asymptotic";
      p = 1;
    }

    const rEffect = (nA * nB) > 0 ? ((2 * U1) / (nA * nB) - 1) : 0; // Rank-biserial correlation in [-1, 1]

    return {
      test: "Mann-Whitney U",
      U,
      U1,
      U2,
      z: Number.isFinite(z) ? z : 0,
      p: Number.isFinite(p) ? p : null,
      method,
      hasTies,
      sig: pToStars(p),
      rEffect: Number.isFinite(rEffect) ? rEffect : null,
      nA,
      nB
    };
  }

  function normalizeGroupsListInput(groupsList) {
    if (!Array.isArray(groupsList)) return [];
    const out = [];
    for (let i = 0; i < groupsList.length; i++) {
      const item = groupsList[i];
      if (Array.isArray(item)) {
        const vals = cleanFiniteNumbers(item);
        if (vals.length >= 2) out.push({ group: `Group ${i + 1}`, values: vals });
      } else if (item && typeof item === "object" && Array.isArray(item.values)) {
        const vals = cleanFiniteNumbers(item.values);
        if (vals.length >= 2) out.push({ group: String(item.group || `Group ${i + 1}`), values: vals });
      }
    }
    return out;
  }

  function applyHolmBonferroni(pairs) {
    const indexed = pairs.map((item, idx) => ({ item, idx, validP: Number.isFinite(item.p), rawP: Number.isFinite(item.p) ? item.p : 1 }));
    indexed.sort((a, b) => a.rawP - b.rawP);
    const m = indexed.length;
    let runningMax = 0;
    const adjusted = new Array(m);
    for (let i = 0; i < m; i++) {
      if (!indexed[i].validP) {
        adjusted[indexed[i].idx] = null;
      } else {
        const pStep = Math.min(1, indexed[i].rawP * (m - i));
        runningMax = Math.max(runningMax, pStep);
        adjusted[indexed[i].idx] = runningMax;
      }
    }
    return pairs.map((item, idx) => {
      const pAdj = adjusted[idx];
      return { ...item, pAdj, sig: pToStars(pAdj) };
    });
  }

  function oneWayAnova(groupsList) {
    const groups = normalizeGroupsListInput(groupsList);
    const k = groups.length;
    const N = groups.reduce((acc, g) => acc + g.values.length, 0);
    if (k < 2 || N <= k) {
      return { test: "One-way ANOVA", F: null, df1: null, df2: null, p: null, sig: "ns", etaSq: null, k, N, pairwise: [] };
    }

    let grandSum = 0;
    for (const g of groups) {
      for (const v of g.values) grandSum += v;
    }
    const grandMean = grandSum / N;

    let ssb = 0;
    let ssw = 0;
    for (const g of groups) {
      const gMean = g.values.reduce((a, b) => a + b, 0) / g.values.length;
      ssb += g.values.length * (gMean - grandMean) * (gMean - grandMean);
      for (const v of g.values) {
        const d = v - gMean;
        ssw += d * d;
      }
    }

    const df1 = k - 1;
    const df2 = N - k;
    const msb = ssb / df1;
    const msw = ssw / df2;
    let F = null;
    let p = null;
    let note = null;
    if (msw > 1e-18) {
      F = msb / msw;
      p = fUpperTailP(F, df1, df2);
      if (!Number.isFinite(F)) F = null;
      if (!Number.isFinite(p)) p = null;
    } else if (ssb <= 1e-18) {
      F = 0;
      p = 1;
      note = "All values identical";
    } else {
      F = null;
      p = null;
      note = "Zero within-group variance";
    }
    const etaSq = (ssb + ssw) > 1e-18 ? ssb / (ssb + ssw) : 0;

    // Pairwise Welch t-tests + Holm-Bonferroni correction
    const rawPairs = [];
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const wt = welchTTest(groups[i].values, groups[j].values);
        rawPairs.push({
          groupA: groups[i].group,
          groupB: groups[j].group,
          test: "Welch's t (Holm)",
          t: wt.t,
          df: wt.df,
          p: wt.p,
          cohensD: wt.cohensD,
          meanDiff: wt.meanDiff,
          nA: wt.nA,
          nB: wt.nB
        });
      }
    }
    const pairwise = applyHolmBonferroni(rawPairs);

    return {
      test: "One-way ANOVA",
      F,
      df1,
      df2,
      p,
      sig: pToStars(p),
      etaSq: Number.isFinite(etaSq) ? etaSq : null,
      k,
      N,
      pairwise,
      ...(note ? { note } : {})
    };
  }

  function kruskalWallis(groupsList) {
    const groups = normalizeGroupsListInput(groupsList);
    const k = groups.length;
    const N = groups.reduce((acc, g) => acc + g.values.length, 0);
    if (k < 2 || N <= k) {
      return { test: "Kruskal-Wallis", H: null, df: null, p: null, sig: "ns", epsSq: null, k, N, pairwise: [] };
    }

    const allVals = [];
    const groupIdxOf = [];
    for (let gi = 0; gi < k; gi++) {
      for (const v of groups[gi].values) {
        allVals.push(v);
        groupIdxOf.push(gi);
      }
    }

    const { ranks, tieSizes } = computeMidranks(allVals);
    const rankSums = new Array(k).fill(0);
    for (let i = 0; i < N; i++) rankSums[groupIdxOf[i]] += ranks[i];

    let sumR2OverN = 0;
    for (let gi = 0; gi < k; gi++) {
      sumR2OverN += (rankSums[gi] * rankSums[gi]) / groups[gi].values.length;
    }
    const hRaw = (12 / (N * (N + 1))) * sumR2OverN - 3 * (N + 1);
    let tieSum = 0;
    for (const t of tieSizes) tieSum += t * t * t - t;
    const tieCorr = 1 - tieSum / (N * N * N - N);
    const H = tieCorr > 1e-12 ? Math.max(0, hRaw / tieCorr) : 0;
    const df = k - 1;
    const p = tieCorr > 1e-12 ? chi2UpperTailP(H, df) : 1;
    const epsSq = N > k ? Math.max(0, (H - k + 1) / (N - k)) : 0;

    // Pairwise Mann-Whitney U + Holm-Bonferroni correction
    const rawPairs = [];
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const mw = mannWhitneyU(groups[i].values, groups[j].values);
        rawPairs.push({
          groupA: groups[i].group,
          groupB: groups[j].group,
          test: `Mann-Whitney U (Holm, ${mw.method})`,
          method: mw.method,
          hasTies: mw.hasTies,
          U: mw.U,
          z: mw.z,
          p: mw.p,
          rEffect: mw.rEffect,
          nA: mw.nA,
          nB: mw.nB
        });
      }
    }
    const pairwise = applyHolmBonferroni(rawPairs);

    return {
      test: "Kruskal-Wallis",
      H: Number.isFinite(H) ? H : null,
      df,
      p: Number.isFinite(p) ? p : null,
      sig: pToStars(p),
      epsSq: Number.isFinite(epsSq) ? epsSq : null,
      hasTies: tieSizes.length > 0,
      k,
      N,
      pairwise
    };
  }

  function pairedCompare(aRaw, bRaw) {
    const len = Math.min(Array.isArray(aRaw) ? aRaw.length : 0, Array.isArray(bRaw) ? bRaw.length : 0);
    const diffs = [];
    for (let i = 0; i < len; i++) {
      const va = Number(aRaw[i]);
      const vb = Number(bRaw[i]);
      if (Number.isFinite(va) && Number.isFinite(vb)) diffs.push(va - vb);
    }
    const n = diffs.length;
    if (n < 2) {
      return {
        pairedT: { t: null, df: null, p: null, sig: "ns", meanDiff: null },
        wilcoxon: { W: null, Wplus: null, Wminus: null, z: null, p: null, method: "none", hasTies: false, sig: "ns", nNonZero: 0 },
        n
      };
    }

    // 1. Paired Student's t-test (full float precision, guarded against var = 0)
    const stD = computeStats(diffs);
    const se = stD.sd / Math.sqrt(n);
    let t = null;
    let pT = null;
    let noteT = null;
    if (se <= 1e-18) {
      if (Math.abs(stD.mean) <= 1e-12) { t = 0; pT = 1; noteT = "All paired differences are zero"; }
      else { t = null; pT = null; noteT = "Zero variance in paired differences"; }
    } else {
      t = stD.mean / se;
      pT = tTwoTailedP(t, n - 1);
      if (!Number.isFinite(t)) t = null;
      if (!Number.isFinite(pT)) pT = null;
    }

    // 2. Wilcoxon signed-rank test (exact DP when no ties in |d| & 1 <= nNz <= 50; else approx with tie + continuity corr)
    const nz = diffs.filter(d => Math.abs(d) > 1e-12);
    const nNz = nz.length;
    let W = null;
    let Wplus = 0;
    let Wminus = 0;
    let zW = null;
    let pW = 1;
    let methodW = "none";
    let hasTiesW = false;

    if (nNz >= 1) {
      const absVals = nz.map(Math.abs);
      const { ranks, tieSizes } = computeMidranks(absVals);
      hasTiesW = tieSizes.length > 0;
      let wp = 0;
      let wm = 0;
      for (let i = 0; i < nNz; i++) {
        if (nz[i] > 0) wp += ranks[i];
        else wm += ranks[i];
      }
      Wplus = wp;
      Wminus = wm;
      W = Math.min(wp, wm);

      const meanW = (nNz * (nNz + 1)) / 4;
      let tieSum = 0;
      for (const tk of tieSizes) tieSum += tk * tk * tk - tk;
      const varW = (nNz * (nNz + 1) * (2 * nNz + 1)) / 24 - tieSum / 48;
      if (varW > 1e-18) {
        const diffW = wp - meanW;
        const absCorr = Math.max(0, Math.abs(diffW) - 0.5);
        zW = (diffW >= 0 ? 1 : -1) * (absCorr / Math.sqrt(varW));
      } else {
        zW = 0;
      }

      if (!hasTiesW && nNz <= 50) {
        methodW = "exact";
        pW = wilcoxonExactP(nNz, W);
      } else if (varW > 1e-18) {
        methodW = "approx";
        pW = normalTwoTailedP(zW);
      } else {
        methodW = "approx";
        pW = 1;
      }
    }

    return {
      pairedT: {
        t,
        df: n - 1,
        p: pT,
        sig: pToStars(pT),
        meanDiff: stD.mean,
        ...(noteT ? { note: noteT } : {})
      },
      wilcoxon: {
        W,
        Wplus,
        Wminus,
        z: Number.isFinite(zW) ? zW : null,
        p: Number.isFinite(pW) ? pW : null,
        method: methodW,
        hasTies: hasTiesW,
        sig: pToStars(pW),
        nNonZero: nNz
      },
      n
    };
  }

  function screenComparisonGroups(groupsData, opts) {
    const hasExplicitOpts = Boolean(opts && typeof opts === "object");
    const cfg = hasExplicitOpts ? opts : {};
    const primaryTestFamily = cfg.primaryTestFamily === "nonparametric" ? "nonparametric" : "parametric";
    const nUnit = cfg.nUnit === "plates" ? "plates" : "wells";
    const runCount = Math.max(1, parseInt(cfg.runCount, 10) || 1);
    const factorNames = Array.isArray(cfg.factorNames)
      ? cfg.factorNames.map(s => String(s || "").trim()).filter(Boolean)
      : [];

    const multiFactorNotice = factorNames.length >= 2
      ? `Multi-factor design detected (${factorNames.join(" × ")}): one-way screening does not test main effects or interactions — run Two-Way ANOVA / Mixed Model in GraphPad Prism, R, or Python.`
      : null;
    const pseudoreplicationNotice = (runCount > 1 && nUnit === "wells")
      ? `Pooled well-level view (n = wells across ${runCount} plates). For plate-level biological replicates, switch Unit of Analysis to Plate Means (n = plates) or use a mixed-effects model.`
      : null;

    const groups = normalizeGroupsListInput(groupsData);
    if (groups.length < 2) {
      return {
        valid: false,
        kind: "insufficient",
        primaryTestFamily,
        nUnit,
        runCount,
        factorNames,
        groupCount: groups.length,
        groups: groups.map(g => ({ group: g.group, n: g.values.length })),
        reason: `Need at least 2 groups with n >= 2 included ${nUnit} to run screening stats.`,
        primary: null,
        crossCheck: null,
        nonParametric: null,
        omnibus: null,
        pairwise: [],
        brackets: [],
        primaryRows: [],
        summaryRows: [],
        crossCheckRows: [],
        multiFactorNotice,
        pseudoreplicationNotice,
        lowReplicateNotice: null,
        disclaimer: STATS_DISCLAIMER
      };
    }

    const lowReplicateNotice = (nUnit === "plates" && groups.some(g => g.values.length < 3))
      ? "Plate-level view has n < 3 replicate plates per group — statistical power is very low; interpret screening p-values with caution or fit a mixed-effects model."
      : null;

    if (groups.length === 2) {
      const wt = welchTTest(groups[0].values, groups[1].values);
      const mw = mannWhitneyU(groups[0].values, groups[1].values);

      const wtRow = {
        family: "parametric",
        test: wt.test,
        method: "welch",
        stat: wt.t !== null ? `t(${formatStatNum(wt.df, 2)}) = ${formatStatNum(wt.t, 3)}` : (wt.note || "—"),
        p: wt.p,
        sig: wt.sig,
        effect: wt.cohensD !== null ? `d = ${formatStatNum(wt.cohensD, 3)}` : "—"
      };
      const mwRow = {
        family: "nonparametric",
        test: `${mw.test} (${mw.method})`,
        method: mw.method,
        stat: `U = ${formatStatNum(mw.U, 2)}${mw.method === "asymptotic" ? `, z = ${formatStatNum(mw.z, 3)}` : ""}`,
        p: mw.p,
        sig: mw.sig,
        effect: mw.rEffect !== null ? `r = ${formatStatNum(mw.rEffect, 3)}` : "—"
      };

      const pairParam = {
        groupA: groups[0].group,
        groupB: groups[1].group,
        test: wt.test,
        method: "welch",
        t: wt.t,
        df: wt.df,
        p: wt.p,
        pAdj: wt.p,
        sig: wt.sig,
        cohensD: wt.cohensD,
        meanDiff: wt.meanDiff,
        mannWhitneyP: mw.p,
        mannWhitneySig: mw.sig,
        mannWhitneyMethod: mw.method
      };
      const pairNonParam = {
        groupA: groups[0].group,
        groupB: groups[1].group,
        test: `${mw.test} (${mw.method})`,
        method: mw.method,
        hasTies: mw.hasTies,
        U: mw.U,
        z: mw.z,
        p: mw.p,
        pAdj: mw.p,
        sig: mw.sig,
        rEffect: mw.rEffect,
        welchP: wt.p,
        welchSig: wt.sig
      };

      const isNonParam = primaryTestFamily === "nonparametric";
      const primary = isNonParam ? mw : wt;
      const crossCheck = isNonParam ? wt : mw;
      const activePair = isNonParam ? pairNonParam : pairParam;
      const primaryRows = [isNonParam ? mwRow : wtRow];
      const crossCheckRows = [isNonParam ? wtRow : mwRow];

      return {
        valid: true,
        kind: "two_group",
        primaryTestFamily,
        nUnit,
        runCount,
        factorNames,
        groupCount: 2,
        groups: groups.map(g => ({ group: g.group, n: g.values.length })),
        primary,
        crossCheck,
        nonParametric: mw,
        omnibus: { parametric: wt, nonParametric: mw },
        pairwise: [activePair],
        brackets: [activePair],
        primaryRows,
        summaryRows: hasExplicitOpts ? primaryRows : primaryRows.concat(crossCheckRows),
        crossCheckRows,
        multiFactorNotice,
        pseudoreplicationNotice,
        lowReplicateNotice,
        disclaimer: STATS_DISCLAIMER
      };
    }

    const anova = oneWayAnova(groups);
    const kw = kruskalWallis(groups);
    const anovaRow = {
      family: "parametric",
      test: anova.test,
      method: "anova_holm",
      stat: anova.F !== null ? `F(${anova.df1}, ${anova.df2}) = ${formatStatNum(anova.F, 3)}` : (anova.note || "—"),
      p: anova.p,
      sig: anova.sig,
      effect: anova.etaSq !== null ? `η² = ${formatStatNum(anova.etaSq, 3)}` : "—"
    };
    const kwRow = {
      family: "nonparametric",
      test: kw.test,
      method: "kruskal_holm_mwu",
      stat: kw.H !== null ? `H(${kw.df}) = ${formatStatNum(kw.H, 3)}` : "—",
      p: kw.p,
      sig: kw.sig,
      effect: kw.epsSq !== null ? `ε² = ${formatStatNum(kw.epsSq, 3)}` : "—"
    };

    const isNonParam = primaryTestFamily === "nonparametric";
    const primary = isNonParam ? kw : anova;
    const crossCheck = isNonParam ? anova : kw;
    const activePairwise = isNonParam ? kw.pairwise : anova.pairwise;
    const brackets = activePairwise.slice().sort((a, b) => (a.pAdj ?? 1) - (b.pAdj ?? 1));
    const primaryRows = [isNonParam ? kwRow : anovaRow];
    const crossCheckRows = [isNonParam ? anovaRow : kwRow];

    return {
      valid: true,
      kind: "multi_group",
      primaryTestFamily,
      nUnit,
      runCount,
      factorNames,
      groupCount: groups.length,
      groups: groups.map(g => ({ group: g.group, n: g.values.length })),
      primary,
      crossCheck,
      nonParametric: kw,
      omnibus: { parametric: anova, nonParametric: kw },
      pairwise: activePairwise,
      brackets,
      primaryRows,
      summaryRows: hasExplicitOpts ? primaryRows : primaryRows.concat(crossCheckRows),
      crossCheckRows,
      multiFactorNotice,
      pseudoreplicationNotice,
      lowReplicateNotice,
      disclaimer: STATS_DISCLAIMER
    };
  }

  const stats = {
    STATS_DISCLAIMER,
    formatStatNum,
    formatPVal,
    logGamma,
    betaInc,
    gammaP,
    gammaQ,
    normalTwoTailedP,
    tTwoTailedP,
    fUpperTailP,
    chi2UpperTailP,
    pToStars,
    mannWhitneyUExactP,
    wilcoxonExactP,
    welchTTest,
    mannWhitneyU,
    oneWayAnova,
    kruskalWallis,
    pairedCompare,
    screenComparisonGroups
  };

  function computeAnalysis(stateObj) {
    const opts = stateObj || {};
    const parsed = opts.parsed || null;
    const zchange = opts.zchange || null;
    const xyParsed = opts.xyParsed || opts.xy || null;
    const context = opts.context || null;
    const rawGroups = (opts.groups && typeof opts.groups === "object") ? opts.groups : {};
    const excludedSet = normalizeExcludedSet(opts.excludedWells);
    const excludeMeta = (opts.excludeMeta && typeof opts.excludeMeta === "object") ? opts.excludeMeta : {};
    const binGroupSize = Math.max(1, Math.round(parseFloat(opts.binGroupSize) || 1));
    const layout = getPlateLayout(parsed || zchange || xyParsed, context);
    const qcThresholds = normalizeQcThresholds(opts.qcThresholds, context);
    const trimWindow = opts.trimWindow || ((opts.trimStartSec !== undefined || opts.trimEndSec !== undefined)
      ? { trimStartSec: opts.trimStartSec, trimEndSec: opts.trimEndSec }
      : null);
    const factorNames = Array.isArray(opts.factorNames)
      ? opts.factorNames.map(s => String(s || "").trim()).filter(Boolean)
      : [];
    const wellFactors = opts.wellFactors || opts.factors || null;
    const metaFallback = inferRunMeta(opts.filename || (parsed && parsed.filename) || (zchange && zchange.filename), parsed);
    const runId = opts.runId || metaFallback.runId;
    const date = opts.date || metaFallback.date;
    const rawWinStart = opts.windowAuc && opts.windowAuc.startSec !== "" && opts.windowAuc.startSec != null ? Number(opts.windowAuc.startSec) : null;
    const rawWinEnd = opts.windowAuc && opts.windowAuc.endSec !== "" && opts.windowAuc.endSec != null ? Number(opts.windowAuc.endSec) : null;
    const hasWinBoth = rawWinStart !== null && rawWinEnd !== null && Number.isFinite(rawWinStart) && Number.isFinite(rawWinEnd);
    const windowAucWarning = (hasWinBoth && rawWinStart >= rawWinEnd)
      ? `Window AUC start (${rawWinStart}s) must be less than end (${rawWinEnd}s).`
      : "";
    const windowAucCfg = (hasWinBoth && rawWinEnd > rawWinStart)
      ? { startSec: rawWinStart, endSec: rawWinEnd }
      : null;

    if (!parsed || parsed.kind !== "summary" || !Array.isArray(parsed.rows) || parsed.rows.length === 0) {
      // Still compute full _ZCHANGE and/or _XY metrics if standalone files are loaded!
      const zcOnly = (zchange && zchange.kind === "zchange")
        ? computeZchangePerArena(zchange, zchange.wells, zchange.maxZone)
        : null;
      const xyOnly = xyParsed ? analyzeXyData(xyParsed, layout, {
        freezeSpeedMmS: opts.xyFreezeSpeedMmS,
        wellGridSize: opts.xyGridW,
        plateGridW: opts.xyPlateGridW,
        plateGridH: opts.xyPlateGridH,
        groups: rawGroups,
        excludedWells: excludedSet,
        trimWindow
      }) : null;
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
          const exclInfoOnly = (excluded && excludeMeta[w]) ? excludeMeta[w] : null;
          const ws = {
            well: w, wellKey: `${runId}:${w}`, runId, date, group,
            factors: extractWellFactors(w, factorNames, wellFactors),
            excluded,
            excludeSource: excluded ? ((exclInfoOnly && exclInfoOnly.source) || "manual") : "",
            excludeReason: excluded ? ((exclInfoOnly && exclInfoOnly.reason) || "manual_exclusion") : "",
            afterStatsViewed: Boolean(exclInfoOnly && exclInfoOnly.afterStatsViewed),
            afterStatsAt: (exclInfoOnly && exclInfoOnly.afterStatsAt) ? String(exclInfoOnly.afterStatsAt) : null,
            qc: { well: w, status: "ok", qcStatus: "ok", qcReason: "ok", isEmpty: false, empty: false, isSpikeGlitch: false, spikeGlitch: false, spikeCount: 0, flags: [], reason: "OK", evidence: "OK", activeBins: 0, activePct: 0, maxBinDist: 0, maxSpeedMmS: 0 },
            totalDist: null, meanDist: null, meanSpeedMmS: null, totalMsd: null, meanMsd: null,
            phaseDist: {}, phaseMsd: {}, vmr: null, zones: null, startle: null, habituation: null,
            windowAuc: null, xy: xyOnly && xyOnly.wellsById[w] ? xyOnly.wellsById[w] : null,
            zchange: zc || null, normalized: null,
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
            byPhase: {}, vmr: null, zones: null, startle: null, habituation: null, windowAuc: null,
            xy: xyOnly && xyOnly.groups[gName] ? xyOnly.groups[gName] : null,
            normalized: null,
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
      const postStatsOnly = wellsOnly.filter(ws => ws.excluded && ws.afterStatsViewed).length;
      const compOnly = [];
      if (hasSabOnly) compOnly.push({ id: "sab", label: "Y-Maze Alternation (SAB %)" });
      if (xyOnly) compOnly.push({ id: "xy_spatial", label: "Spatial Phenotyping (_XY)" });
      const trimCheckOnly = filterRowsByTrimWindow([], trimWindow);
      return {
        runId, date, factorNames, qcThresholds,
        trimInfo: {
          active: false,
          invalid: Boolean(trimCheckOnly.invalid),
          warning: trimCheckOnly.warning || "",
          trimStartSec: trimCheckOnly.trimStartSec,
          trimEndSec: trimCheckOnly.trimEndSec,
          originalRows: 0, keptRows: 0, originalDurationSec: 0, keptDurationSec: 0
        },
        windowAucConfig: windowAucCfg,
        windowAucWarning,
        unitOfAnalysis: "wells",
        nUnit: "wells",
        plateSummaryRows: [],
        postStatsExclusions: postStatsOnly,
        activeMetric: "dist",
        availableMetrics: [],
        layout,
        phases: [],
        capabilities: {
          hasDist: false, hasMsd: false, hasZones: false, hasZchange: Boolean(zcSummary),
          hasXy: Boolean(xyOnly), hasPeriStimulus: false, hasHabituation: false, hasWindowAuc: false,
          hasTemp: false, hasPhases: false, hasVmr: false, hasPpi: false, hasStartle: false,
          hasSab: hasSabOnly, maxZone: zcSummary ? zcSummary.maxZone : 0
        },
        kpis: {
          totalWells: layout.wells.length, activeWells: layout.wells.length - excludedCountOnly, excludedWells: excludedCountOnly,
          rowCount: zchange ? zchange.rowCount : (xyParsed ? xyParsed.rowCount : 0),
          durationSec: zchange ? zchange.durationSec : (xyParsed ? xyParsed.durationSec : 0), binDurationSec: 1,
          emptyCount: 0, spikeCount: 0, flaggedCount: 0, flaggedWells: [],
          tempMin: null, tempMax: null, tempMean: null, targetTempC: context ? context.targetTempC : null
        },
        timeSeries: {
          metric: "dist", metricLabel: "Distance (mm/bin)", unit: "mm",
          binGroupSize, rawBinSec: 1, effectiveBinSec: binGroupSize,
          xAxis: [], series: [], yMin: 0, yMax: 1, phaseSpans: [], stimulusMarkers: []
        },
        periStimulus: null,
        xyAnalysis: xyOnly,
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
        comparisonViews: compOnly
      };
    }

    const wells = parsed.wells;
    const binSec = parsed.binDurationSec || 1;
    const trimRes = filterRowsByTrimWindow(parsed.rows, trimWindow);
    const rows = trimRes.rows;
    const trimInfo = {
      active: trimRes.active,
      invalid: Boolean(trimRes.invalid),
      warning: trimRes.warning || "",
      trimStartSec: trimRes.trimStartSec,
      trimEndSec: trimRes.trimEndSec,
      originalRows: parsed.rows.length,
      keptRows: rows.length,
      originalDurationSec: parsed.durationSec,
      keptDurationSec: rows.length > 0
        ? roundNum((rows[rows.length - 1].relTime - rows[0].relTime) + binSec, 3)
        : 0
    };
    const qcOut = recomputeWellQc(parsed, qcThresholds, trimWindow);
    const activeQc = qcOut.qc;
    const activeQcSummary = qcOut.qcSummary;
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

    // 4. Optional _ZCHANGE & _XY metrics (respecting non-destructive trimWindow)
    let zchangeInput = zchange;
    if (zchange && zchange.kind === "zchange" && trimRes.active && rows.length > 0) {
      const tMinRun = rows[0].runtime;
      const tMaxRun = rows[rows.length - 1].runtime + binSec;
      zchangeInput = {
        ...zchange,
        events: zchange.events.filter(ev => ev.time >= tMinRun - 1e-6 && ev.time <= tMaxRun + 1e-6)
      };
    }
    const zchangeCalc = computeZchangePerArena(zchangeInput, wells, parsed.maxZone);
    const hasZchange = Boolean(zchangeCalc);

    const xyAnalysis = xyParsed ? analyzeXyData(xyParsed, layout, {
      freezeSpeedMmS: opts.xyFreezeSpeedMmS,
      wellGridSize: opts.xyGridW,
      plateGridW: opts.xyPlateGridW,
      plateGridH: opts.xyPlateGridH,
      groups: rawGroups,
      excludedWells: excludedSet,
      trimWindow
    }) : null;
    const hasXy = Boolean(xyAnalysis && xyAnalysis.hasXy);

    // 5. Per-well detailed metrics
    const wellSummaries = [];
    const wellsById = {};

    for (const w of wells) {
      const group = wellGroupMap[w];
      const excluded = excludedSet.has(w.toUpperCase());
      const qcInfo = activeQc[w] || {
        well: w, status: "ok", qcStatus: "ok", qcReason: "ok",
        isEmpty: false, empty: false, isSpikeGlitch: false, spikeGlitch: false,
        spikeCount: 0, flags: [], reason: "OK", evidence: "OK",
        activeBins: 0, activePct: 0, maxBinDist: 0, maxSpeedMmS: 0, totalDist: 0, meanDist: 0
      };
      const metaEx = excludeMeta[w] || excludeMeta[w.toUpperCase()] || null;
      const excludeSource = !excluded
        ? ""
        : (metaEx && metaEx.source ? String(metaEx.source) : ((qcInfo.isEmpty || qcInfo.isSpikeGlitch) ? "auto" : "manual"));
      const excludeReason = !excluded
        ? ""
        : (metaEx && metaEx.reason ? String(metaEx.reason) : (qcInfo.qcReason && qcInfo.qcReason !== "ok" ? qcInfo.qcReason : "manual_exclusion"));
      const afterStatsViewed = Boolean(excluded && metaEx && metaEx.afterStatsViewed);
      const afterStatsAt = (excluded && metaEx && metaEx.afterStatsAt) ? String(metaEx.afterStatsAt) : null;

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
      const xyObj = (xyAnalysis && xyAnalysis.wellsById && xyAnalysis.wellsById[w]) ? xyAnalysis.wellsById[w] : null;
      const windowAucObj = windowAucCfg ? computeWindowAucForWell(rows, parsed, w, windowAucCfg, activeMetric, binSec) : null;
      const factorsObj = extractWellFactors(w, factorNames, wellFactors);

      // Heatmap lookup values for Plate Map coloring
      const heatmapValues = {
        dist: totalDist !== null ? roundNum(totalDist, 2) : null,
        meanDist: meanDist !== null ? roundNum(meanDist, 2) : null,
        msd: meanMsd !== null ? roundNum(meanMsd, 2) : null,
        z1_pct: zonesObj ? zonesObj.z1Pct : null,
        z2_pct: zonesObj ? zonesObj.z2Pct : null,
        preferenceIndex: zonesObj ? zonesObj.preferenceIndex : null,
        ppiPct: startleObj ? startleObj.ppiPct : null,
        sabPct: zcObj ? zcObj.sabPct : null,
        windowAuc: windowAucObj ? windowAucObj.auc : null,
        windowMean: windowAucObj ? windowAucObj.mean : null,
        xyImmobilityPct: xyObj ? xyObj.immobilityPct : null,
        xyCenterPct: xyObj ? xyObj.centerOccupancyPct : null
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
        wellKey: `${runId}:${w}`,
        runId,
        date,
        group,
        factors: factorsObj,
        excluded,
        excludeSource,
        excludeReason,
        afterStatsViewed,
        afterStatsAt,
        qc: qcInfo,
        qcStatus: qcInfo.qcStatus || qcInfo.status,
        qcReason: qcInfo.qcReason || "ok",
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
        habituation: null,
        windowAuc: windowAucObj,
        xy: xyObj,
        zchange: zcObj,
        normalized: null,
        heatmapValue,
        heatmapValues
      };

      wellSummaries.push(summary);
      wellsById[w] = summary;
    }

    // 5b. Peri-stimulus aligned traces & trial habituation
    const periCalc = computePeriStimulusAndHabituation(
      rows, parsed, stimulusMarkers, wellSummaries, activeGroupNames, hasPpi, hasDistLike, binSec
    );
    const periStimulus = periCalc.periStimulus;
    const hasPeriStimulus = Boolean(periStimulus);
    const hasHabituation = Boolean(periStimulus && periStimulus.hasHabituation);
    for (const ws of wellSummaries) {
      const hb = periCalc.habituationByWell[ws.well] || null;
      ws.habituation = hb;
      ws.heatmapValues.habituationPct = hb ? hb.habituationIndex : null;
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

      const habituationGroup = (hasHabituation && periCalc.habituationByGroup[gName])
        ? periCalc.habituationByGroup[gName]
        : null;

      const windowAucGroup = windowAucCfg ? {
        startSec: windowAucCfg.startSec,
        endSec: windowAucCfg.endSec,
        auc: computeStats(included.map(ws => ws.windowAuc ? ws.windowAuc.auc : null)),
        mean: computeStats(included.map(ws => ws.windowAuc ? ws.windowAuc.mean : null)),
        sum: computeStats(included.map(ws => ws.windowAuc ? ws.windowAuc.sum : null))
      } : null;

      const xyGroup = (hasXy && xyAnalysis.groups && xyAnalysis.groups[gName])
        ? xyAnalysis.groups[gName]
        : null;

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
        habituation: habituationGroup,
        windowAuc: windowAucGroup,
        xy: xyGroup,
        zchange: zchangeGroup,
        normalized: null
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

    // 9. Temperature analysis against optional context target (respecting trim window)
    const tempPts = [];
    const tempVals = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].tempC !== null) {
        tempVals.push(rows[i].tempC);
        tempPts.push({ index: rows[i].index, runtime: rows[i].runtime, relTime: rows[i].relTime, tempC: rows[i].tempC, phase: rows[i].phase });
      }
    }
    const tempSt = computeStats(tempVals);
    const hasTempActive = tempVals.length > 0;
    const tempMinVal = tempSt.min !== null ? roundNum(tempSt.min, 2) : null;
    const tempMaxVal = tempSt.max !== null ? roundNum(tempSt.max, 2) : null;
    const tempMeanVal = tempSt.mean !== null ? roundNum(tempSt.mean, 2) : null;
    const tempStdVal = tempSt.sd !== null ? roundNum(tempSt.sd, 3) : null;

    const targetTempC = context ? context.targetTempC : null;
    const targetSchedule = (context && Array.isArray(context.tempSchedule)) ? context.tempSchedule : [];
    let maxDeviationC = null;
    if (hasTempActive && (targetTempC !== null || targetSchedule.length > 0)) {
      let maxDev = 0;
      for (const pt of tempPts) {
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
      hasTemp: hasTempActive,
      min: tempMinVal,
      max: tempMaxVal,
      mean: tempMeanVal,
      std: tempStdVal,
      targetTempC,
      targetSchedule,
      maxDeviationC,
      points: tempPts
    };

    // 10. Sorted QC anomalies list (flagged wells first, ordered by severity)
    const anomalies = wellSummaries
      .map(ws => ({
        well: ws.well,
        wellKey: ws.wellKey,
        runId: ws.runId,
        date: ws.date,
        group: ws.group,
        excluded: ws.excluded,
        excludeSource: ws.excludeSource,
        afterStatsViewed: ws.afterStatsViewed,
        afterStatsAt: ws.afterStatsAt,
        status: ws.qc.status,
        qcStatus: ws.qc.qcStatus || ws.qc.status,
        qcReason: ws.qc.qcReason || "ok",
        isEmpty: ws.qc.isEmpty,
        isSpikeGlitch: ws.qc.isSpikeGlitch,
        spikeCount: ws.qc.spikeCount,
        maxBinDist: ws.qc.maxBinDist,
        maxSpeedMmS: ws.qc.maxSpeedMmS,
        totalDist: ws.totalDist,
        activeBins: ws.qc.activeBins,
        activePct: ws.qc.activePct,
        reason: ws.qc.reason,
        evidence: ws.qc.evidence
      }))
      .sort((a, b) => {
        const rank = (x) => x.isSpikeGlitch ? 0 : (x.isEmpty ? 1 : 2);
        const rDiff = rank(a) - rank(b);
        if (rDiff !== 0) return rDiff;
        if (a.isSpikeGlitch && b.isSpikeGlitch) return (b.maxBinDist || 0) - (a.maxBinDist || 0);
        return (a.totalDist || 0) - (b.totalDist || 0);
      });

    // 11. Comparison view catalog for Plots / Comparison tab
    const comparisonViews = [{ id: "phase_totals", label: uniquePhases.length > 1 ? "Phase Mean Distance" : "Total Distance" }];
    if (hasVmr) comparisonViews.push({ id: "vmr", label: "VMR (Light vs Dark & Burst)" });
    if (parsed.hasZones) comparisonViews.push({ id: "zone_pref", label: parsed.maxZone === 2 ? "Zone Preference / Thigmotaxis" : `Zone Occupancy (Z1–Z${parsed.maxZone})` });
    if (hasPpi) comparisonViews.push({ id: "ppi", label: "Prepulse Inhibition (% PPI)" });
    else if (hasStartle) comparisonViews.push({ id: "startle", label: "Startle Response (Baseline vs Stim)" });
    if (hasHabituation) comparisonViews.push({ id: "habituation", label: "Trial Habituation (%)" });
    if (windowAucCfg) comparisonViews.push({ id: "window_auc", label: `Window AUC (${windowAucCfg.startSec}–${windowAucCfg.endSec}s)` });
    if (hasXy) comparisonViews.push({ id: "xy_spatial", label: "Spatial Phenotyping (_XY)" });
    if (hasSab) comparisonViews.push({ id: "sab", label: "Y-Maze Alternation (SAB %)" });

    const excludedCount = wellSummaries.filter(ws => ws.excluded).length;
    const postStatsExclusions = wellSummaries.filter(ws => ws.excluded && ws.afterStatsViewed).length;
    const kpis = {
      totalWells: wells.length,
      activeWells: wells.length - excludedCount,
      excludedWells: excludedCount,
      postStatsExclusions,
      rowCount: rows.length,
      durationSec: trimInfo.active ? trimInfo.keptDurationSec : parsed.durationSec,
      binDurationSec: binSec,
      emptyCount: activeQcSummary.emptyWells.length,
      spikeCount: activeQcSummary.spikeWells.length,
      flaggedCount: activeQcSummary.flaggedWells.length,
      flaggedWells: activeQcSummary.flaggedWells.slice(),
      tempMin: tempMinVal,
      tempMax: tempMaxVal,
      tempMean: tempMeanVal,
      targetTempC
    };

    return {
      runId,
      date,
      factorNames,
      qcThresholds,
      trimInfo,
      windowAucConfig: windowAucCfg,
      windowAucWarning,
      unitOfAnalysis: "wells",
      nUnit: "wells",
      plateSummaryRows: [],
      postStatsExclusions,
      activeMetric,
      availableMetrics,
      layout,
      phases: uniquePhases,
      capabilities: {
        hasDist: hasDistLike,
        hasMsd: parsed.hasMsd,
        hasZones: parsed.hasZones,
        hasZchange,
        hasXy,
        hasPeriStimulus,
        hasHabituation,
        hasWindowAuc: Boolean(windowAucCfg),
        hasTemp: hasTempActive,
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
      periStimulus,
      xyAnalysis,
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
  // 5d. Multi-Run / Multi-Plate Pooling & Per-Run % Control Normalization
  // ---------------------------------------------------------------------------
  function resolveControlGroupName(groupNames, explicitControl) {
    const names = Array.isArray(groupNames) ? groupNames.filter(Boolean) : [];
    if (explicitControl && names.includes(explicitControl)) return explicitControl;
    const exactCtrl = names.find(g => g.toLowerCase() === "control");
    if (exactCtrl) return exactCtrl;
    const vehCtrl = names.find(g => /\b(control|ctrl|vehicle|veh|wt)\b/i.test(g));
    if (vehCtrl) return vehCtrl;
    return names[0] || "Control";
  }

  function applyPerRunControlNormalization(runAnalysis, parsed, trimWindow, controlGroupName, metricId) {
    if (!runAnalysis || !Array.isArray(runAnalysis.wells)) return { controlGroupName, controlMeanPerBin: null, controlTotalDist: null, controlN: 0 };
    const ctrlWells = runAnalysis.wells.filter(ws => ws.group === controlGroupName && !ws.excluded);
    const meanOf = (fn) => {
      const st = computeStats(ctrlWells.map(fn));
      return (st.mean !== null && Math.abs(st.mean) > 1e-6) ? st.mean : null;
    };

    const ctrlTotalDist = meanOf(ws => ws.totalDist);
    const ctrlMeanDist = meanOf(ws => ws.meanDist);
    const ctrlMeanMsd = meanOf(ws => ws.meanMsd);
    const ctrlVmrBurst = meanOf(ws => ws.vmr ? ws.vmr.darkOnsetBurst : null);
    const ctrlVmrDark = meanOf(ws => ws.vmr ? ws.vmr.darkMean : null);
    const ctrlWindowAuc = meanOf(ws => ws.windowAuc ? ws.windowAuc.auc : null);
    const ctrlWindowMean = meanOf(ws => ws.windowAuc ? ws.windowAuc.mean : null);
    const ctrlStimMean = meanOf(ws => ws.startle ? ws.startle.stimMean : null);

    // Control per-bin mean for the active time-series metric
    let ctrlMeanPerBin = null;
    if (parsed && parsed.kind === "summary" && ctrlWells.length > 0) {
      const trimRes = filterRowsByTrimWindow(parsed.rows || [], trimWindow);
      const rows = trimRes.rows;
      let sum = 0;
      let cnt = 0;
      for (const ws of ctrlWells) {
        for (let i = 0; i < rows.length; i++) {
          const v = extractRowMetricValue(rows[i], ws.well, metricId, parsed);
          if (v !== null && Number.isFinite(v)) { sum += v; cnt++; }
        }
      }
      if (cnt > 0 && Math.abs(sum / cnt) > 1e-6) ctrlMeanPerBin = sum / cnt;
    }

    const pctOf = (v, ref) => (v !== null && Number.isFinite(v) && ref !== null) ? roundNum((v / ref) * 100, 2) : null;

    for (const ws of runAnalysis.wells) {
      const norm = {
        controlGroup: controlGroupName,
        totalDistPctCtrl: pctOf(ws.totalDist, ctrlTotalDist),
        meanDistPctCtrl: pctOf(ws.meanDist, ctrlMeanDist),
        meanMsdPctCtrl: pctOf(ws.meanMsd, ctrlMeanMsd),
        vmrBurstPctCtrl: pctOf(ws.vmr ? ws.vmr.darkOnsetBurst : null, ctrlVmrBurst),
        vmrDarkPctCtrl: pctOf(ws.vmr ? ws.vmr.darkMean : null, ctrlVmrDark),
        windowAucPctCtrl: pctOf(ws.windowAuc ? ws.windowAuc.auc : null, ctrlWindowAuc),
        windowMeanPctCtrl: pctOf(ws.windowAuc ? ws.windowAuc.mean : null, ctrlWindowMean),
        stimMeanPctCtrl: pctOf(ws.startle ? ws.startle.stimMean : null, ctrlStimMean)
      };
      ws.normalized = norm;
      if (ws.heatmapValues) {
        ws.heatmapValues.normTotalDistPctCtrl = norm.totalDistPctCtrl;
        ws.heatmapValues.normVmrBurstPctCtrl = norm.vmrBurstPctCtrl;
      }
    }

    for (const g of runAnalysis.groups) {
      const inc = runAnalysis.wells.filter(ws => ws.group === g.group && !ws.excluded);
      g.normalized = {
        controlGroup: controlGroupName,
        totalDistPctCtrl: computeStats(inc.map(ws => ws.normalized ? ws.normalized.totalDistPctCtrl : null)),
        meanDistPctCtrl: computeStats(inc.map(ws => ws.normalized ? ws.normalized.meanDistPctCtrl : null)),
        meanMsdPctCtrl: computeStats(inc.map(ws => ws.normalized ? ws.normalized.meanMsdPctCtrl : null)),
        vmrBurstPctCtrl: computeStats(inc.map(ws => ws.normalized ? ws.normalized.vmrBurstPctCtrl : null)),
        vmrDarkPctCtrl: computeStats(inc.map(ws => ws.normalized ? ws.normalized.vmrDarkPctCtrl : null)),
        windowAucPctCtrl: computeStats(inc.map(ws => ws.normalized ? ws.normalized.windowAucPctCtrl : null)),
        windowMeanPctCtrl: computeStats(inc.map(ws => ws.normalized ? ws.normalized.windowMeanPctCtrl : null)),
        stimMeanPctCtrl: computeStats(inc.map(ws => ws.normalized ? ws.normalized.stimMeanPctCtrl : null))
      };
    }

    return {
      controlGroupName,
      controlN: ctrlWells.length,
      controlTotalDist: ctrlTotalDist !== null ? roundNum(ctrlTotalDist, 2) : null,
      controlMeanDist: ctrlMeanDist !== null ? roundNum(ctrlMeanDist, 3) : null,
      controlMeanPerBin: ctrlMeanPerBin !== null ? roundNum(ctrlMeanPerBin, 4) : null
    };
  }

  function analyzePooledRuns(runsRaw, options) {
    const opts = options || {};
    const runs = Array.isArray(runsRaw) ? runsRaw.filter(Boolean) : [];
    const scope = (opts.scope === "pooled" && runs.length > 1) ? "pooled" : "active";
    const requestedUnit = (opts.unitOfAnalysis === "plates") ? "plates" : "wells";
    const effectiveUnit = (scope === "pooled" && runs.length > 1 && requestedUnit === "plates") ? "plates" : "wells";
    const normalizeToControl = Boolean(opts.normalizeToControl);
    const binGroupSize = Math.max(1, Math.round(parseFloat(opts.tsBinGroupSize || opts.binGroupSize) || 1));
    const tsMetric = opts.tsMetric || opts.metric || "dist";

    if (runs.length === 0) {
      const empty = computeAnalysis({
        qcThresholds: opts.qcThresholds,
        trimWindow: opts.trimWindow,
        windowAuc: opts.windowAuc,
        metric: tsMetric,
        binGroupSize
      });
      return {
        ...empty,
        scope: "active",
        unitOfAnalysis: "wells",
        nUnit: "wells",
        plateSummaryRows: [],
        postStatsExclusions: 0,
        activeRunId: null,
        runCount: 0,
        runsMeta: [],
        runAnalyses: [],
        pooledMeta: {
          scope: "active",
          unitOfAnalysis: "wells",
          requestedUnitOfAnalysis: requestedUnit,
          nUnit: "wells",
          runCount: 0,
          activeRunId: null,
          normalizeToControl: false,
          controlGroupName: null,
          availableControlGroups: [],
          factorNames: [],
          hasMixedLayouts: false,
          layoutSummary: "No runs",
          postStatsExclusions: 0,
          batchDiagnostics: null
        }
      };
    }

    // Resolve active run
    const activeRun = runs.find(r => r.id === opts.activeRunId || r.runId === opts.activeRunId) || runs[0];
    const activeRunInternalId = activeRun.id || activeRun.runId || "run_1";

    // Collect union of factor names & group order across runs
    const factorNameSet = new Set();
    const unionGroupOrder = [];
    const unionGroupSeen = new Set();
    if (Array.isArray(opts.groupOrder)) {
      for (const g of opts.groupOrder) {
        const clean = String(g || "").trim();
        if (clean && !unionGroupSeen.has(clean)) { unionGroupSeen.add(clean); unionGroupOrder.push(clean); }
      }
    }
    for (const r of runs) {
      for (const fn of (r.factorNames || [])) {
        const clean = String(fn || "").trim();
        if (clean) factorNameSet.add(clean);
      }
      for (const g of (r.groupOrder || [])) {
        const clean = String(g || "").trim();
        if (clean && !unionGroupSeen.has(clean)) { unionGroupSeen.add(clean); unionGroupOrder.push(clean); }
      }
    }
    const allFactorNames = [...factorNameSet];

    // 1. Run computeAnalysis on every individual run
    const runAnalyses = [];
    const runsMeta = [];
    const allDiscoveredGroups = unionGroupOrder.slice();
    const allDiscoveredSet = new Set(unionGroupSeen);

    for (let idx = 0; idx < runs.length; idx++) {
      const r = runs[idx];
      const inferred = inferRunMeta(r.filename || (r.summaryParsed && r.summaryParsed.filename), r.summaryParsed);
      const rRunId = r.runId || inferred.runId || `Run_${idx + 1}`;
      const rDate = r.date || inferred.date;
      const rInternalId = r.id || rRunId;
      const rFactorNames = (Array.isArray(r.factorNames) && r.factorNames.length) ? r.factorNames : allFactorNames;

      const an = computeAnalysis({
        parsed: r.summaryParsed || r.parsed || null,
        zchange: r.zchangeParsed || r.zchange || null,
        xyParsed: r.xyParsed || r.xy || null,
        context: r.context || null,
        groups: r.groups || {},
        groupOrder: r.groupOrder || unionGroupOrder,
        factors: r.wellFactors || r.factors || null,
        factorNames: rFactorNames,
        excludedWells: r.excludedWells || [],
        excludeMeta: r.excludeMeta || {},
        qcThresholds: opts.qcThresholds,
        trimWindow: opts.trimWindow,
        windowAuc: opts.windowAuc,
        metric: tsMetric,
        binGroupSize,
        xyFreezeSpeedMmS: opts.xyFreezeSpeedMmS,
        xyGridW: opts.xyGridW,
        xyPlateGridW: opts.xyPlateGridW,
        xyPlateGridH: opts.xyPlateGridH,
        runId: rRunId,
        date: rDate,
        filename: r.filename || (r.summaryParsed && r.summaryParsed.filename) || ""
      });

      for (const g of an.groups) {
        if (!allDiscoveredSet.has(g.group)) {
          allDiscoveredSet.add(g.group);
          allDiscoveredGroups.push(g.group);
        }
      }

      runAnalyses.push({ id: rInternalId, runId: rRunId, date: rDate, run: r, analysis: an });
      runsMeta.push({
        id: rInternalId,
        runId: rRunId,
        date: rDate,
        filename: r.filename || (r.summaryParsed && r.summaryParsed.filename) || "",
        layoutId: an.layout ? an.layout.id : "unknown",
        layoutName: an.layout ? (an.layout.shortName || an.layout.name || an.layout.id) : "Unknown",
        rowCount: an.kpis.rowCount,
        totalWells: an.kpis.totalWells,
        activeWells: an.kpis.activeWells,
        flaggedCount: an.kpis.flaggedCount,
        postStatsExclusions: an.postStatsExclusions || 0,
        hasXy: an.capabilities.hasXy,
        hasZchange: an.capabilities.hasZchange
      });
    }

    // Detect homogeneous vs mixed plate layouts across loaded runs
    const layoutIdSet = new Set(runsMeta.map(m => m.layoutId || "unknown"));
    const hasMixedLayouts = layoutIdSet.size > 1;
    const layoutCounts = {};
    for (const m of runsMeta) {
      const lbl = m.layoutName || m.layoutId || "Unknown";
      layoutCounts[lbl] = (layoutCounts[lbl] || 0) + 1;
    }
    const layoutParts = Object.entries(layoutCounts).map(([lbl, cnt]) => `${cnt} × ${lbl}`);
    const layoutSummary = hasMixedLayouts
      ? `${runsMeta.length} runs (mixed: ${layoutParts.join(" + ")})`
      : (layoutParts[0] || `${runsMeta.length} runs`);

    // 2. Determine Control group & apply per-run % Control normalization
    const controlGroupName = resolveControlGroupName(allDiscoveredGroups, opts.controlGroupName);
    const perRunNormMeta = [];
    for (const item of runAnalyses) {
      const normInfo = applyPerRunControlNormalization(
        item.analysis,
        item.run.summaryParsed || item.run.parsed || null,
        opts.trimWindow,
        controlGroupName,
        item.analysis.activeMetric
      );
      item.normInfo = normInfo;
      perRunNormMeta.push({
        id: item.id,
        runId: item.runId,
        date: item.date,
        ...normInfo
      });
    }

    const ctrlTotals = perRunNormMeta.map(m => m.controlTotalDist).filter(v => v !== null && v > 0);
    const plateShiftPct = ctrlTotals.length >= 2
      ? roundNum(((Math.max(...ctrlTotals) - Math.min(...ctrlTotals)) / Math.min(...ctrlTotals)) * 100, 1)
      : 0;

    const batchDiagnostics = {
      controlGroupName,
      perRun: perRunNormMeta,
      plateShiftPct
    };

    const activeEntry = runAnalyses.find(x => x.id === activeRunInternalId || x.runId === activeRunInternalId) || runAnalyses[0];
    const activeAn = activeEntry.analysis;

    // Build per-plate group mean rows (one biological-replicate observation per run × group)
    const plateSummaryRows = [];
    const plateRowsByGroup = {};
    for (const item of runAnalyses) {
      const rAn = item.analysis;
      for (const g of rAn.groups) {
        const inc = rAn.wells.filter(ws => ws.group === g.group && !ws.excluded);
        if (inc.length === 0) continue;
        const phaseDist = {};
        const phaseMsd = {};
        for (const ph of Object.keys(g.byPhase || {})) {
          phaseDist[ph] = {
            mean: g.byPhase[ph].meanDist ? g.byPhase[ph].meanDist.mean : null,
            total: g.byPhase[ph].totalDist ? g.byPhase[ph].totalDist.mean : null
          };
          if (g.byPhase[ph].meanMsd) {
            phaseMsd[ph] = { mean: g.byPhase[ph].meanMsd.mean };
          }
        }
        let zonesRow = null;
        if (g.zones) {
          const pctMap = {};
          for (const zKey of Object.keys(g.zones.pct || {})) {
            pctMap[zKey] = g.zones.pct[zKey] ? g.zones.pct[zKey].mean : null;
          }
          zonesRow = {
            pct: pctMap,
            z1Pct: g.zones.z1Pct ? g.zones.z1Pct.mean : null,
            z2Pct: g.zones.z2Pct ? g.zones.z2Pct.mean : null,
            preferenceIndex: g.zones.preferenceIndex ? g.zones.preferenceIndex.mean : null
          };
        }
        const vmrRow = g.vmr ? {
          lightMean: g.vmr.lightMean ? g.vmr.lightMean.mean : null,
          darkMean: g.vmr.darkMean ? g.vmr.darkMean.mean : null,
          darkMinusLight: g.vmr.darkMinusLight ? g.vmr.darkMinusLight.mean : null,
          darkOnsetBurst: g.vmr.darkOnsetBurst ? g.vmr.darkOnsetBurst.mean : null,
          lightOnsetBurst: g.vmr.lightOnsetBurst ? g.vmr.lightOnsetBurst.mean : null
        } : null;
        const startleRow = g.startle ? {
          baselineMean: g.startle.baselineMean ? g.startle.baselineMean.mean : null,
          itiMean: g.startle.itiMean ? g.startle.itiMean.mean : null,
          stimMean: g.startle.stimMean ? g.startle.stimMean.mean : null,
          pulseAloneMean: g.startle.pulseAloneMean ? g.startle.pulseAloneMean.mean : null,
          ppiTrialMean: g.startle.ppiTrialMean ? g.startle.ppiTrialMean.mean : null,
          ppiPct: g.startle.ppiPct ? g.startle.ppiPct.mean : null,
          habituationPct: g.startle.habituationPct ? g.startle.habituationPct.mean : null
        } : null;
        const habRow = g.habituation ? {
          trialCount: g.habituation.trialCount,
          trialPeaks: (g.habituation.trialSeries || []).map(ts => ts.mean),
          habituationIndex: g.habituation.habituationIndex ? g.habituation.habituationIndex.mean : null
        } : null;
        const winAucRow = g.windowAuc ? {
          startSec: g.windowAuc.startSec,
          endSec: g.windowAuc.endSec,
          auc: g.windowAuc.auc ? g.windowAuc.auc.mean : null,
          mean: g.windowAuc.mean ? g.windowAuc.mean.mean : null,
          sum: g.windowAuc.sum ? g.windowAuc.sum.mean : null
        } : null;
        const xyRow = g.xy ? {
          frameCount: g.xy.n > 0 ? 1 : 0,
          immobilityPct: g.xy.immobilityPct ? g.xy.immobilityPct.mean : null,
          meanSpeedMmS: g.xy.meanSpeedMmS ? g.xy.meanSpeedMmS.mean : null,
          burstSpeedP95MmS: g.xy.burstSpeedP95MmS ? g.xy.burstSpeedP95MmS.mean : null,
          centerOccupancyPct: g.xy.centerOccupancyPct ? g.xy.centerOccupancyPct.mean : null,
          outerWallPct: g.xy.outerWallPct ? g.xy.outerWallPct.mean : null,
          meanWallDistMm: g.xy.meanWallDistMm ? g.xy.meanWallDistMm.mean : null,
          meanNormRadius: g.xy.meanNormRadius ? g.xy.meanNormRadius.mean : null
        } : null;
        const zcRow = g.zchange ? {
          totalEntries: g.zchange.totalEntries ? g.zchange.totalEntries.mean : null,
          armEntries: g.zchange.armEntries ? g.zchange.armEntries.mean : null,
          sabPct: g.zchange.sabPct ? g.zchange.sabPct.mean : null
        } : null;
        const normRow = g.normalized ? {
          controlGroup: g.normalized.controlGroup,
          totalDistPctCtrl: g.normalized.totalDistPctCtrl ? g.normalized.totalDistPctCtrl.mean : null,
          meanDistPctCtrl: g.normalized.meanDistPctCtrl ? g.normalized.meanDistPctCtrl.mean : null,
          meanMsdPctCtrl: g.normalized.meanMsdPctCtrl ? g.normalized.meanMsdPctCtrl.mean : null,
          vmrBurstPctCtrl: g.normalized.vmrBurstPctCtrl ? g.normalized.vmrBurstPctCtrl.mean : null,
          vmrDarkPctCtrl: g.normalized.vmrDarkPctCtrl ? g.normalized.vmrDarkPctCtrl.mean : null,
          windowAucPctCtrl: g.normalized.windowAucPctCtrl ? g.normalized.windowAucPctCtrl.mean : null,
          windowMeanPctCtrl: g.normalized.windowMeanPctCtrl ? g.normalized.windowMeanPctCtrl.mean : null,
          stimMeanPctCtrl: g.normalized.stimMeanPctCtrl ? g.normalized.stimMeanPctCtrl.mean : null
        } : null;

        const pRow = {
          runInternalId: item.id,
          runId: item.runId,
          date: item.date,
          group: g.group,
          wellKey: `${item.runId}:PLATE_MEAN`,
          well: `${item.runId} mean`,
          nWells: inc.length,
          totalAssigned: g.totalAssigned,
          excludedCount: g.excludedCount,
          excluded: false,
          totalDist: g.totalDist ? g.totalDist.mean : null,
          meanDist: g.meanDist ? g.meanDist.mean : null,
          meanSpeedMmS: g.meanSpeedMmS ? g.meanSpeedMmS.mean : null,
          meanMsd: g.meanMsd ? g.meanMsd.mean : null,
          phaseDist,
          phaseMsd,
          vmr: vmrRow,
          zones: zonesRow,
          startle: startleRow,
          habituation: habRow,
          windowAuc: winAucRow,
          xy: xyRow,
          zchange: zcRow,
          normalized: normRow
        };
        plateSummaryRows.push(pRow);
        if (!plateRowsByGroup[g.group]) plateRowsByGroup[g.group] = [];
        plateRowsByGroup[g.group].push(pRow);
      }
    }

    const totalPostStatsExclAll = runAnalyses.reduce((acc, x) => acc + (x.analysis.postStatsExclusions || 0), 0);

    const pooledMeta = {
      scope,
      unitOfAnalysis: effectiveUnit,
      requestedUnitOfAnalysis: requestedUnit,
      nUnit: effectiveUnit,
      runCount: runAnalyses.length,
      activeRunId: activeEntry.id,
      activeRunLabel: activeEntry.runId,
      normalizeToControl,
      controlGroupName,
      availableControlGroups: allDiscoveredGroups.slice(),
      factorNames: allFactorNames,
      hasMixedLayouts,
      layoutSummary,
      postStatsExclusions: scope === "pooled" ? totalPostStatsExclAll : (activeAn.postStatsExclusions || 0),
      batchDiagnostics
    };

    // Helper: optionally attach normalized comparison view
    const appendNormComparisonView = (views, hasNorm) => {
      const out = views.slice();
      if (hasNorm && !out.some(v => v.id === "normalized_ctrl")) {
        out.push({ id: "normalized_ctrl", label: `% of ${controlGroupName} (Normalized)` });
      }
      return out;
    };

    // 3A. Active-Run Scope (returns active run analysis enriched with pooledMeta & optional normalized TS)
    if (scope === "active") {
      let tsOut = activeAn.timeSeries;
      if (normalizeToControl && activeEntry.normInfo && activeEntry.normInfo.controlMeanPerBin) {
        const ref = activeEntry.normInfo.controlMeanPerBin;
        let yMin = Infinity;
        let yMax = -Infinity;
        const normSeries = activeAn.timeSeries.series.map(s => ({
          ...s,
          values: s.values.map(pt => {
            if (pt.mean === null) return pt;
            const m = roundNum((pt.mean / ref) * 100, 2);
            const se = pt.sem !== null ? roundNum((pt.sem / ref) * 100, 2) : null;
            yMin = Math.min(yMin, m - (se || 0));
            yMax = Math.max(yMax, m + (se || 0));
            return { ...pt, mean: m, sem: se };
          })
        }));
        tsOut = {
          ...activeAn.timeSeries,
          normalized: true,
          metricLabel: `${activeAn.timeSeries.metricLabel} (% of ${controlGroupName})`,
          unit: "% Ctrl",
          series: normSeries,
          yMin: Number.isFinite(yMin) ? roundNum(Math.min(0, yMin), 2) : 0,
          yMax: Number.isFinite(yMax) ? roundNum(yMax, 2) : 100
        };
      }
      const hasNormAny = activeAn.wells.some(ws => ws.normalized && ws.normalized.totalDistPctCtrl !== null);
      return {
        ...activeAn,
        scope: "active",
        unitOfAnalysis: "wells",
        nUnit: "wells",
        plateSummaryRows,
        postStatsExclusions: activeAn.postStatsExclusions || 0,
        activeRunId: activeEntry.id,
        runCount: runAnalyses.length,
        runsMeta,
        runAnalyses: runAnalyses.map(x => ({ id: x.id, runId: x.runId, date: x.date, analysis: x.analysis, normInfo: x.normInfo })),
        pooledMeta,
        timeSeries: tsOut,
        comparisonViews: appendNormComparisonView(activeAn.comparisonViews, normalizeToControl && hasNormAny)
      };
    }

    // 3B. Pooled Multi-Run Scope
    const summaryEntries = runAnalyses.filter(x => x.analysis.kpis.rowCount > 0 && x.run.summaryParsed);
    const refEntry = summaryEntries.find(x => x.id === activeEntry.id) || summaryEntries[0] || activeEntry;
    const refAn = refEntry.analysis;
    const activeMetric = refAn.activeMetric;

    // Pool all well summaries across runs
    const pooledWells = [];
    const wellsByKey = {};
    for (const item of runAnalyses) {
      for (const ws of item.analysis.wells) {
        const copy = { ...ws, runInternalId: item.id };
        pooledWells.push(copy);
        wellsByKey[copy.wellKey] = copy;
      }
    }

    // Union of phases across runs
    const pooledPhases = [];
    const phaseSeen = new Set();
    for (const item of runAnalyses) {
      for (const ph of item.analysis.phases) {
        if (!phaseSeen.has(ph)) { phaseSeen.add(ph); pooledPhases.push(ph); }
      }
    }

    const hasMsd = runAnalyses.some(x => x.analysis.capabilities.hasMsd);
    const hasZones = runAnalyses.some(x => x.analysis.capabilities.hasZones);
    const maxZone = runAnalyses.reduce((mx, x) => Math.max(mx, x.analysis.capabilities.maxZone || 0), 0);
    const hasVmr = runAnalyses.some(x => x.analysis.capabilities.hasVmr);
    const hasPpi = runAnalyses.some(x => x.analysis.capabilities.hasPpi);
    const hasStartle = runAnalyses.some(x => x.analysis.capabilities.hasStartle);
    const hasHabituation = runAnalyses.some(x => x.analysis.capabilities.hasHabituation);
    const hasWindowAuc = runAnalyses.some(x => x.analysis.capabilities.hasWindowAuc);
    const hasZchange = runAnalyses.some(x => x.analysis.capabilities.hasZchange);
    const hasXy = runAnalyses.some(x => x.analysis.capabilities.hasXy);

    // Pooled group summaries across all runs (respects unitOfAnalysis: "wells" | "plates")
    const pooledGroups = [];
    for (const gName of allDiscoveredGroups) {
      const assigned = pooledWells.filter(ws => ws.group === gName);
      if (assigned.length === 0) continue;
      const included = assigned.filter(ws => !ws.excluded);
      const pRows = plateRowsByGroup[gName] || [];
      const obs = (effectiveUnit === "plates") ? pRows : included;
      const runIdsSet = new Set(included.map(ws => ws.runId));

      const byPhase = {};
      for (const ph of pooledPhases) {
        byPhase[ph] = {
          meanDist: computeStats(obs.map(ws => (ws.phaseDist && ws.phaseDist[ph]) ? ws.phaseDist[ph].mean : null)),
          totalDist: computeStats(obs.map(ws => (ws.phaseDist && ws.phaseDist[ph]) ? ws.phaseDist[ph].total : null)),
          meanMsd: hasMsd ? computeStats(obs.map(ws => (ws.phaseMsd && ws.phaseMsd[ph]) ? ws.phaseMsd[ph].mean : null)) : null
        };
      }

      const vmrGroup = hasVmr ? {
        lightMean: computeStats(obs.map(ws => ws.vmr ? ws.vmr.lightMean : null)),
        darkMean: computeStats(obs.map(ws => ws.vmr ? ws.vmr.darkMean : null)),
        darkMinusLight: computeStats(obs.map(ws => ws.vmr ? ws.vmr.darkMinusLight : null)),
        darkOnsetBurst: computeStats(obs.map(ws => ws.vmr ? ws.vmr.darkOnsetBurst : null)),
        lightOnsetBurst: computeStats(obs.map(ws => ws.vmr ? ws.vmr.lightOnsetBurst : null))
      } : null;

      let zonesGroup = null;
      if (hasZones) {
        const pctStats = {};
        for (let z = 1; z <= maxZone; z++) {
          pctStats[z] = computeStats(obs.map(ws => ws.zones ? ws.zones.pct[z] : null));
        }
        zonesGroup = {
          pct: pctStats,
          z1Pct: pctStats[1] || computeStats([]),
          z2Pct: pctStats[2] || computeStats([]),
          preferenceIndex: computeStats(obs.map(ws => ws.zones ? ws.zones.preferenceIndex : null))
        };
      }

      const startleGroup = hasStartle ? {
        baselineMean: computeStats(obs.map(ws => ws.startle ? ws.startle.baselineMean : null)),
        itiMean: computeStats(obs.map(ws => ws.startle ? ws.startle.itiMean : null)),
        stimMean: computeStats(obs.map(ws => ws.startle ? ws.startle.stimMean : null)),
        pulseAloneMean: computeStats(obs.map(ws => ws.startle ? ws.startle.pulseAloneMean : null)),
        ppiTrialMean: computeStats(obs.map(ws => ws.startle ? ws.startle.ppiTrialMean : null)),
        ppiPct: computeStats(obs.map(ws => ws.startle ? ws.startle.ppiPct : null)),
        habituationPct: computeStats(obs.map(ws => ws.startle ? ws.startle.habituationPct : null))
      } : null;

      let habituationGroup = null;
      if (hasHabituation) {
        const maxTrials = obs.reduce((mx, ws) => Math.max(mx, ws.habituation ? ws.habituation.trialCount : 0), 0);
        const trialLabels = [];
        for (let t = 1; t <= maxTrials; t++) trialLabels.push(`T${t}`);
        const trialSeries = trialLabels.map((lbl, tIdx) => {
          const st = computeStats(obs.map(ws => (ws.habituation && ws.habituation.trialPeaks[tIdx] != null) ? ws.habituation.trialPeaks[tIdx] : null));
          return { trialNum: tIdx + 1, label: lbl, mean: st.mean !== null ? roundNum(st.mean, 3) : null, sem: st.sem !== null ? roundNum(st.sem, 3) : null, sd: st.sd !== null ? roundNum(st.sd, 3) : null, n: st.n };
        });
        habituationGroup = {
          trialCount: maxTrials,
          trialLabels,
          trialSeries,
          habituationIndex: computeStats(obs.map(ws => ws.habituation ? ws.habituation.habituationIndex : null))
        };
      }

      const windowAucGroup = hasWindowAuc ? {
        startSec: refAn.windowAucConfig ? refAn.windowAucConfig.startSec : null,
        endSec: refAn.windowAucConfig ? refAn.windowAucConfig.endSec : null,
        auc: computeStats(obs.map(ws => ws.windowAuc ? ws.windowAuc.auc : null)),
        mean: computeStats(obs.map(ws => ws.windowAuc ? ws.windowAuc.mean : null)),
        sum: computeStats(obs.map(ws => ws.windowAuc ? ws.windowAuc.sum : null))
      } : null;

      const xyGroup = hasXy ? {
        n: obs.filter(ws => ws.xy && ws.xy.frameCount > 0).length,
        immobilityPct: computeStats(obs.map(ws => ws.xy ? ws.xy.immobilityPct : null)),
        meanSpeedMmS: computeStats(obs.map(ws => ws.xy ? ws.xy.meanSpeedMmS : null)),
        burstSpeedP95MmS: computeStats(obs.map(ws => ws.xy ? ws.xy.burstSpeedP95MmS : null)),
        centerOccupancyPct: computeStats(obs.map(ws => ws.xy ? ws.xy.centerOccupancyPct : null)),
        outerWallPct: computeStats(obs.map(ws => ws.xy ? ws.xy.outerWallPct : null)),
        meanWallDistMm: computeStats(obs.map(ws => ws.xy ? ws.xy.meanWallDistMm : null)),
        meanNormRadius: computeStats(obs.map(ws => ws.xy ? ws.xy.meanNormRadius : null))
      } : null;

      let zchangeGroup = null;
      if (hasZchange) {
        const mz = Math.max(2, maxZone);
        const gMat = Array.from({ length: mz }, () => Array(mz).fill(0));
        for (const ws of included) {
          if (!ws.zchange || !ws.zchange.transitionMatrix) continue;
          for (let r = 0; r < Math.min(mz, ws.zchange.transitionMatrix.length); r++) {
            for (let c = 0; c < Math.min(mz, ws.zchange.transitionMatrix[r].length); c++) {
              gMat[r][c] += ws.zchange.transitionMatrix[r][c] || 0;
            }
          }
        }
        zchangeGroup = {
          totalEntries: computeStats(obs.map(ws => ws.zchange ? ws.zchange.totalEntries : null)),
          armEntries: computeStats(obs.map(ws => ws.zchange ? ws.zchange.armEntries : null)),
          sabPct: computeStats(obs.map(ws => ws.zchange ? ws.zchange.sabPct : null)),
          transitionMatrix: gMat
        };
      }

      const normGroup = {
        controlGroup: controlGroupName,
        totalDistPctCtrl: computeStats(obs.map(ws => ws.normalized ? ws.normalized.totalDistPctCtrl : null)),
        meanDistPctCtrl: computeStats(obs.map(ws => ws.normalized ? ws.normalized.meanDistPctCtrl : null)),
        meanMsdPctCtrl: computeStats(obs.map(ws => ws.normalized ? ws.normalized.meanMsdPctCtrl : null)),
        vmrBurstPctCtrl: computeStats(obs.map(ws => ws.normalized ? ws.normalized.vmrBurstPctCtrl : null)),
        vmrDarkPctCtrl: computeStats(obs.map(ws => ws.normalized ? ws.normalized.vmrDarkPctCtrl : null)),
        windowAucPctCtrl: computeStats(obs.map(ws => ws.normalized ? ws.normalized.windowAucPctCtrl : null)),
        windowMeanPctCtrl: computeStats(obs.map(ws => ws.normalized ? ws.normalized.windowMeanPctCtrl : null)),
        stimMeanPctCtrl: computeStats(obs.map(ws => ws.normalized ? ws.normalized.stimMeanPctCtrl : null))
      };

      pooledGroups.push({
        group: gName,
        n: obs.length,
        nUnit: effectiveUnit,
        wellLevelN: included.length,
        nRuns: runIdsSet.size,
        totalAssigned: assigned.length,
        excludedCount: assigned.length - included.length,
        wells: included.map(ws => ws.wellKey),
        plateMeans: pRows,
        totalDist: computeStats(obs.map(ws => ws.totalDist)),
        meanDist: computeStats(obs.map(ws => ws.meanDist)),
        meanSpeedMmS: computeStats(obs.map(ws => ws.meanSpeedMmS)),
        meanMsd: hasMsd ? computeStats(obs.map(ws => ws.meanMsd)) : null,
        byPhase,
        vmr: vmrGroup,
        zones: zonesGroup,
        startle: startleGroup,
        habituation: habituationGroup,
        windowAuc: windowAucGroup,
        xy: xyGroup,
        zchange: zchangeGroup,
        normalized: normGroup
      });
    }

    // Pooled Time Series aligned on reference xAxis chunk grid (with relTime fallback for mixed bin durations)
    const refXAxis = refAn.timeSeries.xAxis || [];
    const refBinSec = refAn.kpis.binDurationSec || 1;
    const pooledSeries = [];
    let yMin = Infinity;
    let yMax = -Infinity;

    // Pre-extract trimmed rows for each run once
    const runRowsList = summaryEntries.map(item => {
      const p = item.run.summaryParsed || item.run.parsed;
      const tr = filterRowsByTrimWindow(p.rows || [], opts.trimWindow);
      const normRef = (normalizeToControl && item.normInfo && item.normInfo.controlMeanPerBin)
        ? item.normInfo.controlMeanPerBin
        : null;
      const rBinSec = item.analysis.kpis.binDurationSec || p.binDurationSec || 1;
      return { item, parsed: p, rows: tr.rows, normRef, binSec: rBinSec };
    });

    for (const gObj of pooledGroups) {
      const gName = gObj.group;
      const values = [];
      for (let ci = 0; ci < refXAxis.length; ci++) {
        const xPt = refXAxis[ci];
        const chunkStart = ci * binGroupSize;
        const chunkEnd = chunkStart + binGroupSize - 1;
        const obsVals = [];

        for (const rr of runRowsList) {
          const rRows = rr.rows;
          if (!rRows.length) continue;
          const incWells = rr.item.analysis.wells.filter(ws => ws.group === gName && !ws.excluded).map(ws => ws.well);
          if (incWells.length === 0) continue;

          // Choose matching row indices: index-aligned when binDurationSec matches, relTime-windowed otherwise
          const sameGrid = Math.abs(rr.binSec - refBinSec) <= 1e-6;
          let matchedRows = null;
          if (sameGrid) {
            if (chunkStart >= rRows.length) continue;
            const rEnd = Math.min(rRows.length - 1, chunkEnd);
            matchedRows = [];
            for (let r = chunkStart; r <= rEnd; r++) matchedRows.push(rRows[r]);
          } else {
            const t0 = xPt.relTime;
            const t1 = xPt.endRelTime;
            matchedRows = rRows.filter(row => row.relTime >= t0 - 1e-6 && row.relTime < t1 - 1e-6);
            if (matchedRows.length === 0) continue;
          }

          const runWellVals = [];
          for (const w of incWells) {
            let sum = 0;
            let cnt = 0;
            for (let r = 0; r < matchedRows.length; r++) {
              const v = extractRowMetricValue(matchedRows[r], w, activeMetric, rr.parsed);
              if (v !== null && Number.isFinite(v)) { sum += v; cnt++; }
            }
            if (cnt > 0) {
              const meanBin = sum / cnt;
              if (normalizeToControl) {
                if (rr.normRef !== null) runWellVals.push((meanBin / rr.normRef) * 100);
              } else {
                runWellVals.push(meanBin);
              }
            }
          }

          if (runWellVals.length > 0) {
            if (effectiveUnit === "plates") {
              const plateMean = runWellVals.reduce((a, b) => a + b, 0) / runWellVals.length;
              obsVals.push(plateMean);
            } else {
              for (const v of runWellVals) obsVals.push(v);
            }
          }
        }

        const st = computeStats(obsVals);
        if (st.mean !== null) {
          yMin = Math.min(yMin, st.mean - (st.sem || 0));
          yMax = Math.max(yMax, st.mean + (st.sem || 0));
        }
        values.push({
          mean: st.mean !== null ? roundNum(st.mean, 3) : null,
          sem: st.sem !== null ? roundNum(st.sem, 3) : null,
          sd: st.sd !== null ? roundNum(st.sd, 3) : null,
          n: st.n,
          min: st.min !== null ? roundNum(st.min, 3) : null,
          max: st.max !== null ? roundNum(st.max, 3) : null
        });
      }
      pooledSeries.push({ group: gName, n: gObj.n, nUnit: effectiveUnit, values });
    }

    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1; }
    else yMin = Math.min(0, yMin);

    const pooledTimeSeries = {
      ...refAn.timeSeries,
      nUnit: effectiveUnit,
      normalized: normalizeToControl,
      metricLabel: normalizeToControl ? `${refAn.timeSeries.metricLabel} (% of ${controlGroupName})` : refAn.timeSeries.metricLabel,
      unit: normalizeToControl ? "% Ctrl" : refAn.timeSeries.unit,
      series: pooledSeries,
      yMin: roundNum(yMin, 3),
      yMax: roundNum(yMax, 3)
    };

    // Pooled _XY (combine per-group normalized heatmaps across runs with _XY)
    let pooledXy = null;
    const xyEntries = runAnalyses.filter(x => x.analysis.xyAnalysis && x.analysis.xyAnalysis.hasXy);
    if (xyEntries.length > 0) {
      const baseXy = xyEntries[0].analysis.xyAnalysis;
      const gSize = baseXy.wellGridSize;
      const groupHeatmaps = {};
      const groupStats = {};
      for (const gObj of pooledGroups) {
        const gName = gObj.group;
        const recs = pooledWells.filter(ws => ws.group === gName && !ws.excluded && ws.xy && ws.xy.frameCount > 0).map(ws => ws.xy);
        if (recs.length === 0) continue;
        const avgGrid = Array.from({ length: gSize }, () => Array(gSize).fill(0));
        let gMax = 0;
        for (const rec of recs) {
          if (!rec.grid || rec.grid.length !== gSize) continue;
          for (let gy = 0; gy < gSize; gy++) {
            for (let gx = 0; gx < gSize; gx++) avgGrid[gy][gx] += (rec.grid[gy][gx] || 0) / recs.length;
          }
        }
        for (let gy = 0; gy < gSize; gy++) {
          for (let gx = 0; gx < gSize; gx++) {
            avgGrid[gy][gx] = roundNum(avgGrid[gy][gx], 5);
            if (avgGrid[gy][gx] > gMax) gMax = avgGrid[gy][gx];
          }
        }
        groupHeatmaps[gName] = { size: gSize, grid: avgGrid, maxVal: roundNum(gMax, 5), n: recs.length };
        groupStats[gName] = gObj.xy;
      }
      pooledXy = {
        ...baseXy,
        runCountWithXy: xyEntries.length,
        groups: groupStats,
        groupHeatmaps
      };
    }

    // Pooled _ZCHANGE
    let pooledZchange = null;
    let hasSab = false;
    if (hasZchange) {
      const zcEntries = runAnalyses.filter(x => x.analysis.zchangeSummary);
      const mz = zcEntries.reduce((m, x) => Math.max(m, x.analysis.zchangeSummary.maxZone), 2);
      const incMat = Array.from({ length: mz }, () => Array(mz).fill(0));
      const allMat = Array.from({ length: mz }, () => Array(mz).fill(0));
      let totalEvents = 0;
      let totalEntries = 0;
      const perArena = [];
      const sabVals = [];
      for (const item of zcEntries) {
        const zs = item.analysis.zchangeSummary;
        totalEvents += zs.totalEvents;
        totalEntries += zs.totalEntries;
        for (let r = 0; r < zs.maxZone; r++) {
          for (let c = 0; c < zs.maxZone; c++) {
            incMat[r][c] += zs.includedTransitionMatrix[r][c] || 0;
            allMat[r][c] += zs.allTransitionMatrix[r][c] || 0;
          }
        }
        for (const pa of zs.perArena) {
          perArena.push({ ...pa, runId: item.runId, wellKey: `${item.runId}:${pa.well}` });
          if (!pa.excluded && pa.sabPct !== null) sabVals.push(pa.sabPct);
        }
      }
      hasSab = mz >= 3 && perArena.some(a => a.triads > 0);
      const zonesArr = [];
      for (let z = 1; z <= mz; z++) zonesArr.push(z);
      pooledZchange = {
        maxZone: mz,
        zones: zonesArr,
        zoneLabels: buildZoneLabels(refAn.layout.id, mz, refAn.layout.zoneMode),
        totalEvents,
        totalEntries,
        includedTransitionMatrix: incMat,
        allTransitionMatrix: allMat,
        hasSab,
        overallSabPct: computeStats(sabVals),
        perArena
      };
    }

    // Pooled anomalies across all runs
    const pooledAnomalies = [];
    for (const item of runAnalyses) {
      for (const a of item.analysis.anomalies) pooledAnomalies.push(a);
    }
    pooledAnomalies.sort((a, b) => {
      const rank = (x) => x.isSpikeGlitch ? 0 : (x.isEmpty ? 1 : 2);
      const rDiff = rank(a) - rank(b);
      if (rDiff !== 0) return rDiff;
      if (a.isSpikeGlitch && b.isSpikeGlitch) return (b.maxBinDist || 0) - (a.maxBinDist || 0);
      return (a.totalDist || 0) - (b.totalDist || 0);
    });

    // Pooled KPIs
    const totalWellsAll = pooledWells.length;
    const excludedAll = pooledWells.filter(ws => ws.excluded).length;
    const emptyAll = pooledWells.filter(ws => ws.qc && ws.qc.isEmpty).length;
    const spikeAll = pooledWells.filter(ws => ws.qc && ws.qc.isSpikeGlitch).length;
    const flaggedWellKeys = pooledWells.filter(ws => ws.qc && (ws.qc.isEmpty || ws.qc.isSpikeGlitch)).map(ws => ws.wellKey);
    const tempMins = runAnalyses.map(x => x.analysis.kpis.tempMin).filter(Number.isFinite);
    const tempMaxs = runAnalyses.map(x => x.analysis.kpis.tempMax).filter(Number.isFinite);
    const tempMeans = runAnalyses.map(x => x.analysis.kpis.tempMean).filter(Number.isFinite);

    const pooledComparisonViews = [{ id: "phase_totals", label: pooledPhases.length > 1 ? "Phase Mean Distance" : "Total Distance" }];
    if (hasVmr) pooledComparisonViews.push({ id: "vmr", label: "VMR (Light vs Dark & Burst)" });
    if (hasZones) pooledComparisonViews.push({ id: "zone_pref", label: maxZone === 2 ? "Zone Preference / Thigmotaxis" : `Zone Occupancy (Z1–Z${maxZone})` });
    if (hasPpi) pooledComparisonViews.push({ id: "ppi", label: "Prepulse Inhibition (% PPI)" });
    else if (hasStartle) pooledComparisonViews.push({ id: "startle", label: "Startle Response (Baseline vs Stim)" });
    if (hasHabituation) pooledComparisonViews.push({ id: "habituation", label: "Trial Habituation (%)" });
    if (hasWindowAuc && refAn.windowAucConfig) pooledComparisonViews.push({ id: "window_auc", label: `Window AUC (${refAn.windowAucConfig.startSec}–${refAn.windowAucConfig.endSec}s)` });
    if (hasXy) pooledComparisonViews.push({ id: "xy_spatial", label: "Spatial Phenotyping (_XY)" });
    if (hasSab) pooledComparisonViews.push({ id: "sab", label: "Y-Maze Alternation (SAB %)" });
    const hasNormPooled = pooledWells.some(ws => ws.normalized && ws.normalized.totalDistPctCtrl !== null);

    return {
      scope: "pooled",
      unitOfAnalysis: effectiveUnit,
      nUnit: effectiveUnit,
      plateSummaryRows,
      postStatsExclusions: totalPostStatsExclAll,
      activeRunId: activeEntry.id,
      runId: `Pooled (${runAnalyses.length} runs)`,
      date: runsMeta.map(m => m.date).filter(Boolean).join(" .. "),
      runCount: runAnalyses.length,
      runsMeta,
      runAnalyses: runAnalyses.map(x => ({ id: x.id, runId: x.runId, date: x.date, analysis: x.analysis, normInfo: x.normInfo })),
      pooledMeta,
      factorNames: allFactorNames,
      qcThresholds: refAn.qcThresholds,
      trimInfo: refAn.trimInfo,
      windowAucConfig: refAn.windowAucConfig,
      windowAucWarning: refAn.windowAucWarning || "",
      activeMetric,
      availableMetrics: refAn.availableMetrics,
      layout: activeAn.layout, // Active plate map layout
      phases: pooledPhases,
      capabilities: {
        hasDist: runAnalyses.some(x => x.analysis.capabilities.hasDist),
        hasMsd,
        hasZones,
        hasZchange,
        hasXy,
        hasPeriStimulus: Boolean(refAn.periStimulus),
        hasHabituation,
        hasWindowAuc,
        hasTemp: tempMeans.length > 0,
        hasPhases: pooledPhases.length > 0,
        hasVmr,
        hasPpi,
        hasStartle,
        hasSab,
        maxZone
      },
      kpis: {
        totalWells: totalWellsAll,
        activeWells: totalWellsAll - excludedAll,
        excludedWells: excludedAll,
        postStatsExclusions: totalPostStatsExclAll,
        runCount: runAnalyses.length,
        rowCount: refAn.kpis.rowCount,
        durationSec: refAn.kpis.durationSec,
        binDurationSec: refAn.kpis.binDurationSec,
        emptyCount: emptyAll,
        spikeCount: spikeAll,
        flaggedCount: flaggedWellKeys.length,
        flaggedWells: flaggedWellKeys,
        tempMin: tempMins.length ? Math.min(...tempMins) : null,
        tempMax: tempMaxs.length ? Math.max(...tempMaxs) : null,
        tempMean: tempMeans.length ? roundNum(tempMeans.reduce((a, b) => a + b, 0) / tempMeans.length, 2) : null,
        targetTempC: refAn.kpis.targetTempC
      },
      timeSeries: pooledTimeSeries,
      periStimulus: refAn.periStimulus,
      xyAnalysis: pooledXy,
      wells: pooledWells,
      wellsById: activeAn.wellsById, // Active plate lookup for plate map rendering
      wellsByKey,                    // Cross-plate lookup keyed by `${runId}:${well}`
      groups: pooledGroups,
      zchangeSummary: pooledZchange,
      tempAnalysis: activeAn.tempAnalysis,
      anomalies: pooledAnomalies,
      comparisonViews: appendNormComparisonView(pooledComparisonViews, normalizeToControl && hasNormPooled)
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
    if (caps.hasHabituation) {
      out.push({ id: "habituation_pct", label: "Trial Habituation Index (%)", unit: "%" });
    }
    if (caps.hasWindowAuc) {
      out.push({ id: "window_auc", label: "Custom Window AUC", unit: "mm·s" });
      out.push({ id: "window_mean", label: "Custom Window Mean", unit: "mm/bin" });
    }
    if (caps.hasXy) {
      out.push({ id: "xy_immobility_pct", label: "_XY Immobility / Freezing (%)", unit: "%" });
      out.push({ id: "xy_center_pct", label: "_XY Center Occupancy (%)", unit: "%" });
      out.push({ id: "xy_burst_p95", label: "_XY 95th-Pct Burst Speed (mm/s)", unit: "mm/s" });
      out.push({ id: "xy_mean_speed", label: "_XY Mean Speed (mm/s)", unit: "mm/s" });
    }
    if (caps.hasSab) {
      out.push({ id: "sab_pct", label: "Y-Maze Alternation (SAB %)", unit: "%" });
    }
    if (analysis.wells && analysis.wells.some(ws => ws.normalized && ws.normalized.totalDistPctCtrl !== null)) {
      const ctrlLbl = (analysis.pooledMeta && analysis.pooledMeta.controlGroupName) || "Control";
      out.push({ id: "norm_total_dist_pct_ctrl", label: `Total Distance (% of ${ctrlLbl})`, unit: "% Ctrl" });
      if (caps.hasVmr) {
        out.push({ id: "norm_vmr_burst_pct_ctrl", label: `VMR Burst (% of ${ctrlLbl})`, unit: "% Ctrl" });
      }
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
    if (metricKey === "habituation_pct") return ws.habituation ? ws.habituation.habituationIndex : (ws.startle ? ws.startle.habituationPct : null);
    if (metricKey === "window_auc") return ws.windowAuc ? ws.windowAuc.auc : null;
    if (metricKey === "window_mean") return ws.windowAuc ? ws.windowAuc.mean : null;
    if (metricKey === "xy_immobility_pct") return ws.xy ? ws.xy.immobilityPct : null;
    if (metricKey === "xy_center_pct") return ws.xy ? ws.xy.centerOccupancyPct : null;
    if (metricKey === "xy_burst_p95") return ws.xy ? ws.xy.burstSpeedP95MmS : null;
    if (metricKey === "xy_mean_speed") return ws.xy ? ws.xy.meanSpeedMmS : null;
    if (metricKey === "sab_pct") return ws.zchange ? ws.zchange.sabPct : null;
    if (metricKey === "norm_total_dist_pct_ctrl") return ws.normalized ? ws.normalized.totalDistPctCtrl : null;
    if (metricKey === "norm_mean_dist_pct_ctrl") return ws.normalized ? ws.normalized.meanDistPctCtrl : null;
    if (metricKey === "norm_vmr_burst_pct_ctrl") return ws.normalized ? ws.normalized.vmrBurstPctCtrl : null;
    if (metricKey === "norm_window_auc_pct_ctrl") return ws.normalized ? ws.normalized.windowAucPctCtrl : null;
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
    const includeBom = Boolean(opts && opts.includeBom === true);
    const avail = getAvailablePrismMetrics(analysis);
    const key = metricKey || (avail[0] ? avail[0].id : "total_dist");
    const usePlates = (opts && opts.unitOfAnalysis)
      ? opts.unitOfAnalysis === "plates"
      : (analysis.nUnit === "plates" || analysis.unitOfAnalysis === "plates");

    const columns = analysis.groups.map(g => {
      const vals = [];
      if (usePlates && Array.isArray(g.plateMeans) && g.plateMeans.length > 0) {
        for (const pRow of g.plateMeans) {
          const v = extractWellMetricForPrism(pRow, key);
          if (v !== null && Number.isFinite(v)) vals.push(roundNum(v, 4));
        }
      } else {
        for (const w of g.wells) {
          const ws = (analysis.wellsByKey && analysis.wellsByKey[w]) || (analysis.wellsById && analysis.wellsById[w]);
          if (!ws || ws.excluded) continue;
          const v = extractWellMetricForPrism(ws, key);
          if (v !== null && Number.isFinite(v)) vals.push(v);
        }
      }
      return { name: g.group, vals };
    });

    const maxLen = columns.reduce((mx, c) => Math.max(mx, c.vals.length), 0);
    const lines = [columns.map(c => csvEscape(c.name, delimiter)).join(delimiter)];
    for (let r = 0; r < maxLen; r++) {
      const row = columns.map(c => (r < c.vals.length ? csvEscape(c.vals[r], delimiter) : ""));
      lines.push(row.join(delimiter));
    }
    const body = lines.join("\n") + "\n";
    return includeBom ? (UTF8_BOM + body) : body;
  }

  function buildPrismGroupedTsv(analysis, metricKey) {
    return buildPrismGroupedCsv(analysis, metricKey, { delimiter: "\t", includeBom: false });
  }

  // ---------------------------------------------------------------------------
  // 6b. Upgraded v2 Exporters (UTF-8 BOM, run_id/date, Factors, qc_reason,
  //     cleaning_log.txt, scipy.stats Python verification template)
  // ---------------------------------------------------------------------------
  function resolveExportPayload(payload) {
    const p = payload || {};
    const analysis = p.analysis || null;
    const scope = p.scope || (analysis && analysis.scope) || "active";
    let runs = Array.isArray(p.runs) ? p.runs.filter(Boolean) : [];
    if (runs.length === 0 && (p.parsed || p.summaryParsed)) {
      const sp = p.summaryParsed || p.parsed;
      const meta = inferRunMeta(p.filename || (sp && sp.filename), sp);
      runs = [{
        id: p.activeRunId || (analysis && analysis.activeRunId) || meta.runId,
        runId: p.runId || (analysis && analysis.runId) || meta.runId,
        date: p.date || (analysis && analysis.date) || meta.date,
        filename: p.filename || (sp && sp.filename) || "data.csv",
        summaryParsed: sp,
        zchangeParsed: p.zchangeParsed || p.zchange || null,
        xyParsed: p.xyParsed || p.xy || null,
        context: p.context || null,
        groups: p.groups || {},
        factorNames: p.factorNames || (analysis && analysis.factorNames) || [],
        wellFactors: p.wellFactors || p.factors || null,
        excludedWells: p.excludedWells || [],
        excludeMeta: p.excludeMeta || {}
      }];
    }
    const activeRunId = p.activeRunId || (analysis && analysis.activeRunId) || (runs[0] && (runs[0].id || runs[0].runId)) || null;
    const targetRuns = (scope === "pooled" && runs.length > 1)
      ? runs
      : (runs.length > 0 ? [runs.find(r => r.id === activeRunId || r.runId === activeRunId) || runs[0]] : []);

    const factorSet = new Set();
    for (const fn of (p.factorNames || (analysis && analysis.factorNames) || [])) {
      const clean = String(fn || "").trim();
      if (clean) factorSet.add(clean);
    }
    for (const r of targetRuns) {
      for (const fn of (r.factorNames || [])) {
        const clean = String(fn || "").trim();
        if (clean) factorSet.add(clean);
      }
    }
    const factorNames = [...factorSet];
    return { p, analysis, scope, runs, targetRuns, activeRunId, factorNames };
  }

  function exportTidyLongCsv(payload, opts) {
    const includeBom = !(opts && opts.includeBom === false);
    const { analysis, targetRuns, factorNames } = resolveExportPayload(payload);
    const summaryRuns = targetRuns.filter(r => (r.summaryParsed || r.parsed) && (r.summaryParsed || r.parsed).kind === "summary");
    if (summaryRuns.length === 0) return "";

    const anyDist = summaryRuns.some(r => { const s = r.summaryParsed || r.parsed; return s.hasDist || s.hasZoneDist; });
    const anyMsd = summaryRuns.some(r => (r.summaryParsed || r.parsed).hasMsd);
    const anyZones = summaryRuns.some(r => (r.summaryParsed || r.parsed).hasZones);
    const anyZD = summaryRuns.some(r => (r.summaryParsed || r.parsed).hasZoneDist);
    const anyZC = summaryRuns.some(r => (r.summaryParsed || r.parsed).hasZoneCount);
    const anyZT = summaryRuns.some(r => (r.summaryParsed || r.parsed).hasZoneTime);
    const maxZone = summaryRuns.reduce((m, r) => Math.max(m, (r.summaryParsed || r.parsed).maxZone || 0), 0);

    const header = [
      "run_id", "date", "runtime_s", "rel_time_s", "time_bin", "phase", "trial", "temp_c",
      "well", "group", ...factorNames, "excluded", "qc_status", "qc_reason"
    ];
    if (anyDist) header.push("dist_mm");
    if (anyMsd) header.push("msd");
    if (anyZones) {
      for (let z = 1; z <= maxZone; z++) {
        if (anyZD) header.push(`zd_z${z}_mm`);
        if (anyZC) header.push(`zc_z${z}`);
        if (anyZT) header.push(`zt_z${z}_s`);
      }
    }

    const lines = [header.map(h => csvEscape(h, ",")).join(",")];

    for (const run of summaryRuns) {
      const sp = run.summaryParsed || run.parsed;
      const inferred = inferRunMeta(run.filename || sp.filename, sp);
      const rId = run.runId || inferred.runId;
      const rDate = run.date || inferred.date;
      const runAnEntry = analysis && Array.isArray(analysis.runAnalyses)
        ? analysis.runAnalyses.find(x => x.id === run.id || x.runId === rId)
        : null;
      const runAn = runAnEntry ? runAnEntry.analysis : (summaryRuns.length === 1 ? analysis : null);
      const excl = normalizeExcludedSet(run.excludedWells);
      const wells = sp.wells;
      const rHasDist = sp.hasDist || sp.hasZoneDist;
      const qcLookup = (runAn && runAn.wellsById) ? runAn.wellsById : null;

      // NEVER mutate raw rows or drop excluded=TRUE rows!
      for (let i = 0; i < sp.rows.length; i++) {
        const row = sp.rows[i];
        for (let wi = 0; wi < wells.length; wi++) {
          const w = wells[wi];
          const ws = qcLookup ? qcLookup[w] : null;
          const grp = (ws && ws.group) || (run.groups && run.groups[w]) || "All Wells";
          const isExcl = (ws ? ws.excluded : excl.has(w.toUpperCase())) ? "TRUE" : "FALSE";
          const qcSt = (ws && ws.qcStatus) || (sp.qc && sp.qc[w] ? (sp.qc[w].qcStatus || sp.qc[w].status) : "ok");
          const qcRsn = (ws && ws.qcReason) || (sp.qc && sp.qc[w] ? (sp.qc[w].qcReason || "ok") : "ok");
          const fObj = (ws && ws.factors) || extractWellFactors(w, factorNames, run.wellFactors || run.factors);

          const cols = [
            rId, rDate, row.runtime, row.relTime, row.timeBin, row.phase || "",
            row.trial !== null ? row.trial : "", row.tempC !== null ? row.tempC : "",
            w, grp, ...factorNames.map(fn => fObj[fn] || ""),
            isExcl, qcSt, qcRsn
          ];
          if (anyDist) {
            const d = rHasDist ? extractRowMetricValue(row, w, "dist", sp) : null;
            cols.push(d !== null ? d.toFixed(3) : "");
          }
          if (anyMsd) {
            const m = (sp.hasMsd && row.msd) ? row.msd[w] : null;
            cols.push(m !== null ? m.toFixed(3) : "");
          }
          if (anyZones) {
            for (let z = 1; z <= maxZone; z++) {
              if (anyZD) cols.push((sp.hasZoneDist && row.zd && row.zd[w] && row.zd[w][z] !== null && row.zd[w][z] !== undefined) ? row.zd[w][z].toFixed(3) : "");
              if (anyZC) cols.push((sp.hasZoneCount && row.zc && row.zc[w] && row.zc[w][z] !== null && row.zc[w][z] !== undefined) ? row.zc[w][z] : "");
              if (anyZT) cols.push((sp.hasZoneTime && row.zt && row.zt[w] && row.zt[w][z] !== null && row.zt[w][z] !== undefined) ? row.zt[w][z].toFixed(3) : "");
            }
          }
          lines.push(cols.map(v => csvEscape(v, ",")).join(","));
        }
      }
    }

    const body = lines.join("\n") + "\n";
    return includeBom ? (UTF8_BOM + body) : body;
  }

  function exportWellSummaryCsv(payload, opts) {
    const includeBom = !(opts && opts.includeBom === false);
    const { analysis, factorNames } = resolveExportPayload(payload);
    if (!analysis || !Array.isArray(analysis.wells) || analysis.wells.length === 0) return "";

    const caps = analysis.capabilities || {};
    const phases = analysis.phases || [];
    const hasNorm = analysis.wells.some(ws => ws.normalized && ws.normalized.totalDistPctCtrl !== null);

    const header = [
      "run_id", "date", "well", "group", ...factorNames,
      "excluded", "qc_status", "qc_reason", "exclude_source",
      "active_bins", "spike_count", "total_dist_mm", "mean_dist_mm_bin", "mean_speed_mm_s"
    ];
    if (caps.hasMsd) header.push("mean_msd");
    if (caps.hasVmr) header.push("vmr_light_mean", "vmr_dark_mean", "vmr_dark_minus_light", "vmr_dark_onset_burst");
    if (caps.hasZones) {
      for (let z = 1; z <= caps.maxZone; z++) header.push(`z${z}_pct`);
      if (caps.maxZone >= 2) header.push("zone_preference_index");
    }
    if (caps.hasPpi) header.push("pulse_alone_mean", "ppi_trial_mean", "ppi_pct");
    else if (caps.hasStartle) header.push("baseline_mean", "startle_mean");
    if (caps.hasHabituation) header.push("habituation_index_pct");
    if (caps.hasWindowAuc) header.push("window_auc", "window_mean");
    if (caps.hasXy) header.push("xy_immobility_pct", "xy_mean_speed_mm_s", "xy_burst_p95_mm_s", "xy_center_pct", "xy_wall_dist_mm");
    if (caps.hasZchange) header.push("zchange_entries", "arm_entries", "sab_pct");
    if (hasNorm) {
      header.push("norm_total_dist_pct_ctrl", "norm_mean_dist_pct_ctrl");
      if (caps.hasVmr) header.push("norm_vmr_burst_pct_ctrl");
      if (caps.hasWindowAuc) header.push("norm_window_auc_pct_ctrl");
    }
    for (const ph of phases) {
      header.push(`phase_${ph.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}_mean_dist`);
    }

    const lines = [header.map(h => csvEscape(h, ",")).join(",")];
    for (const ws of analysis.wells) {
      const fObj = ws.factors || {};
      const row = [
        ws.runId || analysis.runId || "Run_1",
        ws.date || analysis.date || "",
        ws.well,
        ws.group,
        ...factorNames.map(fn => fObj[fn] || ""),
        ws.excluded ? "TRUE" : "FALSE",
        ws.qcStatus || (ws.qc ? ws.qc.status : "ok"),
        ws.qcReason || (ws.qc ? ws.qc.qcReason : "ok"),
        ws.excludeSource || "",
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
        if (caps.maxZone >= 2) row.push(ws.zones && ws.zones.preferenceIndex !== null ? ws.zones.preferenceIndex : "");
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
          ws.startle && ws.startle.stimMean !== null ? ws.startle.stimMean : ""
        );
      }
      if (caps.hasHabituation) {
        row.push(ws.habituation && ws.habituation.habituationIndex !== null ? ws.habituation.habituationIndex : "");
      }
      if (caps.hasWindowAuc) {
        row.push(
          ws.windowAuc && ws.windowAuc.auc !== null ? ws.windowAuc.auc : "",
          ws.windowAuc && ws.windowAuc.mean !== null ? ws.windowAuc.mean : ""
        );
      }
      if (caps.hasXy) {
        row.push(
          ws.xy && ws.xy.immobilityPct !== null ? ws.xy.immobilityPct : "",
          ws.xy && ws.xy.meanSpeedMmS !== null ? ws.xy.meanSpeedMmS : "",
          ws.xy && ws.xy.burstSpeedP95MmS !== null ? ws.xy.burstSpeedP95MmS : "",
          ws.xy && ws.xy.centerOccupancyPct !== null ? ws.xy.centerOccupancyPct : "",
          ws.xy && ws.xy.meanWallDistMm !== null ? ws.xy.meanWallDistMm : ""
        );
      }
      if (caps.hasZchange) {
        row.push(
          ws.zchange ? ws.zchange.totalEntries : "",
          ws.zchange ? ws.zchange.armEntries : "",
          ws.zchange && ws.zchange.sabPct !== null ? ws.zchange.sabPct : ""
        );
      }
      if (hasNorm) {
        row.push(
          ws.normalized && ws.normalized.totalDistPctCtrl !== null ? ws.normalized.totalDistPctCtrl : "",
          ws.normalized && ws.normalized.meanDistPctCtrl !== null ? ws.normalized.meanDistPctCtrl : ""
        );
        if (caps.hasVmr) row.push(ws.normalized && ws.normalized.vmrBurstPctCtrl !== null ? ws.normalized.vmrBurstPctCtrl : "");
        if (caps.hasWindowAuc) row.push(ws.normalized && ws.normalized.windowAucPctCtrl !== null ? ws.normalized.windowAucPctCtrl : "");
      }
      for (const ph of phases) {
        const pd = ws.phaseDist && ws.phaseDist[ph];
        row.push(pd && pd.mean !== null ? pd.mean : "");
      }
      lines.push(row.map(v => csvEscape(v, ",")).join(","));
    }

    const body = lines.join("\n") + "\n";
    return includeBom ? (UTF8_BOM + body) : body;
  }

  function exportPrismGroupedCsv(payload, metricKey, opts) {
    const analysis = (payload && payload.analysis) ? payload.analysis : payload;
    const key = metricKey || (payload && payload.metricKey) || undefined;
    const includeBom = !(opts && opts.includeBom === false);
    const delimiter = (opts && opts.delimiter) || ",";
    const unitOfAnalysis = (opts && opts.unitOfAnalysis) || (payload && payload.unitOfAnalysis) || undefined;
    return buildPrismGroupedCsv(analysis, key, { delimiter, includeBom, unitOfAnalysis });
  }

  function exportPrismGroupedTsv(payload, metricKey) {
    return exportPrismGroupedCsv(payload, metricKey, { delimiter: "\t", includeBom: false });
  }

  function exportCleaningLogTxt(payload) {
    const { p, analysis, scope, targetRuns, factorNames } = resolveExportPayload(payload);
    const isoNow = (p && p.timestampIso) || new Date().toISOString();
    const qcTh = (analysis && analysis.qcThresholds) || normalizeQcThresholds(p.qcThresholds, null);
    const trim = (analysis && analysis.trimInfo) || null;
    const winAuc = (analysis && analysis.windowAucConfig) || p.windowAuc || null;
    const pooledMeta = (analysis && analysis.pooledMeta) || null;
    const primaryTestFamily = (p && p.primaryTestFamily === "nonparametric") ? "nonparametric" : "parametric";
    const unitOfAnalysis = (p && p.unitOfAnalysis === "plates")
      ? "plates"
      : ((analysis && (analysis.nUnit || analysis.unitOfAnalysis)) || (pooledMeta && pooledMeta.nUnit) || "wells");
    const effectiveUnit = (scope === "pooled" && targetRuns.length > 1 && unitOfAnalysis === "plates") ? "plates" : "wells";

    // Build per-run excludeMeta lookup so afterStatsViewed works even if payload only passed it on runs
    const runExcludeMetaByRunId = new Map();
    for (const r of targetRuns) {
      const sp = r.summaryParsed || r.parsed;
      const meta = inferRunMeta(r.filename || (sp && sp.filename), sp);
      const rId = r.runId || meta.runId;
      if (r.excludeMeta && typeof r.excludeMeta === "object") {
        runExcludeMetaByRunId.set(rId, r.excludeMeta);
      }
    }

    const lines = [
      "======================================================================",
      "ZANTIKS MWP DATA CLEANING, QC & PRE-PROCESSING AUDIT LOG",
      "======================================================================",
      `Software         : Zanscript-Builder CSV Analyzer v${ANALYZER_VERSION}`,
      `Generated (UTC)  : ${isoNow}`,
      `Analysis Scope   : ${scope === "pooled" ? `Pooled (${targetRuns.length} runs)` : "Active single run"}`,
      `Unit of Analysis : ${effectiveUnit === "plates" ? "Plate Means (n = plates, biological replicates)" : "Individual Wells (n = wells)"}`,
      ""
    ];

    lines.push("1. INPUT RUNS & EXPERIMENT CONTEXT");
    lines.push("----------------------------------------------------------------------");
    if (targetRuns.length === 0) {
      lines.push("  (No input runs loaded)");
    } else {
      for (let i = 0; i < targetRuns.length; i++) {
        const r = targetRuns[i];
        const sp = r.summaryParsed || r.parsed;
        const meta = inferRunMeta(r.filename || (sp && sp.filename), sp);
        const rId = r.runId || meta.runId;
        const rDate = r.date || meta.date;
        const ctx = r.context || null;
        lines.push(`  Run ${i + 1}: ${rId}  |  Date: ${rDate}`);
        lines.push(`    Summary CSV  : ${r.filename || (sp && sp.filename) || "(none)"}${sp ? ` (${sp.rowCount} rows, ${sp.wells.length} wells, bin=${sp.binDurationSec}s, duration=${formatDuration(sp.durationSec)})` : ""}`);
        if (r.zchangeParsed || r.zchange) {
          const zc = r.zchangeParsed || r.zchange;
          lines.push(`    _ZCHANGE CSV : ${zc.filename || "loaded"} (${zc.rowCount} events, Z1..Z${zc.maxZone})`);
        }
        if (r.xyParsed || r.xy) {
          const xy = r.xyParsed || r.xy;
          lines.push(`    _XY CSV      : ${xy.filename || "loaded"} (${xy.rowCount} frames, ~${xy.estimatedFps || "?"} Hz)`);
        }
        if (ctx && ctx.valid) {
          lines.push(`    Context      : ${ctx.plateName} | ${ctx.stimName} | ${ctx.organismLabel} | Target Temp=${ctx.targetTempC != null ? ctx.targetTempC + " C" : "off"} (source: ${ctx.source})`);
        } else {
          lines.push("    Context      : None (inferred directly from CSV headers)");
        }
      }
      if (pooledMeta && pooledMeta.hasMixedLayouts) {
        lines.push(`  Layout Summary : ${pooledMeta.layoutSummary}`);
      }
    }

    lines.push("");
    lines.push("2. QC THRESHOLDS & PRE-PROCESSING SETTINGS");
    lines.push("----------------------------------------------------------------------");
    lines.push(`  Organism QC Preset : ${qcTh.label} (${qcTh.presetId || qcTh.id})`);
    lines.push(`  Empty Well Rule    : totalDist < ${qcTh.emptyDistMm} mm OR activeBins = 0`);
    lines.push(`  Spike Glitch Rule  : binDist > max(${qcTh.spikeMinMm} mm, median + ${qcTh.spikeMadMult} * MAD) OR speed > ${qcTh.spikeMaxSpeedMmS} mm/s`);
    lines.push(`  Time Trim Window   : ${trim && trim.active ? `${trim.trimStartSec ?? 0}s to ${trim.trimEndSec ?? trim.originalDurationSec}s (kept ${trim.keptRows}/${trim.originalRows} rows; raw CSV unmutated)` : "None (full recording kept)"}`);
    if (winAuc) {
      lines.push(`  Custom AUC Window  : ${winAuc.startSec}s to ${winAuc.endSec}s (trapezoidal integration)`);
    }
    if (factorNames.length > 0) {
      lines.push(`  Factor Columns     : ${factorNames.join(", ")}`);
    }
    if (pooledMeta && pooledMeta.normalizeToControl) {
      lines.push(`  Batch Normalization: Per-run % of Control (Control group = "${pooledMeta.controlGroupName}")`);
      if (pooledMeta.batchDiagnostics && pooledMeta.batchDiagnostics.perRun) {
        for (const pr of pooledMeta.batchDiagnostics.perRun) {
          lines.push(`    - ${pr.runId} (${pr.date}): Control mean totalDist = ${pr.controlTotalDist ?? "N/A"} mm (n=${pr.controlN})`);
        }
      }
    }

    lines.push("");
    lines.push("3. PER-RUN WELL EXCLUSION & QC ANOMALY AUDIT");
    lines.push("----------------------------------------------------------------------");
    const allWells = (analysis && Array.isArray(analysis.wells)) ? analysis.wells : [];
    const byRun = new Map();
    for (const ws of allWells) {
      const k = ws.runId || (analysis && analysis.runId) || "Run_1";
      if (!byRun.has(k)) byRun.set(k, []);
      byRun.get(k).push(ws);
    }

    let grandTotal = 0;
    let grandIncluded = 0;
    let grandAutoExcl = 0;
    let grandManualExcl = 0;
    let grandFlaggedKept = 0;
    let grandPostStatsExcl = 0;

    const getPostStatsFlag = (rId, ws) => {
      if (ws.afterStatsViewed) return { flagged: true, at: ws.afterStatsAt || null };
      const rm = runExcludeMetaByRunId.get(rId) || (p && p.excludeMeta) || null;
      const entry = rm && rm[ws.well];
      if (entry && entry.afterStatsViewed) {
        return { flagged: true, at: entry.afterStatsAt ? String(entry.afterStatsAt) : null };
      }
      return { flagged: false, at: null };
    };

    for (const [rId, wList] of byRun.entries()) {
      const autoExcl = wList.filter(ws => ws.excluded && ws.excludeSource === "auto");
      const manualExcl = wList.filter(ws => ws.excluded && ws.excludeSource !== "auto");
      const flaggedKept = wList.filter(ws => !ws.excluded && ws.qc && (ws.qc.isEmpty || ws.qc.isSpikeGlitch));
      const incCount = wList.length - autoExcl.length - manualExcl.length;
      const runPostStatsCount = wList.filter(ws => ws.excluded && getPostStatsFlag(rId, ws).flagged).length;

      grandTotal += wList.length;
      grandIncluded += incCount;
      grandAutoExcl += autoExcl.length;
      grandManualExcl += manualExcl.length;
      grandFlaggedKept += flaggedKept.length;
      grandPostStatsExcl += runPostStatsCount;

      lines.push(
        `  [${rId}] Total: ${wList.length} | Included: ${incCount} | Auto-excluded: ${autoExcl.length} | ` +
        `Manually-excluded: ${manualExcl.length} | Flagged-but-kept: ${flaggedKept.length}` +
        (runPostStatsCount > 0 ? ` | Post-stats exclusions: ${runPostStatsCount}` : "")
      );

      if (autoExcl.length > 0) {
        lines.push("    Auto-excluded wells:");
        for (const ws of autoExcl) {
          const ps = getPostStatsFlag(rId, ws);
          const tag = ps.flagged ? ` [EXCLUDED AFTER VIEWING STATS${ps.at ? ` @ ${ps.at}` : ""}]` : "";
          lines.push(`      - ${ws.well} (${ws.group}): ${ws.qcReason} [${ws.qc ? ws.qc.evidence : ""}]${tag}`);
        }
      }
      if (manualExcl.length > 0) {
        lines.push("    Manually-excluded wells:");
        for (const ws of manualExcl) {
          const ev = ws.qc ? ws.qc.evidence : "";
          const ps = getPostStatsFlag(rId, ws);
          const tag = ps.flagged ? ` [EXCLUDED AFTER VIEWING STATS${ps.at ? ` @ ${ps.at}` : ""}]` : "";
          lines.push(`      - ${ws.well} (${ws.group}): ${ws.excludeReason || "manual_exclusion"} [${ev}]${tag}`);
        }
      }
      if (flaggedKept.length > 0) {
        lines.push("    Auto-flagged wells KEPT by analyst:");
        for (const ws of flaggedKept) {
          lines.push(`      - ${ws.well} (${ws.group}): ${ws.qcReason} [${ws.qc ? ws.qc.evidence : ""}]`);
        }
      }
      if (autoExcl.length === 0 && manualExcl.length === 0 && flaggedKept.length === 0) {
        lines.push("    All wells passed QC and were included.");
      }
    }
    lines.push(`  Post-stats exclusions total : ${grandPostStatsExcl}${grandPostStatsExcl > 0 ? "  [WARNING: wells excluded after viewing screening statistics should be explicitly disclosed]" : " (all exclusions finalized prior to viewing stats)"}`);

    lines.push("");
    lines.push("4. SCREENING STATISTICS & PARAMETER SNAPSHOT");
    lines.push("----------------------------------------------------------------------");
    lines.push(`  Primary Test Family : ${primaryTestFamily === "nonparametric" ? "Non-Parametric (Mann-Whitney U / Kruskal-Wallis + Holm-Bonferroni)" : "Parametric (Welch's t-test / One-way ANOVA + Holm-Bonferroni Welch)"}`);
    lines.push("  Exact / Approx Rule : Mann-Whitney U uses exact BigInt DP when no ties & n1, n2 <= 25 (else asymptotic w/ continuity & tie corr);");
    lines.push("                        Wilcoxon signed-rank uses exact BigInt DP when no tied |d| & 1 <= n_nz <= 50 (else approx w/ continuity & tie corr).");
    lines.push(`  Unit of Analysis    : ${effectiveUnit === "plates" ? "Plate Means (n = plates, biological replicates)" : "Individual Wells (n = wells)"}`);
    lines.push(`  Batch Normalization : ${pooledMeta && pooledMeta.normalizeToControl ? `Per-run % of Control ("${pooledMeta.controlGroupName}")` : "Off (raw metric units)"}`);
    lines.push(`  Trim / AUC Windows  : Trim=${trim && trim.active ? `${trim.trimStartSec ?? 0}-${trim.trimEndSec ?? trim.originalDurationSec}s` : "Off"} | Custom AUC=${winAuc ? `${winAuc.startSec}-${winAuc.endSec}s` : "Off"}`);
    if (factorNames.length >= 2) {
      lines.push(`  Multi-Factor Notice : ${factorNames.join(" x ")} detected — one-way screening does not test main effects or interactions; verify with Two-Way ANOVA / Mixed Model.`);
    }
    if (scope === "pooled" && targetRuns.length > 1 && effectiveUnit === "wells") {
      lines.push(`  Replicate Notice    : Pooled well-level view (n = wells across ${targetRuns.length} plates). Switch to Plate Means (n = plates) or use a mixed-effects model for plate-level inference.`);
    }

    const rawSnap = p && p.statsSnapshot;
    const snapResult = (rawSnap && rawSnap.result) ? rawSnap.result : rawSnap;
    const snapMetric = (rawSnap && rawSnap.metricLabel) || (p && p.statsMetricLabel) || null;
    if (snapResult && typeof snapResult === "object") {
      if (snapMetric) lines.push(`  Screened Metric     : ${snapMetric}`);
      if (snapResult.valid) {
        const primRow = (snapResult.summaryRows && snapResult.summaryRows[0]) || null;
        const ccRow = (snapResult.crossCheckRows && snapResult.crossCheckRows[0]) || null;
        if (primRow) {
          lines.push(`  Primary Result      : ${primRow.test} | ${primRow.stat} | p = ${formatPVal(primRow.p)} (${primRow.sig}) | ${primRow.effect}`);
        }
        if (ccRow) {
          lines.push(`  Cross-Check Result  : ${ccRow.test} | ${ccRow.stat} | p = ${formatPVal(ccRow.p)} (${ccRow.sig}) | ${ccRow.effect}`);
        }
        if (Array.isArray(snapResult.pairwise) && snapResult.pairwise.length > 0 && snapResult.kind === "multi_group") {
          lines.push("  Pairwise Comparisons (Holm-Bonferroni adjusted):");
          for (const pr of snapResult.pairwise) {
            const statTxt = pr.t !== undefined && pr.t !== null
              ? `t(${formatStatNum(pr.df, 2)})=${formatStatNum(pr.t, 3)}`
              : (pr.U !== undefined && pr.U !== null ? `U=${formatStatNum(pr.U, 2)}` : "—");
            lines.push(`    - ${pr.groupA} vs ${pr.groupB}: ${statTxt}, p_raw=${formatPVal(pr.p)}, p_holm=${formatPVal(pr.pAdj)} (${pr.sig})`);
          }
        }
      } else if (snapResult.reason) {
        lines.push(`  Screening Status    : ${snapResult.reason}`);
      }
    } else {
      lines.push("  Screened Metric     : (No screening statistics snapshot passed at export time)");
    }

    lines.push("");
    lines.push("5. METHODS SUMMARY DRAFT");
    lines.push("----------------------------------------------------------------------");
    const exclTotal = grandAutoExcl + grandManualExcl;
    const normSentence = (pooledMeta && pooledMeta.normalizeToControl)
      ? ` To correct for inter-plate baseline drift across ${targetRuns.length} runs, well-level metrics were normalized per run to percentage of the "${pooledMeta.controlGroupName}" group mean.`
      : "";
    const unitSentence = effectiveUnit === "plates"
      ? ` Pooled multi-plate comparisons were aggregated to per-plate group means (n = biological replicate plates).`
      : "";
    const postStatsSentence = grandPostStatsExcl > 0
      ? ` Note: ${grandPostStatsExcl} well exclusion(s) were recorded after viewing screening statistics and are flagged in Section 3.`
      : "";
    const testFamilySentence = primaryTestFamily === "nonparametric"
      ? " Exploratory group screening used non-parametric tests (exact/asymptotic Mann-Whitney U for 2 groups; Kruskal-Wallis with Holm-Bonferroni pairwise Mann-Whitney U for >=3 groups)."
      : " Exploratory group screening used parametric tests (Welch's t-test for 2 groups; one-way ANOVA with Holm-Bonferroni pairwise Welch's t-tests for >=3 groups).";
    lines.push(
      `  Raw Zantiks MWP behavioral CSV exports were inspected and cleaned using Zanscript-Builder CSV Analyzer v${ANALYZER_VERSION} ` +
      `(${qcTh.label} QC preset: empty well < ${qcTh.emptyDistMm} mm total distance; tracking spike > max(${qcTh.spikeMinMm} mm, median + ${qcTh.spikeMadMult}*MAD) or > ${qcTh.spikeMaxSpeedMmS} mm/s). ` +
      `Across ${targetRuns.length} run(s) (${grandTotal} total wells), ${exclTotal} well(s) were excluded (${grandAutoExcl} auto-flagged, ${grandManualExcl} manual) and ${grandIncluded} well(s) were retained for analysis.` +
      normSentence + unitSentence + testFamilySentence + postStatsSentence
    );
    lines.push("");

    return lines.join("\n");
  }

  function exportPythonScript(payload) {
    const { p, analysis, scope, targetRuns, factorNames } = resolveExportPayload(payload);
    const caps = (analysis && analysis.capabilities) || {};
    const pooledMeta = (analysis && analysis.pooledMeta) || null;
    const primaryTestFamily = (p && p.primaryTestFamily === "nonparametric") ? "nonparametric" : "parametric";
    const unitOfAnalysis = (p && p.unitOfAnalysis === "plates")
      ? "plates"
      : ((analysis && (analysis.nUnit || analysis.unitOfAnalysis)) || (pooledMeta && pooledMeta.nUnit) || "wells");
    const effectiveUnit = (scope === "pooled" && targetRuns.length > 1 && unitOfAnalysis === "plates") ? "plates" : "wells";

    const primaryRun = targetRuns[0] || null;
    const fname = (primaryRun && (primaryRun.filename || (primaryRun.summaryParsed && primaryRun.summaryParsed.filename))) ||
      (p.parsed && p.parsed.filename) || "zantiks_well_summary.csv";
    const summaryCsvName = fname.replace(/\.csv$/i, "") + "_well_summary.csv";
    const tidyCsvName = fname.replace(/\.csv$/i, "") + "_tidy_long.csv";
    const metricCol = (pooledMeta && pooledMeta.normalizeToControl)
      ? "norm_total_dist_pct_ctrl"
      : (caps.hasPpi ? "ppi_pct" : (caps.hasSab ? "sab_pct" : (caps.hasDist ? "total_dist_mm" : "mean_msd")));
    const metricLabel = (pooledMeta && pooledMeta.normalizeToControl)
      ? `Total Distance (% of ${pooledMeta.controlGroupName})`
      : (caps.hasPpi ? "Prepulse Inhibition (% PPI)" : (caps.hasSab ? "Spontaneous Alternation (SAB %)" : "Total Distance (mm)"));
    const qcTh = (analysis && analysis.qcThresholds) || ORGANISM_QC_PRESETS.default;
    const isPooled = scope === "pooled" && targetRuns.length > 1;
    const wellsList = (analysis && Array.isArray(analysis.wells)) ? analysis.wells : [];
    const groupDictLines = [];
    const excludedList = [];
    for (const ws of wellsList) {
      const k = isPooled ? (ws.wellKey || `${ws.runId}:${ws.well}`) : ws.well;
      groupDictLines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(ws.group)},`);
      if (ws.excluded) excludedList.push(JSON.stringify(k));
    }

    const twoWayAnovaBlock = factorNames.length >= 2 ? [
      "",
      "",
      "def run_two_way_anova(df_inc: pd.DataFrame, metric_col: str) -> None:",
      '    """Two-Way ANOVA (Type II SS) for multi-factor designs via statsmodels."""',
      "    f1, f2 = FACTOR_NAMES[0], FACTOR_NAMES[1]",
      "    if f1 not in df_inc.columns or f2 not in df_inc.columns:",
      "        return",
      "    sub = df_inc[[metric_col, f1, f2]].dropna().copy()",
      "    if len(sub) < 4:",
      "        return",
      "    print(f'\\n=== Two-Way ANOVA: {metric_col} ~ C({f1}) * C({f2}) ===')",
      "    try:",
      "        import statsmodels.api as sm",
      "        from statsmodels.formula.api import ols",
      "        formula = f'Q(\"{metric_col}\") ~ C(Q(\"{f1}\")) * C(Q(\"{f2}\"))'",
      "        model = ols(formula, data=sub).fit()",
      "        table = sm.stats.anova_lm(model, typ=2)",
      "        print(table)",
      "    except ImportError:",
      "        print('Install statsmodels (`pip install statsmodels`) to run Two-Way ANOVA (main effects + interaction).')"
    ] : [];

    const twoWayAnovaCall = factorNames.length >= 2
      ? ["    run_two_way_anova(inc_df, metric_col)"]
      : [];

    return [
      "#!/usr/bin/env python3",
      '"""',
      "Zantiks MWP Reproducible Analysis & scipy.stats Verification Script",
      `Generated by Zanscript-Builder CSV Analyzer v${ANALYZER_VERSION}`,
      `Scope: ${isPooled ? `Pooled (${targetRuns.length} runs)` : "Single run"} | Unit: ${effectiveUnit} | Primary: ${primaryTestFamily} | QC Preset: ${qcTh.label}`,
      '"""',
      "",
      "from itertools import combinations",
      "import numpy as np",
      "import pandas as pd",
      "from scipy import stats",
      "import matplotlib.pyplot as plt",
      "",
      `SUMMARY_CSV = ${JSON.stringify(summaryCsvName)}`,
      `TIDY_CSV = ${JSON.stringify(tidyCsvName)}`,
      `PRIMARY_METRIC = ${JSON.stringify(metricCol)}`,
      `PRIMARY_LABEL = ${JSON.stringify(metricLabel)}`,
      `PRIMARY_TEST_FAMILY = ${JSON.stringify(primaryTestFamily)}`,
      `UNIT_OF_ANALYSIS = ${JSON.stringify(effectiveUnit)}`,
      `FACTOR_NAMES = ${JSON.stringify(factorNames)}`,
      "",
      "WELL_GROUPS = {",
      ...groupDictLines,
      "}",
      `EXCLUDED_WELLS = {${excludedList.join(", ")}}`,
      "",
      "",
      "def has_ties(values) -> bool:",
      '    """Return True if an array contains any duplicate finite values."""',
      "    arr = np.asarray(values, dtype=float)",
      "    return len(np.unique(arr)) < len(arr)",
      "",
      "",
      "def run_mann_whitney(v1, v2):",
      '    """Exact-parity Mann-Whitney U matching Zanscript-Builder JS (exact when no ties & n1, n2 <= 25)."""',
      "    a = np.asarray(v1, dtype=float)",
      "    b = np.asarray(v2, dtype=float)",
      "    combined = np.concatenate([a, b])",
      "    method = 'exact' if (not has_ties(combined) and len(a) <= 25 and len(b) <= 25) else 'asymptotic'",
      "    res = stats.mannwhitneyu(a, b, alternative='two-sided', use_continuity=True, method=method)",
      "    u_stat = float(min(res.statistic, len(a) * len(b) - res.statistic))",
      "    return u_stat, float(res.pvalue), method",
      "",
      "",
      "def run_paired_wilcoxon(x, y):",
      '    """Exact-parity Wilcoxon signed-rank matching Zanscript-Builder JS (exact when no tied |d| & n_nz <= 50)."""',
      "    a = np.asarray(x, dtype=float)",
      "    b = np.asarray(y, dtype=float)",
      "    diffs = a - b",
      "    nz = diffs[np.abs(diffs) > 1e-12]",
      "    if len(nz) == 0:",
      "        return 0.0, 1.0, 'none'",
      "    method = 'exact' if (not has_ties(np.abs(nz)) and len(nz) <= 50) else 'approx'",
      "    res = stats.wilcoxon(a, b, alternative='two-sided', zero_method='wilcox', correction=True, method=method)",
      "    return float(res.statistic), float(res.pvalue), method",
      "",
      "",
      "def holm_bonferroni(p_values):",
      '    """Apply Holm-Bonferroni step-down adjustment to a list of raw p-values."""',
      "    m = len(p_values)",
      "    safe_ps = [float(p) if (p is not None and np.isfinite(p)) else 1.0 for p in p_values]",
      "    order = np.argsort(safe_ps)",
      "    adjusted = [None] * m",
      "    running_max = 0.0",
      "    for rank, idx in enumerate(order):",
      "        raw = p_values[idx]",
      "        if raw is None or not np.isfinite(raw):",
      "            adjusted[idx] = float('nan')",
      "            continue",
      "        p_step = min(1.0, float(raw) * (m - rank))",
      "        running_max = max(running_max, p_step)",
      "        adjusted[idx] = running_max",
      "    return adjusted",
      "",
      "",
      "def run_screening_stats(df_inc: pd.DataFrame, metric_col: str) -> None:",
      '    """Verify browser screening statistics using scipy.stats with exact parity settings."""',
      "    work_df = df_inc",
      "    n_unit_label = 'wells'",
      "    if UNIT_OF_ANALYSIS == 'plates' and 'run_id' in df_inc.columns and df_inc['run_id'].nunique() > 1:",
      "        work_df = df_inc.groupby(['run_id', 'group'], sort=False)[metric_col].mean().reset_index()",
      "        n_unit_label = 'plates'",
      "",
      "    grouped = [(grp, sub[metric_col].dropna().to_numpy(dtype=float))",
      "               for grp, sub in work_df.groupby('group', sort=False)]",
      "    grouped = [(g, vals) for g, vals in grouped if len(vals) >= 2]",
      "    if len(grouped) < 2:",
      "        print(f'Need at least 2 groups with n >= 2 {n_unit_label} for statistical testing.')",
      "        return",
      "",
      "    print(f'\\n=== scipy.stats Verification ({metric_col} | unit={n_unit_label} | primary={PRIMARY_TEST_FAMILY}) ===')",
      "    if len(grouped) == 2:",
      "        (g1, v1), (g2, v2) = grouped",
      "        t_res = stats.ttest_ind(v1, v2, equal_var=False)",
      "        u_stat, u_p, u_method = run_mann_whitney(v1, v2)",
      "        print(f\"Welch's t-test ({g1} vs {g2}): t = {t_res.statistic:.6f}, p = {t_res.pvalue:.10g}\")",
      "        print(f\"Mann-Whitney U [{u_method}] ({g1} vs {g2}): U = {u_stat:.2f}, p = {u_p:.10g}\")",
      "    else:",
      "        arrays = [vals for _, vals in grouped]",
      "        f_stat, f_p = stats.f_oneway(*arrays)",
      "        h_stat, h_p = stats.kruskal(*arrays)",
      "        print(f'One-way ANOVA:   F = {f_stat:.6f}, p = {f_p:.10g}')",
      "        print(f'Kruskal-Wallis:  H = {h_stat:.6f}, p = {h_p:.10g}')",
      "        pairs = list(combinations(grouped, 2))",
      "        if PRIMARY_TEST_FAMILY == 'nonparametric':",
      "            raw_ps = []",
      "            pair_rows = []",
      "            for (g1, v1), (g2, v2) in pairs:",
      "                u_stat, u_p, u_method = run_mann_whitney(v1, v2)",
      "                raw_ps.append(u_p)",
      "                pair_rows.append((g1, g2, u_stat, u_p, u_method))",
      "            adj_ps = holm_bonferroni(raw_ps)",
      "            print('Pairwise Mann-Whitney U (Holm-Bonferroni adjusted):')",
      "            for (g1, g2, u_val, p_raw, u_method), p_adj in zip(pair_rows, adj_ps):",
      "                print(f'  {g1} vs {g2} [{u_method}]: U = {u_val:.2f}, p_raw = {p_raw:.10g}, p_holm = {p_adj:.10g}')",
      "        else:",
      "            raw_ps = []",
      "            pair_rows = []",
      "            for (g1, v1), (g2, v2) in pairs:",
      "                res = stats.ttest_ind(v1, v2, equal_var=False)",
      "                raw_ps.append(float(res.pvalue))",
      "                pair_rows.append((g1, g2, float(res.statistic), float(res.pvalue)))",
      "            adj_ps = holm_bonferroni(raw_ps)",
      "            print('Pairwise Welch t-tests (Holm-Bonferroni adjusted):')",
      "            for (g1, g2, t_val, p_raw), p_adj in zip(pair_rows, adj_ps):",
      "                print(f'  {g1} vs {g2}: t = {t_val:.6f}, p_raw = {p_raw:.10g}, p_holm = {p_adj:.10g}')",
      ...twoWayAnovaBlock,
      "",
      "",
      "def main() -> None:",
      "    # Load UTF-8-BOM CSV exported from Zanscript-Builder CSV Analyzer",
      "    summary_df = pd.read_csv(SUMMARY_CSV, encoding='utf-8-sig')",
      "    excl_mask = summary_df['excluded'].astype(str).str.upper().eq('TRUE')",
      "",
      "    print('=== QC Audit Summary ===')",
      "    print(f'Total wells: {len(summary_df)} | Included: {(~excl_mask).sum()} | Excluded: {excl_mask.sum()}')",
      "    if 'run_id' in summary_df.columns:",
      "        print('Runs:', summary_df['run_id'].unique().tolist())",
      "    if 'qc_reason' in summary_df.columns:",
      "        print('QC reason counts:\\n', summary_df['qc_reason'].value_counts().to_string())",
      "",
      "    inc_df = summary_df[~excl_mask].copy()",
      "    metric_col = PRIMARY_METRIC if PRIMARY_METRIC in inc_df.columns else 'total_dist_mm'",
      "    print(f'\\nGroup Summary ({metric_col}):')",
      "    print(inc_df.groupby('group')[metric_col].agg(['count', 'mean', 'std', 'sem']))",
      "    if FACTOR_NAMES and all(f in inc_df.columns for f in FACTOR_NAMES):",
      "        print(f'\\nFactor Breakdown ({FACTOR_NAMES}):')",
      "        print(inc_df.groupby(FACTOR_NAMES)[metric_col].agg(['count', 'mean', 'sem']))",
      "",
      "    run_screening_stats(inc_df, metric_col)",
      ...twoWayAnovaCall,
      "",
      "    # Optional: load tidy long CSV for time-series plotting",
      "    try:",
      "        tidy_df = pd.read_csv(TIDY_CSV, encoding='utf-8-sig')",
      "        tidy_inc = tidy_df[~tidy_df['excluded'].astype(str).str.upper().eq('TRUE')].copy()",
      "        val_col = 'dist_mm' if 'dist_mm' in tidy_inc.columns else 'msd'",
      "        ts = tidy_inc.groupby(['group', 'rel_time_s'])[val_col].agg(['mean', 'sem']).reset_index()",
      "        fig, ax = plt.subplots(figsize=(10, 4.5), dpi=150)",
      "        for grp, gdf in ts.groupby('group', sort=False):",
      "            ax.plot(gdf['rel_time_s'], gdf['mean'], linewidth=2, label=grp)",
      "            ax.fill_between(gdf['rel_time_s'], gdf['mean'] - gdf['sem'], gdf['mean'] + gdf['sem'], alpha=0.2)",
      "        ax.set_xlabel('Elapsed Time (s)')",
      "        ax.set_ylabel(val_col)",
      "        ax.set_title('Zantiks MWP Group Time Series (Mean +/- SEM)')",
      "        ax.legend(frameon=False)",
      "        ax.spines['top'].set_visible(False)",
      "        ax.spines['right'].set_visible(False)",
      "        fig.tight_layout()",
      "        fig.savefig('zantiks_timeseries.png', dpi=200)",
      "        print('\\nSaved zantiks_timeseries.png')",
      "    except FileNotFoundError:",
      "        print(f'\\nNote: Place {TIDY_CSV} in this folder to also render zantiks_timeseries.png.')",
      "",
      "",
      'if __name__ == "__main__":',
      "    main()",
      ""
    ].join("\n");
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
    ANALYZER_VERSION,
    UTF8_BOM,
    GROUP_PALETTE,
    SBS_W_MM,
    SBS_H_MM,
    ORGANISM_QC_PRESETS,
    ORGANISM_QC_PRESET_LIST,
    getOrganismQcPreset,
    normalizeQcThresholds,
    recomputeWellQc,
    inferRunMeta,
    extractWellFactors,
    synthesizeGroupsFromFactors,
    formatDuration,
    getPlateLayout,
    getAvailablePrismMetrics,
    extractWellMetricForPrism,
    parseZantiksCsv,
    parseExperimentContext,
    loadContextFromZip,
    loadLatestBuilderContext,
    getDemoPresets,
    generateDemoDataset,
    analyzeXyData,
    computeAnalysis,
    analyzePooledRuns,
    stats,
    // Legacy v1 exporters (100% backward compatible)
    buildTidyLongCsv,
    buildWellSummaryCsv,
    buildPrismGroupedCsv,
    buildPrismGroupedTsv,
    buildPythonTemplate,
    // Upgraded v2 exporters (UTF-8 BOM default, multi-run, factors, qc_reason, cleaning_log.txt, scipy Python)
    exportTidyLongCsv,
    exportWellSummaryCsv,
    exportPrismGroupedCsv,
    exportPrismGroupedTsv,
    exportCleaningLogTxt,
    exportPythonScript
  };

  global.ZANTIKS_ANALYZER_CORE = API;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
})(typeof window !== "undefined" ? window : globalThis);
