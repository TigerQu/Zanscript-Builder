// Zantiks MWP Script Builder - Name/slug and plate-config helpers, formatting utilities, toast
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 3. Name, Slug & Plate Config Helpers
// ---------------------------------------------------------------------------
function sanitizeSlug(raw, maxLen) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/['’`]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!maxLen) return cleaned;
  return cleaned.slice(0, maxLen).replace(/_+$/g, "");
}

function sanitizeAsciiComment(raw, maxLen) {
  const cleaned = String(raw || "")
    .replace(/[^\x20-\x7E]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

function extractLastName(fullName) {
  const raw = String(fullName || "").trim();
  if (!raw) return "";
  if (raw.includes(",")) {
    const surnamePart = raw.split(",")[0].trim();
    return sanitizeSlug(surnamePart, 18);
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const suffixes = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "md"]);
  while (parts.length > 1 && suffixes.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }
  return sanitizeSlug(parts[parts.length - 1], 18);
}

function roundGeo(n, fallback) {
  const v = parseFloat(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Number(v.toFixed(2));
}

function isPlateCustomized(plateId) {
  const cur = state.plateGeometries[plateId];
  const def = FACTORY_PLATES[plateId];
  return GEO_FIELDS.some(k => Math.abs(cur[k] - def[k]) > 0.004);
}

function countCustomizedPlates() {
  return Object.keys(FACTORY_PLATES).filter(isPlateCustomized).length;
}

function applyConfigObject(obj, markSavedToFile) {
  if (!obj || typeof obj !== "object") return false;
  const platesSrc = obj.plates && typeof obj.plates === "object" ? obj.plates : obj;
  let appliedAny = false;

  for (const key of Object.keys(FACTORY_PLATES)) {
    if (platesSrc[key] && typeof platesSrc[key] === "object") {
      const src = platesSrc[key];
      const def = FACTORY_PLATES[key];
      state.plateGeometries[key] = {
        xOffset: roundGeo(src.xOffset, def.xOffset),
        yOffset: roundGeo(src.yOffset, def.yOffset),
        colStep: roundGeo(src.colStep, def.colStep),
        rowStep: roundGeo(src.rowStep, def.rowStep),
        r: roundGeo(src.r, def.r),
        rDz: roundGeo(src.rDz, def.rDz)
      };
      appliedAny = true;
    }
  }

  if (typeof obj.profileName === "string") {
    state.profileName = obj.profileName.trim().slice(0, 48);
  }
  if (typeof obj.updatedAt === "string") {
    state.plateConfigUpdatedAt = obj.updatedAt;
  }
  if (markSavedToFile) {
    state.unsavedFileChanges = false;
  }
  return appliedAny;
}

function buildConfigPayload(updatedAtOverride) {
  const platesOut = {};
  for (const key of Object.keys(FACTORY_PLATES)) {
    platesOut[key] = { ...state.plateGeometries[key] };
  }
  return {
    version: 1,
    profileName: state.profileName || "",
    updatedAt: updatedAtOverride !== undefined ? updatedAtOverride : (state.plateConfigUpdatedAt || new Date().toISOString()),
    plates: platesOut
  };
}

function formatPlateConfigJsContent(payload) {
  return [
    "// Zantiks MWP Plate Calibration Config",
    "// Keep this file in the same folder as zantiks_script_generator.html.",
    "// You can edit these values visually in the web app (\"Plate Config\" button) and save",
    "// back to this file, or edit the numbers below in any text editor. All units are in mm.",
    "",
    "window.ZANTIKS_PLATE_CONFIG = " + JSON.stringify(payload, null, 2) + ";",
    ""
  ].join("\n");
}

function parseConfigText(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) throw new Error("Empty configuration file");
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    // Strip JS comments outside strings so zantiks_plate_config.js parses cleanly
    let out = "";
    let inStr = false;
    let i = 0;
    while (i < trimmed.length) {
      const ch = trimmed[i];
      const next = trimmed[i + 1];
      if (ch === '"' && trimmed[i - 1] !== "\\") {
        inStr = !inStr;
        out += ch;
        i++;
      } else if (!inStr && ch === "/" && next === "/") {
        while (i < trimmed.length && trimmed[i] !== "\n") i++;
      } else if (!inStr && ch === "/" && next === "*") {
        i += 2;
        while (i < trimmed.length && !(trimmed[i] === "*" && trimmed[i + 1] === "/")) i++;
        i += 2;
      } else {
        out += ch;
        i++;
      }
    }
    const firstBrace = out.indexOf("{");
    const lastBrace = out.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new Error("No JSON object found in config file");
    }
    return JSON.parse(out.slice(firstBrace, lastBrace + 1));
  }
}

function savePlateConfigToBrowser() {
  state.plateConfigUpdatedAt = new Date().toISOString();
  state.unsavedFileChanges = true;
  try {
    if (typeof localStorage !== "undefined") {
      const payload = buildConfigPayload(state.plateConfigUpdatedAt);
      localStorage.setItem(STORAGE_KEY_PLATES, JSON.stringify(payload));
    }
  } catch (_) {
    // Ignore storage quota / private mode restrictions
  }
}

function loadInitialPlateConfig() {
  const fileCfg = (typeof window !== "undefined" && window.ZANTIKS_PLATE_CONFIG) ? window.ZANTIKS_PLATE_CONFIG : null;
  let localCfg = null;
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY_PLATES);
      if (raw) localCfg = JSON.parse(raw);
    }
  } catch (_) {
    localCfg = null;
  }

  if (fileCfg && localCfg) {
    const fTime = fileCfg.updatedAt ? Date.parse(fileCfg.updatedAt) : 0;
    const lTime = localCfg.updatedAt ? Date.parse(localCfg.updatedAt) : 0;
    if (fTime > lTime) {
      applyConfigObject(fileCfg, true);
      try { localStorage.setItem(STORAGE_KEY_PLATES, JSON.stringify(buildConfigPayload(fileCfg.updatedAt))); } catch (_) {}
    } else {
      applyConfigObject(localCfg, false);
    }
  } else if (localCfg) {
    applyConfigObject(localCfg, false);
  } else if (fileCfg) {
    applyConfigObject(fileCfg, true);
  }
}

// ---------------------------------------------------------------------------
// 4. General Formatting Utilities
// ---------------------------------------------------------------------------
function getWellLabels(rows, cols) {
  const labels = [];
  for (let r = 0; r < rows; r++) {
    const rowChar = String.fromCharCode(65 + r);
    for (let c = 1; c <= cols; c++) {
      labels.push(rowChar + c);
    }
  }
  return labels;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function formatLogHeaderBlock(metaHeaders, wellHeaders, indent) {
  const pad = indent || "    ";
  const lines = [];
  lines.push(pad + 'LOGCREATE("' + metaHeaders.map(h => "TEXT:" + h).join("|") + '")');
  const chunks = chunkArray(wellHeaders, 6);
  for (const ch of chunks) {
    lines.push(pad + 'LOGAPPEND("' + ch.map(h => "TEXT:" + h).join("|") + '")');
  }
  lines.push(pad + "LOGRUN()");
  return lines.join("\n");
}

function padOverlay(label) {
  const s = String(label);
  return s.length >= 22 ? s.slice(0, 22) : s + " ".repeat(22 - s.length);
}

function formatDuration(totalSec) {
  const sec = Math.max(0, Math.round(totalSec));
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h + "h " + String(m).padStart(2, "0") + "m";
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + "m " + String(s).padStart(2, "0") + "s";
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("show"), 2000);
}
