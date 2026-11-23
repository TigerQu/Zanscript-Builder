// Zantiks MWP Script Builder - Built-in MWP Mazes & Custom 3D-Printed Maze Canvas Editor
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

const SBS_PLATE_W_MM = 127.8;
const SBS_PLATE_H_MM = 85.5;

const MAZE_ZONE_PALETTE = [
  { fill: "rgba(9, 105, 218, 0.22)",  stroke: "#0969da", text: "#0550ae" }, // Z1 Blue
  { fill: "rgba(26, 127, 55, 0.22)",  stroke: "#1a7f37", text: "#116329" }, // Z2 Green
  { fill: "rgba(191, 135, 0, 0.24)",  stroke: "#9a6700", text: "#7d4e00" }, // Z3 Amber
  { fill: "rgba(130, 80, 223, 0.22)", stroke: "#8250df", text: "#6639ba" }, // Z4 Purple
  { fill: "rgba(207, 34, 46, 0.20)",  stroke: "#cf222e", text: "#a40e26" }, // Z5 Red
  { fill: "rgba(6, 148, 162, 0.22)",  stroke: "#0e7490", text: "#155e75" }, // Z6 Teal
  { fill: "rgba(219, 39, 119, 0.20)", stroke: "#be185d", text: "#9d174d" }, // Z7 Pink
  { fill: "rgba(71, 85, 105, 0.22)",  stroke: "#475569", text: "#334155" }  // Z8 Slate
];

const MAZE_ARENA_PALETTE = [
  { fill: "rgba(9, 105, 218, 0.20)",  stroke: "#0969da", text: "#0550ae" },
  { fill: "rgba(26, 127, 55, 0.20)",  stroke: "#1a7f37", text: "#116329" },
  { fill: "rgba(217, 119, 6, 0.22)",  stroke: "#b45309", text: "#92400e" },
  { fill: "rgba(130, 80, 223, 0.20)", stroke: "#8250df", text: "#6639ba" },
  { fill: "rgba(220, 38, 38, 0.18)",  stroke: "#dc2626", text: "#991b1b" },
  { fill: "rgba(8, 145, 178, 0.20)",  stroke: "#0891b2", text: "#155e75" }
];

const CUSTOM_MAZE_TEMPLATES = [
  { id: "tmaze2",       label: "2-Unit T-Maze (2 arenas, 4 zones)" },
  { id: "plus2",        label: "2-Unit Plus-Maze (2 arenas, 5 zones)" },
  { id: "social3ch",    label: "4-Unit 3-Chamber Social (4 arenas, 3 zones)" },
  { id: "single_ymaze", label: "Single Large Y-Maze (1 arena, 4 zones)" },
  { id: "blank",        label: "Blank Plate (Start from scratch)" }
];

function roundMm(val, fallback) {
  const n = parseFloat(val);
  if (!Number.isFinite(n)) return fallback;
  return Number(n.toFixed(2));
}

function sanitizeMazeAssetName(raw, fallback) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "")
    .slice(0, 20);
  return cleaned || fallback;
}

