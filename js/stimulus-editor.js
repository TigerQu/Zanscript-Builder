// Zantiks MWP Script Builder - Protocol tiles and per-protocol parameter forms, including the multi-track timeline editor
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

function renderStimGrid() {
  const wrap = document.getElementById("stimGrid");
  const advWrap = document.getElementById("stimGridAdvanced");
  wrap.innerHTML = "";
  if (advWrap) advWrap.innerHTML = "";
  for (const s of STIMULI) {
    const isAdv = Boolean(s.advanced && advWrap);
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "option-tile" + (isAdv ? " stim-adv-tile" : "") + (state.stimId === s.id ? " active" : "");
    tile.setAttribute("data-stim", s.id);
    tile.innerHTML = `<span class="tile-name">${s.name}</span><span class="tile-meta">${isAdv ? (s.desc || s.meta) : s.meta}</span>`;
    tile.addEventListener("click", () => {
      const changed = state.stimId !== s.id;
      state.stimId = s.id;
      if (changed) {
        pauseSimulator();
        simState.tSec = 0;
      }
      renderStimGrid();
      renderStimParams();
      refreshAll();
    });
    (isAdv ? advWrap : wrap).appendChild(tile);
  }
}

function renderStimParams() {
  const box = document.getElementById("stimParamsBox");
  const sp = state.stimParams;
  const id = state.stimId;

  if (id === "baseline") {
    box.innerHTML = `
        <div class="form-grid">
          <div class="field">
            <label>Chamber Lighting</label>
            <select data-sp="baseLight">
              <option value="LIGHT" ${sp.baseLight === "LIGHT" ? "selected" : ""}>Stimulus Light ON</option>
              <option value="DARK" ${sp.baseLight === "DARK" ? "selected" : ""}>Dark (IR Tracking Only)</option>
            </select>
          </div>
          <div class="field">
            <label>Time Bin (sec)</label>
            <input type="number" min="1" max="3600" step="1" data-sp="timeBinSec" value="${sp.timeBinSec}">
          </div>
          <div class="field">
            <label>Acclimation (sec)</label>
            <input type="number" min="0" max="7200" step="10" data-sp="acclimSec" value="${sp.acclimSec}">
          </div>
          <div class="field">
            <label>Recording Duration (sec)</label>
            <input type="number" min="5" max="86400" step="30" data-sp="durationSec" value="${sp.durationSec}">
          </div>
        </div>`;
  } else if (id === "ld_transitions") {
    box.innerHTML = `
        <div class="form-grid-3">
          <div class="field">
            <label>Starting Phase</label>
            <select data-sp="ldStart">
              <option value="LIGHT" ${sp.ldStart === "LIGHT" ? "selected" : ""}>Light First (Light -> Dark)</option>
              <option value="DARK" ${sp.ldStart === "DARK" ? "selected" : ""}>Dark First (Dark -> Light)</option>
            </select>
          </div>
          <div class="field">
            <label>Number of L/D Cycles</label>
            <input type="number" min="1" max="50" step="1" data-sp="ldCycles" value="${sp.ldCycles}">
          </div>
          <div class="field">
            <label>Each Phase Duration (sec)</label>
            <input type="number" min="5" max="7200" step="30" data-sp="ldPhaseSec" value="${sp.ldPhaseSec}">
          </div>
          <div class="field">
            <label>Acclimation (sec)</label>
            <input type="number" min="0" max="7200" step="10" data-sp="acclimSec" value="${sp.acclimSec}">
          </div>
          <div class="field">
            <label>Time Bin (sec)</label>
            <input type="number" min="1" max="600" step="1" data-sp="timeBinSec" value="${sp.timeBinSec}">
          </div>
        </div>`;
  } else if (id === "light_off_startle" || id === "light_on_pulse") {
    const isFlash = id === "light_on_pulse";
    const pulseLabel = isFlash ? "Light Flash Duration (sec)" : "Dark Pulse Duration (sec)";
    const pulseMin = isFlash ? "0.05" : "0.2";
    const pulseStep = isFlash ? "0.05" : "0.2";
    const curStrobe = parseInt(sp.strobeHz, 10) || 0;
    const strobeField = isFlash
      ? `<div class="field">
            <label>Flash Mode / Strobe</label>
            <select data-sp="strobeHz">
              <option value="0" ${curStrobe === 0 ? "selected" : ""}>Solid Flash (0 Hz)</option>
              <option value="2" ${curStrobe === 2 ? "selected" : ""}>2 Hz Strobe (250ms ON / OFF)</option>
              <option value="5" ${curStrobe === 5 ? "selected" : ""}>5 Hz Strobe (100ms ON / OFF)</option>
              <option value="10" ${curStrobe === 10 ? "selected" : ""}>10 Hz Strobe (50ms ON / OFF)</option>
            </select>
          </div>`
      : "";
    box.innerHTML = `
        <div class="form-grid-3">
          <div class="field">
            <label>Number of Pulses</label>
            <input type="number" min="1" max="100" step="1" data-sp="numPulses" value="${sp.numPulses}">
          </div>
          <div class="field">
            <label>${pulseLabel}</label>
            <input type="number" min="${pulseMin}" max="60" step="${pulseStep}" data-sp="pulseDurSec" value="${sp.pulseDurSec}">
          </div>
          <div class="field">
            <label>Inter-Trial Interval (sec)</label>
            <input type="number" min="1" max="1800" step="5" data-sp="itiSec" value="${sp.itiSec}">
          </div>
          <div class="field">
            <label>Pre-Pulse Baseline (sec)</label>
            <input type="number" min="0" max="3600" step="10" data-sp="preBaselineSec" value="${sp.preBaselineSec}">
          </div>
          <div class="field">
            <label>Acclimation (sec)</label>
            <input type="number" min="0" max="7200" step="10" data-sp="acclimSec" value="${sp.acclimSec}">
          </div>
          <div class="field">
            <label>Time Bin (sec)</label>
            <input type="number" min="1" max="300" step="1" data-sp="timeBinSec" value="${sp.timeBinSec}">
          </div>
          ${strobeField}
        </div>`;
  } else if (id === "vibration_startle") {
    box.innerHTML = `
        <div class="form-grid-3">
          <div class="field">
            <label>Tap Intensity (Stepper Mode)</label>
            <select data-sp="vibIntensity">
              <option value="U0" ${sp.vibIntensity === "U0" ? "selected" : ""}>Strong (Full Step - U0)</option>
              <option value="U1" ${sp.vibIntensity === "U1" ? "selected" : ""}>Medium (Half Step - U1)</option>
              <option value="U2" ${sp.vibIntensity === "U2" ? "selected" : ""}>Mild (Quarter Step - U2)</option>
              <option value="U3" ${sp.vibIntensity === "U3" ? "selected" : ""}>Gentle (Eighth Step - U3)</option>
            </select>
          </div>
          <div class="field">
            <label>Ambient Chamber Light</label>
            <select data-sp="vibAmbient">
              <option value="DARK" ${sp.vibAmbient === "DARK" ? "selected" : ""}>Dark (IR Only)</option>
              <option value="LIGHT" ${sp.vibAmbient === "LIGHT" ? "selected" : ""}>Stimulus Light ON</option>
            </select>
          </div>
          <div class="field">
            <label>Number of Vibration Taps</label>
            <input type="number" min="1" max="100" step="1" data-sp="numPulses" value="${sp.numPulses}">
          </div>
          <div class="field">
            <label>Inter-Trial Interval (sec)</label>
            <input type="number" min="1" max="1800" step="5" data-sp="itiSec" value="${sp.itiSec}">
          </div>
          <div class="field">
            <label>Pre-Tap Baseline (sec)</label>
            <input type="number" min="0" max="3600" step="10" data-sp="preBaselineSec" value="${sp.preBaselineSec}">
          </div>
          <div class="field">
            <label>Acclimation (sec)</label>
            <input type="number" min="0" max="7200" step="10" data-sp="acclimSec" value="${sp.acclimSec}">
          </div>
          <div class="field">
            <label>Time Bin (sec)</label>
            <input type="number" min="1" max="300" step="1" data-sp="timeBinSec" value="${sp.timeBinSec}">
          </div>
        </div>`;
  } else if (id === "acoustic_startle") {
    const audioSel = sp.audioFile || "tone";
    const isCustomAudio = audioSel === "custom";
    box.innerHTML = `
        <div class="form-grid-3">
          <div class="field">
            <label>Audio Cue (Built-in Sound Card)</label>
            <select data-sp="audioFile" id="acousticAudioSel">
              <option value="tone" ${audioSel === "tone" ? "selected" : ""}>Built-in Tone ("tone")</option>
              <option value="mono" ${audioSel === "mono" ? "selected" : ""}>Built-in Mono ("mono")</option>
              <option value="custom" ${isCustomAudio ? "selected" : ""}>Custom .wav in Assets</option>
            </select>
          </div>
          <div class="field" id="acousticCustomWrap" style="${isCustomAudio ? "" : "display:none;"}">
            <label>Custom Audio Filename (.wav)</label>
            <input type="text" data-sp="audioCustomFile" value="${sanitizeAudioAsset(sp.audioCustomFile || "stereo.wav")}" autocomplete="off">
          </div>
          <div class="field">
            <label>Ambient Chamber Light</label>
            <select data-sp="audioAmbient">
              <option value="DARK" ${sp.audioAmbient === "DARK" ? "selected" : ""}>Dark (IR Only)</option>
              <option value="LIGHT" ${sp.audioAmbient === "LIGHT" ? "selected" : ""}>Stimulus Light ON</option>
            </select>
          </div>
          <div class="field">
            <label>Number of Audio Cues</label>
            <input type="number" min="1" max="100" step="1" data-sp="numPulses" value="${sp.numPulses}">
          </div>
          <div class="field">
            <label>Inter-Trial Interval (sec)</label>
            <input type="number" min="1" max="1800" step="5" data-sp="itiSec" value="${sp.itiSec}">
          </div>
          <div class="field">
            <label>Pre-Cue Baseline (sec)</label>
            <input type="number" min="0" max="3600" step="10" data-sp="preBaselineSec" value="${sp.preBaselineSec}">
          </div>
          <div class="field">
            <label>Acclimation (sec)</label>
            <input type="number" min="0" max="7200" step="10" data-sp="acclimSec" value="${sp.acclimSec}">
          </div>
          <div class="field">
            <label>Time Bin (sec)</label>
            <input type="number" min="1" max="300" step="1" data-sp="timeBinSec" value="${sp.timeBinSec}">
          </div>
        </div>`;
  } else if (id === "ppi") {
    box.innerHTML = `
        <div class="form-grid-3">
          <div class="field">
            <label>Prepulse Intensity (Weak)</label>
            <select data-sp="ppiPrepulse">
              <option value="U3" ${sp.ppiPrepulse === "U3" ? "selected" : ""}>Gentle (Eighth Step - U3)</option>
              <option value="U2" ${sp.ppiPrepulse === "U2" ? "selected" : ""}>Mild (Quarter Step - U2)</option>
              <option value="U1" ${sp.ppiPrepulse === "U1" ? "selected" : ""}>Medium (Half Step - U1)</option>
            </select>
          </div>
          <div class="field">
            <label>Startle Pulse Intensity (Strong)</label>
            <select data-sp="ppiPulse">
              <option value="U0" ${sp.ppiPulse === "U0" ? "selected" : ""}>Strong (Full Step - U0)</option>
              <option value="U1" ${sp.ppiPulse === "U1" ? "selected" : ""}>Medium (Half Step - U1)</option>
            </select>
          </div>
          <div class="field">
            <label>Prepulse-to-Pulse ISI (ms)</label>
            <input type="number" min="50" max="2000" step="50" data-sp="ppiIsiMs" value="${sp.ppiIsiMs}">
          </div>
          <div class="field">
            <label>Trial Schedule</label>
            <select data-sp="ppiPattern">
              <option value="alternating" ${sp.ppiPattern === "alternating" ? "selected" : ""}>Alternating (Pulse-Alone &amp; PPI)</option>
              <option value="ppi_only" ${sp.ppiPattern === "ppi_only" ? "selected" : ""}>PPI Trials Only</option>
            </select>
          </div>
          <div class="field">
            <label>Number of Pairs / Trials</label>
            <input type="number" min="1" max="50" step="1" data-sp="ppiPairs" value="${sp.ppiPairs}">
          </div>
          <div class="field">
            <label>Ambient Chamber Light</label>
            <select data-sp="ppiAmbient">
              <option value="DARK" ${sp.ppiAmbient === "DARK" ? "selected" : ""}>Dark (IR Only)</option>
              <option value="LIGHT" ${sp.ppiAmbient === "LIGHT" ? "selected" : ""}>Stimulus Light ON</option>
            </select>
          </div>
          <div class="field">
            <label>Inter-Trial Interval (sec)</label>
            <input type="number" min="1" max="1800" step="5" data-sp="itiSec" value="${sp.itiSec}">
          </div>
          <div class="field">
            <label>Pre-Trial Baseline (sec)</label>
            <input type="number" min="0" max="3600" step="10" data-sp="preBaselineSec" value="${sp.preBaselineSec}">
          </div>
          <div class="field">
            <label>Acclimation (sec)</label>
            <input type="number" min="0" max="7200" step="10" data-sp="acclimSec" value="${sp.acclimSec}">
          </div>
          <div class="field">
            <label>Time Bin (sec)</label>
            <input type="number" min="1" max="300" step="1" data-sp="timeBinSec" value="${sp.timeBinSec}">
          </div>
        </div>
        <div class="proto-note">
          Uses split two-command PPI timing: <code>ZCOMMAND("${sp.ppiPrepulse || "U3"} D1190 M1 M-1 M1 M-1")</code> &rarr; <code>WAIT(${Number((Math.min(2000, Math.max(50, parseInt(sp.ppiIsiMs, 10) || 300)) / 1000).toFixed(3))})</code> &rarr; <code>LOGDATA(DATA_SNAPSHOT,"begin")</code> &rarr; <code>ZCOMMAND("${sp.ppiPulse || "U0"} D1190 M1 M-1 M1 M-1")</code> &rarr; <code>WAIT(TIME_BIN)</code>. Both <code>PULSE_ALONE</code> and <code>PPI_TRIAL</code> align their snapshot window to main-pulse onset so % PPI is unbiased across all ISIs (50&ndash;2000 ms).
        </div>`;
  } else if (id === "circadian") {
    const circRampMinVal = parseInt(sp.circRampMin, 10) || 0;
    const circCurveVal = sp.circRampCurve === "linear" ? "linear" : "gamma";
    box.innerHTML = `
        <div class="form-grid-3">
          <div class="field">
            <label>Light Hours per Cycle</label>
            <input type="number" min="0" max="24" step="1" data-sp="lightHours" value="${sp.lightHours}">
          </div>
          <div class="field">
            <label>Dark Hours per Cycle</label>
            <input type="number" min="0" max="24" step="1" data-sp="darkHours" value="${sp.darkHours}">
          </div>
          <div class="field">
            <label>Number of Cycles / Days</label>
            <input type="number" min="1" max="14" step="1" data-sp="numDays" value="${sp.numDays}">
          </div>
          <div class="field">
            <label>Time Bin (sec)</label>
            <input type="number" min="1" max="600" step="1" data-sp="circBinSec" value="${sp.circBinSec}">
          </div>
          <div class="field">
            <label>Dawn / Dusk PWM Ramp (min)</label>
            <input type="number" min="0" max="30" step="5" data-sp="circRampMin" value="${circRampMinVal}">
          </div>
          <div class="field">
            <label>Dawn / Dusk Curve</label>
            <select data-sp="circRampCurve" id="circRampCurveSel" ${circRampMinVal <= 0 ? "disabled" : ""}>
              <option value="gamma" ${circCurveVal === "gamma" ? "selected" : ""}>Gamma 2.2 (Log-Perceived)</option>
              <option value="linear" ${circCurveVal === "linear" ? "selected" : ""}>Linear</option>
            </select>
          </div>
        </div>`;
  } else if (id === "multi_phase") {
    const hwIsZ3 = document.getElementById("hwVersion").value === "Z3";
    if (state.timelineClips.some(c => String(c.track || "").startsWith("U_"))) {
      state.showUnderTracks = true;
    }
    const lightOpts = [
      ["DARK", "Dark (IR Only)"],
      ["WHITE", "White (~6000K)"],
      ["BLUE", "Blue (470 nm)"],
      ["GREEN", "Green (530 nm)"],
      ["RED", "Red (625 nm)"],
      ["UV", "UV (365 nm)"]
    ];
    const acclimOpts = lightOpts.map(([val, lbl]) =>
      `<option value="${val}" ${sp.mpAcclimLight === val ? "selected" : ""}>${lbl}</option>`
    ).join("");

    const tracksHtml = NLE_TRACKS.map(tr => {
      const mountCls = tr.group === "BOT"
        ? "nle-mount-bot"
        : (tr.group === "ENV" ? "nle-mount-env" : (tr.group === "STIM" ? "nle-mount-stim" : "nle-mount-top"));
      const isGroupStart = tr.id === "U_WHITE" || tr.id === "TEMP" || tr.id === "VIB";
      const isHidden = tr.group === "BOT" && !state.showUnderTracks;
      const rowCls = "nle-track-row" + (isGroupStart ? " nle-group-start" : "") + (isHidden ? " nle-row-hidden" : "");
      return `
        <div class="${rowCls}" id="nleRow_${tr.id}" data-track-row="${tr.id}" data-track-group="${tr.group}">
          <div class="nle-track-hdr">
            <div class="nle-track-title">
              <span class="nle-mount-tag ${mountCls}">${tr.group}</span>
              <span class="nle-swatch" style="background:${tr.swatch};"></span>
              <span class="nle-track-name">${tr.label}</span>
            </div>
            <button type="button" class="nle-track-add" data-nle-add="${tr.id}" title="Add clip to ${tr.group} ${tr.label} (${tr.sub})">+</button>
          </div>
          <div class="nle-lane" data-nle-lane="${tr.id}"></div>
        </div>`;
    }).join("");

    box.innerHTML = `
        <div class="form-grid-3">
          <div class="field">
            <label>Timeline Length (sec)</label>
            <input type="number" min="10" max="7200" step="10" data-sp="mpTimelineSec" value="${sp.mpTimelineSec}">
          </div>
          <div class="field">
            <label>Repeat Cycles</label>
            <input type="number" min="1" max="50" step="1" data-sp="mpCycles" value="${sp.mpCycles}">
          </div>
          <div class="field">
            <label>Time Bin (sec)</label>
            <input type="number" min="1" max="600" step="1" data-sp="timeBinSec" value="${sp.timeBinSec}">
          </div>
          <div class="field">
            <label>Acclimation (sec)</label>
            <input type="number" min="0" max="7200" step="10" data-sp="acclimSec" value="${sp.acclimSec}">
          </div>
          <div class="field">
            <label>Acclimation Light</label>
            <select data-sp="mpAcclimLight">${acclimOpts}</select>
          </div>
        </div>

        <div class="nle-section" id="nleRoot">
          <div class="nle-toolbar">
            <select id="nlePresetSel" class="nle-preset-sel" aria-label="Load timeline preset">
              <option value="" selected disabled>Load Preset...</option>
              <option value="bg_opto">Preset: White BG + Opto</option>
              <option value="bot_bg_top_opto">Preset: Bot White + Top Opto</option>
              <option value="multi_modal">Preset: Multi-Modal (Light + Vib + Audio)</option>
              <option value="dawn_dusk">Preset: Dawn / Dusk Smooth Ramp (Gamma)</option>
              <option value="sine_wave">Preset: Sine Breathing Wave</option>
              <option value="custom_curve">Preset: Custom Keyframe Envelope</option>
              <option value="opto_strobe">Preset: Opto Strobe (10 Hz)</option>
              <option value="rgb_overlap">Preset: RGB Overlap</option>
              <option value="sequential">Preset: Seq Sweep</option>
              <option value="run_through">Preset: Full Hardware Run-Through (All 13 Tracks)</option>
            </select>
            <div class="nle-toolbar-right">
              <button type="button" class="btn btn-xs${state.showUnderTracks ? " btn-toggle-active" : ""}" id="nleToggleUnderBtn">Bottom LEDs (Ch 8-13)</button>
              <button type="button" class="btn btn-xs" id="nleClearBtn">Clear</button>
            </div>
          </div>

          <div class="nle-workspace" id="nleWorkspace" tabindex="-1">
            <div class="nle-playhead" id="nlePlayhead"></div>
            <div class="nle-header-row">
              <div class="nle-corner">Tracks</div>
              <div class="nle-ruler" id="nleRuler" title="Click or drag ruler to scrub simulator playhead"></div>
            </div>
            ${tracksHtml}
            <div class="nle-summary-row" id="nleSummaryRow">
              <div class="nle-summary-hdr">
                <div class="nle-track-title">
                  <span class="nle-mount-tag nle-mount-sum">SUM</span>
                  <span class="nle-track-name">Composite</span>
                </div>
              </div>
              <div class="nle-summary-bar" id="nleSummaryBar" title="Click or drag composite bar to scrub simulator playhead"></div>
            </div>
          </div>

          <div class="nle-inspector" id="nleInspector"></div>
        </div>`;

    let rafId = null;
    function scheduleRefresh() {
      if (typeof window.requestAnimationFrame === "function") {
        if (rafId !== null) return;
        rafId = window.requestAnimationFrame(() => {
          rafId = null;
          refreshAll();
        });
      } else {
        refreshAll();
      }
    }

    function flushRefresh() {
      if (rafId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      refreshAll();
    }

    function blurTextFocusForTimeline() {
      const ae = document.activeElement;
      if (ae && ae.tagName && ["INPUT", "SELECT", "TEXTAREA"].includes(ae.tagName.toUpperCase()) && typeof ae.blur === "function") {
        ae.blur();
      }
    }

    function syncUnderRowsVisibility() {
      for (const tr of NLE_TRACKS) {
        if (tr.group !== "BOT") continue;
        const rowEl = document.getElementById("nleRow_" + tr.id);
        if (rowEl) rowEl.classList.toggle("nle-row-hidden", !state.showUnderTracks);
      }
      const togBtn = document.getElementById("nleToggleUnderBtn");
      if (togBtn) togBtn.classList.toggle("btn-toggle-active", Boolean(state.showUnderTracks));
    }

    function getTimelineBounds() {
      const bin = Math.max(1, parseFloat(state.stimParams.timeBinSec) || 1);
      const totalBins = Math.max(1, Math.round((Math.max(bin, parseFloat(state.stimParams.mpTimelineSec) || 180)) / bin));
      return { bin, totalSec: totalBins * bin };
    }

    function snapSec(sec, bin) {
      return Math.round(sec / bin) * bin;
    }

    function getSameTrackNeighborBounds(clip) {
      const { totalSec } = getTimelineBounds();
      const others = state.timelineClips.filter(c => c.track === clip.track && c.id !== clip.id);
      let minS = 0;
      let maxE = totalSec;
      for (const o of others) {
        if (o.endSec <= clip.startSec + 0.0001 && o.endSec > minS) minS = o.endSec;
        if (o.startSec >= clip.endSec - 0.0001 && o.startSec < maxE) maxE = o.startSec;
      }
      return { minS, maxE };
    }

    function getTrackFreeGaps(trackId) {
      const { bin, totalSec } = getTimelineBounds();
      const occupied = state.timelineClips
        .filter(c => c.track === trackId && c.startSec < totalSec && c.endSec > 0)
        .map(c => [Math.max(0, c.startSec), Math.min(totalSec, c.endSec)])
        .sort((a, b) => a[0] - b[0]);

      const gaps = [];
      let cursor = 0;
      for (const [s, e] of occupied) {
        if (s - cursor >= bin) gaps.push([cursor, s]);
        cursor = Math.max(cursor, e);
      }
      if (totalSec - cursor >= bin) gaps.push([cursor, totalSec]);
      return gaps;
    }

    function findGapContainingSec(trackId, sec) {
      const gaps = getTrackFreeGaps(trackId);
      return gaps.find(([gs, ge]) => sec >= gs - 0.001 && sec <= ge + 0.001) || null;
    }

    function findFreeSlotOnTrack(trackId, preferredCenterSec) {
      const { bin, totalSec } = getTimelineBounds();
      const gaps = getTrackFreeGaps(trackId);
      if (gaps.length === 0) return null;

      let chosen = gaps[0];
      if (typeof preferredCenterSec === "number") {
        const hit = gaps.find(([gs, ge]) => preferredCenterSec >= gs && preferredCenterSec <= ge);
        if (hit) chosen = hit;
        else {
          chosen = gaps.reduce((best, g) => {
            const dBest = Math.min(Math.abs(preferredCenterSec - best[0]), Math.abs(preferredCenterSec - best[1]));
            const dCur = Math.min(Math.abs(preferredCenterSec - g[0]), Math.abs(preferredCenterSec - g[1]));
            return dCur < dBest ? g : best;
          }, gaps[0]);
        }
      } else {
        chosen = gaps.reduce((best, g) => (g[1] - g[0] > best[1] - best[0] ? g : best), gaps[0]);
      }

      const [gs, ge] = chosen;
      const defaultWidth = Math.max(bin, snapSec(Math.min(ge - gs, Math.max(bin * 2, totalSec * 0.16)), bin));
      let start = typeof preferredCenterSec === "number"
        ? snapSec(preferredCenterSec - defaultWidth / 2, bin)
        : gs;
      start = Math.max(gs, Math.min(ge - defaultWidth, start));
      const end = Math.min(ge, start + defaultWidth);
      return end > start ? [start, end] : null;
    }

    function addClipToTrack(trackId, preferredSec) {
      if (String(trackId || "").startsWith("U_") && !state.showUnderTracks) {
        state.showUnderTracks = true;
        syncUnderRowsVisibility();
      }
      const slot = findFreeSlotOnTrack(trackId, preferredSec);
      if (!slot) {
        showToast(`No free space left on ${trackId} track`);
        return;
      }
      const baseT = parseFloat(document.getElementById("thermostatTemp").value) || 22;
      const defaultVal = trackId === "TEMP"
        ? baseT
        : (trackId === "VIB" ? 2 : (trackId === "AUDIO" ? "tone" : 100));
      const newClip = {
        id: ++_nextClipId,
        track: trackId,
        startSec: slot[0],
        endSec: slot[1],
        val: defaultVal
      };
      state.timelineClips.push(newClip);
      state.selectedClipId = newClip.id;
      syncNleDom(true, false);
      flushRefresh();
    }

    function deleteSelectedClip() {
      if (state.selectedClipId === null) return false;
      const before = state.timelineClips.length;
      state.timelineClips = state.timelineClips.filter(c => c.id !== state.selectedClipId);
      state.selectedClipId = null;
      if (state.timelineClips.length !== before) {
        syncNleDom(true, false);
        flushRefresh();
        return true;
      }
      return false;
    }

    function deselectClip() {
      if (state.selectedClipId === null) return;
      state.selectedClipId = null;
      syncNleDom(true, false);
    }

    function nudgeSelectedClip(binDelta) {
      const sel = state.timelineClips.find(c => c.id === state.selectedClipId);
      if (!sel) return;
      const { bin } = getTimelineBounds();
      const dur = sel.endSec - sel.startSec;
      const bounds = getSameTrackNeighborBounds(sel);
      let ns = snapSec(sel.startSec + binDelta * bin, bin);
      ns = Math.max(bounds.minS, Math.min(bounds.maxE - dur, ns));
      if (ns !== sel.startSec) {
        sel.startSec = ns;
        sel.endSec = ns + dur;
        syncNleDom(false, false);
        flushRefresh();
      }
    }

    function updateLiveHud() {
      const durEl = document.getElementById("nleInspDur");
      if (!durEl) return;
      const sel = state.timelineClips.find(c => c.id === state.selectedClipId);
      if (!sel) return;
      durEl.textContent = `${Math.max(0, sel.endSec - sel.startSec)}s`;
    }

    function syncNleInspector() {
      const insp = document.getElementById("nleInspector");
      if (!insp) return;
      const { bin, totalSec } = getTimelineBounds();
      const sel = state.timelineClips.find(c => c.id === state.selectedClipId);
      if (!sel) {
        insp.innerHTML = `<span class="nle-insp-hint"><strong>Tip:</strong> drag on an empty lane or use a track&rsquo;s + button to add a clip &middot; drag a clip to move it, drag its edges to resize &middot; click a clip to edit it here, <span class="nle-kbd">Backspace</span> deletes it.</span>`;
        return;
      }
      const tr = NLE_TRACKS.find(t => t.id === sel.track) || NLE_TRACKS[0];
      const isTemp = tr.kind === "temp";
      const isVib = tr.kind === "vib";
      const isAudio = tr.kind === "audio";
      const durSec = Math.max(0, sel.endSec - sel.startSec);

      const mountCls = tr.group === "BOT"
        ? "nle-mount-bot"
        : (tr.group === "ENV" ? "nle-mount-env" : (tr.group === "STIM" ? "nle-mount-stim" : "nle-mount-top"));

      let valFieldHtml = "";
      let extraRowHtml = "";
      const isLight = tr.kind === "light";
      const curRep = (isVib || isAudio) && Number(sel.repeatSec) > 0 ? Math.max(bin, Math.round(sel.repeatSec)) : 0;
      const hasRamp = isLight && isClipCurved(sel);
      const curCurve = isLight ? normalizeLightCurveId(sel.curve) : "linear";
      const curSteps = isLight ? normalizeRampSteps(sel.rampSteps) : 8;
      const curStrobe = isLight && [2, 5, 10].includes(parseInt(sel.strobeHz, 10)) ? parseInt(sel.strobeHz, 10) : 0;

      const inspSub = isVib
        ? (curRep > 0 ? `ZCOMMAND · repeats every ${curRep}s` : "ZCOMMAND · once at clip start")
        : (isAudio
            ? (curRep > 0 ? `AUDIO_FILE · repeats every ${curRep}s` : "AUDIO_FILE · once at clip start")
            : tr.sub);

      if (isVib) {
        const curLvl = clampVibLevel(sel.val);
        const opts = VIB_STEP_MODES.map(m =>
          `<option value="${m.level}" ${m.level === curLvl ? "selected" : ""}>${m.label}</option>`
        ).join("");
        valFieldHtml = `
            <div class="nle-insp-field nle-insp-field-wide">
              <label for="nleInspVibSel">Motor Intensity</label>
              <select id="nleInspVibSel">${opts}</select>
            </div>`;
        extraRowHtml = `
            <div class="nle-insp-extra-row is-single">
              <div class="nle-insp-field">
                <label for="nleInspRepMode">Trigger Mode</label>
                <div class="nle-insp-audio-row">
                  <select id="nleInspRepMode">
                    <option value="once" ${curRep === 0 ? "selected" : ""}>Once at start</option>
                    <option value="repeat" ${curRep > 0 ? "selected" : ""}>Repeat every (sec)</option>
                  </select>
                  <input type="number" class="nle-insp-repeat-num" id="nleInspRepSec" min="${bin}" max="3600" step="${bin}" value="${curRep > 0 ? curRep : Math.max(5, bin)}" style="${curRep > 0 ? "" : "display:none;"}">
                </div>
              </div>
            </div>`;
      } else if (isAudio) {
        const curFile = sanitizeAudioAsset(sel.val);
        const isBuiltin = AUDIO_BUILTINS.includes(curFile);
        const selMode = isBuiltin ? curFile : "custom";
        valFieldHtml = `
            <div class="nle-insp-field nle-insp-field-wide">
              <label for="nleInspAudioSel">Audio Asset</label>
              <div class="nle-insp-audio-row">
                <select id="nleInspAudioSel">
                  <option value="tone" ${selMode === "tone" ? "selected" : ""}>Built-in Tone ("tone")</option>
                  <option value="mono" ${selMode === "mono" ? "selected" : ""}>Built-in Mono ("mono")</option>
                  <option value="custom" ${selMode === "custom" ? "selected" : ""}>Custom .wav</option>
                </select>
                <input type="text" id="nleInspAudioCustom" value="${isBuiltin ? "stereo.wav" : curFile}" style="${selMode === "custom" ? "" : "display:none;"}" autocomplete="off">
              </div>
            </div>`;
        extraRowHtml = `
            <div class="nle-insp-extra-row is-single">
              <div class="nle-insp-field">
                <label for="nleInspRepMode">Trigger Mode</label>
                <div class="nle-insp-audio-row">
                  <select id="nleInspRepMode">
                    <option value="once" ${curRep === 0 ? "selected" : ""}>Once at start</option>
                    <option value="repeat" ${curRep > 0 ? "selected" : ""}>Repeat every (sec)</option>
                  </select>
                  <input type="number" class="nle-insp-repeat-num" id="nleInspRepSec" min="${bin}" max="3600" step="${bin}" value="${curRep > 0 ? curRep : Math.max(5, bin)}" style="${curRep > 0 ? "" : "display:none;"}">
                </div>
              </div>
            </div>`;
      } else {
        const valLabel = isTemp ? "Temp (°C)" : (hasRamp ? "Start Brightness (%)" : "Brightness (%)");
        const valDisabled = (!isTemp && !hwIsZ3) ? "disabled" : "";
        const valMin = isTemp ? "10" : (hasRamp ? "0" : "5");
        const valMax = isTemp ? "40" : "100";
        const valStep = isTemp ? "0.5" : "1";
        valFieldHtml = `
            <div class="nle-insp-field nle-insp-field-wide">
              <label for="nleInspVal">${valLabel}</label>
              <div class="nle-insp-slider">
                <input type="range" id="nleInspRange" min="${valMin}" max="${valMax}" step="${valStep}" value="${sel.val}" ${valDisabled} aria-label="${valLabel}">
                <input type="number" id="nleInspVal" min="${valMin}" max="${valMax}" step="${valStep}" value="${sel.val}" ${valDisabled}>
              </div>
            </div>`;
        if (isLight) {
          const endValShown = hasRamp
            ? (curCurve === "custom" && Array.isArray(sel.keyframes) && sel.keyframes.length >= 2
                ? Math.round(sel.keyframes[sel.keyframes.length - 1].y)
                : Math.round(sel.endVal))
            : (sel.val >= 50 ? 0 : 100);
          const endDisabled = (!hasRamp || !hwIsZ3) ? "disabled" : "";
          const endLabelTxt = curCurve === "sine"
            ? "Peak Brightness (%) &middot; Sine Pulse"
            : "End Brightness (%) &middot; Smooth PWM Ramp";
          const curveOpts = LIGHT_CURVE_TYPES.map(ct =>
            `<option value="${ct.id}" ${ct.id === curCurve ? "selected" : ""}>${ct.label}</option>`
          ).join("");
          const stepOpts = LIGHT_RAMP_STEP_OPTIONS.map(n =>
            `<option value="${n}" ${n === curSteps ? "selected" : ""}>${n} steps${n === 8 ? " (Default)" : ""}</option>`
          ).join("");
          const curveRowHtml = (hasRamp && hwIsZ3) ? `
            <div class="nle-insp-extra-row" id="nleCurveRow">
              <div class="nle-curve-left">
                <div class="nle-insp-field">
                  <label for="nleInspCurveSel">PWM Curve Shape</label>
                  <select id="nleInspCurveSel">${curveOpts}</select>
                </div>
                <div class="nle-curve-subrow">
                  <div class="nle-insp-field">
                    <label for="nleInspStepsSel">PWM Steps</label>
                    <select id="nleInspStepsSel">${stepOpts}</select>
                  </div>
                  ${curCurve === "custom" ? '<button type="button" class="btn btn-xs" id="nleCurveResetBtn" title="Reset custom keyframes">Reset</button>' : ""}
                </div>
              </div>
              <div class="nle-curve-box">
                <div class="nle-curve-head">
                  <label>PWM Curve Preview</label>
                  <span class="nle-curve-readout" id="nleCurveReadout">${curSteps} steps &middot; ${curCurve === "custom" ? "Drag points · Click add · Dbl-click del" : "Click curve to edit keyframes"}</span>
                </div>
                <svg id="nleCurveSvg" class="nle-curve-svg" viewBox="0 0 460 104"></svg>
              </div>
            </div>` : "";
          extraRowHtml = `
            <div class="nle-insp-extra-row">
              <div class="nle-insp-field">
                <label for="nleInspStrobeSel">Flash / Strobe Mode</label>
                <select id="nleInspStrobeSel">
                  <option value="0" ${curStrobe === 0 ? "selected" : ""}>Solid Light (0 Hz)</option>
                  <option value="2" ${curStrobe === 2 ? "selected" : ""}>2 Hz Strobe (250ms)</option>
                  <option value="5" ${curStrobe === 5 ? "selected" : ""}>5 Hz Strobe (100ms)</option>
                  <option value="10" ${curStrobe === 10 ? "selected" : ""}>10 Hz Strobe (50ms)</option>
                </select>
              </div>
              <div class="nle-insp-field nle-insp-field-wide">
                <label class="nle-insp-inline-toggle">
                  <input type="checkbox" id="nleInspRampChk" ${hasRamp ? "checked" : ""} ${!hwIsZ3 ? "disabled" : ""}>
                  ${endLabelTxt}
                </label>
                <div class="nle-insp-slider">
                  <input type="range" id="nleInspEndRange" min="0" max="100" step="1" value="${endValShown}" ${endDisabled} aria-label="End Brightness (%)">
                  <input type="number" id="nleInspEndVal" min="0" max="100" step="1" value="${endValShown}" ${endDisabled}>
                </div>
              </div>
            </div>${curveRowHtml}`;
        }
      }

      insp.innerHTML = `
          <div class="nle-insp-head">
            <div class="nle-insp-title">
              <span class="nle-mount-tag ${mountCls}">${tr.group}</span>
              <span class="nle-swatch" style="background:${tr.swatch};"></span>
              <span>${tr.label}</span>
              <span class="nle-insp-sub">${inspSub}</span>
            </div>
            <div class="nle-insp-actions">
              <span class="nle-hud" id="nleInspDur">${durSec}s</span>
              <button type="button" class="btn btn-xs" id="nleDelClipBtn" title="Shortcut: Backspace or Delete">Delete Clip</button>
            </div>
          </div>
          <div class="nle-insp-fields">
            <div class="nle-insp-field">
              <label for="nleInspStart">Start (sec)</label>
              <input type="number" id="nleInspStart" min="0" max="${totalSec - bin}" step="${bin}" value="${sel.startSec}">
            </div>
            <div class="nle-insp-field">
              <label for="nleInspEnd">End (sec)</label>
              <input type="number" id="nleInspEnd" min="${bin}" max="${totalSec}" step="${bin}" value="${sel.endSec}">
            </div>
            ${valFieldHtml}
          </div>
          ${extraRowHtml}`;

      const sInp = document.getElementById("nleInspStart");
      const eInp = document.getElementById("nleInspEnd");
      const rInp = document.getElementById("nleInspRange");
      const vInp = document.getElementById("nleInspVal");
      const vibSel = document.getElementById("nleInspVibSel");
      const audSel = document.getElementById("nleInspAudioSel");
      const audCustom = document.getElementById("nleInspAudioCustom");
      const repMode = document.getElementById("nleInspRepMode");
      const repSecInp = document.getElementById("nleInspRepSec");
      const rampChk = document.getElementById("nleInspRampChk");
      const endRangeInp = document.getElementById("nleInspEndRange");
      const endValInp = document.getElementById("nleInspEndVal");
      const curveSel = document.getElementById("nleInspCurveSel");
      const stepsSel = document.getElementById("nleInspStepsSel");
      const curveResetBtn = document.getElementById("nleCurveResetBtn");
      const curveSvg = document.getElementById("nleCurveSvg");
      const curveReadout = document.getElementById("nleCurveReadout");
      const strobeSel = document.getElementById("nleInspStrobeSel");
      const dBtn = document.getElementById("nleDelClipBtn");

      const CURVE_PAD = { l: 34, r: 12, t: 10, b: 18, w: 460, h: 104 };
      const getCurveMetrics = () => {
        const w = (curveSvg && curveSvg.clientWidth > 120) ? Math.round(curveSvg.clientWidth) : CURVE_PAD.w;
        const h = CURVE_PAD.h;
        const pw = Math.max(120, w - CURVE_PAD.l - CURVE_PAD.r);
        const ph = h - CURVE_PAD.t - CURVE_PAD.b;
        return { w, h, pw, ph };
      };

      const redrawCurveEditor = (statusText) => {
        if (!curveSvg || !isLight) return;
        const { w: svgW, h: svgH, pw: plotW, ph: plotH } = getCurveMetrics();
        curveSvg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
        const tToX = (t) => CURVE_PAD.l + Math.max(0, Math.min(1, t)) * plotW;
        const yToPy = (y) => CURVE_PAD.t + (1 - Math.max(0, Math.min(100, y)) / 100) * plotH;
        const cId = normalizeLightCurveId(sel.curve);
        const effDur = Math.max(bin, sel.endSec - sel.startSec);
        const maxSteps = Math.max(2, Math.round(effDur / bin));
        const stCount = Math.min(normalizeRampSteps(sel.rampSteps), maxSteps);

        let svgHtml = "";
        // Horizontal gridlines & % axis labels
        for (const pct of [100, 50, 0]) {
          const py = yToPy(pct);
          svgHtml += `<line x1="${CURVE_PAD.l}" y1="${py.toFixed(1)}" x2="${CURVE_PAD.l + plotW}" y2="${py.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" ${pct === 50 ? 'stroke-dasharray="3,3"' : ""}/>`;
          svgHtml += `<text x="${CURVE_PAD.l - 5}" y="${(py + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" font-family="ui-monospace,monospace" fill="#64748b">${pct}%</text>`;
        }
        // Bottom time axis labels
        const midLbl = `${Number((effDur / 2).toFixed(1))}s`;
        svgHtml += `<text x="${CURVE_PAD.l}" y="${svgH - 4}" text-anchor="start" font-size="9.5" font-family="ui-monospace,monospace" fill="#64748b">0s</text>`;
        svgHtml += `<text x="${(CURVE_PAD.l + plotW / 2).toFixed(1)}" y="${svgH - 4}" text-anchor="middle" font-size="9.5" font-family="ui-monospace,monospace" fill="#64748b">${midLbl}</text>`;
        svgHtml += `<text x="${CURVE_PAD.l + plotW}" y="${svgH - 4}" text-anchor="end" font-size="9.5" font-family="ui-monospace,monospace" fill="#64748b">${effDur}s</text>`;

        // Discrete Zanscript PWM step staircase bars
        for (let k = 0; k < stCount; k++) {
          const t0 = k / stCount;
          const t1 = (k + 1) / stCount;
          const pct = evaluateLightCurvePct(sel, (t0 + t1) / 2);
          const bx = tToX(t0);
          const bw = tToX(t1) - bx;
          const by = yToPy(pct);
          const bh = Math.max(0, yToPy(0) - by);
          svgHtml += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${tr.bg}" fill-opacity="0.72" stroke="${tr.border}" stroke-opacity="0.26" stroke-width="0.7"/>`;
        }

        // Smooth continuous reference curve
        const sampleN = 48;
        const pts = [];
        for (let i = 0; i <= sampleN; i++) {
          const tt = i / sampleN;
          const yy = evaluateLightCurvePct(sel, tt);
          pts.push(`${tToX(tt).toFixed(1)},${yToPy(yy).toFixed(1)}`);
        }
        svgHtml += `<polyline points="${pts.join(" ")}" fill="none" stroke="${tr.border}" stroke-width="2" stroke-linejoin="round" pointer-events="none"/>`;

        // Interactive keyframe handles when Custom Keyframes mode is active
        if (cId === "custom" && Array.isArray(sel.keyframes)) {
          sel.keyframes.forEach((kf, idx) => {
            const isEdge = idx === 0 || idx === sel.keyframes.length - 1;
            const cx = tToX(kf.t);
            const cy = yToPy(kf.y);
            svgHtml += `<circle class="nle-kf-pt${isEdge ? " is-edge" : ""}" data-kf-idx="${idx}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.8" fill="#ffffff" stroke="${tr.border}" stroke-width="2"/>`;
          });
        }

        curveSvg.innerHTML = svgHtml;
        if (curveReadout) {
          curveReadout.textContent = statusText || (
            cId === "custom"
              ? `${stCount} steps · ${(sel.keyframes || []).length} pts (drag / click / dbl-click)`
              : `${stCount} steps · Click curve to draw keyframes`
          );
        }
      };

      const applyStartEnd = (normalize) => {
        const bounds = getSameTrackNeighborBounds(sel);
        let ns = snapSec(parseFloat(sInp.value) || 0, bin);
        let ne = snapSec(parseFloat(eInp.value) || bin, bin);
        ns = Math.max(bounds.minS, Math.min(sel.endSec - bin, ns));
        ne = Math.min(bounds.maxE, Math.max(ns + bin, ne));
        sel.startSec = ns;
        sel.endSec = ne;
        if (normalize) { sInp.value = ns; eInp.value = ne; }
        syncNleDom(false, false);
        flushRefresh();
      };
      sInp.addEventListener("change", () => applyStartEnd(true));
      eInp.addEventListener("change", () => applyStartEnd(true));

      if (vibSel) {
        vibSel.addEventListener("change", () => {
          sel.val = clampVibLevel(vibSel.value);
          syncNleDom(false, false);
          flushRefresh();
        });
      }
      if (audSel) {
        audSel.addEventListener("change", () => {
          if (audSel.value === "custom") {
            if (audCustom) {
              audCustom.style.display = "";
              sel.val = sanitizeAudioAsset(audCustom.value || "stereo.wav");
            }
          } else {
            if (audCustom) audCustom.style.display = "none";
            sel.val = audSel.value;
          }
          syncNleDom(false, false);
          flushRefresh();
        });
      }
      if (audCustom) {
        audCustom.addEventListener("input", () => {
          sel.val = sanitizeAudioAsset(audCustom.value);
          syncNleDom(false, false);
          scheduleRefresh();
        });
        audCustom.addEventListener("change", () => {
          sel.val = sanitizeAudioAsset(audCustom.value);
          audCustom.value = sel.val;
          syncNleDom(false, false);
          flushRefresh();
        });
      }
      if (repMode) {
        repMode.addEventListener("change", () => {
          if (repMode.value === "repeat") {
            const iv = Math.max(bin, snapSec(parseFloat(repSecInp ? repSecInp.value : 5) || Math.max(5, bin), bin));
            sel.repeatSec = iv;
          } else {
            delete sel.repeatSec;
          }
          syncNleDom(true, false);
          flushRefresh();
        });
      }
      if (repSecInp) {
        repSecInp.addEventListener("change", () => {
          const iv = Math.max(bin, snapSec(parseFloat(repSecInp.value) || bin, bin));
          sel.repeatSec = iv;
          repSecInp.value = iv;
          syncNleDom(true, false);
          flushRefresh();
        });
      }
      if (rampChk) {
        rampChk.addEventListener("change", () => {
          if (rampChk.checked) {
            const ev = endValInp ? Math.min(100, Math.max(0, Math.round(parseFloat(endValInp.value) || 0))) : 100;
            sel.endVal = ev === Math.round(sel.val) ? (sel.val >= 50 ? 0 : 100) : ev;
          } else {
            delete sel.endVal;
            delete sel.curve;
            delete sel.rampSteps;
            delete sel.keyframes;
            if (sel.val < 5) sel.val = 5;
          }
          syncNleDom(true, false);
          flushRefresh();
        });
      }
      if (curveSel) {
        curveSel.addEventListener("change", () => {
          const nextC = normalizeLightCurveId(curveSel.value);
          if (nextC === "custom") {
            sel.keyframes = sampleClipCurveToKeyframes(sel, 5);
            sel.curve = "custom";
            sel.val = sel.keyframes[0].y;
            sel.endVal = sel.keyframes[sel.keyframes.length - 1].y;
          } else {
            delete sel.keyframes;
            if (nextC === "linear") delete sel.curve;
            else sel.curve = nextC;
            if (Math.round(sel.endVal) === Math.round(sel.val)) {
              sel.endVal = sel.val >= 50 ? 0 : 100;
            }
          }
          syncNleDom(true, false);
          flushRefresh();
        });
      }
      if (stepsSel) {
        stepsSel.addEventListener("change", () => {
          const st = normalizeRampSteps(stepsSel.value);
          if (st === 8) delete sel.rampSteps;
          else sel.rampSteps = st;
          redrawCurveEditor();
          syncNleDom(false, false);
          flushRefresh();
        });
      }
      if (curveResetBtn) {
        curveResetBtn.addEventListener("click", () => {
          const sY = Math.min(100, Math.max(0, Math.round(sel.val)));
          const eY = Number.isFinite(sel.endVal) ? Math.min(100, Math.max(0, Math.round(sel.endVal))) : 100;
          sel.keyframes = [{ t: 0, y: sY }, { t: 0.5, y: Math.round((sY + eY) / 2) }, { t: 1, y: eY }];
          redrawCurveEditor();
          syncNleDom(false, false);
          flushRefresh();
        });
      }
      if (curveSvg) {
        redrawCurveEditor();
        const clientToCurve = (clientX, clientY) => {
          const { w: svgW, h: svgH, pw: plotW, ph: plotH } = getCurveMetrics();
          const rect = curveSvg.getBoundingClientRect();
          const sx = ((clientX - rect.left) / Math.max(1, rect.width)) * svgW;
          const sy = ((clientY - rect.top) / Math.max(1, rect.height)) * svgH;
          const t = Math.min(1, Math.max(0, (sx - CURVE_PAD.l) / plotW));
          const y = Math.min(100, Math.max(0, Math.round((1 - (sy - CURVE_PAD.t) / plotH) * 100)));
          return { t: Number(t.toFixed(3)), y };
        };

        curveSvg.addEventListener("dblclick", (e) => {
          const ptEl = e.target && e.target.closest ? e.target.closest("[data-kf-idx]") : null;
          if (!ptEl || sel.curve !== "custom" || !Array.isArray(sel.keyframes)) return;
          const idx = parseInt(ptEl.getAttribute("data-kf-idx"), 10);
          if (idx > 0 && idx < sel.keyframes.length - 1) {
            sel.keyframes.splice(idx, 1);
            redrawCurveEditor();
            syncNleDom(false, false);
            flushRefresh();
          }
        });

        curveSvg.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const ptEl = e.target && e.target.closest ? e.target.closest("[data-kf-idx]") : null;
          let activeIdx = -1;
          let switchedToCustom = false;

          if (sel.curve !== "custom") {
            // Clicking directly on a preset curve converts to custom keyframes and inserts/selects a point
            sel.keyframes = sampleClipCurveToKeyframes(sel, 5);
            sel.curve = "custom";
            switchedToCustom = true;
          }
          if (ptEl && !switchedToCustom) {
            activeIdx = parseInt(ptEl.getAttribute("data-kf-idx"), 10);
          } else {
            const pt = clientToCurve(e.clientX, e.clientY);
            // If clicking very near an existing point, grab it; else insert a new interior keyframe
            const nearIdx = sel.keyframes.findIndex(k => Math.abs(k.t - pt.t) < 0.045 && Math.abs(k.y - pt.y) < 12);
            if (nearIdx >= 0) {
              activeIdx = nearIdx;
            } else if (sel.keyframes.length < 10 && pt.t > 0.03 && pt.t < 0.97) {
              sel.keyframes.push({ t: pt.t, y: pt.y });
              sel.keyframes.sort((a, b) => a.t - b.t);
              activeIdx = sel.keyframes.findIndex(k => k.t === pt.t && k.y === pt.y);
            } else {
              activeIdx = pt.t <= 0.03 ? 0 : sel.keyframes.length - 1;
              sel.keyframes[activeIdx].y = pt.y;
            }
          }
          if (activeIdx < 0) return;
          if (switchedToCustom && curveSel) curveSel.value = "custom";

          const effDur = Math.max(bin, sel.endSec - sel.startSec);
          const updateAt = (clientX, clientY) => {
            const pt = clientToCurve(clientX, clientY);
            const kfs = sel.keyframes;
            if (activeIdx === 0) {
              kfs[0].y = pt.y;
              sel.val = pt.y;
              if (rInp) rInp.value = pt.y;
              if (vInp) vInp.value = pt.y;
            } else if (activeIdx === kfs.length - 1) {
              kfs[activeIdx].y = pt.y;
              sel.endVal = pt.y;
              if (endRangeInp) endRangeInp.value = pt.y;
              if (endValInp) endValInp.value = pt.y;
            } else {
              const minT = Number((kfs[activeIdx - 1].t + 0.025).toFixed(3));
              const maxT = Number((kfs[activeIdx + 1].t - 0.025).toFixed(3));
              kfs[activeIdx].t = Math.min(maxT, Math.max(minT, pt.t));
              kfs[activeIdx].y = pt.y;
            }
            const curKf = kfs[activeIdx];
            const secAt = Number((curKf.t * effDur).toFixed(1));
            const pwmAt = Math.round((curKf.y / 100) * 4095);
            redrawCurveEditor(`t=${secAt}s · ${curKf.y}% (PWM ${pwmAt})`);
            syncNleDom(false, false);
            scheduleRefresh();
          };
          updateAt(e.clientX, e.clientY);

          const onKfMove = (me) => updateAt(me.clientX, me.clientY);
          const onKfUp = () => {
            window.removeEventListener("mousemove", onKfMove);
            window.removeEventListener("mouseup", onKfUp);
            if (switchedToCustom) syncNleDom(true, false);
            else redrawCurveEditor();
            flushRefresh();
          };
          window.addEventListener("mousemove", onKfMove);
          window.addEventListener("mouseup", onKfUp);
        });
      }
      if (endValInp) {
        const applyEndVal = (rawVal, fromRange) => {
          const raw = parseFloat(rawVal);
          if (!Number.isFinite(raw)) return;
          const ev = Math.min(100, Math.max(0, Math.round(raw)));
          sel.endVal = ev;
          if (sel.curve === "custom" && Array.isArray(sel.keyframes) && sel.keyframes.length >= 2) {
            sel.keyframes[sel.keyframes.length - 1].y = ev;
          }
          if (fromRange) endValInp.value = ev;
          if (!fromRange && endRangeInp) endRangeInp.value = ev;
          redrawCurveEditor();
          syncNleDom(false, false);
          scheduleRefresh();
        };
        if (endRangeInp) {
          endRangeInp.addEventListener("input", () => applyEndVal(endRangeInp.value, true));
          endRangeInp.addEventListener("change", () => flushRefresh());
        }
        endValInp.addEventListener("input", () => applyEndVal(endValInp.value, false));
        endValInp.addEventListener("change", () => {
          const ev = Math.min(100, Math.max(0, Math.round(parseFloat(endValInp.value) || 0)));
          sel.endVal = ev;
          if (sel.curve === "custom" && Array.isArray(sel.keyframes) && sel.keyframes.length >= 2) {
            sel.keyframes[sel.keyframes.length - 1].y = ev;
          }
          endValInp.value = ev;
          if (endRangeInp) endRangeInp.value = ev;
          redrawCurveEditor();
          syncNleDom(false, false);
          flushRefresh();
        });
      }
      if (strobeSel) {
        strobeSel.addEventListener("change", () => {
          const hz = parseInt(strobeSel.value, 10) || 0;
          if ([2, 5, 10].includes(hz)) sel.strobeHz = hz;
          else delete sel.strobeHz;
          syncNleDom(false, false);
          flushRefresh();
        });
      }
      if (vInp) {
        const applyVal = (rawVal, fromRange) => {
          const raw = parseFloat(rawVal);
          if (!Number.isFinite(raw)) return;
          const allowZero = isLight && isClipCurved(sel);
          sel.val = isTemp
            ? Math.min(40, Math.max(10, Number(raw.toFixed(1))))
            : Math.min(100, Math.max(allowZero ? 0 : 5, Math.round(raw)));
          if (isLight && sel.curve === "custom" && Array.isArray(sel.keyframes) && sel.keyframes.length >= 2) {
            sel.keyframes[0].y = sel.val;
          }
          if (fromRange && vInp) vInp.value = sel.val;
          if (!fromRange && rInp) rInp.value = sel.val;
          redrawCurveEditor();
          syncNleDom(false, false);
          scheduleRefresh();
        };
        if (rInp) {
          rInp.addEventListener("input", () => applyVal(rInp.value, true));
          rInp.addEventListener("change", () => flushRefresh());
        }
        vInp.addEventListener("input", () => applyVal(vInp.value, false));
        vInp.addEventListener("change", () => { vInp.value = sel.val; flushRefresh(); });
      }

      dBtn.addEventListener("click", () => deleteSelectedClip());
      updateLiveHud();
    }

    function formatClipLabel(c, tr, totalSec) {
      const effStart = Math.max(0, c.startSec);
      const effEnd = Math.min(totalSec, c.endSec);
      const dur = Math.max(0, effEnd - effStart);
      const ratio = dur / Math.max(1, totalSec);
      if (ratio < 0.055) return "";
      let main;
      if (tr.kind === "temp") {
        main = `${c.val}°C`;
      } else if (tr.kind === "vib") {
        const rep = Number(c.repeatSec) > 0 ? ` ↻${c.repeatSec}s` : "";
        main = `${vibLevelToCode(c.val)}${rep || " Tap"}`;
      } else if (tr.kind === "audio") {
        const rep = Number(c.repeatSec) > 0 ? ` ↻${c.repeatSec}s` : "";
        main = `${sanitizeAudioAsset(c.val)}${rep}`;
      } else {
        const hasR = hwIsZ3 && isClipCurved(c);
        const st = [2, 5, 10].includes(parseInt(c.strobeHz, 10)) ? ` ${c.strobeHz}Hz` : "";
        if (!hwIsZ3) {
          main = `ON${st}`;
        } else if (hasR) {
          const cId = normalizeLightCurveId(c.curve);
          if (cId === "sine") main = `∿ ${c.val}↔${Math.round(c.endVal)}%${st}`;
          else if (cId === "custom") main = `Curve (${(c.keyframes || []).length}pt)${st}`;
          else {
            const cTag = cId === "gamma" ? " γ" : (cId === "scurve" ? " S" : (cId === "log" ? " ◜" : ""));
            main = `${c.val}→${Math.round(c.endVal)}%${cTag}${st}`;
          }
        } else {
          main = `${c.val}%${st}`;
        }
      }
      return ratio >= 0.18 ? `${main} (${effStart}-${effEnd}s)` : main;
    }

    function buildInlineClipCurveMarkup(c, tr) {
      const sampleN = 28;
      const linePts = [];
      for (let i = 0; i <= sampleN; i++) {
        const t = i / sampleN;
        const pct = evaluateLightCurvePct(c, t);
        const x = (t * 100).toFixed(1);
        const y = (30 - (pct / 100) * 28 - 1).toFixed(1);
        linePts.push(`${x},${y}`);
      }
      const polyPts = `0,30 ${linePts.join(" ")} 100,30`;
      return `<polygon points="${polyPts}" fill="${tr.bg}" fill-opacity="0.92"/><polyline points="${linePts.join(" ")}" fill="none" stroke="${tr.border}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
    }

    let cachedGridPct = null;
    function syncNleDom(rebuildInspector, rebuildRuler = true) {
      const ruler = document.getElementById("nleRuler");
      if (!ruler) return;
      const { totalSec } = getTimelineBounds();

      if (rebuildRuler || cachedGridPct === null) {
        const candidates = [5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800];
        const tickStep = candidates.find(s => totalSec / s <= 8) || 1800;
        const ticks = [];
        for (let t = 0; t <= totalSec; t += tickStep) ticks.push(t);
        if (ticks[ticks.length - 1] !== totalSec) ticks.push(totalSec);

        ruler.innerHTML = ticks.map((t, idx) => {
          const pct = ((t / totalSec) * 100).toFixed(3);
          const isEnd = idx === ticks.length - 1;
          const lbl = t >= 300 && t % 60 === 0 ? `${t / 60}m` : `${t}s`;
          return `<div class="nle-tick${isEnd ? " is-end" : ""}" style="left:${pct}%">${lbl}</div>`;
        }).join("");
        cachedGridPct = ((tickStep / totalSec) * 100).toFixed(4);
      }

      syncUnderRowsVisibility();

      for (const tr of NLE_TRACKS) {
        const lane = box.querySelector(`[data-nle-lane="${tr.id}"]`);
        if (!lane) continue;
        if (rebuildRuler && cachedGridPct) {
          lane.style.backgroundSize = `${cachedGridPct}% 100%`;
        }

        const trackClips = state.timelineClips.filter(c => c.track === tr.id && c.startSec < totalSec && c.endSec > 0);
        const existingEls = new Map();
        Array.from(lane.children).forEach(el => {
          existingEls.set(parseInt(el.getAttribute("data-clip-id"), 10), el);
        });

        const seen = new Set();
        for (const c of trackClips) {
          seen.add(c.id);
          const effStart = Math.max(0, c.startSec);
          const effEnd = Math.min(totalSec, c.endSec);
          const leftPct = ((effStart / totalSec) * 100).toFixed(3);
          const widthPct = (Math.max(0.8, ((effEnd - effStart) / totalSec) * 100)).toFixed(3);

          let el = existingEls.get(c.id);
          if (!el) {
            el = document.createElement("div");
            el.className = "nle-clip";
            el.setAttribute("data-clip-id", String(c.id));
            el.style.background = tr.bg;
            el.style.borderColor = tr.border;
            el.style.color = tr.text;
            el.innerHTML = `<svg class="nle-clip-curve" viewBox="0 0 100 30" preserveAspectRatio="none"></svg><div class="nle-handle nle-handle-l" data-handle="l"></div><span class="nle-clip-label"></span><div class="nle-handle nle-handle-r" data-handle="r"></div>`;
            lane.appendChild(el);
          }
          el.style.left = leftPct + "%";
          el.style.width = widthPct + "%";
          const clipCurved = hwIsZ3 && tr.kind === "light" && isClipCurved(c);
          el.classList.toggle("has-curve", clipCurved);
          const curveEl = el.querySelector(".nle-clip-curve");
          if (curveEl) {
            curveEl.innerHTML = clipCurved ? buildInlineClipCurveMarkup(c, tr) : "";
          }
          el.style.background = clipCurved ? "#ffffff" : tr.bg;
          el.style.borderStyle = (tr.kind === "light" && [2, 5, 10].includes(parseInt(c.strobeHz, 10))) ? "dashed" : "solid";
          el.classList.toggle("selected", c.id === state.selectedClipId);
          const lblEl = el.querySelector(".nle-clip-label");
          if (lblEl) lblEl.textContent = formatClipLabel(c, tr, totalSec);
        }

        existingEls.forEach((el, idKey) => {
          if (!seen.has(idKey)) lane.removeChild(el);
        });
      }

      renderNleSummaryBar();

      if (rebuildInspector) {
        syncNleInspector();
      } else {
        const sel = state.timelineClips.find(c => c.id === state.selectedClipId);
        if (sel) {
          const sInp = document.getElementById("nleInspStart");
          const eInp = document.getElementById("nleInspEnd");
          if (sInp && document.activeElement !== sInp) sInp.value = sel.startSec;
          if (eInp && document.activeElement !== eInp) eInp.value = sel.endSec;
        }
        updateLiveHud();
      }
    }

    // Bind Underneath Tracks toggle button
    const togUnderBtn = document.getElementById("nleToggleUnderBtn");
    if (togUnderBtn) {
      togUnderBtn.addEventListener("click", () => {
        state.showUnderTracks = !state.showUnderTracks;
        syncUnderRowsVisibility();
      });
    }

    // Bind Ruler & Bottom Composite Summary Bar click / drag to scrub simulator directly to timeline second
    function bindNleScrubSurface(surfaceEl) {
      if (!surfaceEl) return;
      const scrubFromSurfaceX = (clientX, lockedCycle) => {
        const sRect = surfaceEl.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - sRect.left) / Math.max(1, sRect.width)));
        const cfgNow = refreshAll._latestCfg || readConfig();
        const acclim = Math.max(0, parseInt(cfgNow.sp.acclimSec, 10) || 0);
        const autoref = Math.max(0, parseInt(cfgNow.autorefTimeout, 10) || 0);
        const cycles = Math.max(1, parseInt(cfgNow.sp.mpCycles, 10) || 1);
        const { totalSec } = getTimelineBounds();
        let curCycle = lockedCycle;
        if (typeof curCycle !== "number") {
          const relCur = simState.tSec - (acclim + autoref);
          curCycle = relCur > 0 ? Math.min(cycles - 1, Math.floor(relCur / Math.max(1, totalSec))) : 0;
        }
        const rawInCycle = Number((ratio * totalSec).toFixed(2));
        const inCycleSec = curCycle < cycles - 1 ? Math.min(Math.max(0, totalSec - 0.01), rawInCycle) : rawInCycle;
        setSimulatorTime(acclim + autoref + curCycle * totalSec + inCycleSec);
      };

      surfaceEl.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        blurTextFocusForTimeline();
        const cfgNow = refreshAll._latestCfg || readConfig();
        const acclim = Math.max(0, parseInt(cfgNow.sp.acclimSec, 10) || 0);
        const autoref = Math.max(0, parseInt(cfgNow.autorefTimeout, 10) || 0);
        const cycles = Math.max(1, parseInt(cfgNow.sp.mpCycles, 10) || 1);
        const { totalSec } = getTimelineBounds();
        const relCur = simState.tSec - (acclim + autoref);
        const lockedCycle = relCur > 0 ? Math.min(cycles - 1, Math.floor(relCur / Math.max(1, totalSec))) : 0;
        scrubFromSurfaceX(e.clientX, lockedCycle);
        const onSurfaceMove = (me) => scrubFromSurfaceX(me.clientX, lockedCycle);
        const onSurfaceUp = () => {
          window.removeEventListener("mousemove", onSurfaceMove);
          window.removeEventListener("mouseup", onSurfaceUp);
        };
        window.addEventListener("mousemove", onSurfaceMove);
        window.addEventListener("mouseup", onSurfaceUp);
      });
    }

    bindNleScrubSurface(document.getElementById("nleRuler"));
    bindNleScrubSurface(document.getElementById("nleSummaryBar"));

    // Bind track '+' add buttons
    box.querySelectorAll("[data-nle-add]").forEach(btn => {
      btn.addEventListener("click", () => {
        blurTextFocusForTimeline();
        addClipToTrack(btn.getAttribute("data-nle-add"));
      });
    });

    // Bind Clear Clips
    const clrBtn = document.getElementById("nleClearBtn");
    if (clrBtn) {
      clrBtn.addEventListener("click", () => {
        state.timelineClips = [];
        state.selectedClipId = null;
        syncNleDom(true, false);
        flushRefresh();
      });
    }

    // Bind Presets via compact #nlePresetSel selector
    function applyTimelinePreset(pType) {
      if (!pType) return;
      const baseT = parseFloat(document.getElementById("thermostatTemp").value) || 22;
      state.stimParams.mpTimelineSec = 180;
      const tlInp = box.querySelector('[data-sp="mpTimelineSec"]');
      if (tlInp) tlInp.value = 180;

      if (pType === "bg_opto") {
        state.showUnderTracks = false;
        state.timelineClips = [
          { id: ++_nextClipId, track: "WHITE", startSec: 0,   endSec: 180, val: 35 },
          { id: ++_nextClipId, track: "BLUE",  startSec: 30,  endSec: 50,  val: 100 },
          { id: ++_nextClipId, track: "RED",   startSec: 80,  endSec: 100, val: 100 },
          { id: ++_nextClipId, track: "BLUE",  startSec: 130, endSec: 150, val: 100 },
          { id: ++_nextClipId, track: "TEMP",  startSec: 0,   endSec: 90,  val: baseT },
          { id: ++_nextClipId, track: "TEMP",  startSec: 90,  endSec: 180, val: Math.min(40, baseT + 4) }
        ];
      } else if (pType === "bot_bg_top_opto") {
        state.showUnderTracks = true;
        state.timelineClips = [
          { id: ++_nextClipId, track: "U_WHITE", startSec: 0,   endSec: 180, val: 30 },
          { id: ++_nextClipId, track: "BLUE",    startSec: 30,  endSec: 50,  val: 100 },
          { id: ++_nextClipId, track: "RED",     startSec: 80,  endSec: 100, val: 100 },
          { id: ++_nextClipId, track: "BLUE",    startSec: 130, endSec: 150, val: 100 },
          { id: ++_nextClipId, track: "TEMP",    startSec: 0,   endSec: 90,  val: baseT },
          { id: ++_nextClipId, track: "TEMP",    startSec: 90,  endSec: 180, val: Math.min(40, baseT + 4) }
        ];
      } else if (pType === "multi_modal") {
        state.showUnderTracks = false;
        state.timelineClips = [
          { id: ++_nextClipId, track: "WHITE", startSec: 0,   endSec: 180, val: 35 },
          { id: ++_nextClipId, track: "BLUE",  startSec: 30,  endSec: 50,  val: 100 },
          { id: ++_nextClipId, track: "VIB",   startSec: 60,  endSec: 65,  val: 2 },
          { id: ++_nextClipId, track: "AUDIO", startSec: 100, endSec: 105, val: "tone" },
          { id: ++_nextClipId, track: "RED",   startSec: 130, endSec: 150, val: 100 },
          { id: ++_nextClipId, track: "VIB",   startSec: 130, endSec: 135, val: 0 },
          { id: ++_nextClipId, track: "AUDIO", startSec: 130, endSec: 135, val: "mono" }
        ];
      } else if (pType === "dawn_dusk") {
        state.showUnderTracks = false;
        state.timelineClips = [
          { id: ++_nextClipId, track: "WHITE", startSec: 0,   endSec: 60,  val: 0,   endVal: 100, curve: "gamma", rampSteps: 12 },
          { id: ++_nextClipId, track: "WHITE", startSec: 60,  endSec: 120, val: 100 },
          { id: ++_nextClipId, track: "WHITE", startSec: 120, endSec: 180, val: 100, endVal: 0,   curve: "gamma", rampSteps: 12 }
        ];
      } else if (pType === "sine_wave") {
        state.showUnderTracks = false;
        state.timelineClips = [
          { id: ++_nextClipId, track: "WHITE", startSec: 0,   endSec: 60,  val: 5, endVal: 100, curve: "sine", rampSteps: 12 },
          { id: ++_nextClipId, track: "WHITE", startSec: 60,  endSec: 120, val: 5, endVal: 100, curve: "sine", rampSteps: 12 },
          { id: ++_nextClipId, track: "WHITE", startSec: 120, endSec: 180, val: 5, endVal: 100, curve: "sine", rampSteps: 12 }
        ];
      } else if (pType === "custom_curve") {
        state.showUnderTracks = false;
        state.timelineClips = [
          {
            id: ++_nextClipId, track: "BLUE", startSec: 0, endSec: 180, val: 0, endVal: 15,
            curve: "custom", rampSteps: 16,
            keyframes: [
              { t: 0, y: 0 },
              { t: 0.25, y: 90 },
              { t: 0.55, y: 90 },
              { t: 0.72, y: 25 },
              { t: 0.85, y: 70 },
              { t: 1, y: 15 }
            ]
          }
        ];
      } else if (pType === "opto_strobe") {
        state.showUnderTracks = false;
        state.timelineClips = [
          { id: ++_nextClipId, track: "WHITE", startSec: 0,   endSec: 180, val: 25 },
          { id: ++_nextClipId, track: "BLUE",  startSec: 30,  endSec: 50,  val: 100, strobeHz: 10 },
          { id: ++_nextClipId, track: "BLUE",  startSec: 90,  endSec: 110, val: 100, strobeHz: 5 },
          { id: ++_nextClipId, track: "VIB",   startSec: 140, endSec: 165, val: 2,   repeatSec: 5 }
        ];
      } else if (pType === "rgb_overlap") {
        state.showUnderTracks = false;
        state.timelineClips = [
          { id: ++_nextClipId, track: "BLUE",  startSec: 0,   endSec: 80,  val: 100 },
          { id: ++_nextClipId, track: "GREEN", startSec: 50,  endSec: 130, val: 100 },
          { id: ++_nextClipId, track: "RED",   startSec: 100, endSec: 180, val: 100 },
          { id: ++_nextClipId, track: "TEMP",  startSec: 0,   endSec: 180, val: baseT }
        ];
      } else if (pType === "sequential") {
        state.showUnderTracks = false;
        state.timelineClips = [
          { id: ++_nextClipId, track: "BLUE",  startSec: 20,  endSec: 50,  val: 100 },
          { id: ++_nextClipId, track: "GREEN", startSec: 75,  endSec: 105, val: 100 },
          { id: ++_nextClipId, track: "RED",   startSec: 130, endSec: 160, val: 100 }
        ];
      } else if (pType === "run_through") {
        state.showUnderTracks = true;
        const warmT = Math.min(40, Number((baseT + 2).toFixed(1)));
        state.timelineClips = [
          // 0-10s: IR Dark baseline (no visible LEDs)
          // Top LEDs (Ch 0, 1, 3, 4, 5) — curves, steady channels & strobes
          { id: ++_nextClipId, track: "WHITE",   startSec: 10,  endSec: 30,  val: 0, endVal: 100, curve: "gamma", rampSteps: 8 },
          { id: ++_nextClipId, track: "BLUE",    startSec: 30,  endSec: 40,  val: 100 },
          { id: ++_nextClipId, track: "GREEN",   startSec: 40,  endSec: 50,  val: 100 },
          { id: ++_nextClipId, track: "RED",     startSec: 50,  endSec: 60,  val: 100 },
          { id: ++_nextClipId, track: "UV",      startSec: 60,  endSec: 70,  val: 100 },
          // Bottom LEDs (Ch 8, 9, 11, 12, 13) — sine curve & steady channels
          { id: ++_nextClipId, track: "U_WHITE", startSec: 70,  endSec: 85,  val: 5, endVal: 100, curve: "sine", rampSteps: 6 },
          { id: ++_nextClipId, track: "U_BLUE",  startSec: 85,  endSec: 95,  val: 100 },
          { id: ++_nextClipId, track: "U_GREEN", startSec: 95,  endSec: 105, val: 100 },
          { id: ++_nextClipId, track: "U_RED",   startSec: 105, endSec: 115, val: 100 },
          { id: ++_nextClipId, track: "U_UV",    startSec: 115, endSec: 125, val: 100 },
          // 125-140s: Mixed-frequency strobe (BLUE 2 Hz + RED 10 Hz) over steady U_WHITE 35%
          { id: ++_nextClipId, track: "BLUE",    startSec: 125, endSec: 140, val: 100, strobeHz: 2 },
          { id: ++_nextClipId, track: "RED",     startSec: 125, endSec: 140, val: 100, strobeHz: 10 },
          { id: ++_nextClipId, track: "U_WHITE", startSec: 125, endSec: 140, val: 35 },
          // 140-152s: GREEN 5 Hz strobe + all 4 stepper vibration levels (U3 -> U2 -> U1 -> U0)
          { id: ++_nextClipId, track: "GREEN",   startSec: 140, endSec: 152, val: 100, strobeHz: 5 },
          { id: ++_nextClipId, track: "VIB",     startSec: 140, endSec: 143, val: 3 },
          { id: ++_nextClipId, track: "VIB",     startSec: 143, endSec: 146, val: 2 },
          { id: ++_nextClipId, track: "VIB",     startSec: 146, endSec: 149, val: 1 },
          { id: ++_nextClipId, track: "VIB",     startSec: 149, endSec: 152, val: 0 },
          // 152-164s: Custom keyframe WHITE envelope + both AUDIO modes ("tone" & "mono")
          {
            id: ++_nextClipId, track: "WHITE", startSec: 152, endSec: 164, val: 0, endVal: 0,
            curve: "custom", rampSteps: 6,
            keyframes: [
              { t: 0,    y: 0 },
              { t: 0.25, y: 100 },
              { t: 0.55, y: 20 },
              { t: 0.8,  y: 80 },
              { t: 1,    y: 0 }
            ]
          },
          { id: ++_nextClipId, track: "AUDIO",   startSec: 152, endSec: 158, val: "tone" },
          { id: ++_nextClipId, track: "AUDIO",   startSec: 158, endSec: 164, val: "mono" },
          // 164-180s: Combined finale (WHITE 50% + U_WHITE 50% + repeating VIB U1 q4s + repeating AUDIO tone q8s)
          { id: ++_nextClipId, track: "WHITE",   startSec: 164, endSec: 180, val: 50 },
          { id: ++_nextClipId, track: "U_WHITE", startSec: 164, endSec: 180, val: 50 },
          { id: ++_nextClipId, track: "VIB",     startSec: 164, endSec: 180, val: 1, repeatSec: 4 },
          { id: ++_nextClipId, track: "AUDIO",   startSec: 164, endSec: 180, val: "tone", repeatSec: 8 },
          // Continuous thermostat profile: baseline -> +2 C step -> restore baseline
          { id: ++_nextClipId, track: "TEMP",    startSec: 0,   endSec: 90,  val: baseT },
          { id: ++_nextClipId, track: "TEMP",    startSec: 90,  endSec: 160, val: warmT },
          { id: ++_nextClipId, track: "TEMP",    startSec: 160, endSec: 180, val: baseT }
        ];
        if (typeof showToast === "function") {
          showToast("Loaded 180s Full Hardware Run-Through (all 10 LEDs, curves, 2/5/10 Hz strobes, U0–U3 vib, audio & temp)");
        }
      } else {
        return;
      }
      state.selectedClipId = state.timelineClips.length ? state.timelineClips[0].id : null;
      syncNleDom(true, true);
      flushRefresh();
    }

    const presetSel = document.getElementById("nlePresetSel");
    if (presetSel) {
      presetSel.addEventListener("change", () => {
        const pType = presetSel.value;
        if (!pType) return;
        applyTimelinePreset(pType);
        presetSel.value = "";
        blurTextFocusForTimeline();
      });
    }

    // Bind Interactive Lane Drag-to-Draw, Double-Click Insert, & Bar Move / Stretch
    box.querySelectorAll("[data-nle-lane]").forEach(lane => {
      lane.addEventListener("dblclick", (e) => {
        const hitClip = e.target.closest ? e.target.closest(".nle-clip") : null;
        if (hitClip) return;
        blurTextFocusForTimeline();
        const trackId = lane.getAttribute("data-nle-lane");
        const rect = lane.getBoundingClientRect();
        const { totalSec } = getTimelineBounds();
        const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
        addClipToTrack(trackId, clickRatio * totalSec);
      });

      lane.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        blurTextFocusForTimeline();

        const trackId = lane.getAttribute("data-nle-lane");
        const rect = lane.getBoundingClientRect();
        const { bin, totalSec } = getTimelineBounds();
        const startX = e.clientX;

        const clipEl = e.target.closest ? e.target.closest(".nle-clip") : null;

        // Case 1: Empty lane -> Drag to draw a bar (plain single click simply deselects!)
        if (!clipEl) {
          const clickRatio = Math.max(0, Math.min(1, (startX - rect.left) / Math.max(1, rect.width)));
          const clickSec = clickRatio * totalSec;
          const gap = findGapContainingSec(trackId, clickSec);
          if (!gap) {
            deselectClip();
            return;
          }
          const [gapMin, gapMax] = gap;
          const anchorSec = Math.max(gapMin, Math.min(gapMax, snapSec(clickSec, bin)));
          const baseT = parseFloat(document.getElementById("thermostatTemp").value) || 22;
          let draftClip = null;

          const onDrawMove = (me) => {
            if (!draftClip && Math.abs(me.clientX - startX) < 4) return;
            const curRatio = Math.max(0, Math.min(1, (me.clientX - rect.left) / Math.max(1, rect.width)));
            const curSnap = Math.max(gapMin, Math.min(gapMax, snapSec(curRatio * totalSec, bin)));
            let s = Math.min(anchorSec, curSnap);
            let ed = Math.max(anchorSec, curSnap);
            if (ed - s < bin) {
              if (me.clientX >= startX) {
                ed = Math.min(gapMax, s + bin);
                s = Math.max(gapMin, ed - bin);
              } else {
                s = Math.max(gapMin, ed - bin);
                ed = Math.min(gapMax, s + bin);
              }
            }
            if (ed <= s) return;

            if (!draftClip) {
              const draftVal = trackId === "TEMP"
                ? baseT
                : (trackId === "VIB" ? 2 : (trackId === "AUDIO" ? "tone" : 100));
              draftClip = {
                id: ++_nextClipId,
                track: trackId,
                startSec: s,
                endSec: ed,
                val: draftVal
              };
              state.timelineClips.push(draftClip);
              state.selectedClipId = draftClip.id;
              syncNleDom(true, false);
            } else {
              draftClip.startSec = s;
              draftClip.endSec = ed;
              syncNleDom(false, false);
            }
            updateLiveHud("Drawing");
            scheduleRefresh();
          };

          const onDrawUp = () => {
            window.removeEventListener("mousemove", onDrawMove);
            window.removeEventListener("mouseup", onDrawUp);
            if (!draftClip) {
              deselectClip();
            } else {
              syncNleDom(true, false);
              flushRefresh();
            }
          };

          window.addEventListener("mousemove", onDrawMove);
          window.addEventListener("mouseup", onDrawUp);
          return;
        }

        // Case 2: Existing bar -> Select, Move body, or Stretch left/right grip
        const clipId = parseInt(clipEl.getAttribute("data-clip-id"), 10);
        const clip = state.timelineClips.find(c => c.id === clipId);
        if (!clip) return;

        const selectionChanged = state.selectedClipId !== clipId;
        state.selectedClipId = clipId;
        syncNleDom(selectionChanged, false);

        const cRect = clipEl.getBoundingClientRect();
        const handleAttr = e.target.getAttribute("data-handle");
        const edgePx = cRect.width > 0 ? Math.min(10, Math.max(5, cRect.width * 0.28)) : 8;
        let mode = "move";
        if (handleAttr === "l" || (cRect.width > 0 && startX - cRect.left <= edgePx)) mode = "left";
        else if (handleAttr === "r" || (cRect.width > 0 && cRect.right - startX <= edgePx)) mode = "right";

        clipEl.classList.add("is-dragging");
        const origStart = clip.startSec;
        const origEnd = clip.endSec;
        const dur = origEnd - origStart;
        const bounds = getSameTrackNeighborBounds(clip);

        const onMove = (me) => {
          const dxSec = ((me.clientX - startX) / Math.max(1, rect.width)) * totalSec;
          if (mode === "move") {
            let ns = snapSec(origStart + dxSec, bin);
            ns = Math.max(bounds.minS, Math.min(bounds.maxE - dur, ns));
            clip.startSec = ns;
            clip.endSec = ns + dur;
          } else if (mode === "left") {
            let ns = snapSec(origStart + dxSec, bin);
            ns = Math.max(bounds.minS, Math.min(origEnd - bin, ns));
            clip.startSec = ns;
          } else if (mode === "right") {
            let ne = snapSec(origEnd + dxSec, bin);
            ne = Math.min(bounds.maxE, Math.max(origStart + bin, ne));
            clip.endSec = ne;
          }
          syncNleDom(false, false);
          updateLiveHud(mode === "move" ? "Moving" : "Stretching");
          scheduleRefresh();
        };

        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          clipEl.classList.remove("is-dragging");
          syncNleInspector();
          flushRefresh();
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    });

    syncNleDom(true, true);
    box._syncNleDom = (rebuildInsp) => syncNleDom(rebuildInsp, true);
    box._applyPreset = applyTimelinePreset;
    box._deleteSelectedClip = deleteSelectedClip;
    box._deselectClip = deselectClip;
    box._nudgeSelectedClip = nudgeSelectedClip;
  } else if (id === "temp_ramp") {
    const stepsPreview = computeTempRampSteps(sp.rampStartTemp, sp.rampEndTemp, sp.rampStepTemp);
    box.innerHTML = `
        <div class="form-grid-3">
          <div class="field">
            <label>Start Temperature (°C)</label>
            <input type="number" min="10" max="40" step="0.5" data-sp="rampStartTemp" value="${sp.rampStartTemp}">
          </div>
          <div class="field">
            <label>End Temperature (°C)</label>
            <input type="number" min="10" max="40" step="0.5" data-sp="rampEndTemp" value="${sp.rampEndTemp}">
          </div>
          <div class="field">
            <label>Step Increment (°C)</label>
            <input type="number" min="0.5" max="15" step="0.5" data-sp="rampStepTemp" value="${sp.rampStepTemp}">
          </div>
          <div class="field">
            <label>Hold Duration per Step (sec)</label>
            <input type="number" min="10" max="14400" step="30" data-sp="rampHoldSec" value="${sp.rampHoldSec}">
          </div>
          <div class="field">
            <label>Chamber Lighting</label>
            <select data-sp="rampLight">
              <option value="DARK" ${sp.rampLight === "DARK" ? "selected" : ""}>Dark (IR Tracking Only)</option>
              <option value="LIGHT" ${sp.rampLight === "LIGHT" ? "selected" : ""}>Stimulus Light ON</option>
            </select>
          </div>
          <div class="field">
            <label>Time Bin (sec)</label>
            <input type="number" min="1" max="600" step="1" data-sp="timeBinSec" value="${sp.timeBinSec}">
          </div>
          <div class="field">
            <label>Acclimation at Start Temp (sec)</label>
            <input type="number" min="0" max="7200" step="30" data-sp="acclimSec" value="${sp.acclimSec}">
          </div>
        </div>
        <div class="proto-note" id="rampStepsPreviewNote">
          <strong>Generated Plateaus (${stepsPreview.length}):</strong> ${stepsPreview.map(t => t + " °C").join(" &rarr; ")}.<br>
          Standard MWP heaters regulate from room ambient up to +10 °C above ambient (&plusmn;0.5 °C) and automatically return to Start Temp when the assay finishes. Ensure the cooling fan is spinning.
        </div>`;
  }

  box.querySelectorAll("[data-sp]").forEach(el => {
    const spKey = el.getAttribute("data-sp");
    el.addEventListener("input", () => {
      state.stimParams[spKey] = el.value;
      if (state.stimId === "multi_phase" && box._syncNleDom && (spKey === "mpTimelineSec" || spKey === "timeBinSec")) {
        box._syncNleDom(true);
      }
      if (state.stimId === "temp_ramp") {
        const noteEl = document.getElementById("rampStepsPreviewNote");
        if (noteEl) {
          const st = computeTempRampSteps(state.stimParams.rampStartTemp, state.stimParams.rampEndTemp, state.stimParams.rampStepTemp);
          noteEl.innerHTML = `<strong>Generated Plateaus (${st.length}):</strong> ${st.map(t => t + " °C").join(" &rarr; ")}.<br>Standard MWP heaters regulate from room ambient up to +10 °C above ambient (&plusmn;0.5 °C) and automatically return to Start Temp when the assay finishes. Ensure the cooling fan is spinning.`;
        }
      }
      if (state.stimId === "acoustic_startle" && spKey === "audioFile") {
        const cw = document.getElementById("acousticCustomWrap");
        if (cw) cw.style.display = el.value === "custom" ? "" : "none";
      }
      if (state.stimId === "circadian" && spKey === "circRampMin") {
        const cSel = document.getElementById("circRampCurveSel");
        if (cSel) cSel.disabled = (parseInt(el.value, 10) || 0) <= 0;
      }
      if (state.stimId === "ppi") {
        const noteEl = box.querySelector(".proto-note");
        if (noteEl) {
          const pre = state.stimParams.ppiPrepulse || "U3";
          const pul = state.stimParams.ppiPulse || "U0";
          const isi = Math.max(50, parseInt(state.stimParams.ppiIsiMs, 10) || 300);
          noteEl.innerHTML = `Uses official MWP stepper PPI command: <code>ZCOMMAND("${pre} D1190 M1 M-1 M1 M-1 P${isi} ${pul} D1190 M1 M-1 M1 M-1")</code>. Alternating mode logs <code>PULSE_ALONE</code> and <code>PPI_TRIAL</code> rows so % PPI can be computed directly.`;
        }
      }
      refreshAll();
    });
    el.addEventListener("change", () => {
      state.stimParams[spKey] = el.value;
      if (state.stimId === "multi_phase" && box._syncNleDom && (spKey === "mpTimelineSec" || spKey === "timeBinSec")) {
        box._syncNleDom(true);
      }
      if (state.stimId === "acoustic_startle" && spKey === "audioFile") {
        const cw = document.getElementById("acousticCustomWrap");
        if (cw) cw.style.display = el.value === "custom" ? "" : "none";
      }
      if (state.stimId === "circadian" && spKey === "circRampMin") {
        const cSel = document.getElementById("circRampCurveSel");
        if (cSel) cSel.disabled = (parseInt(el.value, 10) || 0) <= 0;
      }
      if (state.stimId === "ppi") {
        const noteEl = box.querySelector(".proto-note");
        if (noteEl) {
          const pre = state.stimParams.ppiPrepulse || "U3";
          const pul = state.stimParams.ppiPulse || "U0";
          const isi = Math.max(50, parseInt(state.stimParams.ppiIsiMs, 10) || 300);
          noteEl.innerHTML = `Uses official MWP stepper PPI command: <code>ZCOMMAND("${pre} D1190 M1 M-1 M1 M-1 P${isi} ${pul} D1190 M1 M-1 M1 M-1")</code>. Alternating mode logs <code>PULSE_ALONE</code> and <code>PPI_TRIAL</code> rows so % PPI can be computed directly.`;
        }
      }
      refreshAll();
    });
  });
}
