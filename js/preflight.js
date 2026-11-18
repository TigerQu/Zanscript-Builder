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

function resolveTargetTempInfo(cfg, mpComp) {
  const sp = cfg.sp || state.stimParams;
  if (cfg.stimId === "temp_ramp") {
    const steps = computeTempRampSteps(sp.rampStartTemp, sp.rampEndTemp, sp.rampStepTemp).filter(Number.isFinite);
    return { temps: [...new Set(steps)], page: "stimulus" };
  }
  if (cfg.stimId === "multi_phase") {
    const comp = mpComp || compileMultiTrackSlices(cfg.timelineClips, sp.mpTimelineSec, sp.timeBinSec, cfg.thermostatTemp);
    if (comp.hasAnyTempClip) {
      const sliceTemps = comp.slices.map(s => s.effectiveTemp).filter(Number.isFinite);
      return { temps: [...new Set(sliceTemps)], page: "stimulus" };
    }
    if (cfg.useThermostat && Number.isFinite(cfg.thermostatTemp)) {
      return { temps: [cfg.thermostatTemp], page: "organism" };
    }
    return { temps: [], page: "organism" };
  }
  if (cfg.useThermostat && Number.isFinite(cfg.thermostatTemp)) {
    return { temps: [cfg.thermostatTemp], page: "organism" };
  }
  return { temps: [], page: "organism" };
}

function collectTargetTemps(cfg, mpComp) {
  return resolveTargetTempInfo(cfg, mpComp).temps;
}

function fmtNum(n) {
  return Math.round(n).toLocaleString("en-US");
}