function buildBuiltinMazeShapes(plateId) {
  const out = [];
  let nid = 1;
  const push = (type, x, y, w, h, angle, arena, zone) => {
    out.push({
      id: nid++,
      type,
      x: roundMm(x, 64),
      y: roundMm(y, 43),
      w: roundMm(w, 10),
      h: roundMm(h, 10),
      angle: roundMm(((angle % 360) + 360) % 360, 0),
      arena,
      zone
    });
  };

  if (plateId === "ymaze4") {
    // Official Zantiks g4Y.zs coordinates (mm)
    const R = 14.809;
    const L = 25;
    const W = 8;
    const yAdj = R / 2;
    const xAdj = 1.732 * yAdj;
    const row1 = [[29.5, 26.5, 1], [85.5, 26.5, 2]];
    for (const [cx, cy, arena] of row1) {
      push("RECTANGLE", cx - xAdj, cy - yAdj, L, W, 30, arena, 1);
      push("RECTANGLE", cx + xAdj, cy - yAdj, L, W, 150, arena, 2);
      push("RECTANGLE", cx, cy + R, L, W, 270, arena, 3);
      push("TRIANGLE", cx, cy, W, W, 0, arena, 4);
    }
    const row2 = [[41.4, 59.3, 3], [97.4, 59.3, 4]];
    for (const [cx, cy, arena] of row2) {
      push("RECTANGLE", cx, cy - R, W, L, 0, arena, 1);
      push("RECTANGLE", cx + xAdj, cy + yAdj, L, W, 30, arena, 2);
      push("RECTANGLE", cx - xAdj, cy + yAdj, L, W, 150, arena, 3);
      push("TRIANGLE", cx, cy, W, W, 180, arena, 4);
    }
    return out;
  }

  if (plateId === "ymaze2") {
    // Official Zantiks g2YMazeplate.zs coordinates (mm)
    const R = 20.964;
    const L = 35;
    const W = 12;
    const yAdj = R / 2;
    const xAdj = 1.732 * yAdj;
    const c1x = 39.88, c1y = 36.27;
    push("RECTANGLE", c1x - xAdj, c1y - yAdj, L, W, 30, 1, 1);
    push("RECTANGLE", c1x + xAdj, c1y - yAdj, L, W, 150, 1, 2);
    push("RECTANGLE", c1x, c1y + R, L, W, 270, 1, 3);
    push("TRIANGLE", c1x, c1y, W, W, 0, 1, 4);

    const c2x = 87.88, c2y = 50.0;
    push("RECTANGLE", c2x, c2y - R, W, L, 0, 2, 1);
    push("RECTANGLE", c2x + xAdj, c2y + yAdj, L, W, 30, 2, 2);
    push("RECTANGLE", c2x - xAdj, c2y + yAdj, L, W, 150, 2, 3);
    push("TRIANGLE", c2x, c2y, W, W, 180, 2, 4);
    return out;
  }

  if (plateId === "choice12") {
    // Official Zantiks g12_choice_chambers.zs coordinates (mm)
    // Bridge (Zone 2) drawn before top/bottom wells (Zones 1 & 3) so discs sit cleanly on top of overlap
    let arena = 1;
    for (let r = 0; r < 2; r++) {
      const cy = 22.54 + r * 40;
      for (let c = 0; c < 6; c++) {
        const cx = 16.88 + c * 19;
        push("RECTANGLE", cx, cy, 6, 10, 0, arena, 2);
        push("DISC", cx, cy - 11, 8, 8, 0, arena, 1);
        push("DISC", cx, cy + 11, 8, 8, 0, arena, 3);
        arena++;
      }
    }
    return out;
  }

  if (plateId === "social10") {
    // Official Zantiks gMWP_social.zs coordinates (mm): 10 vertical lanes x 5 zones
    const x0 = 9.5, colStep = 12.0, yCenter = 42.5, w = 9.4, zh = 11.5;
    for (let c = 0; c < 10; c++) {
      const cx = x0 + c * colStep;
      const arena = c + 1;
      for (let z = 1; z <= 5; z++) {
        const cy = yCenter + (z - 3) * zh;
        push("RECTANGLE", cx, cy, w, zh, 0, arena, z);
      }
    }
    return out;
  }

  return out;
}

