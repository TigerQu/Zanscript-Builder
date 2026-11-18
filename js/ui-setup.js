// Zantiks MWP Script Builder - Organism, plate and Plate Config modal rendering; metric checklist styles
// Classic script: shares top-level names with the other js/ files (load order is in zantiks_script_generator.html).
"use strict";

// ---------------------------------------------------------------------------
// 9. Dynamic UI & Modal Rendering
// ---------------------------------------------------------------------------
function renderOrganismChips() {
  const wrap = document.getElementById("organismPresets");
  if (wrap.children.length === 0) {
    for (const org of ORGANISM_PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-org", org.id);
      btn.className = "chip" + (state.organism === org.id ? " active" : "");
      btn.textContent = org.label;
      btn.addEventListener("click", () => {
        state.organism = org.id;
        if (org.id !== "custom") {
          document.getElementById("targetSize").value = org.targetSize;
          document.getElementById("detThreshold").value = org.detThreshold;
          document.getElementById("msdThreshold").value = org.msdThreshold;
          document.getElementById("thermostatTemp").value = org.temp;
          document.getElementById("chk_thermostat").checked = org.thermostat;
          if (org.suggestMsd) {
            document.getElementById("chk_msd").checked = true;
            syncCheckStyles();
          }
        }
        renderOrganismChips();
        refreshAll();
      });
      wrap.appendChild(btn);
    }
    return;
  }

  for (let i = 0; i < wrap.children.length; i++) {
    const btn = wrap.children[i];
    const isActive = btn.getAttribute("data-org") === state.organism;
    btn.className = "chip" + (isActive ? " active" : "");
  }
}

function renderPlateGrid() {
  const wrap = document.getElementById("plateGrid");
  wrap.innerHTML = "";
  for (const key of Object.keys(FACTORY_PLATES)) {
    const p = FACTORY_PLATES[key];
    const customized = isPlateCustomized(key);
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "option-tile" + (state.plateId === key ? " active" : "");
    const dotHtml = customized ? '<span class="tile-dot" title="Custom geometry offsets"></span>' : "";
    tile.innerHTML = `<span class="tile-name"><span>${p.name}</span>${dotHtml}</span><span class="tile-meta">${p.meta}</span>`;
    tile.addEventListener("click", () => {
      state.plateId = key;
      syncGeoInputsToActivePlate();
      renderPlateGrid();
      refreshAll();
    });
    wrap.appendChild(tile);
  }
}

function syncGeoInputsToActivePlate() {
  const p = FACTORY_PLATES[state.plateId];
  const g = state.plateGeometries[state.plateId];
  const isSingle = p.rows === 1 && p.cols === 1;

  document.getElementById("geoX").value = g.xOffset;
  document.getElementById("geoY").value = g.yOffset;
  document.getElementById("geoR").value = g.r;
  document.getElementById("geoColStep").value = g.colStep;
  document.getElementById("geoRowStep").value = g.rowStep;
  document.getElementById("geoRdz").value = g.rDz;

  document.getElementById("geoRLabel").textContent = p.shape === "SQUARE" ? "SIDE LENGTH (mm)" : "RADIUS (mm)";
  document.getElementById("geoColStep").disabled = isSingle;
  document.getElementById("geoRowStep").disabled = isSingle;
}

function renderPlateSvg(cfg) {
  const svg = document.getElementById("plateSvg");
  const p = cfg.plate;
  const g = cfg.geo;
  const isPetri = p.id === "petri";

  // True-scale millimeter footprint (standard SBS plate ~127.8 x 85.5 mm, or chamber tray for dish)
  const trayW = isPetri ? 132 : 127.8;
  const trayH = 85.5;
  let items = `<rect x="0" y="0" width="${trayW}" height="${trayH}" rx="${isPetri ? 8 : 5}" fill="#ffffff" stroke="#afb8c1" stroke-width="1.2"/>`;

  const showInner = cfg.useZones || document.getElementById("inlineGeoDetails").open;

  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const cx = g.xOffset + c * g.colStep;
      const cy = g.yOffset + r * g.rowStep;
      if (p.shape === "SQUARE") {
        const s = g.r;
        items += `<rect x="${(cx - s / 2).toFixed(2)}" y="${(cy - s / 2).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" fill="#ddf4ff" stroke="#0969da" stroke-width="0.9"/>`;
        if (showInner) {
          const si = g.rDz;
          items += `<rect x="${(cx - si / 2).toFixed(2)}" y="${(cy - si / 2).toFixed(2)}" width="${si.toFixed(2)}" height="${si.toFixed(2)}" fill="none" stroke="#0550ae" stroke-dasharray="1.6,1.4" stroke-width="0.75"/>`;
        }
      } else {
        items += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${g.r.toFixed(2)}" fill="#ddf4ff" stroke="#0969da" stroke-width="0.9"/>`;
        if (showInner) {
          items += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${g.rDz.toFixed(2)}" fill="none" stroke="#0550ae" stroke-dasharray="1.6,1.4" stroke-width="0.75"/>`;
        }
      }
    }
  }
  svg.innerHTML = items;

  const first = cfg.wells[0];
  const last = cfg.wells[cfg.wells.length - 1];
  document.getElementById("platePreviewLabel").textContent =
    cfg.numWells === 1 ? "1 Arena (A1)" : `${p.rows} x ${p.cols} (${first}-${last})`;
  document.getElementById("plateAssetHint").textContent =
    `Assets: ${p.arenaBmp}.bmp${cfg.useZones ? `, ${p.zoneBmp}.bmp` : ""}`;
}

