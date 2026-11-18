// Zantiks MWP Script Builder - Zanscript generators for Steps 1-4 (the .zs output)
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 6. Zanscript Generators for Steps 1, 2, 3, and 4
// ---------------------------------------------------------------------------
function buildResearcherComment(cfg) {
  if (cfg.userFullClean && cfg.lastName) {
    return `# Researcher: ${cfg.userFullClean} (file tag: ${cfg.lastName})`;
  }
  if (cfg.lastName) {
    return `# Researcher tag: ${cfg.lastName}`;
  }
  return null;
}

function buildZ3PortGateLines(colId, useTop, useUnder, turnOn) {
  const stateStr = turnOn ? "ON" : "OFF";
  const out = [];
  if (colId === "BLUE" || colId === "GREEN" || colId === "RED") {
    if (useTop) out.push(`    LIGHTS(LIGHT16,${stateStr})`);
    if (useUnder) out.push(`    LIGHTS(LIGHT15,${stateStr})`);
  } else if (colId === "UV") {
    if (useTop) out.push(`    LIGHTS(LIGHT14,${stateStr})`);
    if (useUnder) out.push(`    LIGHTS(LIGHT13,${stateStr})`);
  }
  return out;
}

function buildLightOnLines(cfg, col) {
  const c = col || cfg.ledColorObj || LED_COLORS.WHITE;
  const topLine = cfg.useTopLight
    ? `    SET(X_LED_DRIVE,${c.z3Over},LED_BRIGHTNESS)`
    : `    SET(X_LED_DRIVE,${c.z3Over},0)`;
  const underLine = cfg.useUnderLight
    ? `    SET(X_LED_DRIVE,${c.z3Under},LED_BRIGHTNESS)`
    : `    # SET(X_LED_DRIVE,${c.z3Under},LED_BRIGHTNESS)  # Uncomment for underneath LED`;
  return [topLine, underLine, ...buildZ3PortGateLines(c.id, cfg.useTopLight, cfg.useUnderLight, true)];
}

function buildLightOffLines(cfg, col) {
  const c = col || cfg.ledColorObj || LED_COLORS.WHITE;
  const topLine = `    SET(X_LED_DRIVE,${c.z3Over},0)`;
  const underLine = cfg.useUnderLight
    ? `    SET(X_LED_DRIVE,${c.z3Under},0)`
    : `    # SET(X_LED_DRIVE,${c.z3Under},0)`;
  return [topLine, underLine, ...buildZ3PortGateLines(c.id, cfg.useTopLight, cfg.useUnderLight, false)];
}

function buildLightActions(cfg) {
  const col = cfg.ledColorObj || LED_COLORS.WHITE;
  const isMultiColor = cfg.stimId === "multi_phase";

  if (cfg.hw === "Z3") {
    if (isMultiColor) {
      const hasBottomClips = (cfg.timelineClips || []).some(c => String(c.track || "").startsWith("U_"));
      const manageBottom = hasBottomClips || cfg.ledMount !== "OVERHEAD";
      const mpCol = (cfg.sp && cfg.sp.mpAcclimLight && LED_COLORS[cfg.sp.mpAcclimLight])
        ? LED_COLORS[cfg.sp.mpAcclimLight]
        : col;
      const onLines = [
        "ACTION LIGHTS_ON",
        cfg.useTopLight
          ? `    SET(X_LED_DRIVE,${mpCol.z3Over},LED_BRIGHTNESS)`
          : `    SET(X_LED_DRIVE,${mpCol.z3Over},0)`,
        cfg.useUnderLight
          ? `    SET(X_LED_DRIVE,${mpCol.z3Under},LED_BRIGHTNESS)`
          : (manageBottom
              ? `    SET(X_LED_DRIVE,${mpCol.z3Under},0)`
              : `    # SET(X_LED_DRIVE,${mpCol.z3Under},LED_BRIGHTNESS)  # Uncomment for underneath LED`),
        ...buildZ3PortGateLines(mpCol.id, cfg.useTopLight, cfg.useUnderLight, true),
        "COMPLETE"
      ];
      const offLines = [
        "ACTION LIGHTS_OFF",
        "    LIGHTS(ALL,OFF)",
        "    SET(X_LED_DRIVE,0,0)",
        "    SET(X_LED_DRIVE,1,0)",
        "    SET(X_LED_DRIVE,3,0)",
        "    SET(X_LED_DRIVE,4,0)",
        "    SET(X_LED_DRIVE,5,0)"
      ];
      if (manageBottom) {
        offLines.push(
          "    SET(X_LED_DRIVE,8,0)",
          "    SET(X_LED_DRIVE,9,0)",
          "    SET(X_LED_DRIVE,11,0)",
          "    SET(X_LED_DRIVE,12,0)",
          "    SET(X_LED_DRIVE,13,0)"
        );
      }
      offLines.push("COMPLETE");
      return [...onLines, "", ...offLines].join("\n");
    }

    return [
      "ACTION LIGHTS_ON",
      ...buildLightOnLines(cfg, col),
      "COMPLETE",
      "",
      "ACTION LIGHTS_OFF",
      ...buildLightOffLines(cfg, col),
      "COMPLETE"
    ].join("\n");
  }

  const g6 = col.z2Gpo.includes(6) ? 1 : 0;
  const g7 = col.z2Gpo.includes(7) ? 1 : 0;
  const g8 = col.z2Gpo.includes(8) ? 1 : 0;
  const z2Lines = ["ACTION LIGHTS_ON"];
  if (col.id === "UV") {
    z2Lines.push("    # Note: 365nm UV requires MWP Z3 UV channel; using GPO8 (Blue) fallback on Z2");
  }
  z2Lines.push(
    `    SET(GPO6,${g6})`,
    `    SET(GPO7,${g7})`,
    `    SET(GPO8,${g8})`,
    "COMPLETE",
    "",
    "ACTION LIGHTS_OFF",
    "    LIGHTS(ALL,OFF)",
    "    SET(GPO6,0)",
    "    SET(GPO7,0)",
    "    SET(GPO8,0)",
    "COMPLETE"
  );
  return z2Lines.join("\n");
}

