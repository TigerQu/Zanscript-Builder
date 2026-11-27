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

function numSlug(n) {
  return String(n).replace(/\./g, "p").replace(/-/g, "m");
}

function buildAssayDataSlug(cfg) {
  const p = cfg.plate;
  const sp = cfg.sp || {};
  const pShort = p.shortCode || p.id;
  const col = (cfg.ledColor || "WHITE").toLowerCase();
  const colOpt = col !== "white" ? `_${col}` : "";
  let detail = cfg.stimId;

  if (cfg.stimId === "baseline") {
    const mode = sp.baseLight === "DARK" ? "dark" : col;
    detail = `baseline_${mode}`;
  } else if (cfg.stimId === "ld_transitions") {
    const cycles = Math.max(1, parseInt(sp.ldCycles, 10) || 2);
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const phaseSec = Math.max(1, Math.round(Math.max(bin, parseInt(sp.ldPhaseSec, 10) || 300) / bin)) * bin;
    detail = `ld_${cycles}x${numSlug(phaseSec)}s${colOpt}`;
  } else if (cfg.stimId === "light_off_startle") {
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const dur = Math.max(0.1, parseFloat(sp.pulseDurSec) || 1);
    detail = `light_off_${pulses}x${numSlug(dur)}s${colOpt}`;
  } else if (cfg.stimId === "light_on_pulse") {
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const dur = Math.max(0.05, parseFloat(sp.pulseDurSec) || 1);
    const strobeHz = [2, 5, 10].includes(parseInt(sp.strobeHz, 10)) ? parseInt(sp.strobeHz, 10) : 0;
    const strobeOpt = strobeHz > 0 ? `_${strobeHz}hz` : "";
    detail = `light_on_${pulses}x${numSlug(dur)}s${strobeOpt}${colOpt}`;
  } else if (cfg.stimId === "vibration_startle") {
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const vib = String(sp.vibIntensity || "U3").toLowerCase();
    detail = `vibration_${pulses}x_${vib}`;
  } else if (cfg.stimId === "acoustic_startle") {
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const rawAud = sp.audioFile === "custom" ? sanitizeAudioAsset(sp.audioCustomFile || "stereo.wav") : sanitizeAudioAsset(sp.audioFile || "tone");
    const audSlug = sanitizeSlug(rawAud.replace(/\.wav$/i, ""), 12) || "tone";
    detail = `acoustic_${pulses}x_${audSlug}`;
  } else if (cfg.stimId === "ppi") {
    const pairs = Math.max(1, parseInt(sp.ppiPairs, 10) || 5);
    const isi = Math.max(50, parseInt(sp.ppiIsiMs, 10) || 300);
    detail = `ppi_${isi}ms_${pairs}x`;
  } else if (cfg.stimId === "circadian") {
    const lHrs = Math.max(0, parseIntOr(sp.lightHours, 16));
    const dHrs = Math.max(0, parseIntOr(sp.darkHours, 8));
    const days = Math.max(1, parseInt(sp.numDays, 10) || 2);
    const rampMin = cfg.hw === "Z3" ? Math.min(30, Math.max(0, parseIntOr(sp.circRampMin, 0))) : 0;
    const rampOpt = (rampMin > 0 && lHrs > 0 && dHrs > 0) ? `_ramp${rampMin}m` : "";
    detail = `circadian_${lHrs}l${dHrs}d_${days}d${rampOpt}${colOpt}`;
  } else if (cfg.stimId === "multi_phase") {
    const cycles = Math.max(1, parseInt(sp.mpCycles, 10) || 1);
    const comp = compileMultiTrackSlices(cfg.timelineClips, sp.mpTimelineSec, sp.timeBinSec, cfg.thermostatTemp);
    detail = `multi_track_${cycles}x${numSlug(comp.totalSec)}s`;
  } else if (cfg.stimId === "temp_ramp") {
    const steps = computeTempRampSteps(sp.rampStartTemp, sp.rampEndTemp, sp.rampStepTemp);
    detail = `temp_ramp_${numSlug(steps[0])}to${numSlug(steps[steps.length - 1])}c`;
  }

  return sanitizeSlug(`${cfg.runPrefix}_${detail}_${pShort}`, 48) || `mwp_${pShort}`;
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
    const order = ["UV", "BLUE", "GREEN", "WHITE", "RED"].sort((a, b) => LED_COLORS[a].z3Over - LED_COLORS[b].z3Over);
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

  const fname = cfg.lastName ? `01_${cfg.lastName}_cal.zs` : "01_cal.zs";

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
  const zMode = cfg.zoneMode || "concentric";
  const arenaBmp = cfg.arenaBmp || p.arenaBmp;
  const zoneBmp = cfg.zoneBmp || p.zoneBmp;
  const userLine = buildResearcherComment(cfg);

  if (cfg.isMaze) {
    const shapes = cfg.mazeShapes || [];
    const headerLines = [`# Step 2: Maze Arena & Zone Asset Builder (${p.name})`];
    if (userLine) headerLines.push(userLine);
    headerLines.push(
      `# Place an EMPTY ${p.name} into the MWP stand before running.`,
      `# Generates "${arenaBmp}.bmp" (${cfg.numWells} arena(s)) and "${zoneBmp}.bmp" (${cfg.numZones} zone(s)) in Assets.`,
      "# Coordinates are in mm on the 127.8 x 85.5 mm SBS plate footprint."
    );

    const emitShapeLines = (mode) => {
      if (shapes.length === 0) {
        return ["    # No maze shapes defined yet. Add shapes in the Custom 3D Maze editor."];
      }
      const out = [];
      let prevAngle = null;
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i];
        const drawCmd = mode === "arena" ? `SET(DrawArena,${s.arena})` : `SET(DrawZone,${s.zone})`;
        let typeCmd;
        if (s.type === "DISC") typeCmd = `ShapeType(DISC,${s.w})`;
        else if (s.type === "SQUARE") typeCmd = `ShapeType(SQUARE,${s.w})`;
        else if (s.type === "TRIANGLE") typeCmd = `ShapeType(TRIANGLE,${s.w})`;
        else typeCmd = `ShapeType(RECTANGLE,${s.w},${s.h})`;
        const ang = s.type === "DISC" ? 0 : (s.angle || 0);
        out.push(`    ${drawCmd}`);
        out.push(`    ${typeCmd}`);
        if (ang !== prevAngle) {
          out.push(`    ShapeAngle(${ang.toFixed(1)})`);
          prevAngle = ang;
        }
        out.push(`    ShapeDraw(${s.x},${s.y})`);
        out.push('    SaveDrawing("TEMP")');
        out.push("    WAIT(DRAWDELAY)");
        if (i < shapes.length - 1) out.push("");
      }
      return out;
    };

    const code = [
      ...headerLines,
      "",
      "DEFINE SHOWTIME 2",
      `DEFINE DRAWDELAY ${p.drawDelay}`,
      "",
      "ACTION MAIN",
      "",
      "    INVOKE(BUILD_ARENAS,1)",
      "    WAIT(SHOWTIME)",
      "",
      "    INVOKE(BUILD_ZONES,1)",
      "    WAIT(SHOWTIME)",
      "",
      "COMPLETE",
      "",
      "ACTION BUILD_ARENAS",
      "",
      "    ResetDrawing()",
      ...emitShapeLines("arena"),
      `    SaveDrawing("${arenaBmp}")`,
      "",
      "COMPLETE",
      "",
      "ACTION BUILD_ZONES",
      "",
      "    ResetDrawing()",
      ...emitShapeLines("zone"),
      `    SaveDrawing("${zoneBmp}")`,
      "",
      "COMPLETE",
      ""
    ].join("\n");

    const pShort = p.shortCode || p.id;
    const fname = `02_${cfg.lastName || "mwp"}_${pShort}.zs`;

    return {
      filename: fname,
      instruction: `<strong>Physical setup:</strong> Insert an <strong>empty ${p.name}</strong> and run once while watching Live View. Saves <code>${arenaBmp}.bmp</code> and <code>${zoneBmp}.bmp</code> into Assets.`,
      schemaText: `Assets created: ${arenaBmp}.bmp (${cfg.numWells} arena${cfg.numWells === 1 ? "" : "s"}) + ${zoneBmp}.bmp (${cfg.numZones} zone${cfg.numZones === 1 ? "" : "s"}, ${shapes.length} shape${shapes.length === 1 ? "" : "s"}).`,
      code
    };
  }

  const isSplit = zMode === "half_tb" || zMode === "half_lr";
  const sizeLabel = p.shape === "SQUARE" ? "LENGTH" : "RADIUS";
  const sizeDzLabel = p.shape === "SQUARE" ? "LENGTH_DZ" : "RADIUS_DZ";

  const zoneModeDesc = zMode === "half_tb"
    ? "50/50 top/bottom split zones (Light-Dark Preference)"
    : (zMode === "half_lr"
        ? "50/50 left/right split zones (Side Preference)"
        : "50/50 outer/inner zones");

  const headerLines = [`# Step 2: Plate Arena & Dual-Zone Asset Builder (${p.name})`];
  if (userLine) headerLines.push(userLine);
  headerLines.push(
    `# Config profile: ${sanitizeAsciiComment(state.profileName, 40) || "Default MWP"}`,
    `# Place an EMPTY ${p.name} plate into the MWP stand before running.`,
    `# Generates "${p.arenaBmp}.bmp" (full wells) and "${zoneBmp}.bmp" (${zoneModeDesc}) in Assets.`
  );

  const extraDefines = [];
  if (isSplit && p.shape === "DISC") {
    extraDefines.push("DEFINE X_SECTOR_ANGLE 30015  # Required for 180-deg semicircle zones");
  } else if (isSplit && p.shape === "SQUARE") {
    extraDefines.push(
      `DEFINE HALF_LEN ${Number((g.r / 2).toFixed(2))}`,
      `DEFINE QUARTER_LEN ${Number((g.r / 4).toFixed(2))}`
    );
  }

  let buildZonesLines;
  let extraGridAction = [];
  if (!isSplit) {
    buildZonesLines = [
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
      `    SaveDrawing("${zoneBmp}")`,
      "",
      "COMPLETE"
    ];
  } else if (p.shape === "DISC") {
    const splitAngle = zMode === "half_lr" ? "90.0" : "180.0";
    buildZonesLines = [
      "ACTION BUILD_DUAL_ZONES",
      "",
      "    ResetDrawing()",
      "    ShapeAngle(0.0)",
      "    SET(X_SECTOR_ANGLE,0.0)",
      `    ShapeType(DISC,${sizeLabel})`,
      "    @ARENA_ZONE_MODE = 1",
      "    INVOKE(DRAW_GRID,1)",
      "",
      `    ShapeAngle(${splitAngle})`,
      "    SET(X_SECTOR_ANGLE,180.0)",
      `    ShapeType(DISC,${sizeLabel})`,
      "    @ARENA_ZONE_MODE = 2",
      "    INVOKE(DRAW_GRID,1)",
      `    SaveDrawing("${zoneBmp}")`,
      "",
      "COMPLETE"
    ];
  } else {
    const rectCmd = zMode === "half_lr"
      ? "    ShapeType(RECTANGLE,HALF_LEN,LENGTH)"
      : "    ShapeType(RECTANGLE,LENGTH,HALF_LEN)";
    const drawHalfCmd = zMode === "half_lr"
      ? "            ShapeDraw(@X_POSITION - QUARTER_LEN,@Y_POSITION)"
      : "            ShapeDraw(@X_POSITION,@Y_POSITION - QUARTER_LEN)";
    buildZonesLines = [
      "ACTION BUILD_DUAL_ZONES",
      "",
      "    ResetDrawing()",
      "    ShapeType(SQUARE,LENGTH)",
      "    @ARENA_ZONE_MODE = 1",
      "    INVOKE(DRAW_GRID,1)",
      "",
      rectCmd,
      "    @ARENA_ZONE_MODE = 2",
      "    INVOKE(DRAW_HALF_GRID,1)",
      `    SaveDrawing("${zoneBmp}")`,
      "",
      "COMPLETE"
    ];
    extraGridAction = [
      "",
      "ACTION DRAW_HALF_GRID",
      "",
      "    @ROW_COUNTER = 0",
      "    @Y_POSITION = Y_OFFSET",
      "",
      `    WHILE @ROW_COUNTER < ${p.rows}`,
      "        @COLUMN_COUNTER = 0",
      "        @X_POSITION = X_OFFSET",
      "",
      `        WHILE @COLUMN_COUNTER < ${p.cols}`,
      "            SET(DrawArea,@ARENA_ZONE_MODE)",
      drawHalfCmd,
      '            SaveDrawing("TEMP")',
      "            WAIT(DRAWDELAY)",
      "",
      "            @X_POSITION = @X_POSITION + COL_STEP",
      "            @COLUMN_COUNTER = @COLUMN_COUNTER + 1",
      "        ENDWHILE",
      "",
      "        @Y_POSITION = @Y_POSITION + ROW_STEP",
      "        @ROW_COUNTER = @ROW_COUNTER + 1",
      "    ENDWHILE",
      "",
      "COMPLETE"
    ];
  }

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
    ...extraDefines,
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
    ...buildZonesLines,
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
    ...extraGridAction,
    ""
  ].join("\n");

  const pShort = p.shortCode || p.id;
  const fname = `02_${cfg.lastName || "mwp"}_${pShort}.zs`;

  const zoneSchemaLabel = zMode === "half_tb"
    ? "Zone 1 = bottom half, Zone 2 = top half"
    : (zMode === "half_lr"
        ? "Zone 1 = right half, Zone 2 = left half"
        : "Zone 1 = outer ring, Zone 2 = inner center");

  return {
    filename: fname,
    instruction: `<strong>Physical setup:</strong> Insert an <strong>empty ${p.name} plate</strong> and run once while watching Live View. Saves <code>${p.arenaBmp}.bmp</code> and <code>${zoneBmp}.bmp</code> into Assets. Adjust offsets in Plate (or Plate Config) if wells need alignment.`,
    schemaText: `Assets created: ${p.arenaBmp}.bmp (${cfg.numWells} arenas) + ${zoneBmp}.bmp (${zoneSchemaLabel}).`,
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
    (cfg.stimId === "acoustic_startle" && cfg.sp.audioAmbient === "DARK") ||
    (cfg.stimId === "ppi" && cfg.sp.ppiAmbient === "DARK") ||
    (cfg.stimId === "multi_phase" && cfg.sp.mpAcclimLight === "DARK") ||
    (cfg.stimId === "temp_ramp" && cfg.sp.rampLight === "DARK") ||
    (cfg.stimId === "circadian" && Math.max(0, parseIntOr(cfg.sp.lightHours, 16)) <= 0);

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
    if (cfg.z3RgbMap === "GRB_SHIFT") {
      lines.push("# Z3 RGB Channel Map: Alternate Batch (Ch 1/9=Green, 3/11=Red, 5/13=Blue)");
    }
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
    `    LOAD(ARENAS,"${cfg.arenaBmp || p.arenaBmp}.bmp")`,
    "",
    `    LOGFILE(0,"${sanitizeSlug(`${cfg.runPrefix}_track_check_${p.shortCode || p.id}`, 48)}")`,
    headerBlock,
    "",
    `    VIDEO(VIDEO_LENGTH,"${sanitizeSlug(`${cfg.runPrefix}_track_check_${p.shortCode || p.id}`, 48)}")`,
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

  const pShort = p.shortCode || p.id;
  const step3Tag = sanitizeSlug(`${cfg.runPrefix}_track_check_${pShort}`, 48);
  const fname = `03_${cfg.lastName || "mwp"}_${pShort}.zs`;

  return {
    filename: fname,
    instruction: "<strong>Optional check:</strong> Load animals into the plate and watch Live View (or review the recorded video) to verify that the crosshair stays locked on each organism without background flicker.",
    schemaText: `CSV (${step3Tag}): ${metaHeaders.join(" | ")} | DIST_${cfg.wells[0]} ... DIST_${cfg.wells[cfg.wells.length - 1]}`,
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
  const pShort = p.shortCode || p.id;
  const slotSlug = `${cfg.runPrefix}_${pShort}`;
  const runSlug = buildAssayDataSlug(cfg);

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
  const numZones = Math.min(8, Math.max(1, cfg.numZones || 2));
  const zoneRange = numZones === 1 ? "Z1" : `Z1-${numZones}`;
  if (cfg.useZones) {
    for (const w of cfg.wells) {
      for (let z = 1; z <= numZones; z++) wellHeaders.push(`ZD_${w}_Z${z}`);
    }
    for (const w of cfg.wells) {
      for (let z = 1; z <= numZones; z++) wellHeaders.push(`ZC_${w}_Z${z}`);
    }
    for (const w of cfg.wells) {
      for (let z = 1; z <= numZones; z++) wellHeaders.push(`ZT_${w}_Z${z}`);
    }
    dataExprs.push(
      `ZONE_DISTANCES:${arenaRange} ${zoneRange}`,
      `ZONE_COUNTERS:${arenaRange} ${zoneRange}`,
      `ZONE_TIMERS:${arenaRange} ${zoneRange}`
    );
  }

  if (dataExprs.length === 0) {
    for (const w of cfg.wells) wellHeaders.push(`DIST_${w}`);
    dataExprs.push("ARENA_DISTANCES:*");
  }

  const isCircadian = cfg.stimId === "circadian";
  const hasTrials = ["ld_transitions", "light_off_startle", "light_on_pulse", "vibration_startle", "acoustic_startle", "ppi", "multi_phase", "temp_ramp"].includes(cfg.stimId);
  const activeLightTag = (cfg.ledColorObj && cfg.ledColorObj.tag) ? cfg.ledColorObj.tag : "LIGHT";
  const arenaBmp = cfg.arenaBmp || p.arenaBmp;
  const zoneBmp = cfg.zoneBmp || p.zoneBmp;
  const needZoneBmp = Boolean(cfg.useZones || cfg.useZoneChanges);
  const useStream2 = Boolean(cfg.useZoneChanges);
  const wrapSummaryLog = (logLines) => (useStream2
    ? ["    SET(LOG_STREAM,2)", ...logLines, "    SET(LOG_STREAM,0)"]
    : logLines);

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
      buildSampleAction("SAMPLE_BIN", `RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${lightLabel}|COUNTER1`, dataExprs, useStream2)
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
      buildSampleAction("SAMPLE_LIGHT", `RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${activeLightTag}|COUNTER2|COUNTER1`, dataExprs, useStream2),
      buildSampleAction("SAMPLE_DARK", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:DARK|COUNTER2|COUNTER1", dataExprs, useStream2)
    );

    totalRuntimeSec = acclim + cfg.autorefTimeout + cycles * 2 * phaseBins * bin;
    totalRows = cycles * 2 * phaseBins;

  } else if (cfg.stimId === "light_off_startle") {
    const acclim = Math.max(0, parseIntOr(sp.acclimSec, 0));
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
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
      ...(preBins > 0 ? [`DEFINE BASELINE_BINS ${preBins}`] : []),
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
          ...wrapSummaryLog([
            '    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:STARTLE|COUNTER2|COUNTER1")',
            ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
            "    LOGRUN()"
          ]),
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
        buildSampleAction("SAMPLE_STARTLE", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:STARTLE|COUNTER2|COUNTER1", dataExprs, useStream2)
      );
    }

    if (preBins > 0) {
      extraActions.push(
        buildSampleAction("SAMPLE_BASELINE", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:BASELINE|COUNTER2|COUNTER1", dataExprs, useStream2)
      );
    }
    extraActions.push(
      buildSampleAction("SAMPLE_ITI", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:ITI|COUNTER2|COUNTER1", dataExprs, useStream2)
    );

    totalRuntimeSec = acclim + cfg.autorefTimeout + preBins * bin + pulses * (pulseBins + itiBins) * bin;
    totalRows = preBins + pulses * (pulseBins + itiBins);

  } else if (cfg.stimId === "light_on_pulse") {
    const acclim = Math.max(0, parseIntOr(sp.acclimSec, 0));
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
    const preBins = Math.round(preSec / bin);
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const pulseDur = Math.max(0.05, parseFloat(sp.pulseDurSec) || 1);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiBins = Math.max(1, Math.round(itiSec / bin));
    const strobeHz = [2, 5, 10].includes(parseInt(sp.strobeHz, 10)) ? parseInt(sp.strobeHz, 10) : 0;

    const subBinPulse = pulseDur < bin;
    const pulseBins = subBinPulse ? 1 : Math.max(1, Math.round(pulseDur / bin));
    const postPulseWait = subBinPulse ? Number((bin - pulseDur).toFixed(3)) : 0;

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      ...(preBins > 0 ? [`DEFINE BASELINE_BINS ${preBins}`] : []),
      `DEFINE NUM_PULSES ${pulses}`,
      `DEFINE ITI_BINS ${itiBins}`
    );
    if (strobeHz > 0) {
      const periodSec = Number((1 / strobeHz).toFixed(3));
      const strobeHalfSec = Number((0.5 / strobeHz).toFixed(3));
      if (subBinPulse) {
        const fullCycles = Math.floor((pulseDur + 1e-9) / periodSec);
        const remWait = Math.max(0, Number((bin - pulseDur).toFixed(3)));
        topDefines.push(
          `DEFINE STROBE_HALF_SEC ${strobeHalfSec}  # ${strobeHz} Hz strobe (50% duty)`,
          ...(fullCycles > 0 ? [`DEFINE STROBE_CYCLES ${fullCycles}`] : []),
          `DEFINE POST_PULSE_WAIT ${remWait}`
        );
      } else {
        const fullCyclesPerBin = Math.floor((bin + 1e-9) / periodSec);
        topDefines.push(
          `DEFINE PULSE_BINS ${pulseBins}`,
          `DEFINE STROBE_HALF_SEC ${strobeHalfSec}  # ${strobeHz} Hz strobe (50% duty)`,
          ...(fullCyclesPerBin > 0 ? [`DEFINE STROBE_CYCLES_PER_BIN ${fullCyclesPerBin}`] : [])
        );
      }
    } else if (subBinPulse) {
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

    if (strobeHz > 0) {
      const periodSec = Number((1 / strobeHz).toFixed(3));
      const strobeHalfSec = Number((0.5 / strobeHz).toFixed(3));
      const buildPartialStrobeLines = (remSec) => {
        if (remSec < 0.001) return [];
        if (remSec <= strobeHalfSec + 1e-9) {
          return [
            "    INVOKE(LIGHTS_ON,1)",
            `    WAIT(${remSec})`,
            "    INVOKE(LIGHTS_OFF,1)"
          ];
        }
        const remOff = Number((remSec - strobeHalfSec).toFixed(3));
        return [
          "    INVOKE(LIGHTS_ON,1)",
          "    WAIT(STROBE_HALF_SEC)",
          "    INVOKE(LIGHTS_OFF,1)",
          ...(remOff >= 0.001 ? [`    WAIT(${remOff})`] : [])
        ];
      };
      const strobeCycleAction = [
        "ACTION STROBE_CYCLE",
        "",
        "    INVOKE(LIGHTS_ON,1)",
        "    WAIT(STROBE_HALF_SEC)",
        "    INVOKE(LIGHTS_OFF,1)",
        "    WAIT(STROBE_HALF_SEC)",
        "",
        "COMPLETE"
      ].join("\n");

      if (subBinPulse) {
        const fullCycles = Math.floor((pulseDur + 1e-9) / periodSec);
        const remPulseSec = Number((pulseDur - fullCycles * periodSec).toFixed(3));
        const remWait = Math.max(0, Number((bin - pulseDur).toFixed(3)));
        const remPulseLines = buildPartialStrobeLines(remPulseSec);
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
            `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay(activeLightTag + " " + strobeHz + "HZ")}")`,
            ...(fullCycles > 0 ? ["    INVOKE(STROBE_CYCLE,STROBE_CYCLES)"] : []),
            ...remPulseLines,
            ...(remWait > 0 ? ["    WAIT(POST_PULSE_WAIT)"] : []),
            '    LOGDATA(DATA_SNAPSHOT,"end")',
            '    LOGDATA(DATA_SELECT,"begin")',
            '    LOGDATA(DATA_DELTA,"end")',
            "",
            ...wrapSummaryLog([
              `    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${activeLightTag}_${strobeHz}HZ|COUNTER2|COUNTER1")`,
              ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
              "    LOGRUN()"
            ]),
            "",
            "COMPLETE"
          ].join("\n"),
          ...(fullCycles > 0 ? [strobeCycleAction] : [])
        );
      } else {
        const fullCyclesPerBin = Math.floor((bin + 1e-9) / periodSec);
        const remBinSec = Number((bin - fullCyclesPerBin * periodSec).toFixed(3));
        const remBinLines = buildPartialStrobeLines(remBinSec);
        extraActions.push(
          [
            "ACTION FLASH_TRIAL",
            "",
            "    SET(COUNTER2,COUNTER_INC)",
            `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay(activeLightTag + " " + strobeHz + "HZ")}")`,
            "    INVOKE(SAMPLE_FLASH,PULSE_BINS)",
            "    INVOKE(LIGHTS_OFF,1)",
            `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("DARK ITI")}")`,
            "    INVOKE(SAMPLE_ITI,ITI_BINS)",
            "",
            "COMPLETE",
            "",
            "ACTION SAMPLE_FLASH",
            "",
            "    SET(COUNTER1,COUNTER_INC)",
            '    LOGDATA(DATA_SNAPSHOT,"begin")',
            ...(fullCyclesPerBin > 0 ? ["    INVOKE(STROBE_CYCLE,STROBE_CYCLES_PER_BIN)"] : []),
            ...remBinLines,
            '    LOGDATA(DATA_SNAPSHOT,"end")',
            '    LOGDATA(DATA_SELECT,"begin")',
            '    LOGDATA(DATA_DELTA,"end")',
            "",
            ...wrapSummaryLog([
              `    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${activeLightTag}_${strobeHz}HZ|COUNTER2|COUNTER1")`,
              ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
              "    LOGRUN()"
            ]),
            "",
            "COMPLETE"
          ].join("\n"),
          ...(fullCyclesPerBin > 0 ? [strobeCycleAction] : [])
        );
      }
    } else if (subBinPulse) {
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
          ...wrapSummaryLog([
            `    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${activeLightTag}_FLASH|COUNTER2|COUNTER1")`,
            ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
            "    LOGRUN()"
          ]),
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
        buildSampleAction("SAMPLE_FLASH", `RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${activeLightTag}_FLASH|COUNTER2|COUNTER1`, dataExprs, useStream2)
      );
    }

    if (preBins > 0) {
      extraActions.push(
        buildSampleAction("SAMPLE_BASELINE", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:BASELINE|COUNTER2|COUNTER1", dataExprs, useStream2)
      );
    }
    extraActions.push(
      buildSampleAction("SAMPLE_ITI", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:ITI|COUNTER2|COUNTER1", dataExprs, useStream2)
    );

    totalRuntimeSec = acclim + cfg.autorefTimeout + preBins * bin + pulses * (pulseBins + itiBins) * bin;
    totalRows = preBins + pulses * (pulseBins + itiBins);

  } else if (cfg.stimId === "vibration_startle") {
    const acclim = Math.max(0, parseIntOr(sp.acclimSec, 0));
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
    const preBins = Math.round(preSec / bin);
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiBins = Math.max(1, Math.round(itiSec / bin));
    const stepMode = sp.vibIntensity || "U0";
    const ambientAction = sp.vibAmbient === "LIGHT" ? "LIGHTS_ON" : "LIGHTS_OFF";

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      ...(preBins > 0 ? [`DEFINE BASELINE_BINS ${preBins}`] : []),
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
        ...wrapSummaryLog([
          '    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:VIBRATION|COUNTER2|COUNTER1")',
          ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
          "    LOGRUN()"
        ]),
        "",
        "COMPLETE"
      ].join("\n")
    );
    if (preBins > 0) {
      extraActions.push(
        buildSampleAction("SAMPLE_BASELINE", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:BASELINE|COUNTER2|COUNTER1", dataExprs, useStream2)
      );
    }
    extraActions.push(
      buildSampleAction("SAMPLE_ITI", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:ITI|COUNTER2|COUNTER1", dataExprs, useStream2)
    );

    totalRuntimeSec = acclim + cfg.autorefTimeout + preBins * bin + pulses * (1 + itiBins) * bin;
    totalRows = preBins + pulses * (1 + itiBins);

  } else if (cfg.stimId === "acoustic_startle") {
    const acclim = Math.max(0, parseIntOr(sp.acclimSec, 0));
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
    const preBins = Math.round(preSec / bin);
    const pulses = Math.max(1, parseInt(sp.numPulses, 10) || 5);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiBins = Math.max(1, Math.round(itiSec / bin));
    const audioAsset = sp.audioFile === "custom"
      ? sanitizeAudioAsset(sp.audioCustomFile || "stereo.wav")
      : sanitizeAudioAsset(sp.audioFile || "tone");
    const ambientAction = sp.audioAmbient === "LIGHT" ? "LIGHTS_ON" : "LIGHTS_OFF";

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      ...(preBins > 0 ? [`DEFINE BASELINE_BINS ${preBins}`] : []),
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
    mainSchedule.push("    INVOKE(AUDIO_TRIAL,NUM_PULSES)");

    extraActions.push(
      [
        "ACTION AUDIO_TRIAL",
        "",
        "    SET(COUNTER2,COUNTER_INC)",
        "    INVOKE(AUDIO_PULSE,1)",
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("POST-AUDIO ITI")}")`,
        "    INVOKE(SAMPLE_ITI,ITI_BINS)",
        "",
        "COMPLETE",
        "",
        "ACTION AUDIO_PULSE",
        "",
        "    SET(COUNTER1,COUNTER_INC)",
        '    LOGDATA(DATA_SNAPSHOT,"begin")',
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("AUDIO " + audioAsset.toUpperCase())}")`,
        `    LOAD(AUDIO_FILE,"${audioAsset}")`,
        "    WAIT(TIME_BIN)",
        '    LOGDATA(DATA_SNAPSHOT,"end")',
        '    LOGDATA(DATA_SELECT,"begin")',
        '    LOGDATA(DATA_DELTA,"end")',
        "",
        ...wrapSummaryLog([
          '    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:AUDIO_PULSE|COUNTER2|COUNTER1")',
          ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
          "    LOGRUN()"
        ]),
        "",
        "COMPLETE"
      ].join("\n")
    );
    if (preBins > 0) {
      extraActions.push(
        buildSampleAction("SAMPLE_BASELINE", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:BASELINE|COUNTER2|COUNTER1", dataExprs, useStream2)
      );
    }
    extraActions.push(
      buildSampleAction("SAMPLE_ITI", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:ITI|COUNTER2|COUNTER1", dataExprs, useStream2)
    );

    totalRuntimeSec = acclim + cfg.autorefTimeout + preBins * bin + pulses * (1 + itiBins) * bin;
    totalRows = preBins + pulses * (1 + itiBins);

  } else if (cfg.stimId === "ppi") {
    const acclim = Math.max(0, parseIntOr(sp.acclimSec, 0));
    const bin = Math.max(1, parseFloat(sp.timeBinSec) || 1);
    const preSec = Math.max(0, parseIntOr(sp.preBaselineSec, 60));
    const preBins = Math.round(preSec / bin);
    const pairs = Math.max(1, parseInt(sp.ppiPairs, 10) || 5);
    const itiSec = Math.max(bin, parseInt(sp.itiSec, 10) || 30);
    const itiBins = Math.max(1, Math.round(itiSec / bin));
    const prepulse = vibLevelToCode(sp.ppiPrepulse || "U3");
    const pulse = vibLevelToCode(sp.ppiPulse || "U0");
    const isiMs = Math.min(2000, Math.max(50, parseInt(sp.ppiIsiMs, 10) || 300));
    const isAlt = (sp.ppiPattern || "alternating") === "alternating";
    const ambientAction = sp.ppiAmbient === "LIGHT" ? "LIGHTS_ON" : "LIGHTS_OFF";
    const totalTrials = isAlt ? pairs * 2 : pairs;

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      ...(preBins > 0 ? [`DEFINE BASELINE_BINS ${preBins}`] : []),
      `DEFINE NUM_BLOCKS ${pairs}  # ${isAlt ? "Alternating Pulse-Alone + PPI pairs" : "PPI trials only"} (ISI=${isiMs}ms)`,
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
    mainSchedule.push("    INVOKE(PPI_BLOCK,NUM_BLOCKS)");

    const blockBody = isAlt
      ? [
          "ACTION PPI_BLOCK",
          "",
          "    SET(COUNTER2,COUNTER_INC)",
          "    INVOKE(PULSE_ALONE_BIN,1)",
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("POST-PULSE ITI")}")`,
          "    INVOKE(SAMPLE_ITI,ITI_BINS)",
          "",
          "    SET(COUNTER2,COUNTER_INC)",
          "    INVOKE(PPI_PULSE_BIN,1)",
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("POST-PPI ITI")}")`,
          "    INVOKE(SAMPLE_ITI,ITI_BINS)",
          "",
          "COMPLETE"
        ].join("\n")
      : [
          "ACTION PPI_BLOCK",
          "",
          "    SET(COUNTER2,COUNTER_INC)",
          "    INVOKE(PPI_PULSE_BIN,1)",
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("POST-PPI ITI")}")`,
          "    INVOKE(SAMPLE_ITI,ITI_BINS)",
          "",
          "COMPLETE"
        ].join("\n");

    extraActions.push(blockBody);
    if (isAlt) {
      extraActions.push(
        [
          "ACTION PULSE_ALONE_BIN",
          "",
          "    SET(COUNTER1,COUNTER_INC)",
          '    LOGDATA(DATA_SNAPSHOT,"begin")',
          `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("PULSE ALONE " + pulse)}")`,
          `    ZCOMMAND("${pulse} D1190 M1 M-1 M1 M-1")`,
          "    WAIT(TIME_BIN)",
          '    LOGDATA(DATA_SNAPSHOT,"end")',
          '    LOGDATA(DATA_SELECT,"begin")',
          '    LOGDATA(DATA_DELTA,"end")',
          "",
          ...wrapSummaryLog([
            '    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:PULSE_ALONE|COUNTER2|COUNTER1")',
            ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
            "    LOGRUN()"
          ]),
          "",
          "COMPLETE"
        ].join("\n")
      );
    }
    extraActions.push(
      [
        "ACTION PPI_PULSE_BIN",
        "",
        "    SET(COUNTER1,COUNTER_INC)",
        '    LOGDATA(DATA_SNAPSHOT,"begin")',
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay(`PPI ${prepulse}+${isiMs}ms+${pulse}`)}")`,
        `    ZCOMMAND("${prepulse} D1190 M1 M-1 M1 M-1 P${isiMs} ${pulse} D1190 M1 M-1 M1 M-1")`,
        "    WAIT(TIME_BIN)",
        '    LOGDATA(DATA_SNAPSHOT,"end")',
        '    LOGDATA(DATA_SELECT,"begin")',
        '    LOGDATA(DATA_DELTA,"end")',
        "",
        ...wrapSummaryLog([
          '    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:PPI_TRIAL|COUNTER2|COUNTER1")',
          ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
          "    LOGRUN()"
        ]),
        "",
        "COMPLETE"
      ].join("\n")
    );
    if (preBins > 0) {
      extraActions.push(
        buildSampleAction("SAMPLE_BASELINE", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:BASELINE|COUNTER2|COUNTER1", dataExprs, useStream2)
      );
    }
    extraActions.push(
      buildSampleAction("SAMPLE_ITI", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:ITI|COUNTER2|COUNTER1", dataExprs, useStream2)
    );

    totalRuntimeSec = acclim + cfg.autorefTimeout + preBins * bin + totalTrials * (1 + itiBins) * bin;
    totalRows = preBins + totalTrials * (1 + itiBins);

  } else if (cfg.stimId === "circadian") {
    const bin = Math.max(1, parseInt(sp.circBinSec, 10) || 10);
    const lightHrs = Math.max(0, parseIntOr(sp.lightHours, 16));
    const darkHrs = Math.max(0, parseIntOr(sp.darkHours, 8));
    const days = Math.max(1, parseInt(sp.numDays, 10) || 2);
    const rampMin = cfg.hw === "Z3" ? Math.min(30, Math.max(0, parseIntOr(sp.circRampMin, 0))) : 0;
    const hasDawnDusk = rampMin > 0 && lightHrs > 0 && darkHrs > 0;
    const hasAnyHours = (lightHrs + darkHrs) > 0;
    const rampStepBins = hasDawnDusk ? Math.max(1, Math.round((rampMin * 60) / (6 * bin))) : 0;
    const autoref = 300;
    const activeSecPerHour = Math.max(bin * 2, 3600 - autoref);
    const halfBins = Math.max(1, Math.floor(activeSecPerHour / (2 * bin)));

    topDefines.push(
      `DEFINE TIME_BIN ${bin}`,
      `DEFINE HALF_HOUR_BINS ${halfBins}  # 2 x ${halfBins} x ${bin}s + ${autoref}s autoref = ~1 hour`,
      ...(lightHrs > 0 ? [`DEFINE LIGHT_HOURS ${lightHrs}`] : []),
      ...(darkHrs > 0 ? [`DEFINE DARK_HOURS ${darkHrs}`] : []),
      ...(hasAnyHours ? [`DEFINE NUM_DAYS ${days}`] : [])
    );
    if (hasDawnDusk) {
      topDefines.push(`DEFINE RAMP_STEP_BINS ${rampStepBins}  # 6 PWM steps x ${rampStepBins} x ${bin}s = ~${rampMin} min Dawn/Dusk`);
    }
    if (hasAnyHours) {
      topDefines.push(
        "DEFINE DAY_VAR 100",
        "DEFINE HOUR_VAR 101",
        "DEFINE PHASE_VAR 102"
      );
    }

    const initLightAction = lightHrs > 0 ? "LIGHTS_ON" : "LIGHTS_OFF";
    if (hasAnyHours) {
      mainSchedule.push(
        "    @DAY_VAR = 0",
        `    INVOKE(${initLightAction},1)`,
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("AUTOREFERENCING")}")`,
        "    AUTOREFERENCE()",
        "__START_RECORDING__",
        "    INVOKE(RUN_DAY,NUM_DAYS)"
      );
    } else {
      mainSchedule.push(
        "    INVOKE(LIGHTS_OFF,1)",
        `    LOAD(OVERLAY_TEXT,"1,1:${padOverlay("AUTOREFERENCING")}")`,
        "    AUTOREFERENCE()",
        "__START_RECORDING__",
        "    # Both Light Hours and Dark Hours are 0; set at least one phase >= 1h to record data."
      );
    }

    if (hasAnyHours) {
      const dayLines = [
        "ACTION RUN_DAY",
        "",
        "    @DAY_VAR = @DAY_VAR + 1"
      ];
      if (lightHrs > 0) {
        if (hasDawnDusk) {
          dayLines.push(
            "    @HOUR_VAR = 0",
            "    INVOKE(DAWN_RAMP,1)"
          );
        }
        dayLines.push(
          "    @HOUR_VAR = 1",
          "    @PHASE_VAR = 1",
          "    INVOKE(LIGHTS_ON,1)",
          "    INVOKE(RUN_HOUR,LIGHT_HOURS)"
        );
      }
      if (darkHrs > 0) {
        if (hasDawnDusk) {
          dayLines.push(
            "    @HOUR_VAR = 0",
            "    INVOKE(DUSK_RAMP,1)"
          );
        }
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
          ...wrapSummaryLog([
            "    IF @PHASE_VAR = 1",
            `        LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${activeLightTag}|@100|@101|COUNTER1")`,
            "    ELSE",
            '        LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:DARK|@100|@101|COUNTER1")',
            "    ENDIF",
            ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
            "    LOGRUN()"
          ]),
          "",
          "COMPLETE"
        ].join("\n")
      );
    }

    if (hasDawnDusk) {
      const col = cfg.ledColorObj || LED_COLORS.WHITE;
      const buildCircPwmLines = (frac) => {
        const pwm = Math.round(cfg.ledDriveVal * frac);
        const lns = [
          cfg.useTopLight ? `    SET(X_LED_DRIVE,${col.z3Over},${pwm})` : `    SET(X_LED_DRIVE,${col.z3Over},0)`
        ];
        if (cfg.useUnderLight) {
          lns.push(`    SET(X_LED_DRIVE,${col.z3Under},${pwm})`);
        }
        lns.push(...buildZ3PortGateLines(col.id, cfg.useTopLight, cfg.useUnderLight, pwm > 0));
        return lns;
      };
      const buildRampAction = (actName, overlayLabel, sampleAct, fracs) => {
        const lns = [
          `ACTION ${actName}`,
          "",
          `    LOAD(OVERLAY_TEXT,"1,1:DAY @100 ${overlayLabel}")`
        ];
        for (const frac of fracs) {
          lns.push(...buildCircPwmLines(frac), `    INVOKE(${sampleAct},RAMP_STEP_BINS)`);
        }
        lns.push("", "COMPLETE");
        return lns.join("\n");
      };
      const isGammaCirc = sp.circRampCurve !== "linear";
      const dawnFracs = isGammaCirc ? [0.02, 0.08, 0.22, 0.44, 0.72, 1.0] : [0.15, 0.30, 0.50, 0.65, 0.85, 1.0];
      const duskFracs = isGammaCirc ? [0.72, 0.44, 0.22, 0.08, 0.02, 0.0] : [0.85, 0.65, 0.50, 0.30, 0.15, 0.0];
      extraActions.push(
        buildRampAction("DAWN_RAMP", "DAWN RAMP     ", "SAMPLE_DAWN", dawnFracs),
        buildRampAction("DUSK_RAMP", "DUSK RAMP     ", "SAMPLE_DUSK", duskFracs),
        buildSampleAction("SAMPLE_DAWN", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:DAWN|@100|@101|COUNTER1", dataExprs, useStream2),
        buildSampleAction("SAMPLE_DUSK", "RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:DUSK|@100|@101|COUNTER1", dataExprs, useStream2)
      );
    }

    const hrsTotal = days * (lightHrs + darkHrs);
    const rampExtraBins = hasDawnDusk ? days * 12 * rampStepBins : 0;
    totalRuntimeSec = autoref + hrsTotal * (2 * halfBins * bin + autoref) + rampExtraBins * bin;
    totalRows = hrsTotal * 2 * halfBins + rampExtraBins;

  } else if (cfg.stimId === "multi_phase") {
    const acclim = Math.max(0, parseInt(sp.acclimSec, 10) || 0);
    const cycles = Math.max(1, parseInt(sp.mpCycles, 10) || 1);
    const acclimLight = sp.mpAcclimLight || "DARK";
    const comp = compileMultiTrackSlices(cfg.timelineClips, sp.mpTimelineSec, sp.timeBinSec, cfg.thermostatTemp);
    const bin = comp.bin;

    const gcdInt = (a, b) => (b === 0 ? a : gcdInt(b, a % b));
    const lcmInt = (a, b) => (a && b ? Math.round((a / gcdInt(a, b)) * b) : 0);
    const getStrobeSchedule = (sl) => {
      const hzList = (sl.strobeHzList && sl.strobeHzList.length)
        ? sl.strobeHzList
        : (sl.strobeHz > 0 ? [sl.strobeHz] : []);
      if (hzList.length === 0) return null;
      const periodMs = hzList.reduce((acc, f) => lcmInt(acc, Math.round(1000 / f)), 1);
      const periodSec = Number((periodMs / 1000).toFixed(3));
      const fullCycles = Math.floor((bin + 1e-9) / periodSec);
      const remSec = Number((bin - fullCycles * periodSec).toFixed(3));
      return {
        hzList,
        isMultiFreq: hzList.length > 1,
        periodMs,
        periodSec,
        halfSec: hzList.length === 1 ? Number((0.5 / hzList[0]).toFixed(3)) : null,
        fullCycles,
        remSec: remSec >= 0.001 ? remSec : 0
      };
    };
    const buildStrobeIntervalLines = (sl, hzList, spanSec, manageBot, endSteadyTop, endSteadyBot, ensureSteadyEnd) => {
      const spanMs = Math.round(spanSec * 1000);
      if (spanMs <= 0) return [];
      const edgeSet = new Set([0, spanMs]);
      for (const f of hzList) {
        const halfMs = Math.round(500 / f);
        for (let tMs = halfMs; tMs < spanMs; tMs += halfMs) edgeSet.add(tMs);
      }
      const edges = [...edgeSet].sort((a, b) => a - b);
      const segs = [];
      for (let i = 0; i < edges.length - 1; i++) {
        const durMs = edges[i + 1] - edges[i];
        if (durMs <= 0) continue;
        const midMs = (edges[i] + edges[i + 1]) / 2;
        const isLit = (l) => (!l.strobeHz || (Math.floor((midMs + 1e-9) / Math.round(500 / l.strobeHz)) % 2 === 0));
        const top = sl.topLights.filter(isLit);
        const bot = sl.bottomLights.filter(isLit);
        const lightLines = buildSliceLightLines(cfg, top, bot, manageBot);
        const key = lightLines.join("\n");
        const prev = segs[segs.length - 1];
        if (prev && prev.key === key) {
          prev.durMs += durMs;
        } else {
          segs.push({ key, lightLines, durMs });
        }
      }
      const out = [];
      for (const seg of segs) {
        const dtSec = Number((seg.durMs / 1000).toFixed(3));
        out.push(...seg.lightLines, `    WAIT(${dtSec})`);
      }
      if (ensureSteadyEnd && segs.length > 0) {
        const steadyLines = buildSliceLightLines(cfg, endSteadyTop, endSteadyBot, manageBot);
        if (segs[segs.length - 1].key !== steadyLines.join("\n")) {
          out.push(...steadyLines);
        }
      }
      return out;
    };

    topDefines.push(
      `DEFINE ACCLIMATION_SEC ${acclim}`,
      `DEFINE TIME_BIN ${bin}`,
      `DEFINE NUM_CYCLES ${cycles}`
    );
    const sliceStrobeSchedules = new Map();
    for (const sl of comp.slices) {
      topDefines.push(`DEFINE S${sl.idx}_BINS ${sl.bins}  # ${sl.startSec}s-${sl.endSec}s (${sl.csvTag})`);
      const sched = getStrobeSchedule(sl);
      if (sched) {
        sliceStrobeSchedules.set(sl.idx, sched);
        if (!sched.isMultiFreq) {
          topDefines.push(`DEFINE S${sl.idx}_STROBE_HALF ${sched.halfSec}  # ${sched.hzList[0]} Hz strobe`);
          if (sched.fullCycles > 0) {
            topDefines.push(`DEFINE S${sl.idx}_STROBE_CYCLES ${sched.fullCycles}`);
          }
        } else if (sched.fullCycles > 0) {
          topDefines.push(
            `DEFINE S${sl.idx}_STROBE_CYCLES ${sched.fullCycles}  # ${sched.hzList.join("+")} Hz multi-strobe (${sched.periodSec}s LCM period)`
          );
        }
      }
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
      const sched = sliceStrobeSchedules.get(sl.idx) || null;
      const isStrobeSlice = Boolean(sched);
      const steadyTop = isStrobeSlice ? sl.topLights.filter(l => !l.strobeHz) : sl.topLights;
      const steadyBot = isStrobeSlice ? sl.bottomLights.filter(l => !l.strobeHz) : sl.bottomLights;
      const triggerLines = [];
      if (sl.vibTrigger) {
        triggerLines.push(`    ZCOMMAND("${sl.vibCode} D1000 M1 M-1 M1 M-1 M1 M-1 M1 M-1 M1 M-1")`);
      }
      if (sl.audioTrigger) {
        triggerLines.push(`    LOAD(AUDIO_FILE,"${sl.audioFile}")`);
      }
      const runLines = [
        `ACTION RUN_S${sl.idx}`,
        "",
        ...buildSliceLightLines(cfg, steadyTop, steadyBot, manageBottom)
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

      if (isStrobeSlice) {
        const remLines = sched.remSec >= 0.001
          ? buildStrobeIntervalLines(sl, sched.hzList, sched.remSec, manageBottom, steadyTop, steadyBot, true)
          : [];
        const sampleStrobeAction = [
          `ACTION SAMPLE_S${sl.idx}`,
          "",
          "    SET(COUNTER1,COUNTER_INC)",
          '    LOGDATA(DATA_SNAPSHOT,"begin")',
          ...triggerLines,
          ...(sched.fullCycles > 0 ? [`    INVOKE(STROBE_S${sl.idx},S${sl.idx}_STROBE_CYCLES)`] : []),
          ...remLines,
          '    LOGDATA(DATA_SNAPSHOT,"end")',
          '    LOGDATA(DATA_SELECT,"begin")',
          '    LOGDATA(DATA_DELTA,"end")',
          "",
          ...wrapSummaryLog([
            `    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${sl.csvTag}|COUNTER2|COUNTER1")`,
            ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
            "    LOGRUN()"
          ]),
          "",
          "COMPLETE"
        ].join("\n");
        const actionsToPush = [runLines.join("\n"), sampleStrobeAction];
        if (sched.fullCycles > 0) {
          const strobeBody = !sched.isMultiFreq
            ? [
                ...buildSliceLightLines(cfg, sl.topLights, sl.bottomLights, manageBottom),
                `    WAIT(S${sl.idx}_STROBE_HALF)`,
                ...buildSliceLightLines(cfg, steadyTop, steadyBot, manageBottom),
                `    WAIT(S${sl.idx}_STROBE_HALF)`
              ]
            : buildStrobeIntervalLines(sl, sched.hzList, sched.periodSec, manageBottom, steadyTop, steadyBot, false);
          const strobeHelperAction = [
            `ACTION STROBE_S${sl.idx}`,
            "",
            ...strobeBody,
            "",
            "COMPLETE"
          ].join("\n");
          actionsToPush.push(strobeHelperAction);
        }
        extraActions.push(...actionsToPush);
      } else if (triggerLines.length > 0) {
        const sampleTriggerAction = [
          `ACTION SAMPLE_S${sl.idx}`,
          "",
          "    SET(COUNTER1,COUNTER_INC)",
          '    LOGDATA(DATA_SNAPSHOT,"begin")',
          ...triggerLines,
          "    WAIT(TIME_BIN)",
          '    LOGDATA(DATA_SNAPSHOT,"end")',
          '    LOGDATA(DATA_SELECT,"begin")',
          '    LOGDATA(DATA_DELTA,"end")',
          "",
          ...wrapSummaryLog([
            `    LOGCREATE("RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${sl.csvTag}|COUNTER2|COUNTER1")`,
            ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
            "    LOGRUN()"
          ]),
          "",
          "COMPLETE"
        ].join("\n");
        extraActions.push(runLines.join("\n"), sampleTriggerAction);
      } else {
        extraActions.push(
          runLines.join("\n"),
          buildSampleAction(`SAMPLE_S${sl.idx}`, `RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:${sl.csvTag}|COUNTER2|COUNTER1`, dataExprs, useStream2)
        );
      }
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
        buildSampleAction(`SAMPLE_T${sNum}`, `RUNTIME|APPARATUS_ID|TEMPERATURE1|TEXT:TEMP_${t}C|COUNTER2|COUNTER1`, dataExprs, useStream2)
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
    `# Required asset(s) in unit Assets folder: "${arenaBmp}.bmp"${needZoneBmp ? ` and "${zoneBmp}.bmp"` : ""}`,
    "",
    ...topDefines
  );

  if (cfg.videoMode !== "off") {
    out.push("DEFINE VIDEO_LENGTH 999999999");
  }
  if (cfg.hw === "Z3") {
    out.push("DEFINE X_LED_DRIVE 30039");
    out.push(`DEFINE LED_BRIGHTNESS ${cfg.ledDriveVal}`);
    if (cfg.z3RgbMap === "GRB_SHIFT") {
      out.push("# Z3 RGB Channel Map: Alternate Batch (Ch 1/9=Green, 3/11=Red, 5/13=Blue)");
    }
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
  if (useStream2) {
    out.push(
      "",
      `LOGFILE(2,"${runSlug}")`
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
    out.push(`    SET(COLOURMAP,${cfg.heatmapPalette})`);
  }

  out.push(`    LOAD(ARENAS,"${arenaBmp}.bmp")`);
  if (needZoneBmp) {
    out.push(`    LOAD(ZONES,"${zoneBmp}.bmp")`);
  }

  if (useStream2) {
    out.push(
      "",
      `    LOGFILE(0,"${runSlug}_ZCHANGE")`,
      "    INVOKE(SETUP_ZCHANGE_HEADERS,1)",
      "    SET(LOG_STREAM,2)",
      "    INVOKE(SETUP_HEADERS,1)",
      "    SET(LOG_STREAM,0)"
    );
  } else {
    out.push(
      "",
      `    LOGFILE(0,"${runSlug}")`,
      "    INVOKE(SETUP_HEADERS,1)"
    );
  }

  if (cfg.useXy) {
    out.push(
      "    SET(LOG_STREAM,1)",
      "    INVOKE(SETUP_XY_HEADERS,1)",
      "    SET(LOG_STREAM,0)"
    );
  }

  out.push("");

  const recStartLines = [];
  if (cfg.usePicture) {
    recStartLines.push(`    PICTURE("${runSlug}_start")`);
  }
  if (cfg.useTracks) {
    recStartLines.push(
      "    SET(X_DRAWTRACKS,1)",
      `    SET(X_TRACKTIME,${cfg.trackTimeSec})`
    );
  }
  if (cfg.videoMode === "dual") {
    recStartLines.push(
      "    SET(VIDEO_STREAM,0)",
      `    VIDEO(VIDEO_LENGTH,"${runSlug}_30fps")`,
      "    VIDEOSKIP(0)",
      "    SET(VIDEO_STREAM,1)",
      `    VIDEO(VIDEO_LENGTH,"${runSlug}_1fps")`,
      "    VIDEOSKIP(29)",
      "    SET(VIDEO_STREAM,0)"
    );
  } else if (cfg.videoMode !== "off") {
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
  if (useStream2) {
    recStartLines.push('    LOAD(ZONECHANGES,"ON")');
  }

  for (const line of mainSchedule) {
    if (line === "__START_RECORDING__") {
      if (recStartLines.length) out.push(...recStartLines);
    } else {
      out.push(line);
    }
  }

  out.push("");
  if (useStream2) {
    out.push('    LOAD(ZONECHANGES,"OFF")');
  }
  if (cfg.useXy) {
    out.push("    SET(LOG_PERFRAME,OFF)");
  }
  if (cfg.useHeatmap) {
    out.push("    SET(MAKEMAP,20)");
  }
  if (cfg.usePicture) {
    out.push(`    PICTURE("${runSlug}_end")`);
  }
  if (cfg.videoMode === "dual") {
    out.push(
      "    SET(VIDEO_STREAM,0)",
      "    VIDEOSTOP",
      "    SET(VIDEO_STREAM,1)",
      "    VIDEOSTOP",
      "    SET(VIDEO_STREAM,0)"
    );
  } else if (cfg.videoMode !== "off") {
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

  if (useStream2) {
    out.push(
      "ACTION SETUP_ZCHANGE_HEADERS",
      "",
      '    LOGCREATE("TEXT:TIME|TEXT:|TEXT:")',
      '    LOGAPPEND("TEXT:ARENA|TEXT:ACTION|TEXT:ZONE")',
      "    LOGRUN()",
      "",
      "COMPLETE",
      ""
    );
  }

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
    metricSummaryParts.push(`ZD/ZC/ZT_${firstWell}_Z1..Z${numZones}`);
  }
  let schemaDesc = `Summary CSV (${runSlug}): ${metaHeaders.join(" | ")} | ${metricSummaryParts.join(" | ")}`;
  if (cfg.useXy) {
    schemaDesc += `  +  XY CSV (${runSlug}_XY): RUNTIME | X_${firstWell} | Y_${firstWell} ...`;
  }
  if (useStream2) {
    schemaDesc += `  +  Zone Events (${runSlug}_ZCHANGE): TIME | ARENA | ACTION | ZONE`;
  }

  const csvCount = 1 + (cfg.useXy ? 1 : 0) + (useStream2 ? 1 : 0);

  return {
    filename: `04_${slotSlug}.zs`,
    bundleFolder: runSlug,
    instruction: `<strong>Main experiment:</strong> Confirm <code>${arenaBmp}.bmp</code>${needZoneBmp ? ` and <code>${zoneBmp}.bmp</code>` : ""} exist in Assets, load your ${p.name} ${cfg.isMaze ? "maze" : "plate"} with organisms, and click <strong>Run</strong>.`,
    schemaText: schemaDesc,
    code: out.join("\n"),
    totalRuntimeSec,
    totalRows,
    csvCount
  };
}

function buildSampleAction(name, logCreateStr, dataExprs, useStream2) {
  const logBlock = [
    `    LOGCREATE("${logCreateStr}")`,
    ...dataExprs.map(d => `    LOGAPPEND("${d}")`),
    "    LOGRUN()"
  ];
  const wrappedLog = useStream2
    ? ["    SET(LOG_STREAM,2)", ...logBlock, "    SET(LOG_STREAM,0)"]
    : logBlock;

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
    ...wrappedLog,
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

  const arenaBmp = cfg.arenaBmp || cfg.plate.arenaBmp;
  const zoneBmp = cfg.zoneBmp || cfg.plate.zoneBmp;
  const plateFormatLine = cfg.isMaze
    ? `Plate Format     : ${cfg.plate.name} (${cfg.numWells} arena(s), ${cfg.numZones} zone(s))`
    : `Plate Format     : ${cfg.plate.name} (${cfg.plate.rows} x ${cfg.plate.cols}, ${cfg.numWells} arena(s))`;
  const plateGeoLine = cfg.isMaze
    ? `Maze Geometry    : ${(cfg.mazeShapes || []).length} shape(s) in mm (${arenaBmp}.bmp / ${zoneBmp}.bmp)`
    : `Plate Geometry   : X_OFFSET=${g.xOffset}, Y_OFFSET=${g.yOffset}, COL_STEP=${g.colStep}, ROW_STEP=${g.rowStep}, ${sizeKey}=${g.r}, INNER_ZONE=${g.rDz} mm`;

  const readme = [
    "ZANTIKS MWP EXPERIMENT BUNDLE",
    "=============================",
    `Researcher       : ${researcherInfo}`,
    `Study Tag        : ${cfg.expTag || "(none)"}`,
    plateFormatLine,
    `Config Profile   : ${state.profileName || "Default"}`,
    plateGeoLine,
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
    `   - Run ONCE with an EMPTY ${cfg.plate.name} ${cfg.isMaze ? "maze" : "plate"}.`,
    `   - Generates "${arenaBmp}.bmp" and "${zoneBmp}.bmp" inside the unit's Assets directory.`,
    "",
    `3. ${s3.filename} (Optional)`,
    "   - Run with organisms loaded to check TARGET_SIZE and DETECTOR_THRESHOLD on Live View.",
    "",
    `4. ${s4.filename}`,
    "   - Main assay script. Load your experimental plate, build, and run.",
    `   - Slot name for Settings -> Slots (1-20): "${s4.filename.replace(/\.zs$/, "")}" (link once; rebuilding updates it in place).`,
    `   - Exported CSV & video files are tagged automatically via LOGFILE(0,"${s4.bundleFolder}").`,
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
