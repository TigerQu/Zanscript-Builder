// Zantiks MWP Script Builder - App start-up (runs last)
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// Initialize app
function init() {
  loadInitialPlateConfig();
  loadInitialZ3RgbMap();
  resetAssayFieldsAndDom();

  // Bring back the last experiment edited in this browser (if any)
  restoreAutosavedExperiment();

  syncGeoInputsToActivePlate();
  syncCheckStyles();
  renderOrganismChips();
  renderPlateGrid();
  renderStimGrid();
  renderStimParams();
  bindEvents();
  refreshAll();
  bindWizard();
  bindPreflight();
  bindExperimentIO();
}

init();
