// Zantiks MWP Script Builder - App start-up (runs last)
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// Initialize app
function init() {
  loadInitialPlateConfig();

  const daph = ORGANISM_PRESETS[0];
  document.getElementById("targetSize").value = daph.targetSize;
  document.getElementById("detThreshold").value = daph.detThreshold;
  document.getElementById("msdThreshold").value = daph.msdThreshold;
  document.getElementById("thermostatTemp").value = daph.temp;
  document.getElementById("chk_thermostat").checked = daph.thermostat;
  document.getElementById("chk_msd").checked = true;

  syncGeoInputsToActivePlate();
  syncCheckStyles();
  renderOrganismChips();
  renderPlateGrid();
  renderStimGrid();
  renderStimParams();
  bindEvents();
  refreshAll();
  bindWizard();
}

init();
