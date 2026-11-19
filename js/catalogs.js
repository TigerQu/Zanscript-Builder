// Zantiks MWP Script Builder - Reference catalogs: organism presets, factory plates, LED colours, protocols, multi-track tracks
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

const STORAGE_KEY_PLATES = "zantiks_mwp_plate_config_v1";
const STORAGE_KEY_Z3_RGB_MAP = "zantiks_mwp_z3_rgb_map_v1";

const Z3_RGB_MAPS = {
  DOCS: {
    id: "DOCS",
    label: "Official Zantiks Docs (Ch 1:Blue, 3:Green, 5:Red)",
    BLUE:  [1, 9],
    GREEN: [3, 11],
    RED:   [5, 13]
  },
  GRB_SHIFT: {
    id: "GRB_SHIFT",
    label: "Alternate Batch / GRB-Shifted (Ch 1:Green, 3:Red, 5:Blue)",
    BLUE:  [5, 13],
    GREEN: [1, 9],
    RED:   [3, 11]
  }
};

// ---------------------------------------------------------------------------
// 1. Reference Catalogs (Derived from official Zantiks MWP .zs scripts)
// ---------------------------------------------------------------------------
const ORGANISM_PRESETS = [
  {
    id: "daphnia",
    label: "Daphnia magna",
    targetSize: 4,
    detThreshold: 8,
    msdThreshold: 6,
    temp: 22,
    thermostat: true,
    suggestMsd: true
  },
  {
    id: "drosophila",
    label: "Drosophila (Adult)",
    targetSize: 5,
    detThreshold: 3,
    msdThreshold: 15,
    temp: 23,
    thermostat: true,
    suggestMsd: false
  },
  {
    id: "celegans",
    label: "C. elegans",
    targetSize: 1,
    detThreshold: 5,
    msdThreshold: 5,
    temp: 20,
    thermostat: true,
    suggestMsd: true
  },
  {
    id: "planaria",
    label: "Planaria",
    targetSize: 3,
    detThreshold: 6,
    msdThreshold: 6,
    temp: 21,
    thermostat: false,
    suggestMsd: false
  },
  {
    id: "zebrafish",
    label: "Zebrafish Larvae",
    targetSize: 2,
    detThreshold: 6,
    msdThreshold: 6,
    temp: 28,
    thermostat: true,
    suggestMsd: false
  },
  {
    id: "custom",
    label: "Custom",
    targetSize: 2,
    detThreshold: 6,
    msdThreshold: 6,
    temp: 22,
    thermostat: true,
    suggestMsd: false
  }
];

