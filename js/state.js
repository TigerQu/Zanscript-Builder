// Zantiks MWP Script Builder - Application state and plate-config store (browser storage + zantiks_plate_config.js)
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 2. Application State & Plate Config Store
// ---------------------------------------------------------------------------
function cloneDefaultGeometries() {
  const out = {};
  for (const key of getStandardPlateKeys()) {
    const f = FACTORY_PLATES[key];
    out[key] = {
      xOffset: f.xOffset,
      yOffset: f.yOffset,
      colStep: f.colStep,
      rowStep: f.rowStep,
      r: f.r,
      rDz: f.rDz
    };
  }
  return out;
}

let _nextClipId = 100;
function cloneDefaultTimelineClips() {
  return [
    { id: 1, track: "WHITE", startSec: 0,   endSec: 180, val: 35 },
    { id: 2, track: "BLUE",  startSec: 30,  endSec: 50,  val: 100 },
    { id: 3, track: "RED",   startSec: 80,  endSec: 100, val: 100 },
    { id: 4, track: "BLUE",  startSec: 130, endSec: 150, val: 100 },
    { id: 5, track: "TEMP",  startSec: 0,   endSec: 90,  val: 22 },
    { id: 6, track: "TEMP",  startSec: 90,  endSec: 180, val: 26 }
  ];
}

const LIGHT_CURVE_TYPES = [
  { id: "linear", label: "Linear" },
  { id: "gamma",  label: "Gamma 2.2 (Dawn / Log-Perceived)" },
  { id: "log",    label: "Ease-Out (Fast Start)" },
  { id: "scurve", label: "S-Curve (Smoothstep)" },
  { id: "sine",   label: "Sine Pulse (Start → Peak → Start)" },
  { id: "custom", label: "Custom Keyframes (Draw)" }
];

const LIGHT_RAMP_STEP_OPTIONS = [4, 6, 8, 12, 16, 24];

function normalizeLightCurveId(raw) {
  const id = String(raw || "").toLowerCase();
  return LIGHT_CURVE_TYPES.some(t => t.id === id) ? id : "linear";
}

function normalizeRampSteps(raw) {
  const n = parseInt(raw, 10);
  return LIGHT_RAMP_STEP_OPTIONS.includes(n) ? n : 8;
}

function sanitizeCurveKeyframes(rawKfs, fallbackStart, fallbackEnd) {
  const sY = Math.min(100, Math.max(0, Number.isFinite(fallbackStart) ? Math.round(fallbackStart) : 0));
  const eY = Math.min(100, Math.max(0, Number.isFinite(fallbackEnd) ? Math.round(fallbackEnd) : 100));
  if (!Array.isArray(rawKfs) || rawKfs.length < 2) {
    return [{ t: 0, y: sY }, { t: 0.5, y: Math.round((sY + eY) / 2) }, { t: 1, y: eY }];
  }
  const cleaned = [];
  for (const pt of rawKfs.slice(0, 12)) {
    if (!pt || typeof pt !== "object") continue;
    const t = parseFloat(pt.t);
    const y = parseFloat(pt.y);
    if (!Number.isFinite(t) || !Number.isFinite(y)) continue;
    cleaned.push({
      t: Math.min(1, Math.max(0, Number(t.toFixed(3)))),
      y: Math.min(100, Math.max(0, Math.round(y)))
    });
  }
  if (cleaned.length < 2) {
    return [{ t: 0, y: sY }, { t: 1, y: eY }];
  }
  cleaned.sort((a, b) => a.t - b.t);
  cleaned[0].t = 0;
  cleaned[cleaned.length - 1].t = 1;
  // Deduplicate overly close interior points
  const dedup = [cleaned[0]];
  for (let i = 1; i < cleaned.length - 1; i++) {
    if (cleaned[i].t - dedup[dedup.length - 1].t >= 0.02 && 1 - cleaned[i].t >= 0.02 && dedup.length < 9) {
      dedup.push(cleaned[i]);
    }
  }
  dedup.push(cleaned[cleaned.length - 1]);
  return dedup;
}

