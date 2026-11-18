// Zantiks MWP Script Builder - Pre-flight checks shown on the Export page
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 13. Pre-flight Checks
// ---------------------------------------------------------------------------
// Each check returns { level: "warn" | "info" | "ok", title, detail, page }.
// Checks only read the current config; they never change the generated scripts.

const PREFLIGHT_ROOM_TEMP_C = 22;     // assumed room temperature for the heater-range check
const PREFLIGHT_HEATER_RISE_C = 10;   // MWP heaters regulate up to ~+10 °C above ambient
const VIDEO_FPS = { "1fps": 1, "0.2fps": 0.2, "full": 30, "off": 0 };

function collectTargetTemps(cfg) {
  const temps = [];
  if (cfg.useThermostat) temps.push(cfg.thermostatTemp);
  if (cfg.stimId === "temp_ramp") {
    temps.push(...computeTempRampSteps(cfg.sp.rampStartTemp, cfg.sp.rampEndTemp, cfg.sp.rampStepTemp));
  }
  if (cfg.stimId === "multi_phase") {
    for (const c of cfg.timelineClips) if (c.track === "TEMP") temps.push(parseFloat(c.val));
  }
  return temps.filter(Number.isFinite);
}

function fmtNum(n) {
  return Math.round(n).toLocaleString("en-US");
}

