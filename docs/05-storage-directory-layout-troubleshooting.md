# 05. Storage Writers, Directory Layout & Troubleshooting

> **Author**: **Nick Hermans** (Medical Imaging Engineer, UZ Leuven — Information Technology and Data Department, PACS, eHealth HUB and Telematics team) — [`nick.hermans@uzleuven.be`](mailto:nick.hermans@uzleuven.be)  
> **Package**: `@ohif/extension-download-manager` (OHIF Viewer v3 Platform)

---

This document details storage writer strategies, canonical directory layout specifications, progress monitoring metrics, and troubleshooting procedures for the OHIF Download Manager.

---

## 1. Storage Writer Strategies

The Download Manager uses two storage writer pipelines to save exported DICOM datasets to disk depending on browser capabilities:

![Figure 5.1: Storage Writer Selection Flow](placeholder_storage_writer_flow.png)  
*Figure 5.1: Storage writer selection logic between Direct Folder Writer and Tiered ZIP Streaming.*

### Strategy A: Direct Folder Streaming (`src/writers/folderWriter.js`)
* **Technology**: W3C **File System Access API** (`window.showDirectoryPicker`).
* **Supported Browsers**: Google Chrome 86+, Microsoft Edge 86+, Opera 72+ (Desktop).
* **Behavior**:
  1. The browser prompts the user to select a destination directory on their local filesystem.
  2. As DICOM instances are fetched, anonymized, and processed, files stream directly to disk in structured subdirectories.
  3. Memory footprint remains minimal regardless of export size because RAM is freed after each instance is written.
  4. No post-export `.zip` extraction is required.

### Strategy B: Tiered OPFS / IndexedDB ZIP Streaming (`src/writers/zipWriter.js`)
* **Technology**: Streaming ZIP archive writer utilizing Origin Private File System (OPFS) and IndexedDB chunk buffers.
* **Supported Browsers**: All browsers (Mozilla Firefox, Apple Safari, mobile browsers, or non-HTTPS contexts).
* **Behavior**:
  1. DICOM instances stream into client-side OPFS or IndexedDB chunk buffers to prevent browser heap out-of-memory (OOM) crashes during multi-gigabyte dataset packaging.
  2. Datasets are partitioned into multi-volume `.zip` archives (default: `700 MB` per chunk or maximum 60,000 instances).
  3. The browser triggers standard file downloads (e.g. `export_dataset_part1.zip`, `export_dataset_part2.zip`).

---

## 2. Neutral Directory Layout & Manifest Specification

To prevent accidental Patient Health Information (PHI) exposure via filesystem directory paths, exports enforce a neutral non-identifying path hierarchy across all operating systems:

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

### Path Hierarchy Components

| Level | Format Pattern | Example Output | Description / Fallback |
| :--- | :--- | :--- | :--- |
| **Patient Directory** | `Patient_<StudyUID_suffix>` | `Patient_38240971` | Short UID suffix derived from StudyInstanceUID. Prevents patient name/ID in path. |
| **Study Directory** | `Study_<StudyUID_suffix>` | `Study_38240971` | Short UID suffix derived from StudyInstanceUID. |
| **Series Directory** | `Series_<SeriesNumber>_<SeriesUID_suffix>` | `Series_003_1493322` | Zero-padded 3-digit series number and series UID suffix. |
| **DICOM Filename** | `<SOPInstanceUID>.dcm` | `1.3.6.1.4.1.25403...dcm` | SOP Instance UID with `.dcm` extension (or `.mp4` for video). |

### Manifest & Integrity Files
Every export archive automatically generates two verification manifests at the root of the dataset folder:

1. **`export-manifest.json`**: Structured JSON manifest recording requested SOP UIDs, exported file paths, failed items, de-identification settings, and software provenance metadata.
2. **`checksums.sha256`**: SHA-256 cryptographic checksum list for all exported files to guarantee data integrity during transport.

