# 04. Burned-in Pixel Redaction & Technical Limitations

> **Author**: **Nick Hermans** (Medical Imaging Engineer, UZ Leuven — Information Technology and Data Department, PACS, eHealth HUB and Telematics team) — [`nick.hermans@uzleuven.be`](mailto:nick.hermans@uzleuven.be)  
> **Package**: `@ohif/extension-download-manager` (OHIF Viewer v3 Platform)

---

This document details the visual text redaction pipeline (`src/pixel-redactor.js`, `src/ocr-engine.js`, `src/phi-classifier.js`) and presents an engineering breakdown of its text recognition algorithms, WebAssembly DICOM codecs, performance tuning, and operational boundaries.

---

## 1. Pipeline Overview & Trigger Conditions

Certain DICOM imaging modalities — particularly Ultrasound (US), Secondary Capture (SC), Scanned Film, and Fluoroscopy — frequently burn patient demographic text, acquisition dates, or hospital names directly into the image pixel matrix (`PixelData` tag `7FE0,0010`).

The Download Manager includes an automated client-side pixel redaction pipeline designed to detect and overwrite text annotations using an RSNA-inspired approach combining Micro-OCR, Stroke-Width Transform (SWT) edge topology filtering, and WebAssembly DICOM codecs.

![Figure 4.1: Pixel Redaction Trigger and Execution Flow](placeholder_pixel_redaction_flow.png)  
*Figure 4.1: Decision tree for pixel redaction triggering, frame sampling, OCR detection, and stored-pixel black-out.*

### Trigger Conditions
Pixel redaction executes when:
1. **`enablePixelRedaction`** is enabled (`true`).
2. **AND** either:
   - The DICOM header contains `BurnedInAnnotation (0028,0301)` set to `"YES"`, `"Y"`, or `"1"`.
   - **OR** the user selects **Force visual text redaction on all images** (`forceIgnoreBurnedInAnnotation: true`), overriding the header tag.

---

## 2. Redaction Pipeline Mechanics

### Step 1: Multi-Frame Scanning & Sampling
Processing 3D volumes or cine loops:
- **Aggressive Mode (`"aggressive"`)**: Sequentially evaluates every frame (`0` through `N-1`) to ensure no intermediate frame escapes redaction.
- **Sampling Mode**: Evaluates key frames (first frame, middle frame, last frame, and every 20th frame) for rapid previewing.
- **Prompt Mode (`"ask"`)**: Prompts the user when a multi-frame DICOM instance with burned-in annotations is detected.

### Step 2: Optical Character Recognition (OCR Engine & Micro-OCR Fallback)
The engine calls `runOcrOnFrame()` to extract candidate text bounding boxes:
* **Primary Neural Engine (PaddleOCR / ONNX Runtime Web)**: When ONNX WebAssembly binaries (`/assets/onnxruntime/`) and PaddleOCR models are present in the host application, the engine runs neural text detection (`PP-OCRv6_tiny_det`) and character recognition (`PP-OCRv6_tiny_rec`).
* **Embedded Micro-OCR Engine (`scanImageDataForText`)**: When ONNX binaries are omitted, the browser executes a pure JavaScript micro-OCR engine (`src/ocr-engine.js`) that:
  1. Segments candidate text regions into character glyph patches.
  2. Runs **Stroke-Width Transform (SWT)** and edge topology filtering to eliminate false positive detections on sharp anatomical boundaries (bone contours, diaphragmatic edges, surgical clips, ECG leads).
  3. Resamples glyph patches against 7x7 binary character font templates (A-Z, 0-9, and symbols) to perform optical character recognition.
  4. Applies canvas downscaling (`ocrMaxResolution: 1024`) and execution timeout guards for low-power mobile or laptop CPUs.

