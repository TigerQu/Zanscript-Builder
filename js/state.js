// Zantiks MWP Script Builder - Application state and plate-config store (browser storage + zantiks_plate_config.js)
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 2. Application State & Plate Config Store
// ---------------------------------------------------------------------------
function cloneDefaultGeometries() {
  const out = {};
  for (const key of Object.keys(FACTORY_PLATES)) {
    const f = FACTORY_PLATES[key];
    out[key] = {
      xOffset: f.xOffset,
      yOffset: f.yOffset,
      colStep: f.colStep,
      rowStep: f.rowStep,
      r: f.r,
      rDz: f.rDz
    };
  }
  return out;
}

let _nextClipId = 100;
function cloneDefaultTimelineClips() {
  return [
    { id: 1, track: "WHITE", startSec: 0,   endSec: 180, val: 35 },
    { id: 2, track: "BLUE",  startSec: 30,  endSec: 50,  val: 100 },
    { id: 3, track: "RED",   startSec: 80,  endSec: 100, val: 100 },
    { id: 4, track: "BLUE",  startSec: 130, endSec: 150, val: 100 },
    { id: 5, track: "TEMP",  startSec: 0,   endSec: 90,  val: 22 },
    { id: 6, track: "TEMP",  startSec: 90,  endSec: 180, val: 26 }
  ];
}