function isClipCurved(clip) {
  if (!clip) return false;
  const trId = String(clip.track || "");
  if (trId === "TEMP" || trId === "VIB" || trId === "AUDIO") return false;
  const curve = normalizeLightCurveId(clip.curve);
  if (curve === "custom" && Array.isArray(clip.keyframes) && clip.keyframes.length >= 2) return true;
  const endRaw = parseFloat(clip.endVal);
  const valRaw = parseFloat(clip.val);
  return Number.isFinite(endRaw) && Math.round(endRaw) !== Math.round(Number.isFinite(valRaw) ? valRaw : 0);
}

function evaluateLightCurvePct(clip, tRaw) {
  const t = Math.min(1, Math.max(0, Number.isFinite(tRaw) ? tRaw : 0));
  const startY = Math.min(100, Math.max(0, Number.isFinite(parseFloat(clip.val)) ? Math.round(parseFloat(clip.val)) : 0));
  const endY = Number.isFinite(parseFloat(clip.endVal))
    ? Math.min(100, Math.max(0, Math.round(parseFloat(clip.endVal))))
    : startY;
  const curve = normalizeLightCurveId(clip.curve);

  if (curve === "custom" && Array.isArray(clip.keyframes) && clip.keyframes.length >= 2) {
    const kfs = clip.keyframes;
    if (t <= kfs[0].t) return Math.round(kfs[0].y);
    if (t >= kfs[kfs.length - 1].t) return Math.round(kfs[kfs.length - 1].y);
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i], b = kfs[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t;
        const frac = span > 0.0001 ? (t - a.t) / span : 0;
        return Math.min(100, Math.max(0, Math.round(a.y + (b.y - a.y) * frac)));
      }
    }
    return Math.round(kfs[kfs.length - 1].y);
  }

  if (curve === "sine") {
    const f = 0.5 * (1 - Math.cos(2 * Math.PI * t));
    return Math.min(100, Math.max(0, Math.round(startY + (endY - startY) * f)));
  }

  if (curve === "gamma") {
    // True perceptual linear ramp in gamma-2.2 space (fine steps near dark for BOTH dawn and dusk)
    const l0 = Math.pow(startY / 100, 1 / 2.2);
    const l1 = Math.pow(endY / 100, 1 / 2.2);
    const lt = Math.max(0, l0 + (l1 - l0) * t);
    return Math.min(100, Math.max(0, Math.round(Math.pow(lt, 2.2) * 100)));
  }

  let f = t;
  if (curve === "log") {
    f = 1 - Math.pow(1 - t, 2.2);
  } else if (curve === "scurve") {
    f = t * t * (3 - 2 * t);
  }
  return Math.min(100, Math.max(0, Math.round(startY + (endY - startY) * f)));
}

function sampleClipCurveToKeyframes(clip, count) {
  const n = Math.min(7, Math.max(3, count || 5));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = Number((i / (n - 1)).toFixed(3));
    pts.push({ t, y: evaluateLightCurvePct(clip, t) });
  }
  return pts;
}

const MAX_REPEAT_TRIGGERS = 120;