function buildCustomMazeTemplate(templateId) {
  const out = [];
  let nid = 1;
  const push = (type, x, y, w, h, angle, arena, zone) => {
    out.push({
      id: nid++,
      type,
      x: roundMm(x, 64),
      y: roundMm(y, 43),
      w: roundMm(w, 10),
      h: roundMm(h, 10),
      angle: roundMm(((angle % 360) + 360) % 360, 0),
      arena,
      zone
    });
  };

  if (templateId === "tmaze2") {
    const centers = [[36, 22, 1], [92, 22, 2]];
    for (const [cx, cy, arena] of centers) {
      push("RECTANGLE", cx, cy + 25, 10, 40, 0, arena, 1);      // Stem (Z1)
      push("SQUARE", cx, cy, 10, 10, 0, arena, 2);              // Center junction (Z2)
      push("RECTANGLE", cx - 15, cy, 20, 10, 0, arena, 3);      // Left arm (Z3)
      push("RECTANGLE", cx + 15, cy, 20, 10, 0, arena, 4);      // Right arm (Z4)
    }
    return out;
  }

  if (templateId === "plus2") {
    const centers = [[35, 42.75, 1], [92.8, 42.75, 2]];
    for (const [cx, cy, arena] of centers) {
      push("RECTANGLE", cx, cy - 16, 10, 22, 0, arena, 1);      // North arm (Z1)
      push("RECTANGLE", cx + 16, cy, 22, 10, 0, arena, 2);      // East arm (Z2)
      push("RECTANGLE", cx, cy + 16, 10, 22, 0, arena, 3);      // South arm (Z3)
      push("RECTANGLE", cx - 16, cy, 22, 10, 0, arena, 4);      // West arm (Z4)
      push("SQUARE", cx, cy, 10, 10, 0, arena, 5);              // Center hub (Z5)
    }
    return out;
  }

  if (templateId === "social3ch") {
    const centers = [[34, 24, 1], [93.8, 24, 2], [34, 61.5, 3], [93.8, 61.5, 4]];
    for (const [cx, cy, arena] of centers) {
      push("RECTANGLE", cx - 17, cy, 18, 24, 0, arena, 1);      // Left chamber (Z1)
      push("RECTANGLE", cx, cy, 16, 12, 0, arena, 2);           // Center corridor (Z2)
      push("RECTANGLE", cx + 17, cy, 18, 24, 0, arena, 3);      // Right chamber (Z3)
    }
    return out;
  }

  if (templateId === "single_ymaze") {
    const cx = 63.9, cy = 44.0, R = 21.5, L = 36, W = 13;
    const yAdj = R / 2;
    const xAdj = 1.732 * yAdj;
    push("RECTANGLE", cx - xAdj, cy - yAdj, L, W, 30, 1, 1);
    push("RECTANGLE", cx + xAdj, cy - yAdj, L, W, 150, 1, 2);
    push("RECTANGLE", cx, cy + R, L, W, 270, 1, 3);
    push("TRIANGLE", cx, cy, W, W, 0, 1, 4);
    return out;
  }

  return out;
}

function cloneDefaultCustomMaze() {
  const shapes = buildCustomMazeTemplate("tmaze2");
  return {
    templateId: "tmaze2",
    arenaBmp: "aCustom",
    zoneBmp: "zCustom",
    shapes,
    selectedShapeId: shapes.length ? shapes[0].id : null,
    colorBy: "zone",
    bgDataUrl: "",
    bgOpacity: 0.45
  };
}

function sanitizeCustomMaze(raw) {
  const base = cloneDefaultCustomMaze();
  if (!raw || typeof raw !== "object") return base;
  const validTypes = new Set(["RECTANGLE", "DISC", "SQUARE", "TRIANGLE"]);
  const tmplIds = new Set(CUSTOM_MAZE_TEMPLATES.map(t => t.id));
  const shapes = [];
  if (Array.isArray(raw.shapes)) {
    let nid = 1;
    for (const s of raw.shapes.slice(0, 160)) {
      if (!s || typeof s !== "object") continue;
      const type = validTypes.has(String(s.type || "").toUpperCase()) ? String(s.type).toUpperCase() : "RECTANGLE";
      const x = Math.min(SBS_PLATE_W_MM, Math.max(0, roundMm(s.x, 64)));
      const y = Math.min(SBS_PLATE_H_MM, Math.max(0, roundMm(s.y, 43)));
      const w = Math.min(120, Math.max(1, roundMm(s.w, 10)));
      const h = type === "RECTANGLE" ? Math.min(85, Math.max(1, roundMm(s.h, 10))) : w;
      const rawAng = parseFloat(s.angle);
      const angle = type === "DISC" ? 0 : (Number.isFinite(rawAng) ? roundMm(((rawAng % 360) + 360) % 360, 0) : 0);
      const arena = Math.min(48, Math.max(1, parseInt(s.arena, 10) || 1));
      const zone = Math.min(8, Math.max(1, parseInt(s.zone, 10) || 1));
      shapes.push({ id: nid++, type, x, y, w, h, angle, arena, zone });
    }
  } else {
    return base;
  }
  return {
    templateId: tmplIds.has(raw.templateId) ? raw.templateId : "blank",
    arenaBmp: sanitizeMazeAssetName(raw.arenaBmp, "aCustom"),
    zoneBmp: sanitizeMazeAssetName(raw.zoneBmp, "zCustom"),
    shapes,
    selectedShapeId: shapes.length ? shapes[0].id : null,
    colorBy: raw.colorBy === "arena" ? "arena" : "zone",
    bgDataUrl: "",
    bgOpacity: 0.45
  };
}