const FACTORY_PLATES = {
  "6well": {
    id: "6well", shortCode: "6w", name: "6-Well", meta: "2 x 3 round",
    rows: 2, cols: 3, shape: "DISC",
    xOffset: 24.76, yOffset: 23.16, colStep: 39.12, rowStep: 39.12, r: 17.72, rDz: 12.73,
    arenaBmp: "a6", zoneBmp: "dz6", drawDelay: 0.3
  },
  "12well": {
    id: "12well", shortCode: "12w", name: "12-Well", meta: "3 x 4 round",
    rows: 3, cols: 4, shape: "DISC",
    xOffset: 24.94, yOffset: 16.79, colStep: 26.01, rowStep: 26.01, r: 11.4, rDz: 8.5,
    arenaBmp: "a12", zoneBmp: "dz12", drawDelay: 0.3
  },
  "24well": {
    id: "24well", shortCode: "24w", name: "24-Well", meta: "4 x 6 standard",
    rows: 4, cols: 6, shape: "DISC",
    xOffset: 15.2, yOffset: 13.5, colStep: 19.47, rowStep: 19.16, r: 8.13, rDz: 5.6,
    arenaBmp: "a24", zoneBmp: "dz24", drawDelay: 0.25
  },
  "24costar": {
    id: "24costar", shortCode: "24c", name: "24-Well Costar", meta: "4 x 6 Costar",
    rows: 4, cols: 6, shape: "DISC",
    xOffset: 17.46, yOffset: 13.78, colStep: 19.3, rowStep: 19.3, r: 8.13, rDz: 5.65,
    arenaBmp: "a24c", zoneBmp: "dz24c", drawDelay: 0.25
  },
  "24square": {
    id: "24square", shortCode: "24sq", name: "24-Well Square", meta: "4 x 6 square",
    rows: 4, cols: 6, shape: "SQUARE",
    xOffset: 18.5, yOffset: 14.4, colStep: 18, rowStep: 18, r: 16.5, rDz: 12,
    arenaBmp: "a24sq", zoneBmp: "dz24sq", drawDelay: 0.25
  },
  "48well": {
    id: "48well", shortCode: "48w", name: "48-Well", meta: "6 x 8 round",
    rows: 6, cols: 8, shape: "DISC",
    xOffset: 18.4, yOffset: 10.28, colStep: 12.92, rowStep: 12.92, r: 5.19, rDz: 3.45,
    arenaBmp: "a48", zoneBmp: "dz48", drawDelay: 0.2
  },
  "96well": {
    id: "96well", shortCode: "96w", name: "96-Well", meta: "8 x 12 standard",
    rows: 8, cols: 12, shape: "DISC",
    xOffset: 14.15, yOffset: 11.24, colStep: 9, rowStep: 9, r: 3.5, rDz: 2.47,
    arenaBmp: "a96", zoneBmp: "dz96", drawDelay: 0.15
  },
  "96square": {
    id: "96square", shortCode: "96sq", name: "96-Well Square", meta: "8 x 12 square",
    rows: 8, cols: 12, shape: "SQUARE",
    xOffset: 14.15, yOffset: 9.65, colStep: 9, rowStep: 9, r: 7.5, rDz: 4.5,
    arenaBmp: "a96_sq", zoneBmp: "dz96_sq", drawDelay: 0.15
  },
  "petri": {
    id: "petri", shortCode: "pd", name: "Petri Dish", meta: "1 x 1 (90 mm)",
    rows: 1, cols: 1, shape: "DISC",
    xOffset: 67, yOffset: 43, colStep: 19.3, rowStep: 19.3, r: 44, rDz: 31.8,
    arenaBmp: "aPD", zoneBmp: "dzPD", drawDelay: 0.4
  }
};

const GEO_FIELDS = ["xOffset", "yOffset", "colStep", "rowStep", "r", "rDz"];

const LED_COLORS = {
  WHITE: { id: "WHITE", label: "White (~6000K)", short: "White", tag: "LIGHT", z3Over: 4, z3Under: 12, z2Gpo: [6, 7, 8], tlCls: "tl-light" },
  BLUE:  { id: "BLUE",  label: "Blue (470 nm)",  short: "Blue",  tag: "BLUE",  z3Over: 1, z3Under: 9,  z2Gpo: [8],       tlCls: "tl-blue" },
  GREEN: { id: "GREEN", label: "Green (530 nm)", short: "Green", tag: "GREEN", z3Over: 3, z3Under: 11, z2Gpo: [7],       tlCls: "tl-green" },
  RED:   { id: "RED",   label: "Red (625 nm)",   short: "Red",   tag: "RED",   z3Over: 5, z3Under: 13, z2Gpo: [6],       tlCls: "tl-red" },
  UV:    { id: "UV",    label: "UV (365 nm)",    short: "UV",    tag: "UV",    z3Over: 0, z3Under: 8,  z2Gpo: [8],       tlCls: "tl-uv" }
};

