// Zantiks MWP Script Builder - readConfig(): turns the current UI into one config object for the generators
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 5. Read Current UI Config
// ---------------------------------------------------------------------------
function readConfig() {
  const plate = FACTORY_PLATES[state.plateId];
  const geo = state.plateGeometries[state.plateId];
  const hw = document.getElementById("hwVersion").value;

  const rawFullName = document.getElementById("userName").value;
  const rawExpTag = document.getElementById("expPrefix").value;

  const userFullClean = sanitizeAsciiComment(rawFullName, 40);
  const lastName = extractLastName(rawFullName);
  const expTag = sanitizeSlug(rawExpTag, 18);

  const prefixParts = [];
  if (lastName) prefixParts.push(lastName);
  if (expTag) prefixParts.push(expTag);
  const runPrefix = prefixParts.length > 0 ? prefixParts.join("_") : "mwp";

  const hasNonAsciiWarning = Boolean(
    (rawFullName.trim() && !lastName) || (rawExpTag.trim() && !expTag)
  );

  const targetSize = Math.max(0.5, parseFloat(document.getElementById("targetSize").value) || 2);
  const detThreshold = Math.max(1, parseInt(document.getElementById("detThreshold").value, 10) || 6);
  const msdThreshold = Math.max(1, parseInt(document.getElementById("msdThreshold").value, 10) || 6);
  const autorefTimeout = Math.max(0, parseInt(document.getElementById("autorefTimeout").value, 10) || 60);
  const thermostatTemp = parseFloat(document.getElementById("thermostatTemp").value) || 22;
  const useThermostat = document.getElementById("chk_thermostat").checked;
  const ledColorRaw = document.getElementById("ledColor") ? document.getElementById("ledColor").value : "WHITE";
  const ledColorObj = LED_COLORS[ledColorRaw] || LED_COLORS.WHITE;
  const ledPct = Math.min(100, Math.max(5, parseFloat(document.getElementById("ledBrightness").value) || 100));
  const ledDriveVal = Math.round((ledPct / 100) * 4095);
  const ledMountEl = document.getElementById("ledMount");
  const ledMountRaw = ledMountEl ? ledMountEl.value : "OVERHEAD";
  const ledMount = ["OVERHEAD", "UNDERNEATH", "BOTH"].includes(ledMountRaw) ? ledMountRaw : "OVERHEAD";
  const useTopLight = ledMount === "OVERHEAD" || ledMount === "BOTH";
  const useUnderLight = ledMount === "UNDERNEATH" || ledMount === "BOTH";

  const useDist = document.getElementById("chk_dist").checked;
  const useMsd = document.getElementById("chk_msd").checked;
  const useZones = document.getElementById("chk_zones").checked;
  const useXy = document.getElementById("chk_xy").checked;
  const videoMode = document.getElementById("videoMode").value;
  const useTracks = document.getElementById("chk_tracks").checked;
  const useHeatmap = document.getElementById("chk_heatmap").checked;

  return {
    plate,
    wells: getWellLabels(plate.rows, plate.cols),
    numWells: plate.rows * plate.cols,
    hw,
    userFullClean,
    lastName,
    expTag,
    runPrefix,
    hasNonAsciiWarning,
    targetSize,
    detThreshold,
    msdThreshold,
    autorefTimeout,
    thermostatTemp,
    useThermostat,
    ledColor: ledColorObj.id,
    ledColorObj,
    ledPct,
    ledDriveVal,
    ledMount,
    useTopLight,
    useUnderLight,
    useDist,
    useMsd,
    useZones,
    useXy,
    videoMode,
    useTracks,
    useHeatmap,
    geo,
    stimId: state.stimId,
    sp: state.stimParams,
    timelineClips: state.timelineClips
  };
}
