# Zanscript-Builder

**Zanscript-Builder** (*Zantiks MWP Script Builder*) is a standalone, zero-dependency browser application for designing behavioral tracking experiments on **Zantiks MWP** systems (**MWP Z3** and **MWP Z2 / Z2S**). It generates ready-to-compile **Zanscript (`.zs`)** files for camera calibration, multi-well plate arena/zone asset creation, tracking parameter verification, and full stimulus-driven assays.

---

## Key Features

- **Zero-Install & Offline Ready**: Runs directly in any modern browser over `file://` with no local server, build step, or internet connection required—ideal for dedicated lab computers connected to a Zantiks unit.
- **Complete 4-Step Zantiks Workflow**: Generates standalone `.zs` scripts for every stage of an MWP experiment, viewable individually with syntax highlighting or downloadable together as a `.zip` bundle (including a run sheet `README_STEPS.txt`) via an embedded pure-JavaScript ZIP builder.
- **9 Plate & Dish Formats with True-Scale Preview**: Supports 6-, 12-, 24- (standard, Costar, and square), 48-, and 96-well (round and square) plates plus 90 mm Petri dishes, complete with a live millimeter-accurate SVG layout preview.
- **Visual Plate Calibration & Shared Config**: Fine-tune `X_OFFSET`, `Y_OFFSET`, `COL_STEP`, `ROW_STEP`, `RADIUS` / `SIDE LENGTH`, and `INNER_ZONE` inline or across all formats in the **Plate Config** modal, with one-click **Auto 50% Inner Zone** calculation ($r_{\text{inner}} = r / \sqrt{2}$) for thigmotaxis assays.
- **6 Built-in Stimulus Protocols**: Configure constant baseline tracking, alternating Light/Dark cycles, Light-Off startle pulses, Light-On flashes, stepper-motor Vibration startle taps (`U0`–`U3`), or multi-day Circadian `L:D` cycles with interactive timeline and runtime previews.
- **Curated Organism Presets**: Instant tracking and temperature defaults for *Daphnia magna*, *Drosophila* (Adult), *C. elegans*, *Planaria*, and *Zebrafish Larvae*, plus full manual customization.
- **Composable CSV Metrics & Video Modes**: Combine centroid distance (`DIST_*`), pixel motility (`MSD_*`), 50/50 inner/outer zone metrics (`ZD_*`, `ZC_*`, `ZT_*`), and optional per-frame raw millimeter coordinates (`_XY` CSV), alongside timelapse (`1 fps`, `0.2 fps`) or `30 fps` video, live track traces, and end-of-assay heatmaps.
- **MWP Z3 & Legacy Z2 Support**: Generates native 12-bit `X_LED_DRIVE` commands (overhead Ch 4 and optional underneath LED Ch 12) for **MWP Z3** units or `GPO6–8` lighting actions for **MWP Z2 / Z2S** units.
- **Zantiks-Safe Naming**: Automatically extracts researcher surnames and sanitizes study tags into space-free ASCII identifiers accepted by the Zantiks Control Console compiler.

---

## Repository Structure

```text
Zanscript-Builder/
├── zantiks_script_generator.html   # Standalone web app (UI, previews, .zs generator, ZIP bundler)
├── zantiks_plate_config.js         # External plate geometry calibration profile (mm)
└── README.md                       # Documentation
```

> **Note:** Keep `zantiks_plate_config.js` in the same folder as `zantiks_script_generator.html` so custom plate calibration profiles load automatically over `file://` without browser CORS restrictions.

---

## Quick Start

1. **Download or clone this repository**:
   ```bash
   git clone https://github.com/TigerQu/Zanscript-Builder.git
   ```
2. **Open the builder**: Double-click `zantiks_script_generator.html` to open it in any modern browser (Chrome, Edge, Safari, or Firefox).
3. **Configure your experiment** in the left panel:
   - Enter **Researcher & Study Tag** (optional; appends ASCII-safe tags to generated filenames and folders).
   - Pick an **Organism Preset** (or customize tracking thresholds and thermostat settings under **Advanced Tracking, Thermostat & Hardware**).
   - Select **Step 1: Plate Format** (and adjust millimeter offsets if needed).
   - Select **Step 2: Stimulus Protocol** and set phase durations, pulse counts, or inter-trial intervals (ITI).
   - Choose **Step 3: Recorded Data & Video** metrics and recording frame rate.
4. **Export your scripts** from the right panel:
   - Click **Download All 4 Scripts (.zip)** to get the complete experiment folder and `README_STEPS.txt`, **or**
   - Switch between tabs (**Step 1** – **Step 4**) to **Copy Script** / **Download `.zs`** individually.
   - *Tip:* Click the filename badge above the code preview to copy the `.zs`-stripped service name directly for pasting into Zantiks' **Add Service** dialog.

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
| **Custom** | User-defined | User-defined | User-defined | User-defined | Configurable | Full manual control in Advanced settings |

---

## Stimulus Protocols

| Protocol | ID | Schedule & Configurable Parameters |
| :--- | :--- | :--- |
| **None (Baseline)** | `baseline` | Acclimation (`acclimSec`) → `AUTOREFERENCE()` → Constant overhead **Light** or **Dark (IR-only)** recording (`durationSec`, `timeBinSec`). |
| **Light / Dark Cycles** | `ld_transitions` | Acclimation → `AUTOREFERENCE()` → Alternating **Light ↔ Dark** phases (`ldStart`, `ldCycles`, `ldPhaseSec`, `timeBinSec`). |
| **Light-Off Startle** | `light_off_startle` | Light acclimation → Optional pre-pulse baseline (`preBaselineSec`) → `numPulses` brief dark pulses (`pulseDurSec`, supports sub-bin durations `< TIME_BIN`) separated by light recovery intervals (`itiSec`). |
| **Light-On Flash** | `light_on_pulse` | Dark acclimation → Optional dark baseline (`preBaselineSec`) → `numPulses` bright light flashes (`pulseDurSec`, supports sub-bin durations) separated by dark intervals (`itiSec`). |
| **Vibration Startle** | `vibration_startle` | Light or dark acclimation (`vibAmbient`) → Optional baseline → `numPulses` stepper-motor taps via `ZCOMMAND` (`U0` Full, `U1` Half, `U2` Quarter, `U3` Eighth step) with ITI recovery (`itiSec`). |
| **Long-Term Cycle** | `circadian` | Multi-hour / multi-day `L:D` cycles (`lightHours`, `darkHours`, `numDays`, `circBinSec`) with automatic mid-hour `AUTOREFERENCE()` re-referencing to prevent tracking drift over multi-day runs. |

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

1. **Automatic Browser Storage**: Any change made in Step 1's inline geometry editor or the **Plate Config** modal is immediately saved to `localStorage` (`zantiks_mwp_plate_config_v1`). Clicking **Reset Assay** resets experimental parameters without erasing your calibrated plate offsets.
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

## Zantiks Control Console Checklist

- **Save Before Build**: Always click **Save** before clicking **Build** in the Zantiks web script editor.
- **Asset Prerequisite**: Run the **Step 2 (`02_*_assets_*.zs`)** script at least once for each plate type so the required `.bmp` arena/zone masks exist in the unit's `Assets` directory before running Step 3 or Step 4.
- **Safe Filenames**: Never rename `.zs` scripts on the unit with spaces, parentheses, or non-ASCII characters.
- **Safe Shutdown**: Always shut down the MWP system from the **Control Console** webpage and wait for completion before switching off physical power.