function compileMultiTrackSlices(clipsRaw, timelineSecRaw, binRaw, fallbackTemp) {
  const bin = Math.max(1, parseFloat(binRaw) || 1);
  const totalBins = Math.max(1, Math.round((Math.max(bin, parseFloat(timelineSecRaw) || 180)) / bin));
  const totalSec = totalBins * bin;
  const baseT = Math.min(40, Math.max(10, Number((parseFloat(fallbackTemp) || 22).toFixed(1))));

  const norm = [];
  const truncatedRepeats = [];
  for (const c of (clipsRaw || [])) {
    const sBin = Math.max(0, Math.min(totalBins, Math.round((parseFloat(c.startSec) || 0) / bin)));
    const eBin = Math.max(0, Math.min(totalBins, Math.round((parseFloat(c.endSec) || 0) / bin)));
    if (eBin > sBin) {
      const trId = String(c.track || "");
      let val;
      if (trId === "AUDIO") val = sanitizeAudioAsset(c.val);
      else if (trId === "VIB") val = clampVibLevel(c.val);
      else val = parseFloat(c.val);
      const repeatSecRaw = parseFloat(c.repeatSec);
      const repeatSec = (trId === "VIB" || trId === "AUDIO") && Number.isFinite(repeatSecRaw) && repeatSecRaw > 0
        ? Math.max(bin, Math.round(repeatSecRaw / bin) * bin)
        : 0;
      const triggerBins = new Set();
      if (trId === "VIB" || trId === "AUDIO") {
        triggerBins.add(sBin);
        if (repeatSec > 0) {
          const stepBins = Math.max(1, Math.round(repeatSec / bin));
          const expectedTriggers = Math.floor((eBin - 1 - sBin) / stepBins) + 1;
          for (let k = 1; k < MAX_REPEAT_TRIGGERS && (sBin + k * stepBins) < eBin; k++) {
            triggerBins.add(sBin + k * stepBins);
          }
          if (expectedTriggers > MAX_REPEAT_TRIGGERS) {
            truncatedRepeats.push({
              track: trId,
              expected: expectedTriggers,
              capped: MAX_REPEAT_TRIGGERS
            });
          }
        }
      }
      const isLightTrack = trId !== "TEMP" && trId !== "VIB" && trId !== "AUDIO";
      const curve = isLightTrack ? normalizeLightCurveId(c.curve) : "linear";
      const endValRaw = parseFloat(c.endVal);
      const hasCustomKfs = isLightTrack && curve === "custom" && Array.isArray(c.keyframes) && c.keyframes.length >= 2;
      const keyframes = hasCustomKfs ? sanitizeCurveKeyframes(c.keyframes, val, endValRaw) : null;
      const hasRamp = isLightTrack && (hasCustomKfs || (Number.isFinite(endValRaw) && Math.round(endValRaw) !== Math.round(val)));
      const endVal = hasRamp
        ? (hasCustomKfs ? keyframes[keyframes.length - 1].y : Math.min(100, Math.max(0, Math.round(endValRaw))))
        : null;
      const rampSteps = hasRamp ? normalizeRampSteps(c.rampSteps) : 8;
      const strobeRaw = parseInt(c.strobeHz, 10);
      const strobeHz = isLightTrack && [2, 5, 10].includes(strobeRaw) ? strobeRaw : 0;
      norm.push({ track: trId, sBin, eBin, val, repeatSec, triggerBins, hasRamp, endVal, curve, rampSteps, keyframes, strobeHz });
    }
  }

  const hasAnyTempClip = norm.some(c => c.track === "TEMP");
  const hasAnyBottomClip = norm.some(c => c.track.startsWith("U_"));
  const hasAnyVibClip = norm.some(c => c.track === "VIB");
  const hasAnyAudioClip = norm.some(c => c.track === "AUDIO");
  const hasAnyRampClip = norm.some(c => c.hasRamp);
  const hasAnyStrobeClip = norm.some(c => c.strobeHz > 0);
  const ptSet = new Set([0, totalBins]);
  for (const c of norm) {
    if (c.track === "VIB" || c.track === "AUDIO") {
      for (const tb of c.triggerBins) {
        ptSet.add(tb);
        ptSet.add(Math.min(c.eBin, tb + 1));
      }
    } else if (c.hasRamp) {
      const span = c.eBin - c.sBin;
      const steps = Math.min(c.rampSteps || 8, Math.max(2, span));
      for (let k = 0; k <= steps; k++) {
        ptSet.add(Math.round(c.sBin + span * (k / steps)));
      }
      if (c.keyframes && c.keyframes.length >= 2) {
        for (let ki = 1; ki < c.keyframes.length - 1; ki++) {
          const kf = c.keyframes[ki];
          const prevKf = c.keyframes[ki - 1];
          const nextKf = c.keyframes[ki + 1];
          const kfBin = Math.round(c.sBin + span * kf.t);
          ptSet.add(kfBin);
          if ((kf.y - prevKf.y) * (kf.y - nextKf.y) > 0) {
            if (kfBin < c.eBin) {
              ptSet.add(Math.min(c.eBin, kfBin + 1));
            } else if (kfBin > c.sBin) {
              ptSet.add(Math.max(c.sBin, kfBin - 1));
            }
          }
        }
      }
    } else {
      ptSet.add(c.sBin);
      ptSet.add(c.eBin);
    }
  }
  const pts = [...ptSet].sort((a, b) => a - b);

  const lightOrder = ["WHITE", "BLUE", "GREEN", "RED", "UV"];
  const rawSlices = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const b0 = pts[i], b1 = pts[i + 1];
    if (b1 <= b0) continue;

    const topLights = [];
    const bottomLights = [];
    const midBin = (b0 + b1) / 2;
    const resolveLightPct = (hit) => {
      if (hit.hasRamp) {
        if (b1 - b0 === 1 && hit.keyframes && hit.keyframes.length >= 3) {
          const span = hit.eBin - hit.sBin;
          for (let ki = 1; ki < hit.keyframes.length - 1; ki++) {
            const kf = hit.keyframes[ki];
            const prevKf = hit.keyframes[ki - 1];
            const nextKf = hit.keyframes[ki + 1];
            if ((kf.y - prevKf.y) * (kf.y - nextKf.y) > 0) {
              const kfBin = Math.round(hit.sBin + span * kf.t);
              if (kfBin === b0 || (kfBin === hit.eBin && b1 === hit.eBin)) {
                return Math.min(100, Math.max(0, Math.round(kf.y)));
              }
            }
          }
        }
        const frac = Math.max(0, Math.min(1, (midBin - hit.sBin) / Math.max(1, hit.eBin - hit.sBin)));
        return evaluateLightCurvePct(hit, frac);
      }
      return Math.min(100, Math.max(5, Math.round(hit.val || 100)));
    };
    for (const lid of lightOrder) {
      const hitTop = norm.find(c => c.track === lid && c.sBin <= b0 && c.eBin >= b1);
      if (hitTop) {
        const pct = resolveLightPct(hitTop);
        if (pct > 0) {
          const pwm = Math.round((pct / 100) * 4095);
          topLights.push({ id: lid, trackId: lid, mount: "TOP", pct, pwm, strobeHz: hitTop.strobeHz || 0, colObj: LED_COLORS[lid] });
        }
      }
      const botTrack = "U_" + lid;
      const hitBot = norm.find(c => c.track === botTrack && c.sBin <= b0 && c.eBin >= b1);
      if (hitBot) {
        const pct = resolveLightPct(hitBot);
        if (pct > 0) {
          const pwm = Math.round((pct / 100) * 4095);
          bottomLights.push({ id: lid, trackId: botTrack, mount: "BOT", pct, pwm, strobeHz: hitBot.strobeHz || 0, colObj: LED_COLORS[lid] });
        }
      }
    }

    const tempHit = norm.find(c => c.track === "TEMP" && c.sBin <= b0 && c.eBin >= b1);
    const effectiveTemp = hasAnyTempClip
      ? (tempHit ? Math.min(40, Math.max(10, Number((tempHit.val || baseT).toFixed(1)))) : baseT)
      : null;

    const vibHit = norm.find(c => c.track === "VIB" && c.triggerBins.has(b0) && c.eBin >= b1);
    const vibTrigger = Boolean(vibHit);
    const vibCode = vibTrigger ? vibLevelToCode(vibHit.val) : null;

    const audioHit = norm.find(c => c.track === "AUDIO" && c.triggerBins.has(b0) && c.eBin >= b1);
    const audioTrigger = Boolean(audioHit);
    const audioFile = audioTrigger ? audioHit.val : null;

    const strobeHzSet = new Set();
    for (const l of topLights) if (l.strobeHz > 0) strobeHzSet.add(l.strobeHz);
    for (const l of bottomLights) if (l.strobeHz > 0) strobeHzSet.add(l.strobeHz);
    const strobeHzList = [...strobeHzSet].sort((a, b) => a - b);
    const sliceStrobeHz = strobeHzList.length > 0 ? strobeHzList[strobeHzList.length - 1] : 0;

    const sig = "T:" + topLights.map(l => `${l.id}:${l.pct}${l.strobeHz ? `@${l.strobeHz}` : ""}`).join("+") +
      "|B:" + bottomLights.map(l => `${l.id}:${l.pct}${l.strobeHz ? `@${l.strobeHz}` : ""}`).join("+") +
      "|C:" + (effectiveTemp !== null ? effectiveTemp : "none") +
      "|V:" + (vibTrigger ? ("TRIG:" + vibCode) : "none") +
      "|A:" + (audioTrigger ? ("TRIG:" + audioFile) : "none");
    const prev = rawSlices[rawSlices.length - 1];
    // Never merge a slice that fires a one-shot trigger (vibTrigger or audioTrigger) into the previous slice
    if (prev && !vibTrigger && !audioTrigger && !prev.vibTrigger && !prev.audioTrigger && prev.sig === sig) {
      prev.b1 = b1;
      prev.bins = prev.b1 - prev.b0;
    } else {
      rawSlices.push({
        b0, b1, bins: b1 - b0, topLights, bottomLights, effectiveTemp,
        vibTrigger, vibCode, audioTrigger, audioFile,
        strobeHz: sliceStrobeHz, strobeHzList, sig
      });
    }
  }

  const shortMap = { WHITE: "W", BLUE: "B", GREEN: "G", RED: "R", UV: "UV" };
  const slices = rawSlices.map((s, idx) => {
    const sNum = idx + 1;
    const tLen = s.topLights.length;
    const bLen = s.bottomLights.length;
    const tempSuffix = s.effectiveTemp !== null ? `_${s.effectiveTemp}C` : "";
    const stimTagParts = [];
    const stimOvParts = [];
    if (s.strobeHzList.length > 1) {
      stimTagParts.push(`${s.strobeHzList.join("_")}HZ`);
      stimOvParts.push(`${s.strobeHzList.join("+")}Hz`);
    } else if (s.strobeHz > 0) {
      stimTagParts.push(`${s.strobeHz}HZ`);
      stimOvParts.push(`${s.strobeHz}Hz`);
    }
    if (s.vibTrigger) {
      stimTagParts.push(`V${s.vibCode}`);
      stimOvParts.push(s.vibCode);
    }
    if (s.audioTrigger) {
      stimTagParts.push("AUD");
      stimOvParts.push("AUD");
    }
    const stimSuffix = stimTagParts.length ? "_" + stimTagParts.join("_") : "";
    const stimOv = stimOvParts.length ? " " + stimOvParts.join("+") : "";
    let lightTag;
    let ovLight;

    if (tLen === 0 && bLen === 0) {
      lightTag = "DARK";
      ovLight = "DARK";
    } else if (bLen === 0) {
      if (tLen === 1) {
        lightTag = s.topLights[0].id;
        ovLight = s.topLights[0].id;
      } else if (tLen === 2) {
        lightTag = `${s.topLights[0].id}_${s.topLights[1].id}`;
        ovLight = `${s.topLights[0].id}+${s.topLights[1].id}`;
      } else {
        lightTag = "MIX_" + s.topLights.map(l => shortMap[l.id]).join("");
        ovLight = s.topLights.map(l => shortMap[l.id]).join("+");
      }
    } else if (tLen === 0) {
      if (bLen === 1) {
        lightTag = `U_${s.bottomLights[0].id}`;
        ovLight = `BOT ${s.bottomLights[0].id}`;
      } else if (bLen === 2) {
        lightTag = `U_${shortMap[s.bottomLights[0].id]}_${shortMap[s.bottomLights[1].id]}`;
        ovLight = `BOT ${shortMap[s.bottomLights[0].id]}+${shortMap[s.bottomLights[1].id]}`;
      } else {
        lightTag = "U_MIX_" + s.bottomLights.map(l => shortMap[l.id]).join("");
        ovLight = "BOT " + s.bottomLights.map(l => shortMap[l.id]).join("+");
      }
    } else {
      if (tLen === 1 && bLen === 1) {
        const fullCombo = `${s.topLights[0].id}_U_${s.bottomLights[0].id}`;
        lightTag = (`S${sNum}_${fullCombo}${tempSuffix}${stimSuffix}`).length <= 24
          ? fullCombo
          : `T${shortMap[s.topLights[0].id]}_U${shortMap[s.bottomLights[0].id]}`;
        ovLight = `T:${shortMap[s.topLights[0].id]} B:${shortMap[s.bottomLights[0].id]}`;
      } else {
        lightTag = "T" + s.topLights.map(l => shortMap[l.id]).join("") + "_U" + s.bottomLights.map(l => shortMap[l.id]).join("");
        ovLight = "T:" + s.topLights.map(l => shortMap[l.id]).join("+") + " B:" + s.bottomLights.map(l => shortMap[l.id]).join("+");
      }
    }

    const csvTag = `S${sNum}_${lightTag}${tempSuffix}${stimSuffix}`.slice(0, 24);
    const overlayText = `S${sNum} ${ovLight}${s.effectiveTemp !== null ? " " + s.effectiveTemp + "C" : ""}${stimOv}`;
    return {
      idx: sNum,
      startSec: s.b0 * bin,
      endSec: s.b1 * bin,
      bins: s.bins,
      topLights: s.topLights,
      bottomLights: s.bottomLights,
      lights: [...s.topLights, ...s.bottomLights],
      effectiveTemp: s.effectiveTemp,
      vibTrigger: s.vibTrigger,
      vibCode: s.vibCode,
      audioTrigger: s.audioTrigger,
      audioFile: s.audioFile,
      strobeHz: s.strobeHz,
      strobeHzList: s.strobeHzList,
      csvTag,
      overlayText
    };
  });

  const initialTemp = hasAnyTempClip && slices.length > 0 ? slices[0].effectiveTemp : null;
  const anyTempChange = hasAnyTempClip && slices.some(sl => Math.abs(sl.effectiveTemp - initialTemp) > 0.01);

  return {
    totalBins, totalSec, bin, hasAnyTempClip, hasAnyBottomClip,
    hasAnyVibClip, hasAnyAudioClip, hasAnyRampClip, hasAnyStrobeClip,
    truncatedRepeats,
    initialTemp, anyTempChange, slices
  };
}

