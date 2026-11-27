// Zantiks MWP Script Builder - Full-assay timeline bar (segments, scrub mapping) and multi-track composite bar
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

let timelineModel = { totalRuntimeSec: 0, preSetupSec: 0, segs: [] };

function renderNleSummaryBar(cfgIn) {
  const sumBar = document.getElementById("nleSummaryBar");
  if (!sumBar) return;
  const baseTemp = cfgIn ? cfgIn.thermostatTemp : (parseFloat(document.getElementById("thermostatTemp").value) || 22);
  const comp = compileMultiTrackSlices(
    state.timelineClips,
    state.stimParams.mpTimelineSec,
    state.stimParams.timeBinSec,
    baseTemp
  );
  const totalSec = Math.max(1, comp.totalSec);
  const segs = [];
  for (const sl of comp.slices) {
    const nLights = sl.lights.length;
    const cls = nLights === 0 ? "tl-dark" : (nLights === 1 ? sl.lights[0].colObj.tlCls : "tl-overlap");
    const lightTokens = sl.lights.map(l => {
      const code = l.id === "UV" ? "UV" : l.id[0];
      return l.mount === "BOT" ? "b" + code : code;
    });
    const lbl = nLights === 0
      ? "Dark"
      : (nLights === 1
          ? (sl.lights[0].mount === "BOT" ? "Bot " : "") + sl.lights[0].colObj.short
          : lightTokens.join("+"));
    const tSuffix = sl.effectiveTemp !== null ? ` ${sl.effectiveTemp}°C` : "";
    const stimBits = [];
    if (sl.strobeHz > 0) stimBits.push(`${sl.strobeHz}Hz`);
    if (sl.vibTrigger) stimBits.push(sl.vibCode);
    if (sl.audioTrigger) stimBits.push("Aud");
    const stimSuffix = stimBits.length ? ` +${stimBits.join("+")}` : "";
    const dur = Math.max(0.001, sl.endSec - sl.startSec);
    const tip = `S${sl.idx} (${sl.startSec}-${sl.endSec}s): ${lbl}${tSuffix}${stimSuffix}`;
    const prev = segs[segs.length - 1];
    if (cls === "tl-overlap" && !sl.vibTrigger && !sl.audioTrigger && !sl.strobeHz && prev && prev.cls === "tl-overlap" && !prev._hasStim) {
      prev.w += dur;
      lightTokens.forEach(tok => {
        if (!prev._toks.includes(tok)) prev._toks.push(tok);
      });
      prev.txt = `Overlap (${prev._toks.join("+")})`;
      prev.medTxt = prev._toks.join("+");
      prev.shortTxt = prev._toks.join("+");
      prev.tip += ` | ${tip}`;
    } else {
      segs.push({
        cls,
        w: dur,
        txt: `S${sl.idx}: ${lbl}${tSuffix}${stimSuffix}`,
        medTxt: nLights === 0 ? `S${sl.idx}: Dark${stimSuffix}` : `S${sl.idx}: ${lightTokens.join("+")}${tSuffix}${stimSuffix}`,
        shortTxt: stimBits.length ? `S${sl.idx}+` : `S${sl.idx}`,
        tip,
        _toks: lightTokens.slice(),
        _hasStim: stimBits.length > 0
      });
    }
  }

  sumBar.classList.toggle("has-overlap", segs.some(s => s.cls === "tl-overlap"));
  sumBar.innerHTML = segs.map(s => {
    const pct = (s.w / totalSec) * 100;
    const text = pct >= 22 ? s.txt : (pct >= 14 ? (s.medTxt || s.shortTxt || "") : (pct >= 5 ? (s.shortTxt || "") : ""));
    const safeTip = s.tip.replace(/"/g, "&quot;");
    return `<div class="tl-seg ${s.cls}" style="flex:${s.w} 0 0" title="${safeTip}">${text}</div>`;
  }).join("");
}

function timelineSecToPct(tSecRaw) {
  const totalT = timelineModel.totalRuntimeSec;
  const segs = timelineModel.segs;
  if (!segs || !segs.length || totalT <= 0) return 0;
  const t = Math.max(0, Math.min(totalT, parseFloat(tSecRaw) || 0));
  if (t <= 0) return 0;
  if (t >= totalT) return 100;
  let seg = segs[segs.length - 1];
  for (let i = 0; i < segs.length; i++) {
    if (t < segs[i].t1 || i === segs.length - 1) {
      seg = segs[i];
      break;
    }
  }
  const dt = seg.t1 - seg.t0;
  const frac = dt > 0 ? Math.max(0, Math.min(1, (t - seg.t0) / dt)) : 0;
  return (seg.x0 + frac * (seg.x1 - seg.x0)) * 100;
}

function timelineRatioToSec(xRatioRaw) {
  const totalT = timelineModel.totalRuntimeSec;
  const segs = timelineModel.segs;
  const x = Math.max(0, Math.min(1, parseFloat(xRatioRaw) || 0));
  if (!segs || !segs.length || totalT <= 0) return 0;
  if (x <= 0) return 0;
  if (x >= 1) return totalT;
  let seg = segs[segs.length - 1];
  for (let i = 0; i < segs.length; i++) {
    if (x < segs[i].x1 || i === segs.length - 1) {
      seg = segs[i];
      break;
    }
  }
  const dx = seg.x1 - seg.x0;
  const frac = dx > 0 ? Math.max(0, Math.min(1, (x - seg.x0) / dx)) : 0;
  return seg.t0 + frac * (seg.t1 - seg.t0);
}

function renderTimeline(cfg, s4) {
  const bar = document.getElementById("timelineBar");
  const desc = document.getElementById("timelineDesc");
  const total = document.getElementById("timelineTotal");
  const sp = cfg.sp;
  const segs = [];
  const activeCls = (cfg.ledColorObj && cfg.ledColorObj.tlCls) ? cfg.ledColorObj.tlCls : "tl-light";
  const activeShort = (cfg.ledColorObj && cfg.ledColorObj.id !== "WHITE") ? cfg.ledColorObj.short : "Light";
  const autorefBase = Math.max(0, parseInt(cfg.autorefTimeout, 10) || 0);
  let preSetupSec = 0;

  if (cfg.stimId === "baseline") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const dur = Math.max(bin, parseInt(sp.durationSec, 10) || 600);
    const recDur = Math.max(1, Math.round(dur / bin)) * bin;
    preSetupSec = acclim + autorefBase;
    if (preSetupSec > 0) {
      segs.push({ cls: "tl-acclim", w: acclim > 0 ? acclim : autorefBase, txt: acclim > 0 ? "Acclim" : "Autoref", t0: 0, t1: preSetupSec });
    }
    segs.push({
      cls: sp.baseLight === "DARK" ? "tl-dark" : activeCls,
      w: Math.max(10, recDur),
      txt: sp.baseLight === "DARK" ? "Dark Recording" : `${activeShort} Recording`,
      t0: preSetupSec,
      t1: preSetupSec + recDur
    });
    desc.textContent = sp.baseLight === "DARK" ? "Constant dark recording" : `Constant ${activeShort.toLowerCase()} recording`;
  } else if (cfg.stimId === "ld_transitions") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const phaseSec = Math.max(bin, parseInt(sp.ldPhaseSec, 10) || 300);
    const phaseDur = Math.max(1, Math.round(phaseSec / bin)) * bin;
    const cycles = Math.max(1, parseInt(sp.ldCycles, 10) || 2);
    const n = Math.min(6, cycles);
    const startL = sp.ldStart !== "DARK";
    const lTag = cfg.ledColor === "WHITE" ? "L" : cfg.ledColor.slice(0, 2);
    preSetupSec = acclim + autorefBase;
    let cursor = 0;
    if (preSetupSec > 0) {
      segs.push({ cls: "tl-acclim", w: acclim > 0 ? acclim : autorefBase, txt: acclim > 0 ? "Acclim" : "Autoref", t0: 0, t1: preSetupSec });
      cursor = preSetupSec;
    }
    for (let i = 0; i < n; i++) {
      segs.push({ cls: startL ? activeCls : "tl-dark", w: phaseDur, txt: startL ? lTag : "D", t0: cursor, t1: cursor + phaseDur });
      cursor += phaseDur;
      segs.push({ cls: startL ? "tl-dark" : activeCls, w: phaseDur, txt: startL ? "D" : lTag, t0: cursor, t1: cursor + phaseDur });
      cursor += phaseDur;
    }
    if (cycles > n) {
      segs.push({ cls: "tl-acclim", w: phaseDur * 2, txt: `+${cycles - n}x`, t0: cursor, t1: s4.totalRuntimeSec });
    }
    desc.textContent = `${sp.ldCycles} x (${sp.ldPhaseSec}s ${activeShort} / ${sp.ldPhaseSec}s Dark)`;
  } else if (cfg.stimId === "light_off_startle" || cfg.stimId === "light_on_pulse") {
    const isOff = cfg.stimId === "light_off_startle";
    const acclim = Math.max(0, parseIntOr(sp.acclimSec, 0));
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
    const preDur = Math.round(preSec / bin) * bin;
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const pulseDur = Math.max(isOff ? 0.1 : 0.05, parseFloat(sp.pulseDurSec) || 1);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiDur = Math.max(1, Math.round(itiSec / bin)) * bin;
    const strobeHz = !isOff && [2, 5, 10].includes(parseInt(sp.strobeHz, 10)) ? parseInt(sp.strobeHz, 10) : 0;
    const subBinPulse = pulseDur < bin;
    const pulseBins = subBinPulse ? 1 : Math.max(1, Math.round(pulseDur / bin));
    const pulseBinDur = pulseBins * bin;
    const activeStimDur = subBinPulse ? pulseDur : pulseBinDur;
    const trialDur = pulseBinDur + itiDur;
    preSetupSec = acclim + autorefBase;
    let cursor = 0;
    if (preSetupSec > 0) {
      segs.push({ cls: "tl-acclim", w: acclim > 0 ? acclim : autorefBase, txt: acclim > 0 ? "Acclim" : "Autoref", t0: 0, t1: preSetupSec });
      cursor = preSetupSec;
    }
    if (preDur > 0) {
      segs.push({ cls: isOff ? activeCls : "tl-dark", w: preDur, txt: "Base", t0: cursor, t1: cursor + preDur });
      cursor += preDur;
    }
    const n = Math.min(8, pulses);
    const pulseVisW = Math.max(4, itiDur * 0.18);
    for (let i = 0; i < n; i++) {
      segs.push({ cls: isOff ? "tl-pulse" : activeCls, w: pulseVisW, txt: "", t0: cursor, t1: cursor + activeStimDur });
      segs.push({ cls: isOff ? activeCls : "tl-dark", w: itiDur, txt: "", t0: cursor + activeStimDur, t1: cursor + trialDur });
      cursor += trialDur;
    }
    if (pulses > n) {
      segs.push({ cls: "tl-acclim", w: itiDur, txt: `+${pulses - n}`, t0: cursor, t1: s4.totalRuntimeSec });
    }
    desc.textContent = `${sp.numPulses} ${isOff ? "dark" : activeShort.toLowerCase()} ${strobeHz > 0 ? `${strobeHz}Hz strobe bursts` : "pulses"} (${sp.pulseDurSec}s, ${sp.itiSec}s ITI)`;
  } else if (cfg.stimId === "vibration_startle") {
    const acclim = Math.max(0, parseIntOr(sp.acclimSec, 0));
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
    const preDur = Math.round(preSec / bin) * bin;
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiDur = Math.max(1, Math.round(itiSec / bin)) * bin;
    const trialDur = bin + itiDur;
    const tapWindow = Math.min(0.8, bin);
    const baseCls = sp.vibAmbient === "LIGHT" ? activeCls : "tl-dark";
    preSetupSec = acclim + autorefBase;
    let cursor = 0;
    if (preSetupSec > 0) {
      segs.push({ cls: "tl-acclim", w: acclim > 0 ? acclim : autorefBase, txt: acclim > 0 ? "Acclim" : "Autoref", t0: 0, t1: preSetupSec });
      cursor = preSetupSec;
    }
    if (preDur > 0) {
      segs.push({ cls: baseCls, w: preDur, txt: "Base", t0: cursor, t1: cursor + preDur });
      cursor += preDur;
    }
    const n = Math.min(8, pulses);
    const vibVisW = Math.max(4, itiDur * 0.18);
    for (let i = 0; i < n; i++) {
      segs.push({ cls: "tl-vib", w: vibVisW, txt: "", t0: cursor, t1: cursor + tapWindow });
      segs.push({ cls: baseCls, w: itiDur, txt: "", t0: cursor + tapWindow, t1: cursor + trialDur });
      cursor += trialDur;
    }
    if (pulses > n) {
      segs.push({ cls: "tl-acclim", w: itiDur, txt: `+${pulses - n}`, t0: cursor, t1: s4.totalRuntimeSec });
    }
    desc.textContent = `${sp.numPulses} taps (${sp.vibIntensity}, ${sp.itiSec}s ITI)`;
  } else if (cfg.stimId === "acoustic_startle") {
    const acclim = Math.max(0, parseIntOr(sp.acclimSec, 0));
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
    const preDur = Math.round(preSec / bin) * bin;
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiDur = Math.max(1, Math.round(itiSec / bin)) * bin;
    const trialDur = bin + itiDur;
    const audioAsset = sp.audioFile === "custom"
      ? sanitizeAudioAsset(sp.audioCustomFile || "stereo.wav")
      : sanitizeAudioAsset(sp.audioFile || "tone");
    const baseCls = sp.audioAmbient === "LIGHT" ? activeCls : "tl-dark";
    preSetupSec = acclim + autorefBase;
    let cursor = 0;
    if (preSetupSec > 0) {
      segs.push({ cls: "tl-acclim", w: acclim > 0 ? acclim : autorefBase, txt: acclim > 0 ? "Acclim" : "Autoref", t0: 0, t1: preSetupSec });
      cursor = preSetupSec;
    }
    if (preDur > 0) {
      segs.push({ cls: baseCls, w: preDur, txt: "Base", t0: cursor, t1: cursor + preDur });
      cursor += preDur;
    }
    const n = Math.min(8, pulses);
    const cueVisW = Math.max(4, itiDur * 0.18);
    for (let i = 0; i < n; i++) {
      segs.push({ cls: "tl-audio", w: cueVisW, txt: "", t0: cursor, t1: cursor + bin });
      segs.push({ cls: baseCls, w: itiDur, txt: "", t0: cursor + bin, t1: cursor + trialDur });
      cursor += trialDur;
    }
    if (pulses > n) {
      segs.push({ cls: "tl-acclim", w: itiDur, txt: `+${pulses - n}`, t0: cursor, t1: s4.totalRuntimeSec });
    }
    desc.textContent = `${pulses} audio cues ("${audioAsset}", ${sp.itiSec}s ITI)`;
  } else if (cfg.stimId === "ppi") {
    const acclim = Math.max(0, parseIntOr(sp.acclimSec, 0));
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
    const preDur = Math.round(preSec / bin) * bin;
    const pairs = Math.max(1, parseInt(sp.ppiPairs, 10) || 5);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiDur = Math.max(1, Math.round(itiSec / bin)) * bin;
    const trialDur = bin + itiDur;
    const isAlt = (sp.ppiPattern || "alternating") === "alternating";
    const totalTrials = isAlt ? pairs * 2 : pairs;
    const prepulse = vibLevelToCode(sp.ppiPrepulse || "U3");
    const pulse = vibLevelToCode(sp.ppiPulse || "U0");
    const isiMs = Math.min(2000, Math.max(50, parseInt(sp.ppiIsiMs, 10) || 300));
    const baseCls = sp.ppiAmbient === "LIGHT" ? activeCls : "tl-dark";
    preSetupSec = acclim + autorefBase;
    let cursor = 0;
    if (preSetupSec > 0) {
      segs.push({ cls: "tl-acclim", w: acclim > 0 ? acclim : autorefBase, txt: acclim > 0 ? "Acclim" : "Autoref", t0: 0, t1: preSetupSec });
      cursor = preSetupSec;
    }
    if (preDur > 0) {
      segs.push({ cls: baseCls, w: preDur, txt: "Base", t0: cursor, t1: cursor + preDur });
      cursor += preDur;
    }
    const n = Math.min(8, totalTrials);
    const cueVisW = Math.max(4, itiDur * 0.18);
    for (let i = 0; i < n; i++) {
      const isPpi = !isAlt || (i % 2 === 1);
      segs.push({ cls: isPpi ? "tl-ppi" : "tl-vib", w: cueVisW, txt: "", t0: cursor, t1: cursor + bin });
      segs.push({ cls: baseCls, w: itiDur, txt: "", t0: cursor + bin, t1: cursor + trialDur });
      cursor += trialDur;
    }
    if (totalTrials > n) {
      segs.push({ cls: "tl-acclim", w: itiDur, txt: `+${totalTrials - n}`, t0: cursor, t1: s4.totalRuntimeSec });
    }
    desc.textContent = `${totalTrials} trials (${isAlt ? "Alt Pulse/PPI" : "PPI only"} · ${prepulse}+${isiMs}ms+${pulse})`;
  } else if (cfg.stimId === "circadian") {
    const bin = Math.max(1, parseInt(sp.circBinSec, 10) || 10);
    const lightHrs = Math.max(0, parseIntOr(sp.lightHours, 16));
    const darkHrs = Math.max(0, parseIntOr(sp.darkHours, 8));
    const days = Math.max(1, parseInt(sp.numDays, 10) || 2);
    const rampMin = cfg.hw === "Z3" ? Math.min(30, Math.max(0, parseIntOr(sp.circRampMin, 0))) : 0;
    const hasDawnDusk = rampMin > 0 && lightHrs > 0 && darkHrs > 0;
    const rampStepBins = hasDawnDusk ? Math.max(1, Math.round((rampMin * 60) / (6 * bin))) : 0;
    const rampDur = hasDawnDusk ? 6 * rampStepBins * bin : 0;
    const autoref = 300;
    const activeSecPerHour = Math.max(bin * 2, 3600 - autoref);
    const halfBins = Math.max(1, Math.floor(activeSecPerHour / (2 * bin)));
    const hourDur = 2 * halfBins * bin + autoref;
    const n = Math.min(5, days);
    preSetupSec = autoref;
    let cursor = autoref;
    const rampVisW = hasDawnDusk ? Math.max(1.2, rampMin / 25) : 0;
    for (let i = 0; i < n; i++) {
      if (hasDawnDusk) {
        const segT0 = segs.length === 0 ? 0 : cursor;
        const segT1 = cursor + rampDur;
        segs.push({ cls: "tl-dawn", w: rampVisW, txt: "", t0: segT0, t1: segT1 });
        cursor = segT1;
      }
      if (lightHrs > 0) {
        const segT0 = segs.length === 0 ? 0 : cursor;
        const segT1 = cursor + lightHrs * hourDur;
        segs.push({ cls: activeCls, w: lightHrs, txt: `${lightHrs}h L`, t0: segT0, t1: segT1 });
        cursor = segT1;
      }
      if (hasDawnDusk) {
        const segT0 = segs.length === 0 ? 0 : cursor;
        const segT1 = cursor + rampDur;
        segs.push({ cls: "tl-dusk", w: rampVisW, txt: "", t0: segT0, t1: segT1 });
        cursor = segT1;
      }
      if (darkHrs > 0) {
        const segT0 = segs.length === 0 ? 0 : cursor;
        const segT1 = cursor + darkHrs * hourDur;
        segs.push({ cls: "tl-dark", w: darkHrs, txt: `${darkHrs}h D`, t0: segT0, t1: segT1 });
        cursor = segT1;
      }
    }
    if (days > n && (lightHrs + darkHrs) > 0) {
      segs.push({ cls: "tl-acclim", w: Math.max(1, lightHrs + darkHrs), txt: `+${days - n}d`, t0: cursor, t1: s4.totalRuntimeSec });
    }
    if (segs.length === 0) {
      segs.push({ cls: lightHrs > 0 ? activeCls : "tl-dark", w: 1, txt: "Autoref", t0: 0, t1: Math.max(1, s4.totalRuntimeSec) });
    }
    desc.textContent = `${days} cycle(s) of ${lightHrs}h ${activeShort} : ${darkHrs}h Dark${hasDawnDusk ? ` (±${rampMin}m dawn/dusk)` : ""}`;
  } else if (cfg.stimId === "multi_phase") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const cycles = Math.max(1, parseInt(sp.mpCycles, 10) || 1);
    const cyc = Math.min(4, cycles);
    const comp = compileMultiTrackSlices(cfg.timelineClips, sp.mpTimelineSec, sp.timeBinSec, cfg.thermostatTemp);
    preSetupSec = acclim + autorefBase;
    let cursor = 0;
    if (preSetupSec > 0) {
      segs.push({ cls: "tl-acclim", w: acclim > 0 ? acclim : autorefBase, txt: acclim > 0 ? "Acclim" : "Autoref", t0: 0, t1: preSetupSec });
      cursor = preSetupSec;
    }
    for (let c = 0; c < cyc; c++) {
      comp.slices.forEach(sl => {
        const nLights = sl.lights.length;
        const cls = nLights === 0 ? "tl-dark" : (nLights === 1 ? sl.lights[0].colObj.tlCls : "tl-overlap");
        const lightTokens = sl.lights.map(l => {
          const code = l.id === "UV" ? "UV" : l.id[0];
          return l.mount === "BOT" ? "b" + code : code;
        });
        const lbl = nLights === 0
          ? "Dark"
          : (nLights === 1
              ? (sl.lights[0].mount === "BOT" ? "Bot " : "") + sl.lights[0].colObj.short
              : lightTokens.join("+"));
        const tSuffix = sl.effectiveTemp !== null ? ` ${sl.effectiveTemp}°C` : "";
        const slDur = sl.endSec - sl.startSec;
        const segT0 = cursor;
        const segT1 = cursor + slDur;
        cursor = segT1;
        const w = Math.max(2, slDur);
        const prev = segs[segs.length - 1];
        if (cls === "tl-overlap" && prev && prev.cls === "tl-overlap") {
          prev.w += w;
          prev.t1 = segT1;
          lightTokens.forEach(tok => {
            if (!prev._toks.includes(tok)) prev._toks.push(tok);
          });
          prev.txt = `Overlap (${prev._toks.join("+")})`;
        } else {
          segs.push({ cls, w, txt: `S${sl.idx}: ${lbl}${tSuffix}`, _toks: lightTokens.slice(), t0: segT0, t1: segT1 });
        }
      });
    }
    if (cycles > cyc) {
      segs.push({ cls: "tl-acclim", w: Math.max(10, comp.totalSec), txt: `+${cycles - cyc}x`, t0: cursor, t1: s4.totalRuntimeSec });
    }
    renderNleSummaryBar(cfg);
    const extraTags = [];
    if (comp.hasAnyBottomClip) extraTags.push("top+bot");
    if (comp.hasAnyRampClip) extraTags.push("ramp");
    if (comp.hasAnyStrobeClip) extraTags.push("strobe");
    if (comp.hasAnyTempClip) extraTags.push("temp");
    if (comp.hasAnyVibClip) extraTags.push("vib");
    if (comp.hasAnyAudioClip) extraTags.push("audio");
    desc.textContent = `${sp.mpCycles}x timeline (${comp.totalSec}s · ${comp.slices.length} slice${comp.slices.length === 1 ? "" : "s"}${extraTags.length ? " · " + extraTags.join(" + ") : ""})`;
  } else if (cfg.stimId === "temp_ramp") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const holdSec = Math.max(bin, parseInt(sp.rampHoldSec, 10) || 300);
    const stepDur = Math.max(1, Math.round(holdSec / bin)) * bin;
    const steps = computeTempRampSteps(sp.rampStartTemp, sp.rampEndTemp, sp.rampStepTemp);
    const minT = Math.min(...steps), maxT = Math.max(...steps);
    const span = Math.max(1, maxT - minT);
    preSetupSec = acclim + autorefBase;
    let cursor = 0;
    if (preSetupSec > 0) {
      segs.push({ cls: "tl-acclim", w: acclim > 0 ? acclim : autorefBase, txt: acclim > 0 ? "Acclim" : "Autoref", t0: 0, t1: preSetupSec });
      cursor = preSetupSec;
    }
    steps.forEach(t => {
      const ratio = (t - minT) / span;
      const bucket = ratio < 0.25 ? "tl-temp-1" : (ratio < 0.55 ? "tl-temp-2" : (ratio < 0.8 ? "tl-temp-3" : "tl-temp-4"));
      segs.push({ cls: bucket, w: Math.max(10, stepDur), txt: `${t}°C`, t0: cursor, t1: cursor + stepDur });
      cursor += stepDur;
    });
    desc.textContent = `${steps.length} thermal step(s): ${steps[0]}°C -> ${steps[steps.length - 1]}°C (${sp.rampHoldSec}s/step)`;
  }

  const sumW = segs.reduce((a, b) => a + b.w, 0) || 1;
  if (segs.length > 0) {
    segs[0].t0 = 0;
    segs[segs.length - 1].t1 = s4.totalRuntimeSec;
  }
  let cumW = 0;
  const mappedSegs = segs.map(s => {
    const x0 = cumW / sumW;
    cumW += s.w;
    const x1 = cumW / sumW;
    return { x0, x1, t0: s.t0, t1: s.t1, cls: s.cls };
  });
  timelineModel = {
    totalRuntimeSec: s4.totalRuntimeSec,
    preSetupSec,
    segs: mappedSegs
  };

  bar.classList.toggle("has-overlap", segs.some(s => s.cls === "tl-overlap"));
  bar.innerHTML = segs.map(s => {
    const pct = (s.w / sumW) * 100;
    return `<div class="tl-seg ${s.cls}" style="flex:${s.w} 0 0">${pct > 11 ? s.txt : ""}</div>`;
  }).join("");

  total.textContent = `Est. Runtime: ${formatDuration(s4.totalRuntimeSec)}`;
}