function renderConfigModalTable() {
  const tbody = document.getElementById("cfgTableBody");
  tbody.innerHTML = "";
  document.getElementById("cfgProfileName").value = state.profileName || "";

  for (const key of Object.keys(FACTORY_PLATES)) {
    const p = FACTORY_PLATES[key];
    const g = state.plateGeometries[key];
    const customized = isPlateCustomized(key);
    const isSingle = p.rows === 1 && p.cols === 1;

    const tr = document.createElement("tr");
    if (state.plateId === key) tr.className = "active-row";

    const badge = customized ? '<span class="badge-custom">Custom</span>' : "";
    const sizeHint = p.shape === "SQUARE" ? "side" : "rad";

    tr.innerHTML = `
        <td>
          <div class="cfg-plate-label">${p.name} ${badge}</div>
          <div class="cfg-plate-sub">${p.rows}x${p.cols} • ${p.arenaBmp}.bmp (${sizeHint})</div>
        </td>
        <td><input type="number" step="0.05" data-plate="${key}" data-field="xOffset" value="${g.xOffset}"></td>
        <td><input type="number" step="0.05" data-plate="${key}" data-field="yOffset" value="${g.yOffset}"></td>
        <td><input type="number" step="0.05" data-plate="${key}" data-field="colStep" value="${g.colStep}" ${isSingle ? "disabled" : ""}></td>
        <td><input type="number" step="0.05" data-plate="${key}" data-field="rowStep" value="${g.rowStep}" ${isSingle ? "disabled" : ""}></td>
        <td><input type="number" step="0.05" data-plate="${key}" data-field="r" value="${g.r}"></td>
        <td><input type="number" step="0.05" data-plate="${key}" data-field="rDz" value="${g.rDz}"></td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-xs" data-act="auto50" data-plate="${key}" title="Set INNER_ZONE to 50% area">50%</button>
          <button type="button" class="btn btn-xs" data-act="reset" data-plate="${key}" title="Restore factory values">Reset</button>
        </td>
      `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("input[data-plate]").forEach(inp => {
    inp.addEventListener("change", () => {
      const key = inp.getAttribute("data-plate");
      const field = inp.getAttribute("data-field");
      const defVal = FACTORY_PLATES[key][field];
      const nextVal = roundGeo(inp.value, defVal);
      state.plateGeometries[key][field] = nextVal;
      inp.value = nextVal;
      savePlateConfigToBrowser();
      if (key === state.plateId) syncGeoInputsToActivePlate();
      renderPlateGrid();
      renderConfigModalTable();
      refreshAll();
    });
  });

  tbody.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-plate");
      const act = btn.getAttribute("data-act");
      if (act === "auto50") {
        const r = state.plateGeometries[key].r;
        state.plateGeometries[key].rDz = Number((r * Math.SQRT1_2).toFixed(2));
        showToast(`Set ${FACTORY_PLATES[key].name} inner zone to 50% area`);
      } else if (act === "reset") {
        const def = FACTORY_PLATES[key];
        state.plateGeometries[key] = {
          xOffset: def.xOffset, yOffset: def.yOffset,
          colStep: def.colStep, rowStep: def.rowStep,
          r: def.r, rDz: def.rDz
        };
        showToast(`Reset ${def.name} to factory defaults`);
      }
      savePlateConfigToBrowser();
      if (key === state.plateId) syncGeoInputsToActivePlate();
      renderPlateGrid();
      renderConfigModalTable();
      refreshAll();
    });
  });

  updateConfigStatusBadges();
}

function updateConfigStatusBadges() {
  const customCount = countCustomizedPlates();
  const topBadge = document.getElementById("topCustomCountBadge");
  if (customCount > 0) {
    topBadge.style.display = "inline-block";
    topBadge.textContent = `${customCount} custom`;
  } else {
    topBadge.style.display = "none";
  }

  const activeCustom = isPlateCustomized(state.plateId);
  const inlineBadge = document.getElementById("inlineGeoCustomBadge");
  inlineBadge.style.display = activeCustom ? "inline-block" : "none";

  const p = FACTORY_PLATES[state.plateId];
  const g = state.plateGeometries[state.plateId];
  document.getElementById("inlineGeoSummaryText").textContent =
    `${p.name} Offsets: X=${g.xOffset}, Y=${g.yOffset}, ${p.shape === "SQUARE" ? "L" : "R"}=${g.r} mm`;

  const syncBadge = document.getElementById("cfgSyncBadge");
  if (state.unsavedFileChanges) {
    syncBadge.className = "badge-warn";
    syncBadge.textContent = "Saved in browser • Unsaved to file";
  } else {
    syncBadge.className = "badge-custom";
    syncBadge.textContent = customCount > 0 ? "Synced with config file" : "Factory defaults";
  }
}

function syncCheckStyles() {
  ["dist", "msd", "zones", "xy"].forEach(k => {
    const chk = document.getElementById("chk_" + k);
    const lbl = document.getElementById("lbl_" + k);
    lbl.classList.toggle("checked", chk.checked);
  });
}