function computePreflightChecks(cfg, bundle) {
  const s4 = bundle[4];
  const sp = cfg.sp;
  const out = [];
  const add = (level, title, detail, page) => out.push({ level, title, detail: detail || "", page: page || "" });
  const runtimeH = s4.totalRuntimeSec / 3600;
  const stim = STIMULI.find(s => s.id === cfg.stimId);

  // Names
  if (cfg.hasNonAsciiWarning) {
    add("warn", "Name or study tag has non-English characters",
      "They are dropped from file names. Use A-Z letters and digits so Zantiks Build accepts the scripts.", "study");
  } else if (!cfg.userFullClean) {
    add("info", "No researcher name",
      `Files will be named "${s4.bundleFolder}". Add a name on the Study page to tell runs apart.`, "study");
  }

  // Temperature
  const temps = collectTargetTemps(cfg);
  if (temps.length) {
    const maxT = Math.max(...temps), minT = Math.min(...temps);
    const ceiling = PREFLIGHT_ROOM_TEMP_C + PREFLIGHT_HEATER_RISE_C;
    if (maxT > ceiling) {
      add("warn", `Target temperature up to ${maxT} °C`,
        `MWP heaters regulate from room temperature up to about ${PREFLIGHT_HEATER_RISE_C} °C above it (about ${ceiling} °C in a ${PREFLIGHT_ROOM_TEMP_C} °C room). Check that your room is warm enough.`,
        cfg.stimId === "temp_ramp" || cfg.stimId === "multi_phase" ? "stimulus" : "organism");
    }
    if (minT < PREFLIGHT_ROOM_TEMP_C - 2) {
      add("warn", `Target temperature as low as ${minT} °C`,
        "The heater can't cool below room temperature, so this target may never be reached.",
        cfg.stimId === "temp_ramp" || cfg.stimId === "multi_phase" ? "stimulus" : "organism");
    }
    add("info", "Thermostat in use: check the fan",
      "Before starting, make sure the unit's cooling / circulation fan is connected and spinning.", "organism");
  }

  // Short pulses
  if ((cfg.stimId === "light_off_startle" || cfg.stimId === "light_on_pulse") &&
      parseFloat(sp.pulseDurSec) < parseFloat(sp.timeBinSec)) {
    add("info", `Pulse (${sp.pulseDurSec} s) is shorter than the time bin (${sp.timeBinSec} s)`,
      "Each pulse is recorded inside a single time bin, so its effect is averaged over the whole bin.", "stimulus");
  }

  // Acclimation
  if (cfg.stimId !== "circadian" && parseFloat(sp.acclimSec) === 0) {
    add("info", "No acclimation period", "Recording starts right after the plate goes in.", "stimulus");
  }

  // Multi-track specifics
  if (cfg.stimId === "multi_phase") {
    const lightClips = cfg.timelineClips.filter(c => c.track !== "TEMP");
    if (!cfg.timelineClips.length) {
      add("warn", "Multi-track timeline is empty", "The run will stay dark (IR tracking only) for the whole timeline.", "stimulus");
    } else if (!lightClips.length) {
      add("info", "No LED clips on the timeline", "Only temperature changes; the chamber stays dark (IR only).", "stimulus");
    }
    if (cfg.hw !== "Z3") {
      if (lightClips.length) {
        add("info", "Brightness levels need an MWP Z3", "On Z2 / Z2S units LED clips simply switch lights on or off.", "study");
      }
      if (cfg.timelineClips.some(c => String(c.track).startsWith("U_"))) {
        add("warn", "Bottom LED clips need an MWP Z3", "Bottom LEDs use Z3 channels 8-13.", "stimulus");
      }
    }
  }

  // UV
  const usesUvClip = cfg.stimId === "multi_phase" && cfg.timelineClips.some(c => c.track === "UV" || c.track === "U_UV");
  const usesUvLight = cfg.stimId !== "multi_phase" && cfg.stimId !== "temp_ramp" && cfg.ledColor === "UV";
  if (usesUvClip || usesUvLight) {
    add("info", "UV light selected", "UV (365 nm) LEDs are only present on units fitted with them.", usesUvClip ? "stimulus" : "study");
  }

  // Video size
  const fps = VIDEO_FPS[cfg.videoMode];
  if (fps) {
    const frames = s4.totalRuntimeSec * fps;
    if (cfg.videoMode === "full" && s4.totalRuntimeSec > 1800) {
      add("warn", `Full 30 fps video for ${formatDuration(s4.totalRuntimeSec)}`,
        `Up to ${fmtNum(frames)} frames - very large files. The 1 fps timelapse is usually enough for tracking review.`, "data");
    } else if (runtimeH > 6 && fps >= 1) {
      add("info", `Long recording: up to ${fmtNum(frames)} video frames`,
        "For multi-hour runs the 0.2 fps long-run timelapse keeps files much smaller.", "data");
    }
  }

  // Data size
  if (cfg.useXy && runtimeH > 1) {
    add("warn", "Raw XY coordinates on a long run",
      `The XY file has one row per frame, so a ${formatDuration(s4.totalRuntimeSec)} run produces a very large CSV.`, "data");
  }
  if (s4.totalRows > 50000) {
    add("info", `Summary CSV will have ${fmtNum(s4.totalRows)} rows`,
      "A larger time bin gives fewer, easier-to-handle rows.", "stimulus");
  }

  // Calibration
  if (!isPlateCustomized(state.plateId)) {
    add("info", `Factory offsets for ${cfg.plate.name}`,
      "Calibrating the plate offsets on your own unit gives the most accurate well positions.", "plate");
  }

  // Always-on summary of what is ready
  add("ok", `${s4.csvCount === 2 ? "4 scripts, 2 CSV files" : "4 scripts, 1 CSV file"} ready`,
    `${stim ? stim.name : cfg.stimId} · ${formatDuration(s4.totalRuntimeSec)} · ${cfg.plate.name} · MWP ${cfg.hw}`, "");

  const rank = { warn: 0, info: 1, ok: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

const PREFLIGHT_PAGE_LABELS = {
  study: "Study", organism: "Organism", plate: "Plate", stimulus: "Stimulus", data: "Data & Video"
};

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderPreflightChecks(cfg, bundle) {
  const list = document.getElementById("preflightList");
  if (!list) return;
  const checks = computePreflightChecks(cfg, bundle);
  const nWarn = checks.filter(c => c.level === "warn").length;
  const nInfo = checks.filter(c => c.level === "info").length;
  const icon = { warn: "!", info: "i", ok: "✓" };

  list.innerHTML = checks.map(c => `
    <li class="preflight-item is-${c.level}">
      <span class="preflight-icon" aria-hidden="true">${icon[c.level]}</span>
      <div class="preflight-body">
        <div class="preflight-title">${escHtml(c.title)}</div>
        ${c.detail ? `<div class="preflight-detail">${escHtml(c.detail)}</div>` : ""}
      </div>
      ${c.page ? `<button type="button" class="btn btn-xs preflight-fix" data-preflight-goto="${c.page}">${PREFLIGHT_PAGE_LABELS[c.page] || "Edit"} &rarr;</button>` : ""}
    </li>`).join("");

  const parts = [];
  if (nWarn) parts.push(`${nWarn} warning${nWarn === 1 ? "" : "s"}`);
  if (nInfo) parts.push(`${nInfo} note${nInfo === 1 ? "" : "s"}`);
  const summary = parts.length ? parts.join(" · ") : "All clear";
  setText("preflightSummary", summary);

  // Sidebar row
  setText("sumChecks", nWarn ? `${nWarn} warning${nWarn === 1 ? "" : "s"}` : "No warnings");
  setText("sumChecksSub", nInfo ? `${nInfo} note${nInfo === 1 ? "" : "s"} · see Export page` : "See Export page");
  const row = document.getElementById("sumChecksRow");
  if (row) row.classList.toggle("has-warn", nWarn > 0);
}

function bindPreflight() {
  const list = document.getElementById("preflightList");
  if (!list) return;
  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preflight-goto]");
    if (btn) goToPage(btn.getAttribute("data-preflight-goto"));
  });
}
