// Zantiks MWP Script Builder - Sequence preview engine: chamber side view, plate top view, playback
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 9b. Flat 2D Light & Environment Sequence Simulator Engine
// ---------------------------------------------------------------------------
const SIM_LED_PALETTE = {
  UV:    { rgb: [168, 85, 247],  pillBg: "#d8b4fe", pillBorder: "#a855f7", pillText: "#3b0764" },
  BLUE:  { rgb: [59, 130, 246],  pillBg: "#93c5fd", pillBorder: "#3b82f6", pillText: "#172554" },
  GREEN: { rgb: [34, 197, 94],   pillBg: "#86efac", pillBorder: "#22c55e", pillText: "#052e16" },
  WHITE: { rgb: [255, 244, 206], pillBg: "#fef08a", pillBorder: "#eab308", pillText: "#422006" },
  RED:   { rgb: [239, 68, 68],   pillBg: "#fca5a5", pillBorder: "#ef4444", pillText: "#450a0a" }
};

const simState = {
  playing: false,
  tSec: 0,
  speed: 1,
  rafId: null,
  usingTimeout: false,
  lastTs: null,
  plateGeoSig: ""
};

function nowMs() {
  return (typeof performance !== "undefined" && typeof performance.now === "function")
    ? performance.now()
    : Date.now();
}

function setCssVar(el, prop, val) {
  if (!el || !el.style) return;
  if (typeof el.style.setProperty === "function") {
    el.style.setProperty(prop, val);
  } else {
    el.style[prop] = val;
  }
}

function formatSimClockPart(secRaw, forceHours) {
  const s = Math.max(0, Math.floor(Math.round(secRaw * 20) / 20 + 0.0001));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (forceHours || h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function formatSimClock(curSec, totalSec) {
  const useHours = totalSec >= 3600;
  return `${formatSimClockPart(curSec, useHours)} / ${formatSimClockPart(totalSec, useHours)}`;
}

function computeChannelMix(chMap) {
  const order = ["WHITE", "BLUE", "GREEN", "RED", "UV"];
  let rSum = 0, gSum = 0, bSum = 0, maxPct = 0;
  const activeLabels = [];
  for (const cid of order) {
    const pct = Math.max(0, Math.min(100, Number(chMap && chMap[cid]) || 0));
    if (pct > 0) {
      const w = pct / 100;
      const rgb = SIM_LED_PALETTE[cid].rgb;
      rSum += rgb[0] * w;
      gSum += rgb[1] * w;
      bSum += rgb[2] * w;
      if (pct > maxPct) maxPct = pct;
      const shortCode = cid === "WHITE" ? "W" : (cid === "UV" ? "UV" : cid[0]);
      activeLabels.push(`${shortCode}:${pct}%`);
    }
  }
  if (maxPct <= 0) {
    return { active: false, r: 0, g: 0, b: 0, intensity: 0, alpha: 0, activeLabels };
  }
  const peak = Math.max(1, rSum, gSum, bSum);
  const normScale = peak > 255 ? (255 / peak) : (255 / Math.max(180, peak));
  const r = Math.min(255, Math.round(rSum * normScale));
  const g = Math.min(255, Math.round(gSum * normScale));
  const b = Math.min(255, Math.round(bSum * normScale));
  const intensity = Math.min(1, maxPct / 100);
  const alpha = Math.min(0.88, 0.2 + 0.68 * intensity);
  return { active: true, r, g, b, intensity, alpha, activeLabels };
}

function lerpRgbCss(baseRgb, targetRgb, t) {
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(baseRgb[0] + (targetRgb[0] - baseRgb[0]) * k);
  const g = Math.round(baseRgb[1] + (targetRgb[1] - baseRgb[1]) * k);
  const b = Math.round(baseRgb[2] + (targetRgb[2] - baseRgb[2]) * k);
  return `rgb(${r}, ${g}, ${b})`;
}

function ensureSimPlateSvgGeometry(cfg) {
  const svg = document.getElementById("simPlateSvg");
  if (!svg || !cfg || !cfg.plate || !cfg.geo) return;
  const p = cfg.plate;
  const g = cfg.geo;
  const sig = `${p.id}|${g.xOffset}|${g.yOffset}|${g.colStep}|${g.rowStep}|${g.r}`;
  if (simState.plateGeoSig === sig && svg.innerHTML) return;
  simState.plateGeoSig = sig;

  const isPetri = p.id === "petri";
  const trayW = isPetri ? 132 : 127.8;
  const trayH = 85.5;
  let markup = `<rect class="sim-svg-tray" x="0" y="0" width="${trayW}" height="${trayH}" rx="${isPetri ? 8 : 5}"/>`;
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const cx = g.xOffset + c * g.colStep;
      const cy = g.yOffset + r * g.rowStep;
      if (p.shape === "SQUARE") {
        const s = g.r;
        const sc = s * 0.58;
        markup += `<rect class="sim-svg-well" x="${(cx - s / 2).toFixed(2)}" y="${(cy - s / 2).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}"/>`;
        markup += `<rect class="sim-svg-core" x="${(cx - sc / 2).toFixed(2)}" y="${(cy - sc / 2).toFixed(2)}" width="${sc.toFixed(2)}" height="${sc.toFixed(2)}"/>`;
      } else {
        const rc = g.r * 0.58;
        markup += `<circle class="sim-svg-well" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${g.r.toFixed(2)}"/>`;
        markup += `<circle class="sim-svg-core" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rc.toFixed(2)}"/>`;
      }
    }
  }
  svg.innerHTML = markup;
}

