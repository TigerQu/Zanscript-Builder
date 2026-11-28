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
const VIDEO_FPS = { "1fps": 1, "0.2fps": 0.2, "full": 30, "dual": 31, "off": 0 };

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

  // Short pulses & fractional multi-bin tail pulses
  if (cfg.stimId === "light_off_startle" || cfg.stimId === "light_on_pulse") {
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const pulseDur = Math.max(cfg.stimId === "light_off_startle" ? 0.1 : 0.05, parseFloat(sp.pulseDurSec) || 1);
    if (pulseDur < bin) {
      add("info", `Pulse (${pulseDur} s) is shorter than the time bin (${bin} s)`,
        "Each pulse is recorded inside a single time bin, so its effect is averaged over the whole bin.", "stimulus");
    } else {
      const fullPulseBins = Math.floor((pulseDur + 1e-9) / bin);
      const remPulse = Number((pulseDur - fullPulseBins * bin).toFixed(3));
      if (fullPulseBins >= 1 && remPulse >= 0.001) {
        const postWait = Number((bin - remPulse).toFixed(3));
        add("info", `Pulse (${pulseDur} s) ends mid-bin in bin ${fullPulseBins + 1}`,
          `Exact ${pulseDur} s pulse duration is preserved across ${fullPulseBins} full ${bin} s bin${fullPulseBins === 1 ? "" : "s"} plus a final bin sharing ${remPulse} s pulse + ${postWait} s recovery.`,
          "stimulus");
      }
    }
  }

  // Phase / hold duration bin rounding (L/D transitions & Temperature Ramp)
  if (cfg.stimId === "ld_transitions") {
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const phaseRaw = Math.max(bin, parseInt(sp.ldPhaseSec, 10) || 300);
    const actualPhaseSec = Math.max(1, Math.round(phaseRaw / bin)) * bin;
    if (Math.abs(actualPhaseSec - phaseRaw) > 1e-6) {
      add("info", `Phase duration adjusted from ${phaseRaw} s to ${actualPhaseSec} s`,
        `Requested L/D phase (${phaseRaw} s) is rounded to ${actualPhaseSec / bin} x ${bin} s bins.`,
        "stimulus");
    }
  } else if (cfg.stimId === "temp_ramp") {
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const holdRaw = Math.max(bin, parseInt(sp.rampHoldSec, 10) || 300);
    const actualHoldSec = Math.max(1, Math.round(holdRaw / bin)) * bin;
    if (Math.abs(actualHoldSec - holdRaw) > 1e-6) {
      add("info", `Temperature hold adjusted from ${holdRaw} s to ${actualHoldSec} s`,
        `Requested hold duration (${holdRaw} s) is rounded to ${actualHoldSec / bin} x ${bin} s bins.`,
        "stimulus");
    }
  }

  // Pre-stimulus baseline bin alignment across all 5 startle & PPI protocols
  if (["light_off_startle", "light_on_pulse", "vibration_startle", "acoustic_startle", "ppi"].includes(cfg.stimId)) {
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
    const preBins = preSec > 0 ? Math.max(1, Math.round(preSec / bin)) : 0;
    const actualPreSec = preBins * bin;
    if (preSec > 0 && Math.abs(actualPreSec - preSec) > 1e-6) {
      add("info", `Pre-stimulus baseline adjusted from ${preSec} s to ${actualPreSec} s`,
        `Aligned to ${preBins} x ${bin} s time bin${preBins === 1 ? "" : "s"} so the baseline phase is preserved in the summary CSV.`,
        "stimulus");
    }
  }

  // PPI short-ISI host dispatch timing note
  if (cfg.stimId === "ppi") {
    const isiMs = Math.min(2000, Math.max(50, parseInt(sp.ppiIsiMs, 10) || 300));
    const isiSec = Number((isiMs / 1000).toFixed(3));
    if (isiMs < 150) {
      add("info", `Short PPI ISI (${isiMs} ms) uses host WAIT(${isiSec})`,
        "Split two-command PPI aligns PULSE_ALONE and PPI_TRIAL snapshots to main-pulse onset, but host WAIT(ISI_SEC) + two serial ZCOMMAND dispatches can add ~10-30 ms jitter below 150 ms. Run a quick dry-run and inspect PPI_TRIAL CSV RUNTIME spacing.",
        "stimulus");
    }
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
  } else if (cfg.stimId === "acoustic_startle") {
    usesUv = sp.audioAmbient === "LIGHT" && cfg.ledColor === "UV";
  } else if (cfg.stimId === "ppi") {
    usesUv = sp.ppiAmbient === "LIGHT" && cfg.ledColor === "UV";
  } else if (cfg.stimId === "temp_ramp") {
    usesUv = sp.rampLight === "LIGHT" && cfg.ledColor === "UV";
  } else if (cfg.stimId === "circadian") {
    usesUv = Math.max(0, parseIntOr(sp.lightHours, 16)) > 0 && cfg.ledColor === "UV";
  } else {
    // ld_transitions, light_off_startle, light_on_pulse
    usesUv = cfg.ledColor === "UV";
  }

  // Custom .wav audio asset reminder
  const customAudioFiles = new Set();
  if (cfg.stimId === "acoustic_startle" && sp.audioFile === "custom") {
    const fn = sanitizeAudioAsset(sp.audioCustomFile || "stereo.wav");
    if (!AUDIO_BUILTINS.includes(fn)) customAudioFiles.add(fn);
  } else if (cfg.stimId === "multi_phase" && mpComp && mpComp.hasAnyAudioClip) {
    for (const sl of mpComp.slices) {
      if (sl.audioTrigger && sl.audioFile && !AUDIO_BUILTINS.includes(sl.audioFile)) {
        customAudioFiles.add(sl.audioFile);
      }
    }
  }
  if (customAudioFiles.size > 0) {
    const filesStr = [...customAudioFiles].map(f => `"${f}"`).join(", ");
    add("info", `Custom audio file required (${filesStr})`,
      "Upload custom .wav audio files into the unit's Assets directory before running Step 4.", "stimulus");
  }

  // Multi-track & Legacy MWP Z2 checks
  if (cfg.stimId === "multi_phase") {
    const hasCompiledLight = mpComp.slices.some(sl => sl.topLights.length > 0 || sl.bottomLights.length > 0);
    const hasCompiledStim = Boolean(mpComp.hasAnyVibClip || mpComp.hasAnyAudioClip);
    if (!mpComp.hasAnyTempClip && !hasCompiledLight && !hasCompiledStim) {
      if (!cfg.timelineClips.length) {
        add("warn", "Multi-track timeline is empty", "The run will stay dark (IR tracking only) for the whole timeline.", "stimulus");
      } else {
        add("warn", "Multi-track timeline has no active clips",
          "All clips lie outside the timeline length, so the run will stay dark (IR tracking only) for the whole timeline.", "stimulus");
      }
    } else if (!hasCompiledLight) {
      add("info", "No LED clips on the timeline", "Visible LEDs stay off (IR tracking only) while environment / stimulus tracks run.", "stimulus");
    }

    if (mpComp && Array.isArray(mpComp.truncatedRepeats) && mpComp.truncatedRepeats.length > 0) {
      const capLim = typeof MAX_REPEAT_TRIGGERS !== "undefined" ? MAX_REPEAT_TRIGGERS : 120;
      const summaryStr = mpComp.truncatedRepeats
        .map(tr => `${tr.track} (${tr.capped} of ${tr.expected} triggers)`)
        .join(", ");
      add("warn", `Repeat triggers capped at ${capLim} per clip`,
        `Repeat count exceeded the ${capLim}-trigger limit: ${summaryStr}. Use a larger repeat interval or switch to a dedicated Startle protocol.`,
        "stimulus");
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

  // Stepper motor vibration hardware check on legacy MWP Z2
  const usesStepperVib = cfg.stimId === "vibration_startle" ||
    cfg.stimId === "ppi" ||
    (cfg.stimId === "multi_phase" && mpComp && mpComp.hasAnyVibClip);
  if (usesStepperVib && cfg.hw !== "Z3") {
    add("warn", "Stepper vibration requires MWP Z2S or Z3",
      "ZCOMMAND(\"U...\") drives the stepper vibration stand on MWP Z2S / Z3; early non-stepper MWP Z2 units will ignore it.", "study");
  }

  // Circadian 0L:0D, Dawn/Dusk ramp on legacy Z2, non-divisor bin padding & AUTOREF_MODE,2 pacing
  if (cfg.stimId === "circadian") {
    const c = computeCircadianSchedule(cfg);
    if (!c.hasAnyHours) {
      add("warn", "Both Light Hours and Dark Hours are 0",
        "Set at least one phase (Light Hours or Dark Hours) to ≥ 1 hour so the circadian schedule records data.", "stimulus");
    }
    if (parseIntOr(sp.circRampMin, 0) > 0 && c.lightHrs > 0 && c.darkHrs > 0 && cfg.hw !== "Z3") {
      add("warn", "Smooth Dawn/Dusk PWM ramp needs an MWP Z3",
        "MWP Z2 / Z2S GPO6-8 switches lights on/off without PWM dimming; ramp duration is skipped on Z2.", "study");
    }
    if (c.hasAnyHours && c.hourPadSec > 0) {
      add("info", `Time bin (${c.bin} s) adds ${c.hourPadSec} s unbinned wait per hour`,
        `3,300 s active tracking + 300 s autoref per hour is not evenly divisible by ${c.bin} s, so WAIT(${c.hourPadSec}) is appended per hour to preserve exact 60-min hours. Use an exact divisor (1, 5, 10, 15, 20, 30, 60, or 300 s) for zero padding.`, "stimulus");
    }
    if (c.hasAnyHours) {
      add("info", "Hourly pacing assumes AUTOREF_MODE,2 runs full 300 s",
        "Following Zantiks' official circadian template, each hour pairs 55 min active tracking with 5 min AUTOREFERENCE() (SET(AUTOREF_MODE,2), AUTOREF_TIMEOUT 300). Run a 1-hour dry-run and check the CSV RUNTIME gap (or confirm with Zantiks that AUTOREF_MODE,2 does not exit early).", "stimulus");
    }
  }

  // Zone-changes-only stream 2 summary notice
  if (cfg.useZoneChanges && !cfg.useDist && !cfg.useMsd && !cfg.useZones) {
    add("info", "Summary CSV (stream 2) includes DIST_* baseline",
      "Because no binned summary metric was checked alongside Zone Entry/Exit Events, stream 2 records ARENA_DISTANCES by default while stream 0 logs _ZCHANGE transitions.", "data");
  }

  // UV (on MWP Z3, where UV is an optional hardware LED option)
  if (usesUv && cfg.hw === "Z3") {
    add("info", "UV light selected", "UV (365 nm) LEDs are only present on units fitted with them.", uvPage);
  }

  // Video size
  const fps = VIDEO_FPS[cfg.videoMode];
  if (fps) {
    const frames = s4.totalRuntimeSec * fps;
    if ((cfg.videoMode === "full" || cfg.videoMode === "dual") && s4.totalRuntimeSec > 1800) {
      add("warn", `${cfg.videoMode === "dual" ? "Dual-stream (30 + 1 fps)" : "Full 30 fps"} video for ${formatDuration(s4.totalRuntimeSec)}`,
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

  // Maze & Calibration checks
  if (cfg.isMaze) {
    if (cfg.plate.isCustomMaze && (!cfg.mazeShapes || cfg.mazeShapes.length === 0)) {
      add("warn", "Custom 3D maze has no shapes yet",
        "Add at least one arena/zone shape in the Plate & Maze editor before exporting Step 2.", "plate");
    }
    if (!cfg.useZones && !cfg.useZoneChanges) {
      add("info", `${cfg.plate.name} zones are not logged yet`,
        `Enable Zone Summary (ZD/ZC/ZT for Z1-${cfg.numZones}) or Zone Entry/Exit Events on Data & Video to record arm/chamber occupancy.`, "data");
    }
  } else if (!isPlateCustomized(state.plateId)) {
    add("info", `Factory offsets for ${cfg.plate.name}`,
      "Calibrating the plate offsets on your own unit gives the most accurate well positions.", "plate");
  }

  // Always-on summary of what is ready
  add("ok", `4 scripts, ${s4.csvCount} CSV file${s4.csvCount === 1 ? "" : "s"} ready`,
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