const STIMULI = [
  { id: "baseline", name: "None (Baseline)", meta: "Constant light or dark" },
  { id: "ld_transitions", name: "Light / Dark Cycles", meta: "Alternating light & dark" },
  { id: "light_off_startle", name: "Light-Off Startle", meta: "Brief dark pulses + ITI" },
  { id: "light_on_pulse", name: "Light-On Flash", meta: "Bright flashes in dark" },
  { id: "vibration_startle", name: "Vibration Startle", meta: "Stepper motor tap + ITI" },
  { id: "acoustic_startle", name: "Acoustic Startle", meta: "Built-in sound card cue + ITI" },
  { id: "ppi", name: "Prepulse Inhibition (PPI)", meta: "Weak prepulse + ISI + pulse" },
  { id: "circadian", name: "Long-Term Cycle", meta: "Multi-hour / multi-day L:D" },
  { id: "multi_phase", name: "Multi-Track Timeline", meta: "Top/Bot LEDs, temp, vib & audio", advanced: true,
    desc: "Draw your own multi-modal sequence: independent top and bottom LED tracks (White, 470, 530, 625, UV), temperature, vibration tap, and audio tracks repeated for any number of cycles." },
  { id: "temp_ramp", name: "Temperature Step / Ramp", meta: "Stepped thermal curve (°C)" }
];

const VIB_STEP_MODES = [
  { level: 0, code: "U0", label: "U0 · Strong (Full Step)", short: "U0" },
  { level: 1, code: "U1", label: "U1 · Medium (Half Step)", short: "U1" },
  { level: 2, code: "U2", label: "U2 · Mild (Quarter Step)", short: "U2" },
  { level: 3, code: "U3", label: "U3 · Gentle (Eighth Step)", short: "U3" }
];

const AUDIO_BUILTINS = ["tone", "mono"];

function clampVibLevel(raw) {
  if (typeof raw === "string") {
    const m = raw.trim().toUpperCase().match(/^U([0-3])$/);
    if (m) return parseInt(m[1], 10);
  }
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 2;
}

function vibLevelToCode(raw) {
  return "U" + clampVibLevel(raw);
}

function sanitizeAudioAsset(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "")
    .replace(/^\.+/, "")
    .slice(0, 32);
  return cleaned || "tone";
}

function getZoneAssetName(plate, zoneMode) {
  if (!plate) return "dz24";
  const base = plate.zoneBmp || "dz24";
  if (zoneMode === "half_tb") {
    return base.startsWith("dz") ? "ldz" + base.slice(2) : "ldz_" + base;
  }
  if (zoneMode === "half_lr") {
    return base.startsWith("dz") ? "lrz" + base.slice(2) : "lrz_" + base;
  }
  return base;
}

const NLE_TRACKS = [
  { id: "WHITE",   group: "TOP",  colorId: "WHITE", label: "White",     sub: "Top Ch 4",    kind: "light", swatch: "#eab308", bg: "#fef08a", border: "#ca8a04", text: "#713f12" },
  { id: "BLUE",    group: "TOP",  colorId: "BLUE",  label: "Blue 470",  sub: "Top Ch 1",    kind: "light", swatch: "#3b82f6", bg: "#bfdbfe", border: "#2563eb", text: "#1e3a8a" },
  { id: "GREEN",   group: "TOP",  colorId: "GREEN", label: "Green 530", sub: "Top Ch 3",    kind: "light", swatch: "#22c55e", bg: "#bbf7d0", border: "#16a34a", text: "#14532d" },
  { id: "RED",     group: "TOP",  colorId: "RED",   label: "Red 625",   sub: "Top Ch 5",    kind: "light", swatch: "#ef4444", bg: "#fecaca", border: "#dc2626", text: "#7f1d1d" },
  { id: "UV",      group: "TOP",  colorId: "UV",    label: "UV 365",    sub: "Top Ch 0",    kind: "light", swatch: "#a855f7", bg: "#e9d5ff", border: "#9333ea", text: "#581c87" },
  { id: "U_WHITE", group: "BOT",  colorId: "WHITE", label: "White",     sub: "Bot Ch 12",   kind: "light", swatch: "#eab308", bg: "#fef9c3", border: "#a16207", text: "#713f12" },
  { id: "U_BLUE",  group: "BOT",  colorId: "BLUE",  label: "Blue 470",  sub: "Bot Ch 9",    kind: "light", swatch: "#38bdf8", bg: "#dbeafe", border: "#0284c7", text: "#0c4a6e" },
  { id: "U_GREEN", group: "BOT",  colorId: "GREEN", label: "Green 530", sub: "Bot Ch 11",   kind: "light", swatch: "#34d399", bg: "#d1fae5", border: "#059669", text: "#064e3b" },
  { id: "U_RED",   group: "BOT",  colorId: "RED",   label: "Red 625",   sub: "Bot Ch 13",   kind: "light", swatch: "#fb7185", bg: "#ffe4e6", border: "#e11d48", text: "#881337" },
  { id: "U_UV",    group: "BOT",  colorId: "UV",    label: "UV 365",    sub: "Bot Ch 8",    kind: "light", swatch: "#c084fc", bg: "#f3e8ff", border: "#7e22ce", text: "#4c1d95" },
  { id: "TEMP",    group: "ENV",  colorId: null,    label: "Temp °C",   sub: "Therm",       kind: "temp",  swatch: "#f97316", bg: "#fed7aa", border: "#ea580c", text: "#7c2d12" },
  { id: "VIB",     group: "STIM", colorId: null,    label: "Vib Tap",   sub: "Motor U0-U3", kind: "vib",   swatch: "#ec4899", bg: "#fbcfe8", border: "#db2777", text: "#831843" },
  { id: "AUDIO",   group: "STIM", colorId: null,    label: "Audio",     sub: "Sound Card",  kind: "audio", swatch: "#06b6d4", bg: "#cffafe", border: "#0891b2", text: "#164e63" }
];