function renderSimulatorFrame(cfgIn) {
  const cfg = cfgIn || refreshAll._latestCfg || readConfig();
  const sampled = sampleAssayStateAtTime(cfg, simState.tSec);
  simState.tSec = sampled.tSec;

  const scrubEl = document.getElementById("simScrubber");
  if (scrubEl) {
    scrubEl.max = String(Math.max(1, sampled.totalRuntimeSec));
    scrubEl.value = String(sampled.tSec);
  }
  setText("simTimeReadout", formatSimClock(sampled.tSec, sampled.totalRuntimeSec));
  setText("simPhaseBadge", sampled.phaseName);
  setText("simIrBadge", cfg.hw === "Z3" ? "IR 850nm ON (Ch 2/10)" : "IR 850nm ON (Z2)");

  const ledIds = ["UV", "BLUE", "GREEN", "WHITE", "RED"];
  for (const cid of ledIds) {
    const pal = SIM_LED_PALETTE[cid];
    const topPct = sampled.topChannels[cid] || 0;
    const topPill = document.getElementById("simLed_TOP_" + cid);
    if (topPill) {
      topPill.classList.toggle("on", topPct > 0);
      topPill.style.background = topPct > 0 ? pal.pillBg : "";
      topPill.style.borderColor = topPct > 0 ? pal.pillBorder : "";
      topPill.style.color = topPct > 0 ? pal.pillText : "";
    }
    setText("simPct_TOP_" + cid, `${topPct}%`);

    const botPct = sampled.bottomChannels[cid] || 0;
    const botPill = document.getElementById("simLed_BOT_" + cid);
    if (botPill) {
      botPill.classList.toggle("on", botPct > 0);
      botPill.style.background = botPct > 0 ? pal.pillBg : "";
      botPill.style.borderColor = botPct > 0 ? pal.pillBorder : "";
      botPill.style.color = botPct > 0 ? pal.pillText : "";
    }
    setText("simPct_BOT_" + cid, `${botPct}%`);
  }

  const topMix = computeChannelMix(sampled.topChannels);
  const botMix = computeChannelMix(sampled.bottomChannels);

  const topWash = document.getElementById("simTopWash");
  if (topWash) {
    topWash.style.background = topMix.active
      ? `linear-gradient(to bottom, rgba(${topMix.r}, ${topMix.g}, ${topMix.b}, ${topMix.alpha.toFixed(3)}), rgba(${topMix.r}, ${topMix.g}, ${topMix.b}, 0))`
      : "none";
  }
  const botWash = document.getElementById("simBotWash");
  if (botWash) {
    botWash.style.background = botMix.active
      ? `linear-gradient(to top, rgba(${botMix.r}, ${botMix.g}, ${botMix.b}, ${botMix.alpha.toFixed(3)}), rgba(${botMix.r}, ${botMix.g}, ${botMix.b}, 0))`
      : "none";
  }

  setText("simPlateCrossLabel", `${cfg.plate.name} Tray`);
  const tempBadge = document.getElementById("simTempBadge");
  if (tempBadge) {
    if (sampled.tempC !== null) {
      tempBadge.textContent = `${sampled.tempC.toFixed(1)} \u00B0C`;
      if (sampled.tempC <= 21) {
        tempBadge.style.background = "#0c4a6e";
        tempBadge.style.borderColor = "#38bdf8";
        tempBadge.style.color = "#e0f2fe";
      } else if (sampled.tempC >= 26) {
        tempBadge.style.background = "#7c2d12";
        tempBadge.style.borderColor = "#fb923c";
        tempBadge.style.color = "#ffedd5";
      } else {
        tempBadge.style.background = "#1e293b";
        tempBadge.style.borderColor = "#64748b";
        tempBadge.style.color = "#f8fafc";
      }
    } else {
      tempBadge.textContent = "Ambient (Off)";
      tempBadge.style.background = "#111827";
      tempBadge.style.borderColor = "#334155";
      tempBadge.style.color = "#94a3b8";
    }
  }

  const plateCross = document.getElementById("simPlateCrossBar");
  const vibBadge = document.getElementById("simVibBadge");
  if (plateCross) plateCross.classList.toggle("is-vibrating", Boolean(sampled.vibration));
  if (vibBadge) {
    vibBadge.classList.toggle("active", Boolean(sampled.vibration));
    vibBadge.textContent = sampled.vibration
      ? `TAP ${sampled.vibration}`
      : (cfg.stimId === "vibration_startle" ? "Stepper Armed" : "Motor Idle");
  }

  // 2D Top-Down Plate Illumination
  ensureSimPlateSvgGeometry(cfg);
  const simSvg = document.getElementById("simPlateSvg");
  if (simSvg) {
    if (!topMix.active && !botMix.active) {
      setCssVar(simSvg, "--sim-tray-fill", "#161f30");
      setCssVar(simSvg, "--sim-tray-stroke", "#475569");
      setCssVar(simSvg, "--sim-well-fill", "#0b111e");
      setCssVar(simSvg, "--sim-well-stroke", "rgba(239, 68, 68, 0.45)");
      setCssVar(simSvg, "--sim-core-fill", "rgba(239, 68, 68, 0.08)");
    } else if (topMix.active && !botMix.active) {
      setCssVar(simSvg, "--sim-tray-fill", lerpRgbCss([26, 36, 54], [topMix.r, topMix.g, topMix.b], 0.25 + 0.50 * topMix.intensity));
      setCssVar(simSvg, "--sim-tray-stroke", lerpRgbCss([71, 85, 105], [topMix.r, topMix.g, topMix.b], 0.55));
      setCssVar(simSvg, "--sim-well-fill", lerpRgbCss([15, 23, 42], [topMix.r, topMix.g, topMix.b], 0.38 + 0.58 * topMix.intensity));
      setCssVar(simSvg, "--sim-well-stroke", lerpRgbCss([51, 65, 85], [topMix.r, topMix.g, topMix.b], 0.75));
      setCssVar(simSvg, "--sim-core-fill", "transparent");
    } else if (!topMix.active && botMix.active) {
      setCssVar(simSvg, "--sim-tray-fill", "#161f30");
      setCssVar(simSvg, "--sim-tray-stroke", "#475569");
      setCssVar(simSvg, "--sim-well-fill", lerpRgbCss([15, 23, 42], [botMix.r, botMix.g, botMix.b], 0.42 + 0.56 * botMix.intensity));
      setCssVar(simSvg, "--sim-well-stroke", lerpRgbCss([71, 85, 105], [botMix.r, botMix.g, botMix.b], 0.8));
      setCssVar(simSvg, "--sim-core-fill", `rgba(255, 255, 255, ${(0.22 * botMix.intensity).toFixed(2)})`);
    } else {
      const combMap = {};
      for (const cid of ledIds) {
        combMap[cid] = Math.min(100, (sampled.topChannels[cid] || 0) + (sampled.bottomChannels[cid] || 0));
      }
      const combMix = computeChannelMix(combMap);
      setCssVar(simSvg, "--sim-tray-fill", lerpRgbCss([26, 36, 54], [topMix.r, topMix.g, topMix.b], 0.28 + 0.48 * topMix.intensity));
      setCssVar(simSvg, "--sim-tray-stroke", lerpRgbCss([71, 85, 105], [topMix.r, topMix.g, topMix.b], 0.6));
      setCssVar(simSvg, "--sim-well-fill", lerpRgbCss([15, 23, 42], [combMix.r, combMix.g, combMix.b], 0.45 + 0.52 * combMix.intensity));
      setCssVar(simSvg, "--sim-well-stroke", lerpRgbCss([71, 85, 105], [combMix.r, combMix.g, combMix.b], 0.85));
      setCssVar(simSvg, "--sim-core-fill", `rgba(${botMix.r}, ${botMix.g}, ${botMix.b}, ${(0.55 + 0.40 * botMix.intensity).toFixed(2)})`);
    }
  }

  let mixText = "IR Dark (Visible 0%)";
  if (topMix.active && botMix.active) {
    const totalCh = topMix.activeLabels.length + botMix.activeLabels.length;
    const tJoin = (totalCh > 3 ? topMix.activeLabels.map(s => s.split(":")[0]) : topMix.activeLabels).join("+");
    const bJoin = (totalCh > 3 ? botMix.activeLabels.map(s => s.split(":")[0]) : botMix.activeLabels).join("+");
    mixText = `T[${tJoin}] B[${bJoin}]`;
  } else if (topMix.active) {
    const tJoin = (topMix.activeLabels.length > 3 ? topMix.activeLabels.map(s => s.split(":")[0]) : topMix.activeLabels).join("+");
    mixText = `Top ${tJoin}`;
  } else if (botMix.active) {
    const bJoin = (botMix.activeLabels.length > 3 ? botMix.activeLabels.map(s => s.split(":")[0]) : botMix.activeLabels).join("+");
    mixText = `Bot ${bJoin}`;
  }
  setText("simLightMixBadge", mixText);

  const firstWell = cfg.wells[0];
  const lastWell = cfg.wells[cfg.wells.length - 1];
  const rangeStr = cfg.numWells === 1 ? "A1" : `${firstWell}-${lastWell}`;
  setText("simTopDownCaption",
    `${cfg.plate.name} (${rangeStr}) \u00B7 ${topMix.active && botMix.active ? "Top Deck + Bottom Core" : (botMix.active ? "Bottom Trans-Illum" : (topMix.active ? "Overhead Epi-Illum" : "850nm IR Tracking"))}`
  );

  // Live Hardware Channel Readout
  const hwBar = document.getElementById("simHwReadout");
  if (hwBar) {
    const thermStr = sampled.tempC !== null ? `THERMOSTAT=${sampled.tempC.toFixed(1)}\u00B0C` : "THERMOSTAT=OFF";
    const vibStr = sampled.vibration ? ` \u00B7 <code>ZCOMMAND("${sampled.vibration} ...")</code>` : "";
    if (cfg.hw === "Z3") {
      const topOrder = [["UV", 0], ["BLUE", 1], ["GREEN", 3], ["WHITE", 4], ["RED", 5]];
      const botOrder = [["UV", 8], ["BLUE", 9], ["GREEN", 11], ["WHITE", 12], ["RED", 13]];
      const topPairs = topOrder
        .filter(([cid]) => (sampled.topChannels[cid] || 0) > 0)
        .map(([cid, ch]) => `Ch${ch}:${Math.round(((sampled.topChannels[cid] || 0) / 100) * 4095)}`);
      const botPairs = botOrder
        .filter(([cid]) => (sampled.bottomChannels[cid] || 0) > 0)
        .map(([cid, ch]) => `Ch${ch}:${Math.round(((sampled.bottomChannels[cid] || 0) / 100) * 4095)}`);
      const topTxt = topPairs.length ? topPairs.join(" ") : "0";
      const botTxt = botPairs.length ? botPairs.join(" ") : "0";
      hwBar.innerHTML =
        `<span class="sim-hw-left"><code>X_LED_DRIVE</code> Top[${topTxt}] \u00B7 Bot[${botTxt}] \u00B7 IR[Ch2,Ch10:ON]${vibStr}</span>` +
        `<span class="sim-hw-right"><code>${thermStr}</code></span>`;
    } else {
      const gpoSet = new Set();
      for (const cid of ledIds) {
        if ((sampled.topChannels[cid] || 0) > 0 || (sampled.bottomChannels[cid] || 0) > 0) {
          for (const g of LED_COLORS[cid].z2Gpo) gpoSet.add(g);
        }
      }
      hwBar.innerHTML =
        `<span class="sim-hw-left"><code>Z2 GPO</code> GPO6=${gpoSet.has(6) ? 1 : 0} GPO7=${gpoSet.has(7) ? 1 : 0} GPO8=${gpoSet.has(8) ? 1 : 0} \u00B7 IR:ON${vibStr}</span>` +
        `<span class="sim-hw-right"><code>${thermStr}</code></span>`;
    }
  }

  // Sync Full-Assay Timeline Bar Playhead across all 8 protocols
  const tlPh = document.getElementById("timelinePlayhead");
  if (tlPh) {
    const tlPct = timelineSecToPct(sampled.tSec);
    const tlRatio = Math.max(0, Math.min(1, tlPct / 100));
    tlPh.style.display = "block";
    tlPh.style.left = `calc(1px + (100% - 2px) * ${tlRatio.toFixed(5)})`;
    tlPh.classList.toggle("is-acclim", sampled.tSec < timelineModel.preSetupSec);
  }

  // Sync NLE Playhead when Multi-Track Timeline is active (parked at 0s during Acclim/Autoref, 100% at end)
  const ph = document.getElementById("nlePlayhead");
  if (ph) {
    if (cfg.stimId === "multi_phase") {
      ph.style.display = "block";
      if (sampled.nlePlayheadPct === null) {
        ph.classList.add("is-acclim");
        ph.style.left = "var(--nle-hdr-w)";
      } else {
        const ratio = Math.max(0, Math.min(1, sampled.nlePlayheadPct / 100));
        ph.classList.remove("is-acclim");
        ph.style.left = `calc(var(--nle-hdr-w) + (100% - var(--nle-hdr-w) - 1px) * ${ratio.toFixed(5)})`;
      }
    } else {
      ph.style.display = "none";
    }
  }
}

