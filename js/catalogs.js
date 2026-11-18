// Zantiks MWP Script Builder - Reference catalogs: organism presets, factory plates, LED colours, protocols, multi-track tracks
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

const STORAGE_KEY_PLATES = "zantiks_mwp_plate_config_v1";

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
    id: "6well", name: "6-Well", meta: "2 x 3 round",
    rows: 2, cols: 3, shape: "DISC",
    xOffset: 24.76, yOffset: 23.16, colStep: 39.12, rowStep: 39.12, r: 17.72, rDz: 12.73,
    arenaBmp: "a6", zoneBmp: "dz6", drawDelay: 0.3
  },
  "12well": {
    id: "12well", name: "12-Well", meta: "3 x 4 round",
    rows: 3, cols: 4, shape: "DISC",
    xOffset: 24.94, yOffset: 16.79, colStep: 26.01, rowStep: 26.01, r: 11.4, rDz: 8.5,
    arenaBmp: "a12", zoneBmp: "dz12", drawDelay: 0.3
  },
  "24well": {
    id: "24well", name: "24-Well", meta: "4 x 6 standard",
    rows: 4, cols: 6, shape: "DISC",
    xOffset: 15.2, yOffset: 13.5, colStep: 19.47, rowStep: 19.16, r: 8.13, rDz: 5.6,
    arenaBmp: "a24", zoneBmp: "dz24", drawDelay: 0.25
  },
  "24costar": {
    id: "24costar", name: "24-Well Costar", meta: "4 x 6 Costar",
    rows: 4, cols: 6, shape: "DISC",
    xOffset: 17.46, yOffset: 13.78, colStep: 19.3, rowStep: 19.3, r: 8.13, rDz: 5.65,
    arenaBmp: "a24c", zoneBmp: "dz24c", drawDelay: 0.25
  },
  "24square": {
    id: "24square", name: "24-Well Square", meta: "4 x 6 square",
    rows: 4, cols: 6, shape: "SQUARE",
    xOffset: 18.5, yOffset: 14.4, colStep: 18, rowStep: 18, r: 16.5, rDz: 12,
    arenaBmp: "a24sq", zoneBmp: "dz24sq", drawDelay: 0.25
  },
  "48well": {
    id: "48well", name: "48-Well", meta: "6 x 8 round",
    rows: 6, cols: 8, shape: "DISC",
    xOffset: 18.4, yOffset: 10.28, colStep: 12.92, rowStep: 12.92, r: 5.19, rDz: 3.45,
    arenaBmp: "a48", zoneBmp: "dz48", drawDelay: 0.2
  },
  "96well": {
    id: "96well", name: "96-Well", meta: "8 x 12 standard",
    rows: 8, cols: 12, shape: "DISC",
    xOffset: 14.15, yOffset: 11.24, colStep: 9, rowStep: 9, r: 3.5, rDz: 2.47,
    arenaBmp: "a96", zoneBmp: "dz96", drawDelay: 0.15
  },
  "96square": {
    id: "96square", name: "96-Well Square", meta: "8 x 12 square",
    rows: 8, cols: 12, shape: "SQUARE",
    xOffset: 14.15, yOffset: 9.65, colStep: 9, rowStep: 9, r: 7.5, rDz: 4.5,
    arenaBmp: "a96_sq", zoneBmp: "dz96_sq", drawDelay: 0.15
  },
  "petri": {
    id: "petri", name: "Petri Dish", meta: "1 x 1 (90 mm)",
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
  { id: "circadian", name: "Long-Term Cycle", meta: "Multi-hour / multi-day L:D" },
  { id: "multi_phase", name: "Multi-Track Timeline", meta: "Top/Bot LEDs & temp tracks", advanced: true,
    desc: "Draw your own sequence on a timeline editor: separate top and bottom LED tracks (White, 470, 530, 625, UV) plus a temperature track, repeated for any number of cycles." },
  { id: "temp_ramp", name: "Temperature Step / Ramp", meta: "Stepped thermal curve (°C)" }
];

const NLE_TRACKS = [
  { id: "WHITE",   group: "TOP", colorId: "WHITE", label: "White",     sub: "Top Ch 4",  kind: "light", swatch: "#eab308", bg: "#fef08a", border: "#ca8a04", text: "#713f12" },
  { id: "BLUE",    group: "TOP", colorId: "BLUE",  label: "Blue 470",  sub: "Top Ch 1",  kind: "light", swatch: "#3b82f6", bg: "#bfdbfe", border: "#2563eb", text: "#1e3a8a" },
  { id: "GREEN",   group: "TOP", colorId: "GREEN", label: "Green 530", sub: "Top Ch 3",  kind: "light", swatch: "#22c55e", bg: "#bbf7d0", border: "#16a34a", text: "#14532d" },
  { id: "RED",     group: "TOP", colorId: "RED",   label: "Red 625",   sub: "Top Ch 5",  kind: "light", swatch: "#ef4444", bg: "#fecaca", border: "#dc2626", text: "#7f1d1d" },
  { id: "UV",      group: "TOP", colorId: "UV",    label: "UV 365",    sub: "Top Ch 0",  kind: "light", swatch: "#a855f7", bg: "#e9d5ff", border: "#9333ea", text: "#581c87" },
  { id: "U_WHITE", group: "BOT", colorId: "WHITE", label: "White",     sub: "Bot Ch 12", kind: "light", swatch: "#eab308", bg: "#fef9c3", border: "#a16207", text: "#713f12" },
  { id: "U_BLUE",  group: "BOT", colorId: "BLUE",  label: "Blue 470",  sub: "Bot Ch 9",  kind: "light", swatch: "#38bdf8", bg: "#dbeafe", border: "#0284c7", text: "#0c4a6e" },
  { id: "U_GREEN", group: "BOT", colorId: "GREEN", label: "Green 530", sub: "Bot Ch 11", kind: "light", swatch: "#34d399", bg: "#d1fae5", border: "#059669", text: "#064e3b" },
  { id: "U_RED",   group: "BOT", colorId: "RED",   label: "Red 625",   sub: "Bot Ch 13", kind: "light", swatch: "#fb7185", bg: "#ffe4e6", border: "#e11d48", text: "#881337" },
  { id: "U_UV",    group: "BOT", colorId: "UV",    label: "UV 365",    sub: "Bot Ch 8",  kind: "light", swatch: "#c084fc", bg: "#f3e8ff", border: "#7e22ce", text: "#4c1d95" },
  { id: "TEMP",    group: "ENV", colorId: null,    label: "Temp °C",   sub: "Therm",     kind: "temp",  swatch: "#f97316", bg: "#fed7aa", border: "#ea580c", text: "#7c2d12" }
];