function buildSliceLightLines(cfg, topLights, bottomLights, forceManageBottom) {
  const topById = {};
  for (const l of (topLights || [])) topById[l.id] = l;
  const botById = {};
  for (const l of (bottomLights || [])) botById[l.id] = l;

  if (cfg.hw === "Z3") {
    const order = ["UV", "BLUE", "GREEN", "WHITE", "RED"];
    const allClips = cfg.timelineClips || [];
    const acclimId = (cfg.sp && cfg.sp.mpAcclimLight) || "DARK";
    const hasTopRgbNow = Boolean(topById.BLUE || topById.GREEN || topById.RED);
    const hasTopUvNow = Boolean(topById.UV);
    const hasBotRgbNow = Boolean(botById.BLUE || botById.GREEN || botById.RED);
    const hasBotUvNow = Boolean(botById.UV);

    const everTopRgb = hasTopRgbNow ||
      allClips.some(c => c.track === "BLUE" || c.track === "GREEN" || c.track === "RED") ||
      (cfg.useTopLight && (acclimId === "BLUE" || acclimId === "GREEN" || acclimId === "RED"));
    const everTopUv = hasTopUvNow ||
      allClips.some(c => c.track === "UV") ||
      (cfg.useTopLight && acclimId === "UV");
    const everBotRgb = hasBotRgbNow ||
      allClips.some(c => c.track === "U_BLUE" || c.track === "U_GREEN" || c.track === "U_RED") ||
      (cfg.useUnderLight && (acclimId === "BLUE" || acclimId === "GREEN" || acclimId === "RED"));
    const everBotUv = hasBotUvNow ||
      allClips.some(c => c.track === "U_UV") ||
      (cfg.useUnderLight && acclimId === "UV");

    const lines = [];
    for (const id of order) {
      const col = LED_COLORS[id];
      const pwm = topById[id] ? topById[id].pwm : 0;
      lines.push(`    SET(X_LED_DRIVE,${col.z3Over},${pwm})`);
    }
    if (everTopRgb) lines.push(`    LIGHTS(LIGHT16,${hasTopRgbNow ? "ON" : "OFF"})`);
    if (everTopUv) lines.push(`    LIGHTS(LIGHT14,${hasTopUvNow ? "ON" : "OFF"})`);

    if (forceManageBottom || (bottomLights && bottomLights.length > 0) || cfg.ledMount !== "OVERHEAD") {
      for (const id of order) {
        const col = LED_COLORS[id];
        const pwm = botById[id] ? botById[id].pwm : 0;
        lines.push(`    SET(X_LED_DRIVE,${col.z3Under},${pwm})`);
      }
      if (everBotRgb) lines.push(`    LIGHTS(LIGHT15,${hasBotRgbNow ? "ON" : "OFF"})`);
      if (everBotUv) lines.push(`    LIGHTS(LIGHT13,${hasBotUvNow ? "ON" : "OFF"})`);
    }
    return lines;
  }

  const activeGpo = new Set();
  let hasUv = false;
  const combined = [...(topLights || []), ...(bottomLights || [])];
  for (const l of combined) {
    if (l.id === "UV") hasUv = true;
    for (const g of l.colObj.z2Gpo) activeGpo.add(g);
  }
  const z2 = [];
  if (bottomLights && bottomLights.length > 0) {
    z2.push("    # Legacy Z2 drives shared GPO6-8 channels (no independent underneath bank)");
  }
  if (hasUv) z2.push("    # UV fallback to GPO8 (Blue) on legacy Z2");
  if (activeGpo.size === 0) z2.push("    LIGHTS(ALL,OFF)");
  z2.push(
    `    SET(GPO6,${activeGpo.has(6) ? 1 : 0})`,
    `    SET(GPO7,${activeGpo.has(7) ? 1 : 0})`,
    `    SET(GPO8,${activeGpo.has(8) ? 1 : 0})`
  );
  return z2;
}

// STEP 1: Calibration
function generateStep1(cfg) {
  const userLine = buildResearcherComment(cfg);
  const headerLines = ["# Step 1: Camera Scale Calibration"];
  if (userLine) headerLines.push(userLine);
  headerLines.push(
    "# Insert the black 96-well Zantiks calibration plate into the MWP stand.",
    "# Only needed once during initial setup or if the camera/stand is moved."
  );

  const code = [
    ...headerLines,
    "",
    "ACTION MAIN",
    "",
    "    Calibration(0)",
    "",
    "COMPLETE",
    ""
  ].join("\n");

  const fname = cfg.lastName ? `01_${cfg.lastName}_calibration.zs` : "01_calibration.zs";

  return {
    filename: fname,
    instruction: "<strong>Physical setup:</strong> Place the black 96-well calibration plate into the MWP chamber and run once. Skip this step if your unit is already calibrated.",
    schemaText: "Saves internal camera scale calibration on the unit (no CSV output needed).",
    code
  };
}

// STEP 2: Plate Asset Builder
function generateStep2(cfg) {
  const p = cfg.plate;
  const g = cfg.geo;
  const sizeLabel = p.shape === "SQUARE" ? "LENGTH" : "RADIUS";
  const sizeDzLabel = p.shape === "SQUARE" ? "LENGTH_DZ" : "RADIUS_DZ";
  const userLine = buildResearcherComment(cfg);

  const headerLines = [`# Step 2: Plate Arena & Dual-Zone Asset Builder (${p.name})`];
  if (userLine) headerLines.push(userLine);
  headerLines.push(
    `# Config profile: ${sanitizeAsciiComment(state.profileName, 40) || "Default MWP"}`,
    `# Place an EMPTY ${p.name} plate into the MWP stand before running.`,
    `# Generates "${p.arenaBmp}.bmp" (full wells) and "${p.zoneBmp}.bmp" (50/50 outer/inner zones) in Assets.`
  );

  const code = [
    ...headerLines,
    "",
    "DEFINE SHOWTIME 2",
    `DEFINE DRAWDELAY ${p.drawDelay}`,
    "",
    `# Plate geometry in mm (${p.rows} rows x ${p.cols} columns)`,
    `DEFINE X_OFFSET ${g.xOffset}`,
    `DEFINE Y_OFFSET ${g.yOffset}`,
    `DEFINE COL_STEP ${g.colStep}`,
    `DEFINE ROW_STEP ${g.rowStep}`,
    `DEFINE ${sizeLabel} ${g.r}`,
    `DEFINE ${sizeDzLabel} ${g.rDz}`,
    "",
    "DEFINE ARENA_ZONE_MODE 200",
    "DEFINE ROW_COUNTER 101",
    "DEFINE ARENA_COUNTER 102",
    "DEFINE COLUMN_COUNTER 103",
    "DEFINE Y_POSITION 104",
    "DEFINE X_POSITION 105",
    "",
    "ACTION MAIN",
    "",
    "    INVOKE(BUILD_ARENAS,1)",
    "    WAIT(SHOWTIME)",
    "",
    "    INVOKE(BUILD_DUAL_ZONES,1)",
    "    WAIT(SHOWTIME)",
    "",
    "COMPLETE",
    "",
    "ACTION BUILD_ARENAS",
    "",
    "    ResetDrawing()",
    `    ShapeType(${p.shape},${sizeLabel})`,
    "    @ARENA_ZONE_MODE = 0",
    "    INVOKE(DRAW_GRID,1)",
    `    SaveDrawing("${p.arenaBmp}")`,
    "",
    "COMPLETE",
    "",
    "ACTION BUILD_DUAL_ZONES",
    "",
    "    ResetDrawing()",
    `    ShapeType(${p.shape},${sizeLabel})`,
    "    @ARENA_ZONE_MODE = 1",
    "    INVOKE(DRAW_GRID,1)",
    "",
    `    ShapeType(${p.shape},${sizeDzLabel})`,
    "    @ARENA_ZONE_MODE = 2",
    "    INVOKE(DRAW_GRID,1)",
    `    SaveDrawing("${p.zoneBmp}")`,
    "",
    "COMPLETE",
    "",
    "ACTION DRAW_GRID",
    "",
    "    @ROW_COUNTER = 0",
    "    @Y_POSITION = Y_OFFSET",
    "    @ARENA_COUNTER = 1",
    "",
    `    WHILE @ROW_COUNTER < ${p.rows}`,
    "        @COLUMN_COUNTER = 0",
    "        @X_POSITION = X_OFFSET",
    "",
    `        WHILE @COLUMN_COUNTER < ${p.cols}`,
    "            IF @ARENA_ZONE_MODE = 0",
    "                SET(DrawArea,@ARENA_COUNTER)",
    "            ELSE",
    "                SET(DrawArea,@ARENA_ZONE_MODE)",
    "            ENDIF",
    "",
    "            ShapeDraw(@X_POSITION,@Y_POSITION)",
    '            SaveDrawing("TEMP")',
    "            WAIT(DRAWDELAY)",
    "",
    "            @X_POSITION = @X_POSITION + COL_STEP",
    "            @COLUMN_COUNTER = @COLUMN_COUNTER + 1",
    "            @ARENA_COUNTER = @ARENA_COUNTER + 1",
    "        ENDWHILE",
    "",
    "        @Y_POSITION = @Y_POSITION + ROW_STEP",
    "        @ROW_COUNTER = @ROW_COUNTER + 1",
    "    ENDWHILE",
    "",
    "COMPLETE",
    ""
  ].join("\n");

  const fname = cfg.lastName ? `02_${cfg.lastName}_assets_${p.id}.zs` : `02_assets_${p.id}.zs`;

  return {
    filename: fname,
    instruction: `<strong>Physical setup:</strong> Insert an <strong>empty ${p.name} plate</strong> and run once while watching Live View. Saves <code>${p.arenaBmp}.bmp</code> and <code>${p.zoneBmp}.bmp</code> into Assets. Adjust offsets in Step 1 (or Plate Config) if wells need alignment.`,
    schemaText: `Assets created: ${p.arenaBmp}.bmp (${cfg.numWells} arenas) + ${p.zoneBmp}.bmp (Zone 1 = outer ring, Zone 2 = inner center).`,
    code
  };
}