function pauseSimulator() {
  if (simState.rafId !== null) {
    if (simState.usingTimeout) {
      clearTimeout(simState.rafId);
    } else if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(simState.rafId);
    }
    simState.rafId = null;
  }
  simState.playing = false;
  simState.lastTs = null;
  const playBtn = document.getElementById("simPlayBtn");
  if (playBtn) playBtn.textContent = "\u25B6 Play";
}

function scheduleSimTick(cb) {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    simState.usingTimeout = false;
    simState.rafId = window.requestAnimationFrame(cb);
  } else {
    simState.usingTimeout = true;
    simState.rafId = setTimeout(() => cb(nowMs()), 16);
  }
}

function startSimulator() {
  if (simState.playing) return;
  const cfg = refreshAll._latestCfg || readConfig();
  const maxT = refreshAll._latestBundle ? refreshAll._latestBundle[4].totalRuntimeSec : generateStep4(cfg).totalRuntimeSec;
  if (simState.tSec >= maxT - 0.01) {
    simState.tSec = 0;
  }
  simState.playing = true;
  simState.lastTs = nowMs();
  const playBtn = document.getElementById("simPlayBtn");
  if (playBtn) playBtn.textContent = "\u23F8 Pause";

  const tick = (ts) => {
    if (!simState.playing) return;
    const curTs = typeof ts === "number" ? ts : nowMs();
    const dt = Math.max(0, Math.min(0.25, (curTs - (simState.lastTs || curTs)) / 1000));
    simState.lastTs = curTs;

    const cfgNow = refreshAll._latestCfg || readConfig();
    const endT = refreshAll._latestBundle ? refreshAll._latestBundle[4].totalRuntimeSec : generateStep4(cfgNow).totalRuntimeSec;
    simState.tSec = Math.min(endT, simState.tSec + dt * simState.speed);
    renderSimulatorFrame(cfgNow);

    if (simState.tSec >= endT) {
      pauseSimulator();
    } else {
      scheduleSimTick(tick);
    }
  };
  scheduleSimTick(tick);
}

