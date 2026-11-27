// Test runner for the Zantiks MWP Script Builder.
//
//   npm test               run all checks
//   npm run test:update    rewrite tests/golden/*.txt after an INTENTIONAL change to the scripts
//
// For each tests/scenarios/*.json (an experiment file saved by the app) the page is opened,
// the experiment is loaded, and the four generated .zs scripts + README_STEPS.txt are compared
// byte-for-byte with tests/golden/<same name>.txt.
//
// Set CHROME_PATH to use an installed Chrome instead of Playwright's bundled Chromium.

import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageUrl = pathToFileURL(path.join(root, "zantiks_script_generator.html")).href;
const scenarioDir = path.join(root, "tests", "scenarios");
const goldenDir = path.join(root, "tests", "golden");
const goldenFormat = fs.readFileSync(path.join(root, "tests", "golden-format.js"), "utf8");
const update = process.argv.includes("--update");

async function launchBrowser() {
  if (process.env.CHROME_PATH) {
    return chromium.launch({ executablePath: process.env.CHROME_PATH });
  }
  try {
    return await chromium.launch({});
  } catch (err) {
    const systemCandidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium"
    ];
    const fallback = systemCandidates.find((p) => fs.existsSync(p));
    if (fallback) {
      return chromium.launch({ executablePath: fallback });
    }
    throw err;
  }
}

let failures = 0;
let passes = 0;

function report(ok, name, detail) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
}

function firstDifference(expected, actual) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `first difference at line ${i + 1}:\n        expected: ${JSON.stringify(a[i])}\n        actual:   ${JSON.stringify(b[i])}`;
    }
  }
  return "";
}

const browser = await launchBrowser();