function getActiveMazeData(plateId, customMaze, zoneMode) {
  const p = FACTORY_PLATES[plateId] || FACTORY_PLATES["24well"];
  if (!p.isMaze) {
    return {
      isMaze: false,
      shapes: [],
      numArenas: p.rows * p.cols,
      numZones: 2,
      arenaBmp: p.arenaBmp,
      zoneBmp: getZoneAssetName(p, zoneMode),
      wells: getWellLabels(p.rows, p.cols)
    };
  }

  const shapes = p.isCustomMaze
    ? ((customMaze && Array.isArray(customMaze.shapes)) ? customMaze.shapes : [])
    : buildBuiltinMazeShapes(plateId);

  let maxArena = 0;
  let maxZone = 0;
  for (const s of shapes) {
    if (s.arena > maxArena) maxArena = s.arena;
    if (s.zone > maxZone) maxZone = s.zone;
  }
  const numArenas = Math.min(48, Math.max(1, maxArena || 1));
  const numZones = Math.min(8, Math.max(1, maxZone || p.defaultZones || 2));
  const wells = [];
  for (let i = 1; i <= numArenas; i++) wells.push("A" + i);

  const arenaBmp = p.isCustomMaze
    ? sanitizeMazeAssetName(customMaze && customMaze.arenaBmp, "aCustom")
    : p.arenaBmp;
  const zoneBmp = p.isCustomMaze
    ? sanitizeMazeAssetName(customMaze && customMaze.zoneBmp, "zCustom")
    : p.zoneBmp;

  return {
    isMaze: true,
    shapes,
    numArenas,
    numZones,
    arenaBmp,
    zoneBmp,
    wells
  };
}

function buildTrianglePointsAttr(cx, cy, side) {
  const halfS = side / 2;
  const rIn = side / (2 * Math.sqrt(3));
  const rOut = side / Math.sqrt(3);
  const p1 = `${cx.toFixed(2)},${(cy - rOut).toFixed(2)}`;
  const p2 = `${(cx + halfS).toFixed(2)},${(cy + rIn).toFixed(2)}`;
  const p3 = `${(cx - halfS).toFixed(2)},${(cy + rIn).toFixed(2)}`;
  return `${p1} ${p2} ${p3}`;
}

function renderMazeShapesSvgMarkup(shapes, opts) {
  const mode = (opts && opts.mode) || "preview"; // "preview" | "editor" | "sim"
  const colorBy = (opts && opts.colorBy) || "zone";
  const selectedId = opts ? opts.selectedId : null;
  const showLabels = Boolean(opts && opts.showLabels);
  let out = "";

  for (const s of (shapes || [])) {
    const palList = colorBy === "arena" ? MAZE_ARENA_PALETTE : MAZE_ZONE_PALETTE;
    const palIdx = ((colorBy === "arena" ? s.arena : s.zone) - 1) % palList.length;
    const pal = palList[Math.max(0, palIdx)];
    const isSel = mode === "editor" && selectedId === s.id;
    const rot = s.angle && s.type !== "DISC" ? ` transform="rotate(${s.angle} ${s.x.toFixed(2)} ${s.y.toFixed(2)})"` : "";
    const clsAttr = mode === "sim"
      ? ' class="sim-svg-well"'
      : (mode === "editor" ? ` class="maze-shape${isSel ? " selected" : ""}" data-shape-id="${s.id}"` : "");
    const styleAttr = mode === "sim"
      ? ""
      : ` fill="${pal.fill}" stroke="${isSel ? "#0969da" : pal.stroke}" stroke-width="${isSel ? "1.5" : "0.75"}"`;

    if (s.type === "DISC") {
      out += `<circle${clsAttr} cx="${s.x.toFixed(2)}" cy="${s.y.toFixed(2)}" r="${s.w.toFixed(2)}"${styleAttr}/>`;
    } else if (s.type === "SQUARE") {
      const half = s.w / 2;
      out += `<rect${clsAttr} x="${(s.x - half).toFixed(2)}" y="${(s.y - half).toFixed(2)}" width="${s.w.toFixed(2)}" height="${s.w.toFixed(2)}"${rot}${styleAttr}/>`;
    } else if (s.type === "TRIANGLE") {
      const pts = buildTrianglePointsAttr(s.x, s.y, s.w);
      out += `<polygon${clsAttr} points="${pts}"${rot}${styleAttr}/>`;
    } else {
      const hw = s.w / 2, hh = s.h / 2;
      out += `<rect${clsAttr} x="${(s.x - hw).toFixed(2)}" y="${(s.y - hh).toFixed(2)}" width="${s.w.toFixed(2)}" height="${s.h.toFixed(2)}"${rot}${styleAttr}/>`;
    }

    if (showLabels) {
      out += `<text class="maze-shape-lbl" x="${s.x.toFixed(2)}" y="${(s.y + 0.9).toFixed(2)}" fill="${pal.text}" pointer-events="none">A${s.arena}·Z${s.zone}</text>`;
    }
  }
  return out;
}