function setSimulatorTime(nextSec) {
  const cfg = refreshAll._latestCfg || readConfig();
  const maxT = refreshAll._latestBundle ? refreshAll._latestBundle[4].totalRuntimeSec : generateStep4(cfg).totalRuntimeSec;
  simState.tSec = Math.max(0, Math.min(maxT, parseFloat(nextSec) || 0));
  if (simState.playing) simState.lastTs = nowMs();
  renderSimulatorFrame(cfg);
}

function bindSimulatorEvents() {
  const playBtn = document.getElementById("simPlayBtn");
  const resetSimBtn = document.getElementById("simResetBtn");
  const speedSel = document.getElementById("simSpeedSel");
  const scrubber = document.getElementById("simScrubber");
  const timelineBar = document.getElementById("timelineBar");

  if (playBtn) {
    playBtn.addEventListener("click", () => {
      if (simState.playing) pauseSimulator();
      else startSimulator();
    });
  }
  if (resetSimBtn) {
    resetSimBtn.addEventListener("click", () => {
      pauseSimulator();
      setSimulatorTime(0);
    });
  }
  if (speedSel) {
    speedSel.addEventListener("change", () => {
      simState.speed = Math.max(1, parseFloat(speedSel.value) || 1);
    });
  }
  if (scrubber) {
    const onScrub = () => setSimulatorTime(scrubber.value);
    scrubber.addEventListener("input", onScrub);
    scrubber.addEventListener("change", onScrub);
  }
  if (timelineBar) {
    const scrubFromTimelineX = (clientX) => {
      const rect = timelineBar.getBoundingClientRect();
      const innerLeft = rect.left + 1;
      const innerW = Math.max(1, rect.width - 2);
      const ratio = Math.max(0, Math.min(1, (clientX - innerLeft) / innerW));
      setSimulatorTime(timelineRatioToSec(ratio));
    };

    timelineBar.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      scrubFromTimelineX(e.clientX);
      const onMove = (me) => scrubFromTimelineX(me.clientX);
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }
  if (typeof window !== "undefined" && window.ZANTIKS_SIMULATOR) {
    window.ZANTIKS_SIMULATOR.timelineSecToPct = timelineSecToPct;
    window.ZANTIKS_SIMULATOR.timelineRatioToSec = timelineRatioToSec;
    window.ZANTIKS_SIMULATOR.getTimelineModel = () => timelineModel;
  }
}