function computeTempRampSteps(startRaw, endRaw, stepRaw) {
  const startT = Math.min(40, Math.max(10, Number((parseFloat(startRaw) || 20).toFixed(1))));
  const endT = Math.min(40, Math.max(10, Number((parseFloat(endRaw) || 30).toFixed(1))));
  const step = Math.min(20, Math.max(0.5, Number((Math.abs(parseFloat(stepRaw)) || 2).toFixed(1))));
  if (Math.abs(endT - startT) < 0.01) return [startT];
  const dir = endT > startT ? 1 : -1;
  const steps = [];
  let cur = startT;
  while ((dir > 0 ? cur <= endT + 0.001 : cur >= endT - 0.001) && steps.length < 24) {
    steps.push(Number(cur.toFixed(1)));
    cur += dir * step;
  }
  const last = steps[steps.length - 1];
  if (Math.abs(last - endT) > 0.01 && steps.length < 25) {
    steps.push(endT);
  }
  return steps;
}

const OPTIONAL_STIM_PARAM_DEFAULTS = {
  audioFile: "tone",
  audioCustomFile: "stereo.wav",
  audioAmbient: "DARK",
  ppiPrepulse: "U3",
  ppiPulse: "U0",
  ppiIsiMs: 300,
  ppiPairs: 5,
  ppiPattern: "alternating",
  ppiAmbient: "DARK",
  strobeHz: 0,
  circRampMin: 0,
  circRampCurve: "gamma"
};