function getNextMazeShapeId() {
  const shapes = (state.customMaze && state.customMaze.shapes) || [];
  let mx = 0;
  for (const s of shapes) if (s.id > mx) mx = s.id;
  return mx + 1;
}

function renderCustomMazeEditor() {
  const card = document.getElementById("customMazeCard");
  if (!card) return;
  const isCustom = state.plateId === "custom_maze";
  card.style.display = isCustom ? "" : "none";
  if (!isCustom) return;

  const cm = state.customMaze || cloneDefaultCustomMaze();
  state.customMaze = cm;

  const tmplSel = document.getElementById("mazeTemplateSel");
  if (tmplSel) tmplSel.value = cm.templateId || "tmaze2";
  const arenaInp = document.getElementById("mazeArenaBmp");
  if (arenaInp && document.activeElement !== arenaInp) arenaInp.value = cm.arenaBmp || "aCustom";
  const zoneInp = document.getElementById("mazeZoneBmp");
  if (zoneInp && document.activeElement !== zoneInp) zoneInp.value = cm.zoneBmp || "zCustom";

  const colorZoneBtn = document.getElementById("mazeColorZoneBtn");
  const colorArenaBtn = document.getElementById("mazeColorArenaBtn");
  if (colorZoneBtn) colorZoneBtn.classList.toggle("active", cm.colorBy !== "arena");
  if (colorArenaBtn) colorArenaBtn.classList.toggle("active", cm.colorBy === "arena");

  const photoCtrl = document.getElementById("mazePhotoControls");
  if (photoCtrl) photoCtrl.style.display = cm.bgDataUrl ? "inline-flex" : "none";
  const opacitySlider = document.getElementById("mazeBgOpacity");
  if (opacitySlider) opacitySlider.value = String(Math.round((cm.bgOpacity ?? 0.45) * 100));

  const meta = getActiveMazeData("custom_maze", cm, "concentric");
  const summaryEl = document.getElementById("customMazeSummary");
  if (summaryEl) {
    summaryEl.textContent = `${cm.shapes.length} shape${cm.shapes.length === 1 ? "" : "s"} · ${meta.numArenas} arena${meta.numArenas === 1 ? "" : "s"} · ${meta.numZones} zone${meta.numZones === 1 ? "" : "s"}`;
  }

  // Render interactive 127.8 x 85.5 mm SVG canvas
  const svg = document.getElementById("customMazeSvg");
  if (svg) {
    let gridLines = "";
    for (let x = 10; x < SBS_PLATE_W_MM; x += 10) {
      gridLines += `<line x1="${x}" y1="0" x2="${x}" y2="${SBS_PLATE_H_MM}" stroke="#e2e8f0" stroke-width="0.3"/>`;
    }
    for (let y = 10; y < SBS_PLATE_H_MM; y += 10) {
      gridLines += `<line x1="0" y1="${y}" x2="${SBS_PLATE_W_MM}" y2="${y}" stroke="#e2e8f0" stroke-width="0.3"/>`;
    }
    const bgImg = cm.bgDataUrl
      ? `<image href="${cm.bgDataUrl}" x="0" y="0" width="${SBS_PLATE_W_MM}" height="${SBS_PLATE_H_MM}" preserveAspectRatio="none" opacity="${(cm.bgOpacity ?? 0.45).toFixed(2)}" pointer-events="none"/>`
      : "";
    const shapesMarkup = renderMazeShapesSvgMarkup(cm.shapes, {
      mode: "editor",
      colorBy: cm.colorBy,
      selectedId: cm.selectedShapeId,
      showLabels: cm.shapes.length <= 48
    });
    const emptyHint = cm.shapes.length === 0
      ? `<text x="63.9" y="43" text-anchor="middle" font-size="3.6" fill="#64748b" pointer-events="none">Empty 127.8 x 85.5 mm plate — add shapes above or load a starter template</text>`
      : "";

    svg.innerHTML =
      `<rect x="0" y="0" width="${SBS_PLATE_W_MM}" height="${SBS_PLATE_H_MM}" rx="3" fill="#ffffff" stroke="#94a3b8" stroke-width="0.8"/>` +
      bgImg +
      gridLines +
      shapesMarkup +
      emptyHint;
  }

  // Render shape inspector
  const insp = document.getElementById("mazeShapeInspector");
  if (!insp) return;
  const sel = cm.shapes.find(s => s.id === cm.selectedShapeId) || null;
  if (!sel) {
    insp.innerHTML = `<div class="maze-insp-empty">Click a shape on the canvas to drag or edit its millimeter dimensions, Arena #, and Zone #.</div>`;
    return;
  }

  const isRect = sel.type === "RECTANGLE";
  const isDisc = sel.type === "DISC";
  const wLabel = isDisc ? "Radius (mm)" : (sel.type === "RECTANGLE" ? "Width (mm)" : "Side (mm)");
  insp.innerHTML = `
    <div class="maze-insp-grid">
      <div class="field">
        <label for="mzShapeType">Shape</label>
        <select id="mzShapeType">
          <option value="RECTANGLE"${sel.type === "RECTANGLE" ? " selected" : ""}>Rectangle</option>
          <option value="DISC"${sel.type === "DISC" ? " selected" : ""}>Disc</option>
          <option value="SQUARE"${sel.type === "SQUARE" ? " selected" : ""}>Square</option>
          <option value="TRIANGLE"${sel.type === "TRIANGLE" ? " selected" : ""}>Triangle</option>
        </select>
      </div>
      <div class="field">
        <label for="mzShapeArena">Arena # (1-48)</label>
        <input type="number" id="mzShapeArena" min="1" max="48" step="1" value="${sel.arena}">
      </div>
      <div class="field">
        <label for="mzShapeZone">Zone # (1-8)</label>
        <input type="number" id="mzShapeZone" min="1" max="8" step="1" value="${sel.zone}">
      </div>
      <div class="field">
        <label for="mzShapeX">Center X (mm)</label>
        <input type="number" id="mzShapeX" min="0" max="127.8" step="0.5" value="${sel.x}">
      </div>
      <div class="field">
        <label for="mzShapeY">Center Y (mm)</label>
        <input type="number" id="mzShapeY" min="0" max="85.5" step="0.5" value="${sel.y}">
      </div>
      <div class="field">
        <label for="mzShapeW">${wLabel}</label>
        <input type="number" id="mzShapeW" min="1" max="120" step="0.5" value="${sel.w}">
      </div>
      <div class="field">
        <label for="mzShapeH">Height (mm)</label>
        <input type="number" id="mzShapeH" min="1" max="85" step="0.5" value="${sel.h}"${isRect ? "" : " disabled"}>
      </div>
      <div class="field">
        <label for="mzShapeAngle">Angle (deg)</label>
        <input type="number" id="mzShapeAngle" min="0" max="355" step="5" value="${sel.angle}"${isDisc ? " disabled" : ""}>
      </div>
    </div>
  `;

  const bindField = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      fn(el.value);
      renderCustomMazeEditor();
      refreshAll();
    });
  };
  bindField("mzShapeType", v => {
    sel.type = v;
    if (v === "DISC") sel.angle = 0;
    if (v !== "RECTANGLE") sel.h = sel.w;
  });
  bindField("mzShapeArena", v => { sel.arena = Math.min(48, Math.max(1, parseInt(v, 10) || 1)); });
  bindField("mzShapeZone", v => { sel.zone = Math.min(8, Math.max(1, parseInt(v, 10) || 1)); });
  bindField("mzShapeX", v => { sel.x = Math.min(SBS_PLATE_W_MM, Math.max(0, roundMm(v, sel.x))); });
  bindField("mzShapeY", v => { sel.y = Math.min(SBS_PLATE_H_MM, Math.max(0, roundMm(v, sel.y))); });
  bindField("mzShapeW", v => {
    sel.w = Math.min(120, Math.max(1, roundMm(v, sel.w)));
    if (sel.type !== "RECTANGLE") sel.h = sel.w;
  });
  bindField("mzShapeH", v => { sel.h = Math.min(85, Math.max(1, roundMm(v, sel.h))); });
  bindField("mzShapeAngle", v => {
    const raw = parseFloat(v);
    sel.angle = Number.isFinite(raw) ? roundMm(((raw % 360) + 360) % 360, 0) : 0;
  });
}

