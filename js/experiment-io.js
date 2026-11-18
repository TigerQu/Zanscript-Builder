// Zantiks MWP Script Builder - Save / open / auto-save of a whole experiment design
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 12. Experiment Files (experiment.json) & Browser Auto-save
// ---------------------------------------------------------------------------
// An experiment file stores every choice made in the wizard (study, organism,
// plate, protocol parameters, multi-track clips, data & video). Plate
// calibration offsets are NOT applied from the file: they belong to a
// specific unit and stay in the Plate Config store.

const EXPERIMENT_FORMAT = "zanscript-builder-experiment";
const EXPERIMENT_VERSION = 1;
const STORAGE_KEY_EXPERIMENT = "zantiks_mwp_experiment_v1";
const EXPERIMENT_FILE_IN_ZIP = "experiment.json";

// Form controls that belong to the experiment (id -> "value" | "checked")
const EXPERIMENT_INPUTS = {
  userName: "value",
  expPrefix: "value",
  hwVersion: "value",
  ledColor: "value",
  ledMount: "value",
  ledBrightness: "value",
  targetSize: "value",
  detThreshold: "value",
  msdThreshold: "value",
  autorefTimeout: "value",
  thermostatTemp: "value",
  chk_thermostat: "checked",
  chk_dist: "checked",
  chk_msd: "checked",
  chk_zones: "checked",
  chk_xy: "checked",
  videoMode: "value",
  chk_tracks: "checked",
  chk_heatmap: "checked"
};

function buildExperimentPayload() {
  const inputs = {};
  for (const [id, prop] of Object.entries(EXPERIMENT_INPUTS)) {
    const el = document.getElementById(id);
    if (el) inputs[id] = prop === "checked" ? Boolean(el.checked) : String(el.value);
  }
  const geo = state.plateGeometries[state.plateId];
  return {
    format: EXPERIMENT_FORMAT,
    version: EXPERIMENT_VERSION,
    savedAt: new Date().toISOString(),
    experiment: {
      organism: state.organism,
      plateId: state.plateId,
      stimId: state.stimId,
      inputs,
      stimParams: { ...state.stimParams },
      timelineClips: state.timelineClips.map(c => ({ track: c.track, startSec: c.startSec, endSec: c.endSec, val: c.val })),
      showUnderTracks: Boolean(state.showUnderTracks)
    },
    // For reference only (not applied on open): the offsets these scripts were generated with
    plateGeometry: geo ? { plateId: state.plateId, ...geo } : null
  };
}

// Returns an error message, or "" when the payload looks usable
function validateExperimentPayload(obj) {
  if (!obj || typeof obj !== "object") return "File is not valid JSON.";
  if (obj.format !== EXPERIMENT_FORMAT || !obj.experiment) return "This is not a Script Builder experiment file.";
  if (typeof obj.version === "number" && obj.version > EXPERIMENT_VERSION) {
    return "This experiment was saved by a newer version of the Script Builder.";
  }
  return "";
}

// Keep saved values exactly as the app held them (inputs store strings, defaults are
// numbers); only reject values that are not plain strings / numbers / booleans.
function coerceLike(value, sample) {
  const t = typeof value;
  if (t === "string" || t === "boolean" || (t === "number" && Number.isFinite(value))) return value;
  return sample;
}

