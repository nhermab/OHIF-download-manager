# OHIF-download-manager

> **OHIF Viewer v3 Extension for DICOM Dataset Management, Export, & Client-Side Anonymization**

 (https://ohif.ehealthhub.be/viewer?StudyInstanceUIDs=1.2.276.0.7230010.3.1.2.2155604110.4180.1021041295.21)[Online DEMO]
(download button top toolbar left side) 

## Summary

The **OHIF Download Manager** is a OHIF extension for the OHIF (Open Health Imaging Foundation) v3 Viewer platform. Developed at **UZ Leuven** by the Information Technology and Data Department (PACS, eHealth HUB and Telematics team), this extension bridges clinical medical imaging viewer workflows with research data governance, enabling clinicians, researchers, and PACS administrators to filter, batch export, package, and anonymize DICOM imaging datasets directly within client-side browser sessions.

The extension executes **100% client-side**, eliminating external server dependencies or third-party cloud uploads. It features streaming ZIP writers, WebAssembly-based DICOM frame transcoding, optical character recognition (OCR) with Stroke-Width Transform (SWT) anatomical topology filtering for pixel redaction, and attempts compliance with the **[DICOM PS 3.15 Annex E Basic Application Level Confidentiality Profile](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html)** including full de-identification audit provenance injection.

---

## Quickstart & Testing with Local OHIF Release

Follow these step-by-step bash commands to check out the latest official release of OHIF Viewer, include the Download Manager extension, and run a local instance for testing:

### Prerequisites
- **Node.js**: `>= 18.x`
- **Yarn**: `1.22.x` (Yarn Classic)
- **Git**

### Bash Commands

```bash
# 1. Clone the OHIF Viewers repository and check out the target release tag
git clone https://github.com/OHIF/Viewers.git ohif-viewer
cd ohif-viewer
git fetch --tags
git checkout $(git describe --tags $(git rev-list --tags --max-count=1))

# 2. Clone the Download Manager extension into extensions/download-manager
git clone https://github.com/nhermab/OHIF-download-manager.git extensions/download-manager

# 3. Install dependencies across monorepo workspaces (required for CLI dependencies like commander)
yarn install

# 4. Link the extension using OHIF CLI
yarn cli link-extension extensions/download-manager

# 5. Include DownloadManager in active Mode toolbar layout (e.g. modes/basic/src/index.tsx)
node -e '
  const fs = require("fs");
  const file = "modes/basic/src/index.tsx";
  if (fs.existsSync(file)) {
    let c = fs.readFileSync(file, "utf8");
    if (!c.includes("DownloadManager")) {
      fs.writeFileSync(file, c.replace("[TOOLBAR_SECTIONS.primary]: [", "[TOOLBAR_SECTIONS.primary]: [\n    \"DownloadManager\","));
    }
  }
'

# 6. Launch the local OHIF Viewer instance
yarn dev
```

After starting the dev server, open your browser and navigate to **`http://localhost:3000`** to test the Download Manager within the OHIF Viewer interface.

---

## Key Features & Medical Imaging Architecture

### 1. Dataset Selection, Filtering & Multi-Study Scoping
- **Multi-Study & Multi-Series Batch Scoping**: Automatically aggregates all patient studies loaded in the active OHIF viewer context into a unified selection tree.
- **Modality Quick-Filters**: Instantaneous toggling across DICOM modalities (`CT`, `MR`, `PT`, `US`, `DX`, `CR`, `MG`, `SR`, `SEG`, `RTSTRUCT`, `XA`, `ES`, `DOC`).
- **Pre-flight Dataset Validation**: Pre-checks all requested DICOM SOP Instances for mandatory UIDs, accessibility, and parseability prior to download, preventing incomplete exports.

### 2. DICOM PS 3.15 Header Anonymization & Provenance Injection
- **DICOM Standard Profile Compliance**: Implements tag modification rules based on **[DICOM PS 3.15 Annex E (Basic Application Level Confidentiality Profile)](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html)**.
- **Granular Tag Rules Engine**: Configurable handling (`KEEP`, `REMOVE`, `CLEAN`, `REPLACE`, `HASH`, `DUMMY`) across Patient, Study, Series, Equipment, Institution, and Physician identity tags.
- **De-identification Audit Provenance (PS 3.15 Annex E)**: Injects standard compliance metadata into exported DICOM headers:
  - `PatientIdentityRemoved (0012,0062)`: Set to `"YES"`
  - `DeidentificationMethod (0012,0063)`: Descriptive methodology array (e.g., `"OHIF_DOWNLOAD_MANAGER_BASIC_PROFILE"`)
  - `DeidentificationMethodCodeSequence (0012,0064)`: Standard DICOM CID 7050 codes (e.g., `113100` for Basic Application Confidentiality Profile)
  - `ContributingEquipmentSequence (0018,A001)`: Complete equipment provenance log recording de-identification software identity and timestamp.

### 3. Optical & Topological Pixel Redaction Engine
- **Micro-OCR Text Detection**: Embedded glyph segmentation engine ([`src/ocr-engine.js`](./src/ocr-engine.js)) recognizing patient demographic annotations across diverse medical fonts, orientations, and contrast levels.
- **Stroke-Width Transform (SWT) & Edge Topology Filter**: Uses SWT variance analysis to distinguish character text strokes from high-contrast anatomical edges (e.g., diaphragmatic contours, surgical clips, cortical bone borders, ECG leads), preventing false-positive anatomical blackouts.
- **RSNA PHI vs. Clinical Measurement Classifier**: Disambiguates sensitive Protected Health Information (PHI) from vital diagnostic graphics (e.g., millimeter calipers, ROI HU values, angle measurements).
- **Sequential Multi-Frame Scan Verification**: Evaluates multi-frame cine loops sequentially (`multiFrameRedactionMethod: "aggressive"`) to ensure no un-scanned intermediate frames escape redaction. Fail-closed semantics ensure `BurnedInAnnotation (0028,0301)` is set to `"NO"` only when pixel redaction is independently verified clean.

### 4. WebAssembly Codecs & Transfer Syntax Preservation
- **In-Browser Transcoding**: Integrates native WebAssembly & JavaScript DICOM codecs (`@cornerstonejs/codec-openjpeg`, `@cornerstonejs/codec-charls`, `@cornerstonejs/codec-openjph`, `@cornerstonejs/codec-libjpeg-turbo-8bit`, `jpeg-lossless-decoder-js`, custom RLE Lossless codec).
- **Transfer Syntax Support**: Full decoding, redaction, and re-encoding support for encapsulated syntaxes:
  - **JPEG 2000 Lossless & Lossy** (`1.2.840.10008.1.2.4.90` / `91`)
  - **JPEG-LS Lossless & Near-Lossless** (`1.2.840.10008.1.2.4.80` / `81`)
  - **High-Throughput JPEG 2000 (HTJ2K)** (`1.2.840.10008.1.2.4.201` / `202` / `203`)
  - **RLE Lossless** (`1.2.840.10008.1.2.5`)
  - **JPEG Lossless & Baseline** (`1.2.840.10008.1.2.4.57` / `70` / `50`)
- **Explicit VR Little Endian Fallback**: Option to output decompressed Explicit VR Little Endian (`1.2.840.10008.1.2.1`) when downstream tools require raw pixel data.

### 5. Tiered Storage & Memory-Safe ZIP Streaming
- **OPFS & IndexedDB Storage Pipeline**: Prevents browser heap out-of-memory (OOM) crashes during multi-gigabyte dataset packaging. Streams ZIP entries directly to Origin Private File System (OPFS) or IndexedDB chunk buffers.
- **Cryptographic Verification Manifests**: Every exported archive generates:
  - `export-manifest.json`: Structured manifest recording requested SOP UIDs, written files, failed items, and de-identification settings.
  - `checksums.sha256`: SHA-256 cryptographic hash list for all exported files to guarantee data integrity during transport.

### 6. Neutral Directory Layout & Path Sanitization
- **Non-Identifying Path Structure**: Prevents accidental PHI leaks via filesystem paths:
  ```text
  dataset/
  ├── export-manifest.json
  ├── checksums.sha256
  └── Patient_<StudyUID_suffix>/
      └── Study_<StudyUID_suffix>/
          └── Series_<SeriesNumber>_<SeriesUID_suffix>/
              ├── <SOPInstanceUID>.dcm
              └── ...
  ```
- **OS Path Safety**: Enforces strict character sanitization (`< > : " / \ | ? *`), collapses whitespace/carets, caps path segments at 120 characters for Windows OS compatibility, and handles duplicate directory collisions cleanly.

---

## Project Architecture

```text
extensions/download-manager/
├── src/
│   ├── index.tsx                  # OHIF Extension entry point & command registration
│   ├── anonymizer.js              # Core DICOM header PS 3.15 tag anonymization engine
│   ├── anonymizer-config.js       # Persistent anonymizer settings, rules, & presets
│   ├── anonymizer-rules.js        # Comprehensive DICOM Data Element dictionary rules
│   ├── pixel-redactor.js          # Image pixel redaction engine & multi-frame processor
│   ├── ocr-engine.js              # Micro-OCR engine & SWT edge topology analyzer
│   ├── phi-classifier.js          # RSNA PHI vs measurement overlay text classifier
│   ├── dicom-codecs.js            # WebAssembly codec decoder/encoder pipeline
│   ├── downloader.js              # Pipeline queue manager, fetch streams, & manifest generator
│   ├── manifest.js                # Selection tree compilation & path generator
│   ├── writers/
│   │   ├── zipWriter.js           # OPFS / IndexedDB tiered streaming ZIP archive writer
│   │   └── folderWriter.js        # Native File System Access API writer
│   └── components/                # React UI components (AnonymizerPanel, ModalityFilter, etc.)
├── docs/                          # Comprehensive user & technical documentation suite
├── [SHORTCOMINGS.md](./SHORTCOMINGS.md)                # Safety audit log & technical boundary reference
├── package.json                   # Package manifest & dependencies
└── README.md                      # Primary technical README
```

---

## Installation & Monorepo Integration

### Monorepo Setup
Ensure Node.js 18+ and Yarn 1 are installed in the OHIF monorepo root.

```bash
yarn install --frozen-lockfile
```

### Extension Registration
1. **Register in `platform/app/pluginConfig.json`**:
```json
{
  "extensions": [
    {
      "packageName": "@ohif/extension-download-manager",
      "version": "3.12.10"
    }
  ]
}
```
*(Running `yarn cli link-extension extensions/download-manager` automatically adds this entry).*

2. **Mount Button in Mode Toolbar (`modes/basic/src/index.tsx`)**:
In OHIF v3, extensions provide tools/commands, but **Modes** control what appears in the active viewer toolbar. Ensure `'DownloadManager'` is included in `toolbarSections.primary`:
```typescript
export const toolbarSections = {
  [TOOLBAR_SECTIONS.primary]: [
    'MeasurementTools',
    'Zoom',
    'Pan',
    'TrackballRotate',
    'WindowLevel',
    'Capture',
    'DownloadManager', // <-- Required for button to render in UI
    'Layout',
    'Crosshairs',
    'MoreTools',
  ],
};
```

### Runtime Configuration
Configure in your OHIF runtime configuration file (e.g., `platform/app/public/config/default.js`):

```javascript
window.config = {
  // Standard OHIF configuration...
  aquestDownloadManager: {
    enabled: true,
    maxParallel: 3,
    preferFolderWriter: false,
    retryCount: 1,
    zipChunkBytes: 734003200, // 700 MB chunks
    zipMaxEntries: 60000,
    anonymizer: {
      enablePixelRedaction: true,
      multiFrameRedactionMethod: 'aggressive',
      requireOcrModelConfirmation: false,
    },
  },
};
```

---

## Technical Documentation Suite

For detailed guides, compliance specifications, and user manuals, consult the **[Documentation Suite](./docs/index.md)**:

1. **[01. Overview & Quickstart](./docs/01-overview-and-quickstart.md)**: UI toolbar, launch modes, dialogs, and step-by-step export workflow.
2. **[02. Dataset Selection & Filtering](./docs/02-dataset-selection-and-filtering.md)**: Multi-study scoping, modality filtering, and manifest pre-flight checks.
3. **[03. Metadata Anonymization](./docs/03-metadata-anonymization.md)**: DICOM PS 3.15 tag rules engine, script presets, and provenance tags.
4. **[04. Pixel Redaction & Technical Limitations](./docs/04-pixel-redaction-and-limitations.md)**: Micro-OCR engine, Stroke-Width Transform (SWT) topology filtering, WebAssembly codecs, and safety boundaries.
5. **[05. Storage Writers & Troubleshooting](./docs/05-storage-directory-layout-troubleshooting.md)**: OPFS/IndexedDB streaming ZIP writers, SHA-256 manifests, neutral path formatting, and troubleshooting.

---

## Quality Assurance & Verification

Run unit tests across all anonymizer, redactor, codec, manifest, and storage writer test suites:

```bash
yarn test:unit:ci
```

To build production assets:
```bash
yarn build
```

---

* **Author**: **Nick Hermans**
* **Institution**: **UZ Leuven** (University Hospitals Leuven, Information Technology and Data Department; PACS, eHealth HUB and Telematics team)
* **Contact**: [`nick.hermans@uzleuven.be`](mailto:nick.hermans@uzleuven.be)
* **Package**: `@ohif/extension-download-manager` (OHIF v3 Platform)

---

## License & Limitation of Liability

Licensed under the **MIT License**. See [LICENSE](./LICENSE) for full details.

### Disclaimer of Warranty & Limitation of Liability
> **NOTICE**: This software and documentation are provided **"AS IS"**, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. 
> 
> IN NO EVENT SHALL THE AUTHOR (**NICK HERMANS**), **UZ LEUVEN** (UNIVERSITY HOSPITALS LEUVEN), OR ANY CONTRIBUTORS / COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, DATA LOSS, PRIVACY BREACH, REGULATORY NON-COMPLIANCE, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### Third-Party Credits & Code Provenance
- **RSNA DICOM Anonymizer V18.0 / MIRC CTP Anonymizer** (Apache License 2.0) — Applies to tag transformation rules, script definitions, and PHI classification schemas (`src/default-anonymizer.script`, `src/anonymizer-rules.js`, `src/anonymizer-rules.json`, `src/rules.json`, `src/anonymizer-config.js`, `src/anonymizer.js`, `src/phi-classifier.js`).
- **DicomCleaner™ / PixelMed Toolkit** (BSD 3-Clause License) — Applies to safe private attribute lists and retains/removes rules (`src/safe-private-rules.js`, `src/anonymizer.js`).
- **OHIF Download Manager Extension / Original Contributions** (MIT License) — Applies to all UI components, modal dialogs, streaming ZIP/folder writers, optical pixel redaction engine, WebAssembly transcoders, and test suites by Nick Hermans / UZ Leuven (`src/pixel-redactor.js`, `src/ocr-engine.js`, `src/downloader.js`, `src/manifest.js`, `src/components/*`, `src/writers/*`, etc.). See [LICENSE](./LICENSE) for full details.