### Path Safety & Sanitization Rules
1. **Invalid OS Characters**: Illegal filesystem characters (`< > : " / \ | ? *`), control characters, tabs, and null bytes are replaced with underscores (`_`).
2. **Whitespace & Carets**: Spaces and DICOM caret `^` delimiters are collapsed to single underscores (`_`).
3. **120-Character Segment Cap**: To prevent Path-Too-Long errors on Windows (which enforces a 260-character total path limit), every directory component is capped at **120 characters**.
4. **Duplicate Collision Handler**: If distinct series yield identical folder names after sanitization, a collision handler automatically appends a numeric suffix (e.g. `_DUP02`).

---

## 3. Progress Tracking & Performance Metrics

During export, the Download Manager displays live performance metrics:

![Figure 5.2: Detailed Download Progress and Performance Metrics](placeholder_progress_metrics_detailed.png)  
*Figure 5.2: Live monitoring interface showing completion percentage, transfer rates, elapsed time, and real-time activity log.*

- **Completion Count**: Displays completed versus total queued files (e.g. `1,420 / 2,500 DICOMs`).
- **Transfer Rate**: Live throughput in megabytes per second (MB/s).
- **Time Metrics**: Elapsed processing time and dynamic Estimated Time Remaining (ETA).
- **Retry Monitor**: Displays active retry counts for instances experiencing network timeouts (`maxParallel` default: 3 concurrent worker queues).

---

## 4. Troubleshooting & Common Resolutions

| Issue / Symptom | Root Cause | Recommended Resolution |
| :--- | :--- | :--- |
| **"Download Manager button not visible in toolbar"** | Extension registered in `pluginConfig.json` but `'DownloadManager'` is missing from the active Mode's `toolbarSections.primary`. | Patch `modes/basic/src/index.tsx` (or your active mode) to include `'DownloadManager'` in `toolbarSections.primary`, and run `yarn cli link-extension` *before* `yarn install`. |
| **"Folder Writer Permission Denied"** | Directory picker permission prompt was cancelled or denied in Chrome/Edge. | Click **Start Export** again and select **Allow** when the browser prompts for folder access. |
| **"Out of Memory / Zip Buffer Allocation"** | Large dataset export exceeded available browser RAM in Zip Mode. | Use Chrome or Edge for Direct Folder Mode, or decrease `zipChunkBytes` in app configuration (e.g. to 300MB). |
| **"HTTP 401 / 403 Unauthorized"** | OHIF session authentication token expired during a long export run. | Refresh the viewer page, re-authenticate with PACS, and restart the export. |
| **"PACS HTTP 500 / 504 Timeout"** | PACS server failed to serve a specific WADO-RS instance request. | Check PACS server availability. The Download Manager retries failed instances up to `retryCount` times. |
| **"Path Too Long / File Creation Error"** | Destination folder is nested deeply in local Windows directory tree. | Select a target export directory closer to the drive root (e.g. `C:\DICOM_Exports`). |

---

## 5. Runtime Configuration Parameters

Default parameters can be configured in your OHIF runtime configuration file (e.g. `platform/app/public/config/default.js`):

```javascript
window.config = {
  // Standard OHIF configuration...
  aquestDownloadManager: {
    enabled: true,
    maxParallel: 3,                  // Concurrent instance fetch queues
    preferFolderWriter: true,        // Prefer File System Access API over Zip fallback
    retryCount: 2,                   // Network retry attempts per instance
    zipChunkBytes: 700 * 1024 * 1024, // 700 MB max per zip archive chunk
    zipMaxEntries: 60000             // Maximum instances per zip chunk
  }
};
```

---

## Technical Documentation Suite

This completes the 5-part technical documentation suite for `@ohif/extension-download-manager`:

1. **[01. Overview & Quickstart](./01-overview-and-quickstart.md)**
2. **[02. Dataset Selection & Filtering](./02-dataset-selection-and-filtering.md)**
3. **[03. DICOM Metadata Anonymization](./03-metadata-anonymization.md)**
4. **[04. Burned-in Pixel Redaction & Limitations](./04-pixel-redaction-and-limitations.md)**
5. **[05. Storage Writers, Directory Layout & Troubleshooting](./05-storage-directory-layout-troubleshooting.md)**
