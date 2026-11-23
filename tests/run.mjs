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
import fs from "node:fs";
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
        const s2Block = code.split("ACTION RUN_S2")[1].split("COMPLETE")[0];
        const s3Block = code.split("ACTION RUN_S3")[1].split("COMPLETE")[0];

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
          s2TriggersBoth: s2Block.includes('ZCOMMAND("U1 D1000 M1 M-1 M1 M-1 M1 M-1 M1 M-1 M1 M-1")') &&
            s2Block.includes('LOAD(AUDIO_FILE,"alarm.wav")'),
          s3NoDuplicateTrigger: !s3Block.includes("ZCOMMAND(") && !s3Block.includes("LOAD(AUDIO_FILE"),
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

        return {
          gammaPerceptualMath: linMid === 50 && gamDawnMid < 26 && gamDuskMid < 26 && Math.abs(gamDawnMid - gamDuskMid) <= 1,
          sinePulseMath: sineStart === 5 && sineMid === 100 && sineEnd === 5,
          customCurveUi: clipHasInlineCurve && kfHandlesCount === 6 && comp.slices.length === 12,
          customCurveCode: code.includes("DEFINE S12_BINS") && !code.includes("DEFINE S13_BINS"),
          roundTripOk,
          circGammaVsLinear: circGammaCode.includes("SET(X_LED_DRIVE,4,82)") && circLinearCode.includes("SET(X_LED_DRIVE,4,614)")
        };
      });
      const ok = Object.values(curveCheck).every(Boolean);
      report(ok, "Custom PWM curves (Gamma 2.2, Sine, Custom Keyframes, Steps, inline envelopes & Circadian Gamma) work and round-trip",
        ok ? "" : JSON.stringify(curveCheck));
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
