// Zantiks MWP Script Builder - refreshAll(), Plate Config modal actions and all event bindings
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 10. Event Listeners & Init
// ---------------------------------------------------------------------------
function openConfigModal() {
  renderConfigModalTable();
  document.getElementById("configModalBackdrop").classList.add("open");
}

function closeConfigModal() {
  document.getElementById("configModalBackdrop").classList.remove("open");
}

async function saveConfigJsFile() {
  const nowIso = new Date().toISOString();
  state.plateConfigUpdatedAt = nowIso;
  const payload = buildConfigPayload(nowIso);
  const jsText = formatPlateConfigJsContent(payload);

  // Persist in browser as well
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_PLATES, JSON.stringify(payload));
    }
  } catch (_) {}

  if (typeof window !== "undefined" && typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "zantiks_plate_config.js",
        types: [{
          description: "Zantiks Plate Config (.js)",
          accept: { "text/javascript": [".js"] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(jsText);
      await writable.close();
      state.unsavedFileChanges = false;
      updateConfigStatusBadges();
      showToast("Saved zantiks_plate_config.js");
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }

  const blob = new Blob([jsText], { type: "text/javascript;charset=utf-8" });
  triggerDownload(blob, "zantiks_plate_config.js");
  state.unsavedFileChanges = false;
  updateConfigStatusBadges();
  showToast("Downloaded zantiks_plate_config.js");
}

function bindEvents() {
  bindSimulatorEvents();

  // Researcher Full Name -> Auto-extract Last Name
  const userNameEl = document.getElementById("userName");
  userNameEl.addEventListener("input", refreshAll);
  userNameEl.addEventListener("change", refreshAll);

  // Step Tabs
  document.querySelectorAll("#stepTabs .tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.activeStep = parseInt(btn.getAttribute("data-step"), 10);
      document.querySelectorAll("#stepTabs .tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      refreshAll();
    });
  });

  // Exported Data Checkboxes
  ["dist", "msd", "zones", "xy"].forEach(k => {
    document.getElementById("chk_" + k).addEventListener("change", (e) => {
      const anyChecked = ["dist", "msd", "zones", "xy"].some(id => document.getElementById("chk_" + id).checked);
      if (!anyChecked) {
        e.target.checked = true;
        showToast("At least one exported data type is required");
      }
      syncCheckStyles();
      refreshAll();
    });
  });

  // Inline Plate Geometry Inputs (Persist per plate!)
  const inlineMap = {
    geoX: "xOffset",
    geoY: "yOffset",
    geoR: "r",
    geoColStep: "colStep",
    geoRowStep: "rowStep",
    geoRdz: "rDz"
  };
  Object.keys(inlineMap).forEach(inputId => {
    const el = document.getElementById(inputId);
    const field = inlineMap[inputId];
    const handleGeoEdit = (normalizeInput) => {
      const key = state.plateId;
      const defVal = FACTORY_PLATES[key][field];
      const val = roundGeo(el.value, defVal);
      state.plateGeometries[key][field] = val;
      if (normalizeInput) el.value = val;
      savePlateConfigToBrowser();
      renderPlateGrid();
      refreshAll();
    };
    el.addEventListener("input", () => handleGeoEdit(false));
    el.addEventListener("change", () => handleGeoEdit(true));
  });

  document.getElementById("inlineGeoDetails").addEventListener("toggle", refreshAll);

  document.getElementById("auto50InlineBtn").addEventListener("click", () => {
    const key = state.plateId;
    const r = state.plateGeometries[key].r;
    state.plateGeometries[key].rDz = Number((r * Math.SQRT1_2).toFixed(2));
    syncGeoInputsToActivePlate();
    savePlateConfigToBrowser();
    renderPlateGrid();
    refreshAll();
    showToast("Updated INNER_ZONE to 50% well area");
  });

  document.getElementById("resetPlateInlineBtn").addEventListener("click", () => {
    const key = state.plateId;
    const def = FACTORY_PLATES[key];
    state.plateGeometries[key] = {
      xOffset: def.xOffset, yOffset: def.yOffset,
      colStep: def.colStep, rowStep: def.rowStep,
      r: def.r, rDz: def.rDz
    };
    syncGeoInputsToActivePlate();
    savePlateConfigToBrowser();
    renderPlateGrid();
    refreshAll();
    showToast(`Reset ${def.name} offsets to factory defaults`);
  });

  // General Assay / Hardware Inputs
  [
    "videoMode", "chk_tracks", "chk_heatmap", "expPrefix", "hwVersion", "ledColor",
    "targetSize", "detThreshold", "msdThreshold", "autorefTimeout",
    "thermostatTemp", "chk_thermostat", "ledBrightness", "ledMount", "z3RgbMap"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      if (["targetSize", "detThreshold", "msdThreshold", "thermostatTemp", "chk_thermostat"].includes(id)) {
        state.organism = "custom";
        renderOrganismChips();
      }
      refreshAll();
    });
    el.addEventListener("change", () => {
      if (id === "z3RgbMap") {
        saveUnitZ3RgbMap(el.value);
        if (state.stimId === "multi_phase") renderStimParams();
      } else if (id === "hwVersion") {
        applyZ3RgbMapToCatalogs(state.z3RgbMap);
        if (state.stimId === "multi_phase") renderStimParams();
      }
      refreshAll();
    });
  });

  // Config Modal Events
  document.getElementById("openConfigModalBtn").addEventListener("click", openConfigModal);
  document.getElementById("openConfigFromStep1Btn").addEventListener("click", openConfigModal);
  document.getElementById("closeConfigModalBtn").addEventListener("click", closeConfigModal);
  document.getElementById("configModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "configModalBackdrop") closeConfigModal();
  });
  if (typeof document.addEventListener === "function") {
    document.addEventListener("keydown", (e) => {
      const modal = document.getElementById("configModalBackdrop");
      if (modal && modal.classList.contains("open")) {
        if (e.key === "Escape") closeConfigModal();
        return;
      }
      const curPage = WIZARD_PAGES[currentPageIdx];
      if (!curPage || curPage.id !== "stimulus" || state.stimId !== "multi_phase") return;

      const ae = document.activeElement;
      const tag = ae && ae.tagName ? ae.tagName.toUpperCase() : "";
      const inType = ae && ae.getAttribute ? String(ae.getAttribute("type") || "").toLowerCase() : "";
      const isRangeInput = tag === "INPUT" && inType === "range";
      const isTypingField =
        (tag === "INPUT" && inType !== "range" && inType !== "checkbox" && inType !== "button") ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        Boolean(ae && ae.isContentEditable);
      if (isTypingField) return;

      const spBox = document.getElementById("stimParamsBox");
      if (!spBox) return;

      if ((e.key === "Backspace" || e.key === "Delete") && state.selectedClipId !== null) {
        e.preventDefault();
        if (spBox._deleteSelectedClip) spBox._deleteSelectedClip();
      } else if (e.key === "Escape" && state.selectedClipId !== null) {
        e.preventDefault();
        if (spBox._deselectClip) spBox._deselectClip();
      } else if (!isRangeInput && (e.key === "ArrowLeft" || e.key === "ArrowRight") && state.selectedClipId !== null) {
        e.preventDefault();
        const stepMul = e.shiftKey ? 5 : 1;
        if (spBox._nudgeSelectedClip) spBox._nudgeSelectedClip((e.key === "ArrowLeft" ? -1 : 1) * stepMul);
      }
    });
  }

  document.getElementById("cfgProfileName").addEventListener("input", (e) => {
    state.profileName = e.target.value.trim().slice(0, 48);
    savePlateConfigToBrowser();
    refreshAll();
  });

  document.getElementById("saveCfgJsBtn").addEventListener("click", saveConfigJsFile);

  document.getElementById("exportCfgJsonBtn").addEventListener("click", () => {
    const nowIso = new Date().toISOString();
    state.plateConfigUpdatedAt = nowIso;
    const payload = buildConfigPayload(nowIso);
    const slug = sanitizeSlug(state.profileName, 24) || "mwp";
    const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
    triggerDownload(blob, `${slug}_plate_config.json`);
    showToast(`Exported ${slug}_plate_config.json`);
  });

  const fileInput = document.getElementById("cfgFileInput");
  document.getElementById("loadCfgFileBtn").addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseConfigText(reader.result);
        if (!applyConfigObject(parsed, true)) {
          throw new Error("No valid plate definitions found");
        }
        try {
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(STORAGE_KEY_PLATES, JSON.stringify(buildConfigPayload(state.plateConfigUpdatedAt)));
          }
        } catch (_) {}
        syncGeoInputsToActivePlate();
        renderPlateGrid();
        renderConfigModalTable();
        refreshAll();
        showToast(`Loaded config: ${state.profileName}`);
      } catch (err) {
        showToast("Invalid config file format");
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("resetAllPlatesBtn").addEventListener("click", () => {
    state.plateGeometries = cloneDefaultGeometries();
    savePlateConfigToBrowser();
    syncGeoInputsToActivePlate();
    renderPlateGrid();
    renderConfigModalTable();
    refreshAll();
    showToast("Reset all 9 plate formats to factory defaults");
  });

  // Copy filename (without .zs for pasting into Zantiks Settings -> 20 Slots)
  const copySlotName = () => {
    const slotName = refreshAll._latestBundle[state.activeStep].filename.replace(/\.zs$/, "");
    navigator.clipboard.writeText(slotName).then(() => {
      showToast(`Copied slot name: ${slotName}`);
    });
  };
  document.getElementById("copyFilenameBtn").addEventListener("click", copySlotName);
  const copySlotBtn = document.getElementById("copySlotNameBtn");
  if (copySlotBtn) copySlotBtn.addEventListener("click", copySlotName);

  // Copy script code
  document.getElementById("copyCodeBtn").addEventListener("click", () => {
    const code = refreshAll._latestBundle[state.activeStep].code;
    navigator.clipboard.writeText(code).then(() => {
      showToast(`Copied ${refreshAll._latestBundle[state.activeStep].filename}`);
    });
  });

  // Download single .zs
  document.getElementById("downloadSingleBtn").addEventListener("click", () => {
    const item = refreshAll._latestBundle[state.activeStep];
    const blob = new Blob([item.code], { type: "text/plain;charset=utf-8" });
    triggerDownload(blob, item.filename);
    showToast(`Downloaded ${item.filename}`);
  });

  // Download all 4 scripts + README as .zip
  document.getElementById("downloadZipBtn").addEventListener("click", () => {
    const b = refreshAll._latestBundle;
    const folder = b[4].bundleFolder;
    const zipBlob = createZipBlob([
      { name: `${folder}/${b[1].filename}`, content: b[1].code },
      { name: `${folder}/${b[2].filename}`, content: b[2].code },
      { name: `${folder}/${b[3].filename}`, content: b[3].code },
      { name: `${folder}/${b[4].filename}`, content: b[4].code },
      { name: `${folder}/README_STEPS.txt`, content: b.readme },
      { name: `${folder}/${EXPERIMENT_FILE_IN_ZIP}`, content: JSON.stringify(buildExperimentPayload(), null, 2) + "\n" }
    ]);
    triggerDownload(zipBlob, `${folder}_scripts.zip`);
    showToast(`Downloaded ${folder}_scripts.zip`);
  });

  // Reset Assay button (preserves calibrated plate offsets & clears autosave synchronously!)
  document.getElementById("resetBtn").addEventListener("click", () => {
    pauseSimulator();
    clearExperimentAutosave();
    resetAssayFieldsAndDom();

    syncGeoInputsToActivePlate();
    syncCheckStyles();
    renderOrganismChips();
    renderPlateGrid();
    renderStimGrid();
    renderStimParams();
    refreshAll();
    clearExperimentAutosave();
    setText("autosaveStatus", "Auto-saved in this browser");
    showToast("Reset assay settings (plate calibration kept)");
  });
}