function refreshAll() {
  const cfg = readConfig();
  const bundle = generateAllSteps(cfg);
  const activeObj = bundle[state.activeStep];
  const s4 = bundle[4];

  refreshAll._latestBundle = bundle;
  refreshAll._latestCfg = cfg;

  // Researcher filename preview & non-ASCII warning
  document.getElementById("previewFolderName").textContent = `${s4.bundleFolder}/`;
  document.getElementById("previewMainScript").textContent = s4.filename;
  document.getElementById("nameAsciiWarn").classList.toggle("show", cfg.hasNonAsciiWarning);

  // Header badge
  document.getElementById("hwBadge").textContent = "MWP " + cfg.hw;
  const orgObj = ORGANISM_PRESETS.find(o => o.id === state.organism);

  // Visual previews, 2D simulator & geometry status
  updateConfigStatusBadges();
  renderPlateSvg(cfg);
  renderTimeline(cfg, s4);
  simState.tSec = Math.max(0, Math.min(s4.totalRuntimeSec, simState.tSec));
  renderSimulatorFrame(cfg);

  // Summary strip stats
  const first = cfg.wells[0];
  const last = cfg.wells[cfg.wells.length - 1];
  document.getElementById("statWells").textContent =
    cfg.numWells === 1 ? "1 (A1)" : `${cfg.numWells} (${first}-${last})`;
  document.getElementById("statRuntime").textContent = formatDuration(s4.totalRuntimeSec);
  document.getElementById("statRows").textContent = `${s4.totalRows} rows`;
  document.getElementById("statFiles").textContent =
    s4.csvCount === 2 ? "2 CSVs (Summary + XY)" : "1 Summary CSV";
  renderRunSummary(cfg, s4, orgObj);

  // Active step tab content
  document.getElementById("currentFilename").textContent = activeObj.filename;
  document.getElementById("stepInstructionText").innerHTML = activeObj.instruction;
  document.getElementById("csvSchemaBox").innerHTML = `<code>${activeObj.schemaText}</code>`;
  document.getElementById("codePreview").innerHTML = highlightZanscript(activeObj.code);
}