function applyZ3RgbMapToCatalogs(mapId) {
  const validId = Z3_RGB_MAPS[mapId] ? mapId : "DOCS";
  const m = Z3_RGB_MAPS[validId];
  LED_COLORS.BLUE.z3Over = m.BLUE[0];
  LED_COLORS.BLUE.z3Under = m.BLUE[1];
  LED_COLORS.GREEN.z3Over = m.GREEN[0];
  LED_COLORS.GREEN.z3Under = m.GREEN[1];
  LED_COLORS.RED.z3Over = m.RED[0];
  LED_COLORS.RED.z3Under = m.RED[1];

  for (const tr of NLE_TRACKS) {
    if (tr.kind === "light" && tr.colorId && LED_COLORS[tr.colorId]) {
      const c = LED_COLORS[tr.colorId];
      tr.sub = tr.group === "BOT" ? `Bot Ch ${c.z3Under}` : `Top Ch ${c.z3Over}`;
    }
  }

  if (typeof document !== "undefined") {
    const mapSel = document.getElementById("z3RgbMap");
    const hwSel = document.getElementById("hwVersion");
    if (mapSel) {
      mapSel.value = validId;
      if (hwSel) mapSel.disabled = hwSel.value !== "Z3";
    }
    const colSel = document.getElementById("ledColor");
    if (colSel && colSel.options) {
      const optText = {
        WHITE: `White (~6000K - Z3 Ch ${LED_COLORS.WHITE.z3Over} / ${LED_COLORS.WHITE.z3Under})`,
        BLUE:  `Blue (470 nm - Z3 Ch ${LED_COLORS.BLUE.z3Over} / ${LED_COLORS.BLUE.z3Under})`,
        GREEN: `Green (530 nm - Z3 Ch ${LED_COLORS.GREEN.z3Over} / ${LED_COLORS.GREEN.z3Under})`,
        RED:   `Red (625 nm - Z3 Ch ${LED_COLORS.RED.z3Over} / ${LED_COLORS.RED.z3Under})`,
        UV:    `UV (365 nm - Z3 Ch ${LED_COLORS.UV.z3Over} / ${LED_COLORS.UV.z3Under}, if fitted)`
      };
      for (const opt of colSel.options) {
        if (optText[opt.value]) opt.textContent = optText[opt.value];
      }
    }
  }
  return validId;
}
