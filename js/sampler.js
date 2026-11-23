// Zantiks MWP Script Builder - Pure assay-state sampler used by the sequence preview (all protocols)
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 6b. Pure Assay State Sampler for Flat 2D Sequence Simulator (All 8 Protocols)
// ---------------------------------------------------------------------------
function sampleAssayStateAtTime(cfg, tSecRaw) {
  const topChannels = { WHITE: 0, BLUE: 0, GREEN: 0, RED: 0, UV: 0 };
  const bottomChannels = { WHITE: 0, BLUE: 0, GREEN: 0, RED: 0, UV: 0 };
  if (!cfg) {
    return {
      tSec: 0,
      totalRuntimeSec: 0,
      phaseName: "IDLE",
      topChannels,
      bottomChannels,
      tempC: null,
      vibration: null,
      audio: null,
      nlePlayheadPct: null
    };
  }

  const sp = cfg.sp || {};
  const hw = cfg.hw || "Z3";
  const mount = cfg.ledMount || "OVERHEAD";
  const useTop = hw === "Z2" ? true : (mount === "OVERHEAD" || mount === "BOTH");
  const useBot = hw === "Z2" ? false : (mount === "UNDERNEATH" || mount === "BOTH");
  const colId = (cfg.ledColor && LED_COLORS[cfg.ledColor]) ? cfg.ledColor : "WHITE";
  const activeLightTag = (LED_COLORS[colId] && LED_COLORS[colId].tag) ? LED_COLORS[colId].tag : "LIGHT";
  const globalPct = hw === "Z3" ? Math.min(100, Math.max(5, Math.round(cfg.ledPct || 100))) : 100;
  const autorefBase = Math.max(0, parseInt(cfg.autorefTimeout, 10) || 0);

  const setSingleChannelOn = (cid) => {
    const targetId = (cid && LED_COLORS[cid]) ? cid : colId;
    if (useTop) topChannels[targetId] = globalPct;
    if (useBot) bottomChannels[targetId] = globalPct;
  };

  let totalRuntimeSec = 0;
  let phaseName = "READY";
  let tempC = cfg.useThermostat ? Number((parseFloat(cfg.thermostatTemp) || 22).toFixed(1)) : null;
  let vibration = null;
  let audio = null;
  let nlePlayheadPct = null;

  if (cfg.stimId === "baseline") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const dur = Math.max(bin, parseInt(sp.durationSec, 10) || 600);
    const numBins = Math.max(1, Math.round(dur / bin));
    const recDur = numBins * bin;
    totalRuntimeSec = acclim + autorefBase + recDur;
    const t = Math.max(0, Math.min(totalRuntimeSec, parseFloat(tSecRaw) || 0));
    const isDark = sp.baseLight === "DARK";
    if (!isDark) setSingleChannelOn(colId);

    if (t < acclim) {
      phaseName = "ACCLIMATION";
    } else if (t < acclim + autorefBase) {
      phaseName = "AUTOREFERENCING";
    } else {
      phaseName = "TRACKING " + (isDark ? "DARK" : activeLightTag);
    }
    return { tSec: t, totalRuntimeSec, phaseName, topChannels, bottomChannels, tempC, vibration, audio, nlePlayheadPct };
  }

  if (cfg.stimId === "ld_transitions") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const phaseSec = Math.max(bin, parseInt(sp.ldPhaseSec, 10) || 300);
    const phaseBins = Math.max(1, Math.round(phaseSec / bin));
    const phaseDur = phaseBins * bin;
    const cycles = Math.max(1, parseInt(sp.ldCycles, 10) || 2);
    const startLight = sp.ldStart !== "DARK";
    const assayDur = cycles * 2 * phaseDur;
    totalRuntimeSec = acclim + autorefBase + assayDur;
    const t = Math.max(0, Math.min(totalRuntimeSec, parseFloat(tSecRaw) || 0));

    if (t < acclim) {
      if (startLight) setSingleChannelOn(colId);
      phaseName = "ACCLIMATION";
    } else if (t < acclim + autorefBase) {
      if (startLight) setSingleChannelOn(colId);
      phaseName = "AUTOREFERENCING";
    } else {
      const rel = Math.min(Math.max(0, assayDur - 0.0001), t - acclim - autorefBase);
      const cycIdx = Math.min(cycles - 1, Math.floor(rel / (2 * phaseDur)));
      const inCyc = rel - cycIdx * 2 * phaseDur;
      const firstHalf = inCyc < phaseDur;
      const lightOn = firstHalf ? startLight : !startLight;
      if (lightOn) setSingleChannelOn(colId);
      phaseName = `PHASE: ${lightOn ? activeLightTag : "DARK"} (Cycle ${cycIdx + 1}/${cycles})`;
    }
    return { tSec: t, totalRuntimeSec, phaseName, topChannels, bottomChannels, tempC, vibration, audio, nlePlayheadPct };
  }

  if (cfg.stimId === "light_off_startle" || cfg.stimId === "light_on_pulse") {
    const isOffStartle = cfg.stimId === "light_off_startle";
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseInt(sp.preBaselineSec, 10) || 60);
    const preBins = Math.round(preSec / bin);
    const preDur = preBins * bin;
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const pulseDur = Math.max(isOffStartle ? 0.1 : 0.05, parseFloat(sp.pulseDurSec) || 1);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiBins = Math.max(1, Math.round(itiSec / bin));
    const itiDur = itiBins * bin;
    const strobeHz = !isOffStartle && [2, 5, 10].includes(parseInt(sp.strobeHz, 10)) ? parseInt(sp.strobeHz, 10) : 0;

    const subBinPulse = pulseDur < bin;
    const pulseBins = subBinPulse ? 1 : Math.max(1, Math.round(pulseDur / bin));
    const pulseBinDur = pulseBins * bin;
    const activeStimDur = subBinPulse ? pulseDur : pulseBinDur;
    const trialDur = pulseBinDur + itiDur;

    totalRuntimeSec = acclim + autorefBase + preDur + pulses * trialDur;
    const t = Math.max(0, Math.min(totalRuntimeSec, parseFloat(tSecRaw) || 0));

    if (t < acclim) {
      if (isOffStartle) setSingleChannelOn(colId);
      phaseName = isOffStartle ? "ACCLIMATION" : "DARK ACCLIMATION";
    } else if (t < acclim + autorefBase) {
      if (isOffStartle) setSingleChannelOn(colId);
      phaseName = "AUTOREFERENCING";
    } else if (t < acclim + autorefBase + preDur) {
      if (isOffStartle) setSingleChannelOn(colId);
      phaseName = isOffStartle ? "BASELINE" : "DARK BASELINE";
    } else {
      const rel = Math.min(Math.max(0, pulses * trialDur - 0.0001), t - acclim - autorefBase - preDur);
      const trIdx = Math.min(pulses - 1, Math.floor(rel / trialDur));
      const inTrial = rel - trIdx * trialDur;
      const inPulse = inTrial < activeStimDur;
      if (isOffStartle) {
        if (!inPulse) setSingleChannelOn(colId);
        phaseName = inPulse
          ? `LIGHT-OFF PULSE (Trial ${trIdx + 1}/${pulses})`
          : `ITI RECOVERY (Trial ${trIdx + 1}/${pulses})`;
      } else {
        if (inPulse) {
          if (strobeHz > 0) {
            const halfPeriod = 0.5 / strobeHz;
            if (Math.floor(inTrial / halfPeriod) % 2 === 0) setSingleChannelOn(colId);
          } else {
            setSingleChannelOn(colId);
          }
        }
        phaseName = inPulse
          ? `${activeLightTag} ${strobeHz > 0 ? `${strobeHz}HZ STROBE` : "FLASH"} (Trial ${trIdx + 1}/${pulses})`
          : `DARK ITI (Trial ${trIdx + 1}/${pulses})`;
      }
    }
    return { tSec: t, totalRuntimeSec, phaseName, topChannels, bottomChannels, tempC, vibration, audio, nlePlayheadPct };
  }

  if (cfg.stimId === "vibration_startle") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseInt(sp.preBaselineSec, 10) || 60);
    const preBins = Math.round(preSec / bin);
    const preDur = preBins * bin;
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiBins = Math.max(1, Math.round(itiSec / bin));
    const itiDur = itiBins * bin;
    const trialDur = bin + itiDur;
    const stepMode = sp.vibIntensity || "U0";
    if (sp.vibAmbient === "LIGHT") setSingleChannelOn(colId);

    totalRuntimeSec = acclim + autorefBase + preDur + pulses * trialDur;
    const t = Math.max(0, Math.min(totalRuntimeSec, parseFloat(tSecRaw) || 0));

    if (t < acclim) {
      phaseName = "ACCLIMATION";
    } else if (t < acclim + autorefBase) {
      phaseName = "AUTOREFERENCING";
    } else if (t < acclim + autorefBase + preDur) {
      phaseName = "BASELINE";
    } else {
      const rel = Math.min(Math.max(0, pulses * trialDur - 0.0001), t - acclim - autorefBase - preDur);
      const trIdx = Math.min(pulses - 1, Math.floor(rel / trialDur));
      const inTrial = rel - trIdx * trialDur;
      const tapWindow = Math.min(0.8, bin);
      if (inTrial < tapWindow) {
        vibration = stepMode;
        phaseName = `VIBRATION TAP ${stepMode} (Trial ${trIdx + 1}/${pulses})`;
      } else if (inTrial < bin) {
        phaseName = `VIBRATION BIN (Trial ${trIdx + 1}/${pulses})`;
      } else {
        phaseName = `POST-VIB ITI (Trial ${trIdx + 1}/${pulses})`;
      }
    }
    return { tSec: t, totalRuntimeSec, phaseName, topChannels, bottomChannels, tempC, vibration, audio, nlePlayheadPct };
  }

  if (cfg.stimId === "acoustic_startle") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseInt(sp.preBaselineSec, 10) || 60);
    const preBins = Math.round(preSec / bin);
    const preDur = preBins * bin;
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiBins = Math.max(1, Math.round(itiSec / bin));
    const itiDur = itiBins * bin;
    const trialDur = bin + itiDur;
    const audioAsset = sp.audioFile === "custom"
      ? sanitizeAudioAsset(sp.audioCustomFile || "stereo.wav")
      : sanitizeAudioAsset(sp.audioFile || "tone");
    if (sp.audioAmbient === "LIGHT") setSingleChannelOn(colId);

    totalRuntimeSec = acclim + autorefBase + preDur + pulses * trialDur;
    const t = Math.max(0, Math.min(totalRuntimeSec, parseFloat(tSecRaw) || 0));

    if (t < acclim) {
      phaseName = "ACCLIMATION";
    } else if (t < acclim + autorefBase) {
      phaseName = "AUTOREFERENCING";
    } else if (t < acclim + autorefBase + preDur) {
      phaseName = "BASELINE";
    } else {
      const rel = Math.min(Math.max(0, pulses * trialDur - 0.0001), t - acclim - autorefBase - preDur);
      const trIdx = Math.min(pulses - 1, Math.floor(rel / trialDur));
      const inTrial = rel - trIdx * trialDur;
      if (inTrial < bin) {
        audio = audioAsset;
        phaseName = `AUDIO "${audioAsset}" (Trial ${trIdx + 1}/${pulses})`;
      } else {
        phaseName = `POST-AUDIO ITI (Trial ${trIdx + 1}/${pulses})`;
      }
    }
    return { tSec: t, totalRuntimeSec, phaseName, topChannels, bottomChannels, tempC, vibration, audio, nlePlayheadPct };
  }

  if (cfg.stimId === "ppi") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseInt(sp.preBaselineSec, 10) || 60);
    const preBins = Math.round(preSec / bin);
    const preDur = preBins * bin;
    const pairs = Math.max(1, parseInt(sp.ppiPairs, 10) || 5);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiBins = Math.max(1, Math.round(itiSec / bin));
    const itiDur = itiBins * bin;
    const trialDur = bin + itiDur;
    const prepulse = vibLevelToCode(sp.ppiPrepulse || "U3");
    const pulse = vibLevelToCode(sp.ppiPulse || "U0");
    const isiMs = Math.min(2000, Math.max(50, parseInt(sp.ppiIsiMs, 10) || 300));
    const isAlt = (sp.ppiPattern || "alternating") === "alternating";
    const totalTrials = isAlt ? pairs * 2 : pairs;
    if (sp.ppiAmbient === "LIGHT") setSingleChannelOn(colId);

    totalRuntimeSec = acclim + autorefBase + preDur + totalTrials * trialDur;
    const t = Math.max(0, Math.min(totalRuntimeSec, parseFloat(tSecRaw) || 0));

    if (t < acclim) {
      phaseName = "ACCLIMATION";
    } else if (t < acclim + autorefBase) {
      phaseName = "AUTOREFERENCING";
    } else if (t < acclim + autorefBase + preDur) {
      phaseName = "BASELINE";
    } else {
      const rel = Math.min(Math.max(0, totalTrials * trialDur - 0.0001), t - acclim - autorefBase - preDur);
      const trIdx = Math.min(totalTrials - 1, Math.floor(rel / trialDur));
      const inTrial = rel - trIdx * trialDur;
      const isPpiTrial = !isAlt || (trIdx % 2 === 1);
      const tapWindow = Math.min(0.85, bin);
      if (inTrial < tapWindow) {
        vibration = isPpiTrial ? `${prepulse}+${pulse}` : pulse;
        phaseName = isPpiTrial
          ? `PPI ${prepulse}+${isiMs}ms+${pulse} (Trial ${trIdx + 1}/${totalTrials})`
          : `PULSE ALONE ${pulse} (Trial ${trIdx + 1}/${totalTrials})`;
      } else if (inTrial < bin) {
        phaseName = isPpiTrial ? `PPI BIN (Trial ${trIdx + 1}/${totalTrials})` : `PULSE BIN (Trial ${trIdx + 1}/${totalTrials})`;
      } else {
        phaseName = `POST-${isPpiTrial ? "PPI" : "PULSE"} ITI (Trial ${trIdx + 1}/${totalTrials})`;
      }
    }
    return { tSec: t, totalRuntimeSec, phaseName, topChannels, bottomChannels, tempC, vibration, audio, nlePlayheadPct };
  }

  if (cfg.stimId === "circadian") {
    const bin = Math.max(1, parseInt(sp.circBinSec, 10) || 10);
    const lightHrs = Math.max(0, parseInt(sp.lightHours, 10) || 16);
    const darkHrs = Math.max(0, parseInt(sp.darkHours, 10) || 8);
    const days = Math.max(1, parseInt(sp.numDays, 10) || 2);
    const rampMin = hw === "Z3" ? Math.min(30, Math.max(0, parseInt(sp.circRampMin, 10) || 0)) : 0;
    const hasDawnDusk = rampMin > 0 && lightHrs > 0 && darkHrs > 0;
    const rampStepBins = hasDawnDusk ? Math.max(1, Math.round((rampMin * 60) / (6 * bin))) : 0;
    const rampStepDur = rampStepBins * bin;
    const rampDur = hasDawnDusk ? 6 * rampStepDur : 0;
    const autoref = 300;
    const activeSecPerHour = Math.max(bin * 2, 3600 - autoref);
    const halfBins = Math.max(1, Math.floor(activeSecPerHour / (2 * bin)));
    const hourDur = 2 * halfBins * bin + autoref;
    const hrsPerDay = lightHrs + darkHrs;
    const dayDur = hrsPerDay * hourDur + (hasDawnDusk ? 2 * rampDur : 0);
    totalRuntimeSec = autoref + days * dayDur;
    const t = Math.max(0, Math.min(totalRuntimeSec, parseFloat(tSecRaw) || 0));

    const setChannelPct = (pct) => {
      if (pct <= 0) return;
      if (useTop) topChannels[colId] = pct;
      if (useBot) bottomChannels[colId] = pct;
    };

    if (t < autoref || hrsPerDay === 0) {
      setSingleChannelOn(colId);
      phaseName = "AUTOREFERENCING";
    } else {
      const rel = Math.min(Math.max(0, days * dayDur - 0.0001), t - autoref);
      const dayIdx = Math.min(days - 1, Math.floor(rel / dayDur));
      const inDay = rel - dayIdx * dayDur;
      if (hasDawnDusk) {
        const isGammaCirc = sp.circRampCurve !== "linear";
        const dawnFracs = isGammaCirc ? [0.02, 0.08, 0.22, 0.44, 0.72, 1.0] : [0.15, 0.30, 0.50, 0.65, 0.85, 1.0];
        const duskFracs = isGammaCirc ? [0.72, 0.44, 0.22, 0.08, 0.02, 0.0] : [0.85, 0.65, 0.50, 0.30, 0.15, 0.0];
        const lightDur = lightHrs * hourDur;
        if (inDay < rampDur) {
          const st = Math.min(5, Math.floor(inDay / rampStepDur));
          const pct = Math.max(1, Math.round(globalPct * dawnFracs[st]));
          setChannelPct(pct);
          phaseName = `DAY ${dayIdx + 1} DAWN (${pct}%)`;
        } else if (inDay < rampDur + lightDur) {
          const hr = Math.min(lightHrs - 1, Math.floor((inDay - rampDur) / hourDur));
          setSingleChannelOn(colId);
          phaseName = `DAY ${dayIdx + 1} ${activeLightTag} HR ${hr + 1}`;
        } else if (inDay < 2 * rampDur + lightDur) {
          const st = Math.min(5, Math.floor((inDay - rampDur - lightDur) / rampStepDur));
          const pct = Math.round(globalPct * duskFracs[st]);
          setChannelPct(pct);
          phaseName = `DAY ${dayIdx + 1} DUSK (${pct}%)`;
        } else {
          const hr = Math.min(darkHrs - 1, Math.floor((inDay - 2 * rampDur - lightDur) / hourDur));
          phaseName = `DAY ${dayIdx + 1} DARK HR ${hr + 1}`;
        }
      } else {
        const hrIdx = Math.min(hrsPerDay - 1, Math.floor(inDay / hourDur));
        const isLight = hrIdx < lightHrs;
        const phaseHr = isLight ? (hrIdx + 1) : (hrIdx - lightHrs + 1);
        if (isLight) setSingleChannelOn(colId);
        phaseName = `DAY ${dayIdx + 1} ${isLight ? activeLightTag : "DARK"} HR ${phaseHr}`;
      }
    }
    return { tSec: t, totalRuntimeSec, phaseName, topChannels, bottomChannels, tempC, vibration, audio, nlePlayheadPct };
  }

  if (cfg.stimId === "multi_phase") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const cycles = Math.max(1, parseInt(sp.mpCycles, 10) || 1);
    const acclimLight = sp.mpAcclimLight || "DARK";
    const comp = compileMultiTrackSlices(cfg.timelineClips, sp.mpTimelineSec, sp.timeBinSec, cfg.thermostatTemp);
    const cycleDur = comp.totalBins * comp.bin;
    totalRuntimeSec = acclim + autorefBase + cycles * cycleDur;
    const t = Math.max(0, Math.min(totalRuntimeSec, parseFloat(tSecRaw) || 0));

    if (comp.hasAnyTempClip) {
      tempC = comp.initialTemp;
    }

    if (t < acclim + autorefBase) {
      if (acclimLight !== "DARK") {
        setSingleChannelOn(acclimLight);
      }
      phaseName = t < acclim ? "ACCLIMATION" : "AUTOREFERENCING";
      nlePlayheadPct = null;
    } else {
      const relRaw = t - acclim - autorefBase;
      const totalSeqDur = cycles * cycleDur;
      let cycIdx;
      let inCyc;
      if (relRaw >= totalSeqDur) {
        cycIdx = cycles - 1;
        inCyc = cycleDur;
        nlePlayheadPct = 100;
      } else {
        cycIdx = Math.min(cycles - 1, Math.floor(relRaw / cycleDur));
        inCyc = relRaw - cycIdx * cycleDur;
        nlePlayheadPct = Number(((inCyc / Math.max(1, cycleDur)) * 100).toFixed(3));
      }

      const lookupSec = Math.min(Math.max(0, cycleDur - 0.0001), inCyc);
      const sl = comp.slices.find(s => lookupSec >= s.startSec && lookupSec < s.endSec) || comp.slices[comp.slices.length - 1];
      if (sl) {
        const inSlice = Math.max(0, lookupSec - sl.startSec);
        const isLitNow = (l) => (!l.strobeHz || Math.floor(inSlice / (0.5 / l.strobeHz)) % 2 === 0);
        if (hw === "Z3") {
          for (const l of sl.topLights) {
            if (isLitNow(l)) topChannels[l.id] = l.pct;
          }
          for (const l of sl.bottomLights) {
            if (isLitNow(l)) bottomChannels[l.id] = l.pct;
          }
        } else {
          for (const l of sl.lights) {
            if (isLitNow(l)) topChannels[l.id] = 100;
          }
        }
        if (sl.effectiveTemp !== null) {
          tempC = sl.effectiveTemp;
        }
        if (sl.vibTrigger) {
          vibration = sl.vibCode;
        }
        if (sl.audioTrigger) {
          audio = sl.audioFile;
        }
        phaseName = cycles > 1 ? `${sl.overlayText} (Cycle ${cycIdx + 1}/${cycles})` : sl.overlayText;
      }
    }
    return { tSec: t, totalRuntimeSec, phaseName, topChannels, bottomChannels, tempC, vibration, audio, nlePlayheadPct };
  }

  if (cfg.stimId === "temp_ramp") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const holdSec = Math.max(bin, parseInt(sp.rampHoldSec, 10) || 300);
    const stepBins = Math.max(1, Math.round(holdSec / bin));
    const stepDur = stepBins * bin;
    const steps = computeTempRampSteps(sp.rampStartTemp, sp.rampEndTemp, sp.rampStepTemp);
    if (sp.rampLight === "LIGHT") setSingleChannelOn(colId);

    totalRuntimeSec = acclim + autorefBase + steps.length * stepDur;
    const t = Math.max(0, Math.min(totalRuntimeSec, parseFloat(tSecRaw) || 0));

    if (t < acclim) {
      tempC = steps[0];
      phaseName = `ACCLIM ${steps[0]}C`;
    } else if (t < acclim + autorefBase) {
      tempC = steps[0];
      phaseName = "AUTOREFERENCING";
    } else {
      const rel = Math.min(Math.max(0, steps.length * stepDur - 0.0001), t - acclim - autorefBase);
      const stIdx = Math.min(steps.length - 1, Math.floor(rel / stepDur));
      tempC = steps[stIdx];
      phaseName = `TEMP TARGET ${steps[stIdx]}C (Step ${stIdx + 1}/${steps.length})`;
    }
    return { tSec: t, totalRuntimeSec, phaseName, topChannels, bottomChannels, tempC, vibration, audio, nlePlayheadPct };
  }

  const tFallback = Math.max(0, parseFloat(tSecRaw) || 0);
  return { tSec: tFallback, totalRuntimeSec: tFallback, phaseName, topChannels, bottomChannels, tempC, vibration, audio, nlePlayheadPct };
}

if (typeof window !== "undefined") {
  window.sampleAssayStateAtTime = sampleAssayStateAtTime;
  window.ZANTIKS_SIMULATOR = { readConfig, sampleAssayStateAtTime, compileMultiTrackSlices };
}
