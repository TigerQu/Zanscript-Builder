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
    const pulseLabel = id === "light_off_startle" ? "Dark Pulse Duration (sec)" : "Light Flash Duration (sec)";
    box.innerHTML = `
        <div class="form-grid-3">
          <div class="field">
            <label>Number of Pulses</label>
            <input type="number" min="1" max="100" step="1" data-sp="numPulses" value="${sp.numPulses}">
          </div>
          <div class="field">
            <label>${pulseLabel}</label>
            <input type="number" min="0.2" max="60" step="0.2" data-sp="pulseDurSec" value="${sp.pulseDurSec}">
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
        </div>`;
  } else if (id === "circadian") {
    box.innerHTML = `
        <div class="form-grid">
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
      const mountCls = tr.group === "BOT" ? "nle-mount-bot" : (tr.group === "ENV" ? "nle-mount-env" : "nle-mount-top");
      const isGroupStart = tr.id === "U_WHITE" || tr.id === "TEMP";
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
              <option value="rgb_overlap">Preset: RGB Overlap</option>
              <option value="sequential">Preset: Seq Sweep</option>
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
      const newClip = {
        id: ++_nextClipId,
        track: trackId,
        startSec: slot[0],
        endSec: slot[1],
        val: trackId === "TEMP" ? baseT : 100
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
      const valLabel = isTemp ? "Temp (°C)" : "Brightness (%)";
      const valDisabled = (!isTemp && !hwIsZ3) ? "disabled" : "";
      const valMin = isTemp ? "10" : "5";
      const valMax = isTemp ? "40" : "100";
      const valStep = isTemp ? "0.5" : "1";
      const durSec = Math.max(0, sel.endSec - sel.startSec);

      const mountCls = tr.group === "BOT" ? "nle-mount-bot" : (tr.group === "ENV" ? "nle-mount-env" : "nle-mount-top");
      insp.innerHTML = `
          <div class="nle-insp-head">
            <div class="nle-insp-title">
              <span class="nle-mount-tag ${mountCls}">${tr.group}</span>
              <span class="nle-swatch" style="background:${tr.swatch};"></span>
              <span>${tr.label}</span>
              <span class="nle-insp-sub">${tr.sub}</span>
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
            <div class="nle-insp-field nle-insp-field-wide">
              <label for="nleInspVal">${valLabel}</label>
              <div class="nle-insp-slider">
                <input type="range" id="nleInspRange" min="${valMin}" max="${valMax}" step="${valStep}" value="${sel.val}" ${valDisabled} aria-label="${valLabel}">
                <input type="number" id="nleInspVal" min="${valMin}" max="${valMax}" step="${valStep}" value="${sel.val}" ${valDisabled}>
              </div>
            </div>
          </div>`;

      const sInp = document.getElementById("nleInspStart");
      const eInp = document.getElementById("nleInspEnd");
      const rInp = document.getElementById("nleInspRange");
      const vInp = document.getElementById("nleInspVal");
      const dBtn = document.getElementById("nleDelClipBtn");

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

      const applyVal = (rawVal, fromRange) => {
        const raw = parseFloat(rawVal);
        if (!Number.isFinite(raw)) return;
        sel.val = isTemp
          ? Math.min(40, Math.max(10, Number(raw.toFixed(1))))
          : Math.min(100, Math.max(5, Math.round(raw)));
        if (fromRange && vInp) vInp.value = sel.val;
        if (!fromRange && rInp) rInp.value = sel.val;
        syncNleDom(false, false);
        scheduleRefresh();
      };
      if (rInp) {
        rInp.addEventListener("input", () => applyVal(rInp.value, true));
        rInp.addEventListener("change", () => flushRefresh());
      }
      vInp.addEventListener("input", () => applyVal(vInp.value, false));
      vInp.addEventListener("change", () => { vInp.value = sel.val; flushRefresh(); });

      dBtn.addEventListener("click", () => deleteSelectedClip());
      updateLiveHud();
    }

    function formatClipLabel(c, tr, totalSec) {
      const dur = Math.max(0, c.endSec - c.startSec);
      const ratio = dur / Math.max(1, totalSec);
      if (ratio < 0.055) return "";
      const main = tr.kind === "temp" ? `${c.val}°C` : (hwIsZ3 ? `${c.val}%` : "ON");
      return ratio >= 0.18 ? `${main} (${c.startSec}-${c.endSec}s)` : main;
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
            el.innerHTML = `<div class="nle-handle nle-handle-l" data-handle="l"></div><span class="nle-clip-label"></span><div class="nle-handle nle-handle-r" data-handle="r"></div>`;
            lane.appendChild(el);
          }
          el.style.left = leftPct + "%";
          el.style.width = widthPct + "%";
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
              draftClip = {
                id: ++_nextClipId,
                track: trackId,
                startSec: s,
                endSec: ed,
                val: trackId === "TEMP" ? baseT : 100
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
        const edgePx = cRect.width > 0 ? Math.min(12, Math.max(5, cRect.width * 0.28)) : 8;
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
      refreshAll();
    });
    el.addEventListener("change", () => {
      state.stimParams[spKey] = el.value;
      if (state.stimId === "multi_phase" && box._syncNleDom && (spKey === "mpTimelineSec" || spKey === "timeBinSec")) {
        box._syncNleDom(true);
      }
      refreshAll();
    });
  });
}
