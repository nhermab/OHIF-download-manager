# 04. Burned-in Pixel Redaction & Technical Limitations

> **Deployment status:** Client-side pixel processing is enabled where its supported
> format constraints are met. It does not prove Clean Pixel Data; unsupported or
> unverified processing fails closed and emits no Clean Pixel Data assertion.

This document provides a detailed technical explanation of the visual text redaction pipeline (`pixel-redactor.js`, `ocr-engine.js`, `phi-classifier.js`) and presents an **honest, scientific assessment of its performance, failure modes, and regulatory limitations**.

---

## 1. Pipeline Overview & Trigger Conditions

Certain DICOM imaging modalities — particularly Ultrasound (US), Secondary Capture (SC), Scanned Film, and Fluoroscopy — often have patient demographic text, acquisition dates, or hospital names permanently burned into the image pixel array (`PixelData` tag `7FE0,0010`).

The Download Manager includes an automated client-side pixel redaction pipeline designed to detect and overwrite these text regions using the **RSNA Anonymiser approach** combined with lightweight browser-friendly Micro-OCR models and low-end hardware fallback controls.

![Figure 4.1: Pixel Redaction Trigger and Execution Flow](placeholder_pixel_redaction_flow.png)  
*Figure 4.1: Step-by-step decision tree for pixel redaction triggering, frame sampling, OCR detection, and stored-pixel black-out.*

### Trigger Conditions
Pixel redaction executes if and only if:
1. **`enablePixelRedaction`** is set to `true` (Default).
2. **AND** either of the following conditions is met:
   - The DICOM header contains `BurnedInAnnotation (0028,0301)` set to `"YES"`, `"Y"`, or `"1"`.
   - **OR** the user enables **Force visual text redaction on all images** (`forceIgnoreBurnedInAnnotation: true`), overriding the header flag.

---

## 2. Redaction Pipeline Mechanics

### Step 1: Multi-Frame Scanning & Sampling
Processing full 3D volumes or cine loops frame-by-frame:
- **Aggressive Mode (Recommended)**: Sequentially scans all frames (`0` through `N-1`) to ensure no intermediate frames with burned-in annotations are skipped.
- **Sampling Mode**: For fast previewing, samples key frames (Frame 0, mid frame, last frame, and every 20th frame).
- **Prompt Mode (`"ask"`)**: Displays an interactive prompt when a multi-frame DICOM instance with burned-in annotations is detected.

### Step 2: Optical Character Recognition (OCR Engine & Micro-OCR Fallback)
The engine executes `runOcrOnFrame()` to identify bounding boxes and extract recognized text strings:
* **Primary Engine (PaddleOCR / ONNX Runtime Web)**: If ONNX WebAssembly binaries (`/assets/onnxruntime/`) and PaddleOCR models are loaded in the host environment, the system executes neural text detection (`PP-OCRv6_tiny_det`) and character recognition (`PP-OCRv6_tiny_rec`).
* **Embedded Micro-OCR Engine (`scanImageDataForText`)**: If ONNX models are absent, the browser executes a 100% JavaScript micro-OCR engine that:
  1. Segments candidate text regions into character glyph patches.
  2. Runs **Stroke-Width Transform (SWT)** and edge topology filtering to eliminate false positive detections on sharp anatomical boundaries (bone contours, diaphragm, surgical clips).
  3. Resamples glyph patches against 7x7 binary character font templates (A-Z, 0-9, and symbols) to perform **actual optical character recognition** rather than dummy placeholder token assignment.
  4. Includes canvas downscaling (`ocrMaxResolution: 1024`) and execution timeout guards for slower devices and low-power mobile CPUs.

### Step 3: RSNA PHI Classification & Measurement Disambiguation
The `phi-classifier.js` module cross-references recognized text strings against metadata extracted from the DICOM header (Patient Name, Patient ID, Accession Number, Birth Date):
- **Measurement & Technical Text Preservation**: Clinical acquisition parameters (e.g. `"5.2 cm"`, `"120 KVP"`, `"3.5 MHz"`, `"60 FPS"`, `"MI 1.2"`, `"GAIN 0dB"`) and anatomical orientational labels (e.g. `"LIVER"`, `"AP"`, `"RT"`, `"LT"`) are matched against comprehensive medical regexes and whitelists, assigning `phiScore: 0` and `decision: "keep"`.
- **PHI Redaction**: Strings matching DICOM metadata (with fuzzy Levenshtein distance), dates (`YYYY-MM-DD`, `MM/DD/YYYY`), phone numbers, emails, MRNs, or PHI labels (`PATIENT`, `NAME`, `DOB`, `PHYSICIAN`) are assigned `phiScore >= 50` and `decision: "redact"`.
- **Label Adjacency**: Text immediately adjacent to a PHI label keyword is classified for redaction unless recognized as a safe measurement parameter.

### Step 4: Stored Pixel Redaction
For bounding boxes classified as PHI:
1. A pixel margin (default: `4px`) is applied to expand the bounding box.
2. The raw `TypedArray` buffer underlying `PixelData (7FE0,0010)` is overwritten directly in memory.
3. Pixel values inside the rectangle are replaced with `fillVal` (0 for MONOCHROME2, max intensity for MONOCHROME1, or `PixelPaddingValue` if present).
4. Optional borders (`none`, `red`, `white`, `black`, `double`) are drawn around redacted boxes based on configuration settings (`borderColor`, `borderWidth`).
5. **Tag Update**: The `BurnedInAnnotation (0028,0301)` DICOM tag is updated to `"NO"`.
6. **Transcoding**: Encapsulated compressed datasets (e.g., JPEG 2000, JPEG-LS, RLE Lossless) are decoded, redacted, and re-encoded using native WebAssembly DICOM codecs (`dicom-codecs.js`).

---

## 3. Hardware Performance Controls & Slower Device Fallbacks

To ensure smooth performance on low-spec hardware and mobile browsers, the pipeline includes performance controls:
- **`ocrPerformanceMode`**: 
  - `"balanced"` (Default): Micro-OCR character recognition with standard canvas resolution.
  - `"fast"`: Downscales high-resolution DICOM frames (>1024px) before scanning to optimize CPU usage on low-power devices.
  - `"thorough"`: Full-resolution scanning.
- **`ocrMaxResolution`**: Maximum canvas dimension (default `1024px`) for downscaling.
- **`requireOcrModelConfirmation`**: Option to prompt the user before running fallback micro-OCR when WASM neural models are unavailable on slower devices.

---

## 4. Regulatory & Compliance Disclaimer

> [!WARNING]
> **CRITICAL COMPLIANCE NOTICE**  
> 1. **No FDA Clearance / CE Mark**: The pixel redaction module is an uncertified software utility provided for experimental and internal research purposes only.
> 2. **NOT HIPAA Safe Harbor Certified**: This feature **DOES NOT** guarantee compliance with HIPAA Safe Harbor (45 CFR § 164.514(b)(2)) or GDPR de-identification standards for burned-in pixel data.
> 3. **Mandatory Human Verification**: Medical imaging datasets containing burned-in text **MUST BE 100% MANUALLY AUDITED AND VERIFIED** by qualified personnel prior to public release, publication, or secondary distribution.
> 4. **No Liability**: Neither the OHIF maintainers nor software authors accept liability for accidental disclosure of Protected Health Information (PHI) resulting from reliance on this automated pixel redaction tool.

---

## Next Steps

- Proceed to **[05. Storage Writers, Directory Layout & Troubleshooting](./05-storage-directory-layout-troubleshooting.md)** to learn about folder layout specifications and storage strategies.