function cloneDefaultStimParams() {
  return {
    baseLight: "LIGHT",
    acclimSec: 120,
    durationSec: 600,
    timeBinSec: 1,
    ldStart: "LIGHT",
    ldPhaseSec: 300,
    ldCycles: 2,
    preBaselineSec: 60,
    numPulses: 5,
    pulseDurSec: 1,
    itiSec: 30,
    vibIntensity: "U0",
    vibAmbient: "DARK",
    lightHours: 16,
    darkHours: 8,
    numDays: 2,
    circBinSec: 10,
    mpTimelineSec: 180,
    mpAcclimLight: "DARK",
    mpCycles: 1,
    rampStartTemp: 20,
    rampEndTemp: 30,
    rampStepTemp: 2,
    rampHoldSec: 300,
    rampLight: "DARK",
    ...OPTIONAL_STIM_PARAM_DEFAULTS
  };
}

const state = {
  organism: "daphnia",
  plateId: "24well",
  stimId: "ld_transitions",
  activeStep: 4,
  profileName: "",
  plateConfigUpdatedAt: null,
  unsavedFileChanges: false,
  plateGeometries: cloneDefaultGeometries(),
  customMaze: cloneDefaultCustomMaze(),
  timelineClips: cloneDefaultTimelineClips(),
  selectedClipId: 2,
  showUnderTracks: false,
  unitZ3RgbMap: "DOCS",
  z3RgbMap: "DOCS",
  stimParams: cloneDefaultStimParams()
};

