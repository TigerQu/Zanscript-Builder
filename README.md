# Zanscript-Builder

**Zanscript-Builder** (*Zantiks MWP Script Builder*) is a standalone, zero-dependency browser application for designing behavioral tracking experiments on **Zantiks MWP** systems (**MWP Z3** and **MWP Z2 / Z2S**). It generates ready-to-compile **Zanscript (`.zs`)** files for camera calibration, multi-well plate arena/zone asset creation, tracking parameter verification, and full stimulus-driven assays.

**Live Web Builder:** [https://tigerqu.github.io/Zanscript-Builder/](https://tigerqu.github.io/Zanscript-Builder/)

> [!IMPORTANT]
> **Unofficial Community Tool — Use at Your Own Risk**
> *Zanscript-Builder* is an independent open-source project and is **not affiliated with, endorsed by, or supported by Zantiks Ltd.** Generated `.zs` scripts are provided **"AS IS"** without warranty of any kind, and the authors assume **no liability** for any potential hardware damage, data loss, or experimental issues. Always inspect generated code, verify physical hardware connections, and test new protocols on an empty plate before running live assays. See [Disclaimer & Hardware Safety](#disclaimer--hardware-safety) below.

---

## Visual Walkthrough

### 1. Step-by-Step Experiment Configuration
Walk through Study, Organism, Plate, Stimulus, and Data & Video pages while the **Run Summary** sidebar tracks total runtime, well count, and CSV outputs in real time:

![Step-by-step wizard workflow](assets/demo_wizard_workflow.gif)

### 2. True-Scale Plate Preview & Millimeter Calibration
Preview round, square, and Petri dish geometries at true millimeter scale, fine-tune well offsets inline with one-click **Auto 50% Inner Zone**, or manage unit-wide calibration profiles in **Plate Config**:

![Plate geometry preview and calibration](assets/demo_plate_calibration.gif)

### 3. Coordinated 4-Script Preview & One-Click `.zip` Export
Inspect syntax-highlighted Zanscripts and CSV column schemas for all four workflow steps, copy Zantiks-safe service names, or download the complete run bundle as a `.zip`:

![Script tabs and ZIP bundle export](assets/demo_script_export.gif)

---

## Key Features

- **Zero-Install & Offline Ready**: Runs directly in any modern browser over `https://` or local `file://` with no local server, build step, or internet connection required—ideal for dedicated lab computers connected to a Zantiks unit.
- **Complete 4-Step Zantiks Workflow**: Generates standalone `.zs` scripts for every stage of an MWP experiment, viewable individually with syntax highlighting or downloadable together as a `.zip` bundle (including a run sheet `README_STEPS.txt`) via an embedded pure-JavaScript ZIP builder.
- **9 Plate & Dish Formats with True-Scale Preview**: Supports 6-, 12-, 24- (standard, Costar, and square), 48-, and 96-well (round and square) plates plus 90 mm Petri dishes, complete with a live millimeter-accurate SVG layout preview.
- **Visual Plate Calibration & Shared Config**: Fine-tune `X_OFFSET`, `Y_OFFSET`, `COL_STEP`, `ROW_STEP`, `RADIUS` / `SIDE LENGTH`, and `INNER_ZONE` inline or across all formats in the **Plate Config** modal, with one-click **Auto 50% Inner Zone** calculation ($r_{\text{inner}} = r / \sqrt{2}$) for thigmotaxis assays.
- **8 Built-in Stimulus Protocols**: Configure constant baseline tracking, alternating Light/Dark cycles, Light-Off startle pulses, Light-On flashes, stepper-motor Vibration startle taps (`U0`–`U3`), multi-day Circadian `L:D` cycles, an advanced **AE/Premiere-style 11-Track Multi-Track Timeline** (listed separately under **Advanced**) (independent Overhead `TOP` and Underneath `BOT` `White / Blue 470 / Green 530 / Red 625 / UV 365` LED tracks + `Temp °C` track compiled automatically into flicker-free Zanscript time slices), or **Temperature Step / Ramp** curves (`SET(THERMOSTAT, ...)`).
- **Independent Overhead & Underneath Multi-Wavelength LED Control**: Select global **Z3 LED Position / Mount** (`Overhead Only (Top Ch 0-5)`, `Underneath Only (Bottom Ch 8-13)`, or `Both Overhead + Underneath`) across **White (~6000K, Ch 4 / 12)**, **Blue (470 nm, Ch 1 / 9)**, **Green (530 nm, Ch 3 / 11)**, **Red (625 nm, Ch 5 / 13)**, and **UV (365 nm, Ch 0 / 8)** on **MWP Z3** (`X_LED_DRIVE` PWM `0–4095` paired with `LIGHTS(LIGHT13–16, ON/OFF)` RGB/UV port gates), or orchestrate Overhead (`Ch 0,1,3,4,5`) and toggleable `Bottom LEDs (Ch 8-13)` (`Ch 8,9,11,12,13`) independently in the Multi-Track Timeline—with automatic visible-channel zeroing while preserving **850 nm IR** tracking (`Ch 2` / `Ch 10`), plus `GPO6–8` RGB actions on **MWP Z2 / Z2S**.
- **Sequence Preview (Planar Light & Assay Simulator)**: Preview any of the 8 stimulus protocols (acclimation + assay) in real time in the standalone **Sequence Preview** card via a flat **Chamber · side view** (`TOP` / `BOT` wavelength bars, directional light washes, `IR 850nm ON (Ch 2/10)` badge, thermostat `°C`, and stepper vibration tap status) paired with a **Plate · top view** SVG of blended multi-well illumination—complete with **Play / Pause**, `0s` reset, `1x` / `5x` / `20x` / `60x` playback speeds, synced Multi-Track Timeline playhead & ruler scrubbing, and live `X_LED_DRIVE` PWM / `GPO` / `THERMOSTAT` channel readouts.
- **Curated Organism Presets**: Instant tracking and temperature defaults for *Daphnia magna*, *Drosophila* (Adult), *C. elegans*, *Planaria*, and *Zebrafish Larvae*, plus full manual customization.
- **Composable CSV Metrics & Video Modes**: Combine centroid distance (`DIST_*`), pixel motility (`MSD_*`), 50/50 inner/outer zone metrics (`ZD_*`, `ZC_*`, `ZT_*`), and optional per-frame raw millimeter coordinates (`_XY` CSV), alongside timelapse (`1 fps`, `0.2 fps`) or `30 fps` video, live track traces, and end-of-assay heatmaps.
- **Zantiks-Safe Naming**: Automatically extracts researcher surnames and sanitizes study tags into space-free ASCII identifiers accepted by the Zantiks Control Console compiler.
- **Save, Share & Reopen Experiments**: Every choice auto-saves in your browser. **Save as file** downloads the whole design as `*_experiment.json`; **Open…** loads that file — or a scripts `.zip` downloaded from the app, which now includes `experiment.json` — to restore it exactly. Plate calibration offsets always stay with your own unit.
- **Pre-flight Checks**: The Export page lists warnings and notes before you download (heater range, short pulses vs. time bin, Z3-only features on Z2 units, UV LEDs, very large video / XY files, factory plate offsets, and more), each with a button that jumps to the page where it can be fixed.

---

## Repository Structure

```text
Zanscript-Builder/
├── index.html                      # Redirect entry point for GitHub Pages
├── zantiks_script_generator.html   # The app: page markup; loads css/ and js/
├── css/                            # Styles, one file per area (base, components, stimulus, data, export, modal)
├── js/                             # App code as plain scripts, loaded in order:
│   ├── catalogs.js                 #   organisms, plates, LEDs, protocols
│   ├── state.js, helpers.js        #   app state, plate-config store, naming & formatting helpers
│   ├── read-config.js              #   turns the form into one config object
│   ├── generators.js               #   the .zs generators for Steps 1-4
│   ├── sampler.js, simulator.js    #   sequence preview (also contains refreshAll)
│   ├── stimulus-editor.js          #   protocol forms and the multi-track timeline editor
│   ├── timeline.js, ui-setup.js    #   timeline bar, organism / plate / modal rendering
│   ├── export-utils.js, events.js  #   code highlighting, ZIP writer, event bindings
│   ├── wizard.js                   #   step-by-step navigation and Run Summary
│   ├── experiment-io.js            #   save / open / auto-save experiments
│   ├── preflight.js                #   Export-page checks
│   └── main.js                     #   start-up (must load last)
├── zantiks_plate_config.js         # External plate geometry calibration profile (mm)
├── tests/                          # Automated tests: scenarios (experiment files) + golden script output
├── package.json                    # Test tooling only (the app needs no install or build)
├── .github/workflows/tests.yml     # Runs the tests on every push and pull request
├── assets/                         # Walkthrough GIFs for documentation
├── LICENSE                         # GNU AGPLv3 License
└── README.md                       # Documentation & hardware verification matrix
```

> **Note:** When running locally, keep `css/`, `js/` and `zantiks_plate_config.js` next to `zantiks_script_generator.html` (just clone or download the whole folder). Everything loads over `file://` with no server, build step or install.

---

## Quick Start

1. **Use online or run locally**:
   - **Online**: Open [https://tigerqu.github.io/Zanscript-Builder/](https://tigerqu.github.io/Zanscript-Builder/) in any modern browser, **or**
   - **Offline / Local**: Clone this repository and double-click `zantiks_script_generator.html`:
     ```bash
     git clone https://github.com/TigerQu/Zanscript-Builder.git
     ```
2. **Walk through the six pages** with **Next** / **Back** (or click any step in the top bar to jump straight to it):
   1. **Study** – Researcher name & study tag (optional; appends ASCII-safe tags to generated filenames and folders), MWP hardware revision (`MWP Z3` or `MWP Z2 / Z2S`), **Stimulus Light Wavelength** (`White`, `Blue`, `Green`, `Red`, `UV`), **Z3 Light Brightness (%)**, and **Z3 LED Position / Mount** (`Overhead Only (Top Ch 0-5)`, `Underneath Only (Bottom Ch 8-13)`, or `Both Overhead + Underneath`).
   2. **Organism** – Pick an organism preset, then fine-tune `TARGET_SIZE`, thresholds, `AUTOREF_TIMEOUT` and thermostat settings.
   3. **Plate** – Select the plate format (and adjust millimeter offsets if needed).
   4. **Stimulus** – Select one of the 7 standard protocols and configure phase durations/pulses, or open the **Advanced** section to arrange independent Overhead (`TOP`) and `Bottom LEDs (Ch 8-13)` (`BOT`) + `Temp °C` clips in the **Multi-Track Timeline**, and scrub or play through the entire assay in the **Sequence Preview** card (**Chamber · side view** & **Plate · top view**, `1x`–`60x` speed, synced playhead, and live `X_LED_DRIVE` PWM / `THERMOSTAT` readout).
   5. **Data & Video** – Choose CSV metrics, recording frame rate and overlays.
   6. **Export** – Review and download the generated scripts.
   - The **Run Summary** sidebar shows every choice, the total runtime and CSV size at all times; click a row to jump back and edit it.
3. **Export your scripts** on the **Export** page:
   - Click **Download All 4 Scripts (.zip)** (also available in the top bar on every page) to get the complete experiment folder and `README_STEPS.txt`, **or**
   - Switch between tabs (**Step 1** – **Step 4**) to **Copy Script** / **Download `.zs`** individually.
   - *Tip:* Click the filename badge above the code preview to copy the `.zs`-stripped service name directly for pasting into Zantiks' **Add Service** dialog.
   - Read the **Pre-flight Checks** at the top of the page first.
4. **Keep or share the design**: it auto-saves in this browser. Use **Save as file** in the Run Summary to share it, and **Open…** to load an `experiment.json` or a downloaded scripts `.zip`.

---

## Hardware Verification Status

All generated script permutations pass automated static checks (block closure, ASCII identifier sanitization, line-length bounds, and `LOGCREATE`/`LOGAPPEND` CSV column-count parity). The table below tracks **physical on-unit testing** across experimental scenarios as validation progresses.

**Status Legend:**
- `✅ Verified` — Compiled (`Build`), executed, and confirmed CSV/asset output on physical Zantiks MWP hardware
- `⏳ Pending` — Static syntax & official reference check passed; awaiting physical on-unit test run
- `⚠️ Partial / Issue` — Known firmware or hardware revision caveat (see notes)

| Scenario / Subsystem | Target Hardware | Configuration / Scope | Static Check | On-Unit Test | Notes / Last Verified |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Step 1: Camera Calibration** | MWP Z3 / Z2 | `Calibration(0)` with black 96-well plate | ✅ Passed | ⏳ Pending | Standard Zantiks scale calibration |
| **Step 2: Round-Well Asset Builder** | MWP Z3 / Z2 | `6`, `12`, `24`, `24 Costar`, `48`, `96`-well & `90 mm` Petri (`DISC`) | ✅ Passed | ⏳ Pending | Saves `a*.bmp` & 50/50 `dz*.bmp` to `Assets` |
| **Step 2: Square-Well Asset Builder** | MWP Z3 / Z2 | `24-Well Square`, `96-Well Square` (`SQUARE`) | ✅ Passed | ⏳ Pending | Saves `a24sq.bmp` / `a96_sq.bmp` & dual zones |
| **Step 3: Tracking Parameter Sweep** | MWP Z3 | `TARGET_SIZE` & `DETECTOR_THRESHOLD` sweep video + CSV | ✅ Passed | ⏳ Pending | Optional 1–2 min pre-assay check |
| **Baseline Tracking (`baseline`)** | MWP Z3 | Constant Light (`X_LED_DRIVE` Overhead / Underneath / Both) or IR Dark · `DIST` + `MSD` | ✅ Passed | ⏳ Pending | Continuous time-bin logging (`Ch 2/10` IR untouched) |
| **Light / Dark Cycles (`ld_transitions`)** | MWP Z3 | Alternating Light ↔ Dark cycles · `DIST` + `MSD` + `ZONES` | ✅ Passed | ⏳ Pending | Supports `Overhead Only` (`Ch 0,1,3,4,5`), `Underneath Only` (`Ch 8,9,11,12,13`), or `Both` |
| **Light-Off Startle (`light_off_startle`)** | MWP Z3 | Sub-bin (`< TIME_BIN`) & multi-bin dark pulses + ITI | ✅ Passed | ⏳ Pending | Pulse + recovery trial loop |
| **Light-On Flash (`light_on_pulse`)** | MWP Z3 | Brief bright flashes from dark baseline + ITI | ✅ Passed | ⏳ Pending | Pulse + recovery trial loop |
| **Vibration Startle (`vibration_startle`)** | MWP Z3 | Stepper motor taps (`U0`–`U3` via `ZCOMMAND`) + ITI | ✅ Passed | ⏳ Pending | Requires MWP Z3 stepper vibration stand |
| **Long-Term / Circadian (`circadian`)** | MWP Z3 | Multi-day `L:D` schedule + hourly `AUTOREFERENCE()` | ✅ Passed | ⏳ Pending | Use `0.2 fps` timelapse or `No Video` |
| **Overhead & Underneath LEDs (`ledMount`)** | MWP Z3 | `OVERHEAD` (`Ch 0,1,3,4,5`), `UNDERNEATH` (`Ch 8,9,11,12,13`), `BOTH` across 5 wavelengths | ✅ Passed | ✅ Verified | Top/Bot White (`4/12`), UV (`0/8`), & RGB verified on MWP Z3; includes `Z3 RGB Channel Map` toggle (`DOCS` `1:B,3:G,5:R` vs `GRB_SHIFT` `1:G,3:R,5:B` hardware batch) |
| **Multi-Track Timeline (`multi_phase`)** | MWP Z3 | Independent Overhead (`TOP`) + Underneath (`BOT`) `White / Blue / Green / Red / UV` tracks + `Temp °C` | ✅ Passed | ✅ Verified | Verified on physical MWP Z3 (`X_LED_DRIVE` + `LIGHT13–16` gates; `Ch 2/10` IR untouched) |
| **Temperature Step / Ramp (`temp_ramp`)** | MWP Z3 / Z2 | Stepped `SET(THERMOSTAT, ...)` plateaus + baseline restore | ✅ Passed | ⏳ Pending | Standard heater regulates ambient to +10 °C |
| **Dual-Stream Raw XY (`LOG_STREAM 1`)** | MWP Z3 / Z2 | Per-frame millimeter `X/Y` CSV alongside summary CSV | ✅ Passed | ⏳ Pending | `SET(LOG_PERFRAME,ON)` secondary stream |
| **Legacy GPO Lighting (`GPO6–8`)** | MWP Z2 / Z2S | Any stimulus protocol in `MWP Z2 / Z2S` hardware mode | ✅ Passed | ⏳ Pending | Community testing welcome |

> *Tested a scenario on your MWP unit? Feel free to open an Issue or Pull Request with your hardware revision (`MWP Z3` or `MWP Z2 / Z2S`), plate type, and results to update this table.*

---

## Generated 4-Step Zantiks Workflow

Each configuration produces four coordinated Zanscript files designed to be executed in order on the Zantiks Control Console:

| Step | Script Filename Pattern | Physical Setup | Purpose |
| :--- | :--- | :--- | :--- |
| **Step 1** | `01_[lastname_]calibration.zs` | Black 96-well Zantiks calibration plate | Runs `Calibration(0)` once to establish camera millimeter scale. Skip if the unit is already calibrated and undisturbed. |
| **Step 2** | `02_[lastname_]assets_<plate>.zs` | **Empty** experimental plate | Draws well arenas and 50/50 outer/inner zones onto Live View and saves `<arenaBmp>.bmp` and `<zoneBmp>.bmp` into the unit's `Assets` folder. |
| **Step 3** | `03_[lastname_]track_check_<plate>.zs` | Experimental plate **with organisms** | *(Optional)* 1–2 min pre-check sweeping `TARGET_SIZE` and `DETECTOR_THRESHOLD` (2 to 10) on video so you can verify clean crosshair lock without background flicker. |
| **Step 4** | `04_<prefix>_<stimulus>_<plate>.zs` | Experimental plate **with organisms** | Main assay script: loads `.bmp` assets, runs acclimation + `AUTOREFERENCE()`, executes the stimulus schedule, records video/overlays, and exports CSV data. |

---

## Supported Plate & Dish Formats

All geometric parameters are specified in millimeters (`mm`) and can be customized per MWP unit:

| Plate ID | Format | Grid (Wells) | Shape | Arena Asset | Dual-Zone Asset | Default Radius / Side (`r`) | Default Inner Zone (`rDz`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `6well` | 6-Well | `2 x 3` (`A1–B3`) | Round (`DISC`) | `a6.bmp` | `dz6.bmp` | `17.72 mm` | `12.73 mm` |
| `12well` | 12-Well | `3 x 4` (`A1–C4`) | Round (`DISC`) | `a12.bmp` | `dz12.bmp` | `11.40 mm` | `8.50 mm` |
| `24well` | 24-Well (Standard) | `4 x 6` (`A1–D6`) | Round (`DISC`) | `a24.bmp` | `dz24.bmp` | `8.13 mm` | `5.60 mm` |
| `24costar` | 24-Well Costar | `4 x 6` (`A1–D6`) | Round (`DISC`) | `a24c.bmp` | `dz24c.bmp` | `8.13 mm` | `5.65 mm` |
| `24square` | 24-Well Square | `4 x 6` (`A1–D6`) | Square (`SQUARE`) | `a24sq.bmp` | `dz24sq.bmp` | `16.50 mm` (side) | `12.00 mm` (side) |
| `48well` | 48-Well | `6 x 8` (`A1–F8`) | Round (`DISC`) | `a48.bmp` | `dz48.bmp` | `5.19 mm` | `3.45 mm` |
| `96well` | 96-Well (Standard) | `8 x 12` (`A1–H12`) | Round (`DISC`) | `a96.bmp` | `dz96.bmp` | `3.50 mm` | `2.47 mm` |
| `96square` | 96-Well Square | `8 x 12` (`A1–H12`) | Square (`SQUARE`) | `a96_sq.bmp` | `dz96_sq.bmp` | `7.50 mm` (side) | `4.50 mm` (side) |
| `petri` | Petri Dish (90 mm) | `1 x 1` (`A1`) | Round (`DISC`) | `aPD.bmp` | `dzPD.bmp` | `44.00 mm` | `31.80 mm` |

---

## Organism Presets

Selecting an organism chip populates recommended tracking and environmental parameters (any edit automatically switches the mode to **Custom**):

| Preset | `TARGET_SIZE` | `DETECTOR_THRESHOLD` | `MSD_THRESHOLD` | Temperature | Thermostat | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Daphnia magna** | `4 mm` | `8` | `6` | `22 °C` | Enabled | Enables `MSD_MODE` by default |
| **Drosophila (Adult)** | `5 mm` | `3` | `15` | `23 °C` | Enabled | Centroid tracking |
| **C. elegans** | `1 mm` | `5` | `5` | `20 °C` | Enabled | Enables `MSD_MODE` for thrashing/motility |
| **Planaria** | `3 mm` | `6` | `6` | `21 °C` | Disabled | Ambient temperature by default |
| **Zebrafish Larvae** | `2 mm` | `6` | `6` | `28 °C` | Enabled | Standard larval zebrafish assay defaults |
| **Custom** | User-defined | User-defined | User-defined | User-defined | Configurable | Full manual control on the Organism page |

---

## Stimulus Protocols

Single-channel illumination protocols (`baseline`, `ld_transitions`, `light_off_startle`, `light_on_pulse`, `vibration_startle`, `circadian`) honor the Study page's **Stimulus Light Wavelength** (`White`, `Blue`, `Green`, `Red`, `UV`) and **Z3 LED Position / Mount** (`Overhead Only (Top Ch 0-5)`, `Underneath Only (Bottom Ch 8-13)`, or `Both Overhead + Underneath`), leaving **850 nm IR** (`Ch 2` / `Ch 10`) untouched. Every protocol can be previewed across its full acclimation + assay timeline in the Stimulus page's **Sequence Preview** card (**Chamber · side view** & **Plate · top view**, **Play / Pause**, `0s` reset, `1x` / `5x` / `20x` / `60x` speed, time scrubber, and live `X_LED_DRIVE` PWM / `GPO` / `THERMOSTAT` channel readout).

| Protocol | ID | Schedule & Configurable Parameters |
| :--- | :--- | :--- |
| **None (Baseline)** | `baseline` | Acclimation (`acclimSec`) → `AUTOREFERENCE()` → Constant **Light** (selected wavelength & `Overhead` / `Underneath` / `Both` mount) or **Dark (IR-only)** recording (`durationSec`, `timeBinSec`). |
| **Light / Dark Cycles** | `ld_transitions` | Acclimation → `AUTOREFERENCE()` → Alternating **Light ↔ Dark** phases (`ldStart`, `ldCycles`, `ldPhaseSec`, `timeBinSec`). |
| **Light-Off Startle** | `light_off_startle` | Light acclimation → Optional pre-pulse baseline (`preBaselineSec`) → `numPulses` brief dark pulses (`pulseDurSec`, supports sub-bin durations `< TIME_BIN`) separated by light recovery intervals (`itiSec`). |
| **Light-On Flash** | `light_on_pulse` | Dark acclimation → Optional dark baseline (`preBaselineSec`) → `numPulses` bright light flashes (`pulseDurSec`, supports sub-bin durations) separated by dark intervals (`itiSec`). |
| **Vibration Startle** | `vibration_startle` | Light or dark acclimation (`vibAmbient`) → Optional baseline → `numPulses` stepper-motor taps via `ZCOMMAND` (`U0` Full, `U1` Half, `U2` Quarter, `U3` Eighth step) with ITI recovery (`itiSec`). |
| **Long-Term Cycle** | `circadian` | Multi-hour / multi-day `L:D` cycles (`lightHours`, `darkHours`, `numDays`, `circBinSec`) with automatic mid-hour `AUTOREFERENCE()` re-referencing to prevent tracking drift over multi-day runs. |
| **Multi-Track Timeline** | `multi_phase` | Interactive 11-track AE/Premiere-style NLE editor with independent **Overhead (`TOP`)** (`White` Top Ch 4, `Blue 470` Top Ch 1, `Green 530` Top Ch 3, `Red 625` Top Ch 5, `UV 365` Top Ch 0) and toggleable **`Bottom LEDs (Ch 8-13)` (`BOT`)** (`White` Bot Ch 12, `Blue 470` Bot Ch 9, `Green 530` Bot Ch 11, `Red 625` Bot Ch 13, `UV 365` Bot Ch 8) plus **`Temp °C`** (`Therm`), a compact **`Load Preset...`** menu (`Preset: White BG + Opto`, `Preset: Bot White + Top Opto`, `Preset: RGB Overlap`, `Preset: Seq Sweep`), `Clear`, and synced playhead/ruler scrubbing (`mpTimelineSec`, `mpCycles`, `timeBinSec`). Overlapping clips compile via sweep-line discretization into contiguous Zanscript slices (`S1..SK`) with flicker-free independent top/bottom PWM transitions and baseline temperature restore. |
| **Temperature Step / Ramp** | `temp_ramp` | Acclimation at `rampStartTemp` → Stepped thermal plateaus from `rampStartTemp` to `rampEndTemp` in `rampStepTemp` increments (`rampHoldSec` per step), automatically restoring `rampStartTemp` when finished. |

---

## Recorded Data, Video & Overlays

### CSV Outputs
1. **Primary Summary CSV** (one row per `TIME_BIN`):
   - **Metadata Columns**:
     - Baseline: `RUNTIME | UNIT_ID | TEMP_C | PHASE | TIME_BIN`
     - Trial/Cycle Assays: `RUNTIME | UNIT_ID | TEMP_C | PHASE | TRIAL | TIME_BIN`
     - Long-Term / Circadian: `RUNTIME | UNIT_ID | TEMP_C | PHASE | DAY | HOUR | TIME_BIN`
   - **Selectable Metric Columns** (appended per well `A1`…):
     - **Arena Distance (`ARENA_DISTANCES`)**: `DIST_A1`, `DIST_A2`, … (centroid distance traveled in `mm` per time bin).
     - **Pixel Activity / Motility (`MSD_MODE` / `ARENA_ACTIVITY`)**: `MSD_A1`, `MSD_A2`, … (mean pixel change per well; ideal for in-place twitching or thrashing).
     - **Inner / Outer Zones (`ZONE_DISTANCES`, `ZONE_COUNTERS`, `ZONE_TIMERS`)**: `ZD_<well>_Z1/Z2`, `ZC_<well>_Z1/Z2`, `ZT_<well>_Z1/Z2` (`Z1` = outer wall ring, `Z2` = inner center zone).
2. **Optional Raw XY Stream CSV (`<run_slug>_XY`)**:
   - Enabled via **Raw XY Coordinates (`LOG_STREAM 1`)** (`SET(LOG_PERFRAME,ON)`).
   - Writes frame-by-frame millimeter coordinates (`RUNTIME | X_A1 | Y_A1 | ...`) to a separate CSV file.

### Video & Visual Overlays
- **Video Modes**: `1 fps` timelapse (`VIDEOSKIP(29)`, recommended), `0.2 fps` long-run timelapse (`VIDEOSKIP(149)`), full `30 fps` video (`VIDEOSKIP(0)`), or disabled.
- **Overlays**: Live trajectory traces (`X_DRAWTRACKS` / `X_TRACKTIME`) and end-of-experiment spatial heatmap generation (`COLOURMAP` / `MAKEMAP`).

---

## Plate Calibration & `zantiks_plate_config.js`

Different MWP units or plate manufacturers can exhibit slight positional shifts relative to factory coordinates. Zanscript-Builder provides two-tier calibration persistence:

1. **Automatic Browser Storage**: Any change made in the Plate page's inline geometry editor or the **Plate Config** modal is immediately saved to `localStorage` (`zantiks_mwp_plate_config_v1`). Clicking **Reset Assay** resets experimental parameters without erasing your calibrated plate offsets.
2. **Shared Folder Config (`zantiks_plate_config.js`)**:
   - Open **Plate Config** in the top bar and click **Save `zantiks_plate_config.js`** to write your unit's calibration directly back to disk (uses the File System Access API where supported, or downloads the updated `.js` file).
   - On startup, the app compares `updatedAt` timestamps between `zantiks_plate_config.js` and `localStorage`, automatically applying whichever calibration profile is newer.
   - You can also import/export `.json` or `.js` calibration profiles via **Load Config File** and **Export `.json`**.

### Geometry Parameters (all in `mm`)
- `xOffset`, `yOffset`: Center coordinates of well `A1` (top-left well).
- `colStep`, `rowStep`: Center-to-center horizontal and vertical spacing between adjacent wells.
- `r`: Well radius for round wells (`DISC`) or full side length for square wells (`SQUARE`).
- `rDz`: Inner center zone (`Z2`) radius or side length (`Auto 50%` sets `rDz = r * √0.5` so inner and outer zones have equal area).

---

## Development & Tests

The app is plain HTML, CSS and JavaScript with no build step: edit the files in `css/` and `js/` and reload the page.

Automated tests make sure changes don't silently alter the generated scripts. Each file in `tests/scenarios/` is an experiment saved by the app (14 of them, covering every protocol, both hardware revisions and several plates); the tests load each one and compare the four `.zs` scripts and `README_STEPS.txt` byte-for-byte with `tests/golden/`. They also check that every page loads without errors, that open → save and `.zip` round trips are lossless, and that auto-save survives a reload.

```bash
npm install                          # once: installs Playwright (test tool only)
npx playwright install chromium      # once: browser used by the tests
npm test                             # run all tests
npm run test:update                  # after an INTENTIONAL change to the scripts: rewrite tests/golden/
```

The same tests run automatically on GitHub for every push to `main` and every pull request (see the **Actions** tab). To add a scenario, set up the experiment in the app, click **Save as file**, put the `.json` in `tests/scenarios/`, and run `npm run test:update` to create its golden file.

---

## Zantiks Control Console Checklist

- **Save Before Build**: Always click **Save** before clicking **Build** in the Zantiks web script editor.
- **Asset Prerequisite**: Run the **Step 2 (`02_*_assets_*.zs`)** script at least once for each plate type so the required `.bmp` arena/zone masks exist in the unit's `Assets` directory before running Step 3 or Step 4.
- **Safe Filenames**: Never rename `.zs` scripts on the unit with spaces, parentheses, or non-ASCII characters.
- **Safe Shutdown**: Always shut down the MWP system from the **Control Console** webpage and wait for completion before switching off physical power.

---

## Disclaimer & Hardware Safety

1. **Unofficial & Non-Affiliated**: *Zanscript-Builder* is an independent community-developed tool created to assist researchers and educators working with Zantiks equipment. It is **not** an official product of, nor is it affiliated with, endorsed by, or supported by **Zantiks Ltd.** *Zantiks* and *Zanscript* are trademarks of Zantiks Ltd.
2. **No Warranty & Limitation of Liability**: This software and all `.zs` scripts generated by it are provided **"AS IS"**, without warranty of any kind, express or implied, including but not limited to fitness for a particular purpose or non-infringement. In no event shall the authors or contributors be held liable for any direct, indirect, incidental, or consequential damages—including hardware or peripheral damage, corrupted storage, lost experimental data, or unintended effects on model organisms—arising from the use or misuse of generated scripts.
3. **Mandatory Operator Precautions**:
   - **Thermostat & Cooling Fan**: If `SET(THERMOSTAT, ...)` is enabled, verify that the unit's cooling/circulation fan is connected and spinning freely before starting a run. Disable **Enable Thermostat** if your unit is not equipped with temperature control hardware.
   - **Vibration Motor Connections**: Never plug or unplug vibration motor or accessory cables while the Zantiks unit is powered on. Power down completely before changing hardware attachments.
   - **Dry-Run Verification**: Always verify arena alignment (`02_*_assets_*.zs`) and test new stimulus schedules briefly on an **empty plate** while monitoring Live View before introducing live organisms or starting unattended multi-hour assays.
   - **Storage & Power-Off**: Use `1 fps` or `0.2 fps` timelapse (rather than full `30 fps` video) for long experiments to avoid filling internal storage, and always initiate **Shut Down** from the web Control Console before turning off the rear power switch.