try {
  // A fresh page with empty browser storage (so no auto-saved experiment leaks in)
  async function openFreshPage(hash = "") {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(pageUrl + hash);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.refreshAll && window.refreshAll._latestBundle);
    return { page, errors };
  }

  const readGolden = (page) => page.evaluate((src) => (0, eval)(src)(refreshAll._latestBundle), goldenFormat);

  // ---------------------------------------------------------------- 1. every page loads cleanly
  for (const step of ["study", "organism", "plate", "stimulus", "data", "export"]) {
    const { page, errors } = await openFreshPage("#" + step);
    const active = await page.evaluate(() => document.querySelector(".wizard-page.active").dataset.page);
    report(active === step && errors.length === 0, `page "${step}" loads without errors`, errors.join(" | "));
    await page.close();
  }

  // ---------------------------------------------------------------- 2-4. scenarios
  const scenarios = fs.readdirSync(scenarioDir).filter((f) => f.endsWith(".json")).sort();
  for (const file of scenarios) {
    const name = file.replace(/\.json$/, "");
    const payload = JSON.parse(fs.readFileSync(path.join(scenarioDir, file), "utf8"));
    const { page, errors } = await openFreshPage("#export");
    await page.evaluate((p) => applyExperimentData(p), payload);
    const output = await readGolden(page);
    const goldenPath = path.join(goldenDir, name + ".txt");

    if (update) {
      fs.writeFileSync(goldenPath, output);
      console.log(`WROTE ${path.relative(root, goldenPath)}`);
    } else if (!fs.existsSync(goldenPath)) {
      report(false, `${name}: scripts match golden`, `missing ${path.relative(root, goldenPath)} (run: npm run test:update)`);
    } else {
      const expected = fs.readFileSync(goldenPath, "utf8");
      report(expected === output && errors.length === 0, `${name}: scripts match golden`,
        expected !== output ? firstDifference(expected, output) : errors.join(" | "));
    }

    // Saving right after opening must give back the same experiment
    const resaved = await page.evaluate(() => buildExperimentPayload().experiment);
    report(JSON.stringify(resaved) === JSON.stringify(payload.experiment), `${name}: open -> save round trip`);

    // experiment.json survives a trip through the app's own .zip writer and reader
    const zipOk = await page.evaluate(async () => {
      const text = JSON.stringify(buildExperimentPayload(), null, 2);
      const blob = createZipBlob([{ name: "bundle/README_STEPS.txt", content: "x" }, { name: "bundle/" + EXPERIMENT_FILE_IN_ZIP, content: text }]);
      return (await readExperimentFromZip(await blob.arrayBuffer())) === text;
    });
    report(zipOk, `${name}: experiment.json in .zip round trip`);
    await page.close();
  }

  // ---------------------------------------------------------------- 5. browser auto-save survives a reload
  if (scenarios.length && !update) {
    const file = scenarios[scenarios.length - 1];
    const payload = JSON.parse(fs.readFileSync(path.join(scenarioDir, file), "utf8"));
    const { page } = await openFreshPage("#study");
    await page.evaluate((p) => applyExperimentData(p), payload);
    const before = await readGolden(page);
    await page.waitForTimeout(800); // auto-save is debounced
    await page.reload();
    await page.waitForFunction(() => window.refreshAll && window.refreshAll._latestBundle);
    report(before === (await readGolden(page)), "auto-save restores the experiment after a reload");
    await page.close();
  }

  // ---------------------------------------------------------------- 6. regression checks
  if (!update) {
    const defaultsPayload = JSON.parse(fs.readFileSync(path.join(scenarioDir, "01-defaults.json"), "utf8"));

    // 6a. #resetBtn resets all 25 stimParams + clears localStorage synchronously (no <50ms or >500ms resurrection, preserves plate calibration)
    {
      const { page, errors } = await openFreshPage("#stimulus");
      await page.evaluate(() => {
        // Customize plate calibration (must survive Reset Assay)
        state.plateGeometries["24well"].xOffset = 16.75;
        state.profileName = "UnitA";
        savePlateConfigToBrowser();

        // Dirty all 25 stimParams + form controls
        Object.assign(state.stimParams, {
          baseLight: "DARK", acclimSec: 45, durationSec: 900, timeBinSec: 5,
          ldStart: "DARK", ldPhaseSec: 120, ldCycles: 7, preBaselineSec: 15,
          numPulses: 9, pulseDurSec: 2, itiSec: 45, vibIntensity: "U2",
          vibAmbient: "LIGHT", lightHours: 12, darkHours: 12, numDays: 4,
          circBinSec: 30, mpTimelineSec: 240, mpAcclimLight: "BLUE", mpCycles: 3,
          rampStartTemp: 18, rampEndTemp: 34, rampStepTemp: 4, rampHoldSec: 180,
          rampLight: "LIGHT"
        });
        state.organism = "zebrafish";
        state.plateId = "96well";
        state.stimId = "multi_phase";
        state.showUnderTracks = true;
        state.timelineClips = [{ id: 1, track: "U_BLUE", startSec: 0, endSec: 60, val: 80 }];
        document.getElementById("userName").value = "Alice";
        document.getElementById("hwVersion").value = "Z2";
        document.getElementById("ledColor").value = "UV";
        document.getElementById("ledMount").value = "BOTH";
        document.getElementById("ledBrightness").value = "55";
        document.getElementById("chk_heatmap").checked = true;
        refreshAll();
      });
      await page.waitForTimeout(450); // flush dirty experiment to localStorage
      // Schedule another pending _autosaveTimer right before clicking #resetBtn
      await page.evaluate(() => {
        document.getElementById("expPrefix").value = "race";
        refreshAll();
        document.getElementById("resetBtn").click();
      });

      const immediateCheck = await page.evaluate((defExp) => ({
        storedExp: localStorage.getItem(STORAGE_KEY_EXPERIMENT),
        expMatchesDefault: JSON.stringify(buildExperimentPayload().experiment) === JSON.stringify(defExp),
        geoPreserved: state.plateGeometries["24well"].xOffset === 16.75 && state.profileName === "UnitA"
      }), defaultsPayload.experiment);
      report(
        immediateCheck.storedExp === null && immediateCheck.expMatchesDefault && immediateCheck.geoPreserved && errors.length === 0,
        "#resetBtn resets all 25 stimParams & clears localStorage synchronously while keeping plate calibration"
      );

      // Immediate reload (<50ms) must stay factory clean
      await page.reload();
      await page.waitForFunction(() => window.refreshAll && window.refreshAll._latestBundle);
      const afterFastReload = await page.evaluate((defExp) => ({
        expMatchesDefault: JSON.stringify(buildExperimentPayload().experiment) === JSON.stringify(defExp),
        geoPreserved: state.plateGeometries["24well"].xOffset === 16.75
      }), defaultsPayload.experiment);
      report(afterFastReload.expMatchesDefault && afterFastReload.geoPreserved, "#resetBtn stays clean across immediate reload (<50ms)");

      // Dirty again + click #resetBtn + wait >500ms (past 400ms debounce) + reload
      await page.evaluate(() => {
        state.stimParams.ldCycles = 11;
        document.getElementById("userName").value = "Bob";
        refreshAll();
        document.getElementById("resetBtn").click();
      });
      await page.waitForTimeout(550);
      const storedAfterDebounce = await page.evaluate(() => localStorage.getItem(STORAGE_KEY_EXPERIMENT));
      await page.reload();
      await page.waitForFunction(() => window.refreshAll && window.refreshAll._latestBundle);
      const afterDelayedReload = await page.evaluate((defExp) =>
        JSON.stringify(buildExperimentPayload().experiment) === JSON.stringify(defExp),
      defaultsPayload.experiment);
      report(storedAfterDebounce === null && afterDelayedReload, "#resetBtn prevents 400ms autosave resurrection across delayed reload (>500ms)");
      await page.close();
    }

    // 6b. preflight.js matches actual .zs thermostat, UV, OOB clip, and Z2 hardware behavior
    {
      const { page } = await openFreshPage("#export");
      const pf = await page.evaluate(() => {
        const hasTitle = (checks, re, lvl) => checks.some((c) => re.test(c.title) && (!lvl || c.level === lvl));

        // 1) temp_ramp ignores thermostatTemp=38 when ramp is 20..26, and warns on stimulus page when rampEndTemp=36
        resetAssayFieldsAndDom();
        state.stimId = "temp_ramp";
        state.stimParams.rampStartTemp = 20;
        state.stimParams.rampEndTemp = 26;
        state.stimParams.rampStepTemp = 2;
        document.getElementById("thermostatTemp").value = "38";
        document.getElementById("chk_thermostat").checked = true;
        refreshAll();
        const rampSafeChecks = computePreflightChecks();
        const rampIgnoresTherm = !hasTitle(rampSafeChecks, /Target temperature up to/i, "warn");

        state.stimParams.rampEndTemp = 36;
        refreshAll();
        const rampHotChecks = computePreflightChecks();
        const rampHotWarn = rampHotChecks.find((c) => /Target temperature up to 36/i.test(c.title));
        const rampHotPointsToStimulus = Boolean(rampHotWarn && rampHotWarn.level === "warn" && rampHotWarn.page === "stimulus");

        // 2) multi_phase OOB temp clip (> mpTimelineSec) ignored; partial temp clip catches uncovered fallbackTemp even when !useThermostat
        resetAssayFieldsAndDom();
        state.stimId = "multi_phase";
        state.stimParams.mpTimelineSec = 180;
        document.getElementById("chk_thermostat").checked = false;
        state.timelineClips = [{ id: 1, track: "TEMP", startSec: 200, endSec: 240, val: 38 }];
        refreshAll();
        const oobChecks = computePreflightChecks();
        const oobTempIgnored = !hasTitle(oobChecks, /Target temperature/i) && !hasTitle(oobChecks, /Thermostat in use/i);
        const oobFlagsDark = hasTitle(oobChecks, /Multi-track timeline/i, "warn");

        document.getElementById("thermostatTemp").value = "36";
        document.getElementById("chk_thermostat").checked = false;
        state.timelineClips = [
          { id: 1, track: "WHITE", startSec: 0, endSec: 180, val: 50 },
          { id: 2, track: "TEMP", startSec: 90, endSec: 180, val: 24 }
        ];
        refreshAll();
        const gapChecks = computePreflightChecks();
        const gapWarn = gapChecks.find((c) => /Target temperature up to 36/i.test(c.title));
        const gapFallbackCaught = Boolean(gapWarn && gapWarn.page === "stimulus");

        // 3) UV checks: caught on temp_ramp(LIGHT)+UV and multi_phase(mpAcclimLight="UV"); NOT false-flagged on baseline(DARK)+UV
        resetAssayFieldsAndDom();
        state.stimId = "temp_ramp";
        state.stimParams.rampLight = "LIGHT";
        document.getElementById("ledColor").value = "UV";
        refreshAll();
        const uvTempRampCaught = hasTitle(computePreflightChecks(), /UV light selected/i, "info");

        resetAssayFieldsAndDom();
        state.stimId = "multi_phase";
        state.stimParams.mpAcclimLight = "UV";
        state.timelineClips = [{ id: 1, track: "WHITE", startSec: 0, endSec: 180, val: 50 }];
        refreshAll();
        const uvMpAcclimCaught = hasTitle(computePreflightChecks(), /UV light selected/i, "info");

        resetAssayFieldsAndDom();
        state.stimId = "baseline";
        state.stimParams.baseLight = "DARK";
        document.getElementById("ledColor").value = "UV";
        refreshAll();
        const uvDarkBaselineClean = !hasTitle(computePreflightChecks(), /UV/i);

        // 4) Z2 checks: warns on UNDERNEATH mount and UV wavelength on non-multi_phase
        resetAssayFieldsAndDom();
        document.getElementById("hwVersion").value = "Z2";
        document.getElementById("ledMount").value = "UNDERNEATH";
        document.getElementById("ledColor").value = "UV";
        state.stimParams.acclimSec = "";
        refreshAll();
        const z2Checks = computePreflightChecks();
        const z2Warns = hasTitle(z2Checks, /Underneath LED mount needs an MWP Z3/i, "warn") &&
          hasTitle(z2Checks, /UV \(365 nm\) requires an MWP Z3/i, "warn") &&
          hasTitle(z2Checks, /No acclimation period/i, "info");

        return {
          rampIgnoresTherm,
          rampHotPointsToStimulus,
          oobTempIgnored,
          oobFlagsDark,
          gapFallbackCaught,
          uvTempRampCaught,
          uvMpAcclimCaught,
          uvDarkBaselineClean,
          z2Warns
        };
      });
      report(
        Object.values(pf).every(Boolean),
        "preflight.js matches .zs generation (temp_ramp, OOB/gap multi_phase, UV & Z2 checks)",
        Object.values(pf).every(Boolean) ? "" : JSON.stringify(pf)
      );
      await page.close();
    }

    // 6c. applyExperimentData resets prior dirty state on partial JSON, clamps clips/overlaps, and enforces >=1 metric
    {
      const { page } = await openFreshPage("#study");
      const ioCheck = await page.evaluate(() => {
        state.plateGeometries["24well"].xOffset = 16.25;
        state.organism = "zebrafish";
        state.plateId = "96well";
        state.stimParams.ldCycles = 19;
        state.stimParams.baseLight = "DARK";
        document.getElementById("userName").value = "DirtyUser";
        document.getElementById("chk_heatmap").checked = true;

        applyExperimentData({
          format: EXPERIMENT_FORMAT,
          version: 1,
          experiment: {
            stimId: "multi_phase",
            inputs: {
              chk_dist: false,
              chk_msd: false,
              chk_zones: false,
              chk_xy: false
            },
            timelineClips: [
              { track: "INVALID_TRACK", startSec: 0, endSec: 50, val: 80 },
              { track: "BLUE", startSec: 30, endSec: 70, val: 0 },
              { track: "BLUE", startSec: -10, endSec: 45, val: 250 },
              { track: "BLUE", startSec: 15, endSec: 40, val: 60 },
              { track: "TEMP", startSec: 0, endSec: 60 },
              { track: "TEMP", startSec: 60, endSec: 120, val: 95 },
              { track: "RED", startSec: 80, endSec: 80, val: 50 }
            ]
          }
        });

        const comp = compileMultiTrackSlices(state.timelineClips, 180, 1, 22);
        const s50 = comp.slices.find((s) => s.startSec <= 50 && s.endSec >= 60);

        return {
          cleanUserName: document.getElementById("userName").value === "",
          cleanPlate: state.plateId === "24well",
          cleanLdCycles: state.stimParams.ldCycles === 2,
          cleanBaseLight: state.stimParams.baseLight === "LIGHT",
          cleanHeatmap: document.getElementById("chk_heatmap").checked === false,
          geoKept: state.plateGeometries["24well"].xOffset === 16.25,
          distForcedOn: document.getElementById("chk_dist").checked === true,
          clips: state.timelineClips.map(({ track, startSec, endSec, val }) => ({ track, startSec, endSec, val })),
          blueZeroClampedPwm: s50 && s50.topLights[0] ? s50.topLights[0].pct : null
        };
      });

      const expectedClips = [
        { track: "BLUE", startSec: 0, endSec: 45, val: 100 },
        { track: "BLUE", startSec: 45, endSec: 70, val: 5 },
        { track: "TEMP", startSec: 0, endSec: 60, val: 22 },
        { track: "TEMP", startSec: 60, endSec: 120, val: 40 }
      ];
      const ok =
        ioCheck.cleanUserName &&
        ioCheck.cleanPlate &&
        ioCheck.cleanLdCycles &&
        ioCheck.cleanBaseLight &&
        ioCheck.cleanHeatmap &&
        ioCheck.geoKept &&
        ioCheck.distForcedOn &&
        ioCheck.blueZeroClampedPwm === 5 &&
        JSON.stringify(ioCheck.clips) === JSON.stringify(expectedClips);
      report(ok, "applyExperimentData resets dirty state on partial JSON, clamps clips/overlaps, and enforces >=1 metric",
        ok ? "" : JSON.stringify(ioCheck));
      await page.close();
    }

    // 6d. Range sliders handle ArrowLeft/ArrowRight natively without nudging NLE clips, and .nle-handle width matches edgePx
    {
      const { page } = await openFreshPage("#stimulus");
      await page.evaluate(() => {
        state.stimId = "multi_phase";
        state.selectedClipId = 2; // BLUE 30..50s, val 100
        renderStimGrid();
        renderStimParams();
        refreshAll();
      });

      await page.focus("#simScrubber");
      await page.keyboard.press("ArrowRight");
      const afterScrubKey = await page.evaluate(() => {
        const clip2 = state.timelineClips.find((c) => c.id === 2);
        return {
          simTSec: simState.tSec,
          clipStart: clip2.startSec,
          clipEnd: clip2.endSec
        };
      });

      await page.focus("#nleInspRange");
      await page.keyboard.press("ArrowLeft");
      const afterInspKey = await page.evaluate(() => {
        const clip2 = state.timelineClips.find((c) => c.id === 2);
        const clipEl = document.querySelector('.nle-clip[data-clip-id="2"]');
        const handleEl = clipEl.querySelector(".nle-handle-l");
        const cRect = clipEl.getBoundingClientRect();
        const hRect = handleEl.getBoundingClientRect();
        const expectedHandleW = Math.min(10, Math.max(5, cRect.width * 0.28));
        return {
          clipStart: clip2.startSec,
          clipEnd: clip2.endSec,
          clipVal: clip2.val,
          handleDiffPx: Math.abs(hRect.width - expectedHandleW)
        };
      });

      await page.focus("#simScrubber");
      await page.keyboard.press("Escape");
      const selectedAfterEsc = await page.evaluate(() => state.selectedClipId);

      const uxOk =
        afterScrubKey.simTSec > 0 &&
        afterScrubKey.clipStart === 30 &&
        afterScrubKey.clipEnd === 50 &&
        afterInspKey.clipStart === 30 &&
        afterInspKey.clipEnd === 50 &&
        afterInspKey.clipVal === 99 &&
        afterInspKey.handleDiffPx < 0.5 &&
        selectedAfterEsc === null;
      report(uxOk, "input[type=range] ArrowLeft/ArrowRight not hijacked & .nle-handle width matches edgePx",
        uxOk ? "" : JSON.stringify({ afterScrubKey, afterInspKey, selectedAfterEsc }));
      await page.close();
    }

    // 6e. Circadian uses official timed AUTOREF_MODE 2 (300s) and preflight flags thermal hold / passive cooling
    {
      const { page } = await openFreshPage("#stimulus");
      const circAndTherm = await page.evaluate(() => {
        state.stimId = "circadian";
        refreshAll();
        const circCode = refreshAll._latestBundle[4].code;
        const circCfg = refreshAll._latestCfg;
        const circSample = sampleAssayStateAtTime(circCfg, 150);

        state.stimId = "temp_ramp";
        state.stimParams.rampStartTemp = 28;
        state.stimParams.rampEndTemp = 22;
        state.stimParams.rampStepTemp = 2;
        state.stimParams.rampHoldSec = 300;
        refreshAll();
        const shortRampChecks = computePreflightChecks();

        state.stimParams.rampHoldSec = 1800;
        refreshAll();
        const longCoolChecks = computePreflightChecks();

        return {
          circMode2: circCode.includes("SET(AUTOREF_MODE,2)") && !circCode.includes("SET(AUTOREF_MODE,MOVEMENT)"),
          circTimeout300: circCode.includes("SET(AUTOREF_TIMEOUT,300)"),
          circRuntimeParity: circSample.totalRuntimeSec === refreshAll._latestBundle[4].totalRuntimeSec || circSample.phaseName === "AUTOREFERENCING",
          shortHoldNote: shortRampChecks.some((c) => c.title.includes("Short temperature hold")),
          passiveCoolNote: longCoolChecks.some((c) => c.title.includes("Downward temperature steps cool passively"))
        };
      });
      const ok = Object.values(circAndTherm).every(Boolean);
      report(ok, "circadian uses official SET(AUTOREF_MODE,2)+300s and preflight flags thermal hold & passive cooling",
        ok ? "" : JSON.stringify(circAndTherm));
      await page.close();
    }

    // 6f. MWP Z3 RGB & UV emit LIGHTS(LIGHT16/15/14/13, ON/OFF) port gates while White remains direct-drive only
    {
      const { page } = await openFreshPage("#study");
      const gateCheck = await page.evaluate(() => {
        // Default White Overhead -> no LIGHT13..16
        const whiteCode = refreshAll._latestBundle[4].code;
        const whiteDirectOnly = !/LIGHTS\(LIGHT1[3456],/.test(whiteCode);

        // Blue Both -> LIGHT16 & LIGHT15
        document.getElementById("ledColor").value = "BLUE";
        document.getElementById("ledMount").value = "BOTH";
        refreshAll();
        const blueBothCode = refreshAll._latestBundle[4].code;

        // UV Both -> LIGHT14 & LIGHT13
        document.getElementById("ledColor").value = "UV";
        refreshAll();
        const uvBothCode = refreshAll._latestBundle[4].code;

        // Multi-track with Top Blue + Bottom Green + Top UV + Bottom UV
        document.getElementById("ledColor").value = "WHITE";
        document.getElementById("ledMount").value = "OVERHEAD";
        state.stimId = "multi_phase";
        state.timelineClips = [
          { id: 1, track: "BLUE", startSec: 0, endSec: 60, val: 100 },
          { id: 2, track: "UV", startSec: 60, endSec: 120, val: 80 },
          { id: 3, track: "U_GREEN", startSec: 0, endSec: 60, val: 50 },
          { id: 4, track: "U_UV", startSec: 60, endSec: 120, val: 50 }
        ];
        refreshAll();
        const mpCode = refreshAll._latestBundle[4].code;

        return {
          whiteDirectOnly,
          blueGates: blueBothCode.includes("LIGHTS(LIGHT16,ON)") && blueBothCode.includes("LIGHTS(LIGHT15,ON)") &&
            blueBothCode.includes("LIGHTS(LIGHT16,OFF)") && blueBothCode.includes("LIGHTS(LIGHT15,OFF)"),
          uvGates: uvBothCode.includes("LIGHTS(LIGHT14,ON)") && uvBothCode.includes("LIGHTS(LIGHT13,ON)") &&
            uvBothCode.includes("LIGHTS(LIGHT14,OFF)") && uvBothCode.includes("LIGHTS(LIGHT13,OFF)"),
          mpGates: mpCode.includes("LIGHTS(LIGHT16,ON)") && mpCode.includes("LIGHTS(LIGHT14,ON)") &&
            mpCode.includes("LIGHTS(LIGHT15,ON)") && mpCode.includes("LIGHTS(LIGHT13,ON)") &&
            mpCode.includes("LIGHTS(ALL,OFF)"),
          noIrTouched: !/SET\(X_LED_DRIVE,\s*(2|10)\s*,/.test(mpCode)
        };
      });
      const ok = Object.values(gateCheck).every(Boolean);
      report(ok, "MWP Z3 RGB & UV emit official LIGHTS(LIGHT16/15/14/13, ON/OFF) port gates while White & IR stay untouched",
        ok ? "" : JSON.stringify(gateCheck));
      await page.close();
    }

    // 6g. Z3 RGB Channel Map (DOCS default vs GRB_SHIFT hardware batch) + truncated NLE clip label
    {
      const { page } = await openFreshPage("#study");
      const mapCheck = await page.evaluate(() => {
        const defaultMap = document.getElementById("z3RgbMap").value;

        // Switch to GRB_SHIFT (1:Green, 3:Red, 5:Blue) via UI change event
        const sel = document.getElementById("z3RgbMap");
        sel.value = "GRB_SHIFT";
        sel.dispatchEvent(new Event("change"));

        document.getElementById("ledColor").value = "BLUE";
        document.getElementById("ledMount").value = "BOTH";
        refreshAll();
        const blueSingleCode = refreshAll._latestBundle[4].code;
        const blueOptLabel = [...document.getElementById("ledColor").options].find(o => o.value === "BLUE").textContent;

        // Multi-track: Blue 0-40s, Green 40-80s, Red 80-100s, White 0-180s on a 100s timeline
        state.stimId = "multi_phase";
        state.stimParams.mpTimelineSec = 100;
        state.timelineClips = [
          { id: 1, track: "WHITE", startSec: 0, endSec: 180, val: 35 },
          { id: 2, track: "BLUE", startSec: 0, endSec: 40, val: 100 },
          { id: 3, track: "GREEN", startSec: 40, endSec: 80, val: 100 },
          { id: 4, track: "U_RED", startSec: 80, endSec: 100, val: 100 }
        ];
        state.selectedClipId = 2;
        renderStimParams();
        refreshAll();
        setSimulatorTime(195); // acclim(120) + autoref(60) = 180s -> t=195s is inside S1 (Blue + White)

        const mpCode = refreshAll._latestBundle[4].code;
        const s1Block = mpCode.split("ACTION RUN_S1")[1].split("COMPLETE")[0];
        const s2Block = mpCode.split("ACTION RUN_S2")[1].split("COMPLETE")[0];
        const s3Block = mpCode.split("ACTION RUN_S3")[1].split("COMPLETE")[0];
        const whiteClipText = document.querySelector('.nle-clip[data-clip-id="1"] .nle-clip-label').textContent;
        const hwReadout = document.getElementById("simHwReadout").textContent;
        const savedPayload = buildExperimentPayload();

        // Reset Assay should preserve unit's GRB_SHIFT wiring preference!
        document.getElementById("resetBtn").click();
        const keptAfterReset = document.getElementById("z3RgbMap").value === "GRB_SHIFT" && state.z3RgbMap === "GRB_SHIFT";

        return {
          defaultDocs: defaultMap === "DOCS",
          blueSingleCh5And13: blueSingleCode.includes("SET(X_LED_DRIVE,5,LED_BRIGHTNESS)") &&
            blueSingleCode.includes("SET(X_LED_DRIVE,13,LED_BRIGHTNESS)"),
          blueOptLabelUpdated: blueOptLabel.includes("Ch 5 / 13"),
          s1BlueOnCh5: s1Block.includes("SET(X_LED_DRIVE,5,4095)") && s1Block.includes("SET(X_LED_DRIVE,1,0)"),
          s2GreenOnCh1: s2Block.includes("SET(X_LED_DRIVE,1,4095)") && s2Block.includes("SET(X_LED_DRIVE,5,0)"),
          s3BotRedOnCh11: s3Block.includes("SET(X_LED_DRIVE,11,4095)"),
          truncatedClipLabel: whiteClipText === "35% (0-100s)",
          simReadoutCh5: hwReadout.includes("Ch5:4095") && hwReadout.includes("Ch4:1433"),
          payloadHasMap: savedPayload.experiment.z3RgbMap === "GRB_SHIFT",
          keptAfterReset
        };
      });
      const ok = Object.values(mapCheck).every(Boolean);
      report(ok, "Z3 RGB Channel Map (DOCS vs GRB_SHIFT) updates .zs, UI, simulator, & persists per unit + truncated clip label",
        ok ? "" : JSON.stringify(mapCheck));
      await page.close();
    }

    // 6h. Short 20-slot .zs filenames (01..04_<lastName>_<plateShort>) + protocol-detailed LOGFILE(0, ...) CSV tags
    {
      const { page } = await openFreshPage("#study");
      const slotCheck = await page.evaluate(() => {
        document.getElementById("userName").value = "Tiger Qu";
        document.getElementById("chk_xy").checked = true;
        state.plateId = "24well";
        state.stimId = "ld_transitions";
        refreshAll();

        const ldBundle = refreshAll._latestBundle;
        const ldFiles = [ldBundle[1].filename, ldBundle[2].filename, ldBundle[3].filename, ldBundle[4].filename];
        const ldCode = ldBundle[4].code;
        const ldSlug = ldBundle[4].bundleFolder;

        // Switch protocol on same plate -> .zs slot filename stays identical, LOGFILE(0) / VIDEO / XY tags change!
        state.stimId = "multi_phase";
        refreshAll();
        const mpBundle = refreshAll._latestBundle;
        const mpFile4 = mpBundle[4].filename;
        const mpCode = mpBundle[4].code;
        const mpSlug = mpBundle[4].bundleFolder;

        // Optional Study Tag + Costar plate
        document.getElementById("expPrefix").value = "2";
        state.plateId = "24costar";
        refreshAll();
        const taggedFile4 = refreshAll._latestBundle[4].filename;
        const taggedStep2 = refreshAll._latestBundle[2].filename;

        const hasPlaceholderAttr = document.querySelectorAll("input[placeholder]").length > 0;
        const hasCopySlotBtn = Boolean(document.getElementById("copySlotNameBtn"));

        return {
          shortFilesMatch: JSON.stringify(ldFiles) === JSON.stringify(["01_qu_cal.zs", "02_qu_24w.zs", "03_qu_24w.zs", "04_qu_24w.zs"]),
          slotReusedAcrossProtocols: mpFile4 === "04_qu_24w.zs",
          dataSlugsDiffer: ldSlug !== mpSlug && ldSlug === "qu_ld_2x300s_24w" && mpSlug === "qu_multi_track_1x180s_24w",
          ldHasLogfile0: ldCode.includes('    LOGFILE(0,"qu_ld_2x300s_24w")') &&
            ldCode.includes('LOGFILE(1,"qu_ld_2x300s_24w_XY")') &&
            ldCode.includes('VIDEO(VIDEO_LENGTH,"qu_ld_2x300s_24w")'),
          mpHasLogfile0: mpCode.includes('    LOGFILE(0,"qu_multi_track_1x180s_24w")') &&
            mpCode.includes('LOGFILE(1,"qu_multi_track_1x180s_24w_XY")') &&
            mpCode.includes('VIDEO(VIDEO_LENGTH,"qu_multi_track_1x180s_24w")'),
          step3HasLogfile0: ldBundle[3].code.includes('    LOGFILE(0,"qu_track_check_24w")'),
          taggedCostarMatch: taggedFile4 === "04_qu_2_24c.zs" && taggedStep2 === "02_qu_24c.zs",
          noPlaceholders: !hasPlaceholderAttr,
          hasCopySlotBtn
        };
      });
      const ok = Object.values(slotCheck).every(Boolean);
      report(ok, "Short 20-slot .zs filenames (04_<last>_<plate>) stay stable while LOGFILE(0, ...) tags full protocol details",
        ok ? "" : JSON.stringify(slotCheck));
      await page.close();
    }

    // 6i. Multi-Track Timeline VIB & AUDIO tracks (single onset trigger even across splits, simulator, preflight, round-trip, GRB badge)
    {
      const { page } = await openFreshPage("#stimulus");
      const mmCheck = await page.evaluate(() => {
        const mapSel = document.getElementById("z3RgbMap");
        mapSel.value = "GRB_SHIFT";
        mapSel.dispatchEvent(new Event("change"));

        state.stimId = "multi_phase";
        state.stimParams.mpTimelineSec = 60;
        state.timelineClips = [
          { id: 1, track: "WHITE", startSec: 0,  endSec: 60, val: 40 },
          { id: 2, track: "BLUE",  startSec: 25, endSec: 35, val: 100 },
          { id: 3, track: "VIB",   startSec: 20, endSec: 40, val: 1 },
          { id: 4, track: "AUDIO", startSec: 20, endSec: 40, val: "alarm.wav" }
        ];
        renderStimGrid();
        renderStimParams();
        refreshAll();

        const code = refreshAll._latestBundle[4].code;
        const runS2Block = code.split("ACTION RUN_S2")[1].split("COMPLETE")[0];
        const sampleS2Block = code.split("ACTION SAMPLE_S2")[1].split("COMPLETE")[0];
        const sampleS3Block = code.split("ACTION SAMPLE_S3")[1].split("COMPLETE")[0];
        const beginIdx = sampleS2Block.indexOf('LOGDATA(DATA_SNAPSHOT,"begin")');
        const vibIdx = sampleS2Block.indexOf('ZCOMMAND("U1 D1000 M1 M-1 M1 M-1 M1 M-1 M1 M-1 M1 M-1")');
        const audIdx = sampleS2Block.indexOf('LOAD(AUDIO_FILE,"alarm.wav")');
        const endIdx = sampleS2Block.indexOf('LOGDATA(DATA_SNAPSHOT,"end")');

        // Scrub into S2 onset bin (acclim 120 + autoref 60 + 20.4s = 200.4s -> fires)
        setSimulatorTime(200.4);
        const vibTxtOnset = document.getElementById("simVibBadge").textContent;
        const audTxtOnset = document.getElementById("simAudioBadge").textContent;
        const hwTxt = document.getElementById("simHwReadout").textContent;

        // Scrub after onset bin (202s -> honest Once mode is idle, not falsely active for 20s)
        setSimulatorTime(202);
        const vibTxtAfter = document.getElementById("simVibBadge").textContent;
        const audTxtAfter = document.getElementById("simAudioBadge").textContent;

        const badgeTxt = document.getElementById("hwBadge").textContent;
        const checks = computePreflightChecks();

        // Repeat every 5s triggers at 20s, 25s, 30s, 35s (4 ZCOMMAND triggers!)
        state.timelineClips[2].repeatSec = 5;
        refreshAll();
        const repCode = refreshAll._latestBundle[4].code;
        const repVibCount = (repCode.match(/ZCOMMAND\("U1 /g) || []).length;
        delete state.timelineClips[2].repeatSec;
        refreshAll();

        // Round-trip save & reopen preserves VIB int and AUDIO string clips
        const saved = buildExperimentPayload();
        applyExperimentData(saved);
        const restoredClips = state.timelineClips.map(({ track, startSec, endSec, val }) => ({ track, startSec, endSec, val }));

        return {
          hwBadgeAlt: badgeTxt === "MWP Z3 · GRB-Shift" && document.getElementById("hwBadge").classList.contains("is-alt"),
          s2TriggersInSampleAfterBegin: beginIdx >= 0 && vibIdx > beginIdx && audIdx > beginIdx && endIdx > vibIdx && endIdx > audIdx &&
            !runS2Block.includes("ZCOMMAND(") && !runS2Block.includes("LOAD(AUDIO_FILE"),
          s3NoDuplicateTrigger: !sampleS3Block.includes("ZCOMMAND(") && !sampleS3Block.includes("LOAD(AUDIO_FILE"),
          simBadgesActiveOnset: vibTxtOnset === "TAP U1" && audTxtOnset === "AUD: alarm.wav",
          simBadgesIdleAfterOnset: vibTxtAfter === "Motor Armed" && audTxtAfter === "Audio Armed",
          repeatModeFires4x: repVibCount === 4,
          simReadoutHasBoth: hwTxt.includes('ZCOMMAND("U1 ...') && hwTxt.includes('LOAD(AUDIO_FILE,"alarm.wav")'),
          preflightCustomWav: checks.some((c) => c.title.includes("alarm.wav")),
          clipsRoundTrip: JSON.stringify(restoredClips) === JSON.stringify([
            { track: "WHITE", startSec: 0,  endSec: 60, val: 40 },
            { track: "BLUE",  startSec: 25, endSec: 35, val: 100 },
            { track: "VIB",   startSec: 20, endSec: 40, val: 1 },
            { track: "AUDIO", startSec: 20, endSec: 40, val: "alarm.wav" }
          ])
        };
      });
      const ok = Object.values(mmCheck).every(Boolean);
      report(ok, "Multi-Track VIB & AUDIO tracks fire once at clip onset across splits, simulate live, round-trip & show GRB-Shift badge",
        ok ? "" : JSON.stringify(mmCheck));
      await page.close();
    }

    // 6j. Acoustic Startle & Prepulse Inhibition (PPI) protocols
    {
      const { page } = await openFreshPage("#stimulus");
      const protoCheck = await page.evaluate(() => {
        // 1) Acoustic Startle with custom .wav
        state.stimId = "acoustic_startle";
        state.stimParams.audioFile = "custom";
        state.stimParams.audioCustomFile = "chirp.wav";
        state.stimParams.numPulses = 3;
        state.stimParams.preBaselineSec = 10;
        state.stimParams.itiSec = 10;
        state.stimParams.acclimSec = 20;
        renderStimGrid();
        renderStimParams();
        refreshAll();
        const audCode = refreshAll._latestBundle[4].code;
        const audSample = sampleAssayStateAtTime(refreshAll._latestCfg, 20 + 60 + 10 + 0.5);
        const audSaved = buildExperimentPayload();
        applyExperimentData(audSaved);
        const audRoundTrip = JSON.stringify(buildExperimentPayload().experiment) === JSON.stringify(audSaved.experiment);

        // 2) PPI alternating Pulse-Alone + PPI
        state.stimId = "ppi";
        state.stimParams.ppiPrepulse = "U3";
        state.stimParams.ppiPulse = "U0";
        state.stimParams.ppiIsiMs = 250;
        state.stimParams.ppiPairs = 4;
        state.stimParams.ppiPattern = "alternating";
        state.stimParams.preBaselineSec = 10;
        state.stimParams.itiSec = 10;
        state.stimParams.acclimSec = 20;
        renderStimGrid();
        renderStimParams();
        refreshAll();
        const ppiS4 = refreshAll._latestBundle[4];
        const ppiCode = ppiS4.code;
        const ppiSample1 = sampleAssayStateAtTime(refreshAll._latestCfg, 20 + 60 + 10 + 0.2); // trial 1: pulse alone
        const ppiSample2 = sampleAssayStateAtTime(refreshAll._latestCfg, 20 + 60 + 10 + 11 + 0.2); // trial 2: PPI
        const ppiSaved = buildExperimentPayload();
        applyExperimentData(ppiSaved);
        const ppiRoundTrip = JSON.stringify(buildExperimentPayload().experiment) === JSON.stringify(ppiSaved.experiment);

        return {
          audCmd: audCode.includes('LOAD(AUDIO_FILE,"chirp.wav")') && audCode.includes("TEXT:AUDIO_PULSE"),
          audSim: audSample.audio === "chirp.wav",
          audRoundTrip,
          ppiCmds: ppiCode.includes('ZCOMMAND("U3 D1190 M1 M-1 M1 M-1 P250 U0 D1190 M1 M-1 M1 M-1")') &&
            ppiCode.includes('ZCOMMAND("U0 D1190 M1 M-1 M1 M-1")') &&
            ppiCode.includes("TEXT:PULSE_ALONE") && ppiCode.includes("TEXT:PPI_TRIAL"),
          ppiRows: ppiS4.totalRows === 10 + 8 * 11,
          ppiSim: ppiSample1.vibration === "U0" && ppiSample2.vibration === "U3+U0",
          ppiRoundTrip
        };
      });
      const ok = Object.values(protoCheck).every(Boolean);
      report(ok, "Acoustic Startle and Prepulse Inhibition (PPI) generate valid Zanscript, simulate accurately, and round-trip",
        ok ? "" : JSON.stringify(protoCheck));
      await page.close();
    }

    // 6k. Split-Half Zones (round & square), ZONECHANGES 3-stream separation, Dual-Stream Video, and Still Photos
    {
      const { page } = await openFreshPage("#plate");
      const advIoCheck = await page.evaluate(() => {
        // Round plate + half_tb (Light-Dark Preference)
        state.plateId = "24well";
        document.getElementById("zoneMode").value = "half_tb";
        document.getElementById("chk_zchange").checked = true;
        document.getElementById("chk_xy").checked = true;
        document.getElementById("videoMode").value = "dual";
        document.getElementById("chk_picture").checked = true;
        refreshAll();

        const roundS2 = refreshAll._latestBundle[2].code;
        const roundS4 = refreshAll._latestBundle[4];
        const roundS4Code = roundS4.code;

        // Square plate + half_lr
        state.plateId = "24square";
        document.getElementById("zoneMode").value = "half_lr";
        refreshAll();
        const sqS2 = refreshAll._latestBundle[2].code;
        const sqS4Code = refreshAll._latestBundle[4].code;

        // Save/reopen round trip with all new options active
        const saved = buildExperimentPayload();
        applyExperimentData(saved);
        const roundTripOk = JSON.stringify(buildExperimentPayload().experiment) === JSON.stringify(saved.experiment);

        // Reset Assay resets all new controls cleanly
        document.getElementById("resetBtn").click();
        const resetClean =
          document.getElementById("zoneMode").value === "concentric" &&
          document.getElementById("chk_zchange").checked === false &&
          document.getElementById("chk_picture").checked === false &&
          document.getElementById("videoMode").value === "1fps";

        return {
          roundHalfZone: roundS2.includes("DEFINE X_SECTOR_ANGLE 30015") &&
            roundS2.includes("ShapeAngle(180.0)") &&
            roundS2.includes('SaveDrawing("ldz24")') &&
            roundS4Code.includes('LOAD(ZONES,"ldz24.bmp")'),
          squareHalfZone: sqS2.includes("ShapeType(RECTANGLE,HALF_LEN,LENGTH)") &&
            sqS2.includes("ACTION DRAW_HALF_GRID") &&
            sqS2.includes('SaveDrawing("lrz24sq")') &&
            sqS4Code.includes('LOAD(ZONES,"lrz24sq.bmp")'),
          threeCsvStreams: roundS4.csvCount === 3 &&
            roundS4Code.includes('LOGFILE(0,"mwp_ld_2x300s_24w_ZCHANGE")') &&
            roundS4Code.includes('LOGFILE(1,"mwp_ld_2x300s_24w_XY")') &&
            roundS4Code.includes('LOGFILE(2,"mwp_ld_2x300s_24w")') &&
            roundS4Code.includes('LOAD(ZONECHANGES,"ON")') &&
            roundS4Code.includes('LOAD(ZONECHANGES,"OFF")') &&
            roundS4Code.includes("SET(LOG_STREAM,2)"),
          dualVideo: roundS4Code.includes("SET(VIDEO_STREAM,0)") &&
            roundS4Code.includes("SET(VIDEO_STREAM,1)") &&
            roundS4Code.includes("_30fps") &&
            roundS4Code.includes("_1fps"),
          stillPhotos: roundS4Code.includes('PICTURE("mwp_ld_2x300s_24w_start")') &&
            roundS4Code.includes('PICTURE("mwp_ld_2x300s_24w_end")'),
          roundTripOk,
          resetClean
        };
      });
      const ok = Object.values(advIoCheck).every(Boolean);
      report(ok, "Split-half zones (round & square), ZONECHANGES 3-stream CSVs, Dual Video, & Still Photos work and reset cleanly",
        ok ? "" : JSON.stringify(advIoCheck));
      await page.close();
    }

    // 6l. PWM Smooth Ramps (NLE + Circadian Dawn/Dusk), Sub-Second 0.05s & 10 Hz Strobe, Track Trace/Heatmap Palette, & Z2 Preflight
    {
      const { page } = await openFreshPage("#stimulus");
      const pwmStrobeCheck = await page.evaluate(() => {
        // 1) Verify 3x3 grid CSS on #stimGrid and Time Bin inputs on vibration_startle & ppi
        const stimCols = getComputedStyle(document.getElementById("stimGrid")).gridTemplateColumns.split(" ").length;
        state.stimId = "vibration_startle";
        renderStimParams();
        const vibHasBin = Boolean(document.querySelector('#stimParamsBox [data-sp="timeBinSec"]'));
        state.stimId = "ppi";
        renderStimParams();
        const ppiHasBin = Boolean(document.querySelector('#stimParamsBox [data-sp="timeBinSec"]'));

        // 2) Light-On Flash: 0.05s flash + 10 Hz strobe burst
        state.stimId = "light_on_pulse";
        state.stimParams.pulseDurSec = 0.05;
        state.stimParams.strobeHz = 0;
        refreshAll();
        const sub50msCode = refreshAll._latestBundle[4].code;

        state.stimParams.pulseDurSec = 2;
        state.stimParams.strobeHz = 10;
        refreshAll();
        const strobeFlashCode = refreshAll._latestBundle[4].code;
        const strobeOnSample = sampleAssayStateAtTime(refreshAll._latestCfg, 120 + 60 + 60 + 0.01);
        const strobeOffSample = sampleAssayStateAtTime(refreshAll._latestCfg, 120 + 60 + 60 + 0.06);

        // 3) Circadian Dawn/Dusk PWM ramp (15 min) on Z3 + Z2 warning
        state.stimId = "circadian";
        state.stimParams.circRampMin = 15;
        refreshAll();
        const circRampCode = refreshAll._latestBundle[4].code;
        const circDawnSample = sampleAssayStateAtTime(refreshAll._latestCfg, 305);

        document.getElementById("hwVersion").value = "Z2";
        refreshAll();
        const z2CircChecks = computePreflightChecks();
        state.stimId = "vibration_startle";
        refreshAll();
        const z2VibChecks = computePreflightChecks();
        document.getElementById("hwVersion").value = "Z3";

        // 4) Multi-Track NLE PWM ramp (0->100%) + 10 Hz strobe + X_TRACKTIME / COLOURMAP
        state.stimId = "multi_phase";
        state.stimParams.mpTimelineSec = 60;
        state.timelineClips = [
          { id: 1, track: "WHITE", startSec: 0,  endSec: 40, val: 0, endVal: 100 },
          { id: 2, track: "BLUE",  startSec: 40, endSec: 60, val: 100, strobeHz: 10 }
        ];
        document.getElementById("trackTimeSec").value = "30";
        document.getElementById("chk_heatmap").checked = true;
        document.getElementById("heatmapPalette").value = "3";
        refreshAll();
        const nleCode = refreshAll._latestBundle[4].code;
        const saved = buildExperimentPayload();
        applyExperimentData(saved);
        const roundTripOk = JSON.stringify(buildExperimentPayload().experiment) === JSON.stringify(saved.experiment);

        return {
          grid3Cols: stimCols === 3,
          vibAndPpiHaveTimeBin: vibHasBin && ppiHasBin,
          sub50msFlash: sub50msCode.includes("DEFINE PULSE_DURATION 0.05") && sub50msCode.includes("DEFINE POST_PULSE_WAIT 0.95"),
          strobe10HzFlash: strobeFlashCode.includes("DEFINE STROBE_HALF_SEC 0.05") &&
            strobeFlashCode.includes("DEFINE STROBE_CYCLES_PER_BIN 10") &&
            strobeFlashCode.includes("ACTION STROBE_CYCLE") &&
            strobeOnSample.topChannels.WHITE > 0 && strobeOffSample.topChannels.WHITE === 0,
          circDawnDusk: circRampCode.includes("ACTION DAWN_RAMP") &&
            circRampCode.includes("ACTION DUSK_RAMP") &&
            circRampCode.includes("TEXT:DAWN") &&
            circRampCode.includes("TEXT:DUSK") &&
            circDawnSample.phaseName.includes("DAWN"),
          z2PreflightWarns: z2CircChecks.some(c => c.level === "warn" && c.title.includes("Dawn/Dusk")) &&
            z2VibChecks.some(c => c.level === "warn" && c.title.includes("Stepper vibration")),
          nleRampAndStrobe: nleCode.includes("STROBE_HALF 0.05") &&
            nleCode.includes("ACTION STROBE_S") &&
            (nleCode.match(/SET\(X_LED_DRIVE,4,[1-9]\d*\)/g) || []).length >= 5,
          trackAndPalette: nleCode.includes("SET(X_TRACKTIME,30)") && nleCode.includes("SET(COLOURMAP,3)"),
          roundTripOk
        };
      });
      const ok = Object.values(pwmStrobeCheck).every(Boolean);
      report(ok, "PWM smooth ramps (NLE & Circadian), 0.05s/10Hz strobe, X_TRACKTIME/COLOURMAP, 3x3 grid & Z2 preflight work",
        ok ? "" : JSON.stringify(pwmStrobeCheck));
      await page.close();
    }

    // 6m. Official MWP Mazes (Y-Maze, Choice, Social) & Custom 3D-Printed Maze Editor (Step 2/4, Z1-Z8, round-trip, reset, zero placeholders)
    {
      const { page } = await openFreshPage("#plate");
      const mazeCheck = await page.evaluate(() => {
        // 1) Official 4-Unit Y-Maze with Zone Summary (Z1-4)
        state.plateId = "ymaze4";
        document.getElementById("chk_zones").checked = true;
        syncGeoInputsToActivePlate();
        renderPlateGrid();
        refreshAll();
        const ym4S2 = refreshAll._latestBundle[2].code;
        const ym4S4 = refreshAll._latestBundle[4].code;

        // 2) Official 10-Lane Social Preference (Z1-5)
        state.plateId = "social10";
        refreshAll();
        const socS2 = refreshAll._latestBundle[2].code;
        const socS4 = refreshAll._latestBundle[4].code;

        // 3) Custom 3D-Printed Maze: load single_ymaze, Tile 2x2 -> 4 arenas, custom asset names, round-trip
        state.plateId = "custom_maze";
        syncGeoInputsToActivePlate();
        renderPlateGrid();
        renderCustomMazeEditor();
        const tmplSel = document.getElementById("mazeTemplateSel");
        tmplSel.value = "single_ymaze";
        tmplSel.dispatchEvent(new Event("change"));
        document.getElementById("mazeTile2x2Btn").click();
        const arenaInp = document.getElementById("mazeArenaBmp");
        const zoneInp = document.getElementById("mazeZoneBmp");
        arenaInp.value = "aMyPrint";
        arenaInp.dispatchEvent(new Event("change"));
        zoneInp.value = "zMyPrint";
        zoneInp.dispatchEvent(new Event("change"));
        refreshAll();

        const custS2 = refreshAll._latestBundle[2].code;
        const custS4 = refreshAll._latestBundle[4].code;
        const custCardVisible = document.getElementById("customMazeCard").style.display !== "none";
        const simHasMazeShapes = document.getElementById("simPlateSvg").querySelectorAll(".sim-svg-well").length === 16;

        // Check zero placeholder= attributes across entire DOM (including custom maze editor!)
        const anyPlaceholder = document.querySelectorAll("input[placeholder]").length > 0;

        // Round-trip save & reload
        const saved = buildExperimentPayload();
        applyExperimentData(saved);
        const roundTripOk = JSON.stringify(buildExperimentPayload().experiment) === JSON.stringify(saved.experiment);

        // Reset Assay returns to 24-well & hides custom maze card
        document.getElementById("resetBtn").click();
        const resetClean = state.plateId === "24well" &&
          document.getElementById("customMazeCard").style.display === "none" &&
          document.getElementById("trackTimeSec").value === "15" &&
          document.getElementById("heatmapPalette").value === "0";

        return {
          ym4Step2: ym4S2.includes("SET(DrawArena,4)") && ym4S2.includes("ShapeType(TRIANGLE,8)") &&
            ym4S2.includes("ShapeAngle(180.0)") && ym4S2.includes('SaveDrawing("a_4y")') && ym4S2.includes('SaveDrawing("z_4y")'),
          ym4Step4Zones: ym4S4.includes('LOAD(ARENAS,"a_4y.bmp")') && ym4S4.includes('LOAD(ZONES,"z_4y.bmp")') &&
            ym4S4.includes("ZONE_DISTANCES:A1-4 Z1-4") && ym4S4.includes("ZD_A4_Z4"),
          social5Zones: socS2.includes('SaveDrawing("aSocial")') && socS2.includes('SaveDrawing("zSocial")') &&
            socS4.includes("ZONE_TIMERS:A1-10 Z1-5") && socS4.includes("ZT_A10_Z5"),
          customMazeTile2x2: custCardVisible && simHasMazeShapes &&
            custS2.includes('SaveDrawing("aMyPrint")') && custS2.includes('SaveDrawing("zMyPrint")') &&
            custS4.includes('LOAD(ARENAS,"aMyPrint.bmp")') && custS4.includes("ZONE_COUNTERS:A1-4 Z1-4"),
          noPlaceholders: !anyPlaceholder,
          roundTripOk,
          resetClean
        };
      });
      const ok = Object.values(mazeCheck).every(Boolean);
      report(ok, "Official MWP Mazes (4-Y, Social) & Custom 3D-Printed Maze Editor generate Z1-Z8 scripts, tile 2x2, & round-trip",
        ok ? "" : JSON.stringify(mazeCheck));
      await page.close();
    }

    // 6n. Custom PWM Curves (Gamma 2.2, Sine Pulse, Custom Keyframes + Steps, Inline Clip Envelopes, Circadian Gamma)
    {
      const { page } = await openFreshPage("#stimulus");
      const curveCheck = await page.evaluate(() => {
        // 1) Gamma 2.2 Dawn vs Linear midpoint check (both Dawn 0->100 and Dusk 100->0 stay concave-up)
        const linMid = evaluateLightCurvePct({ val: 0, endVal: 100, curve: "linear" }, 0.5);
        const gamDawnMid = evaluateLightCurvePct({ val: 0, endVal: 100, curve: "gamma" }, 0.5);
        const gamDuskMid = evaluateLightCurvePct({ val: 100, endVal: 0, curve: "gamma" }, 0.5);
        const sineStart = evaluateLightCurvePct({ val: 5, endVal: 100, curve: "sine" }, 0);
        const sineMid = evaluateLightCurvePct({ val: 5, endVal: 100, curve: "sine" }, 0.5);
        const sineEnd = evaluateLightCurvePct({ val: 5, endVal: 100, curve: "sine" }, 1);

        // 2) Load Custom Keyframe Envelope preset in Multi-Track Timeline
        state.stimId = "multi_phase";
        renderStimGrid();
        renderStimParams();
        const presetSel = document.getElementById("nlePresetSel");
        presetSel.value = "custom_curve";
        presetSel.dispatchEvent(new Event("change"));

        const code = refreshAll._latestBundle[4].code;
        const clipHasInlineCurve = document.querySelectorAll(".nle-clip.has-curve .nle-clip-curve polyline").length >= 1;
        const kfHandlesCount = document.querySelectorAll("#nleCurveSvg .nle-kf-pt").length;
        const comp = compileMultiTrackSlices(state.timelineClips, state.stimParams.mpTimelineSec, state.stimParams.timeBinSec, 22);

        // Round-trip save & reopen preserves curve, rampSteps, and keyframes
        const saved = buildExperimentPayload();
        applyExperimentData(saved);
        const roundTripOk = JSON.stringify(buildExperimentPayload().experiment) === JSON.stringify(saved.experiment);

        // 3) Circadian Gamma vs Linear Dawn/Dusk PWM levels
        state.stimId = "circadian";
        state.stimParams.circRampMin = 15;
        state.stimParams.circRampCurve = "gamma";
        refreshAll();
        const circGammaCode = refreshAll._latestBundle[4].code;
        state.stimParams.circRampCurve = "linear";
        refreshAll();
        const circLinearCode = refreshAll._latestBundle[4].code;

        const s10 = comp.slices.find((s) => s.idx === 10);
        const s14 = comp.slices.find((s) => s.idx === 14);

        return {
          gammaPerceptualMath: linMid === 50 && gamDawnMid < 26 && gamDuskMid < 26 && Math.abs(gamDawnMid - gamDuskMid) <= 1,
          sinePulseMath: sineStart === 5 && sineMid === 100 && sineEnd === 5,
          customCurveUi: clipHasInlineCurve && kfHandlesCount === 6 && comp.slices.length === 17 &&
            s10?.startSec === 130 && s10?.endSec === 131 && s10?.topLights?.[0]?.pct === 25 &&
            s14?.startSec === 153 && s14?.endSec === 154 && s14?.topLights?.[0]?.pct === 70,
          customCurveCode: code.includes("DEFINE S17_BINS") && !code.includes("DEFINE S18_BINS") &&
            code.includes("SET(X_LED_DRIVE,1,1024)") && code.includes("SET(X_LED_DRIVE,1,2867)"),
          roundTripOk,
          circGammaVsLinear: circGammaCode.includes("SET(X_LED_DRIVE,4,82)") && circLinearCode.includes("SET(X_LED_DRIVE,4,614)")
        };
      });
      const ok = Object.values(curveCheck).every(Boolean);
      report(ok, "Custom PWM curves (Gamma 2.2, Sine, Custom Keyframes, Steps, inline envelopes & Circadian Gamma) work and round-trip",
        ok ? "" : JSON.stringify(curveCheck));
      await page.close();
    }

    // 6o. Multi-Track compiler edge-case regression suite (mixed-Hz strobes, 120 repeat cap + preflight, keyframe peaks, snapshot ordering, fractional strobe durations)
    {
      const { page } = await openFreshPage("#stimulus");
      const regCheck = await page.evaluate(() => {
        // Helper: parse generated .zs STROBE_S1 + SAMPLE_S1 timeline into interval states for exact WAIT sum & sampler parity
        const parseStrobeBin = (code, sliceIdx) => {
          const defs = {};
          for (const m of code.matchAll(/^DEFINE\s+(\S+)\s+([0-9.]+)/gm)) {
            defs[m[1]] = parseFloat(m[2]);
          }
          const resolveNum = (tok) => (defs[tok] !== undefined ? defs[tok] : parseFloat(tok));
          const getBlock = (name) => {
            const parts = code.split(`ACTION ${name}\n`);
            if (parts.length < 2) return "";
            return parts[1].split("\nCOMPLETE")[0];
          };
          const strobeBody = getBlock(`STROBE_S${sliceIdx}`);
          const sampleBody = getBlock(`SAMPLE_S${sliceIdx}`);
          const parseLines = (body) => {
            const segs = [];
            let cur = { BLUE: 0, RED: 0, GREEN: 0, WHITE: 0 };
            for (const raw of body.split("\n")) {
              const line = raw.trim();
              const drv = line.match(/^SET\(X_LED_DRIVE,(\d+),(\d+)\)$/);
              if (drv) {
                const ch = parseInt(drv[1], 10);
                const pwm = parseInt(drv[2], 10);
                if (ch === 1) cur.BLUE = pwm;
                if (ch === 3) cur.GREEN = pwm;
                if (ch === 4) cur.WHITE = pwm;
                if (ch === 5) cur.RED = pwm;
              }
              const wm = line.match(/^WAIT\(([^)]+)\)$/);
              if (wm) segs.push({ dt: resolveNum(wm[1]), state: { ...cur } });
            }
            return segs;
          };
          const cycMatch = sampleBody.match(new RegExp(`INVOKE\\(STROBE_S${sliceIdx},([^)]+)\\)`));
          const cycCount = cycMatch ? Math.round(resolveNum(cycMatch[1])) : 0;
          const cycSegs = cycCount > 0 ? parseLines(strobeBody) : [];
          // Remainder lines appear after INVOKE(STROBE_S*,...) and before DATA_SNAPSHOT,"end"
          const afterInvoke = cycMatch ? sampleBody.split(cycMatch[0])[1] : sampleBody;
          const remPart = afterInvoke.split('LOGDATA(DATA_SNAPSHOT,"end")')[0];
          const remSegs = parseLines(remPart);
          const allSegs = [];
          for (let i = 0; i < cycCount; i++) {
            for (const s of cycSegs) allSegs.push({ dt: s.dt, state: { ...s.state } });
          }
          for (const s of remSegs) allSegs.push({ dt: s.dt, state: { ...s.state } });
          const totalWait = Number(allSegs.reduce((acc, s) => acc + s.dt, 0).toFixed(4));
          return { totalWait, segs: allSegs, sampleBody, strobeBody, defs };
        };

        const stateAtT = (segs, tSec) => {
          let acc = 0;
          for (const s of segs) {
            if (tSec < acc + s.dt - 1e-6) return s.state;
            acc += s.dt;
          }
          return segs[segs.length - 1]?.state || { BLUE: 0, RED: 0, GREEN: 0, WHITE: 0 };
        };

        // --- Bug 1: Overlapping multi-frequency strobe ({2, 10}, {2, 5}, {5, 10}) + sampler.js parity ---
        state.stimId = "multi_phase";
        state.stimParams.acclimSec = 0;
        state.stimParams.mpTimelineSec = 4;
        state.stimParams.mpCycles = 1;
        state.stimParams.timeBinSec = 1;
        state.timelineClips = [
          { id: 1, track: "BLUE", startSec: 0, endSec: 4, val: 100, strobeHz: 2 },
          { id: 2, track: "RED",  startSec: 0, endSec: 4, val: 100, strobeHz: 10 }
        ];
        refreshAll();
        const cfg210 = readConfig();
        const comp210 = compileMultiTrackSlices(state.timelineClips, 4, 1, 22);
        const code210 = refreshAll._latestBundle[4].code;
        const parsed210 = parseStrobeBin(code210, 1);
        const hasBlueOnly = parsed210.segs.some((s) => s.state.BLUE === 4095 && s.state.RED === 0);
        const hasRedOnly = parsed210.segs.some((s) => s.state.BLUE === 0 && s.state.RED === 4095);
        const hasBoth = parsed210.segs.some((s) => s.state.BLUE === 4095 && s.state.RED === 4095);
        const hasNeither = parsed210.segs.some((s) => s.state.BLUE === 0 && s.state.RED === 0);

        // Verify 100% phase parity between parsed .zs and sampler.js across bin 1 (0..1s) and bin 2 (1..2s)
        let parity210Ok = true;
        const autoref = cfg210.autorefTimeout || 0;
        for (const tBin of [0.02, 0.07, 0.12, 0.17, 0.22, 0.27, 0.32, 0.37, 0.42, 0.47, 0.52, 0.77, 0.97]) {
          for (const binOff of [0, 1]) {
            const zs = stateAtT(parsed210.segs, tBin);
            const smp = sampleAssayStateAtTime(cfg210, autoref + binOff + tBin);
            if ((zs.BLUE > 0) !== (smp.topChannels.BLUE > 0) || (zs.RED > 0) !== (smp.topChannels.RED > 0)) {
              parity210Ok = false;
            }
          }
        }

        // Also check {2, 5} Hz (1.0s LCM) & {5, 10} Hz (0.2s LCM)
        const checkCombo = (f1, f2, expectedTag) => {
          state.timelineClips = [
            { id: 1, track: "BLUE", startSec: 0, endSec: 2, val: 100, strobeHz: f1 },
            { id: 2, track: "RED",  startSec: 0, endSec: 2, val: 100, strobeHz: f2 }
          ];
          refreshAll();
          const c = compileMultiTrackSlices(state.timelineClips, 2, 1, 22);
          const p = parseStrobeBin(refreshAll._latestBundle[4].code, 1);
          return c.slices[0].strobeHzList.join(",") === `${f1},${f2}` &&
            c.slices[0].csvTag.includes(expectedTag) &&
            Math.abs(p.totalWait - 1.0) < 1e-6 &&
            p.segs.some((s) => s.state.BLUE > 0 && s.state.RED === 0) &&
            p.segs.some((s) => s.state.BLUE === 0 && s.state.RED > 0);
        };
        const bug1Ok =
          comp210.slices[0].strobeHzList.join(",") === "2,10" &&
          comp210.slices[0].csvTag.includes("2_10HZ") &&
          comp210.slices[0].overlayText.includes("2+10Hz") &&
          Math.abs(parsed210.totalWait - 1.0) < 1e-6 &&
          hasBlueOnly && hasRedOnly && hasBoth && hasNeither &&
          parity210Ok &&
          checkCombo(2, 5, "2_5HZ") &&
          checkCombo(5, 10, "5_10HZ");

        // --- Bug 2: Repeat cap raised to 120 + preflight warning when exceeded ---
        state.stimParams.mpTimelineSec = 180;
        state.stimParams.timeBinSec = 1;
        state.timelineClips = [{ id: 1, track: "VIB", startSec: 0, endSec: 180, val: 0, repeatSec: 5 }];
        refreshAll();
        const comp36 = compileMultiTrackSlices(state.timelineClips, 180, 1, 22);
        const code36 = refreshAll._latestBundle[4].code;
        const vib36Count = (code36.match(/ZCOMMAND\("U0 /g) || []).length;
        const checks36 = computePreflightChecks();

        state.stimParams.mpTimelineSec = 300;
        state.timelineClips = [{ id: 1, track: "VIB", startSec: 0, endSec: 300, val: 0, repeatSec: 1 }];
        refreshAll();
        const compCap = compileMultiTrackSlices(state.timelineClips, 300, 1, 22);
        const codeCap = refreshAll._latestBundle[4].code;
        const vibCapCount = (codeCap.match(/ZCOMMAND\("U0 /g) || []).length;
        const checksCap = computePreflightChecks();
        const bug2Ok =
          vib36Count === 36 &&
          comp36.truncatedRepeats.length === 0 &&
          !checks36.some((c) => c.title.includes("Repeat triggers capped")) &&
          vibCapCount === 120 &&
          compCap.truncatedRepeats.length === 1 &&
          compCap.truncatedRepeats[0].expected === 300 &&
          compCap.truncatedRepeats[0].capped === 120 &&
          checksCap.some((c) => c.level === "warn" && c.title.includes("Repeat triggers capped at 120"));

        // --- Bug 3: Custom Keyframe narrow 100% peak & 10% trough preserved even at rampSteps = 4 ---
        state.stimParams.mpTimelineSec = 100;
        state.stimParams.timeBinSec = 1;
        state.timelineClips = [{
          id: 1, track: "BLUE", startSec: 0, endSec: 100, val: 0, endVal: 0,
          curve: "custom", rampSteps: 4,
          keyframes: [{ t: 0, y: 0 }, { t: 0.35, y: 100 }, { t: 0.45, y: 10 }, { t: 0.7, y: 60 }, { t: 1, y: 0 }]
        }];
        refreshAll();
        const compKf = compileMultiTrackSlices(state.timelineClips, 100, 1, 22);
        const codeKf = refreshAll._latestBundle[4].code;
        const peakSlice = compKf.slices.find((s) => s.startSec === 35 && s.endSec === 36);
        const troughSlice = compKf.slices.find((s) => s.startSec === 45 && s.endSec === 46);
        const secondPeakSlice = compKf.slices.find((s) => s.startSec === 70 && s.endSec === 71);
        const bug3Ok =
          peakSlice?.topLights?.[0]?.pct === 100 &&
          troughSlice?.topLights?.[0]?.pct === 10 &&
          secondPeakSlice?.topLights?.[0]?.pct === 60 &&
          codeKf.includes("SET(X_LED_DRIVE,1,4095)") &&
          codeKf.includes("SET(X_LED_DRIVE,1,410)");

        // --- Bug 4: VIB + AUDIO triggers strictly AFTER DATA_SNAPSHOT("begin") in both normal & strobe slices ---
        state.stimParams.mpTimelineSec = 10;
        state.stimParams.timeBinSec = 1;
        state.timelineClips = [
          { id: 1, track: "BLUE",  startSec: 0, endSec: 5, val: 100, strobeHz: 5 },
          { id: 2, track: "VIB",   startSec: 0, endSec: 5, val: 0 },
          { id: 3, track: "AUDIO", startSec: 0, endSec: 5, val: "tone" },
          { id: 4, track: "VIB",   startSec: 6, endSec: 9, val: 1 }
        ];
        refreshAll();
        const codeTrig = refreshAll._latestBundle[4].code;
        const runS1T = codeTrig.split("ACTION RUN_S1\n")[1].split("\nCOMPLETE")[0];
        const smpS1T = codeTrig.split("ACTION SAMPLE_S1\n")[1].split("\nCOMPLETE")[0];
        const s1Beg = smpS1T.indexOf('LOGDATA(DATA_SNAPSHOT,"begin")');
        const s1Vib = smpS1T.indexOf('ZCOMMAND("U0 ');
        const s1Aud = smpS1T.indexOf('LOAD(AUDIO_FILE,"tone")');
        const s1Inv = smpS1T.indexOf("INVOKE(STROBE_S1,");
        const s1End = smpS1T.indexOf('LOGDATA(DATA_SNAPSHOT,"end")');

        // Normal (non-strobe) trigger slice at 6s (find its slice idx from compiled slices)
        const compTrig = compileMultiTrackSlices(state.timelineClips, 10, 1, 22);
        const normTrigSl = compTrig.slices.find((s) => s.startSec === 6);
        const runNorm = codeTrig.split(`ACTION RUN_S${normTrigSl.idx}\n`)[1].split("\nCOMPLETE")[0];
        const smpNorm = codeTrig.split(`ACTION SAMPLE_S${normTrigSl.idx}\n`)[1].split("\nCOMPLETE")[0];
        const nBeg = smpNorm.indexOf('LOGDATA(DATA_SNAPSHOT,"begin")');
        const nVib = smpNorm.indexOf('ZCOMMAND("U1 ');
        const nWait = smpNorm.indexOf("WAIT(TIME_BIN)");
        const nEnd = smpNorm.indexOf('LOGDATA(DATA_SNAPSHOT,"end")');
        const bug4Ok =
          !runS1T.includes("ZCOMMAND(") && !runS1T.includes("LOAD(AUDIO_FILE") &&
          s1Beg >= 0 && s1Vib > s1Beg && s1Aud > s1Beg && s1Inv > s1Vib && s1Inv > s1Aud && s1End > s1Inv &&
          !runNorm.includes("ZCOMMAND(") &&
          nBeg >= 0 && nVib > nBeg && nWait > nVib && nEnd > nWait;

        // --- Bug 5: Exact fractional TIME_BIN (1.2s @ 2 Hz) & light_on_pulse fractional pulseDurSec (0.7s @ 2 Hz) ---
        state.stimParams.mpTimelineSec = 6;
        state.stimParams.timeBinSec = 1.2;
        state.timelineClips = [{ id: 1, track: "BLUE", startSec: 0, endSec: 6, val: 100, strobeHz: 2 }];
        refreshAll();
        const codeFracMp = refreshAll._latestBundle[4].code;
        const parsedFracMp = parseStrobeBin(codeFracMp, 1);

        state.stimId = "light_on_pulse";
        state.stimParams.timeBinSec = 2;
        state.stimParams.pulseDurSec = 0.7;
        state.stimParams.strobeHz = 2;
        state.stimParams.numPulses = 2;
        refreshAll();
        const codeFracFlash = refreshAll._latestBundle[4].code;
        const flashBinBlock = codeFracFlash.split("ACTION LIGHT_FLASH_BIN\n")[1].split("\nCOMPLETE")[0];
        const strobeDefCycles = codeFracFlash.match(/DEFINE STROBE_CYCLES (\d+)/)?.[1];
        const postPulseWait = codeFracFlash.match(/DEFINE POST_PULSE_WAIT ([0-9.]+)/)?.[1];
        const bug5Ok =
          Math.abs(parsedFracMp.totalWait - 1.2) < 1e-6 &&
          codeFracMp.includes("DEFINE S1_STROBE_CYCLES 2") &&
          parsedFracMp.sampleBody.includes("WAIT(0.2)") &&
          strobeDefCycles === "1" &&
          postPulseWait === "1.3" &&
          flashBinBlock.includes("INVOKE(STROBE_CYCLE,STROBE_CYCLES)") &&
          flashBinBlock.includes("WAIT(0.2)") &&
          flashBinBlock.includes("WAIT(POST_PULSE_WAIT)");

        return { bug1Ok, bug2Ok, bug3Ok, bug4Ok, bug5Ok };
      });
      const ok = Object.values(regCheck).every(Boolean);
      report(ok, "Multi-Track compiler fixes (mixed-Hz strobes + sampler parity, 120 repeat cap + preflight, keyframe peaks, snapshot ordering & fractional strobe waits) pass",
        ok ? "" : JSON.stringify(regCheck));
      await page.close();
    }

    // 6p. Full Hardware Run-Through (All 13 Tracks) preset
    {
      const { page, errors } = await openFreshPage("#stimulus");
      const rtCheck = await page.evaluate(() => {
        // Choose 24well & multi_phase, then trigger #nlePresetSel = "run_through"
        state.plateId = "24well";
        state.stimId = "multi_phase";
        renderStimGrid();
        renderStimParams();
        const presetSel = document.getElementById("nlePresetSel");
        presetSel.value = "run_through";
        presetSel.dispatchEvent(new Event("change"));

        const clips = state.timelineClips;
        const tracks = new Set(clips.map((c) => c.track));
        // Verify zero same-track overlaps
        let overlapCount = 0;
        for (const tr of tracks) {
          const list = clips.filter((c) => c.track === tr).sort((a, b) => a.startSec - b.startSec);
          for (let i = 1; i < list.length; i++) {
            if (list[i].startSec < list[i - 1].endSec) overlapCount++;
          }
        }

        const code = refreshAll._latestBundle[4].code;
        const actionCount = (code.match(/^ACTION /gm) || []).length;
        const completeCount = (code.match(/^COMPLETE$/gm) || []).length;

        // Check all 10 visible Z3 X_LED_DRIVE channels driven > 0, and IR Ch 2 / Ch 10 untouched
        const visChs = [0, 1, 3, 4, 5, 8, 9, 11, 12, 13];
        const all10LedChannelsDriven = visChs.every((ch) => new RegExp(`SET\\(X_LED_DRIVE,${ch},[1-9]\\d*\\)`).test(code));
        const irUntouched = !/SET\(X_LED_DRIVE,(?:2|10),/.test(code);
        const all4PortGates = ["LIGHT13", "LIGHT14", "LIGHT15", "LIGHT16"].every(
          (g) => code.includes(`LIGHTS(${g},ON)`) && code.includes(`LIGHTS(${g},OFF)`)
        );

        // Strobes, stepper levels U0-U3, audio tone/mono, thermostat step + restore
        const hasMixedAnd5HzStrobes = code.includes("2_10HZ") && code.includes("5HZ");
        const hasAll4VibLevels = ["U0", "U1", "U2", "U3"].every((u) => code.includes(`ZCOMMAND("${u} `));
        const hasBothAudio = code.includes('LOAD(AUDIO_FILE,"tone")') && code.includes('LOAD(AUDIO_FILE,"mono")');
        const baseT = parseFloat(document.getElementById("thermostatTemp").value) || 22;
        const warmT = Math.min(40, Number((baseT + 2).toFixed(1)));
        const tempMatches = [...code.matchAll(/SET\(THERMOSTAT,([0-9.]+)\)/g)].map((m) => parseFloat(m[1]));
        const hasTempStepAndRestore = tempMatches.includes(baseT) && tempMatches.includes(warmT) &&
          tempMatches.lastIndexOf(baseT) > tempMatches.indexOf(warmT);

        // Every trigger inside SAMPLE_S* occurs strictly after DATA_SNAPSHOT("begin") and before "end"; zero triggers in RUN_S*
        const runBlocks = code.split(/^ACTION RUN_S/gm).slice(1).map((b) => b.split("\nCOMPLETE")[0]);
        const noRunTriggers = runBlocks.every((b) => !b.includes("ZCOMMAND(") && !b.includes("LOAD(AUDIO_FILE,"));
        const sampleBlocks = code.split(/^ACTION SAMPLE_S/gm).slice(1).map((b) => b.split("\nCOMPLETE")[0]);
        const triggerBlocks = sampleBlocks.filter((b) => b.includes("ZCOMMAND(") || b.includes("LOAD(AUDIO_FILE,"));
        const allTriggersAfterBegin = triggerBlocks.length >= 6 && triggerBlocks.every((b) => {
          const beg = b.indexOf('LOGDATA(DATA_SNAPSHOT,"begin")');
          const end = b.indexOf('LOGDATA(DATA_SNAPSHOT,"end")');
          const idxs = [...b.matchAll(/(?:ZCOMMAND\(|LOAD\(AUDIO_FILE,)/g)].map((m) => m.index);
          return beg >= 0 && end > beg && idxs.every((i) => i > beg && i < end);
        });

        // Simulate Sequence Preview across the entire 180s timeline cleanly
        const cfg = readConfig();
        const tOffset = (parseFloat(cfg.sp?.acclimSec) || 0) + (parseFloat(cfg.autorefTimeout) || 0);
        const probeSecs = [5, 25, 35, 65, 78, 90, 120, 125.02, 140.2, 149.2, 152.2, 155, 158.2, 164.2, 179];
        const simResults = probeSecs.map((sec) => {
          setSimulatorTime(tOffset + sec);
          return sampleAssayStateAtTime(cfg, tOffset + sec);
        });
        const simOk =
          simResults.every((r) => r && r.phaseName) &&
          Object.values(simResults[0].topChannels).every((v) => v === 0) && // 5s IR Dark
          simResults[1].topChannels.WHITE > 0 &&                           // 25s Gamma WHITE
          simResults[3].topChannels.UV === 100 &&                          // 65s Top UV
          simResults[4].bottomChannels.WHITE > 0 &&                        // 78s Sine U_WHITE
          simResults[6].bottomChannels.UV === 100 &&                       // 120s Bot UV
          simResults[7].topChannels.BLUE === 100 && simResults[7].topChannels.RED === 100 && simResults[7].bottomChannels.WHITE === 35 && // 125.02s mixed strobe
          simResults[8].vibration === "U3" &&                              // 140.2s U3 onset
          simResults[9].vibration === "U0" &&                              // 149.2s U0 onset
          simResults[10].audio === "tone" &&                               // 152.2s AUDIO tone onset
          simResults[11].topChannels.WHITE === 100 &&                      // 155s custom WHITE 100% peak (t=0.25)
          simResults[12].audio === "mono" &&                               // 158.2s AUDIO mono onset
          simResults[13].topChannels.WHITE === 50 && simResults[13].bottomChannels.WHITE === 50; // 164.2s finale

        // Differential LED emission verification: RUN_S1 full-state, RUN_S2..SK & STROBE_S* diff-only, & 2-cycle state-machine wraparound!
        const getActionBody = (src, name) => {
          const p = src.split(`ACTION ${name}\n`);
          return p.length > 1 ? p[1].split("\nCOMPLETE")[0] : "";
        };
        const countLedCmds = (txt) =>
          (txt.match(/SET\(X_LED_DRIVE,\d+,\d+\)|LIGHTS\(LIGHT1[3456],(?:ON|OFF)\)/g) || []).length;

        const runS1Body = getActionBody(code, "RUN_S1");
        const runS1Full10Ch = visChs.every((ch) => new RegExp(`SET\\(X_LED_DRIVE,${ch},\\d+\\)`).test(runS1Body));
        const runRestBodies = code.split(/^ACTION RUN_S/gm).slice(2).map((b) => b.split("\nCOMPLETE")[0]);
        const strobeBodies = code.split(/^ACTION STROBE_S/gm).slice(1).map((b) => b.split("\nCOMPLETE")[0]);
        const runRestLedCmds = runRestBodies.reduce((s, b) => s + countLedCmds(b), 0);
        const strobeLedCmds = strobeBodies.reduce((s, b) => s + countLedCmds(b), 0);
        // Mixed 2+10Hz strobe slice (BLUE Ch 1 + RED Ch 5 over steady U_WHITE Ch 12): STROBE_S* must NEVER rewrite untouched Ch 0,3,4,8,9,11,12,13
        const mixedStrobeIdx = code.match(/DEFINE S(\d+)_STROBE_CYCLES\s+\d+\s+#\s*2\+10 Hz/)?.[1];
        const mixedStrobeBody = mixedStrobeIdx ? getActionBody(code, `STROBE_S${mixedStrobeIdx}`) : "";
        const mixedStrobeDiffClean = Boolean(mixedStrobeBody) &&
          mixedStrobeBody.includes("SET(X_LED_DRIVE,1,") &&
          mixedStrobeBody.includes("SET(X_LED_DRIVE,5,") &&
          !/SET\(X_LED_DRIVE,(?:0|3|4|8|9|11|12|13),/.test(mixedStrobeBody);

        // Execute 2 full TIMELINE_CYCLEs via state-machine to verify Cycle 1 -> Cycle 2 wraparound equivalence
        state.stimParams.mpCycles = 2;
        refreshAll();
        const code2Cyc = refreshAll._latestBundle[4].code;
        state.stimParams.mpCycles = 1;
        refreshAll();
        const seqBody = getActionBody(code2Cyc, "TIMELINE_CYCLE");
        const runOrder = [...seqBody.matchAll(/INVOKE\(RUN_S(\d+),1\)/g)].map((m) => parseInt(m[1], 10));
        const hwState = { ch: Object.fromEntries(visChs.map((c) => [c, -1])), gate: { LIGHT13: "", LIGHT14: "", LIGHT15: "", LIGHT16: "" } };
        const applyBlock = (body) => {
          for (const raw of body.split("\n")) {
            const line = raw.trim();
            const dm = line.match(/^SET\(X_LED_DRIVE,(\d+),(\d+)\)$/);
            if (dm) hwState.ch[parseInt(dm[1], 10)] = parseInt(dm[2], 10);
            const gm = line.match(/^LIGHTS\((LIGHT1[3456]),(ON|OFF)\)$/);
            if (gm) hwState.gate[gm[1]] = gm[2];
          }
        };
        const snapHw = () => JSON.stringify(hwState);
        const cycSnaps = [[], []];
        for (let cyc = 0; cyc < 2; cyc++) {
          for (const idx of runOrder) {
            applyBlock(getActionBody(code2Cyc, `RUN_S${idx}`));
            const stBody = getActionBody(code2Cyc, `STROBE_S${idx}`);
            if (stBody) applyBlock(stBody);
            cycSnaps[cyc].push(snapHw());
          }
        }
        const wraparoundStateParity =
          runOrder.length >= 40 &&
          cycSnaps[0].length === cycSnaps[1].length &&
          cycSnaps[0].every((s, i) => s === cycSnaps[1][i]) &&
          JSON.parse(cycSnaps[1][0]).ch[4] === 0 &&
          JSON.parse(cycSnaps[1][0]).ch[12] === 0 &&
          JSON.parse(cycSnaps[1][runOrder.length - 1]).ch[4] === 2048 &&
          JSON.parse(cycSnaps[1][runOrder.length - 1]).ch[12] === 2048;

        const diffLedOk =
          runS1Full10Ch &&
          runRestLedCmds > 0 && runRestLedCmds < 80 &&
          strobeLedCmds > 0 && strobeLedCmds < 70 &&
          mixedStrobeDiffClean &&
          wraparoundStateParity;

        // Round-trip save & reopen preserves all 28 clips
        const saved = buildExperimentPayload();
        applyExperimentData(saved);
        const roundTripOk = state.timelineClips.length === 28 &&
          JSON.stringify(buildExperimentPayload().experiment) === JSON.stringify(saved.experiment);

        return {
          all13Tracks: tracks.size === 13 && clips.length === 28 && overlapCount === 0,
          underShownAndPlatePreserved: state.showUnderTracks === true && state.plateId === "24well" && state.stimParams.mpTimelineSec === 180,
          balancedActions: actionCount > 20 && actionCount === completeCount,
          all10LedChannelsDriven,
          irUntouched,
          all4PortGates,
          hasMixedAnd5HzStrobes,
          hasAll4VibLevels,
          hasBothAudio,
          hasTempStepAndRestore,
          noRunTriggers,
          allTriggersAfterBegin,
          diffLedOk,
          simOk,
          roundTripOk
        };
      });
      const ok = errors.length === 0 && Object.values(rtCheck).every(Boolean);
      report(ok, "Full Hardware Run-Through preset populates all 13 tracks without overlaps, drives all 10 LEDs/strobes/U0-U3/audio/temp & simulates cleanly",
        ok ? "" : JSON.stringify({ errors, rtCheck }));
      await page.close();
    }

    // 6q. Zero-falsy regression suite: preBaselineSec=0 (all 5 protocols), Circadian DD/LL/0L:0D, & autorefTimeout=0
    {
      const { page, errors } = await openFreshPage("#stimulus");
      const zeroRaw = await page.evaluate(() => {
        const setField = (sel, val) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error(`Missing field: ${sel}`);
          el.value = String(val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        const isBalanced = (code) => {
          const a = (code.match(/^ACTION /gm) || []).length;
          const c = (code.match(/^COMPLETE$/gm) || []).length;
          return a > 0 && a === c;
        };
        const hasZeroInvoke = (code) => /INVOKE\([^,]+,\s*0\s*\)/.test(code);

        // 1) preBaselineSec = 0 via UI input across all 5 affected protocols
        const preResults = {};
        const prePayloads = {};
        for (const sid of ["light_off_startle", "light_on_pulse", "vibration_startle", "acoustic_startle", "ppi"]) {
          document.querySelector(`[data-stim="${sid}"]`).click();
          setField('#stimParamsBox [data-sp="preBaselineSec"]', 0);
          const cfg = readConfig();
          const s4 = refreshAll._latestBundle[4];
          const smp = sampleAssayStateAtTime(cfg, 0);
          const segTxts = [...document.querySelectorAll("#timelineBar .tl-seg")].map((el) => el.textContent.trim());
          const saved = buildExperimentPayload();
          applyExperimentData(saved);
          const reopenedPre = state.stimParams.preBaselineSec;

          prePayloads[sid] = saved;
          preResults[sid] = {
            cfgZero: Number(cfg.sp.preBaselineSec) === 0,
            noBaselineDefine: !s4.code.includes("DEFINE BASELINE_BINS"),
            noBaselineInvoke: !s4.code.includes("INVOKE(SAMPLE_BASELINE") && !s4.code.includes("INVOKE(BASELINE_BIN"),
            noBaselineAction: !s4.code.includes("ACTION SAMPLE_BASELINE") && !s4.code.includes("ACTION BASELINE_BIN"),
            noZeroInvoke: !hasZeroInvoke(s4.code),
            balanced: isBalanced(s4.code),
            runtimeParity: s4.totalRuntimeSec === smp.totalRuntimeSec,
            noTimelineBaseSeg: !segTxts.some((t) => /^Base/i.test(t)),
            roundTripZero: Number(reopenedPre) === 0
          };
        }

        // 2) Circadian DD (0L:24D) with circRampMin = 15
        document.querySelector('[data-stim="circadian"]').click();
        setField('#stimParamsBox [data-sp="lightHours"]', 0);
        setField('#stimParamsBox [data-sp="darkHours"]', 24);
        setField('#stimParamsBox [data-sp="numDays"]', 2);
        setField('#stimParamsBox [data-sp="circRampMin"]', 15);
        const cfgDD = readConfig();
        const s3DD = refreshAll._latestBundle[3].code;
        const s4DD = refreshAll._latestBundle[4];
        const smpDDAutoref = sampleAssayStateAtTime(cfgDD, 10);
        const smpDDRec = sampleAssayStateAtTime(cfgDD, 300 + 3600);
        const tlDDCls = [...document.querySelectorAll("#timelineBar .tl-seg")].map((el) => el.className);
        const tlDDDesc = document.getElementById("timelineDesc").textContent;
        const savedDD = buildExperimentPayload();
        // Check preflight suppresses Z3 UV notice (usesUv=false) & Z2 Dawn/Dusk ramp warn on DD
        setField("#hwVersion", "Z3");
        setField("#ledColor", "UV");
        const ddUvChecks = computePreflightChecks();
        setField("#hwVersion", "Z2");
        setField("#ledColor", "WHITE");
        const ddZ2Checks = computePreflightChecks();
        setField("#hwVersion", "Z3");
        setField("#ledColor", "WHITE");
        applyExperimentData(savedDD);
        const ddReopenOk = Number(state.stimParams.lightHours) === 0 && Number(state.stimParams.darkHours) === 24;

        const ddResult = {
          slugOk: s4DD.code.includes("circadian_0l24d_2d") && !s4DD.code.includes("_ramp15m"),
          startsDark: s3DD.includes("INVOKE(LIGHTS_OFF,1)") && !s3DD.includes("INVOKE(LIGHTS_ON,1)") &&
            s4DD.code.split("ACTION MAIN")[1].split("COMPLETE")[0].includes("INVOKE(LIGHTS_OFF,1)"),
          omitsLightAndRamp: !s4DD.code.includes("DEFINE LIGHT_HOURS") && !s4DD.code.includes("INVOKE(RUN_HOUR,LIGHT_HOURS)") &&
            !s4DD.code.includes("DAWN") && !s4DD.code.includes("DUSK"),
          noZeroInvoke: !hasZeroInvoke(s4DD.code),
          balanced: isBalanced(s4DD.code),
          samplerParity: s4DD.totalRuntimeSec === smpDDAutoref.totalRuntimeSec &&
            Object.values(smpDDAutoref.topChannels).every((v) => v === 0) &&
            Object.values(smpDDRec.topChannels).every((v) => v === 0),
          timelineDD: tlDDCls.length > 0 && tlDDCls.every((c) => c.includes("tl-dark")) &&
            tlDDDesc.includes("0h") && tlDDDesc.includes("24h Dark") && !tlDDDesc.includes("dawn/dusk"),
          preflightSuppress: !ddUvChecks.some((c) => /UV/i.test(c.title)) && !ddZ2Checks.some((c) => /Dawn\/Dusk/i.test(c.title)),
          roundTripOk: ddReopenOk
        };

        // 3) Circadian LL (24L:0D) with circRampMin = 15
        setField('#stimParamsBox [data-sp="lightHours"]', 24);
        setField('#stimParamsBox [data-sp="darkHours"]', 0);
        setField('#stimParamsBox [data-sp="numDays"]', 2);
        setField('#stimParamsBox [data-sp="circRampMin"]', 15);
        const cfgLL = readConfig();
        const s4LL = refreshAll._latestBundle[4];
        const smpLLRec = sampleAssayStateAtTime(cfgLL, 300 + 3600);
        const tlLLCls = [...document.querySelectorAll("#timelineBar .tl-seg")].map((el) => el.className);
        const tlLLDesc = document.getElementById("timelineDesc").textContent;
        const savedLL = buildExperimentPayload();
        applyExperimentData(savedLL);
        const llReopenOk = Number(state.stimParams.lightHours) === 24 && Number(state.stimParams.darkHours) === 0;

        const llResult = {
          slugOk: s4LL.code.includes("circadian_24l0d_2d") && !s4LL.code.includes("_ramp15m"),
          omitsDarkAndRamp: !s4LL.code.includes("DEFINE DARK_HOURS") && !s4LL.code.includes("INVOKE(RUN_HOUR,DARK_HOURS)") &&
            !s4LL.code.includes("DAWN") && !s4LL.code.includes("DUSK"),
          noZeroInvoke: !hasZeroInvoke(s4LL.code),
          balanced: isBalanced(s4LL.code),
          samplerParity: s4LL.totalRuntimeSec === smpLLRec.totalRuntimeSec && smpLLRec.topChannels.WHITE === 100,
          timelineLL: tlLLCls.length > 0 && tlLLCls.every((c) => !c.includes("tl-dark") && !c.includes("tl-dawn")) &&
            tlLLDesc.includes("24h") && tlLLDesc.includes("0h Dark") && !tlLLDesc.includes("dawn/dusk"),
          roundTripOk: llReopenOk
        };

        // 4) Circadian 0L:0D graceful degradation + preflight warning
        setField('#stimParamsBox [data-sp="lightHours"]', 0);
        setField('#stimParamsBox [data-sp="darkHours"]', 0);
        const cfg00 = readConfig();
        const s400 = refreshAll._latestBundle[4];
        const smp00 = sampleAssayStateAtTime(cfg00, 100);
        const checks00 = computePreflightChecks();
        const saved00 = buildExperimentPayload();
        const tl00Segs = [...document.querySelectorAll("#timelineBar .tl-seg")].map((el) => ({
          cls: el.className,
          txt: el.textContent.trim(),
          flex: el.style.flex
        }));

        const zeroCircResult = {
          preflightWarn: checks00.some((c) => c.level === "warn" && c.title.includes("Both Light Hours and Dark Hours are 0")),
          noNaN: !s400.code.includes("NaN") && Number.isFinite(smp00.totalRuntimeSec) && Number.isFinite(smp00.tempC),
          noZeroInvoke: !hasZeroInvoke(s400.code),
          balanced: isBalanced(s400.code),
          runtimeAndRows: s400.totalRuntimeSec === 300 && s400.totalRows === 0 && smp00.totalRuntimeSec === 300,
          startsDark: s400.code.split("ACTION MAIN")[1].split("COMPLETE")[0].includes("INVOKE(LIGHTS_OFF,1)"),
          timelineSafe: tl00Segs.length === 1 && tl00Segs[0].txt === "Autoref" && tl00Segs[0].cls.includes("tl-dark") && !String(tl00Segs[0].flex).includes("NaN")
        };

        // 5) Bonus zero-falsy fix: #autorefTimeout = 0 (js/read-config.js)
        document.querySelector('[data-stim="baseline"]').click();
        setField("#autorefTimeout", 0);
        const cfgAr = readConfig();
        const s3Ar = refreshAll._latestBundle[3].code;
        const s4Ar = refreshAll._latestBundle[4];
        const smpAr = sampleAssayStateAtTime(cfgAr, 0);
        const savedAr = buildExperimentPayload();
        applyExperimentData(savedAr);
        const arReopenVal = document.getElementById("autorefTimeout").value;
        const autorefResult = {
          cfgZero: cfgAr.autorefTimeout === 0,
          step3Zero: s3Ar.includes("DEFINE AUTOREF_TIME 0"),
          step4Zero: s4Ar.code.includes("SET(AUTOREF_TIMEOUT,0)"),
          runtimeParity: s4Ar.totalRuntimeSec === smpAr.totalRuntimeSec &&
            s4Ar.totalRuntimeSec === (parseIntOr(cfgAr.sp.acclimSec, 0) + parseIntOr(cfgAr.sp.durationSec, 600)),
          roundTripZero: String(arReopenVal) === "0" && readConfig().autorefTimeout === 0
        };

        return { preResults, prePayloads, ddResult, savedDD, llResult, savedLL, zeroCircResult, saved00, autorefResult };
      });

      // Verify analyzer-core.js schedule parity across all 5 preBaselineSec=0 payloads + DD / LL / 0L:0D in the real Analyzer page!
      const azPage = await browser.newPage();
      await azPage.goto(pathToFileURL(path.join(root, "zantiks_csv_analyzer.html")).href);
      await azPage.waitForFunction(() => window.ZANTIKS_ANALYZER_CORE);
      const { analyzerPreOk, analyzerCircOk } = await azPage.evaluate((zr) => {
        const core = window.ZANTIKS_ANALYZER_CORE;
        const preOk = {};
        for (const sid of ["light_off_startle", "light_on_pulse", "vibration_startle", "acoustic_startle", "ppi"]) {
          const ctx = core.parseExperimentContext(zr.prePayloads[sid], "test");
          const noBaselinePhase = !ctx.phaseSchedule.some((p) => p.kind === "baseline" || /baseline/i.test(p.label));
          const firstStimAt0 = ctx.stimulusEvents.length > 0 && ctx.stimulusEvents[0].timeSec === 0;
          preOk[sid] = noBaselinePhase && firstStimAt0;
        }
        const ctxDD = core.parseExperimentContext(zr.savedDD, "test");
        const ctxLL = core.parseExperimentContext(zr.savedLL, "test");
        const ctx00 = core.parseExperimentContext(zr.saved00, "test");
        const circOk = {
          ddPureDark: ctxDD.phaseSchedule.length === 2 && ctxDD.phaseSchedule.every((p) => p.kind === "dark") && ctxDD.phaseSchedule[1].endSec === 172800,
          llPureLight: ctxLL.phaseSchedule.length === 2 && ctxLL.phaseSchedule.every((p) => p.kind === "light") && ctxLL.phaseSchedule[1].endSec === 172800,
          zeroEmptyClean: ctx00.phaseSchedule.length === 0 && ctx00.tempSchedule.length === 0
        };
        return { analyzerPreOk: preOk, analyzerCircOk: circOk };
      }, zeroRaw);
      await azPage.close();

      const allPreOk = Object.values(zeroRaw.preResults).every((r) => Object.values(r).every(Boolean)) &&
        Object.values(analyzerPreOk).every(Boolean);
      const ok =
        errors.length === 0 &&
        allPreOk &&
        Object.values(zeroRaw.ddResult).every(Boolean) &&
        Object.values(zeroRaw.llResult).every(Boolean) &&
        Object.values(zeroRaw.zeroCircResult).every(Boolean) &&
        Object.values(zeroRaw.autorefResult).every(Boolean) &&
        Object.values(analyzerCircOk).every(Boolean);
      report(ok, "Zero-falsy inputs (preBaselineSec=0 across 5 protocols, Circadian DD/LL/0L:0D & autorefTimeout=0) match across Builder, Simulator, Timeline & Analyzer",
        ok ? "" : JSON.stringify({ errors, preResults: zeroRaw.preResults, analyzerPreOk, ddResult: zeroRaw.ddResult, llResult: zeroRaw.llResult, zeroCircResult: zeroRaw.zeroCircResult, autorefResult: zeroRaw.autorefResult, analyzerCircOk }));
      await page.close();
    }

    // 6r. Circadian exact-timing execution simulator: 24.000h T-cycles (Dawn/Dusk absorbed), asymmetric 3300s split + HOUR_PAD_SEC, 1L:1D edge case & preflight notices
    {
      const { page, errors } = await openFreshPage("#stimulus");
      const circRaw = await page.evaluate(() => {
        const setField = (sel, val) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error(`Missing field: ${sel}`);
          el.value = String(val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };

        // Parse and simulate Circadian .zs execution from ACTION MAIN assuming AUTOREFERENCE() = 300s
        const simCircadianZs = (code) => {
          const defs = {};
          for (const m of code.matchAll(/^DEFINE\s+(\S+)\s+([0-9.]+)/gm)) {
            defs[m[1]] = parseFloat(m[2]);
          }
          const resolveNum = (tok) => (defs[tok] !== undefined ? defs[tok] : parseFloat(tok));
          const actions = {};
          for (const m of code.matchAll(/^ACTION\s+(\S+)\n([\s\S]*?)^COMPLETE$/gm)) {
            actions[m[1]] = m[2].split("\n").map((l) => l.trim()).filter(Boolean);
          }
          const actionCount = (code.match(/^ACTION /gm) || []).length;
          const completeCount = (code.match(/^COMPLETE$/gm) || []).length;
          const hasZeroInvoke = /INVOKE\([^,]+,\s*0\s*\)/.test(code);

          let totalSec = 0;
          let initLightState = null;
          let firstAutorefLightState = null;
          let curPhase = null; // 1 = light, 0 = dark
          let curDay = null;
          const daysLog = [];
          const execAction = (name) => {
            const lines = actions[name] || [];
            for (const line of lines) {
              if (line === "INVOKE(LIGHTS_ON,1)") {
                if (firstAutorefLightState === null) initLightState = "ON";
                continue;
              }
              if (line === "INVOKE(LIGHTS_OFF,1)") {
                if (firstAutorefLightState === null) initLightState = "OFF";
                continue;
              }
              if (line === "@PHASE_VAR = 1") { curPhase = 1; continue; }
              if (line === "@PHASE_VAR = 0") { curPhase = 0; continue; }
              if (line === "AUTOREFERENCE()") {
                if (firstAutorefLightState === null) firstAutorefLightState = initLightState;
                totalSec += 300;
                if (curDay) {
                  if (curPhase === 1) curDay.lightSec += 300;
                  else if (curPhase === 0) curDay.darkSec += 300;
                }
                continue;
              }
              const wm = line.match(/^WAIT\(([^)]+)\)$/);
              if (wm) {
                const dt = resolveNum(wm[1]);
                totalSec += dt;
                if (curDay) {
                  if (curPhase === 1) curDay.lightSec += dt;
                  else if (curPhase === 0) curDay.darkSec += dt;
                }
                continue;
              }
              const im = line.match(/^INVOKE\(([^,]+),([^)]+)\)$/);
              if (im) {
                const target = im[1].trim();
                const count = Math.round(resolveNum(im[2].trim()));
                if (target === "RUN_DAY") {
                  for (let d = 0; d < count; d++) {
                    curDay = { lightSec: 0, darkSec: 0 };
                    curPhase = null;
                    execAction("RUN_DAY");
                    daysLog.push(curDay);
                    curDay = null;
                  }
                } else if (actions[target]) {
                  for (let k = 0; k < count; k++) execAction(target);
                }
              }
            }
          };
          execAction("MAIN");
          const dawnStepCount = ((actions.DAWN_RAMP || []).filter((l) => l.startsWith("INVOKE(SAMPLE_DAWN,"))).length;
          return {
            totalSec,
            daysLog,
            firstAutorefLightState,
            dawnStepCount,
            hasRunHourAction: Boolean(actions.RUN_HOUR),
            hasZeroInvoke,
            balanced: actionCount > 0 && actionCount === completeCount
          };
        };

        document.querySelector('[data-stim="circadian"]').click();

        // 1) 12L:12D, 7 days, bin=10s, rampMin = 0, 15, 30
        const sevenDayResults = {};
        const sevenDayPayloads = {};
        for (const rampMin of [0, 15, 30]) {
          setField('#stimParamsBox [data-sp="lightHours"]', 12);
          setField('#stimParamsBox [data-sp="darkHours"]', 12);
          setField('#stimParamsBox [data-sp="numDays"]', 7);
          setField('#stimParamsBox [data-sp="circBinSec"]', 10);
          setField('#stimParamsBox [data-sp="circRampMin"]', rampMin);
          const cfg = readConfig();
          const s4 = refreshAll._latestBundle[4];
          const sim = simCircadianZs(s4.code);
          const smpInit = sampleAssayStateAtTime(cfg, 100);
          const tlDesc = document.getElementById("timelineDesc").textContent;
          const tlLastEnd = Number(document.querySelector("#timelineBar .tl-seg:last-child")?.dataset?.t1 || s4.totalRuntimeSec);
          sevenDayPayloads[rampMin] = buildExperimentPayload();
          sevenDayResults[rampMin] = {
            balancedAndNoZero: sim.balanced && !sim.hasZeroInvoke,
            exactTotal: sim.totalSec === 605100 && s4.totalRuntimeSec === 605100 && smpInit.totalRuntimeSec === 605100 && tlLastEnd === 605100,
            all7DaysExact: sim.daysLog.length === 7 && sim.daysLog.every((d) => d.lightSec === 43200 && d.darkSec === 43200),
            initAutorefLightOk: rampMin > 0
              ? (sim.firstAutorefLightState === "OFF" && Object.values(smpInit.topChannels).every((v) => v === 0))
              : (sim.firstAutorefLightState === "ON" && smpInit.topChannels.WHITE === 100),
            descCopyOk: rampMin > 0 ? tlDesc.includes(`(incl. ${rampMin}m dawn/dusk)`) : !tlDesc.includes("dawn/dusk")
          };
        }

        // 2) Bins [10, 7, 20, 45, 60, 300, 600] x rampMin [0, 30] -> EVERY SINGLE ONE exact 3600s/h & 86400s/day
        const binMatrixResults = {};
        const binSpecificChecks = {};
        setField('#stimParamsBox [data-sp="lightHours"]', 12);
        setField('#stimParamsBox [data-sp="darkHours"]', 12);
        setField('#stimParamsBox [data-sp="numDays"]', 1);
        for (const bin of [10, 7, 20, 45, 60, 300, 600]) {
          for (const rampMin of [0, 30]) {
            setField('#stimParamsBox [data-sp="circBinSec"]', bin);
            setField('#stimParamsBox [data-sp="circRampMin"]', rampMin);
            const s4 = refreshAll._latestBundle[4];
            const sim = simCircadianZs(s4.code);
            const checks = computePreflightChecks();
            const key = `b${bin}_r${rampMin}`;
            binMatrixResults[key] =
              sim.balanced &&
              !sim.hasZeroInvoke &&
              sim.totalSec === 86700 &&
              s4.totalRuntimeSec === 86700 &&
              sim.daysLog.length === 1 &&
              sim.daysLog[0].lightSec === 43200 &&
              sim.daysLog[0].darkSec === 43200;

            if (bin === 20 && rampMin === 0) {
              binSpecificChecks.b20 = s4.code.includes("DEFINE FIRST_HALF_BINS 83") &&
                s4.code.includes("DEFINE SECOND_HALF_BINS 82") &&
                !s4.code.includes("HOUR_PAD_SEC") &&
                !checks.some((c) => c.title.includes("unbinned wait per hour"));
            }
            if (bin === 60 && rampMin === 0) {
              binSpecificChecks.b60 = s4.code.includes("DEFINE FIRST_HALF_BINS 28") &&
                s4.code.includes("DEFINE SECOND_HALF_BINS 27") &&
                !s4.code.includes("HOUR_PAD_SEC") &&
                !checks.some((c) => c.title.includes("unbinned wait per hour"));
            }
            if (bin === 7 && rampMin === 0) {
              binSpecificChecks.b7 = s4.code.includes("DEFINE FIRST_HALF_BINS 236") &&
                s4.code.includes("DEFINE SECOND_HALF_BINS 235") &&
                s4.code.includes("DEFINE HOUR_PAD_SEC 3") &&
                checks.some((c) => c.level === "info" && c.title === "Time bin (7 s) adds 3 s unbinned wait per hour");
            }
            if (bin === 45 && rampMin === 0) {
              binSpecificChecks.b45 = s4.code.includes("DEFINE FIRST_HALF_BINS 37") &&
                s4.code.includes("DEFINE SECOND_HALF_BINS 36") &&
                s4.code.includes("DEFINE HOUR_PAD_SEC 15") &&
                checks.some((c) => c.level === "info" && c.title === "Time bin (45 s) adds 15 s unbinned wait per hour");
            }
            if (bin === 600 && rampMin === 30) {
              binSpecificChecks.b600r30 = sim.dawnStepCount === 5 && !sim.hasZeroInvoke && s4.code.includes("DEFINE HOUR_PAD_SEC 300");
            }
          }
        }

        // 3) Edge case 1L:1D with rampMin = 15: exact 7,200s/day, NO INVOKE(RUN_HOUR,0), NO unused ACTION RUN_HOUR
        setField('#stimParamsBox [data-sp="lightHours"]', 1);
        setField('#stimParamsBox [data-sp="darkHours"]', 1);
        setField('#stimParamsBox [data-sp="numDays"]', 1);
        setField('#stimParamsBox [data-sp="circBinSec"]', 10);
        setField('#stimParamsBox [data-sp="circRampMin"]', 15);
        const s4_1L1D = refreshAll._latestBundle[4];
        const sim1L1D = simCircadianZs(s4_1L1D.code);
        const checks1L1D = computePreflightChecks();
        const edge1L1DOk =
          sim1L1D.balanced &&
          !sim1L1D.hasZeroInvoke &&
          !s4_1L1D.code.includes("INVOKE(RUN_HOUR,0)") &&
          !sim1L1D.hasRunHourAction &&
          sim1L1D.totalSec === 7500 &&
          s4_1L1D.totalRuntimeSec === 7500 &&
          sim1L1D.daysLog.length === 1 &&
          sim1L1D.daysLog[0].lightSec === 3600 &&
          sim1L1D.daysLog[0].darkSec === 3600;

        // 4) Preflight AUTOREF_MODE,2 pacing note: present on active circadian, omitted on 0L:0D
        const hasAutorefNoteActive = checks1L1D.some((c) => c.level === "info" && c.title === "Hourly pacing assumes AUTOREF_MODE,2 runs full 300 s");
        setField('#stimParamsBox [data-sp="lightHours"]', 0);
        setField('#stimParamsBox [data-sp="darkHours"]', 0);
        const checks0L0D = computePreflightChecks();
        const omitsAutorefNote0L0D = !checks0L0D.some((c) => c.title === "Hourly pacing assumes AUTOREF_MODE,2 runs full 300 s");

        return {
          sevenDayResults,
          sevenDayPayloads,
          binMatrixResults,
          binSpecificChecks,
          edge1L1DOk,
          preflightAutorefOk: hasAutorefNoteActive && omitsAutorefNote0L0D
        };
      });

      // Verify analyzer-core.js schedule matches exact 86,400s/day & 604,800s (7 days) with Dawn/Dusk absorbed!
      const azPage = await browser.newPage();
      await azPage.goto(pathToFileURL(path.join(root, "zantiks_csv_analyzer.html")).href);
      await azPage.waitForFunction(() => window.ZANTIKS_ANALYZER_CORE);
      const analyzerCircParity = await azPage.evaluate((payloads) => {
        const core = window.ZANTIKS_ANALYZER_CORE;
        const out = {};
        for (const rampMin of [0, 15, 30]) {
          const ctx = core.parseExperimentContext(payloads[rampMin], "test");
          const totalDur = ctx.phaseSchedule.length ? ctx.phaseSchedule[ctx.phaseSchedule.length - 1].endSec : 0;
          const hasDawnDuskPhases = rampMin > 0
            ? (ctx.phaseSchedule.filter((p) => p.phase === "DAWN").length === 7 && ctx.phaseSchedule.filter((p) => p.phase === "DUSK").length === 7)
            : (ctx.phaseSchedule.length === 14);
          // Every day's Light block (DAWN + LIGHT) = 43200s and Dark block (DUSK + DARK) = 43200s
          const lightTotal = ctx.phaseSchedule.filter((p) => p.phase === "DAWN" || p.kind === "light").reduce((s, p) => s + (p.endSec - p.startSec), 0);
          const darkTotal = ctx.phaseSchedule.filter((p) => p.phase === "DUSK" || p.kind === "dark").reduce((s, p) => s + (p.endSec - p.startSec), 0);
          out[rampMin] = totalDur === 7 * 86400 && hasDawnDuskPhases && lightTotal === 7 * 43200 && darkTotal === 7 * 43200;
        }
        return out;
      }, circRaw.sevenDayPayloads);
      await azPage.close();

      const ok =
        errors.length === 0 &&
        Object.values(circRaw.sevenDayResults).every((r) => Object.values(r).every(Boolean)) &&
        Object.values(circRaw.binMatrixResults).every(Boolean) &&
        Object.values(circRaw.binSpecificChecks).every(Boolean) &&
        circRaw.edge1L1DOk &&
        circRaw.preflightAutorefOk &&
        Object.values(analyzerCircParity).every(Boolean);
      report(ok, "Circadian exact timing (absorbed Dawn/Dusk 24.000h T-cycles, asymmetric 3300s split + HOUR_PAD_SEC across bins 7..600s, 1L:1D & preflight) passes",
        ok ? "" : JSON.stringify({ errors, sevenDayResults: circRaw.sevenDayResults, binMatrixResults: circRaw.binMatrixResults, binSpecificChecks: circRaw.binSpecificChecks, edge1L1DOk: circRaw.edge1L1DOk, preflightAutorefOk: circRaw.preflightAutorefOk, analyzerCircParity }));
      await page.close();
    }

    // ---------------------------------------------------------------- 7. CSV Analyzer companion page
    const analyzerUrl = pathToFileURL(path.join(root, "zantiks_csv_analyzer.html")).href;

    async function openFreshAnalyzer({ clearStorage = true } = {}) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.goto(analyzerUrl);
      if (clearStorage) {
        await page.evaluate(() => localStorage.clear());
        await page.reload();
      }
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_CORE && window.ZANTIKS_ANALYZER_UI);
      return { page, errors };
    }

    // 7a. Offline file:// load, .suite-nav navigation, 5-step wizard (stepper/hash/sidebar/empty states), zero errors & zero input[placeholder]
    {
      const { page, errors } = await openFreshPage("#study");
      await page.setViewportSize({ width: 1280, height: 900 });
      const builderState = await page.evaluate(() => ({
        placeholders: document.querySelectorAll("input[placeholder]").length,
        navCount: document.querySelectorAll(".suite-nav .suite-nav-link").length,
        activeHref: document.querySelector(".suite-nav .suite-nav-link.active")?.getAttribute("href"),
        noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth
      }));

      await page.click('.suite-nav a[href="zantiks_csv_analyzer.html"]');
      await page.waitForFunction(() => location.pathname.endsWith("zantiks_csv_analyzer.html") && window.ZANTIKS_ANALYZER_UI && window.ZANTIKS_ANALYZER_CORE);
      const analyzerState = await page.evaluate(() => ({
        placeholders: document.querySelectorAll("input[placeholder]").length,
        navCount: document.querySelectorAll(".suite-nav .suite-nav-link").length,
        activeHref: document.querySelector(".suite-nav .suite-nav-link.active")?.getAttribute("href"),
        stepCount: document.querySelectorAll("#analyzerStepper .stepper-item").length,
        activeStep: document.querySelector(".wizard-page.active")?.dataset.page,
        progress: document.getElementById("wizProgress")?.textContent.trim(),
        noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth
      }));

      // Step through wizard via Next, Stepper, Right Sidebar & URL hash; verify empty state on Steps 2-5 with no CSV loaded
      await page.click("#wizNextBtn");
      const qcEmptyOk = await page.evaluate(() => {
        const pg = document.querySelector('.wizard-page.active[data-page="qc"]');
        return Boolean(pg && getComputedStyle(pg.querySelector("[data-requires-csv-empty]")).display !== "none" && location.hash === "#qc");
      });
      await page.click('.summary-row[data-goto="plots"]');
      const plotsSidebarOk = await page.evaluate(() =>
        document.querySelector(".wizard-page.active")?.dataset.page === "plots" &&
        document.querySelector('.summary-row.current')?.dataset.goto === "plots" &&
        location.hash === "#plots"
      );
      await page.click('#analyzerStepper [data-goto="export"]');
      const exportStepOk = await page.evaluate(() =>
        document.querySelector(".wizard-page.active")?.dataset.page === "export" &&
        document.getElementById("wizProgress")?.textContent.trim() === "5 / 5"
      );
      await page.click('.wizard-page[data-page="export"] [data-goto="data"]');
      const backToDataOk = await page.evaluate(() => document.querySelector(".wizard-page.active")?.dataset.page === "data");

      await page.click('.suite-nav a[href="zantiks_script_generator.html"]');
      await page.waitForFunction(() => location.pathname.endsWith("zantiks_script_generator.html") && window.refreshAll && window.refreshAll._latestBundle);
      const returnedToBuilder = await page.evaluate(() =>
        document.querySelector(".suite-nav .suite-nav-link.active")?.getAttribute("href") === "zantiks_script_generator.html"
      );

      const ok =
        errors.length === 0 &&
        builderState.placeholders === 0 &&
        builderState.navCount === 2 &&
        builderState.activeHref === "zantiks_script_generator.html" &&
        builderState.noOverflow &&
        analyzerState.placeholders === 0 &&
        analyzerState.navCount === 2 &&
        analyzerState.activeHref === "zantiks_csv_analyzer.html" &&
        analyzerState.stepCount === 5 &&
        analyzerState.activeStep === "data" &&
        analyzerState.progress === "1 / 5" &&
        analyzerState.noOverflow &&
        qcEmptyOk &&
        plotsSidebarOk &&
        exportStepOk &&
        backToDataOk &&
        returnedToBuilder;
      report(ok, "CSV Analyzer 5-step wizard loads over file:// with zero errors, navigates via stepper/sidebar/hash/.suite-nav, and has zero input[placeholder]",
        ok ? "" : JSON.stringify({ errors, builderState, analyzerState, qcEmptyOk, plotsSidebarOk, exportStepOk, backToDataOk, returnedToBuilder }));
      await page.close();
    }

    // 7b. Demo ld_24w across all 5 steps: Overview, QC (D5 empty & D6 spike + Exclude Flagged + Temp), Groups, Plots (3 tabs), VMR & Zone Pref
    {
      const { page, errors } = await openFreshAnalyzer();
      await page.click('#step1DemoCards [data-demo="ld_24w"]');
      const step1OverviewOk = await page.evaluate(() =>
        document.querySelector(".wizard-page.active")?.dataset.page === "data" &&
        getComputedStyle(document.getElementById("loadedOverviewGrid")).display !== "none"
      );

      // Step 2: QC
      await page.click('#analyzerStepper [data-goto="qc"]');
      const beforeExcl = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const a = st.analysis;
        const p = st.summaryParsed;
        const ctrl = a.groups.find((g) => g.group === "Control");
        const d10Series = a.timeSeries.series.find((s) => s.group === "Drug 10uM");
        const d10Max = Math.max(...d10Series.values.map((v) => v.mean || 0));
        const a1 = a.wellsById.A1;
        const expectedPi = (a1.zones.z2Pct - a1.zones.z1Pct) / (a1.zones.z1Pct + a1.zones.z2Pct);
        return {
          totalWells: a.kpis.totalWells,
          activeWells: a.kpis.activeWells,
          emptyCount: a.kpis.emptyCount,
          spikeCount: a.kpis.spikeCount,
          flaggedCount: a.kpis.flaggedCount,
          d5Empty: Boolean(p.qc.D5 && p.qc.D5.isEmpty),
          d6Spike: Boolean(p.qc.D6 && p.qc.D6.isSpikeGlitch && p.qc.D6.spikeCount >= 1),
          tempOk: a.kpis.targetTempC === 28 && a.kpis.tempMin > 25 && a.kpis.tempMax < 31,
          vmrOk: Boolean(a.capabilities.hasVmr && ctrl && ctrl.vmr.darkMean.mean > ctrl.vmr.lightMean.mean && ctrl.vmr.darkMinusLight.mean > 0 && ctrl.vmr.darkOnsetBurst.mean > 0),
          zoneOk: Boolean(
            a.capabilities.hasZones &&
            a.capabilities.maxZone === 2 &&
            Math.abs((a1.zones.z1Pct + a1.zones.z2Pct) - 100) < 0.25 &&
            Math.abs(a1.zones.preferenceIndex - expectedPi) < 0.02 &&
            ctrl.zones.z1Pct.mean > 55
          ),
          d10Max,
          qcPlateHits: document.querySelectorAll("#qcPlateSvg .az-well-hit").length,
          tempPaths: document.querySelectorAll("#tempChartSvg path").length,
          anomalyRows: document.querySelectorAll("#qcAnomalyBody tr").length
        };
      });

      await page.click("#excludeFlaggedBtn");
      const afterExcl = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const a = st.analysis;
        const d10 = a.groups.find((g) => g.group === "Drug 10uM");
        const d10Series = a.timeSeries.series.find((s) => s.group === "Drug 10uM");
        const d10Max = Math.max(...d10Series.values.map((v) => v.mean || 0));
        return {
          activeWells: a.kpis.activeWells,
          excludedWells: a.kpis.excludedWells,
          kpiText: document.getElementById("kpiActiveWells").textContent.trim(),
          sidebarStat: document.getElementById("statActiveWells").textContent.trim(),
          d10N: d10 ? d10.n : -1,
          d10Max
        };
      });

      // Step 3: Groups (check brush SVG & zero placeholders)
      await page.click('#analyzerStepper [data-goto="groups"]');
      const groupsStepCheck = await page.evaluate(() => ({
        brushHits: document.querySelectorAll("#brushPlateSvg .az-well-hit").length,
        placeholders: document.querySelectorAll("input[placeholder]").length
      }));

      // Step 4: Plots (all 3 tabs + metric switching + bin smoothing)
      await page.click('#analyzerStepper [data-goto="plots"]');
      const tsInitialCheck = await page.evaluate(() => {
        const texts = [...document.querySelectorAll("#tsChartSvg text")].map((el) => el.textContent.trim());
        const xTicks = texts.filter((t) => /^\d+[smh](\s+\d+[sm])?$/.test(t));
        const hasColonTick = texts.some((t) => /^\d+:\d{2}$/.test(t));
        const tempTexts = [...document.querySelectorAll("#tempChartSvg text")].map((el) => el.textContent.trim());
        const tempTicks = tempTexts.filter((t) => /^\d+[smh](\s+\d+[sm])?$/.test(t));
        const tempHasColon = tempTexts.some((t) => /^\d+:\d{2}$/.test(t));
        return {
          paths: document.querySelectorAll("#tsChartSvg path").length,
          xTicks,
          hasColonTick,
          hasElapsedLabel: texts.some((t) => t === "Elapsed Time (10s bins)"),
          tempTicks,
          tempHasColon
        };
      });
      const tsInitialPaths = tsInitialCheck.paths;
      await page.selectOption("#tsMetricSel", "msd");
      await page.selectOption("#tsSmoothSel", "5");
      const tsSmoothedPaths = await page.evaluate(() => document.querySelectorAll("#tsChartSvg path").length);
      await page.selectOption("#tsMetricSel", "z2_pct");
      const tsZonePaths = await page.evaluate(() => document.querySelectorAll("#tsChartSvg path").length);

      await page.click('#chartTabsBar [data-chart-tab="comparison"]');
      const compDefault = await page.evaluate(() => ({
        rects: document.querySelectorAll("#compChartSvg rect").length,
        dots: document.querySelectorAll("#compChartSvg .az-scatter-dot").length
      }));
      await page.selectOption("#compViewSel", "vmr");
      const compVmrDots = await page.evaluate(() => document.querySelectorAll("#compChartSvg .az-scatter-dot").length);
      await page.selectOption("#compViewSel", "zone_pref");
      const compZoneDots = await page.evaluate(() => document.querySelectorAll("#compChartSvg .az-scatter-dot").length);

      await page.click('#chartTabsBar [data-chart-tab="zchange"]');
      const zchangeHintVisible = await page.evaluate(() =>
        getComputedStyle(document.getElementById("zchangeEmptyHint")).display !== "none" &&
        getComputedStyle(document.getElementById("zchangeContent")).display === "none"
      );

      const ok =
        errors.length === 0 &&
        step1OverviewOk &&
        beforeExcl.totalWells === 24 &&
        beforeExcl.activeWells === 24 &&
        beforeExcl.emptyCount === 1 &&
        beforeExcl.spikeCount === 1 &&
        beforeExcl.flaggedCount === 2 &&
        beforeExcl.d5Empty &&
        beforeExcl.d6Spike &&
        beforeExcl.tempOk &&
        beforeExcl.vmrOk &&
        beforeExcl.zoneOk &&
        beforeExcl.qcPlateHits === 24 &&
        beforeExcl.tempPaths >= 1 &&
        beforeExcl.anomalyRows === 2 &&
        afterExcl.activeWells === 22 &&
        afterExcl.excludedWells === 2 &&
        afterExcl.kpiText === "22 / 24" &&
        afterExcl.sidebarStat === "22 / 24" &&
        afterExcl.d10N === 6 &&
        afterExcl.d10Max < beforeExcl.d10Max * 0.5 &&
        groupsStepCheck.brushHits === 24 &&
        groupsStepCheck.placeholders === 0 &&
        tsInitialPaths >= 3 &&
        JSON.stringify(tsInitialCheck.xTicks) === '["0m","5m","10m","15m","20m"]' &&
        !tsInitialCheck.hasColonTick &&
        tsInitialCheck.hasElapsedLabel &&
        JSON.stringify(tsInitialCheck.tempTicks) === '["0m","5m","10m","15m","20m"]' &&
        !tsInitialCheck.tempHasColon &&
        tsSmoothedPaths >= 3 &&
        tsZonePaths >= 3 &&
        compDefault.rects >= 6 &&
        compDefault.dots >= 22 &&
        compVmrDots >= 22 &&
        compZoneDots >= 22 &&
        zchangeHintVisible;
      report(ok, "Analyzer ld_24w demo detects D5 empty & D6 spike, computes VMR & Zone Pref, excludes flagged wells, and renders all wizard steps & plot tabs",
        ok ? "" : JSON.stringify({ errors, step1OverviewOk, beforeExcl, afterExcl, groupsStepCheck, tsInitialCheck, tsSmoothedPaths, tsZonePaths, compDefault, compVmrDots, compZoneDots, zchangeHintVisible }));
      await page.close();
    }

    // 7c. Demo ppi_24w: topbar demo switch stays on active step, exact % PPI & group separation, SVG comparison chart
    {
      const { page, errors } = await openFreshAnalyzer();
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.selectOption("#demoPresetSelect", "ppi_24w");
      await page.click('#chartTabsBar [data-chart-tab="comparison"]');

      const ppiCheck = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        const ctrl = a.groups.find((g) => g.group === "Control");
        const low = a.groups.find((g) => g.group === "Low Dose");
        const mk = a.groups.find((g) => g.group === "MK-801");
        const a1 = a.wellsById.A1;
        const expectedA1Ppi = (1 - a1.startle.ppiTrialMean / a1.startle.pulseAloneMean) * 100;
        return {
          stayedOnPlots: document.querySelector(".wizard-page.active")?.dataset.page === "plots",
          hasPpi: a.capabilities.hasPpi,
          zeroFalseFlags: a.kpis.flaggedCount === 0,
          hasPhases: a.phases.includes("PULSE_ALONE") && a.phases.includes("PPI_TRIAL"),
          stimMarkers: a.timeSeries.stimulusMarkers.length,
          formulaExact: Math.abs(a1.startle.ppiPct - expectedA1Ppi) < 0.15,
          ctrlPpi: ctrl?.startle?.ppiPct?.mean,
          lowPpi: low?.startle?.ppiPct?.mean,
          mkPpi: mk?.startle?.ppiPct?.mean,
          qcPlateHits: document.querySelectorAll("#qcPlateSvg .az-well-hit").length,
          tsPaths: document.querySelectorAll("#tsChartSvg path").length,
          compRects: document.querySelectorAll("#compChartSvg rect").length,
          compDots: document.querySelectorAll("#compChartSvg .az-scatter-dot").length,
          summaryCards: document.querySelectorAll("#compSummaryStrip .az-stat-mini").length
        };
      });

      const ok =
        errors.length === 0 &&
        ppiCheck.stayedOnPlots &&
        ppiCheck.hasPpi &&
        ppiCheck.zeroFalseFlags &&
        ppiCheck.hasPhases &&
        ppiCheck.stimMarkers > 0 &&
        ppiCheck.formulaExact &&
        ppiCheck.ctrlPpi > 60 &&
        ppiCheck.lowPpi > 30 && ppiCheck.lowPpi < ppiCheck.ctrlPpi &&
        ppiCheck.mkPpi < ppiCheck.lowPpi && ppiCheck.mkPpi < 30 &&
        ppiCheck.qcPlateHits === 24 &&
        ppiCheck.tsPaths >= 3 &&
        ppiCheck.compRects >= 3 &&
        ppiCheck.compDots === 24 &&
        ppiCheck.summaryCards === 3;
      report(ok, "Analyzer ppi_24w demo stays on Plots step, computes exact % PPI (Control > Low Dose > MK-801) and renders SVG charts",
        ok ? "" : JSON.stringify({ errors, ppiCheck }));
      await page.close();
    }

    // 7d. Demo ymaze_15: 15-Arena Y-Maze (Z1..Z4) + _ZCHANGE transition matrix & SAB %
    {
      const { page, errors } = await openFreshAnalyzer();
      await page.selectOption("#demoPresetSelect", "ymaze_15");
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click('#chartTabsBar [data-chart-tab="zchange"]');

      const ymCheck = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        const ctrl = a.groups.find((g) => g.group === "Control");
        const scop = a.groups.find((g) => g.group === "Scopolamine");
        const resc = a.groups.find((g) => g.group === "Rescue");
        const mat = a.zchangeSummary?.includedTransitionMatrix || [];
        const matSum = mat.flat().reduce((s, v) => s + (v || 0), 0);
        return {
          hasSummaryChip: Boolean(document.querySelector('[data-rm-file="summary"]')),
          hasZchangeChip: Boolean(document.querySelector('[data-rm-file="zchange"]')),
          isMaze: Boolean(a.layout && a.layout.isMaze),
          wellCount: a.layout ? a.layout.wells.length : 0,
          mazeShapes: a.layout && a.layout.mazeShapes ? a.layout.mazeShapes.length : 0,
          maxZone: a.capabilities.maxZone,
          hasZchange: a.capabilities.hasZchange,
          hasSab: a.capabilities.hasSab,
          qcPlateHits: document.querySelectorAll("#qcPlateSvg .az-well-hit").length,
          brushPlateHits: document.querySelectorAll("#brushPlateSvg .az-well-hit").length,
          ctrlSab: ctrl?.zchange?.sabPct?.mean,
          scopSab: scop?.zchange?.sabPct?.mean,
          rescSab: resc?.zchange?.sabPct?.mean,
          matCells: document.querySelectorAll("#zchangeMatrixSvg rect").length,
          matSum,
          arenaBars: document.querySelectorAll("#zchangeArenaSvg .az-zc-bar").length,
          contentVisible: getComputedStyle(document.getElementById("zchangeContent")).display !== "none"
        };
      });

      await page.click('#chartTabsBar [data-chart-tab="comparison"]');
      const sabCompDots = await page.evaluate(() => document.querySelectorAll("#compChartSvg .az-scatter-dot").length);
      await page.selectOption("#compViewSel", "zone_pref");
      const zonePrefDots = await page.evaluate(() => document.querySelectorAll("#compChartSvg .az-scatter-dot").length);

      const ok =
        errors.length === 0 &&
        ymCheck.hasSummaryChip &&
        ymCheck.hasZchangeChip &&
        ymCheck.isMaze &&
        ymCheck.wellCount === 15 &&
        ymCheck.mazeShapes === 60 &&
        ymCheck.maxZone === 4 &&
        ymCheck.hasZchange &&
        ymCheck.hasSab &&
        ymCheck.qcPlateHits === 15 &&
        ymCheck.brushPlateHits === 15 &&
        ymCheck.ctrlSab > 55 &&
        ymCheck.rescSab > 55 &&
        ymCheck.scopSab < 45 &&
        ymCheck.matCells === 16 &&
        ymCheck.matSum > 0 &&
        ymCheck.arenaBars === 15 &&
        ymCheck.contentVisible &&
        sabCompDots === 15 &&
        zonePrefDots === 60;
      report(ok, "Analyzer ymaze_15 demo renders 15-arena Y-Maze SVG, 4x4 _ZCHANGE transition matrix & accurate group SAB %",
        ok ? "" : JSON.stringify({ errors, ymCheck, sabCompDots, zonePrefDots }));
      await page.close();
    }

    // 7e. Real-world CSV edge cases: UTF-8 BOM, CRLF, pre-header system metadata, trailing commas, Petri (DIST_A1), 96-well wide, multi-zone maze (Z1..Z4 + _ZCHANGE)
    {
      const { page, errors } = await openFreshAnalyzer();

      // 1) UTF-8 BOM + CRLF + pre-header metadata + RFC-4180 quotes + trailing commas + single-arena Petri (DIST_A1)
      const petriCsv =
        "\uFEFF" +
        '"Zantiks MWP, System Export",v3.2\r\n' +
        "Script: 04_qu_pd.zs,Unit: MWP-01\r\n" +
        "\r\n" +
        "RUNTIME,UNIT_ID,TEMP_C,PHASE,TIME_BIN,DIST_A1,MSD_A1,,,\r\n" +
        '10.0,"MWP,01",22.1,LIGHT,1,12.4,45.0,,,\r\n' +
        '20.0,"MWP,01",22.2,LIGHT,2,14.8,51.2,,,\r\n' +
        '30.0,"MWP,01",22.1,LIGHT,3,11.6,40.5,,,\r\n' +
        '40.0,"MWP,01",22.0,DARK,4,24.2,82.1,,,\r\n' +
        '50.0,"MWP,01",22.0,DARK,5,21.5,75.0,,,\r\n' +
        '60.0,"MWP,01",22.1,DARK,6,19.8,70.4,,,\r\n';
      await page.setInputFiles("#analyzerFileInput", {
        name: "petri_bom_crlf.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(petriCsv, "utf8")
      });
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().summaryParsed?.filename === "petri_bom_crlf.csv");
      const petriRes = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          kind: st.summaryParsed.kind,
          wells: st.summaryParsed.wells,
          preHeaderCount: st.summaryParsed.preHeaderLines.length,
          rowCount: st.summaryParsed.rowCount,
          layoutId: st.analysis.layout.id,
          qcPlateHits: document.querySelectorAll("#qcPlateSvg .az-well-hit").length,
          tsPaths: document.querySelectorAll("#tsChartSvg path").length,
          unitIdParsed: st.summaryParsed.rows[0].unitId
        };
      });

      // 2) 96-well wide CSV (A1..H12) with intentional empty well (H11) & spike well (H12)
      const wells96 = [];
      for (let r = 0; r < 8; r++) {
        for (let c = 1; c <= 12; c++) wells96.push(String.fromCharCode(65 + r) + c);
      }
      const wideHeader = ["RUNTIME", "TEMP_C", "PHASE", "TIME_BIN", ...wells96.map((w) => "DIST_" + w), ...wells96.map((w) => "MSD_" + w)].join(",");
      const wideLines = [wideHeader];
      for (let i = 0; i < 12; i++) {
        const dists = wells96.map((w, wi) => {
          if (w === "H11") return "0.00";
          if (w === "H12" && i === 5) return "460.00";
          return (8 + ((wi + i) % 5) * 1.1).toFixed(2);
        });
        const msds = wells96.map((w) => (w === "H11" ? "0.0" : "28.5"));
        wideLines.push([(i + 1) * 10, "28.0", i < 6 ? "LIGHT" : "DARK", i + 1, ...dists, ...msds].join(","));
      }
      await page.setInputFiles("#analyzerFileInput", {
        name: "plate_96w_wide.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(wideLines.join("\n") + "\n", "utf8")
      });
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().summaryParsed?.filename === "plate_96w_wide.csv");
      const wide96Res = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          wellCount: st.summaryParsed.wells.length,
          firstWell: st.summaryParsed.wells[0],
          lastWell: st.summaryParsed.wells[95],
          layoutId: st.analysis.layout.id,
          qcPlateHits: document.querySelectorAll("#qcPlateSvg .az-well-hit").length,
          h11Empty: Boolean(st.summaryParsed.qc.H11 && st.summaryParsed.qc.H11.isEmpty),
          h12Spike: Boolean(st.summaryParsed.qc.H12 && st.summaryParsed.qc.H12.isSpikeGlitch),
          emptyCount: st.analysis.kpis.emptyCount,
          spikeCount: st.analysis.kpis.spikeCount
        };
      });

      // 3) Multi-zone 4-arena maze CSV (Z1..Z4) + companion sparse _ZCHANGE CSV with exact known SAB %
      const mWells = ["A1", "A2", "A3", "A4"];
      const mCols = ["RUNTIME", "TEMP_C", "PHASE", "TIME_BIN"];
      for (const w of mWells) mCols.push("DIST_" + w);
      for (const w of mWells) for (let z = 1; z <= 4; z++) mCols.push(`ZD_${w}_Z${z}`);
      for (const w of mWells) for (let z = 1; z <= 4; z++) mCols.push(`ZC_${w}_Z${z}`);
      for (const w of mWells) for (let z = 1; z <= 4; z++) mCols.push(`ZT_${w}_Z${z}`);
      const mLines = [mCols.join(",")];
      for (let i = 0; i < 6; i++) {
        const row = [(i + 1) * 10, "22.0", "BASELINE", i + 1];
        for (let wi = 0; wi < 4; wi++) row.push((15 + wi).toFixed(2));
        for (let wi = 0; wi < 4; wi++) row.push("4.0", "4.0", "4.0", "3.0");
        for (let wi = 0; wi < 4; wi++) row.push("2", "2", "2", "3");
        for (let wi = 0; wi < 4; wi++) row.push("2.5", "2.5", "2.5", "2.5");
        mLines.push(row.join(","));
      }
      // Sparse Zantiks _ZCHANGE format: A1 arm sequence [1,2,3,1] -> 2/2 alternations (100% SAB); A2 [1,2,1,2] -> 0/2 (0% SAB)
      const zcLines = [
        "TIME,,,ARENA,ACTION,ZONE",
        "1.0,,,A1,ENTER,1", "2.0,,,A1,EXIT,1", "2.1,,,A1,ENTER,4", "3.0,,,A1,EXIT,4",
        "3.1,,,A1,ENTER,2", "4.0,,,A1,EXIT,2", "4.1,,,A1,ENTER,4", "5.0,,,A1,EXIT,4",
        "5.1,,,A1,ENTER,3", "6.0,,,A1,EXIT,3", "6.1,,,A1,ENTER,4", "7.0,,,A1,EXIT,4",
        "7.1,,,A1,ENTER,1",
        "1.0,,,A2,ENTER,1", "2.0,,,A2,ENTER,4", "3.0,,,A2,ENTER,2", "4.0,,,A2,ENTER,4",
        "5.0,,,A2,ENTER,1", "6.0,,,A2,ENTER,4", "7.0,,,A2,ENTER,2"
      ];
      await page.setInputFiles("#analyzerFileInput", [
        { name: "maze4_z1_z4.csv", mimeType: "text/csv", buffer: Buffer.from(mLines.join("\n") + "\n", "utf8") },
        { name: "maze4_z1_z4_ZCHANGE.csv", mimeType: "text/csv", buffer: Buffer.from(zcLines.join("\n") + "\n", "utf8") }
      ]);
      await page.waitForFunction(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return st.summaryParsed?.filename === "maze4_z1_z4.csv" && st.zchangeParsed?.filename === "maze4_z1_z4_ZCHANGE.csv";
      });
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click('#chartTabsBar [data-chart-tab="zchange"]');
      const mazeRes = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          maxZone: st.summaryParsed.maxZone,
          wells: st.summaryParsed.wells,
          zchangeKind: st.zchangeParsed.kind,
          a1Sab: st.analysis.wellsById.A1?.zchange?.sabPct,
          a2Sab: st.analysis.wellsById.A2?.zchange?.sabPct,
          matCells: document.querySelectorAll("#zchangeMatrixSvg rect").length
        };
      });

      const ok =
        errors.length === 0 &&
        petriRes.kind === "summary" &&
        JSON.stringify(petriRes.wells) === '["A1"]' &&
        petriRes.preHeaderCount >= 2 &&
        petriRes.rowCount === 6 &&
        petriRes.layoutId === "petri" &&
        petriRes.qcPlateHits === 1 &&
        petriRes.tsPaths >= 1 &&
        petriRes.unitIdParsed === "MWP,01" &&
        wide96Res.wellCount === 96 &&
        wide96Res.firstWell === "A1" &&
        wide96Res.lastWell === "H12" &&
        wide96Res.layoutId === "96well" &&
        wide96Res.qcPlateHits === 96 &&
        wide96Res.h11Empty &&
        wide96Res.h12Spike &&
        wide96Res.emptyCount === 1 &&
        wide96Res.spikeCount === 1 &&
        mazeRes.maxZone === 4 &&
        JSON.stringify(mazeRes.wells) === '["A1","A2","A3","A4"]' &&
        mazeRes.zchangeKind === "zchange" &&
        mazeRes.a1Sab === 100 &&
        mazeRes.a2Sab === 0 &&
        mazeRes.matCells === 16;
      report(ok, "Analyzer parses BOM/CRLF/pre-header/trailing-comma Petri CSV, 96-well wide CSV, and 4-zone maze + sparse _ZCHANGE CSV",
        ok ? "" : JSON.stringify({ errors, petriRes, wide96Res, mazeRes }));
      await page.close();
    }

    // 7f. End-to-end Builder -> Analyzer closed loop: localStorage autosave handoff AND Builder .zip bundle import
    {
      const { page, errors } = await openFreshPage("#study");
      await page.setViewportSize({ width: 1280, height: 900 });

      // Configure distinctive experiment in Script Builder
      await page.evaluate(() => {
        document.getElementById("userName").value = "Jane Doe";
        document.getElementById("expPrefix").value = "closedloop";
        state.organism = "zebrafish";
        state.plateId = "48well";
        state.stimId = "ppi";
        document.getElementById("thermostatTemp").value = "28.5";
        document.getElementById("chk_thermostat").checked = true;
        refreshAll();
      });
      await page.waitForTimeout(550); // wait for debounced autosave to localStorage

      // Download a real Builder .zip bundle via the UI button ("Download All 4 Scripts (.zip)")
      const [zipDownload] = await Promise.all([
        page.waitForEvent("download"),
        page.click("#downloadZipBtn")
      ]);
      const zipBuffer = fs.readFileSync(await zipDownload.path());
      const zipFilename = zipDownload.suggestedFilename();

      // Navigate to Analyzer via .suite-nav and click "Use Latest Builder Config"
      await page.click('.suite-nav a[href="zantiks_csv_analyzer.html"]');
      await page.waitForFunction(() => location.pathname.endsWith("zantiks_csv_analyzer.html") && window.ZANTIKS_ANALYZER_UI);
      await page.click("#useBuilderConfigBtn");

      const localCtxCheck = await page.evaluate(() => {
        const ctx = window.ZANTIKS_ANALYZER_UI.getState().context;
        const badge = document.getElementById("contextBadge");
        const txt = document.getElementById("contextBadgeText").textContent;
        return {
          valid: Boolean(ctx && ctx.valid),
          source: ctx?.source,
          plateId: ctx?.plateId,
          stimId: ctx?.stimId,
          targetTempC: ctx?.targetTempC,
          studyTag: ctx?.studyTag,
          badgeLoaded: badge.classList.contains("is-loaded"),
          badgeHasDetails: txt.includes("48-Well") && txt.includes("28.5") && txt.includes("#closedloop")
        };
      });

      // Clear workspace and load the Builder-generated .zip bundle directly into Analyzer
      await page.click("#clearAllBtn");
      const clearedCtx = await page.evaluate(() => window.ZANTIKS_ANALYZER_UI.getState().context === null);

      await page.setInputFiles("#analyzerFileInput", {
        name: zipFilename || "doe_closedloop_48w.zip",
        mimeType: "application/zip",
        buffer: zipBuffer
      });
      await page.waitForFunction(() => Boolean(window.ZANTIKS_ANALYZER_UI.getState().context?.source === "zip"));

      const zipCtxCheck = await page.evaluate(() => {
        const ctx = window.ZANTIKS_ANALYZER_UI.getState().context;
        const badge = document.getElementById("contextBadge");
        const txt = document.getElementById("contextBadgeText").textContent;
        return {
          valid: Boolean(ctx && ctx.valid),
          source: ctx?.source,
          plateId: ctx?.plateId,
          stimId: ctx?.stimId,
          targetTempC: ctx?.targetTempC,
          studyTag: ctx?.studyTag,
          badgeLoaded: badge.classList.contains("is-loaded"),
          badgeHasDetails: txt.includes("48-Well") && txt.includes("28.5") && txt.includes("#closedloop")
        };
      });

      const ok =
        errors.length === 0 &&
        localCtxCheck.valid &&
        localCtxCheck.source === "localStorage" &&
        localCtxCheck.plateId === "48well" &&
        localCtxCheck.stimId === "ppi" &&
        localCtxCheck.targetTempC === 28.5 &&
        localCtxCheck.studyTag === "closedloop" &&
        localCtxCheck.badgeLoaded &&
        localCtxCheck.badgeHasDetails &&
        clearedCtx &&
        zipCtxCheck.valid &&
        zipCtxCheck.source === "zip" &&
        zipCtxCheck.plateId === "48well" &&
        zipCtxCheck.stimId === "ppi" &&
        zipCtxCheck.targetTempC === 28.5 &&
        zipCtxCheck.studyTag === "closedloop" &&
        zipCtxCheck.badgeLoaded &&
        zipCtxCheck.badgeHasDetails;
      report(ok, "Closed-loop Builder -> Analyzer handoff works via both localStorage ('Use Latest Builder Config') and Builder .zip bundle import",
        ok ? "" : JSON.stringify({ errors, localCtxCheck, clearedCtx, zipCtxCheck }));
      await page.close();
    }

    // 7g. Step 3 Group Brush painting, Step 5 well exclusion updating group stats, and all 4 exports (Tidy Long, Well Summary, Prism Grouped, Python .py)
    {
      const { page, errors } = await openFreshAnalyzer();
      await page.selectOption("#demoPresetSelect", "ld_24w");

      // Step 3: Groups -> add & rename a group to "Vehicle", then paint A1 & A2 on #brushPlateSvg via real pointer clicks
      await page.click('#analyzerStepper [data-goto="groups"]');
      await page.click("#addGroupBtn");
      await page.fill("#activeGroupNameInput", "Vehicle");
      await page.press("#activeGroupNameInput", "Enter");

      const clickWell = async (wellId) => {
        const box = await page.locator(`#brushPlateSvg [data-well="${wellId}"]`).boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      };
      await clickWell("A1");
      await clickWell("A2");

      const afterPaint = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const veh = st.analysis.groups.find((g) => g.group === "Vehicle");
        const ctrl = st.analysis.groups.find((g) => g.group === "Control");
        return {
          a1Group: st.groups.A1,
          a2Group: st.groups.A2,
          vehN: veh ? veh.n : 0,
          vehMean: veh ? veh.totalDist.mean : null,
          ctrlN: ctrl ? ctrl.n : 0,
          a2Dist: st.analysis.wellsById.A2.totalDist
        };
      });

      // Step 5: Export -> exclude A1 via per-well table checkbox and verify Vehicle stats update immediately
      await page.click('#analyzerStepper [data-goto="export"]');
      await page.click('#wellSummaryTable [data-row-excl="A1"]');
      const afterExclA1 = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const veh = st.analysis.groups.find((g) => g.group === "Vehicle");
        return {
          a1Excluded: st.excludedWells.has("A1"),
          vehN: veh ? veh.n : 0,
          vehMean: veh ? veh.totalDist.mean : null,
          a2Dist: st.analysis.wellsById.A2.totalDist
        };
      });

      // Trigger all 4 UI download buttons on Step 5 and read downloaded file contents
      const captureDownloadText = async (selector) => {
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.click(selector)
        ]);
        const dlPath = await download.path();
        return {
          filename: download.suggestedFilename(),
          rawBuf: fs.readFileSync(dlPath),
          text: fs.readFileSync(dlPath, "utf8")
        };
      };

      const tidyDl = await captureDownloadText("#exportTidyBtn");
      const summaryDl = await captureDownloadText("#exportSummaryBtn");
      const prismDl = await captureDownloadText("#exportPrismBtn");
      const pyDl = await captureDownloadText("#exportPythonBtn");

      // Verify BOM-free Prism TSV clipboard export via both UI button & core helper
      const copiedTsv = await page.evaluate(async () => {
        let captured = null;
        try {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: async (t) => { captured = String(t); } }
          });
        } catch (_) {}
        document.getElementById("copyPrismBtn").click();
        await new Promise((r) => setTimeout(r, 30));
        const directTsv = window.ZANTIKS_ANALYZER_CORE.exportPrismGroupedTsv(
          window.ZANTIKS_ANALYZER_UI.buildExportPayload(),
          window.ZANTIKS_ANALYZER_UI.getState().prismMetric
        );
        return { captured, directTsv };
      });

      const stripBom = (s) => s.replace(/^\uFEFF/, "");
      const tidyLines = stripBom(tidyDl.text).trim().split("\n");
      const summaryLines = stripBom(summaryDl.text).trim().split("\n");
      const prismLines = stripBom(prismDl.text).trim().split("\n");
      const prismHeaders = prismLines[0].split(",");
      const vehColIdx = prismHeaders.indexOf("Vehicle");
      const vehPrismVals = prismLines.slice(1).map((l) => l.split(",")[vehColIdx]).filter((v) => v && v.trim() !== "");

      const exportsOk = {
        tidyBom: tidyDl.text.startsWith("\uFEFF") && tidyDl.rawBuf[0] === 0xef && tidyDl.rawBuf[1] === 0xbb && tidyDl.rawBuf[2] === 0xbf,
        summaryBom: summaryDl.text.startsWith("\uFEFF"),
        prismBom: prismDl.text.startsWith("\uFEFF"),
        tsvNoBom: !copiedTsv.directTsv.startsWith("\uFEFF") &&
          copiedTsv.directTsv.includes("\t") &&
          copiedTsv.directTsv.split("\n")[0].split("\t").includes("Vehicle") &&
          (copiedTsv.captured === null || (!copiedTsv.captured.startsWith("\uFEFF") && copiedTsv.captured === copiedTsv.directTsv)),
        tidyValid: tidyDl.filename.endsWith("_tidy_long.csv") &&
          tidyLines[0].startsWith("run_id,date,runtime_s,") &&
          tidyLines[0].includes("well,group,excluded,qc_status,qc_reason,dist_mm") &&
          tidyLines.length === 120 * 24 + 1 &&
          tidyDl.text.includes(",A1,Vehicle,TRUE,ok,ok,") &&
          tidyDl.text.includes(",A2,Vehicle,FALSE,ok,ok,"),
        summaryValid: summaryDl.filename.endsWith("_well_summary.csv") &&
          summaryLines[0].startsWith("run_id,date,well,group,excluded,qc_status,qc_reason,exclude_source,") &&
          summaryLines[0].includes("vmr_dark_minus_light") &&
          summaryLines[0].includes("zone_preference_index") &&
          summaryLines.length === 25 &&
          summaryDl.text.includes(",A1,Vehicle,TRUE,ok,ok,manual,"),
        prismValid: prismDl.filename.endsWith(".csv") &&
          vehColIdx >= 0 &&
          prismHeaders.includes("Control") &&
          vehPrismVals.length === 1 &&
          Math.abs(Number(vehPrismVals[0]) - afterExclA1.a2Dist) < 0.1,
        pyValid: pyDl.filename.endsWith("_analysis.py") &&
          pyDl.text.includes("import pandas as pd") &&
          pyDl.text.includes("from scipy import stats") &&
          pyDl.text.includes("scipy.stats") &&
          /encoding=['"]utf-8-sig['"]/.test(pyDl.text) &&
          pyDl.text.includes("WELL_GROUPS = {") &&
          pyDl.text.includes('"Vehicle"') &&
          pyDl.text.includes('EXCLUDED_WELLS = {"A1"}') &&
          pyDl.text.includes("def main()")
      };

      const ok =
        errors.length === 0 &&
        afterPaint.a1Group === "Vehicle" &&
        afterPaint.a2Group === "Vehicle" &&
        afterPaint.vehN === 2 &&
        afterPaint.ctrlN === 6 &&
        afterExclA1.a1Excluded &&
        afterExclA1.vehN === 1 &&
        Math.abs(afterExclA1.vehMean - afterExclA1.a2Dist) < 0.05 &&
        Math.abs(afterExclA1.vehMean - afterPaint.vehMean) > 1 &&
        Object.values(exportsOk).every(Boolean);
      report(ok, "Step 3 interactive group painting, Step 5 well exclusion stats update, and v2 UTF-8 BOM / BOM-free TSV / scipy Python exports all work cleanly",
        ok ? "" : JSON.stringify({ errors, afterPaint, afterExclA1, exportsOk }));
      await page.close();
    }

    // 7h. Unified 1380px wizard shell width, sidebar & scrollbar-gutter parity at 1600x900 across Script Builder and CSV Analyzer
    {
      const { page, errors } = await openFreshPage("#study");
      await page.setViewportSize({ width: 1600, height: 900 });
      const readLayoutBox = () => page.evaluate(() => {
        const tb = document.querySelector(".topbar-inner").getBoundingClientRect();
        const main = document.querySelector("main.wizard").getBoundingClientRect();
        const side = document.querySelector("aside.run-summary").getBoundingClientRect();
        return {
          topbarLeft: Math.round(tb.left * 10) / 10,
          topbarWidth: Math.round(tb.width * 10) / 10,
          mainLeft: Math.round(main.left * 10) / 10,
          mainWidth: Math.round(main.width * 10) / 10,
          sideLeft: Math.round(side.left * 10) / 10,
          sideWidth: Math.round(side.width * 10) / 10,
          pageMax: getComputedStyle(document.documentElement).getPropertyValue("--page-max").trim(),
          gutter: getComputedStyle(document.documentElement).scrollbarGutter,
          noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth
        };
      });

      const builderBox = await readLayoutBox();

      await page.click('.suite-nav a[href="zantiks_csv_analyzer.html"]');
      await page.waitForFunction(() => location.pathname.endsWith("zantiks_csv_analyzer.html") && window.ZANTIKS_ANALYZER_UI);
      const analyzerEmptyBox = await readLayoutBox();

      await page.selectOption("#demoPresetSelect", "ld_24w");
      await page.click('#analyzerStepper [data-goto="plots"]');
      const analyzerLoadedBox = await readLayoutBox();

      const eq = (a, b) => Math.abs(a - b) < 0.5;
      const ok =
        errors.length === 0 &&
        builderBox.pageMax === "1380px" &&
        analyzerLoadedBox.pageMax === "1380px" &&
        builderBox.gutter === "stable" &&
        analyzerLoadedBox.gutter === "stable" &&
        eq(builderBox.mainWidth, 1380) &&
        eq(builderBox.mainWidth, analyzerEmptyBox.mainWidth) &&
        eq(builderBox.mainWidth, analyzerLoadedBox.mainWidth) &&
        eq(builderBox.mainLeft, analyzerEmptyBox.mainLeft) &&
        eq(builderBox.mainLeft, analyzerLoadedBox.mainLeft) &&
        eq(builderBox.sideWidth, analyzerEmptyBox.sideWidth) &&
        eq(builderBox.sideWidth, analyzerLoadedBox.sideWidth) &&
        eq(builderBox.sideLeft, analyzerEmptyBox.sideLeft) &&
        eq(builderBox.sideLeft, analyzerLoadedBox.sideLeft) &&
        eq(builderBox.topbarWidth, analyzerEmptyBox.topbarWidth) &&
        eq(builderBox.topbarWidth, analyzerLoadedBox.topbarWidth) &&
        eq(builderBox.topbarLeft, analyzerEmptyBox.topbarLeft) &&
        eq(builderBox.topbarLeft, analyzerLoadedBox.topbarLeft) &&
        builderBox.noOverflow &&
        analyzerEmptyBox.noOverflow &&
        analyzerLoadedBox.noOverflow;
      report(ok, "Script Builder and CSV Analyzer share identical 1380px wizard shell, topbar & sidebar alignment at 1600x900 with zero shift",
        ok ? "" : JSON.stringify({ errors, builderBox, analyzerEmptyBox, analyzerLoadedBox }));
      await page.close();
    }

    // 7i. Multi-run pooling (ld_multi_2p demo & 2 uploaded CSVs), editable run_id/date, Copy Map to All Runs, Pooled vs Active toggle, Normalize to Control (%) CV reduction & pooled CSV export
    {
      const { page, errors } = await openFreshAnalyzer();
      const captureDownloadText = async (selector) => {
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.click(selector)
        ]);
        const dlPath = await download.path();
        return { filename: download.suggestedFilename(), text: fs.readFileSync(dlPath, "utf8") };
      };

      // Part A: ld_multi_2p 2-plate demo
      await page.click('#step1DemoCards [data-demo="ld_multi_2p"]');
      const initialMulti = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          runCount: st.runs.length,
          scope: st.scope,
          runIds: st.runs.map((r) => r.runId),
          dates: st.runs.map((r) => r.date),
          hasPlate1Xy: Boolean(st.runs[0]?.xyParsed),
          totalWells: st.analysis.kpis.totalWells,
          listRows: document.querySelectorAll("#loadedRunsList .az-run-item").length,
          placeholders: document.querySelectorAll("input[placeholder]").length
        };
      });

      // Edit Plate 1's run_id and date inline on Step 1
      const firstIdInput = page.locator("#loadedRunsList [data-run-id-edit]").first();
      await firstIdInput.fill("Batch_A");
      await firstIdInput.dispatchEvent("change");
      const firstDateInput = page.locator("#loadedRunsList [data-run-date-edit]").first();
      await firstDateInput.fill("2026-11-10");
      await firstDateInput.dispatchEvent("change");

      const afterMetaEdit = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return { run0Id: st.runs[0]?.runId, run0Date: st.runs[0]?.date };
      });

      // Step 2: Exclude flagged across ALL runs (B3/D6 on Plate 1, C1/A6 on Plate 2 -> 44/48 active)
      await page.click('#analyzerStepper [data-goto="qc"]');
      await page.click("#excludeFlaggedAllRunsBtn");
      const afterExclAll = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        return { activeWells: a.kpis.activeWells, excludedWells: a.kpis.excludedWells };
      });

      // Step 4: Scope toggle (Active vs Pooled) + Normalize to Control (%) CV reduction
      await page.click('#analyzerStepper [data-goto="plots"]');
      const pooledBeforeNorm = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        const wtVeh = a.groups.find((g) => g.group === "WT · Vehicle");
        const mutDrug = a.groups.find((g) => g.group === "Mutant · Drug");
        const cv = (s) => (s && s.mean > 0 ? s.sd / s.mean : null);
        return {
          scope: a.scope,
          wellCount: a.wells.length,
          wtVehN: wtVeh ? wtVeh.n : 0,
          rawWtVehCv: cv(wtVeh?.totalDist),
          rawMutDrugCv: cv(mutDrug?.totalDist),
          plateShiftPct: a.pooledMeta?.batchDiagnostics?.plateShiftPct ?? 0,
          shiftBadgeText: document.getElementById("batchShiftBadge")?.textContent.trim() || ""
        };
      });

      await page.click("#plotScopeActiveBtn");
      const activeScopeCheck = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        const wtVeh = a.groups.find((g) => g.group === "WT · Vehicle");
        return { scope: a.scope, wellCount: a.wells.length, wtVehN: wtVeh ? wtVeh.n : 0 };
      });

      await page.click("#plotScopePooledBtn");
      await page.check("#normControlChk");
      const pooledAfterNorm = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        const wtVeh = a.groups.find((g) => g.group === "WT · Vehicle");
        const mutDrug = a.groups.find((g) => g.group === "Mutant · Drug");
        const cv = (s) => (s && s.mean > 0 ? s.sd / s.mean : null);
        return {
          normalizeToControl: Boolean(a.pooledMeta?.normalizeToControl),
          wtVehNormMean: wtVeh?.normalized?.totalDistPctCtrl?.mean ?? null,
          normWtVehCv: cv(wtVeh?.normalized?.totalDistPctCtrl),
          normMutDrugCv: cv(mutDrug?.normalized?.totalDistPctCtrl),
          tsUnit: a.timeSeries.unit
        };
      });

      // Step 5: Pooled CSV exports contain BOTH Batch_A (2026-11-10) and Plate_2 (2026-11-21) + normalized column
      await page.click('#analyzerStepper [data-goto="export"]');
      const sumDl = await captureDownloadText("#exportSummaryBtn");
      const tidyDl = await captureDownloadText("#exportTidyBtn");
      const sumClean = sumDl.text.replace(/^\uFEFF/, "");
      const tidyClean = tidyDl.text.replace(/^\uFEFF/, "");
      const pooledExportOk =
        sumDl.text.startsWith("\uFEFF") &&
        sumClean.split("\n")[0].includes("norm_total_dist_pct_ctrl") &&
        sumClean.includes("Batch_A,2026-11-10,") &&
        sumClean.includes("Plate_2,2026-11-21,") &&
        sumClean.trim().split("\n").length === 49 &&
        tidyDl.text.startsWith("\uFEFF") &&
        tidyClean.includes("Batch_A,2026-11-10,") &&
        tidyClean.includes("Plate_2,2026-11-21,");

      // Part B: Upload 2 separate Summary CSVs + Copy Map to All Runs
      await page.click("#clearAllBtn");
      const build6wCsv = (scale) => {
        const ws = ["A1", "A2", "A3", "B1", "B2", "B3"];
        const lines = [["RUNTIME", "TEMP_C", "PHASE", "TIME_BIN", ...ws.map((w) => "DIST_" + w)].join(",")];
        for (let i = 0; i < 6; i++) {
          const vals = ws.map((_, wi) => ((10 + wi * 1.5 + i * 0.4) * scale).toFixed(2));
          lines.push([(i + 1) * 10, "28.0", i < 3 ? "LIGHT" : "DARK", i + 1, ...vals].join(","));
        }
        return lines.join("\n") + "\n";
      };
      await page.setInputFiles("#analyzerFileInput", {
        name: "2026-11-01_ExpA_6w.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(build6wCsv(1.0), "utf8")
      });
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().runs.length === 1);
      await page.setInputFiles("#addRunFileInput", {
        name: "2026-11-02_ExpB_6w.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(build6wCsv(1.25), "utf8")
      });
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().runs.length === 2);

      await page.click('#analyzerStepper [data-goto="groups"]');
      // Select Run 1 in #groupsRunSwitcher, create 2 groups ("Ctrl", "Treated"), auto-fill columns, then Copy Map to All Runs
      await page.locator("#groupsRunSwitcher [data-grp-sw-run]").first().click();
      await page.click("#addGroupBtn");
      await page.fill("#activeGroupNameInput", "Ctrl");
      await page.press("#activeGroupNameInput", "Enter");
      await page.click("#addGroupBtn");
      await page.fill("#activeGroupNameInput", "Treated");
      await page.press("#activeGroupNameInput", "Enter");
      await page.click("#autoAssignColsBtn");

      const beforeCopyMap = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          run0Meta: { runId: st.runs[0].runId, date: st.runs[0].date },
          run1Meta: { runId: st.runs[1].runId, date: st.runs[1].date },
          run0A1: st.runs[0].groups.A1 || null,
          run0A3: st.runs[0].groups.A3 || null,
          run1A3: st.runs[1].groups.A3 || null
        };
      });

      await page.click("#copyMapAllRunsBtn");
      const afterCopyMap = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          sameGroups: JSON.stringify(st.runs[0].groups) === JSON.stringify(st.runs[1].groups),
          run1A1: st.runs[1].groups.A1 || null,
          run1A3: st.runs[1].groups.A3 || null
        };
      });

      const ok =
        errors.length === 0 &&
        initialMulti.runCount === 2 &&
        initialMulti.scope === "pooled" &&
        initialMulti.hasPlate1Xy &&
        initialMulti.totalWells === 48 &&
        initialMulti.listRows === 2 &&
        initialMulti.placeholders === 0 &&
        afterMetaEdit.run0Id === "Batch_A" &&
        afterMetaEdit.run0Date === "2026-11-10" &&
        afterExclAll.activeWells === 44 &&
        afterExclAll.excludedWells === 4 &&
        pooledBeforeNorm.scope === "pooled" &&
        pooledBeforeNorm.wellCount === 48 &&
        pooledBeforeNorm.plateShiftPct > 10 &&
        pooledBeforeNorm.shiftBadgeText.includes("%") &&
        activeScopeCheck.scope === "active" &&
        activeScopeCheck.wellCount === 24 &&
        activeScopeCheck.wtVehN < pooledBeforeNorm.wtVehN &&
        pooledAfterNorm.normalizeToControl &&
        Math.abs(pooledAfterNorm.wtVehNormMean - 100) < 0.2 &&
        pooledAfterNorm.normWtVehCv < pooledBeforeNorm.rawWtVehCv &&
        pooledAfterNorm.normMutDrugCv < pooledBeforeNorm.rawMutDrugCv &&
        pooledAfterNorm.tsUnit === "% Ctrl" &&
        pooledExportOk &&
        beforeCopyMap.run0Meta.date === "2026-11-01" &&
        beforeCopyMap.run1Meta.date === "2026-11-02" &&
        beforeCopyMap.run0A1 === "Ctrl" &&
        beforeCopyMap.run0A3 === "Treated" &&
        beforeCopyMap.run1A3 === null &&
        afterCopyMap.sameGroups &&
        afterCopyMap.run1A1 === "Ctrl" &&
        afterCopyMap.run1A3 === "Treated";
      report(ok, "Multi-run pooling (ld_multi_2p + 2 uploaded CSVs), inline run_id/date edit, Copy Map to All Runs, Pooled/Active toggle, % Control CV reduction & pooled exports work",
        ok ? "" : JSON.stringify({ errors, initialMulti, afterMetaEdit, afterExclAll, pooledBeforeNorm, activeScopeCheck, pooledAfterNorm, pooledExportOk, beforeCopyMap, afterCopyMap }));
      await page.close();
    }

    // 7j. Organism-aware & adjustable QC thresholds (celegans vs drosophila, custom Max Speed & Empty Dist, non-destructive Trim Window) + Builder organism auto-sync
    {
      const { page, errors } = await openFreshAnalyzer();

      // Synthetic 6-well 1s-bin CSV (40 rows, relTime 0..39):
      // A1: healthy 5 mm/s; A2: low-activity 0.06 mm/bin (total 2.4 mm -> empty when emptyDistMm=5);
      // B1: 25 mm/s bursts at rows 15 & 25 -> flagged under celegans (15 mm/s), OK under drosophila (180 mm/s), re-flagged at custom Max Speed=10;
      // B2: single 300 mm early artifact at row 1 (relTime=1s) -> cleared by Trim Window 5..35s without mutating raw CSV!
      const ws = ["A1", "A2", "A3", "B1", "B2", "B3"];
      const csvLines = [["RUNTIME", "TEMP_C", "PHASE", "TIME_BIN", ...ws.map((w) => "DIST_" + w)].join(",")];
      for (let i = 0; i < 40; i++) {
        const dA1 = (5.0 + (i % 3) * 0.2).toFixed(2);
        const dA2 = "0.06";
        const dA3 = (6.0 + (i % 2) * 0.3).toFixed(2);
        const dB1 = (i === 15 || i === 25) ? "25.00" : (5.0 + (i % 4) * 0.4).toFixed(2);
        const dB2 = (i === 1) ? "300.00" : (5.0 + (i % 3) * 0.2).toFixed(2);
        const dB3 = (5.5 + (i % 3) * 0.2).toFixed(2);
        csvLines.push([(i + 1).toFixed(1), "22.0", "BASELINE", i + 1, dA1, dA2, dA3, dB1, dB2, dB3].join(","));
      }

      await page.setInputFiles("#analyzerFileInput", {
        name: "qc_thresholds_6w.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csvLines.join("\n") + "\n", "utf8")
      });
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().summaryParsed?.filename === "qc_thresholds_6w.csv");
      await page.click('#analyzerStepper [data-goto="qc"]');

      // 1. Switch organism preset to celegans (15 mm/s, spikeMin 20 mm)
      await page.selectOption("#qcOrganismPresetSel", "celegans");
      const celegansRes = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        return {
          presetId: a.qcThresholds.presetId,
          maxSpeedInput: Number(document.getElementById("qcMaxSpeedInput").value),
          b1Spike: Boolean(a.wellsById.B1.qc.isSpikeGlitch),
          b1Reason: a.wellsById.B1.qcReason,
          b2Spike: Boolean(a.wellsById.B2.qc.isSpikeGlitch),
          a2Empty: Boolean(a.wellsById.A2.qc.isEmpty)
        };
      });

      // 2. Switch organism preset to drosophila (180 mm/s, spikeMin 60 mm) -> B1 clears, B2 still flagged
      await page.selectOption("#qcOrganismPresetSel", "drosophila");
      const drosophilaRes = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        return {
          presetId: a.qcThresholds.presetId,
          maxSpeedInput: Number(document.getElementById("qcMaxSpeedInput").value),
          b1Spike: Boolean(a.wellsById.B1.qc.isSpikeGlitch),
          b1Reason: a.wellsById.B1.qcReason,
          b2Spike: Boolean(a.wellsById.B2.qc.isSpikeGlitch),
          a2Empty: Boolean(a.wellsById.A2.qc.isEmpty)
        };
      });

      // 3. Custom Max Speed = 10 mm/s and Empty Dist = 5 mm -> live re-flags B1 (spike) & A2 (empty)
      await page.fill("#qcMaxSpeedInput", "10");
      await page.dispatchEvent("#qcMaxSpeedInput", "change");
      await page.fill("#qcEmptyDistInput", "5");
      await page.dispatchEvent("#qcEmptyDistInput", "change");
      const customRes = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        return {
          presetId: a.qcThresholds.presetId,
          b1Spike: Boolean(a.wellsById.B1.qc.isSpikeGlitch),
          a2Empty: Boolean(a.wellsById.A2.qc.isEmpty),
          a2Reason: a.wellsById.A2.qcReason
        };
      });

      // 4. Reset to drosophila & apply non-destructive Trim Window (5s..35s) -> clears B2 early spike without mutating raw parsed rows or Tidy Long CSV
      await page.selectOption("#qcOrganismPresetSel", "drosophila");
      await page.fill("#qcTrimStartInput", "5");
      await page.dispatchEvent("#qcTrimStartInput", "change");
      await page.fill("#qcTrimEndInput", "35");
      await page.dispatchEvent("#qcTrimEndInput", "change");
      const trimRes = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const a = st.analysis;
        return {
          trimActive: Boolean(a.trimInfo && a.trimInfo.active),
          keptRows: a.kpis.rowCount,
          rawRowCount: st.summaryParsed.rows.length,
          rawB2Row1Dist: st.summaryParsed.rows[1].dist.B2,
          b2SpikeAfterTrim: Boolean(a.wellsById.B2.qc.isSpikeGlitch),
          b2ReasonAfterTrim: a.wellsById.B2.qcReason
        };
      });

      await page.click('#analyzerStepper [data-goto="export"]');
      const [tidyDl] = await Promise.all([
        page.waitForEvent("download"),
        page.click("#exportTidyBtn")
      ]);
      const tidyText = fs.readFileSync(await tidyDl.path(), "utf8").replace(/^\uFEFF/, "");
      const tidyPreservesRaw = tidyText.trim().split("\n").length === 40 * 6 + 1 && tidyText.includes("300.000");
      await page.close();

      // 5. Auto-sync organism QC preset from Builder context (celegans -> 15 mm/s)
      const { page: bPage, errors: bErrors } = await openFreshPage("#study");
      await bPage.setViewportSize({ width: 1280, height: 900 });
      await bPage.evaluate(() => {
        state.organism = "celegans";
        state.plateId = "24well";
        refreshAll();
      });
      await bPage.waitForTimeout(550);
      await bPage.click('.suite-nav a[href="zantiks_csv_analyzer.html"]');
      await bPage.waitForFunction(() => location.pathname.endsWith("zantiks_csv_analyzer.html") && window.ZANTIKS_ANALYZER_UI);
      await bPage.click("#useBuilderConfigBtn");
      await bPage.setInputFiles("#analyzerFileInput", {
        name: "qc_sync_6w.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csvLines.join("\n") + "\n", "utf8")
      });
      await bPage.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().summaryParsed?.filename === "qc_sync_6w.csv");
      await bPage.click('#analyzerStepper [data-goto="qc"]');
      const syncRes = await bPage.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          contextOrg: st.context?.organismId,
          qcPresetId: st.qcThresholds?.presetId,
          qcMaxSpeed: st.qcThresholds?.spikeMaxSpeedMmS,
          selVal: document.getElementById("qcOrganismPresetSel").value,
          inpMaxSpeed: Number(document.getElementById("qcMaxSpeedInput").value),
          b1FlaggedBySync: Boolean(st.analysis.wellsById.B1.qc.isSpikeGlitch)
        };
      });
      await bPage.close();

      const ok =
        errors.length === 0 &&
        bErrors.length === 0 &&
        celegansRes.presetId === "celegans" &&
        celegansRes.maxSpeedInput === 15 &&
        celegansRes.b1Spike &&
        celegansRes.b1Reason === "spike_glitch" &&
        celegansRes.b2Spike &&
        !celegansRes.a2Empty &&
        drosophilaRes.presetId === "drosophila" &&
        drosophilaRes.maxSpeedInput === 180 &&
        !drosophilaRes.b1Spike &&
        drosophilaRes.b1Reason === "ok" &&
        drosophilaRes.b2Spike &&
        customRes.presetId === "custom" &&
        customRes.b1Spike &&
        customRes.a2Empty &&
        customRes.a2Reason === "empty_well" &&
        trimRes.trimActive &&
        trimRes.keptRows === 31 &&
        trimRes.rawRowCount === 40 &&
        trimRes.rawB2Row1Dist === 300 &&
        !trimRes.b2SpikeAfterTrim &&
        trimRes.b2ReasonAfterTrim === "ok" &&
        tidyPreservesRaw &&
        syncRes.contextOrg === "celegans" &&
        syncRes.qcPresetId === "celegans" &&
        syncRes.qcMaxSpeed === 15 &&
        syncRes.selVal === "celegans" &&
        syncRes.inpMaxSpeed === 15 &&
        syncRes.b1FlaggedBySync;
      report(ok, "Organism-aware QC presets (celegans vs drosophila), custom Max Speed/Empty Dist, non-destructive Trim Window & Builder context auto-sync work",
        ok ? "" : JSON.stringify({ errors, bErrors, celegansRes, drosophilaRes, customRes, trimRes, tidyPreservesRaw, syncRes }));
    }

    // 7k. Multi-factor plate layers (genotype + treatment), Fill by Row/Column, Combine Factors -> Groups, .json round-trip & factor CSV columns
    {
      const { page, errors } = await openFreshAnalyzer();
      await page.selectOption("#demoPresetSelect", "ld_24w");
      await page.click('#analyzerStepper [data-goto="groups"]');

      // Add genotype x treatment preset, fill genotype by Row, fill treatment by Column, then Combine Factors -> Groups
      await page.click("#presetGenoTreatBtn");
      await page.click("#autoAssignRowsBtn");
      await page.click('#factorLayerBar [data-factor-layer="treatment"]');
      await page.click("#autoAssignColsBtn");
      await page.click("#combineFactorsBtn");

      const afterCombine = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          factorNames: [...st.factorNames],
          groupOrder: [...st.groupOrder],
          a1Group: st.groups.A1,
          a6Group: st.groups.A6,
          d1Group: st.groups.D1,
          d6Group: st.groups.D6,
          a1Geno: st.wellFactors.genotype?.A1,
          d6Geno: st.wellFactors.genotype?.D6,
          a1Treat: st.wellFactors.treatment?.A1,
          d6Treat: st.wellFactors.treatment?.D6,
          placeholders: document.querySelectorAll("input[placeholder]").length
        };
      });

      // Save plate map (.json), remove both factors, then reload .json to verify round-trip
      const [mapDl] = await Promise.all([
        page.waitForEvent("download"),
        page.click("#savePlateMapBtn")
      ]);
      const mapJsonText = fs.readFileSync(await mapDl.path(), "utf8");
      const mapObj = JSON.parse(mapJsonText);

      await page.click('#factorLayerBar [data-rm-factor="genotype"]');
      await page.click('#factorLayerBar [data-rm-factor="treatment"]');
      const afterRemove = await page.evaluate(() => window.ZANTIKS_ANALYZER_UI.getState().factorNames.length);

      await page.setInputFiles("#plateMapFileInput", {
        name: mapDl.suggestedFilename() || "plate_map.json",
        mimeType: "application/json",
        buffer: Buffer.from(mapJsonText, "utf8")
      });
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().factorNames.length === 2);

      const afterReload = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          factorNames: [...st.factorNames],
          a1Group: st.groups.A1,
          d6Group: st.groups.D6,
          a1Geno: st.wellFactors.genotype?.A1,
          d6Treat: st.wellFactors.treatment?.D6
        };
      });

      // Step 5: Export Well Summary & Tidy Long CSVs and verify factor columns + values
      await page.click('#analyzerStepper [data-goto="export"]');
      const [sumDl] = await Promise.all([page.waitForEvent("download"), page.click("#exportSummaryBtn")]);
      const [tidyDl] = await Promise.all([page.waitForEvent("download"), page.click("#exportTidyBtn")]);
      const sumText = fs.readFileSync(await sumDl.path(), "utf8").replace(/^\uFEFF/, "");
      const tidyText = fs.readFileSync(await tidyDl.path(), "utf8").replace(/^\uFEFF/, "");

      const ok =
        errors.length === 0 &&
        JSON.stringify(afterCombine.factorNames) === '["genotype","treatment"]' &&
        afterCombine.groupOrder.length === 4 &&
        afterCombine.a1Group === "WT · Vehicle" &&
        afterCombine.a6Group === "WT · Drug" &&
        afterCombine.d1Group === "Mutant · Vehicle" &&
        afterCombine.d6Group === "Mutant · Drug" &&
        afterCombine.a1Geno === "WT" &&
        afterCombine.d6Geno === "Mutant" &&
        afterCombine.a1Treat === "Vehicle" &&
        afterCombine.d6Treat === "Drug" &&
        afterCombine.placeholders === 0 &&
        mapObj.format === "zantiks-plate-map" &&
        JSON.stringify(mapObj.factorNames) === '["genotype","treatment"]' &&
        mapObj.wellFactors?.genotype?.A1 === "WT" &&
        mapObj.wellFactors?.treatment?.D6 === "Drug" &&
        afterRemove === 0 &&
        JSON.stringify(afterReload.factorNames) === '["genotype","treatment"]' &&
        afterReload.a1Group === "WT · Vehicle" &&
        afterReload.d6Group === "Mutant · Drug" &&
        afterReload.a1Geno === "WT" &&
        afterReload.d6Treat === "Drug" &&
        sumText.split("\n")[0].includes(",well,group,genotype,treatment,excluded,") &&
        sumText.includes(",A1,WT · Vehicle,WT,Vehicle,FALSE,") &&
        tidyText.split("\n")[0].includes(",well,group,genotype,treatment,excluded,qc_status,qc_reason,") &&
        tidyText.includes(",D6,Mutant · Drug,Mutant,Drug,FALSE,");
      report(ok, "Multi-factor plate layers (genotype x treatment), Fill by Row/Column, Combine Factors -> Groups, .json round-trip & factor CSV columns work",
        ok ? "" : JSON.stringify({ errors, afterCombine, afterRemove, afterReload }));
      await page.close();
    }

    // 7l. UTF-8 BOM + Chinese group names in CSV exports vs BOM-free Prism TSV copy, auto/manual/flagged-kept audit & cleaning_log.txt
    {
      const { page, errors } = await openFreshAnalyzer();
      const captureDownload = async (selector) => {
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.click(selector)
        ]);
        const dlPath = await download.path();
        return {
          filename: download.suggestedFilename(),
          rawBuf: fs.readFileSync(dlPath),
          text: fs.readFileSync(dlPath, "utf8")
        };
      };

      await page.selectOption("#demoPresetSelect", "ld_24w");

      // Rename Control -> 对照组, Drug 1uM -> 给药组 on Step 3
      await page.click('#analyzerStepper [data-goto="groups"]');
      await page.click('#groupSwatchList [data-swatch-group="Control"]');
      await page.fill("#activeGroupNameInput", "对照组");
      await page.press("#activeGroupNameInput", "Enter");
      await page.click('#groupSwatchList [data-swatch-group="Drug 1uM"]');
      await page.fill("#activeGroupNameInput", "给药组");
      await page.press("#activeGroupNameInput", "Enter");

      // Step 2: Auto-exclude flagged wells (D5 empty + D6 spike)
      await page.click('#analyzerStepper [data-goto="qc"]');
      await page.click("#excludeFlaggedBtn");

      // Step 5: Restore D6 (becomes auto-flagged-but-kept!) and manually exclude healthy well A1
      await page.click('#analyzerStepper [data-goto="export"]');
      await page.click('#wellSummaryTable [data-row-excl="D6"]');
      await page.click('#wellSummaryTable [data-row-excl="A1"]');

      const auditPreview = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          pill: document.getElementById("cleaningLogAuditSummary")?.textContent.trim() || "",
          a1Source: st.analysis.wellsById.A1.excludeSource,
          d5Source: st.analysis.wellsById.D5.excludeSource,
          d6Excluded: st.analysis.wellsById.D6.excluded,
          d6Flagged: Boolean(st.analysis.wellsById.D6.qc.isSpikeGlitch),
          a1Group: st.groups.A1,
          a3Group: st.groups.A3
        };
      });

      const tidyDl = await captureDownload("#exportTidyBtn");
      const summaryDl = await captureDownload("#exportSummaryBtn");
      const prismDl = await captureDownload("#exportPrismBtn");
      const logDl = await captureDownload("#exportCleaningLogBtn");

      // Intercept clipboard writeText for #copyPrismBtn and verify NO UTF-8 BOM + Chinese headers intact
      const prismTsv = await page.evaluate(async () => {
        let captured = null;
        try {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: async (t) => { captured = String(t); } }
          });
        } catch (_) {}
        document.getElementById("copyPrismBtn").click();
        await new Promise((r) => setTimeout(r, 30));
        const direct = window.ZANTIKS_ANALYZER_CORE.exportPrismGroupedTsv(
          window.ZANTIKS_ANALYZER_UI.buildExportPayload(),
          window.ZANTIKS_ANALYZER_UI.getState().prismMetric
        );
        return { captured, direct };
      });

      const hasUtf8BomBytes = (buf) => buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      const csvChecks = {
        tidyBomZh: hasUtf8BomBytes(tidyDl.rawBuf) && tidyDl.text.startsWith("\uFEFF") && tidyDl.text.includes(",对照组,") && tidyDl.text.includes(",给药组,"),
        summaryBomZh: hasUtf8BomBytes(summaryDl.rawBuf) && summaryDl.text.startsWith("\uFEFF") &&
          summaryDl.text.includes(",A1,对照组,TRUE,ok,ok,manual,") &&
          summaryDl.text.includes(",D5,Drug 10uM,TRUE,empty,empty_well,auto,") &&
          summaryDl.text.includes(",D6,Drug 10uM,FALSE,spike,spike_glitch,,") &&
          summaryDl.text.includes(",给药组,"),
        prismBomZh: hasUtf8BomBytes(prismDl.rawBuf) && prismDl.text.startsWith("\uFEFF") &&
          prismDl.text.replace(/^\uFEFF/, "").split("\n")[0].includes("对照组") &&
          prismDl.text.replace(/^\uFEFF/, "").split("\n")[0].includes("给药组"),
        tsvNoBomZh: !prismTsv.direct.startsWith("\uFEFF") &&
          prismTsv.direct.includes("\t") &&
          prismTsv.direct.split("\n")[0].includes("对照组") &&
          prismTsv.direct.split("\n")[0].includes("给药组") &&
          (prismTsv.captured === null || (!prismTsv.captured.startsWith("\uFEFF") && prismTsv.captured === prismTsv.direct))
      };

      const logTxt = logDl.text;
      const logChecks = {
        filename: logDl.filename.endsWith("_cleaning_log.txt"),
        version: logTxt.includes("v2.0.0"),
        thresholds: logTxt.includes("Zebrafish Larvae") && logTxt.includes("0.1 mm") && logTxt.includes("120 mm/s") && logTxt.includes("MAD"),
        sourceFile: logTxt.includes("demo_vmr_ld_2x300s_24w.csv"),
        autoExcluded: logTxt.includes("Auto-excluded wells:") && logTxt.includes("D5") && logTxt.includes("empty_well") && logTxt.includes("totalDist=0.00 mm"),
        manualExcluded: logTxt.includes("Manually-excluded wells:") && logTxt.includes("A1 (对照组)") && logTxt.includes("manual_exclude"),
        flaggedKept: logTxt.includes("Flagged-but-kept: 1") && logTxt.includes("Auto-flagged wells KEPT by analyst:") && logTxt.includes("D6") && logTxt.includes("spike_glitch") && logTxt.includes("4 spikes")
      };

      const ok =
        errors.length === 0 &&
        auditPreview.a1Group === "对照组" &&
        auditPreview.a3Group === "给药组" &&
        auditPreview.a1Source === "manual" &&
        auditPreview.d5Source === "auto" &&
        !auditPreview.d6Excluded &&
        auditPreview.d6Flagged &&
        auditPreview.pill.includes("1 auto-excl") &&
        auditPreview.pill.includes("1 manual-excl") &&
        auditPreview.pill.includes("UTF-8 BOM") &&
        Object.values(csvChecks).every(Boolean) &&
        Object.values(logChecks).every(Boolean);
      report(ok, "UTF-8 BOM + Chinese group names in CSVs, BOM-free Prism TSV copy, auto/manual/flagged-kept audit & cleaning_log.txt work accurately",
        ok ? "" : JSON.stringify({ errors, auditPreview, csvChecks, logChecks }));
      await page.close();
    }

    // 7m. Pure-JS screening stats numerical benchmarks, #compStatsPanel & .az-sig-bracket, ppi_24w Peri-Stimulus/Habituation/Window AUC & ld_multi_2p Spatial (_XY) heatmaps
    {
      const { page, errors } = await openFreshAnalyzer();

      // Part A: Pure-JS screening stats numerical accuracy benchmarks
      const statsBench = await page.evaluate(() => {
        const S = window.ZANTIKS_ANALYZER_CORE.stats;
        const pTcrit = S.tTwoTailedP(2.22813885, 10);
        const pFcrit = S.fUpperTailP(3.3541308, 2, 27);
        const pChiCrit = S.chi2UpperTailP(5.9914645, 2);
        const pZcrit = S.normalTwoTailedP(1.95996398);

        const wtDiff = S.welchTTest([10, 12, 11, 13, 12], [20, 22, 21, 23, 22]);
        const wtSame = S.welchTTest([5, 6, 7, 8], [5, 6, 7, 8]);
        const mw = S.mannWhitneyU([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
        const anova = S.oneWayAnova([
          { group: "G1", values: [1, 2, 3, 2, 2] },
          { group: "G2", values: [10, 11, 12, 11, 11] },
          { group: "G3", values: [20, 21, 22, 21, 21] }
        ]);
        const kw = S.kruskalWallis([
          { group: "G1", values: [1, 2, 3, 2, 2] },
          { group: "G2", values: [10, 11, 12, 11, 11] },
          { group: "G3", values: [20, 21, 22, 21, 21] }
        ]);
        const paired = S.pairedCompare([10, 12, 14, 15, 18, 21], [14, 17, 18, 20, 24, 25]);
        return {
          critOk: Math.abs(pTcrit - 0.05) < 1e-4 &&
            Math.abs(pFcrit - 0.05) < 1e-4 &&
            Math.abs(pChiCrit - 0.05) < 1e-4 &&
            Math.abs(pZcrit - 0.05) < 1e-4,
          welchOk: wtDiff.meanDiff === -10 && Math.abs(wtDiff.t - (-13.8675)) < 0.01 && Math.abs(wtDiff.cohensD - (-8.771)) < 0.01 && wtDiff.df === 8 && wtDiff.p < 1e-4 && wtDiff.sig === "***" &&
            wtSame.t === 0 && wtSame.p === 1 && wtSame.sig === "ns",
          mwOk: mw.U === 0 && mw.p < 0.02 && Math.abs(Math.abs(mw.rEffect) - 1) < 1e-6,
          anovaOk: anova.df1 === 2 && anova.df2 === 12 && anova.F > 500 && anova.p < 1e-4 && anova.etaSq > 0.98 &&
            anova.pairwise.length === 3 && anova.pairwise.every((pw) => pw.pAdj >= pw.p && pw.sig === "***"),
          kwOk: kw.df === 2 && kw.H > 12 && kw.p < 0.005,
          pairedOk: paired.n === 6 && paired.pairedT.df === 5 && paired.pairedT.p < 0.001 && paired.wilcoxon.W === 0 && paired.wilcoxon.p < 0.05
        };
      });

      // Part B: ppi_24w -> Peri-Stimulus (t=0), Trial Habituation, Custom Window AUC & Screening Stats UI + brackets
      await page.selectOption("#demoPresetSelect", "ppi_24w");
      await page.click('#analyzerStepper [data-goto="plots"]');

      await page.selectOption("#tsTraceViewSel", "peri");
      const periCheck = await page.evaluate(() => ({
        svgText: document.getElementById("tsChartSvg").textContent || "",
        paths: document.querySelectorAll("#tsChartSvg path").length,
        periTypeVisible: getComputedStyle(document.getElementById("tsPeriTypeWrap")).display !== "none"
      }));

      await page.selectOption("#tsTraceViewSel", "habituation");
      const habitCheck = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        const svgText = document.getElementById("tsChartSvg").textContent || "";
        return {
          hasHabituation: Boolean(a.periStimulus && a.periStimulus.hasHabituation),
          trialCount: a.periStimulus?.trialCount || 0,
          hasTrialLabels: svgText.includes("T1") && svgText.includes("T5"),
          paths: document.querySelectorAll("#tsChartSvg path").length
        };
      });

      await page.selectOption("#tsTraceViewSel", "full");
      await page.fill("#tsWinStartInput", "20");
      await page.dispatchEvent("#tsWinStartInput", "change");
      await page.fill("#tsWinEndInput", "100");
      await page.dispatchEvent("#tsWinEndInput", "change");
      const aucCheck = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        const viewVals = [...document.getElementById("compViewSel").options].map((o) => o.value);
        return {
          hasWindowAuc: Boolean(a.capabilities.hasWindowAuc),
          readout: document.getElementById("tsWinAucReadout")?.textContent.trim() || "",
          svgHasAucBand: (document.getElementById("tsChartSvg").textContent || "").includes("AUC 20"),
          hasWindowView: viewVals.includes("window_auc"),
          hasHabitView: viewVals.includes("habituation"),
          ctrlAuc: a.groups.find((g) => g.group === "Control")?.windowAuc?.auc?.mean ?? null
        };
      });

      // Tab 2: Comparison screening stats panel & significance brackets toggle
      await page.click('#chartTabsBar [data-chart-tab="comparison"]');
      await page.selectOption("#compViewSel", "ppi");
      const statsUiOn = await page.evaluate(() => {
        const panel = document.getElementById("compStatsPanel");
        const txt = panel?.textContent || "";
        return {
          visible: panel ? getComputedStyle(panel).display !== "none" : false,
          brackets: document.querySelectorAll("#compChartSvg .az-sig-bracket").length,
          hasAnova: txt.includes("One-way ANOVA"),
          hasKruskal: txt.includes("Kruskal-Wallis"),
          hasHolm: txt.includes("Holm"),
          hasDisclaimer: txt.includes("Quick screening stats")
        };
      });
      await page.uncheck("#compShowStatsChk");
      const statsUiOff = await page.evaluate(() => ({
        hidden: getComputedStyle(document.getElementById("compStatsPanel")).display === "none",
        brackets: document.querySelectorAll("#compChartSvg .az-sig-bracket").length
      }));

      // Part C: ld_multi_2p -> Tab 4 Spatial (_XY) 2D Heatmaps & #xyFreezeInput live update
      await page.selectOption("#demoPresetSelect", "ld_multi_2p");
      await page.click('#chartTabsBar [data-chart-tab="spatial"]');
      const spatialBefore = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        const wtVeh = a.xyAnalysis?.groups?.["WT · Vehicle"];
        return {
          emptyHidden: getComputedStyle(document.getElementById("spatialEmptyHint")).display === "none",
          contentVisible: getComputedStyle(document.getElementById("spatialContent")).display !== "none",
          clipPaths: document.querySelectorAll("#spatialHeatmapSvg clipPath").length,
          heatRects: document.querySelectorAll("#spatialHeatmapSvg rect").length,
          stripCards: document.querySelectorAll("#spatialSummaryStrip .az-stat-mini").length,
          freezeSpeed: a.xyAnalysis?.freezeSpeedMmS ?? null,
          wtImmob: wtVeh?.immobilityPct?.mean ?? null,
          placeholders: document.querySelectorAll("input[placeholder]").length
        };
      });

      await page.fill("#xyFreezeInput", "3.5");
      await page.dispatchEvent("#xyFreezeInput", "change");
      const spatialAfter = await page.evaluate(() => {
        const a = window.ZANTIKS_ANALYZER_UI.getState().analysis;
        const wtVeh = a.xyAnalysis?.groups?.["WT · Vehicle"];
        return {
          freezeSpeed: a.xyAnalysis?.freezeSpeedMmS ?? null,
          wtImmob: wtVeh?.immobilityPct?.mean ?? null
        };
      });

      const ok =
        errors.length === 0 &&
        Object.values(statsBench).every(Boolean) &&
        periCheck.svgText.includes("Stimulus t = 0s") &&
        periCheck.paths >= 3 &&
        periCheck.periTypeVisible &&
        habitCheck.hasHabituation &&
        habitCheck.trialCount >= 5 &&
        habitCheck.hasTrialLabels &&
        habitCheck.paths >= 3 &&
        aucCheck.hasWindowAuc &&
        aucCheck.readout.includes("20") &&
        aucCheck.svgHasAucBand &&
        aucCheck.hasWindowView &&
        aucCheck.hasHabitView &&
        aucCheck.ctrlAuc > 0 &&
        statsUiOn.visible &&
        statsUiOn.brackets >= 1 &&
        statsUiOn.hasAnova &&
        statsUiOn.hasKruskal &&
        statsUiOn.hasHolm &&
        statsUiOn.hasDisclaimer &&
        statsUiOff.hidden &&
        statsUiOff.brackets === 0 &&
        spatialBefore.emptyHidden &&
        spatialBefore.contentVisible &&
        spatialBefore.clipPaths === 4 &&
        spatialBefore.heatRects > 200 &&
        spatialBefore.stripCards === 4 &&
        spatialBefore.freezeSpeed === 0.5 &&
        spatialBefore.placeholders === 0 &&
        spatialAfter.freezeSpeed === 3.5 &&
        spatialAfter.wtImmob > spatialBefore.wtImmob + 5;
      report(ok, "Pure-JS screening stats benchmarks, #compStatsPanel/.az-sig-bracket, ppi_24w Peri-Stimulus/Habituation/Window AUC & ld_multi_2p Spatial (_XY) heatmaps work",
        ok ? "" : JSON.stringify({ errors, statsBench, periCheck, habitCheck, aucCheck, statsUiOn, statsUiOff, spatialBefore, spatialAfter }));
      await page.close();
    }

    // 7n. Permanent SciPy 1.16.3 exact parity regression test (18 diverse cases + zero-var/zero-diff guards + matching .py method & Two-Way ANOVA)
    {
      const { page, errors } = await openFreshAnalyzer();

      // Exact IEEE-754 reference outputs precomputed with scipy.stats 1.16.3 (zero Python runtime dependency in CI)
      const SCIPY_1_16_REFS = {
        welch: [
          { name: "small_n4_unequal_var", a: [10.2, 11.4, 9.8, 12.1], b: [15.5, 19.2, 14.1, 21.8, 16.9], ref: { t: -4.521060963787666, df: 5.145366772773537, p: 0.00585527435073451 } },
          { name: "medium_n8v8_equal_var", a: [21.1, 22.4, 20.8, 23.0, 21.9, 22.6, 20.3, 21.5], b: [24.2, 25.6, 23.9, 26.1, 24.8, 25.3, 23.5, 24.7], ref: { t: -6.717643323560393, df: 13.940362969063258, p: 1.0036621933373374e-5 } },
          {
            name: "large_n26v26_unequal",
            a: [15.624, 8.399, 11.956, 9.827, 15.761, 9.604, 14.512, 10.972, 16.29, 11.561, 10.624, 9.426, 12.537, 8.531, 8.873, 10.395, 8.955, 9.749, 10.368, 10.136, 14.643, 11.224, 14.604, 13.009, 11.486, 14.002],
            b: [15.382, 12.886, 23.552, 17.193, 16.837, 16.382, 17.277, 17.329, 7.533, 18.289, 10.583, 15.052, 16.038, 15.444, 23.366, 18.189, 18.556, 10.035, 21.466, 10.997, 14.01, 18.859, 11.492, 17.67, 10.868, 15.83],
            ref: { t: -4.542674239832558, df: 41.2754398858169, p: 4.7637316194675455e-5 }
          }
        ],
        mwu: [
          { name: "exact_n3v4_untied", a: [1.1, 2.3, 4.7], b: [3.2, 5.8, 6.4, 9.1], ref: { U: 1, p: 0.11428571428571428, method: "exact", hasTies: false } },
          { name: "exact_n8v8_untied", a: [12.1, 14.3, 15.8, 11.2, 16.4, 13.7, 17.5, 12.9], b: [18.2, 16.9, 21.4, 19.6, 15.1, 22.8, 20.3, 17.8], ref: { U: 4, p: 0.0018648018648018648, method: "exact", hasTies: false } },
          { name: "exact_n12v12_untied", a: [1.2, 2.4, 3.6, 4.8, 5.1, 6.3, 7.5, 8.7, 9.2, 10.4, 11.6, 12.8], b: [6.9, 8.1, 9.8, 11.1, 12.3, 13.5, 14.7, 15.9, 16.2, 17.4, 18.6, 19.8], ref: { U: 17, p: 0.0008579386692187877, method: "exact", hasTies: false } },
          { name: "asymptotic_n8v8_tied", a: [10, 12, 12, 14, 15, 15, 15, 18], b: [15, 18, 18, 20, 22, 22, 25, 28], ref: { U: 3.5, p: 0.002922196012884838, method: "asymptotic", hasTies: true } },
          {
            name: "asymptotic_n26v26_large",
            a: [15.624, 8.399, 11.956, 9.827, 15.761, 9.604, 14.512, 10.972, 16.29, 11.561, 10.624, 9.426, 12.537, 8.531, 8.873, 10.395, 8.955, 9.749, 10.368, 10.136, 14.643, 11.224, 14.604, 13.009, 11.486, 14.002],
            b: [15.382, 12.886, 23.552, 17.193, 16.837, 16.382, 17.277, 17.329, 7.533, 18.289, 10.583, 15.052, 16.038, 15.444, 23.366, 18.189, 18.556, 10.035, 21.466, 10.997, 14.01, 18.859, 11.492, 17.67, 10.868, 15.83],
            ref: { U: 122, p: 8.016491072300717e-5, method: "asymptotic", hasTies: false }
          }
        ],
        paired: [
          { name: "exact_n8_untied", a: [10.1, 12.4, 11.8, 14.2, 13.5, 15.9, 12.1, 16.3], b: [12.3, 15.1, 11.2, 17.8, 16.4, 19.9, 15.6, 20.8], ref: { t: -5.115805063716018, df: 7, pT: 0.0013751360259365959, W: 1, pW: 0.015625, method: "exact", hasTies: false, nNonZero: 8 } },
          {
            name: "exact_n24_untied",
            a: [20, 20.5, 21, 21.5, 22, 22.5, 23, 23.5, 24, 24.5, 25, 25.5, 26, 26.5, 27, 27.5, 28, 28.5, 29, 29.5, 30, 30.5, 31, 31.5],
            b: [19.75, 20.92, 21.59, 22.26, 21.07, 23.6, 24.27, 24.94, 22.39, 26.28, 26.95, 27.62, 23.71, 28.96, 29.63, 30.3, 25.03, 31.64, 32.31, 32.98, 26.35, 34.32, 34.99, 35.66],
            ref: { t: -2.7111823288545684, df: 23, pT: 0.012458546224905998, W: 66, pW: 0.015044927597045898, method: "exact", hasTies: false, nNonZero: 24 }
          },
          { name: "exact_n10_with_zeros", a: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28], b: [10, 12, 15.2, 18.5, 17.3, 23.1, 26.4, 28.9, 32.2, 35.8], ref: { t: -3.2422088573513976, df: 9, pT: 0.010122800588851977, W: 1, pW: 0.015625, method: "exact", hasTies: false, nNonZero: 8 } },
          { name: "approx_n10_tied_abs", a: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28], b: [12, 14, 16, 19, 21, 23, 26, 28, 30, 33], ref: { t: -9.797958971132713, df: 9, pT: 4.239738886259835e-6, W: 0, pW: 0.005540680462065569, method: "approx", hasTies: true, nNonZero: 10 } },
          {
            name: "approx_n52_large",
            a: [10, 10.37, 10.74, 11.11, 11.48, 11.85, 12.22, 12.59, 12.96, 13.33, 13.7, 14.07, 14.44, 14.81, 15.18, 15.55, 15.92, 16.29, 16.66, 17.03, 17.4, 17.77, 18.14, 18.51, 18.88, 19.25, 19.62, 19.99, 20.36, 20.73, 21.1, 21.47, 21.84, 22.21, 22.58, 22.95, 23.32, 23.69, 24.06, 24.43, 24.8, 25.17, 25.54, 25.91, 26.28, 26.65, 27.02, 27.39, 27.76, 28.13, 28.5, 28.87],
            b: [9.85, 10.603, 11.056, 11.509, 11.962, 11.285, 12.868, 13.321, 13.774, 14.227, 12.72, 15.133, 15.586, 16.039, 16.492, 14.155, 17.398, 17.851, 18.304, 18.757, 15.59, 19.663, 20.116, 20.569, 21.022, 17.025, 21.928, 22.381, 22.834, 23.287, 18.46, 24.193, 24.646, 25.099, 25.552, 19.895, 26.458, 26.911, 27.364, 27.817, 21.33, 28.723, 29.176, 29.629, 30.082, 22.765, 30.988, 31.441, 31.894, 32.347, 24.2, 33.253],
            ref: { t: -4.260959620955307, df: 51, pT: 8.774289296525023e-5, W: 286, pW: 0.0002468230379143422, method: "approx", hasTies: false, nNonZero: 52 }
          }
        ],
        anova: [
          { name: "3group_unequal_n", groups: [[11.2, 12.8, 10.5, 13.1, 11.9], [15.4, 16.9, 14.8, 17.5, 15.1, 16.2], [21.3, 23.1, 20.4, 22.8, 21.9, 24.0, 20.9]], ref: { F: 115.0201165774528, p: 7.969002539170423e-10, holmP: [0.00017970611557324988, 1.8737663531671197e-7, 3.2023091872094566e-6] } },
          { name: "4group_n8_realistic", groups: [[100.1, 97.4, 103.2, 98.8, 101.5, 96.9, 102.3, 99.8], [89.2, 92.5, 86.1, 90.4, 88.7, 91.8, 87.3, 89.9], [61.4, 58.2, 63.7, 59.5, 60.8, 57.6, 62.1, 60.3], [94.6, 91.2, 96.8, 93.4, 95.1, 92.7, 94.0, 93.9]], ref: { F: 596.2909206102296, p: 1.8340254927416065e-25, holmP: [5.116742007099199e-7, 1.9146381299600626e-14, 7.974107002720813e-5, 5.063094926006207e-13, 0.00043426405979193384, 3.6720476254083246e-14] } }
        ],
        kruskal: [
          { name: "3group_untied", groups: [[11.2, 12.8, 10.5, 13.1, 11.9], [15.4, 16.9, 14.8, 17.5, 15.1, 16.2], [21.3, 23.1, 20.4, 22.8, 21.9, 24.0, 20.9]], ref: { H: 15.05263157894737, p: 0.0005387193605816652, holmP: [0.005050505050505051, 0.005050505050505051, 0.0034965034965034965], methods: ["exact", "exact", "exact"] } },
          { name: "3group_with_ties", groups: [[5, 7, 7, 8, 9, 9], [9, 10, 12, 12, 12, 14], [14, 16, 16, 18, 20, 20]], ref: { H: 14.717345872518289, p: 0.0006370432958980104, holmP: [0.014315465141391348, 0.014315465141391348, 0.014315465141391348], methods: ["asymptotic", "asymptotic", "asymptotic"] } },
          { name: "4group_n8_realistic", groups: [[100.1, 97.4, 103.2, 98.8, 101.5, 96.9, 102.3, 99.8], [89.2, 92.5, 86.1, 90.4, 88.7, 91.8, 87.3, 89.9], [61.4, 58.2, 63.7, 59.5, 60.8, 57.6, 62.1, 60.3], [94.6, 91.2, 96.8, 93.4, 95.1, 92.7, 94.0, 93.9]], ref: { H: 28.738636363636374, p: 2.5412628328243053e-6, holmP: [0.0009324009324009324, 0.0009324009324009324, 0.0009324009324009324, 0.0009324009324009324, 0.0009324009324009324, 0.0009324009324009324], methods: ["exact", "exact", "exact", "exact", "exact", "exact"] } }
        ]
      };

      const parityRes = await page.evaluate((refs) => {
        const S = window.ZANTIKS_ANALYZER_CORE.stats;
        const TOL = 1e-10;
        let maxRelErr = 0;
        const diffs = [];
        const checkNum = (label, got, exp) => {
          if (!Number.isFinite(got)) { diffs.push({ label, got, exp, err: "non-finite" }); return; }
          const rel = Math.abs(exp) > 1e-30 ? Math.abs(got - exp) / Math.abs(exp) : Math.abs(got - exp);
          if (rel > maxRelErr) maxRelErr = rel;
          if (rel >= TOL) diffs.push({ label, got, exp, rel });
        };

        for (const c of refs.welch) {
          const r = S.welchTTest(c.a, c.b);
          checkNum(`welch.${c.name}.t`, r.t, c.ref.t);
          checkNum(`welch.${c.name}.df`, r.df, c.ref.df);
          checkNum(`welch.${c.name}.p`, r.p, c.ref.p);
        }
        for (const c of refs.mwu) {
          const r = S.mannWhitneyU(c.a, c.b);
          checkNum(`mwu.${c.name}.U`, r.U, c.ref.U);
          checkNum(`mwu.${c.name}.p`, r.p, c.ref.p);
          if (r.method !== c.ref.method || r.hasTies !== c.ref.hasTies) {
            diffs.push({ label: `mwu.${c.name}.meta`, got: { method: r.method, hasTies: r.hasTies }, exp: { method: c.ref.method, hasTies: c.ref.hasTies } });
          }
        }
        for (const c of refs.paired) {
          const r = S.pairedCompare(c.a, c.b);
          checkNum(`paired.${c.name}.t`, r.pairedT.t, c.ref.t);
          checkNum(`paired.${c.name}.pT`, r.pairedT.p, c.ref.pT);
          checkNum(`paired.${c.name}.W`, r.wilcoxon.W, c.ref.W);
          checkNum(`paired.${c.name}.pW`, r.wilcoxon.p, c.ref.pW);
          if (r.wilcoxon.method !== c.ref.method || r.wilcoxon.hasTies !== c.ref.hasTies || r.wilcoxon.nNonZero !== c.ref.nNonZero) {
            diffs.push({ label: `paired.${c.name}.meta`, got: r.wilcoxon, exp: c.ref });
          }
        }
        for (const c of refs.anova) {
          const r = S.oneWayAnova(c.groups.map((v, i) => ({ group: `G${i + 1}`, values: v })));
          checkNum(`anova.${c.name}.F`, r.F, c.ref.F);
          checkNum(`anova.${c.name}.p`, r.p, c.ref.p);
          c.ref.holmP.forEach((hp, i) => checkNum(`anova.${c.name}.holm[${i}]`, r.pairwise[i]?.pAdj, hp));
        }
        for (const c of refs.kruskal) {
          const r = S.kruskalWallis(c.groups.map((v, i) => ({ group: `G${i + 1}`, values: v })));
          checkNum(`kw.${c.name}.H`, r.H, c.ref.H);
          checkNum(`kw.${c.name}.p`, r.p, c.ref.p);
          c.ref.holmP.forEach((hp, i) => {
            checkNum(`kw.${c.name}.holm[${i}]`, r.pairwise[i]?.pAdj, hp);
            if (r.pairwise[i]?.method !== c.ref.methods[i]) {
              diffs.push({ label: `kw.${c.name}.method[${i}]`, got: r.pairwise[i]?.method, exp: c.ref.methods[i] });
            }
          });
        }

        // Degenerate zero-variance & zero-diff guards (zero NaN / Infinity)
        const zWelchDiff = S.welchTTest([10, 10, 10], [20, 20, 20]);
        const zWelchSame = S.welchTTest([10, 10, 10], [10, 10, 10]);
        const zPairedAllZero = S.pairedCompare([5, 6, 7, 8], [5, 6, 7, 8]);
        const zAnova = S.oneWayAnova([{ group: "A", values: [10, 10, 10] }, { group: "B", values: [20, 20, 20] }, { group: "C", values: [30, 30, 30] }]);
        const degenerateOk =
          zWelchDiff.t === null && zWelchDiff.p === null && Boolean(zWelchDiff.note) &&
          zWelchSame.t === 0 && zWelchSame.p === 1 &&
          zPairedAllZero.pairedT.t === 0 && zPairedAllZero.pairedT.p === 1 &&
          zPairedAllZero.wilcoxon.method === "none" && zPairedAllZero.wilcoxon.p === 1 && zPairedAllZero.wilcoxon.nNonZero === 0 &&
          zAnova.F === null && zAnova.p === null && Boolean(zAnova.note);

        return { maxRelErr, diffs, degenerateOk };
      }, SCIPY_1_16_REFS);

      // Verify exported Python script emits matching exact/asymptotic method selectors, unit/family config & statsmodels Two-Way ANOVA
      await page.selectOption("#demoPresetSelect", "ld_multi_2p");
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click("#unitPlatesBtn");
      await page.click('#chartTabsBar [data-chart-tab="comparison"]');
      await page.selectOption("#compTestFamilySel", "nonparametric");
      await page.click('#analyzerStepper [data-goto="export"]');
      const [pyDl] = await Promise.all([
        page.waitForEvent("download"),
        page.click("#exportPythonBtn")
      ]);
      const pyText = fs.readFileSync(await pyDl.path(), "utf8");
      const pyParityOk =
        pyText.includes("method = 'exact' if (not has_ties(combined) and len(a) <= 25 and len(b) <= 25) else 'asymptotic'") &&
        pyText.includes("method = 'exact' if (not has_ties(np.abs(nz)) and len(nz) <= 50) else 'approx'") &&
        pyText.includes("method=method") &&
        pyText.includes('UNIT_OF_ANALYSIS = "plates"') &&
        pyText.includes('PRIMARY_TEST_FAMILY = "nonparametric"') &&
        pyText.includes('FACTOR_NAMES = ["genotype","treatment"]') &&
        pyText.includes("statsmodels") &&
        pyText.includes("C(Q(");

      const ok =
        errors.length === 0 &&
        parityRes.diffs.length === 0 &&
        parityRes.maxRelErr < 1e-10 &&
        parityRes.degenerateOk &&
        pyParityOk;
      report(ok, "SciPy 1.16.3 parity holds to <1e-10 across 18 exact/asymptotic/tied/untied/multi-group cases, degenerate guards & Python export",
        ok ? "" : JSON.stringify({ errors, parityRes, pyParityOk }));
      await page.close();
    }

    // 7o. Methodological guardrails (Test Family, Plate Means vs Wells, Post-Stats Audit + Section 4 log) & all #58 bug-fix regressions (#1-#8)
    {
      const { page, errors } = await openFreshAnalyzer();
      await page.setViewportSize({ width: 1600, height: 900 });

      const buildCsv = (wells, rows, valFn) => {
        const lines = [["RUNTIME", "TEMP_C", "PHASE", "TIME_BIN", ...wells.map((w) => "DIST_" + w)].join(",")];
        for (let i = 0; i < rows; i++) {
          lines.push([(i + 1) * 10, "28.0", i < rows / 2 ? "LIGHT" : "DARK", i + 1, ...wells.map((w, wi) => valFn(w, wi, i).toFixed(2))].join(","));
        }
        return lines.join("\n") + "\n";
      };

      // 1. Primary Test Family, Unit of Analysis (Wells vs Plate Means), Notices & Post-Stats Audit on ld_multi_2p
      await page.selectOption("#demoPresetSelect", "ld_multi_2p");
      const beforeStatsViewed = await page.evaluate(() => window.ZANTIKS_ANALYZER_UI.getState().hasViewedStats);
      await page.click('#analyzerStepper [data-goto="qc"]');
      await page.click("#excludeFlaggedAllRunsBtn");
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.check("#normControlChk");
      await page.click('#chartTabsBar [data-chart-tab="comparison"]');

      const wellsParamCheck = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const panel = document.getElementById("compStatsPanel");
        const cc = panel.querySelector("details.az-stats-crosscheck");
        const svgText = document.getElementById("compChartSvg").textContent || "";
        const notices = [...panel.querySelectorAll(".az-stats-notice")].map((el) => el.textContent);
        return {
          hasViewedStats: st.hasViewedStats,
          family: st.primaryTestFamily,
          unit: st.unitOfAnalysis,
          ccCollapsed: Boolean(cc && !cc.open),
          ccHasKruskal: Boolean(cc && cc.textContent.includes("Kruskal-Wallis")),
          mainHasAnova: panel.querySelector(".az-stats-omnibus")?.textContent.includes("One-way ANOVA"),
          svgShowsWellsUnit: svgText.includes("n=11 wells"),
          hasPseudoNotice: notices.some((t) => t.includes("Unit of Analysis")),
          hasMultiFactorNotice: notices.some((t) => t.includes("Multi-Factor Design"))
        };
      });

      // Switch to Non-Parametric + Plate Means (n = plates)
      await page.selectOption("#compTestFamilySel", "nonparametric");
      const nonParamWellsCheck = await page.evaluate(() => {
        const panel = document.getElementById("compStatsPanel");
        const cc = panel.querySelector("details.az-stats-crosscheck");
        const methodTags = [...panel.querySelectorAll(".az-method-tag")].map((el) => el.textContent.trim());
        return {
          mainHasKruskal: panel.querySelector(".az-stats-omnibus")?.textContent.includes("Kruskal-Wallis"),
          ccCollapsed: Boolean(cc && !cc.open),
          ccHasAnova: Boolean(cc && cc.textContent.includes("One-way ANOVA")),
          hasExactMethodTag: methodTags.includes("exact")
        };
      });

      await page.click("#unitPlatesBtn");
      const platesModeCheck = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const panel = document.getElementById("compStatsPanel");
        const svgText = document.getElementById("compChartSvg").textContent || "";
        const notices = [...panel.querySelectorAll(".az-stats-notice")].map((el) => el.textContent);
        const prismCsv = window.ZANTIKS_ANALYZER_CORE.exportPrismGroupedCsv(window.ZANTIKS_ANALYZER_UI.buildExportPayload(), "total_dist");
        const prismDataRows = prismCsv.replace(/^\uFEFF/, "").trim().split("\n").length - 1;
        return {
          unit: st.unitOfAnalysis,
          nUnit: st.analysis.nUnit,
          svgShowsPlatesUnit: svgText.includes("n=2 plates"),
          hasLowRepNotice: notices.some((t) => t.includes("Low Replicate Count")),
          hasMultiFactorNotice: notices.some((t) => t.includes("Multi-Factor Design")),
          prismDataRows
        };
      });

      // Post-stats manual exclusion on Step 5 -> badge + amber audit summary + cleaning_log.txt Section 3 & Section 4
      await page.click('#analyzerStepper [data-goto="export"]');
      await page.locator('#wellSummaryTable [data-row-excl="A1"]').first().click();
      const postStatsUi = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          metaFlag: Boolean(st.runs[0].excludeMeta?.A1?.afterStatsViewed),
          metaTimestamp: Boolean(st.runs[0].excludeMeta?.A1?.afterStatsAt),
          rowBadges: document.querySelectorAll("#wellSummaryTable .az-poststats-badge").length,
          auditPill: document.getElementById("cleaningLogAuditSummary")?.textContent.trim() || "",
          scrollHintExists: Boolean(document.getElementById("wellTableScrollHint"))
        };
      });

      const [logDl] = await Promise.all([
        page.waitForEvent("download"),
        page.click("#exportCleaningLogBtn")
      ]);
      const logTxt = fs.readFileSync(await logDl.path(), "utf8");
      const logSec4Ok =
        logTxt.includes("[EXCLUDED AFTER VIEWING STATS") &&
        logTxt.includes("Post-stats exclusions total : 1") &&
        logTxt.includes("4. SCREENING STATISTICS & PARAMETER SNAPSHOT") &&
        logTxt.includes("Non-Parametric") &&
        logTxt.includes("Plate Means");

      // 2. Bug #3: Renaming active Control group syncs ui.controlGroupName cleanly
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click("#unitWellsBtn");
      await page.click('#analyzerStepper [data-goto="groups"]');
      await page.click('#groupSwatchList [data-swatch-group="WT · Vehicle"]');
      await page.fill("#activeGroupNameInput", "BaselineCtrl");
      await page.press("#activeGroupNameInput", "Enter");
      await page.click("#copyMapAllRunsBtn");
      const bug3CtrlRenameOk = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const mean = st.analysis.groups.find((g) => g.group === "BaselineCtrl")?.normalized?.totalDistPctCtrl?.mean;
        return st.controlGroupName === "BaselineCtrl" && st.analysis.pooledMeta?.controlGroupName === "BaselineCtrl" && Math.abs(mean - 100) < 0.2;
      });

      // 3. Bug #1: removeRun down to 1 run resets normalizeToControl/unitOfAnalysis/normalized_ctrl; down to 0 resets full state
      await page.click('#analyzerStepper [data-goto="data"]');
      const run0Id = await page.evaluate(() => window.ZANTIKS_ANALYZER_UI.getState().runs[0].id);
      await page.locator(`#loadedRunsList [data-rm-run="${run0Id}"]`).click();
      const bug1AfterOne = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return {
          runCount: st.runs.length,
          norm: st.normalizeToControl,
          unit: st.unitOfAnalysis,
          scope: st.scope,
          compViewNotNorm: st.compView !== "normalized_ctrl"
        };
      });
      const lastId = await page.evaluate(() => window.ZANTIKS_ANALYZER_UI.getState().runs[0].id);
      await page.locator(`#loadedRunsList [data-rm-run="${lastId}"]`).click();
      const bug1AfterZero = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return st.runs.length === 0 && !st.normalizeToControl && !st.hasViewedStats && st.trimWindow.trimStartSec === 0 && st.windowAuc.startSec === null;
      });

      // 4. Bug #7: Demo switch from Spatial tab with custom xyFreezeSpeedMmS exits empty tab & resets xyFreezeSpeedMmS
      await page.selectOption("#demoPresetSelect", "ld_multi_2p");
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click('#chartTabsBar [data-chart-tab="spatial"]');
      await page.fill("#xyFreezeInput", "4.2");
      await page.dispatchEvent("#xyFreezeInput", "change");
      await page.selectOption("#demoPresetSelect", "ppi_24w");
      const bug7DemoSwitchOk = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return st.activeChartTab === "timeseries" && st.xyFreezeSpeedMmS === 0.5 && !st.hasViewedStats;
      });

      // 5. Bug #2: Workspace replace via file upload resets Trim, Window AUC, Normalize & xyFreezeSpeedMmS
      await page.selectOption("#demoPresetSelect", "ld_multi_2p");
      await page.click('#analyzerStepper [data-goto="qc"]');
      await page.fill("#qcTrimStartInput", "200");
      await page.dispatchEvent("#qcTrimStartInput", "change");
      await page.fill("#qcTrimEndInput", "800");
      await page.dispatchEvent("#qcTrimEndInput", "change");
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.check("#normControlChk");
      await page.fill("#tsWinStartInput", "200");
      await page.dispatchEvent("#tsWinStartInput", "change");
      await page.fill("#tsWinEndInput", "500");
      await page.dispatchEvent("#tsWinEndInput", "change");
      // Upload zero-variance 6-well CSV (also verifies Bug #4!)
      const zeroVarCsv = buildCsv(["A1", "A2", "A3", "B1", "B2", "B3"], 6, (w) => (w.startsWith("A") ? 10 : 20));
      await page.setInputFiles("#analyzerFileInput", {
        name: "zero_var_replace_6w.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(zeroVarCsv, "utf8")
      });
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().summaryParsed?.filename === "zero_var_replace_6w.csv");
      const bug2ReplaceOk = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        return !st.normalizeToControl &&
          st.trimWindow.trimStartSec === 0 &&
          st.trimWindow.trimEndSec === null &&
          st.windowAuc.startSec === null &&
          st.xyFreezeSpeedMmS === 0.5 &&
          !st.hasViewedStats &&
          document.getElementById("tsWinStartInput").value === "";
      });

      // Bug #4: Zero-variance groups never render Infinity or NaN in #compStatsPanel
      await page.click('#analyzerStepper [data-goto="groups"]');
      await page.click("#addGroupBtn");
      await page.click("#addGroupBtn");
      await page.click("#autoAssignRowsBtn");
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click('#chartTabsBar [data-chart-tab="comparison"]');
      const bug4ZeroVarOk = await page.evaluate(() => {
        const txt = document.getElementById("compStatsPanel").textContent || "";
        return !/Infinity|NaN/.test(txt) && txt.length > 0;
      });

      // 6. Bug #5: Inverted Trim & Window AUC show .is-invalid + .az-inline-warn; blank QC input restores on blur
      await page.click('#analyzerStepper [data-goto="qc"]');
      await page.fill("#qcTrimStartInput", "800");
      await page.dispatchEvent("#qcTrimStartInput", "change");
      await page.fill("#qcTrimEndInput", "200");
      await page.dispatchEvent("#qcTrimEndInput", "change");
      await page.fill("#qcMadMultInput", "");
      await page.locator("#qcMadMultInput").blur();
      const bug5QcOk = await page.evaluate(() =>
        document.getElementById("qcTrimStartInput").classList.contains("is-invalid") &&
        document.getElementById("qcThresholdHint").classList.contains("az-inline-warn") &&
        Number(document.getElementById("qcMadMultInput").value) > 0
      );
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click('#chartTabsBar [data-chart-tab="timeseries"]');
      await page.fill("#tsWinStartInput", "500");
      await page.dispatchEvent("#tsWinStartInput", "change");
      await page.fill("#tsWinEndInput", "100");
      await page.dispatchEvent("#tsWinEndInput", "change");
      const bug5AucOk = await page.evaluate(() =>
        document.getElementById("tsWinStartInput").classList.contains("is-invalid") &&
        document.getElementById("tsWinAucReadout").classList.contains("az-inline-warn")
      );

      // 7. Bug #6: Mixed 24w + 96w plates -> zero phantom keys on Copy Map to All Runs & mixed layout summary
      await page.click("#clearAllBtn");
      const w24 = [], w96 = [];
      for (let r = 0; r < 4; r++) for (let c = 1; c <= 6; c++) w24.push(String.fromCharCode(65 + r) + c);
      for (let r = 0; r < 8; r++) for (let c = 1; c <= 12; c++) w96.push(String.fromCharCode(65 + r) + c);
      await page.setInputFiles("#analyzerFileInput", { name: "2026-11-01_p24.csv", mimeType: "text/csv", buffer: Buffer.from(buildCsv(w24, 6, (_, wi) => 10 + (wi % 5)), "utf8") });
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().runs.length === 1);
      await page.setInputFiles("#addRunFileInput", { name: "2026-11-02_p96.csv", mimeType: "text/csv", buffer: Buffer.from(buildCsv(w96, 6, (_, wi) => 12 + (wi % 5)), "utf8") });
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().runs.length === 2);
      await page.click('#analyzerStepper [data-goto="groups"]');
      await page.click("#autoAssignColsBtn");
      await page.click("#copyMapAllRunsBtn");
      const bug6MixedOk = await page.evaluate(() => {
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const r24 = st.runs[0];
        const validSet = new Set(r24.summaryParsed.wells);
        const phantomKeys = Object.keys(r24.groups).filter((w) => !validSet.has(w));
        const ovTxt = document.getElementById("loadedOverviewGrid")?.textContent || "";
        return phantomKeys.length === 0 && Boolean(st.analysis.pooledMeta?.hasMixedLayouts) && !ovTxt.includes("2 × 96-Well");
      });

      // 7b. Plate Means guardrail warning when unexcluded QC-flagged wells are included (and clears once excluded)
      await page.selectOption("#demoPresetSelect", "ld_multi_2p");
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click('#chartTabsBar [data-chart-tab="comparison"]');
      await page.click("#unitPlatesBtn");
      const flaggedPlatesWarnBefore = await page.evaluate(() => {
        const panelTxt = document.getElementById("compStatsPanel")?.textContent || "";
        const log = window.ZANTIKS_ANALYZER_CORE.exportCleaningLogTxt(window.ZANTIKS_ANALYZER_UI.buildExportPayload());
        return {
          uiHasWarn: panelTxt.includes("QC Flagged Wells in Plate Means") && panelTxt.includes("4 unexcluded QC-flagged wells"),
          logHasWarn: log.includes("Plate Means QC Warn") && log.includes("4 unexcluded QC-flagged wells")
        };
      });
      await page.click('#analyzerStepper [data-goto="qc"]');
      await page.click("#excludeFlaggedAllRunsBtn");
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click('#chartTabsBar [data-chart-tab="comparison"]');
      const flaggedPlatesWarnAfter = await page.evaluate(() => {
        const panelTxt = document.getElementById("compStatsPanel")?.textContent || "";
        const log = window.ZANTIKS_ANALYZER_CORE.exportCleaningLogTxt(window.ZANTIKS_ANALYZER_UI.buildExportPayload());
        return {
          uiCleared: !panelTxt.includes("QC Flagged Wells in Plate Means"),
          logCleared: !log.includes("Plate Means QC Warn")
        };
      });
      const flaggedInPlateMeansOk =
        flaggedPlatesWarnBefore.uiHasWarn &&
        flaggedPlatesWarnBefore.logHasWarn &&
        flaggedPlatesWarnAfter.uiCleared &&
        flaggedPlatesWarnAfter.logCleared;

      // 8. Bug #8: Exact topbar height & width parity vs Script Builder at 1600x900 + zero input[placeholder]
      const analyzerTopbar = await page.evaluate(() => {
        const tb = document.querySelector(".topbar-inner").getBoundingClientRect();
        return { h: Math.round(tb.height * 10) / 10, w: Math.round(tb.width * 10) / 10, placeholders: document.querySelectorAll("input[placeholder]").length };
      });
      await page.click('.suite-nav a[href="zantiks_script_generator.html"]');
      await page.waitForFunction(() => location.pathname.endsWith("zantiks_script_generator.html") && window.refreshAll && window.refreshAll._latestBundle);
      const builderTopbar = await page.evaluate(() => {
        const tb = document.querySelector(".topbar-inner").getBoundingClientRect();
        return { h: Math.round(tb.height * 10) / 10, w: Math.round(tb.width * 10) / 10, placeholders: document.querySelectorAll("input[placeholder]").length };
      });
      const bug8TopbarParityOk =
        Math.abs(analyzerTopbar.h - builderTopbar.h) < 1 &&
        Math.abs(analyzerTopbar.w - builderTopbar.w) < 1 &&
        analyzerTopbar.placeholders === 0 &&
        builderTopbar.placeholders === 0;

      const ok =
        errors.length === 0 &&
        !beforeStatsViewed &&
        Object.values(wellsParamCheck).every(Boolean) &&
        Object.values(nonParamWellsCheck).every(Boolean) &&
        platesModeCheck.unit === "plates" &&
        platesModeCheck.nUnit === "plates" &&
        platesModeCheck.svgShowsPlatesUnit &&
        platesModeCheck.hasLowRepNotice &&
        platesModeCheck.hasMultiFactorNotice &&
        platesModeCheck.prismDataRows === 2 &&
        postStatsUi.metaFlag &&
        postStatsUi.metaTimestamp &&
        postStatsUi.rowBadges >= 1 &&
        postStatsUi.auditPill.includes("1 post-stats") &&
        postStatsUi.scrollHintExists &&
        logSec4Ok &&
        bug3CtrlRenameOk &&
        bug1AfterOne.runCount === 1 && !bug1AfterOne.norm && bug1AfterOne.unit === "wells" && bug1AfterOne.scope === "active" && bug1AfterOne.compViewNotNorm &&
        bug1AfterZero &&
        bug7DemoSwitchOk &&
        bug2ReplaceOk &&
        bug4ZeroVarOk &&
        bug5QcOk &&
        bug5AucOk &&
        bug6MixedOk &&
        flaggedInPlateMeansOk &&
        bug8TopbarParityOk;
      report(ok, "Methodological guardrails (Test Family, Plate Means vs Wells, Post-Stats Audit + Section 4 log) & all #58 bug fixes (#1-#8) pass cleanly",
        ok ? "" : JSON.stringify({ errors, beforeStatsViewed, wellsParamCheck, nonParamWellsCheck, platesModeCheck, postStatsUi, logSec4Ok, bug3CtrlRenameOk, bug1AfterOne, bug1AfterZero, bug7DemoSwitchOk, bug2ReplaceOk, bug4ZeroVarOk, bug5QcOk, bug5AucOk, bug6MixedOk, flaggedPlatesWarnBefore, flaggedPlatesWarnAfter, analyzerTopbar, builderTopbar }));
      await page.close();
    }

    // Helper: execute generated Python VMR template end-to-end; fail loudly in CI if python3/deps are missing, log explicit SKIP locally
    function runPythonVmrTemplateCheck(label, csvFilename, csvText, pyTemplate, expectedA1) {
      const pyCheck = spawnSync("python3", ["-c", "import pandas, numpy, matplotlib"], { encoding: "utf8" });
      if (pyCheck.status !== 0) {
        if (process.env.CI) {
          return {
            ok: false,
            skipped: false,
            error: `${label}: CI requires python3 with pandas, numpy, and matplotlib (${(pyCheck.stderr || pyCheck.error?.message || "missing python3/deps").trim()})`
          };
        }
        console.log(`  SKIP  ${label} Python execution (python3 pandas/numpy/matplotlib not installed locally)`);
        return { ok: true, skipped: true };
      }
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zantiks-py-"));
      try {
        fs.writeFileSync(path.join(tmpDir, csvFilename), csvText, "utf8");
        const scriptPath = path.join(tmpDir, "analyze_vmr.py");
        fs.writeFileSync(scriptPath, "import matplotlib\nmatplotlib.use('Agg')\n" + pyTemplate, "utf8");
        const pyRun = spawnSync("python3", [scriptPath], { cwd: tmpDir, encoding: "utf8" });
        if (pyRun.status !== 0) {
          return {
            ok: false,
            skipped: false,
            error: `${label}: python3 exited ${pyRun.status}: ${(pyRun.stderr || pyRun.stdout || "").trim()}`
          };
        }
        const vmrPath = path.join(tmpDir, "well_vmr_summary.csv");
        if (!fs.existsSync(vmrPath)) {
          return { ok: false, skipped: false, error: `${label}: well_vmr_summary.csv not generated` };
        }
        const vmrCsv = fs.readFileSync(vmrPath, "utf8").trim().split("\n");
        const cols = vmrCsv[0].split(",");
        const rowA1 = vmrCsv.slice(1).map((l) => l.split(",")).find((r) => r[cols.indexOf("well")] === "A1");
        const pyLight = rowA1 ? parseFloat(rowA1[cols.indexOf("LIGHT")]) : NaN;
        const pyDark = rowA1 ? parseFloat(rowA1[cols.indexOf("DARK")]) : NaN;
        const pyDelta = rowA1 ? parseFloat(rowA1[cols.indexOf("dark_minus_light")]) : NaN;
        const ok =
          Math.abs(pyLight - expectedA1.light) < 1e-9 &&
          Math.abs(pyDark - expectedA1.dark) < 1e-9 &&
          Math.abs(pyDelta - expectedA1.delta) < 1e-9;
        return ok
          ? { ok: true, skipped: false, pyLight, pyDark, pyDelta }
          : {
            ok: false,
            skipped: false,
            error: `${label}: expected LIGHT=${expectedA1.light}, DARK=${expectedA1.dark}, delta=${expectedA1.delta}; got LIGHT=${pyLight}, DARK=${pyDark}, delta=${pyDelta}`
          };
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    // 7p. Analyzer DAWN/DUSK transition phase classification, hasVmrBurst gating (ramped circadian vs abrupt L/D) & Python VMR parity
    {
      const { page, errors } = await openFreshAnalyzer();

      // 1. Direct classifyPhase() assertions for DAWN, DUSK, LIGHT, DARK
      const classifyCheck = await page.evaluate(() => {
        const cp = window.ZANTIKS_ANALYZER_CORE.classifyPhase;
        const dawn = cp("DAWN");
        const dusk = cp("DUSK");
        const light = cp("LIGHT");
        const dark = cp("DARK");
        return {
          dawnOk: dawn.kind === "transition" && dawn.colorHint === "dawn" && !dawn.isLight && !dawn.isDark && dawn.isTransition === true,
          duskOk: dusk.kind === "transition" && dusk.colorHint === "dusk" && !dusk.isLight && !dusk.isDark && dusk.isTransition === true,
          lightOk: light.kind === "light" && light.isLight === true && !light.isDark && light.isTransition === false,
          darkOk: dark.kind === "dark" && dark.isDark === true && !dark.isLight && dark.isTransition === false
        };
      });

      // 2. Synthetic ramped Circadian CSV: DAWN (90) -> LIGHT (10) -> DUSK (80) -> DARK (40) x 2 days across 6 wells
      const wells6 = ["A1", "A2", "A3", "B1", "B2", "B3"];
      const rampedRows = [["RUNTIME", "TEMP_C", "PHASE", "TIME_BIN", ...wells6.map((w) => "DIST_" + w)].join(",")];
      const phaseSeq = [
        ["DAWN", 90], ["DAWN", 90],
        ["LIGHT", 10], ["LIGHT", 10], ["LIGHT", 10],
        ["DUSK", 80], ["DUSK", 80],
        ["DARK", 40], ["DARK", 40], ["DARK", 40]
      ];
      let tSec = 0;
      let binIdx = 0;
      for (let day = 0; day < 2; day++) {
        for (const [ph, baseVal] of phaseSeq) {
          tSec += 10;
          binIdx++;
          const vals = wells6.map((w) => (w.startsWith("A") ? baseVal : baseVal + 2).toFixed(2));
          rampedRows.push([tSec, "22.0", ph, binIdx, ...vals].join(","));
        }
      }
      const rampedCsvText = rampedRows.join("\n") + "\n";
      await page.setInputFiles("#analyzerFileInput", {
        name: "ramped_circadian_2d_6w.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(rampedCsvText, "utf8")
      });
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().summaryParsed?.filename === "ramped_circadian_2d_6w.csv");
      await page.click('#analyzerStepper [data-goto="groups"]');
      await page.click("#addGroupBtn");
      await page.click("#addGroupBtn");
      await page.click("#autoAssignRowsBtn");
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click('#chartTabsBar [data-chart-tab="timeseries"]');
      const tsBandHtml = await page.evaluate(() => document.getElementById("tsChartSvg")?.innerHTML || "");

      await page.click('#chartTabsBar [data-chart-tab="comparison"]');
      await page.selectOption("#compViewSel", "vmr");
      const rampedRes = await page.evaluate(() => {
        const core = window.ZANTIKS_ANALYZER_CORE;
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const a = st.analysis;
        const wsA1 = a.wellsById.A1;
        const vmrOptText = document.querySelector('#compViewSel option[value="vmr"]')?.textContent?.trim() || "";
        const compSvgTxt = document.getElementById("compChartSvg")?.textContent || "";
        const prismMetrics = core.getAvailablePrismMetrics(a).map((m) => m.id);
        const exportPayload = window.ZANTIKS_ANALYZER_UI.buildExportPayload();
        const wellCsvV2 = core.exportWellSummaryCsv(exportPayload);
        const wellCsvV1 = core.buildWellSummaryCsv(a);
        const pyTemplate = core.buildPythonTemplate(a, st.summaryParsed);
        return {
          lightMeanA1: wsA1?.vmr?.lightMean,
          darkMeanA1: wsA1?.vmr?.darkMean,
          deltaA1: wsA1?.vmr?.darkMinusLight,
          phaseDistDawnA1: wsA1?.phaseDist?.DAWN,
          phaseDistDuskA1: wsA1?.phaseDist?.DUSK,
          darkOnsetBurstA1: wsA1?.vmr?.darkOnsetBurst,
          lightOnsetBurstA1: wsA1?.vmr?.lightOnsetBurst,
          hasVmr: a.capabilities?.hasVmr,
          hasVmrBurst: a.capabilities?.hasVmrBurst,
          vmrOptText,
          compHasBurstBar: compSvgTxt.includes("Dark-Onset Burst"),
          compHasNaN: compSvgTxt.includes("NaN"),
          prismMetrics,
          v2Header: wellCsvV2.replace(/^\uFEFF/, "").split("\n")[0],
          v1Header: wellCsvV1.split("\n")[0],
          pyTemplate
        };
      });

      const pyExclRegexOk =
        rampedRes.pyTemplate.includes("DAWN|DUSK") &&
        rampedRes.pyTemplate.includes("is_excl") &&
        rampedRes.pyTemplate.includes("vmr_df = vmr_df[vmr_df['cond'] != '']") &&
        rampedRes.pyTemplate.includes("startswith('DAWN')") &&
        rampedRes.pyTemplate.includes("startswith('DUSK')") &&
        !rampedRes.pyTemplate.includes("np.where(is_dark, 'DARK', 'LIGHT')");

      const pyExecRes = runPythonVmrTemplateCheck(
        "7p (DAWN/DUSK)",
        "ramped_circadian_2d_6w.csv",
        rampedCsvText,
        rampedRes.pyTemplate,
        { light: 10, dark: 40, delta: 30 }
      );

      const rampedOk =
        Math.abs(rampedRes.lightMeanA1 - 10) < 1e-9 &&
        Math.abs(rampedRes.darkMeanA1 - 40) < 1e-9 &&
        Math.abs(rampedRes.deltaA1 - 30) < 1e-9 &&
        Math.abs(rampedRes.phaseDistDawnA1?.total - 360) < 1e-9 &&
        Math.abs(rampedRes.phaseDistDawnA1?.mean - 90) < 1e-9 &&
        Math.abs(rampedRes.phaseDistDuskA1?.total - 320) < 1e-9 &&
        Math.abs(rampedRes.phaseDistDuskA1?.mean - 80) < 1e-9 &&
        rampedRes.darkOnsetBurstA1 === null &&
        rampedRes.lightOnsetBurstA1 === null &&
        rampedRes.hasVmr === true &&
        rampedRes.hasVmrBurst === false &&
        tsBandHtml.includes("rgba(253, 186, 116, 0.30)") &&
        tsBandHtml.includes("rgba(165, 180, 252, 0.28)") &&
        rampedRes.vmrOptText === "VMR (Light vs Dark)" &&
        !rampedRes.compHasBurstBar &&
        !rampedRes.compHasNaN &&
        rampedRes.prismMetrics.includes("vmr_delta") &&
        !rampedRes.prismMetrics.includes("vmr_burst") &&
        !rampedRes.prismMetrics.includes("norm_vmr_burst_pct_ctrl") &&
        !rampedRes.v2Header.includes("vmr_dark_onset_burst") &&
        !rampedRes.v1Header.includes("vmr_dark_onset_burst") &&
        pyExclRegexOk &&
        pyExecRes.ok;

      // 3. Non-ramped abrupt L/D demo (ld_24w) retains hasVmrBurst=true, burst bar & vmr_dark_onset_burst column
      await page.selectOption("#demoPresetSelect", "ld_24w");
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click('#chartTabsBar [data-chart-tab="comparison"]');
      await page.selectOption("#compViewSel", "vmr");
      const abruptRes = await page.evaluate(() => {
        const core = window.ZANTIKS_ANALYZER_CORE;
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const a = st.analysis;
        const wsA1 = a.wellsById.A1;
        const vmrOptText = document.querySelector('#compViewSel option[value="vmr"]')?.textContent?.trim() || "";
        const compSvgTxt = document.getElementById("compChartSvg")?.textContent || "";
        const prismMetrics = core.getAvailablePrismMetrics(a).map((m) => m.id);
        const v2Header = core.exportWellSummaryCsv(window.ZANTIKS_ANALYZER_UI.buildExportPayload()).replace(/^\uFEFF/, "").split("\n")[0];
        return {
          hasVmr: a.capabilities?.hasVmr,
          hasVmrBurst: a.capabilities?.hasVmrBurst,
          burstFinite: Number.isFinite(wsA1?.vmr?.darkOnsetBurst),
          vmrOptText,
          compHasBurstBar: compSvgTxt.includes("Dark-Onset Burst"),
          hasBurstMetric: prismMetrics.includes("vmr_burst"),
          hasBurstCol: v2Header.includes("vmr_dark_onset_burst")
        };
      });
      const abruptOk =
        abruptRes.hasVmr === true &&
        abruptRes.hasVmrBurst === true &&
        abruptRes.burstFinite &&
        abruptRes.vmrOptText === "VMR (Light vs Dark & Burst)" &&
        abruptRes.compHasBurstBar &&
        abruptRes.hasBurstMetric &&
        abruptRes.hasBurstCol;

      const ok = errors.length === 0 && Object.values(classifyCheck).every(Boolean) && rampedOk && abruptOk;
      report(ok, "Analyzer DAWN/DUSK transition phase classification, hasVmrBurst gating (ramped circadian vs abrupt L/D) & Python VMR parity pass",
        ok ? "" : JSON.stringify({ errors, classifyCheck, rampedRes: { ...rampedRes, pyTemplate: undefined }, pyExclRegexOk, pyExecRes, abruptRes }));
      await page.close();
    }

    // 7q. Multi-Track _RAMP transition tagging, 24-char combo guard, Analyzer ramp VMR exclusion & Python parity
    {
      const { page, errors } = await openFreshAnalyzer();

      // 1. Compile DARK (60s) -> 5-min ramp-up WHITE (0->100%) -> steady WHITE (120s) -> 5-min ramp-down WHITE (100->0%) -> DARK (60s)
      //    plus a long combo ramp+temp+vib clip and a ramp+strobe clip + 100%-ramp-next-to-steady-100% merge-boundary check
      const compileRes = await page.evaluate(() => {
        const core = window.ZANTIKS_ANALYZER_CORE;
        const cp = core.classifyPhase;
        const rampClips = [
          { id: "r_up", track: "WHITE", startSec: 60, endSec: 360, val: 0, endVal: 100, curve: "linear", rampSteps: 8 },
          { id: "steady_w", track: "WHITE", startSec: 360, endSec: 480, val: 100 },
          { id: "r_dn", track: "WHITE", startSec: 480, endSec: 780, val: 100, endVal: 0, curve: "linear", rampSteps: 8 }
        ];
        const comp = compileMultiTrackSlices(rampClips, 840, 10, 22);
        const slices = comp.slices;

        // Verify ramp slices (60..360 and 480..780), steady WHITE (360..480), and DARK (0..60 and 780..840)
        const darkSlices = slices.filter((sl) => sl.topLights.length === 0 && sl.bottomLights.length === 0);
        const rampUpSlices = slices.filter((sl) => sl.startSec >= 60 && sl.endSec <= 360 && sl.topLights.length > 0);
        const steadyWhiteSlices = slices.filter((sl) => sl.startSec >= 360 && sl.endSec <= 480);
        const rampDownSlices = slices.filter((sl) => sl.startSec >= 480 && sl.endSec <= 780 && sl.topLights.length > 0);
        const litRampSlices = [...rampUpSlices, ...rampDownSlices];

        const rampSlicesOk =
          rampUpSlices.length >= 6 &&
          rampDownSlices.length >= 6 &&
          litRampSlices.every((sl) => sl.isRamp === true && sl.csvTag.includes("_RAMP") && sl.csvTag.length <= 24) &&
          darkSlices.length >= 2 &&
          darkSlices.every((sl) => sl.isRamp === false && !sl.csvTag.includes("_RAMP") && sl.csvTag.includes("_DARK")) &&
          steadyWhiteSlices.length === 1 &&
          steadyWhiteSlices[0].isRamp === false &&
          steadyWhiteSlices[0].startSec === 360 &&
          steadyWhiteSlices[0].endSec === 480 &&
          !steadyWhiteSlices[0].csvTag.includes("_RAMP") &&
          steadyWhiteSlices[0].csvTag.includes("_WHITE");

        // Verify merge-signature isolation: ramp ending at 100% never merges into adjacent steady 100% slice
        const edgeComp = compileMultiTrackSlices([
          { id: "r99", track: "WHITE", startSec: 0, endSec: 20, val: 99, endVal: 100, curve: "linear", rampSteps: 2 },
          { id: "s100", track: "WHITE", startSec: 20, endSec: 40, val: 100 }
        ], 40, 10, 22);
        const noRampSteadyMergeOk =
          edgeComp.slices.length >= 2 &&
          edgeComp.slices[edgeComp.slices.length - 1].startSec === 20 &&
          edgeComp.slices[edgeComp.slices.length - 1].isRamp === false &&
          edgeComp.slices[edgeComp.slices.length - 2].isRamp === true;

        // Verify 24-char guard & stim precedence on long combo ramp + temp + vib + strobe clips
        const comboComp = compileMultiTrackSlices([
          { id: "c_w", track: "WHITE", startSec: 0, endSec: 60, val: 10, endVal: 100, curve: "linear", rampSteps: 4 },
          { id: "c_g", track: "GREEN", startSec: 0, endSec: 60, val: 100 },
          { id: "c_t", track: "TEMP", startSec: 0, endSec: 60, val: 28.5 },
          { id: "c_v", track: "VIB", startSec: 0, endSec: 60, val: "U2" },
          { id: "c_s", track: "BLUE", startSec: 60, endSec: 120, val: 10, endVal: 100, curve: "linear", rampSteps: 4, strobeHz: 10 }
        ], 120, 10, 22);
        const vibSlice = comboComp.slices.find((sl) => sl.vibTrigger);
        const strobeSlice = comboComp.slices.find((sl) => sl.strobeHz === 10);
        const vibCls = vibSlice ? cp(vibSlice.csvTag) : null;
        const strobeCls = strobeSlice ? cp(strobeSlice.csvTag) : null;
        const comboOk =
          Boolean(vibSlice) &&
          vibSlice.isRamp === true &&
          vibSlice.csvTag.length <= 24 &&
          vibSlice.csvTag.includes("_RAMP") &&
          /_VU[0-3]$/.test(vibSlice.csvTag) &&
          vibCls?.kind === "stim" &&
          vibCls?.stimType === "vib" &&
          vibCls?.isLight === false &&
          Boolean(strobeSlice) &&
          strobeSlice.isRamp === true &&
          strobeSlice.csvTag.length <= 24 &&
          strobeSlice.csvTag.includes("_RAMP") &&
          strobeSlice.csvTag.endsWith("_10HZ") &&
          strobeCls?.kind === "stim" &&
          strobeCls?.stimType === "light_pulse" &&
          strobeCls?.isLight === false;

        // Verify classifyPhase("S2_WHITE_RAMP") and parseExperimentContext schedule metadata
        const clsRamp = cp("S2_WHITE_RAMP");
        const classifyRampOk =
          clsRamp.kind === "transition" &&
          clsRamp.colorHint === "ramp" &&
          clsRamp.isLight === false &&
          clsRamp.isDark === false &&
          clsRamp.isTransition === true &&
          clsRamp.isStim === false;

        const ctx = core.parseExperimentContext({
          plateId: "24well",
          stimId: "multi_phase",
          inputs: { thermEnabled: false, defaultTemp: 22 },
          stimParams: { mpTimelineSec: 840, timeBinSec: 10, mpCycles: 1 },
          timelineClips: rampClips
        }, "multitrack_ramp.json");
        const ctxRampSpans = (ctx?.phaseSchedule || []).filter((ps) => ps.phase.includes("_RAMP"));
        const ctxSteadySpan = (ctx?.phaseSchedule || []).find((ps) => ps.startSec === 360 && ps.endSec === 480);
        const ctxDarkSpans = (ctx?.phaseSchedule || []).filter((ps) => ps.phase.includes("_DARK"));
        const contextScheduleOk =
          ctxRampSpans.length === litRampSlices.length &&
          ctxRampSpans.every((ps) => ps.kind === "transition" && ps.colorHint === "ramp") &&
          ctxSteadySpan?.kind === "light" &&
          ctxSteadySpan?.colorHint === "light" &&
          ctxDarkSpans.length >= 2 &&
          ctxDarkSpans.every((ps) => ps.kind === "dark" && ps.colorHint === "dark");

        return {
          rampSlicesOk,
          noRampSteadyMergeOk,
          comboOk,
          classifyRampOk,
          contextScheduleOk,
          vibTag: vibSlice?.csvTag,
          strobeTag: strobeSlice?.csvTag,
          slices: slices.map((sl) => ({
            startSec: sl.startSec,
            endSec: sl.endSec,
            bins: sl.bins,
            isRamp: sl.isRamp,
            isDark: sl.topLights.length === 0 && sl.bottomLights.length === 0,
            csvTag: sl.csvTag
          }))
        };
      });

      // 2. Feed synthetic Multi-Track CSV built directly from those exact compiled slice phase tags:
      //    DARK = 40, ramp-up *_RAMP = 90, steady WHITE = 10, ramp-down *_RAMP = 80, final DARK = 40
      const wells6 = ["A1", "A2", "A3", "B1", "B2", "B3"];
      const mtRows = [["RUNTIME", "TEMP_C", "PHASE", "TIME_BIN", ...wells6.map((w) => "DIST_" + w)].join(",")];
      let binIdx = 0;
      for (const sl of compileRes.slices) {
        let baseVal;
        if (sl.isDark) baseVal = 40;
        else if (sl.isRamp) baseVal = sl.startSec < 360 ? 90 : 80;
        else baseVal = 10;
        for (let b = 0; b < sl.bins; b++) {
          binIdx++;
          const tSec = sl.startSec + (b + 1) * 10;
          const vals = wells6.map((w) => (w.startsWith("A") ? baseVal : baseVal + 2).toFixed(2));
          mtRows.push([tSec, "22.0", sl.csvTag, binIdx, ...vals].join(","));
        }
      }
      const mtCsvText = mtRows.join("\n") + "\n";

      await page.setInputFiles("#analyzerFileInput", {
        name: "multitrack_ramped_vmr_6w.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(mtCsvText, "utf8")
      });
      await page.waitForFunction(() => window.ZANTIKS_ANALYZER_UI.getState().summaryParsed?.filename === "multitrack_ramped_vmr_6w.csv");
      await page.click('#analyzerStepper [data-goto="groups"]');
      await page.click("#addGroupBtn");
      await page.click("#addGroupBtn");
      await page.click("#autoAssignRowsBtn");
      await page.click('#analyzerStepper [data-goto="plots"]');
      await page.click('#chartTabsBar [data-chart-tab="timeseries"]');
      const tsBandHtml = await page.evaluate(() => document.getElementById("tsChartSvg")?.innerHTML || "");

      await page.click('#chartTabsBar [data-chart-tab="comparison"]');
      await page.selectOption("#compViewSel", "vmr");
      const mtRes = await page.evaluate(() => {
        const core = window.ZANTIKS_ANALYZER_CORE;
        const st = window.ZANTIKS_ANALYZER_UI.getState();
        const a = st.analysis;
        const wsA1 = a.wellsById.A1;
        const vmrOptText = document.querySelector('#compViewSel option[value="vmr"]')?.textContent?.trim() || "";
        const compSvgTxt = document.getElementById("compChartSvg")?.textContent || "";
        const prismMetrics = core.getAvailablePrismMetrics(a).map((m) => m.id);
        const exportPayload = window.ZANTIKS_ANALYZER_UI.buildExportPayload();
        const wellCsvV2 = core.exportWellSummaryCsv(exportPayload);
        const wellCsvV1 = core.buildWellSummaryCsv(a);
        const pyTemplate = core.buildPythonTemplate(a, st.summaryParsed);
        return {
          lightMeanA1: wsA1?.vmr?.lightMean,
          darkMeanA1: wsA1?.vmr?.darkMean,
          deltaA1: wsA1?.vmr?.darkMinusLight,
          darkOnsetBurstA1: wsA1?.vmr?.darkOnsetBurst,
          lightOnsetBurstA1: wsA1?.vmr?.lightOnsetBurst,
          hasVmr: a.capabilities?.hasVmr,
          hasVmrBurst: a.capabilities?.hasVmrBurst,
          vmrOptText,
          compHasBurstBar: compSvgTxt.includes("Dark-Onset Burst"),
          compHasNaN: compSvgTxt.includes("NaN"),
          prismMetrics,
          v2Header: wellCsvV2.replace(/^\uFEFF/, "").split("\n")[0],
          v1Header: wellCsvV1.split("\n")[0],
          pyTemplate
        };
      });

      const pyRampTemplateOk =
        mtRes.pyTemplate.includes("_RAMP(?:_|$)") &&
        mtRes.pyTemplate.includes("'_RAMP_' in ph_up or ph_up.endswith('_RAMP')") &&
        mtRes.pyTemplate.includes("#fdba74");

      const pyExecRes = runPythonVmrTemplateCheck(
        "7q (Multi-Track _RAMP)",
        "multitrack_ramped_vmr_6w.csv",
        mtCsvText,
        mtRes.pyTemplate,
        { light: 10, dark: 40, delta: 30 }
      );

      const mtAnalyzerOk =
        Math.abs(mtRes.lightMeanA1 - 10) < 1e-9 &&
        Math.abs(mtRes.darkMeanA1 - 40) < 1e-9 &&
        Math.abs(mtRes.deltaA1 - 30) < 1e-9 &&
        mtRes.darkOnsetBurstA1 === null &&
        mtRes.lightOnsetBurstA1 === null &&
        mtRes.hasVmr === true &&
        mtRes.hasVmrBurst === false &&
        tsBandHtml.includes("rgba(254, 215, 170, 0.28)") &&
        mtRes.vmrOptText === "VMR (Light vs Dark)" &&
        !mtRes.compHasBurstBar &&
        !mtRes.compHasNaN &&
        mtRes.prismMetrics.includes("vmr_delta") &&
        !mtRes.prismMetrics.includes("vmr_burst") &&
        !mtRes.prismMetrics.includes("norm_vmr_burst_pct_ctrl") &&
        !mtRes.v2Header.includes("vmr_dark_onset_burst") &&
        !mtRes.v1Header.includes("vmr_dark_onset_burst") &&
        pyRampTemplateOk &&
        pyExecRes.ok;

      // 3. High-index (>= 106 slices) extreme-suffix token-boundary compaction & Analyzer consecutive stimulusMarkers check
      const highIdxRes = await page.evaluate(() => {
        const core = window.ZANTIKS_ANALYZER_CORE;
        const cp = core.classifyPhase;
        const allLedTracks = ["WHITE", "BLUE", "GREEN", "RED", "UV", "U_WHITE", "U_BLUE", "U_GREEN", "U_RED", "U_UV"];
        const highClips = [
          // 104 consecutive 1s VIB pulses -> slices S1..S104 (0..104s)
          { id: "pad_vib", track: "VIB", startSec: 0, endSec: 104, val: "U1", repeatSec: 1 },
          // S105 & S106 (104..106s): consecutive WHITE ramp + 24.5C + 10Hz + VU1 + AUD triggers
          { id: "h_w", track: "WHITE", startSec: 104, endSec: 106, val: 20, endVal: 100, curve: "linear", rampSteps: 2, strobeHz: 10 },
          { id: "h_t", track: "TEMP", startSec: 104, endSec: 108, val: 24.5 },
          { id: "h_v", track: "VIB", startSec: 104, endSec: 106, val: "U1", repeatSec: 1 },
          { id: "h_a", track: "AUDIO", startSec: 104, endSec: 106, val: "tone.wav", repeatSec: 1 },
          // S107 (106..107s): worst-case 10 LEDs + ramp + 24.5C + 2+5+10Hz + VU1 + AUD
          { id: "w10_w", track: "WHITE", startSec: 106, endSec: 107, val: 20, endVal: 100, curve: "linear", rampSteps: 2, strobeHz: 2 },
          { id: "w10_b", track: "BLUE", startSec: 106, endSec: 107, val: 100, strobeHz: 5 },
          { id: "w10_g", track: "GREEN", startSec: 106, endSec: 107, val: 100, strobeHz: 10 },
          ...allLedTracks.filter((tr) => !["WHITE", "BLUE", "GREEN"].includes(tr)).map((tr, i) => ({
            id: `w10_${i}`, track: tr, startSec: 106, endSec: 107, val: 100
          })),
          { id: "w10_v", track: "VIB", startSec: 106, endSec: 107, val: "U1" },
          { id: "w10_a", track: "AUDIO", startSec: 106, endSec: 107, val: "tone.wav" },
          // S108 (107..108s): worst-case non-stim 10 LEDs + ramp + 24.5C
          { id: "n10_w", track: "WHITE", startSec: 107, endSec: 108, val: 20, endVal: 100, curve: "linear", rampSteps: 2 },
          ...allLedTracks.filter((tr) => tr !== "WHITE").map((tr, i) => ({
            id: `n10_${i}`, track: tr, startSec: 107, endSec: 108, val: 100
          }))
        ];
        const highComp = compileMultiTrackSlices(highClips, 108, 1, 22);
        const sls = highComp.slices;
        const s105 = sls[104];
        const s106 = sls[105];
        const s107 = sls[106];
        const s108 = sls[107];

        const allLenOk = sls.every((sl) => sl.csvTag.length <= 24);
        const allPrefixOk = sls.every((sl) => sl.csvTag.startsWith(`S${sl.idx}_`));
        const noMidTokenChop = sls.every((sl) => !/(_AU|_VU|_RAM|_DAR|_TEM|_H|_)$/.test(sl.csvTag));
        const allAdjDistinct = sls.every((sl, i) => i === 0 || sl.csvTag !== sls[i - 1].csvTag);
        const allClassOk = sls.every((sl) => {
          const c = cp(sl.csvTag);
          const isStimSlice = sl.vibTrigger || sl.audioTrigger || sl.strobeHz > 0;
          if (isStimSlice) return c.kind === "stim" && c.isStim === true;
          if (sl.isRamp) return c.kind === "transition" && c.colorHint === "ramp" && c.isTransition === true;
          return true;
        });

        const exactTagsOk =
          sls.length === 108 &&
          s105?.csvTag === "S105_W_RAMP_10HZ_VU1_AUD" &&
          s106?.csvTag === "S106_W_RAMP_10HZ_VU1_AUD" &&
          s107?.csvTag === "S107_2_5_10HZ_VU1_AUD" &&
          s108?.csvTag === "S108_MIX_RAMP" &&
          cp(s105.csvTag).kind === "stim" &&
          cp(s106.csvTag).kind === "stim" &&
          cp(s107.csvTag).kind === "stim" &&
          cp(s108.csvTag).kind === "transition" &&
          cp(s108.csvTag).colorHint === "ramp";

        // Feed consecutive S105_* and S106_* rows (same TRIAL=1) into computeAnalysis -> must remain 2 distinct stimulusMarkers
        const stimCsv = [
          "RUNTIME,TEMP_C,TRIAL,PHASE,TIME_BIN,DIST_A1,DIST_A2",
          `1,24.5,1,${s105.csvTag},1,15.0,16.0`,
          `2,24.5,1,${s106.csvTag},2,18.0,19.0`
        ].join("\n") + "\n";
        const stimParsed = core.parseZantiksCsv(stimCsv, "high_idx_consecutive_stim.csv");
        const stimAnalysis = core.computeAnalysis({ parsed: stimParsed });
        const markers = stimAnalysis?.timeSeries?.stimulusMarkers || [];
        const markersOk =
          markers.length === 2 &&
          markers[0].phase === s105.csvTag &&
          markers[1].phase === s106.csvTag;

        return {
          sliceCount: sls.length,
          allLenOk,
          allPrefixOk,
          noMidTokenChop,
          allAdjDistinct,
          allClassOk,
          exactTagsOk,
          markersCount: markers.length,
          markersOk,
          sampleTags: [s105?.csvTag, s106?.csvTag, s107?.csvTag, s108?.csvTag]
        };
      });

      const highIdxOk =
        highIdxRes.allLenOk &&
        highIdxRes.allPrefixOk &&
        highIdxRes.noMidTokenChop &&
        highIdxRes.allAdjDistinct &&
        highIdxRes.allClassOk &&
        highIdxRes.exactTagsOk &&
        highIdxRes.markersOk;

      const ok =
        errors.length === 0 &&
        compileRes.rampSlicesOk &&
        compileRes.noRampSteadyMergeOk &&
        compileRes.comboOk &&
        compileRes.classifyRampOk &&
        compileRes.contextScheduleOk &&
        mtAnalyzerOk &&
        highIdxOk;
      report(ok, "Multi-Track _RAMP transition tagging, token-boundary 24-char compaction (S105-S108), Analyzer VMR exclusion & Python parity pass",
        ok ? "" : JSON.stringify({ errors, compileRes: { ...compileRes, slices: compileRes.slices.length }, mtRes: { ...mtRes, pyTemplate: undefined }, pyRampTemplateOk, pyExecRes, highIdxRes }));
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