function compileMultiTrackSlices(clipsRaw, timelineSecRaw, binRaw, fallbackTemp) {
  const bin = Math.max(1, parseFloat(binRaw) || 1);
  const totalBins = Math.max(1, Math.round((Math.max(bin, parseFloat(timelineSecRaw) || 180)) / bin));
  const totalSec = totalBins * bin;
  const baseT = Math.min(40, Math.max(10, Number((parseFloat(fallbackTemp) || 22).toFixed(1))));

  const norm = [];
  for (const c of (clipsRaw || [])) {
    const sBin = Math.max(0, Math.min(totalBins, Math.round((parseFloat(c.startSec) || 0) / bin)));
    const eBin = Math.max(0, Math.min(totalBins, Math.round((parseFloat(c.endSec) || 0) / bin)));
    if (eBin > sBin) {
      norm.push({ track: String(c.track || ""), sBin, eBin, val: parseFloat(c.val) });
    }
  }

  const hasAnyTempClip = norm.some(c => c.track === "TEMP");
  const hasAnyBottomClip = norm.some(c => c.track.startsWith("U_"));
  const ptSet = new Set([0, totalBins]);
  for (const c of norm) {
    ptSet.add(c.sBin);
    ptSet.add(c.eBin);
  }
  const pts = [...ptSet].sort((a, b) => a - b);

  const lightOrder = ["WHITE", "BLUE", "GREEN", "RED", "UV"];
  const rawSlices = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const b0 = pts[i], b1 = pts[i + 1];
    if (b1 <= b0) continue;

    const topLights = [];
    const bottomLights = [];
    for (const lid of lightOrder) {
      const hitTop = norm.find(c => c.track === lid && c.sBin <= b0 && c.eBin >= b1);
      if (hitTop) {
        const pct = Math.min(100, Math.max(5, Math.round(hitTop.val || 100)));
        const pwm = Math.round((pct / 100) * 4095);
        topLights.push({ id: lid, trackId: lid, mount: "TOP", pct, pwm, colObj: LED_COLORS[lid] });
      }
      const botTrack = "U_" + lid;
      const hitBot = norm.find(c => c.track === botTrack && c.sBin <= b0 && c.eBin >= b1);
      if (hitBot) {
        const pct = Math.min(100, Math.max(5, Math.round(hitBot.val || 100)));
        const pwm = Math.round((pct / 100) * 4095);
        bottomLights.push({ id: lid, trackId: botTrack, mount: "BOT", pct, pwm, colObj: LED_COLORS[lid] });
      }
    }

    const tempHit = norm.find(c => c.track === "TEMP" && c.sBin <= b0 && c.eBin >= b1);
    const effectiveTemp = hasAnyTempClip
      ? (tempHit ? Math.min(40, Math.max(10, Number((tempHit.val || baseT).toFixed(1)))) : baseT)
      : null;

    const sig = "T:" + topLights.map(l => `${l.id}:${l.pct}`).join("+") +
      "|B:" + bottomLights.map(l => `${l.id}:${l.pct}`).join("+") +
      "|C:" + (effectiveTemp !== null ? effectiveTemp : "none");
    const prev = rawSlices[rawSlices.length - 1];
    if (prev && prev.sig === sig) {
      prev.b1 = b1;
      prev.bins = prev.b1 - prev.b0;
    } else {
      rawSlices.push({ b0, b1, bins: b1 - b0, topLights, bottomLights, effectiveTemp, sig });
    }
  }

  const shortMap = { WHITE: "W", BLUE: "B", GREEN: "G", RED: "R", UV: "UV" };
  const slices = rawSlices.map((s, idx) => {
    const sNum = idx + 1;
    const tLen = s.topLights.length;
    const bLen = s.bottomLights.length;
    const tempSuffix = s.effectiveTemp !== null ? `_${s.effectiveTemp}C` : "";
    let lightTag;
    let ovLight;

    if (tLen === 0 && bLen === 0) {
      lightTag = "DARK";
      ovLight = "DARK";
    } else if (bLen === 0) {
      if (tLen === 1) {
        lightTag = s.topLights[0].id;
        ovLight = s.topLights[0].id;
      } else if (tLen === 2) {
        lightTag = `${s.topLights[0].id}_${s.topLights[1].id}`;
        ovLight = `${s.topLights[0].id}+${s.topLights[1].id}`;
      } else {
        lightTag = "MIX_" + s.topLights.map(l => shortMap[l.id]).join("");
        ovLight = s.topLights.map(l => shortMap[l.id]).join("+");
      }
    } else if (tLen === 0) {
      if (bLen === 1) {
        lightTag = `U_${s.bottomLights[0].id}`;
        ovLight = `BOT ${s.bottomLights[0].id}`;
      } else if (bLen === 2) {
        lightTag = `U_${shortMap[s.bottomLights[0].id]}_${shortMap[s.bottomLights[1].id]}`;
        ovLight = `BOT ${shortMap[s.bottomLights[0].id]}+${shortMap[s.bottomLights[1].id]}`;
      } else {
        lightTag = "U_MIX_" + s.bottomLights.map(l => shortMap[l.id]).join("");
        ovLight = "BOT " + s.bottomLights.map(l => shortMap[l.id]).join("+");
      }
    } else {
      if (tLen === 1 && bLen === 1) {
        const fullCombo = `${s.topLights[0].id}_U_${s.bottomLights[0].id}`;
        lightTag = (`S${sNum}_${fullCombo}${tempSuffix}`).length <= 24
          ? fullCombo
          : `T${shortMap[s.topLights[0].id]}_U${shortMap[s.bottomLights[0].id]}`;
        ovLight = `T:${shortMap[s.topLights[0].id]} B:${shortMap[s.bottomLights[0].id]}`;
      } else {
        lightTag = "T" + s.topLights.map(l => shortMap[l.id]).join("") + "_U" + s.bottomLights.map(l => shortMap[l.id]).join("");
        ovLight = "T:" + s.topLights.map(l => shortMap[l.id]).join("+") + " B:" + s.bottomLights.map(l => shortMap[l.id]).join("+");
      }
    }

    const csvTag = `S${sNum}_${lightTag}${tempSuffix}`.slice(0, 24);
    const overlayText = `S${sNum} ${ovLight}${s.effectiveTemp !== null ? " " + s.effectiveTemp + "C" : ""}`;
    return {
      idx: sNum,
      startSec: s.b0 * bin,
      endSec: s.b1 * bin,
      bins: s.bins,
      topLights: s.topLights,
      bottomLights: s.bottomLights,
      lights: [...s.topLights, ...s.bottomLights],
      effectiveTemp: s.effectiveTemp,
      csvTag,
      overlayText
    };
  });

  const initialTemp = hasAnyTempClip && slices.length > 0 ? slices[0].effectiveTemp : null;
  const anyTempChange = hasAnyTempClip && slices.some(sl => Math.abs(sl.effectiveTemp - initialTemp) > 0.01);

  return { totalBins, totalSec, bin, hasAnyTempClip, hasAnyBottomClip, initialTemp, anyTempChange, slices };
}

function computeTempRampSteps(startRaw, endRaw, stepRaw) {
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
  if (Math.abs(last - endT) > 0.01 && steps.length < 25) {
    steps.push(endT);
  }
  return steps;
}