function computePreflightChecks(cfgIn, bundleIn) {
  const cfg = cfgIn || (typeof refreshAll === "function" && refreshAll._latestCfg) || readConfig();
  const bundle = bundleIn || (typeof refreshAll === "function" && refreshAll._latestBundle) || generateAllSteps(cfg);
  const s4 = bundle[4];
  const sp = cfg.sp || state.stimParams;
  const out = [];
  const add = (level, title, detail, page) => out.push({ level, title, detail: detail || "", page: page || "" });
  const runtimeH = s4.totalRuntimeSec / 3600;
  const stim = STIMULI.find(s => s.id === cfg.stimId);
  const mpComp = cfg.stimId === "multi_phase"
    ? compileMultiTrackSlices(cfg.timelineClips, sp.mpTimelineSec, sp.timeBinSec, cfg.thermostatTemp)
    : null;

  // Names
  if (cfg.hasNonAsciiWarning) {
    add("warn", "Name or study tag has non-English characters",
      "They are dropped from file names. Use A-Z letters and digits so Zantiks Build accepts the scripts.", "study");
  } else if (!cfg.userFullClean) {
    add("info", "No researcher name",
      `Slot name defaults to "${s4.filename.replace(/\.zs$/, "")}". Add your name on the Study page so your Zantiks slot stays separate from labmates.`, "study");
  }

  // Temperature (matches exact Step 3 / Step 4 SET(THERMOSTAT, ...) generation)
  const { temps, page: tempPage } = resolveTargetTempInfo(cfg, mpComp);
  if (temps.length) {
    const maxT = Math.max(...temps), minT = Math.min(...temps);
    const ceiling = PREFLIGHT_ROOM_TEMP_C + PREFLIGHT_HEATER_RISE_C;
    if (maxT > ceiling) {
      add("warn", `Target temperature up to ${maxT} °C`,
        `MWP heaters regulate from room temperature up to about ${PREFLIGHT_HEATER_RISE_C} °C above it (about ${ceiling} °C in a ${PREFLIGHT_ROOM_TEMP_C} °C room). Check that your room is warm enough.`,
        tempPage);
    }
    if (minT < PREFLIGHT_ROOM_TEMP_C - 2) {
      add("warn", `Target temperature as low as ${minT} °C`,
        "The heater can't cool below room temperature, so this target may never be reached.",
        tempPage);
    }
    add("info", "Thermostat in use: check the fan",
      "Before starting, make sure the unit's cooling / circulation fan is connected and spinning.", "organism");

    // Thermal equilibration & passive cooling lag notices
    if (cfg.stimId === "temp_ramp") {
      const steps = computeTempRampSteps(sp.rampStartTemp, sp.rampEndTemp, sp.rampStepTemp);
      if (steps.length > 1) {
        const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
        const holdRaw = Math.max(bin, parseInt(sp.rampHoldSec, 10) || 300);
        const actualHoldSec = Math.max(1, Math.round(holdRaw / bin)) * bin;
        const hasCooling = steps.some((t, i) => i > 0 && t < steps[i - 1] - 0.01);
        if (actualHoldSec < 1200) {
          add("info", `Short temperature hold (${actualHoldSec} s per step)`,
            `Chamber water typically needs ~20-30 min per step to equilibrate${hasCooling ? " (and cools passively without active refrigeration)" : ""}. Use the logged TEMP_C column for actual measured temperature.`,
            "stimulus");
        } else if (hasCooling) {
          add("info", "Downward temperature steps cool passively",
            "Standard MWP units have no active chiller; cooling relies on ambient heat dissipation. Use the logged TEMP_C column for actual temperature.",
            "stimulus");
        }
      }
    } else if (cfg.stimId === "multi_phase" && mpComp && mpComp.anyTempChange) {
      let minHoldAfterChange = Infinity;
      let hasCooling = false;
      for (let i = 1; i < mpComp.slices.length; i++) {
        const prevT = mpComp.slices[i - 1].effectiveTemp;
        const curT = mpComp.slices[i].effectiveTemp;
        if (Math.abs(curT - prevT) > 0.01) {
          if (curT < prevT - 0.01) hasCooling = true;
          let hold = 0;
          for (let j = i; j < mpComp.slices.length && Math.abs(mpComp.slices[j].effectiveTemp - curT) <= 0.01; j++) {
            hold += mpComp.slices[j].bins * mpComp.bin;
          }
          if (hold < minHoldAfterChange) minHoldAfterChange = hold;
        }
      }
      if (minHoldAfterChange < 1200) {
        add("info", `Rapid mid-run temperature shift (${minHoldAfterChange} s window)`,
          `Chamber water typically needs ~20-30 min to equilibrate${hasCooling ? " (and cools passively)" : ""}. Use the logged TEMP_C column for actual measured temperature.`,
          "stimulus");
      } else if (hasCooling) {
        add("info", "Mid-run temperature drop cools passively",
          "Standard MWP units have no active chiller; cooling relies on ambient heat dissipation. Check TEMP_C in the CSV.",
          "stimulus");
      }
    }
  }

  // Short pulses
  if ((cfg.stimId === "light_off_startle" || cfg.stimId === "light_on_pulse") &&
      parseFloat(sp.pulseDurSec) < parseFloat(sp.timeBinSec)) {
    add("info", `Pulse (${sp.pulseDurSec} s) is shorter than the time bin (${sp.timeBinSec} s)`,
      "Each pulse is recorded inside a single time bin, so its effect is averaged over the whole bin.", "stimulus");
  }

  // Acclimation
  if (cfg.stimId !== "circadian" && (parseFloat(sp.acclimSec) || 0) <= 0) {
    add("info", "No acclimation period", "Recording starts right after the plate goes in.", "stimulus");
  }

  // UV LED check (only when Ch 0 / Ch 8 UV is actually driven in Step 3 / Step 4)
  let usesUv = false;
  let uvPage = "study";
  if (cfg.stimId === "multi_phase") {
    usesUv = sp.mpAcclimLight === "UV" ||
      mpComp.slices.some(sl => sl.topLights.some(l => l.id === "UV") || sl.bottomLights.some(l => l.id === "UV"));
    uvPage = "stimulus";
  } else if (cfg.stimId === "baseline") {
    usesUv = sp.baseLight !== "DARK" && cfg.ledColor === "UV";
  } else if (cfg.stimId === "vibration_startle") {
    usesUv = sp.vibAmbient === "LIGHT" && cfg.ledColor === "UV";
  } else if (cfg.stimId === "temp_ramp") {
    usesUv = sp.rampLight === "LIGHT" && cfg.ledColor === "UV";
  } else if (cfg.stimId === "circadian") {
    usesUv = (parseFloat(sp.lightHours) || 0) > 0 && cfg.ledColor === "UV";
  } else {
    // ld_transitions, light_off_startle, light_on_pulse
    usesUv = cfg.ledColor === "UV";
  }

  // Multi-track & Legacy MWP Z2 checks
  if (cfg.stimId === "multi_phase") {
    const hasCompiledLight = mpComp.slices.some(sl => sl.topLights.length > 0 || sl.bottomLights.length > 0);
    if (!mpComp.hasAnyTempClip && !hasCompiledLight) {
      if (!cfg.timelineClips.length) {
        add("warn", "Multi-track timeline is empty", "The run will stay dark (IR tracking only) for the whole timeline.", "stimulus");
      } else {
        add("warn", "Multi-track timeline has no active clips",
          "All clips lie outside the timeline length, so the run will stay dark (IR tracking only) for the whole timeline.", "stimulus");
      }
    } else if (!hasCompiledLight) {
      add("info", "No LED clips on the timeline", "Only temperature changes; the chamber stays dark (IR only).", "stimulus");
    }

    if (cfg.hw !== "Z3") {
      if (hasCompiledLight) {
        add("info", "Brightness levels need an MWP Z3", "On Z2 / Z2S units LED clips simply switch lights on or off.", "study");
      }
      if (mpComp.hasAnyBottomClip) {
        add("warn", "Bottom LED clips need an MWP Z3", "Bottom LEDs use Z3 channels 8-13; MWP Z2 / Z2S GPO6-8 has no independent underneath channel.", "stimulus");
      } else if (sp.mpAcclimLight !== "DARK" && cfg.ledMount !== "OVERHEAD") {
        add("warn", "Underneath LED mount needs an MWP Z3", "MWP Z2 / Z2S GPO6-8 has no independent underneath channel.", "study");
      }
      if (usesUv) {
        add("warn", "UV (365 nm) requires an MWP Z3", "MWP Z2 / Z2S GPO6-8 is RGB only (no 365 nm UV channel); UV falls back to GPO8 (Blue).", "stimulus");
      }
    }
  } else if (cfg.hw !== "Z3") {
    if (cfg.ledMount !== "OVERHEAD") {
      add("warn", "Underneath LED mount needs an MWP Z3", "MWP Z2 / Z2S GPO6-8 has no independent underneath channel.", "study");
    }
    if (cfg.ledColor === "UV") {
      add("warn", "UV (365 nm) requires an MWP Z3", "MWP Z2 / Z2S GPO6-8 is RGB only (no 365 nm UV channel); generated scripts fall back to GPO8 (Blue).", "study");
    }
    if (cfg.ledPct < 100) {
      add("info", "Brightness levels need an MWP Z3", "On Z2 / Z2S units GPO6-8 channels switch full on or off without PWM dimming.", "study");
    }
  }

  // UV (on MWP Z3, where UV is an optional hardware LED option)
  if (usesUv && cfg.hw === "Z3") {
    add("info", "UV light selected", "UV (365 nm) LEDs are only present on units fitted with them.", uvPage);
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

function runPreflightChecks(cfg, bundle) {
  return computePreflightChecks(cfg, bundle);
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
