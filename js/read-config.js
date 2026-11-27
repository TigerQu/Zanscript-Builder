// Zantiks MWP Script Builder - readConfig(): turns the current UI into one config object for the generators
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 5. Read Current UI Config
// ---------------------------------------------------------------------------
function readConfig() {
  const plate = FACTORY_PLATES[state.plateId] || FACTORY_PLATES["24well"];
  const geo = state.plateGeometries[state.plateId] || {
    xOffset: plate.xOffset, yOffset: plate.yOffset,
    colStep: plate.colStep, rowStep: plate.rowStep,
    r: plate.r, rDz: plate.rDz
  };
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
  const autorefTimeout = Math.max(0, parseIntOr(document.getElementById("autorefTimeout").value, 60));
  const thermostatTemp = parseFloat(document.getElementById("thermostatTemp").value) || 22;
  const useThermostat = document.getElementById("chk_thermostat").checked;
  const z3RgbMapEl = document.getElementById("z3RgbMap");
  const z3RgbMap = applyZ3RgbMapToCatalogs(z3RgbMapEl ? z3RgbMapEl.value : state.z3RgbMap);
  state.z3RgbMap = z3RgbMap;
  const ledColorRaw = document.getElementById("ledColor") ? document.getElementById("ledColor").value : "WHITE";
  const ledColorObj = LED_COLORS[ledColorRaw] || LED_COLORS.WHITE;
  const ledPct = Math.min(100, Math.max(5, parseFloat(document.getElementById("ledBrightness").value) || 100));
  const ledDriveVal = Math.round((ledPct / 100) * 4095);
  const ledMountEl = document.getElementById("ledMount");
  const ledMountRaw = ledMountEl ? ledMountEl.value : "OVERHEAD";
  const ledMount = ["OVERHEAD", "UNDERNEATH", "BOTH"].includes(ledMountRaw) ? ledMountRaw : "OVERHEAD";
  const useTopLight = ledMount === "OVERHEAD" || ledMount === "BOTH";
  const useUnderLight = ledMount === "UNDERNEATH" || ledMount === "BOTH";

  const zoneModeEl = document.getElementById("zoneMode");
  const zoneModeRaw = zoneModeEl ? zoneModeEl.value : "concentric";
  const zoneMode = ["concentric", "half_tb", "half_lr"].includes(zoneModeRaw) ? zoneModeRaw : "concentric";
  const mazeData = getActiveMazeData(plate.id, state.customMaze, zoneMode);
  const arenaBmp = mazeData.arenaBmp;
  const zoneBmp = mazeData.zoneBmp;

  const useDist = document.getElementById("chk_dist").checked;
  const useMsd = document.getElementById("chk_msd").checked;
  const useZones = document.getElementById("chk_zones").checked;
  const useZoneChangesEl = document.getElementById("chk_zchange");
  const useZoneChanges = Boolean(useZoneChangesEl && useZoneChangesEl.checked);
  const useXy = document.getElementById("chk_xy").checked;
  const videoMode = document.getElementById("videoMode").value;
  const useTracks = document.getElementById("chk_tracks").checked;
  const useHeatmap = document.getElementById("chk_heatmap").checked;
  const usePictureEl = document.getElementById("chk_picture");
  const usePicture = Boolean(usePictureEl && usePictureEl.checked);
  const trackTimeEl = document.getElementById("trackTimeSec");
  const trackTimeSec = Math.min(600, Math.max(1, parseInt(trackTimeEl ? trackTimeEl.value : "15", 10) || 15));
  const heatmapPalEl = document.getElementById("heatmapPalette");
  const heatmapPalette = Math.min(3, Math.max(0, parseInt(heatmapPalEl ? heatmapPalEl.value : "0", 10) || 0));
  if (trackTimeEl) trackTimeEl.disabled = !useTracks;
  if (heatmapPalEl) heatmapPalEl.disabled = !useHeatmap;

  return {
    plate,
    isMaze: mazeData.isMaze,
    mazeShapes: mazeData.shapes,
    numZones: mazeData.numZones,
    arenaBmp,
    zoneMode,
    zoneBmp,
    wells: mazeData.wells,
    numWells: mazeData.numArenas,
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
    z3RgbMap,
    useTopLight,
    useUnderLight,
    useDist,
    useMsd,
    useZones,
    useZoneChanges,
    useXy,
    videoMode,
    useTracks,
    trackTimeSec,
    useHeatmap,
    heatmapPalette,
    usePicture,
    geo,
    stimId: state.stimId,
    sp: state.stimParams,
    timelineClips: state.timelineClips
  };
}