// Apply a payload to state + form controls. With { render: false } only the
// data is applied (used during start-up, which renders everything afterwards).
function applyExperimentData(payload, opts) {
  const render = !opts || opts.render !== false;
  const exp = payload.experiment || {};
  const notes = [];

  if (typeof pauseSimulator === "function" && render) pauseSimulator();
  if (typeof simState !== "undefined") simState.tSec = 0;

  if (exp.organism === "custom" || ORGANISM_PRESETS.some(o => o.id === exp.organism)) state.organism = exp.organism;
  if (FACTORY_PLATES[exp.plateId]) state.plateId = exp.plateId;
  else if (exp.plateId) notes.push(`unknown plate "${exp.plateId}"`);
  if (STIMULI.some(s => s.id === exp.stimId)) state.stimId = exp.stimId;
  else if (exp.stimId) notes.push(`unknown protocol "${exp.stimId}"`);

  if (exp.stimParams && typeof exp.stimParams === "object") {
    for (const key of Object.keys(state.stimParams)) {
      if (key in exp.stimParams) state.stimParams[key] = coerceLike(exp.stimParams[key], state.stimParams[key]);
    }
  }

  if (Array.isArray(exp.timelineClips)) {
    const validTracks = new Set(NLE_TRACKS.map(t => t.id));
    const clips = [];
    for (const c of exp.timelineClips) {
      const s = parseFloat(c && c.startSec), e = parseFloat(c && c.endSec), v = parseFloat(c && c.val);
      if (!c || !validTracks.has(c.track) || !Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
      clips.push({ id: clips.length + 1, track: c.track, startSec: s, endSec: e, val: Number.isFinite(v) ? v : 100 });
    }
    state.timelineClips = clips;
    _nextClipId = Math.max(_nextClipId, clips.length + 1);
    state.selectedClipId = null;
  }
  state.showUnderTracks = Boolean(exp.showUnderTracks) || state.timelineClips.some(c => String(c.track).startsWith("U_"));

  const inputs = exp.inputs || {};
  for (const [id, prop] of Object.entries(EXPERIMENT_INPUTS)) {
    if (!(id in inputs)) continue;
    const el = document.getElementById(id);
    if (!el) continue;
    if (prop === "checked") {
      el.checked = Boolean(inputs[id]);
    } else if (el.tagName === "SELECT") {
      const want = String(inputs[id]);
      if ([...el.options].some(o => o.value === want)) el.value = want;
      else notes.push(`unknown ${id} "${want}"`);
    } else {
      el.value = String(inputs[id]);
    }
  }

  // Calibration stays with this browser/unit; just tell the user if it differs
  const saved = payload.plateGeometry;
  const current = state.plateGeometries[state.plateId];
  if (saved && current && saved.plateId === state.plateId) {
    const differs = GEO_FIELDS.some(f => Math.abs((parseFloat(saved[f]) || 0) - (parseFloat(current[f]) || 0)) > 0.001);
    if (differs) notes.push("plate offsets differ from this browser's calibration (kept yours)");
  }

  if (render) {
    syncGeoInputsToActivePlate();
    syncCheckStyles();
    renderOrganismChips();
    renderPlateGrid();
    renderStimGrid();
    renderStimParams();
    refreshAll();
  }
  return notes;
}

// ---- Auto-save to this browser -------------------------------------------
let _autosaveTimer = null;
let _autosaveReady = false; // only start saving once start-up has finished

function scheduleExperimentAutosave() {
  if (!_autosaveReady) return;
  if (_autosaveTimer !== null) clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    _autosaveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY_EXPERIMENT, JSON.stringify(buildExperimentPayload()));
      setText("autosaveStatus", "Auto-saved in this browser");
    } catch (_) {
      setText("autosaveStatus", "Auto-save unavailable in this browser");
    }
  }, 400);
}

// Called from init() before the first render
function restoreAutosavedExperiment() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_EXPERIMENT);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    if (validateExperimentPayload(payload)) return false;
    applyExperimentData(payload, { render: false });
    return true;
  } catch (_) {
    return false;
  }
}

// ---- Reading experiment.json out of a downloaded scripts .zip --------------
async function readExperimentFromZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid .zip file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!(name === EXPERIMENT_FILE_IN_ZIP || name.endsWith("/" + EXPERIMENT_FILE_IN_ZIP))) continue;

    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const data = bytes.subarray(localOff + 30 + lNameLen + lExtraLen, localOff + 30 + lNameLen + lExtraLen + compSize);
    if (method === 0) return new TextDecoder().decode(data);
    if (method === 8 && typeof DecompressionStream === "function") {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).text();
    }
    throw new Error("This .zip is compressed in a way the browser can't read. Unzip it and open experiment.json instead.");
  }
  throw new Error("No experiment.json in this .zip (it may come from an older version of the Script Builder).");
}

async function openExperimentFile(file) {
  try {
    const isZip = /\.zip$/i.test(file.name);
    const text = isZip ? await readExperimentFromZip(await file.arrayBuffer()) : await file.text();
    let payload;
    try { payload = JSON.parse(text); } catch (_) { payload = null; }
    const err = validateExperimentPayload(payload);
    if (err) { showToast(err); return; }
    const notes = applyExperimentData(payload);
    goToPage("study");
    showToast(notes.length ? `Opened ${file.name} - note: ${notes.join("; ")}` : `Opened ${file.name}`);
  } catch (e) {
    showToast(e && e.message ? e.message : "Could not open this file.");
  }
}

function saveExperimentFile() {
  const payload = buildExperimentPayload();
  const folder = refreshAll._latestBundle ? refreshAll._latestBundle[4].bundleFolder : "experiment";
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  triggerDownload(blob, `${folder}_experiment.json`);
  showToast(`Saved ${folder}_experiment.json`);
}

function bindExperimentIO() {
  const fileInput = document.getElementById("experimentFileInput");
  const openBtn = document.getElementById("openExperimentBtn");
  const saveBtn = document.getElementById("saveExperimentBtn");
  if (openBtn && fileInput) openBtn.addEventListener("click", () => { fileInput.value = ""; fileInput.click(); });
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) openExperimentFile(f);
    });
  }
  if (saveBtn) saveBtn.addEventListener("click", saveExperimentFile);
  _autosaveReady = true;
  scheduleExperimentAutosave();
}