function loadInitialZ3RgbMap() {
  let saved = "DOCS";
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY_Z3_RGB_MAP);
      if (raw && Z3_RGB_MAPS[raw]) saved = raw;
    }
  } catch (_) {}
  state.unitZ3RgbMap = saved;
  state.z3RgbMap = saved;
  applyZ3RgbMapToCatalogs(saved);
}

function saveUnitZ3RgbMap(mapId) {
  const validId = applyZ3RgbMapToCatalogs(mapId);
  state.unitZ3RgbMap = validId;
  state.z3RgbMap = validId;
  try {
    if (typeof localStorage !== "undefined") {
      if (validId === "DOCS") localStorage.removeItem(STORAGE_KEY_Z3_RGB_MAP);
      else localStorage.setItem(STORAGE_KEY_Z3_RGB_MAP, validId);
    }
  } catch (_) {}
  return validId;
}

// Resets all assay state and form controls to factory defaults while preserving
// calibrated plateGeometries, profileName, plateConfigUpdatedAt, unsavedFileChanges, and unitZ3RgbMap.
function resetAssayFieldsAndDom() {
  state.organism = "daphnia";
  state.plateId = "24well";
  state.stimId = "ld_transitions";
  state.activeStep = 4;
  state.showUnderTracks = false;
  state.z3RgbMap = state.unitZ3RgbMap || "DOCS";
  state.customMaze = cloneDefaultCustomMaze();
  state.timelineClips = cloneDefaultTimelineClips();
  state.selectedClipId = 2;
  state.stimParams = cloneDefaultStimParams();

  if (typeof simState !== "undefined") {
    simState.tSec = 0;
    simState.speed = 1;
  }

  if (typeof document === "undefined") {
    applyZ3RgbMapToCatalogs(state.z3RgbMap);
    return;
  }

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = String(v);
  };
  const setChk = (id, c) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(c);
  };

  setVal("simSpeedSel", "1");
  setVal("userName", "");
  setVal("expPrefix", "");
  setVal("hwVersion", "Z3");
  setVal("ledColor", "WHITE");
  setVal("ledBrightness", 100);
  setVal("ledMount", "OVERHEAD");
  applyZ3RgbMapToCatalogs(state.z3RgbMap);

  setVal("zoneMode", "concentric");
  setChk("chk_dist", true);
  setChk("chk_msd", true);
  setChk("chk_zones", false);
  setChk("chk_zchange", false);
  setChk("chk_xy", false);
  setVal("videoMode", "1fps");
  setChk("chk_tracks", true);
  setChk("chk_heatmap", false);
  setChk("chk_picture", false);
  setVal("trackTimeSec", 15);
  setVal("heatmapPalette", "0");

  const daph = ORGANISM_PRESETS[0];
  setVal("targetSize", daph.targetSize);
  setVal("detThreshold", daph.detThreshold);
  setVal("msdThreshold", daph.msdThreshold);
  setVal("thermostatTemp", daph.temp);
  setChk("chk_thermostat", daph.thermostat);
  setVal("autorefTimeout", 60);

  document.querySelectorAll("#stepTabs .tab-btn").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-step") === "4");
  });
}