// STEP 3: Tracking Parameter Check
function generateStep3(cfg) {
  const p = cfg.plate;
  const minSize = Math.max(1, Math.floor(cfg.targetSize - 1));
  const maxSize = Math.min(12, Math.ceil(cfg.targetSize + 2));
  const wellsHeader = cfg.wells.map(w => "DIST_" + w);
  const metaHeaders = ["RUNTIME", "UNIT_ID", "TEMP_C", "TARGET_SIZE", "DET_THRESHOLD", "TIME_BIN"];
  const headerBlock = formatLogHeaderBlock(metaHeaders, wellsHeader, "    ");
  const userLine = buildResearcherComment(cfg);

  const startDark = (cfg.stimId === "baseline" && cfg.sp.baseLight === "DARK") ||
    (cfg.stimId === "ld_transitions" && cfg.sp.ldStart === "DARK") ||
    (cfg.stimId === "light_on_pulse") ||
    (cfg.stimId === "vibration_startle" && cfg.sp.vibAmbient === "DARK") ||
    (cfg.stimId === "multi_phase" && cfg.sp.mpAcclimLight === "DARK") ||
    (cfg.stimId === "temp_ramp" && cfg.sp.rampLight === "DARK");

  const mpCompiledForStep3 = cfg.stimId === "multi_phase"
    ? compileMultiTrackSlices(cfg.timelineClips, cfg.sp.mpTimelineSec, cfg.sp.timeBinSec, cfg.thermostatTemp)
    : null;

  const step3UseTherm = cfg.stimId === "temp_ramp" ||
    (mpCompiledForStep3 && mpCompiledForStep3.hasAnyTempClip) ||
    cfg.useThermostat;
  const step3Temp = cfg.stimId === "temp_ramp"
    ? computeTempRampSteps(cfg.sp.rampStartTemp, cfg.sp.rampEndTemp, cfg.sp.rampStepTemp)[0]
    : (mpCompiledForStep3 && mpCompiledForStep3.hasAnyTempClip
        ? mpCompiledForStep3.initialTemp
        : cfg.thermostatTemp);

  const lines = [`# Step 3: Organism Tracking Check (${p.name})`];
  if (userLine) lines.push(userLine);
  lines.push(
    "# Optional 1-2 minute pre-check with animals loaded in the plate.",
    `# Sweeps TARGET_SIZE (${minSize} to ${maxSize}) and DETECTOR_THRESHOLD (2 to 10)`,
    "# so you can confirm clean target lock on video before running Step 4.",
    "",
    "DEFINE TIME_BIN 1",
    "DEFINE SAMPLES_PER_SETTING 2",
    `DEFINE MIN_SIZE ${minSize}`,
    `DEFINE MAX_SIZE ${maxSize}`,
    "DEFINE MIN_THRESH 2",
    "DEFINE MAX_THRESH 10",
    `DEFINE AUTOREF_TIME ${cfg.autorefTimeout}`,
    "DEFINE VIDEO_LENGTH 999999"
  );

  if (cfg.hw === "Z3") {
    lines.push("DEFINE X_LED_DRIVE 30039");
    lines.push(`DEFINE LED_BRIGHTNESS ${cfg.ledDriveVal}`);
  }
  if (step3UseTherm) {
    lines.push(`SET(THERMOSTAT,${step3Temp})`);
  } else {
    lines.push(`# SET(THERMOSTAT,${cfg.thermostatTemp})  # Thermostat disabled`);
  }

  lines.push(
    "",
    "DEFINE SIZE_VAR 101",
    "DEFINE THRESH_VAR 102",
    "",
    "SET(AUTOREF_MODE,MOVEMENT)",
    "SET(AUTOREF_TIMEOUT,AUTOREF_TIME)",
    "",
    "ACTION MAIN",
    "",
    "    SET(COUNTER1,COUNTER_ZERO)",
    `    INVOKE(${startDark ? "LIGHTS_OFF" : "LIGHTS_ON"},1)`,
    `    LOAD(ARENAS,"${p.arenaBmp}.bmp")`,
    "",
    headerBlock,
    "",
    `    VIDEO(VIDEO_LENGTH,"${cfg.runPrefix}_track_check_${p.id}")`,
    '    LOAD(OVERLAY_TEXT,"1,1:AUTOREFERENCING       ")',
    "    AUTOREFERENCE()",
    "",
    "    INVOKE(SWEEP_SETTINGS,1)",
    "",
    "    VIDEOSTOP",
    '    LOAD(OVERLAY_CLEAR,"")',
    "    INVOKE(LIGHTS_OFF,1)",
    "",
    "COMPLETE",
    "",
    "ACTION SWEEP_SETTINGS",
    "",
    "    @SIZE_VAR = MIN_SIZE",
    "    WHILE @SIZE_VAR <= MAX_SIZE",
    "        SET(TARGET_SIZE,@SIZE_VAR)",
    "        TargetMarker(@SIZE_VAR,1,1)",
    "        @THRESH_VAR = MIN_THRESH",
    "",
    "        WHILE @THRESH_VAR <= MAX_THRESH",
    "            SET(DETECTOR_THRESHOLD,@THRESH_VAR)",
    '            LOAD(OVERLAY_TEXT,"1,1:SIZE @101  THRESH @102  ")',
    "            INVOKE(SAMPLE_BIN,SAMPLES_PER_SETTING)",
    "            @THRESH_VAR = @THRESH_VAR + 2",
    "        ENDWHILE",
    "",
    "        @SIZE_VAR = @SIZE_VAR + 1",
    "    ENDWHILE",
    "",
    "COMPLETE",
    "",
    "ACTION SAMPLE_BIN",
    "",
    "    SET(COUNTER1,COUNTER_INC)",
    '    LOGDATA(DATA_SNAPSHOT,"begin")',
    "    WAIT(TIME_BIN)",
    '    LOGDATA(DATA_SNAPSHOT,"end")',
    '    LOGDATA(DATA_SELECT,"begin")',
    '    LOGDATA(DATA_DELTA,"end")',
    "",
    '    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|@101|@102|COUNTER1")',
    '    LOGAPPEND("ARENA_DISTANCES:*")',
    "    LOGRUN()",
    "",
    "COMPLETE",
    "",
    buildLightActions(cfg),
    ""
  );

  const fname = cfg.lastName ? `03_${cfg.lastName}_track_check_${p.id}.zs` : `03_track_check_${p.id}.zs`;

  return {
    filename: fname,
    instruction: "<strong>Optional check:</strong> Load animals into the plate and watch Live View (or review the recorded video) to verify that the crosshair stays locked on each organism without background flicker.",
    schemaText: `CSV Columns: ${metaHeaders.join(" | ")} | DIST_${cfg.wells[0]} ... DIST_${cfg.wells[cfg.wells.length - 1]}`,
    code: lines.join("\n")
  };
}

