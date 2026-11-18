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

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
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

await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