### Step 3: RSNA PHI Classification & Overlay Disambiguation
The `src/phi-classifier.js` module cross-references recognized text strings against metadata extracted from the DICOM header (Patient Name, Patient ID, Accession Number, Birth Date):
- **Diagnostic Measurement Preservation**: Technical acquisition parameters (e.g. `"5.2 cm"`, `"120 KVP"`, `"3.5 MHz"`, `"60 FPS"`, `"MI 1.2"`, `"GAIN 0dB"`) and anatomical orientational labels (e.g. `"LIVER"`, `"AP"`, `"RT"`, `"LT"`) are matched against medical regexes and whitelists, assigning `phiScore: 0` (`decision: "keep"`).
- **PHI Classification & Redaction**: Text matching DICOM metadata (with fuzzy Levenshtein distance), dates (`YYYY-MM-DD`, `MM/DD/YYYY`), phone numbers, emails, MRNs, or PHI labels (`PATIENT`, `NAME`, `DOB`, `PHYSICIAN`) are assigned `phiScore >= 50` (`decision: "redact"`).
- **Label Adjacency**: Text immediately adjacent to a PHI label keyword is classified for redaction unless explicitly whitelisted as a safe measurement parameter.

### Step 4: Stored Pixel Redaction & WebAssembly Transcoding
For bounding boxes classified as PHI:
1. A pixel margin (default: `4px`) expands the bounding box.
2. The raw `TypedArray` pixel buffer underlying `PixelData (7FE0,0010)` is overwritten directly in memory.
3. Pixel values inside the rectangle are replaced with `fillVal` (0 for MONOCHROME2, max intensity for MONOCHROME1, or `PixelPaddingValue` if present).
4. Optional borders (`none`, `red`, `white`, `black`, `double`) are drawn based on configuration settings.
5. **Tag Update**: `BurnedInAnnotation (0028,0301)` is updated to `"NO"`.
6. **Transcoding**: Encapsulated compressed datasets (JPEG 2000, JPEG-LS, HTJ2K, RLE Lossless, JPEG Baseline/Lossless) are decoded, redacted, and re-encoded using WebAssembly DICOM codecs (`src/dicom-codecs.js`).

---

## 3. Performance Tuning & CPU Controls

To maintain responsive UI performance on lower-power devices:
- **`ocrPerformanceMode`**: 
  - `"balanced"` (Default): Micro-OCR character recognition with standard canvas resolution.
  - `"fast"`: Downscales high-resolution DICOM frames (>1024px) before scanning to optimize CPU usage.
  - `"thorough"`: Full-resolution frame scanning.
- **`ocrMaxResolution`**: Maximum canvas dimension (default `1024px`) for downscaling.
- **`requireOcrModelConfirmation`**: Prompts the user before running fallback micro-OCR when WASM neural models are unavailable.

---

## 4. Technical Boundaries & Limitation of Liability

* **Quality Audit**: Automated OCR text redaction provides significant risk reduction for ultrasound and secondary capture series. However, non-standard fonts, low contrast text overlays, or obscured annotations may require manual visual inspection.
* **Header Tag Dependency**: Unless `forceIgnoreBurnedInAnnotation` is enabled, the pipeline relies on correct `BurnedInAnnotation` header metadata to trigger scanning.
* **Encapsulated Syntaxes**: Transcoding requires matching WebAssembly codecs. If an unsupported compressed syntax is encountered, the system logs a codec error and quarantines the instance.

> **LIMITATION OF LIABILITY**: AS STIPULATED IN THE MIT LICENSE, THIS SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. IN NO EVENT SHALL **NICK HERMANS**, **UZ LEUVEN** (UNIVERSITY HOSPITALS LEUVEN), OR ANY CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES, DATA LOSS, PRIVACY BREACH, OR OTHER LIABILITY ARISING FROM THE USE OR RELIANCE UPON THIS OPTICAL PIXEL REDACTION MODULE.

---

## Next Steps

- Proceed to **[05. Storage Writers, Directory Layout & Troubleshooting](./05-storage-directory-layout-troubleshooting.md)** to review folder layout specifications and storage strategies.