// STEP 4: Main Assay Protocol
function generateStep4(cfg) {
  const p = cfg.plate;
  const sp = cfg.sp;
  const N = cfg.numWells;
  const arenaRange = N === 1 ? "A1" : `A1-${N}`;
  const userLine = buildResearcherComment(cfg);
  const runSlug = `${cfg.runPrefix}_${cfg.stimId}_${p.id}`;

  // Build well headers and data expression tokens in identical order
  const wellHeaders = [];
  const dataExprs = [];

  if (cfg.useDist) {
    for (const w of cfg.wells) wellHeaders.push(`DIST_${w}`);
    dataExprs.push("ARENA_DISTANCES:*");
  }
  if (cfg.useMsd) {
    for (const w of cfg.wells) wellHeaders.push(`MSD_${w}`);
    dataExprs.push("ARENA_ACTIVITY:*");
  }
  if (cfg.useZones) {
    for (const w of cfg.wells) {
      wellHeaders.push(`ZD_${w}_Z1`, `ZD_${w}_Z2`);
    }
    for (const w of cfg.wells) {
      wellHeaders.push(`ZC_${w}_Z1`, `ZC_${w}_Z2`);
    }
    for (const w of cfg.wells) {
      wellHeaders.push(`ZT_${w}_Z1`, `ZT_${w}_Z2`);
    }
    dataExprs.push(
      `ZONE_DISTANCES:${arenaRange} Z1-2`,
      `ZONE_COUNTERS:${arenaRange} Z1-2`,
      `ZONE_TIMERS:${arenaRange} Z1-2`
    );
  }

  if (dataExprs.length === 0) {
    for (const w of cfg.wells) wellHeaders.push(`DIST_${w}`);
    dataExprs.push("ARENA_DISTANCES:*");
  }

  const isCircadian = cfg.stimId === "circadian";
  const hasTrials = ["ld_transitions", "light_off_startle", "light_on_pulse", "vibration_startle", "multi_phase", "temp_ramp"].includes(cfg.stimId);
  const activeLightTag = (cfg.ledColorObj && cfg.ledColorObj.tag) ? cfg.ledColorObj.tag : "LIGHT";

  let metaHeaders;
  if (isCircadian) {
    metaHeaders = ["RUNTIME", "UNIT_ID", "TEMP_C", "PHASE", "DAY", "HOUR", "TIME_BIN"];
  } else if (hasTrials) {
    metaHeaders = ["RUNTIME", "UNIT_ID", "TEMP_C", "PHASE", "TRIAL", "TIME_BIN"];
  } else {
    metaHeaders = ["RUNTIME", "UNIT_ID", "TEMP_C", "PHASE", "TIME_BIN"];
  }

  const topDefines = [];
  const mainSchedule = [];
  const extraActions = [];
  let totalRuntimeSec = 0;
  let totalRows = 0;
  let initialTempOverride = null;
  let restoreTempAtEnd = null;

  if (cfg.stimId === "baseline") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const dur = Math.max(bin, parseInt(sp.durationSec, 10) || 600);
    const numBins = Math.max(1, Math.round(dur / bin));
    const lightLabel = sp.baseLight === "DARK" ? "DARK" : activeLightTag;
    const lightAction = sp.baseLight === "DARK" ? "LIGHTS_OFF" : "LIGHTS_ON";

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      `DEFINE NUM_BINS ${numBins}`
    );

    mainSchedule.push(
      `    INVOKE(${lightAction},1)`,
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("ACCLIMATION")}")`,
      "    WAIT(ACCLIMATION_SEC)",
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("AUTOREFERENCING")}")`,
      "    AUTOREFERENCE()",
      "__START_RECORDING__",
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("TRACKING " + lightLabel)}")`,
      "    INVOKE(SAMPLE_BIN,NUM_BINS)"
    );

    extraActions.push(
      buildSampleAction("SAMPLE_BIN", `RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${lightLabel}|COUNTER1`, dataExprs)
    );

    totalRuntimeSec = acclim + cfg.autorefTimeout + numBins * bin;
    totalRows = numBins;

  } else if (cfg.stimId === "ld_transitions") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const phaseSec = Math.max(bin, parseInt(sp.ldPhaseSec, 10) || 300);
    const phaseBins = Math.max(1, Math.round(phaseSec / bin));
    const cycles = Math.max(1, parseInt(sp.ldCycles, 10) || 2);
    const startLight = sp.ldStart !== "DARK";

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      `DEFINE PHASE_BINS ${phaseBins}`,
      `DEFINE NUM_CYCLES ${cycles}`
    );

    mainSchedule.push(
      `    INVOKE(${startLight ? "LIGHTS_ON" : "LIGHTS_OFF"},1)`,
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("ACCLIMATION")}")`,
      "    WAIT(ACCLIMATION_SEC)",
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("AUTOREFERENCING")}")`,
      "    AUTOREFERENCE()",
      "__START_RECORDING__",
      "    INVOKE(LD_CYCLE,NUM_CYCLES)"
    );

    const firstBlock = startLight
      ? [
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("PHASE: " + activeLightTag)}")`,
          "    INVOKE(LIGHTS_ON,1)",
          "    INVOKE(SAMPLE_LIGHT,PHASE_BINS)"
        ]
      : [
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("PHASE: DARK")}")`,
          "    INVOKE(LIGHTS_OFF,1)",
          "    INVOKE(SAMPLE_DARK,PHASE_BINS)"
        ];

    const secondBlock = startLight
      ? [
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("PHASE: DARK")}")`,
          "    INVOKE(LIGHTS_OFF,1)",
          "    INVOKE(SAMPLE_DARK,PHASE_BINS)"
        ]
      : [
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("PHASE: " + activeLightTag)}")`,
          "    INVOKE(LIGHTS_ON,1)",
          "    INVOKE(SAMPLE_LIGHT,PHASE_BINS)"
        ];

    extraActions.push(
      [
        "ACTION LD_CYCLE",
        "",
        "    SET(COUNTER2,COUNTER_INC)",
        ...firstBlock,
        "",
        ...secondBlock,
        "",
        "COMPLETE"
      ].join("\n"),
      buildSampleAction("SAMPLE_LIGHT", `RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${activeLightTag}|COUNTER2|COUNTER1`, dataExprs),
      buildSampleAction("SAMPLE_DARK", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:DARK|COUNTER2|COUNTER1", dataExprs)
    );

    totalRuntimeSec = acclim + cfg.autorefTimeout + cycles * 2 * phaseBins * bin;
    totalRows = cycles * 2 * phaseBins;

  } else if (cfg.stimId === "light_off_startle") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseInt(sp.preBaselineSec, 10) || 60);
    const preBins = Math.round(preSec / bin);
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const pulseDur = Math.max(0.1, parseFloat(sp.pulseDurSec) || 1);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiBins = Math.max(1, Math.round(itiSec / bin));

    const subBinPulse = pulseDur < bin;
    const pulseBins = subBinPulse ? 1 : Math.max(1, Math.round(pulseDur / bin));
    const postPulseWait = subBinPulse ? Number((bin - pulseDur).toFixed(3)) : 0;

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      `DEFINE BASELINE_BINS ${preBins}`,
      `DEFINE NUM_PULSES ${pulses}`,
      `DEFINE ITI_BINS ${itiBins}`
    );
    if (subBinPulse) {
      topDefines.push(
        `DEFINE PULSE_DURATION ${pulseDur}`,
        `DEFINE POST_PULSE_WAIT ${postPulseWait}`
      );
    } else {
      topDefines.push(`DEFINE PULSE_BINS ${pulseBins}`);
    }

    mainSchedule.push(
      "    INVOKE(LIGHTS_ON,1)",
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("ACCLIMATION")}")`,
      "    WAIT(ACCLIMATION_SEC)",
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("AUTOREFERENCING")}")`,
      "    AUTOREFERENCE()",
      "__START_RECORDING__"
    );
    if (preBins > 0) {
      mainSchedule.push(
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("BASELINE")}")`,
        "    INVOKE(SAMPLE_BASELINE,BASELINE_BINS)"
      );
    }
    mainSchedule.push("    INVOKE(STARTLE_TRIAL,NUM_PULSES)");

    if (subBinPulse) {
      extraActions.push(
        [
          "ACTION STARTLE_TRIAL",
          "",
          "    SET(COUNTER2,COUNTER_INC)",
          "    INVOKE(DARK_PULSE_BIN,1)",
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("ITI RECOVERY")}")`,
          "    INVOKE(SAMPLE_ITI,ITI_BINS)",
          "",
          "COMPLETE",
          "",
          "ACTION DARK_PULSE_BIN",
          "",
          "    SET(COUNTER1,COUNTER_INC)",
          '    LOGDATA(DATA_SNAPSHOT,"begin")',
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("LIGHT-OFF PULSE")}")`,
          "    INVOKE(LIGHTS_OFF,1)",
          "    WAIT(PULSE_DURATION)",
          "    INVOKE(LIGHTS_ON,1)",
          "    WAIT(POST_PULSE_WAIT)",
          '    LOGDATA(DATA_SNAPSHOT,"end")',
          '    LOGDATA(DATA_SELECT,"begin")',
          '    LOGDATA(DATA_DELTA,"end")',
          "",
          '    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:STARTLE|COUNTER2|COUNTER1")',
          ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
          "    LOGRUN()",
          "",
          "COMPLETE"
        ].join("\n")
      );
    } else {
      extraActions.push(
        [
          "ACTION STARTLE_TRIAL",
          "",
          "    SET(COUNTER2,COUNTER_INC)",
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("LIGHT-OFF PULSE")}")`,
          "    INVOKE(LIGHTS_OFF,1)",
          "    INVOKE(SAMPLE_STARTLE,PULSE_BINS)",
          "    INVOKE(LIGHTS_ON,1)",
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("ITI RECOVERY")}")`,
          "    INVOKE(SAMPLE_ITI,ITI_BINS)",
          "",
          "COMPLETE"
        ].join("\n"),
        buildSampleAction("SAMPLE_STARTLE", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:STARTLE|COUNTER2|COUNTER1", dataExprs)
      );
    }

    if (preBins > 0) {
      extraActions.push(
        buildSampleAction("SAMPLE_BASELINE", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:BASELINE|COUNTER2|COUNTER1", dataExprs)
      );
    }
    extraActions.push(
      buildSampleAction("SAMPLE_ITI", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:ITI|COUNTER2|COUNTER1", dataExprs)
    );

    totalRuntimeSec = acclim + cfg.autorefTimeout + preBins * bin + pulses * (pulseBins + itiBins) * bin;
    totalRows = preBins + pulses * (pulseBins + itiBins);

  } else if (cfg.stimId === "light_on_pulse") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseInt(sp.preBaselineSec, 10) || 60);
    const preBins = Math.round(preSec / bin);
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const pulseDur = Math.max(0.1, parseFloat(sp.pulseDurSec) || 1);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiBins = Math.max(1, Math.round(itiSec / bin));

    const subBinPulse = pulseDur < bin;
    const pulseBins = subBinPulse ? 1 : Math.max(1, Math.round(pulseDur / bin));
    const postPulseWait = subBinPulse ? Number((bin - pulseDur).toFixed(3)) : 0;

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      `DEFINE BASELINE_BINS ${preBins}`,
      `DEFINE NUM_PULSES ${pulses}`,
      `DEFINE ITI_BINS ${itiBins}`
    );
    if (subBinPulse) {
      topDefines.push(
        `DEFINE PULSE_DURATION ${pulseDur}`,
        `DEFINE POST_PULSE_WAIT ${postPulseWait}`
      );
    } else {
      topDefines.push(`DEFINE PULSE_BINS ${pulseBins}`);
    }

    mainSchedule.push(
      "    INVOKE(LIGHTS_OFF,1)",
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("DARK ACCLIMATION")}")`,
      "    WAIT(ACCLIMATION_SEC)",
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("AUTOREFERENCING")}")`,
      "    AUTOREFERENCE()",
      "__START_RECORDING__"
    );
    if (preBins > 0) {
      mainSchedule.push(
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("DARK BASELINE")}")`,
        "    INVOKE(SAMPLE_BASELINE,BASELINE_BINS)"
      );
    }
    mainSchedule.push("    INVOKE(FLASH_TRIAL,NUM_PULSES)");

    if (subBinPulse) {
      extraActions.push(
        [
          "ACTION FLASH_TRIAL",
          "",
          "    SET(COUNTER2,COUNTER_INC)",
          "    INVOKE(LIGHT_FLASH_BIN,1)",
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("DARK ITI")}")`,
          "    INVOKE(SAMPLE_ITI,ITI_BINS)",
          "",
          "COMPLETE",
          "",
          "ACTION LIGHT_FLASH_BIN",
          "",
          "    SET(COUNTER1,COUNTER_INC)",
          '    LOGDATA(DATA_SNAPSHOT,"begin")',
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay(activeLightTag + " FLASH")}")`,
          "    INVOKE(LIGHTS_ON,1)",
          "    WAIT(PULSE_DURATION)",
          "    INVOKE(LIGHTS_OFF,1)",
          "    WAIT(POST_PULSE_WAIT)",
          '    LOGDATA(DATA_SNAPSHOT,"end")',
          '    LOGDATA(DATA_SELECT,"begin")',
          '    LOGDATA(DATA_DELTA,"end")',
          "",
          `    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${activeLightTag}_FLASH|COUNTER2|COUNTER1")`,
          ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
          "    LOGRUN()",
          "",
          "COMPLETE"
        ].join("\n")
      );
    } else {
      extraActions.push(
        [
          "ACTION FLASH_TRIAL",
          "",
          "    SET(COUNTER2,COUNTER_INC)",
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay(activeLightTag + " FLASH")}")`,
          "    INVOKE(LIGHTS_ON,1)",
          "    INVOKE(SAMPLE_FLASH,PULSE_BINS)",
          "    INVOKE(LIGHTS_OFF,1)",
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("DARK ITI")}")`,
          "    INVOKE(SAMPLE_ITI,ITI_BINS)",
          "",
          "COMPLETE"
        ].join("\n"),
        buildSampleAction("SAMPLE_FLASH", `RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${activeLightTag}_FLASH|COUNTER2|COUNTER1`, dataExprs)
      );
    }

    if (preBins > 0) {
      extraActions.push(
        buildSampleAction("SAMPLE_BASELINE", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:BASELINE|COUNTER2|COUNTER1", dataExprs)
      );
    }
    extraActions.push(
      buildSampleAction("SAMPLE_ITI", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:ITI|COUNTER2|COUNTER1", dataExprs)
    );

    totalRuntimeSec = acclim + cfg.autorefTimeout + preBins * bin + pulses * (pulseBins + itiBins) * bin;
    totalRows = preBins + pulses * (pulseBins + itiBins);

  } else if (cfg.stimId === "vibration_startle") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseInt(sp.preBaselineSec, 10) || 60);
    const preBins = Math.round(preSec / bin);
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiBins = Math.max(1, Math.round(itiSec / bin));
    const stepMode = sp.vibIntensity || "U0";
    const ambientAction = sp.vibAmbient === "LIGHT" ? "LIGHTS_ON" : "LIGHTS_OFF";

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      `DEFINE BASELINE_BINS ${preBins}`,
      `DEFINE NUM_PULSES ${pulses}`,
      `DEFINE ITI_BINS ${itiBins}`
    );

    mainSchedule.push(
      `    INVOKE(${ambientAction},1)`,
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("ACCLIMATION")}")`,
      "    WAIT(ACCLIMATION_SEC)",
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("AUTOREFERENCING")}")`,
      "    AUTOREFERENCE()",
      "__START_RECORDING__"
    );
    if (preBins > 0) {
      mainSchedule.push(
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("BASELINE")}")`,
        "    INVOKE(SAMPLE_BASELINE,BASELINE_BINS)"
      );
    }
    mainSchedule.push("    INVOKE(VIBRATION_TRIAL,NUM_PULSES)");

    extraActions.push(
      [
        "ACTION VIBRATION_TRIAL",
        "",
        "    SET(COUNTER2,COUNTER_INC)",
        "    INVOKE(VIBRATION_PULSE,1)",
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("POST-VIB ITI")}")`,
        "    INVOKE(SAMPLE_ITI,ITI_BINS)",
        "",
        "COMPLETE",
        "",
        "ACTION VIBRATION_PULSE",
        "",
        "    SET(COUNTER1,COUNTER_INC)",
        '    LOGDATA(DATA_SNAPSHOT,"begin")',
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("VIBRATION TAP")}")`,
        `    ZCOMMAND("${stepMode} D1000 M1 M-1 M1 M-1 M1 M-1 M1 M-1 M1 M-1")`,
        "    WAIT(TIME_BIN)",
        '    LOGDATA(DATA_SNAPSHOT,"end")',
        '    LOGDATA(DATA_SELECT,"begin")',
        '    LOGDATA(DATA_DELTA,"end")',
        "",
        '    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:VIBRATION|COUNTER2|COUNTER1")',
        ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
        "    LOGRUN()",
        "",
        "COMPLETE"
      ].join("\n")
    );
    if (preBins > 0) {
      extraActions.push(
        buildSampleAction("SAMPLE_BASELINE", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:BASELINE|COUNTER2|COUNTER1", dataExprs)
      );
    }
    extraActions.push(
      buildSampleAction("SAMPLE_ITI", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:ITI|COUNTER2|COUNTER1", dataExprs)
    );

    totalRuntimeSec = acclim + cfg.autorefTimeout + preBins * bin + pulses * (1 + itiBins) * bin;
    totalRows = preBins + pulses * (1 + itiBins);

  } else if (cfg.stimId === "circadian") {
    const bin = Math.max(1, parseInt(sp.circBinSec, 10) || 10);
    const lightHrs = Math.max(0, parseInt(sp.lightHours, 10) || 16);
    const darkHrs = Math.max(0, parseInt(sp.darkHours, 10) || 8);
    const days = Math.max(1, parseInt(sp.numDays, 10) || 2);
    const autoref = 300;
    const activeSecPerHour = Math.max(bin * 2, 3600 - autoref);
    const halfBins = Math.max(1, Math.floor(activeSecPerHour / (2 * bin)));

    topDefines.push(
      `DEFINE TIME_BIN ${bin}`,
      `DEFINE HALF_HOUR_BINS ${halfBins}  # 2 x ${halfBins} x ${bin}s + ${autoref}s autoref = ~1 hour`,
      `DEFINE LIGHT_HOURS ${lightHrs}`,
      `DEFINE DARK_HOURS ${darkHrs}`,
      `DEFINE NUM_DAYS ${days}`,
      "DEFINE DAY_VAR 100",
      "DEFINE HOUR_VAR 101",
      "DEFINE PHASE_VAR 102"
    );

    mainSchedule.push(
      "    @DAY_VAR = 0",
      "    INVOKE(LIGHTS_ON,1)",
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("AUTOREFERENCING")}")`,
      "    AUTOREFERENCE()",
      "__START_RECORDING__",
      "    INVOKE(RUN_DAY,NUM_DAYS)"
    );

    const dayLines = [
      "ACTION RUN_DAY",
      "",
      "    @DAY_VAR = @DAY_VAR + 1"
    ];
    if (lightHrs > 0) {
      dayLines.push(
        "    @HOUR_VAR = 1",
        "    @PHASE_VAR = 1",
        "    INVOKE(LIGHTS_ON,1)",
        "    INVOKE(RUN_HOUR,LIGHT_HOURS)"
      );
    }
    if (darkHrs > 0) {
      dayLines.push(
        "    @HOUR_VAR = 1",
        "    @PHASE_VAR = 0",
        "    INVOKE(LIGHTS_OFF,1)",
        "    INVOKE(RUN_HOUR,DARK_HOURS)"
      );
    }
    dayLines.push("", "COMPLETE");

    extraActions.push(
      dayLines.join("\n"),
      [
        "ACTION RUN_HOUR",
        "",
        "    IF @PHASE_VAR = 1",
        `        LOAD(OVERLAY_TEXT,"1,1:DAY @100 ${activeLightTag.padEnd(5, " ")} HR @101  ")`,
        "    ELSE",
        '        LOAD(OVERLAY_TEXT,"1,1:DAY @100 DARK  HR @101  ")',
        "    ENDIF",
        "",
        "    INVOKE(SAMPLE_CIRC,HALF_HOUR_BINS)",
        "    AUTOREFERENCE()",
        "    INVOKE(SAMPLE_CIRC,HALF_HOUR_BINS)",
        "    @HOUR_VAR = @HOUR_VAR + 1",
        "",
        "COMPLETE"
      ].join("\n"),
      [
        "ACTION SAMPLE_CIRC",
        "",
        "    SET(COUNTER1,COUNTER_INC)",
        '    LOGDATA(DATA_SNAPSHOT,"begin")',
        "    WAIT(TIME_BIN)",
        '    LOGDATA(DATA_SNAPSHOT,"end")',
        '    LOGDATA(DATA_SELECT,"begin")',
        '    LOGDATA(DATA_DELTA,"end")',
        "",
        "    IF @PHASE_VAR = 1",
        `        LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${activeLightTag}|@100|@101|COUNTER1")`,
        "    ELSE",
        '        LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:DARK|@100|@101|COUNTER1")',
        "    ENDIF",
        ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
        "    LOGRUN()",
        "",
        "COMPLETE"
      ].join("\n")
    );

    const hrsTotal = days * (lightHrs + darkHrs);
    totalRuntimeSec = autoref + hrsTotal * (2 * halfBins * bin + autoref);
    totalRows = hrsTotal * 2 * halfBins;

  } else if (cfg.stimId === "multi_phase") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const cycles = Math.max(1, parseInt(sp.mpCycles, 10) || 1);
    const acclimLight = sp.mpAcclimLight || "DARK";
    const comp = compileMultiTrackSlices(cfg.timelineClips, sp.mpTimelineSec, sp.timeBinSec, cfg.thermostatTemp);
    const bin = comp.bin;

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      `DEFINE NUM_CYCLES ${cycles}`
    );
    for (const sl of comp.slices) {
      topDefines.push(`DEFINE S${sl.idx}_BINS ${sl.bins}  # ${sl.startSec}s-${sl.endSec}s (${sl.csvTag})`);
    }

    if (comp.hasAnyTempClip) {
      initialTempOverride = comp.initialTemp;
      if (comp.anyTempChange) {
        restoreTempAtEnd = comp.initialTemp;
      }
    }

    const manageBottom = comp.hasAnyBottomClip || cfg.ledMount !== "OVERHEAD";
    const acclimCol = LED_COLORS[acclimLight] || LED_COLORS.WHITE;
    const acclimTopObjs = (acclimLight !== "DARK" && cfg.useTopLight)
      ? [{ id: acclimCol.id, pct: cfg.ledPct, pwm: cfg.ledDriveVal, colObj: acclimCol }]
      : [];
    const acclimBotObjs = (acclimLight !== "DARK" && cfg.useUnderLight)
      ? [{ id: acclimCol.id, pct: cfg.ledPct, pwm: cfg.ledDriveVal, colObj: acclimCol }]
      : [];

    mainSchedule.push(
      ...buildSliceLightLines(cfg, acclimTopObjs, acclimBotObjs, manageBottom),
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("ACCLIMATION")}")`,
      "    WAIT(ACCLIMATION_SEC)",
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("AUTOREFERENCING")}")`,
      "    AUTOREFERENCE()",
      "__START_RECORDING__",
      "    INVOKE(TIMELINE_CYCLE,NUM_CYCLES)"
    );

    const seqLines = [
      "ACTION TIMELINE_CYCLE",
      "",
      "    SET(COUNTER2,COUNTER_INC)"
    ];
    for (const sl of comp.slices) {
      seqLines.push(`    INVOKE(RUN_S${sl.idx},1)`);
    }
    seqLines.push("", "COMPLETE");
    extraActions.push(seqLines.join("\n"));

    for (const sl of comp.slices) {
      const runLines = [
        `ACTION RUN_S${sl.idx}`,
        "",
        ...buildSliceLightLines(cfg, sl.topLights, sl.bottomLights, manageBottom)
      ];
      if (sl.effectiveTemp !== null) {
        runLines.push(`    SET(THERMOSTAT,${sl.effectiveTemp})`);
      }
      runLines.push(
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay(sl.overlayText)}")`,
        `    INVOKE(SAMPLE_S${sl.idx},S${sl.idx}_BINS)`,
        "",
        "COMPLETE"
      );

      extraActions.push(
        runLines.join("\n"),
        buildSampleAction(`SAMPLE_S${sl.idx}`, `RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${sl.csvTag}|COUNTER2|COUNTER1`, dataExprs)
      );
    }

    totalRuntimeSec = acclim + cfg.autorefTimeout + cycles * comp.totalBins * bin;
    totalRows = cycles * comp.totalBins;

  } else if (cfg.stimId === "temp_ramp") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const holdSec = Math.max(bin, parseInt(sp.rampHoldSec, 10) || 300);
    const stepBins = Math.max(1, Math.round(holdSec / bin));
    const steps = computeTempRampSteps(sp.rampStartTemp, sp.rampEndTemp, sp.rampStepTemp);
    const lightAction = sp.rampLight === "LIGHT" ? "LIGHTS_ON" : "LIGHTS_OFF";

    initialTempOverride = steps[0];
    if (steps.length > 1) {
      restoreTempAtEnd = steps[0];
    }

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      `DEFINE STEP_BINS ${stepBins}  # ${stepBins * bin}s hold per temperature step (${steps.length} step(s))`
    );

    mainSchedule.push(
      `    INVOKE(${lightAction},1)`,
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("ACCLIM " + steps[0] + "C")}")`,
      "    WAIT(ACCLIMATION_SEC)",
      `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("AUTOREFERENCING")}")`,
      "    AUTOREFERENCE()",
      "__START_RECORDING__",
      "    INVOKE(THERMAL_RAMP,1)"
    );

    const rampLines = ["ACTION THERMAL_RAMP", ""];
    steps.forEach((t, idx) => {
      const sNum = idx + 1;
      rampLines.push(
        "    SET(COUNTER2,COUNTER_INC)",
        `    SET(THERMOSTAT,${t})`,
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("TEMP TARGET " + t + "C")}")`,
        `    INVOKE(SAMPLE_T${sNum},STEP_BINS)`,
        ""
      );
    });
    rampLines.push("COMPLETE");
    extraActions.push(rampLines.join("\n"));

    steps.forEach((t, idx) => {
      const sNum = idx + 1;
      extraActions.push(
        buildSampleAction(`SAMPLE_T${sNum}`, `RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:TEMP_${t}C|COUNTER2|COUNTER1`, dataExprs)
      );
    });

    totalRuntimeSec = acclim + cfg.autorefTimeout + steps.length * stepBins * bin;
    totalRows = steps.length * stepBins;
  }

  // Assemble full Step 4 Zanscript
  const out = [
    `# Step 4: Main Assay Script (${p.name} | ${STIMULI.find(s => s.id === cfg.stimId).name})`
  ];
  if (userLine) out.push(userLine);
  out.push(
    `# Required asset(s) in unit Assets folder: "${p.arenaBmp}.bmp"${cfg.useZones ? ` and "${p.zoneBmp}.bmp"` : ""}`,
    "",
    ...topDefines
  );

  if (cfg.videoMode !== "off") {
    out.push("DEFINE VIDEO_LENGTH 999999999");
  }
  if (cfg.hw === "Z3") {
    out.push("DEFINE X_LED_DRIVE 30039");
    out.push(`DEFINE LED_BRIGHTNESS ${cfg.ledDriveVal}`);
  }
  if (cfg.useTracks) {
    out.push("DEFINE X_DRAWTRACKS 30011");
    out.push("DEFINE X_TRACKTIME 30016");
  }
  if (cfg.useHeatmap) {
    out.push("DEFINE MAKEMAP 5682");
    out.push("DEFINE COLOURMAP 5683");
  }

  out.push("");
  if (initialTempOverride !== null) {
    out.push(`SET(THERMOSTAT,${initialTempOverride})`);
  } else if (cfg.useThermostat) {
    out.push(`SET(THERMOSTAT,${cfg.thermostatTemp})`);
  } else {
    out.push(`# SET(THERMOSTAT,${cfg.thermostatTemp})  # Thermostat disabled`);
  }

  out.push(
    `SET(TARGET_SIZE,${cfg.targetSize})`,
    `SET(DETECTOR_THRESHOLD,${cfg.detThreshold})`,
    cfg.stimId === "circadian" ? "SET(AUTOREF_MODE,2)" : "SET(AUTOREF_MODE,MOVEMENT)",
    `SET(AUTOREF_TIMEOUT,${cfg.stimId === "circadian" ? 300 : cfg.autorefTimeout})`,
    `TargetMarker(${Math.max(1, Number((cfg.targetSize * 0.6).toFixed(1)))},1,1)`
  );

  if (cfg.useMsd) {
    out.push(
      "SET(MSD_MODE,ON)",
      `SET(MSD_THRESHOLD,${cfg.msdThreshold})`
    );
  }

  if (cfg.useXy) {
    out.push(
      "",
      `LOGFILE(1,"${runSlug}_XY")`,
      "SET(LOG_STREAM_PERFRAME,1)"
    );
  }

  // ACTION MAIN
  out.push(
    "",
    "ACTION MAIN",
    "",
    "    SET(COUNTER1,COUNTER_ZERO)"
  );
  if (hasTrials) {
    out.push("    SET(COUNTER2,COUNTER_ZERO)");
  }
  if (cfg.useHeatmap) {
    out.push("    SET(COLOURMAP,0)");
  }

  out.push(`    LOAD(ARENAS,"${p.arenaBmp}.bmp")`);
  if (cfg.useZones) {
    out.push(`    LOAD(ZONES,"${p.zoneBmp}.bmp")`);
  }

  out.push(
    "",
    "    INVOKE(SETUP_HEADERS,1)"
  );

  if (cfg.useXy) {
    out.push(
      "    SET(LOG_STREAM,1)",
      "    INVOKE(SETUP_XY_HEADERS,1)",
      "    SET(LOG_STREAM,0)"
    );
  }

  out.push("");

  const recStartLines = [];
  if (cfg.useTracks) {
    recStartLines.push(
      "    SET(X_DRAWTRACKS,1)",
      "    SET(X_TRACKTIME,15)"
    );
  }
  if (cfg.videoMode !== "off") {
    recStartLines.push(`    VIDEO(VIDEO_LENGTH,"${runSlug}")`);
    if (cfg.videoMode === "1fps") {
      recStartLines.push("    VIDEOSKIP(29)");
    } else if (cfg.videoMode === "0.2fps") {
      recStartLines.push("    VIDEOSKIP(149)");
    } else {
      recStartLines.push("    VIDEOSKIP(0)");
    }
  }
  if (cfg.useXy) {
    recStartLines.push("    SET(LOG_PERFRAME,ON)");
  }

  for (const line of mainSchedule) {
    if (line === "__START_RECORDING__") {
      if (recStartLines.length) out.push(...recStartLines);
    } else {
      out.push(line);
    }
  }

  out.push("");
  if (cfg.useXy) {
    out.push("    SET(LOG_PERFRAME,OFF)");
  }
  if (cfg.useHeatmap) {
    out.push("    SET(MAKEMAP,20)");
  }
  if (cfg.videoMode !== "off") {
    out.push("    VIDEOSTOP");
  }
  if (restoreTempAtEnd !== null) {
    out.push(`    SET(THERMOSTAT,${restoreTempAtEnd})  # Restore baseline temperature`);
  }
  out.push(
    '    LOAD(OVERLAY_CLEAR,"")',
    "    INVOKE(LIGHTS_OFF,1)",
    "",
    "COMPLETE",
    ""
  );

  for (const act of extraActions) {
    out.push(act, "");
  }

  out.push(buildLightActions(cfg), "");

  out.push(
    "ACTION SETUP_HEADERS",
    "",
    formatLogHeaderBlock(metaHeaders, wellHeaders, "    "),
    "",
    "COMPLETE",
    ""
  );

  if (cfg.useXy) {
    const xyWellHeaders = [];
    for (const w of cfg.wells) {
      xyWellHeaders.push(`X_${w}`, `Y_${w}`);
    }
    out.push(
      "ACTION SETUP_XY_HEADERS",
      "",
      formatLogHeaderBlock(["RUNTIME"], xyWellHeaders, "    "),
      `    LOGCREATE("RUNTIME|RAW_XY:${arenaRange}")`,
      "",
      "COMPLETE",
      ""
    );
  }

  const firstWell = cfg.wells[0];
  const lastWell = cfg.wells[cfg.wells.length - 1];
  const metricSummaryParts = [];
  if (cfg.useDist || dataExprs[0] === "ARENA_DISTANCES:*") {
    metricSummaryParts.push(`DIST_${firstWell}..DIST_${lastWell}`);
  }
  if (cfg.useMsd) {
    metricSummaryParts.push(`MSD_${firstWell}..MSD_${lastWell}`);
  }
  if (cfg.useZones) {
    metricSummaryParts.push(`ZD/ZC/ZT_${firstWell}_Z1..Z2`);
  }
  let schemaDesc = `Summary CSV: ${metaHeaders.join(" | ")} | ${metricSummaryParts.join(" | ")}`;
  if (cfg.useXy) {
    schemaDesc += `  +  XY CSV (${runSlug}_XY): RUNTIME | X_${firstWell} | Y_${firstWell} ...`;
  }

  return {
    filename: `04_${runSlug}.zs`,
    bundleFolder: runSlug,
    instruction: `<strong>Main experiment:</strong> Confirm <code>${p.arenaBmp}.bmp</code>${cfg.useZones ? ` and <code>${p.zoneBmp}.bmp</code>` : ""} exist in Assets, load your ${p.name} plate with organisms, and click <strong>Run</strong>.`,
    schemaText: schemaDesc,
    code: out.join("\n"),
    totalRuntimeSec,
    totalRows,
    csvCount: cfg.useXy ? 2 : 1
  };
}