function bindCustomMazeEditorEvents() {
  const tmplSel = document.getElementById("mazeTemplateSel");
  if (tmplSel) {
    tmplSel.innerHTML = CUSTOM_MAZE_TEMPLATES.map(t => `<option value="${t.id}">${t.label}</option>`).join("");
    tmplSel.addEventListener("change", () => {
      const shapes = buildCustomMazeTemplate(tmplSel.value);
      state.customMaze.templateId = tmplSel.value;
      state.customMaze.shapes = shapes;
      state.customMaze.selectedShapeId = shapes.length ? shapes[0].id : null;
      renderCustomMazeEditor();
      refreshAll();
    });
  }

  const addShape = (type) => {
    const cm = state.customMaze;
    const sel = cm.shapes.find(s => s.id === cm.selectedShapeId);
    const nextArena = sel ? sel.arena : 1;
    const nextZone = sel ? Math.min(8, sel.zone + 1) : 1;
    const shape = {
      id: getNextMazeShapeId(),
      type,
      x: sel ? Math.min(SBS_PLATE_W_MM - 6, roundMm(sel.x + 8, 64)) : 63.9,
      y: sel ? Math.min(SBS_PLATE_H_MM - 6, roundMm(sel.y + 6, 42.75)) : 42.75,
      w: type === "DISC" ? 8 : (type === "RECTANGLE" ? 20 : 12),
      h: type === "RECTANGLE" ? 10 : 12,
      angle: 0,
      arena: nextArena,
      zone: nextZone
    };
    cm.shapes.push(shape);
    cm.selectedShapeId = shape.id;
    renderCustomMazeEditor();
    refreshAll();
  };

  const bindBtn = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  };
  bindBtn("mazeAddRectBtn", () => addShape("RECTANGLE"));
  bindBtn("mazeAddDiscBtn", () => addShape("DISC"));
  bindBtn("mazeAddSqBtn", () => addShape("SQUARE"));
  bindBtn("mazeAddTriBtn", () => addShape("TRIANGLE"));

  bindBtn("mazeDupBtn", () => {
    const cm = state.customMaze;
    const sel = cm.shapes.find(s => s.id === cm.selectedShapeId);
    if (!sel) return;
    const copy = {
      ...sel,
      id: getNextMazeShapeId(),
      x: Math.min(SBS_PLATE_W_MM - 4, roundMm(sel.x + 6, sel.x)),
      y: Math.min(SBS_PLATE_H_MM - 4, roundMm(sel.y + 6, sel.y))
    };
    cm.shapes.push(copy);
    cm.selectedShapeId = copy.id;
    renderCustomMazeEditor();
    refreshAll();
  });

  bindBtn("mazeTile2x2Btn", () => {
    const cm = state.customMaze;
    const baseShapes = cm.shapes.filter(s => s.arena === 1);
    if (baseShapes.length === 0) {
      showToast("Add at least one Arena 1 shape first");
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of baseShapes) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y);
    }
    const cx0 = (minX + maxX) / 2;
    const cy0 = (minY + maxY) / 2;
    const targets = [
      [32.5, 22.0, 1],
      [95.3, 22.0, 2],
      [32.5, 63.5, 3],
      [95.3, 63.5, 4]
    ];
    const tiled = [];
    let nid = 1;
    for (const [tx, ty, arena] of targets) {
      for (const s of baseShapes) {
        tiled.push({
          ...s,
          id: nid++,
          x: Math.min(SBS_PLATE_W_MM, Math.max(0, roundMm(tx + (s.x - cx0), tx))),
          y: Math.min(SBS_PLATE_H_MM, Math.max(0, roundMm(ty + (s.y - cy0), ty))),
          arena
        });
      }
    }
    cm.shapes = tiled;
    cm.selectedShapeId = tiled[0].id;
    renderCustomMazeEditor();
    refreshAll();
    showToast("Tiled Arena 1 into a 2x2 array (4 arenas)");
  });

  bindBtn("mazeDelBtn", () => {
    const cm = state.customMaze;
    if (cm.selectedShapeId === null) return;
    cm.shapes = cm.shapes.filter(s => s.id !== cm.selectedShapeId);
    cm.selectedShapeId = cm.shapes.length ? cm.shapes[cm.shapes.length - 1].id : null;
    renderCustomMazeEditor();
    refreshAll();
  });

  bindBtn("mazeClearBtn", () => {
    state.customMaze.shapes = [];
    state.customMaze.selectedShapeId = null;
    renderCustomMazeEditor();
    refreshAll();
  });

  bindBtn("mazeColorZoneBtn", () => {
    state.customMaze.colorBy = "zone";
    renderCustomMazeEditor();
  });
  bindBtn("mazeColorArenaBtn", () => {
    state.customMaze.colorBy = "arena";
    renderCustomMazeEditor();
  });

  // Photo background overlay for tracing 3D-printed mazes
  const photoInput = document.getElementById("mazePhotoInput");
  bindBtn("mazeUploadPhotoBtn", () => {
    if (!photoInput) return;
    photoInput.value = "";
    photoInput.click();
  });
  if (photoInput) {
    photoInput.addEventListener("change", () => {
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.customMaze.bgDataUrl = String(reader.result || "");
        renderCustomMazeEditor();
        showToast("Loaded background reference image");
      };
      reader.readAsDataURL(file);
    });
  }
  bindBtn("mazeClearPhotoBtn", () => {
    state.customMaze.bgDataUrl = "";
    renderCustomMazeEditor();
  });
  const opSlider = document.getElementById("mazeBgOpacity");
  if (opSlider) {
    opSlider.addEventListener("input", () => {
      state.customMaze.bgOpacity = Math.min(1, Math.max(0.05, (parseInt(opSlider.value, 10) || 45) / 100));
      renderCustomMazeEditor();
    });
  }

  // Custom asset name inputs
  const arenaInp = document.getElementById("mazeArenaBmp");
  if (arenaInp) {
    arenaInp.addEventListener("input", () => {
      state.customMaze.arenaBmp = sanitizeMazeAssetName(arenaInp.value, "aCustom");
      refreshAll();
    });
    arenaInp.addEventListener("change", () => {
      state.customMaze.arenaBmp = sanitizeMazeAssetName(arenaInp.value, "aCustom");
      arenaInp.value = state.customMaze.arenaBmp;
      refreshAll();
    });
  }
  const zoneInp = document.getElementById("mazeZoneBmp");
  if (zoneInp) {
    zoneInp.addEventListener("input", () => {
      state.customMaze.zoneBmp = sanitizeMazeAssetName(zoneInp.value, "zCustom");
      refreshAll();
    });
    zoneInp.addEventListener("change", () => {
      state.customMaze.zoneBmp = sanitizeMazeAssetName(zoneInp.value, "zCustom");
      zoneInp.value = state.customMaze.zoneBmp;
      refreshAll();
    });
  }

  // Pointer selection & dragging in mm coordinates on SVG canvas
  const svg = document.getElementById("customMazeSvg");
  if (svg) {
    let dragState = null;
    const clientToMm = (clientX, clientY) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: 64, y: 43 };
      return {
        x: ((clientX - rect.left) / rect.width) * SBS_PLATE_W_MM,
        y: ((clientY - rect.top) / rect.height) * SBS_PLATE_H_MM
      };
    };

    svg.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const target = e.target && e.target.closest ? e.target.closest("[data-shape-id]") : null;
      if (!target) {
        state.customMaze.selectedShapeId = null;
        renderCustomMazeEditor();
        return;
      }
      e.preventDefault();
      const sid = parseInt(target.getAttribute("data-shape-id"), 10);
      const shape = state.customMaze.shapes.find(s => s.id === sid);
      if (!shape) return;
      state.customMaze.selectedShapeId = sid;
      const pt = clientToMm(e.clientX, e.clientY);
      dragState = { shape, dx: shape.x - pt.x, dy: shape.y - pt.y, moved: false };
      renderCustomMazeEditor();

      const onMove = (me) => {
        if (!dragState) return;
        const p = clientToMm(me.clientX, me.clientY);
        const snap = (v) => Math.round(v * 2) / 2; // 0.5 mm snap for clean coordinates
        dragState.shape.x = Math.min(SBS_PLATE_W_MM, Math.max(0, snap(p.x + dragState.dx)));
        dragState.shape.y = Math.min(SBS_PLATE_H_MM, Math.max(0, snap(p.y + dragState.dy)));
        dragState.moved = true;
        renderCustomMazeEditor();
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (dragState && dragState.moved) refreshAll();
        dragState = null;
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }
}