function cloneDefaultStimParams() {
  return {
    baseLight: "LIGHT",
    acclimSec: 120,
    durationSec: 600,
    timeBinSec: 1,
    ldStart: "LIGHT",
    ldPhaseSec: 300,
    ldCycles: 2,
    preBaselineSec: 60,
    numPulses: 5,
    pulseDurSec: 1,
    itiSec: 30,
    vibIntensity: "U0",
    vibAmbient: "DARK",
    lightHours: 16,
    darkHours: 8,
    numDays: 2,
    circBinSec: 10,
    mpTimelineSec: 180,
    mpAcclimLight: "DARK",
    mpCycles: 1,
    rampStartTemp: 20,
    rampEndTemp: 30,
    rampStepTemp: 2,
    rampHoldSec: 300,
    rampLight: "DARK"
  };
}

const state = {
  organism: "daphnia",
  plateId: "24well",
  stimId: "ld_transitions",
  activeStep: 4,
  profileName: "",
  plateConfigUpdatedAt: null,
  unsavedFileChanges: false,
  plateGeometries: cloneDefaultGeometries(),
  timelineClips: cloneDefaultTimelineClips(),
  selectedClipId: 2,
  showUnderTracks: false,
  unitZ3RgbMap: "DOCS",
  z3RgbMap: "DOCS",
  stimParams: cloneDefaultStimParams()
};

function loadInitialZ3RgbMap() {
  let saved = "DOCS";
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY_Z3_RGB_MAP);
      if (raw && Z3_RGB_MAPS[raw]) saved = raw;
    }
  } catch (_) {}
  state.unitZ3RgbMap = saved;
  state.z3RgbMap = saved;
  applyZ3RgbMapToCatalogs(saved);
}

function saveUnitZ3RgbMap(mapId) {
  const validId = applyZ3RgbMapToCatalogs(mapId);
  state.unitZ3RgbMap = validId;
  state.z3RgbMap = validId;
  try {
    if (typeof localStorage !== "undefined") {
      if (validId === "DOCS") localStorage.removeItem(STORAGE_KEY_Z3_RGB_MAP);
      else localStorage.setItem(STORAGE_KEY_Z3_RGB_MAP, validId);
    }
  } catch (_) {}
  return validId;
}

// Resets all assay state and form controls to factory defaults while preserving
// calibrated plateGeometries, profileName, plateConfigUpdatedAt, unsavedFileChanges, and unitZ3RgbMap.
function resetAssayFieldsAndDom() {
  state.organism = "daphnia";
  state.plateId = "24well";
  state.stimId = "ld_transitions";
  state.activeStep = 4;
  state.showUnderTracks = false;
  state.z3RgbMap = state.unitZ3RgbMap || "DOCS";
  state.timelineClips = cloneDefaultTimelineClips();
  state.selectedClipId = 2;
  state.stimParams = cloneDefaultStimParams();

  if (typeof simState !== "undefined") {
    simState.tSec = 0;
    simState.speed = 1;
  }

  if (typeof document === "undefined") {
    applyZ3RgbMapToCatalogs(state.z3RgbMap);
    return;
  }

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = String(v);
  };
  const setChk = (id, c) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(c);
  };

  setVal("simSpeedSel", "1");
  setVal("userName", "");
  setVal("expPrefix", "");
  setVal("hwVersion", "Z3");
  setVal("ledColor", "WHITE");
  setVal("ledBrightness", 100);
  setVal("ledMount", "OVERHEAD");
  applyZ3RgbMapToCatalogs(state.z3RgbMap);

  setChk("chk_dist", true);
  setChk("chk_msd", true);
  setChk("chk_zones", false);
  setChk("chk_xy", false);
  setVal("videoMode", "1fps");
  setChk("chk_tracks", true);
  setChk("chk_heatmap", false);

  const daph = ORGANISM_PRESETS[0];
  setVal("targetSize", daph.targetSize);
  setVal("detThreshold", daph.detThreshold);
  setVal("msdThreshold", daph.msdThreshold);
  setVal("thermostatTemp", daph.temp);
  setChk("chk_thermostat", daph.thermostat);
  setVal("autorefTimeout", 60);

  document.querySelectorAll("#stepTabs .tab-btn").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-step") === "4");
  });
}
