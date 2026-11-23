// Zantiks MWP Script Builder - Step-by-step wizard navigation and the Run Summary sidebar
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 11. Step-by-Step Wizard & Run Summary
// ---------------------------------------------------------------------------
const WIZARD_PAGES = [
  { id: "study", label: "Study" },
  { id: "organism", label: "Organism" },
  { id: "plate", label: "Plate" },
  { id: "stimulus", label: "Stimulus" },
  { id: "data", label: "Data & Video" },
  { id: "export", label: "Export" }
];
let currentPageIdx = 0;

const VIDEO_LABELS = {
  "1fps": "1 fps timelapse",
  "0.2fps": "0.2 fps timelapse",
  "full": "30 fps video",
  "dual": "Dual 30 + 1 fps",
  "off": "No video"
};

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderRunSummary(cfg, s4, orgObj) {
  setText("sumResearcher", cfg.userFullClean || "Name not set");
  setText("sumFolder", s4.filename);

  setText("sumHw", "MWP " + cfg.hw);
  if (cfg.hw === "Z3") {
    if (cfg.stimId === "multi_phase") {
      const hasBotClips = (cfg.timelineClips || []).some(c => String(c.track || "").startsWith("U_"));
      setText("sumHwSub", hasBotClips
        ? "Top + Underneath LED tracks"
        : (cfg.ledMount === "BOTH" ? "Multi-wavelength (Top+Bot)" : (cfg.ledMount === "UNDERNEATH" ? "Multi-wavelength (Bot acclim)" : "Multi-wavelength LEDs")));
    } else {
      const mountLbl = cfg.ledMount === "UNDERNEATH"
        ? "Underneath"
        : (cfg.ledMount === "BOTH" ? "Top+Bottom" : "Overhead");
      const colLbl = (cfg.ledColor === "WHITE" && cfg.ledMount === "OVERHEAD")
        ? "Overhead LED"
        : `${mountLbl} ${cfg.ledColorObj.short}`;
      setText("sumHwSub", `${colLbl} ${cfg.ledPct}%`);
    }
  } else {
    setText("sumHwSub", `GPO6-8 (${cfg.stimId === "multi_phase" ? "multi-color" : cfg.ledColorObj.short})`);
  }

  let tempSummary;
  if (cfg.stimId === "temp_ramp") {
    const st = computeTempRampSteps(cfg.sp.rampStartTemp, cfg.sp.rampEndTemp, cfg.sp.rampStepTemp);
    tempSummary = `${st[0]}->${st[st.length - 1]} °C ramp`;
  } else if (cfg.stimId === "multi_phase") {
    const comp = compileMultiTrackSlices(cfg.timelineClips, cfg.sp.mpTimelineSec, cfg.sp.timeBinSec, cfg.thermostatTemp);
    if (comp.hasAnyTempClip && comp.slices.length > 0) {
      const temps = comp.slices.map(sl => sl.effectiveTemp);
      const minT = Math.min(...temps), maxT = Math.max(...temps);
      tempSummary = minT === maxT ? `${minT} °C track` : `${minT}-${maxT} °C track`;
    } else {
      tempSummary = cfg.useThermostat ? cfg.thermostatTemp + " °C" : "ambient";
    }
  } else {
    tempSummary = cfg.useThermostat ? cfg.thermostatTemp + " °C" : "ambient";
  }

  setText("sumOrganism", orgObj ? orgObj.label : "Custom");
  setText("sumOrganismSub",
    `${cfg.targetSize} mm · threshold ${cfg.detThreshold} · ${tempSummary}`);

  setText("sumPlate", cfg.plate.name);
  const plateMetaText = cfg.isMaze
    ? `${cfg.numWells} arena${cfg.numWells === 1 ? "" : "s"} · ${cfg.numZones} zone${cfg.numZones === 1 ? "" : "s"}`
    : cfg.plate.meta;
  setText("sumPlateSub", `${plateMetaText} · ${cfg.arenaBmp || cfg.plate.arenaBmp}.bmp`);

  const stim = STIMULI.find(s => s.id === state.stimId);
  setText("sumStim", stim ? stim.name : state.stimId);
  setText("sumStimSub", document.getElementById("timelineDesc").textContent);

  const metrics = [];
  if (cfg.useDist) metrics.push("Distance");
  if (cfg.useMsd) metrics.push("Activity");
  if (cfg.useZones) metrics.push("Zones");
  if (cfg.useZoneChanges) metrics.push("Zone Events");
  if (cfg.useXy) metrics.push("Raw XY");
  setText("sumData", metrics.join(" · "));
  const extras = [];
  if (cfg.useTracks) extras.push("tracks");
  if (cfg.useHeatmap) extras.push("heatmap");
  if (cfg.usePicture) extras.push("photo");
  setText("sumDataSub", (VIDEO_LABELS[cfg.videoMode] || cfg.videoMode) + (extras.length ? " · " + extras.join(" + ") : ""));
}

function pageIndexOf(id) {
  return WIZARD_PAGES.findIndex(p => p.id === id);
}

function goToPage(id, opts) {
  const idx = pageIndexOf(id);
  if (idx < 0) return;
  const changed = idx !== currentPageIdx;
  currentPageIdx = idx;
  const last = WIZARD_PAGES.length - 1;

  document.querySelectorAll(".wizard-page").forEach(sec => {
    sec.classList.toggle("active", sec.getAttribute("data-page") === id);
  });
  document.querySelectorAll("#wizardStepper .stepper-item").forEach((btn, i) => {
    btn.classList.toggle("active", i === idx);
    btn.classList.toggle("done", i < idx);
    if (i === idx) btn.setAttribute("aria-current", "step");
    else btn.removeAttribute("aria-current");
  });
  document.querySelectorAll(".summary-row").forEach(row => {
    row.classList.toggle("current", row.getAttribute("data-goto") === id);
  });

  const prevBtn = document.getElementById("wizPrevBtn");
  const nextBtn = document.getElementById("wizNextBtn");
  prevBtn.disabled = idx === 0;
  prevBtn.textContent = idx === 0 ? "\u2190 Back" : `\u2190 ${WIZARD_PAGES[idx - 1].label}`;
  nextBtn.textContent = idx === last
    ? "Download All 4 Scripts (.zip)"
    : `Next: ${WIZARD_PAGES[idx + 1].label} \u2192`;
  setText("wizProgress", `${idx + 1} / ${WIZARD_PAGES.length}`);

  // Remember the page in the URL so a refresh stays on the same step
  try {
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
  } catch (_) {}

  if (changed && !(opts && opts.initial)) window.scrollTo(0, 0);
}

function bindWizard() {
  document.querySelectorAll("[data-goto]").forEach(el => {
    el.addEventListener("click", () => goToPage(el.getAttribute("data-goto")));
  });
  document.getElementById("wizPrevBtn").addEventListener("click", () => {
    if (currentPageIdx > 0) goToPage(WIZARD_PAGES[currentPageIdx - 1].id);
  });
  document.getElementById("wizNextBtn").addEventListener("click", () => {
    if (currentPageIdx < WIZARD_PAGES.length - 1) {
      goToPage(WIZARD_PAGES[currentPageIdx + 1].id);
    } else {
      document.getElementById("downloadZipBtn").click();
    }
  });
  document.getElementById("resetBtn").addEventListener("click", () => goToPage("study"));
  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (pageIndexOf(id) >= 0) goToPage(id);
  });

  const fromHash = location.hash.slice(1);
  goToPage(pageIndexOf(fromHash) >= 0 ? fromHash : "study", { initial: true });
}