function buildSampleAction(name, logCreateStr, dataExprs) {
  return [
    `ACTION ${name}`,
    "",
    "    SET(COUNTER1,COUNTER_INC)",
    '    LOGDATA(DATA_SNAPSHOT,"begin")',
    "    WAIT(TIME_BIN)",
    '    LOGDATA(DATA_SNAPSHOT,"end")',
    '    LOGDATA(DATA_SELECT,"begin")',
    '    LOGDATA(DATA_DELTA,"end")',
    "",
    `    LOGCREATE("${logCreateStr}")`,
    ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
    "    LOGRUN()",
    "",
    "COMPLETE"
  ].join("\n");
}

function generateAllSteps(cfg) {
  const s1 = generateStep1(cfg);
  const s2 = generateStep2(cfg);
  const s3 = generateStep3(cfg);
  const s4 = generateStep4(cfg);
  const g = cfg.geo;
  const sizeKey = cfg.plate.shape === "SQUARE" ? "LENGTH" : "RADIUS";

  const researcherInfo = cfg.userFullClean
    ? `${cfg.userFullClean}${cfg.lastName ? ` (tag: ${cfg.lastName})` : ""}`
    : (cfg.lastName || "Not specified");

  const readme = [
    "ZANTIKS MWP EXPERIMENT BUNDLE",
    "=============================",
    `Researcher       : ${researcherInfo}`,
    `Study Tag        : ${cfg.expTag || "(none)"}`,
    `Plate Format     : ${cfg.plate.name} (${cfg.plate.rows} x ${cfg.plate.cols}, ${cfg.numWells} arena(s))`,
    `Config Profile   : ${state.profileName || "Default"}`,
    `Plate Geometry   : X_OFFSET=${g.xOffset}, Y_OFFSET=${g.yOffset}, COL_STEP=${g.colStep}, ROW_STEP=${g.rowStep}, ${sizeKey}=${g.r}, INNER_ZONE=${g.rDz} mm`,
    `Hardware Target  : MWP ${cfg.hw}`,
    `Stimulus Protocol: ${STIMULI.find(s => s.id === cfg.stimId).name}`,
    `Estimated Runtime: ${formatDuration(s4.totalRuntimeSec)} (${s4.totalRows} CSV rows)`,
    "",
    "EXECUTION ORDER IN ZANTIKS CONTROL CONSOLE",
    "------------------------------------------",
    `1. ${s1.filename}`,
    "   - Run ONCE with the black 96-well calibration plate. Skip if already calibrated.",
    "",
    `2. ${s2.filename}`,
    `   - Run ONCE with an EMPTY ${cfg.plate.name} plate.`,
    `   - Generates "${cfg.plate.arenaBmp}.bmp" and "${cfg.plate.zoneBmp}.bmp" inside the unit's Assets directory.`,
    "",
    `3. ${s3.filename} (Optional)`,
    "   - Run with organisms loaded to check TARGET_SIZE and DETECTOR_THRESHOLD on Live View.",
    "",
    `4. ${s4.filename}`,
    "   - Main assay script. Load your experimental plate, build, and run.",
    "   - Download exported .csv data from Control Console -> Data files when complete.",
    "",
    "UNIT REMINDERS",
    "--------------",
    "- Do not rename scripts with spaces or parentheses.",
    "- Always click Save before Build in the Zantiks web editor.",
    "- Always shut down via the Control Console webpage before switching off unit power.",
    ""
  ].join("\n");

  return { 1: s1, 2: s2, 3: s3, 4: s4, readme };
}
