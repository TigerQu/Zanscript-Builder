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
  }
} finally {
  await browser.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
