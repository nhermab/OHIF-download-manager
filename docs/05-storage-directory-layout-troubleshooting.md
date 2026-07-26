# 05. Storage Writers, Directory Layout & Troubleshooting

> **Current behavior:** exports use a single ZIP archive and non-identifying paths.
> Direct folder writing is disabled pending transactional staging and rollback.

This document details the file storage strategies, canonical directory structure formatting rules, progress monitoring metrics, and troubleshooting procedures for the OHIF Download Manager.

---

## 1. Storage Writer Strategies

The Download Manager uses two storage strategies to write exported DICOM datasets to disk depending on browser capabilities and user security permissions:

![Figure 5.1: Storage Writer Selection Flow](placeholder_storage_writer_flow.png)  
*Figure 5.1: Decision logic for choosing between Direct Folder Writer and JSZip Archive Fallback.*

### Strategy A: Direct Folder Streaming (`folderWriter.js`)
* **Technology**: Built on the W3C **File System Access API** (`window.showDirectoryPicker`).
* **Supported Browsers**: Google Chrome 86+, Microsoft Edge 86+, Opera 72+ (Desktop only).
* **Behavior**:
  1. The browser prompts the user to grant write permission to a local directory.
  2. As DICOM instances are fetched and anonymized, files are written and streamed directly to disk into structured subdirectories.
  3. Memory consumption remains low regardless of total export size (RAM is freed after writing each instance).
  4. No post-download unzipping required.

### Strategy B: In-Memory Zip Archive Fallback (`zipWriter.js`)
* **Technology**: Built on `JSZip` in-memory compression stream library.
* **Supported Browsers**: All browsers (Mozilla Firefox, Apple Safari, mobile browsers, or non-HTTPS insecure contexts).
* **Behavior**:
  1. DICOM instances are accumulated in browser memory (RAM).
  2. Datasets are automatically partitioned into multi-volume `.zip` chunks (default: `700 MB` per zip chunk or max 60,000 entries) to prevent browser memory exhaustion.
  3. The browser triggers standard file download prompts (e.g., `export_dataset_part1.zip`, `export_dataset_part2.zip`).

---

## 2. Canonical Directory Layout Specification

Exports follow a strict, standardized directory hierarchy across all operating systems (Windows, macOS, Linux):

```text
dataset/
└── <PatientID_PatientName>/
    └── <StudyDate>_<StudyDescription>_<AccessionNumber>/
        └── <SeriesDescription>_<SeriesNumber>/
            ├── <SOPInstanceUID>.dcm
            ├── <SOPInstanceUID>.dcm
            └── ...
```

### Component Formatting Rules

| Level | Format | Example Output | Missing Value Fallback |
| :--- | :--- | :--- | :--- |
| **Patient Directory** | `<PatientID>_<PatientName>` | `SUBJECT001_Doe_John` | `UNKNOWN_PATIENT` |
| **Study Directory** | `<StudyDate>_<StudyDescription>_<AccessionNumber>` | `20260315_CHEST_CT_WITH_CONTRAST_ACC12345` | `UNKNOWN_DATE`, `NO_STUDY_DESCRIPTION`, `NO_ACCESSION` |
| **Series Directory** | `<SeriesDescription>_<SeriesNumber>` | `Axial_Thin_Slice_003` | `NO_SERIES_DESCRIPTION`, `NO_SERIES_NUMBER` |
| **Filename** | `<SOPInstanceUID>.dcm` (or `.mp4`) | `1.3.12.2.1107.5.2.32.35177.dcm` | Quarantined if missing UID |

### Sanitization & Path Rules
1. **Invalid OS Characters**: Illegal filesystem characters (`< > : " / \ | ? *`), control characters, tabs, and null bytes are replaced with an underscore `_`.
2. **Whitespace & Caret Collapse**: Runs of spaces and DICOM caret `^` delimiters (e.g., `Doe^John`) are converted and collapsed to a single underscore `_`.
3. **Leading / Trailing Dots**: Trailing periods and spaces are trimmed to comply with Windows NTFS specifications.
4. **Zero-Padded Series Number**: `SeriesNumber` is formatted as a 3-digit zero-padded string (e.g., `1` → `001`, `12` → `012`).
5. **Study Date Standard**: `StudyDate` is strictly formatted as `YYYYMMDD`.

### Length Caps & Duplicate Collision Handling
* **120-Character Cap**: To prevent Path-Too-Long errors on Windows (which enforces a 260-character total path limit), every directory component is capped at **120 characters**.
* **Truncation Priority**: If a string exceeds 120 characters, descriptive text (`StudyDescription` or `SeriesDescription`) is truncated first to protect structural IDs (`AccessionNumber` or `SeriesNumber`).
* **Duplicate Suffix (`_DUPxx`)**: If distinct studies or series produce identical folder strings after sanitization, a collision handler automatically appends a duplicate suffix (e.g., `_DUP02`, `_DUP03`).

---

## 3. Progress Tracking & Performance Metrics

During export execution, the modal displays live performance metrics:

![Figure 5.2: Detailed Download Progress and Performance Metrics](placeholder_progress_metrics_detailed.png)  
*Figure 5.2: Live monitoring interface showing completion percentage, transfer rates, elapsed time, and real-time activity log.*

- **Completion Count**: Displays `Completed / Total Files` (e.g., `1,420 / 2,500 DICOMs`).
- **Transfer Throughput**: Live megabytes per second (MB/s) fetched from PACS.
- **Time Metrics**: Elapsed processing time and dynamic Estimated Time Remaining (ETA).
- **Retry Monitor**: Displays current retry count for instances experiencing network glitches (`maxParallel` default: 3 worker queues).

---

## 4. Troubleshooting & Error Resolution

| Error Symptom / Log Message | Root Cause | Recommended Resolution |
| :--- | :--- | :--- |
| **"Folder Writer Permission Denied"** | User cancelled or denied the browser directory permission prompt. | Click **Start Export** again and click **Allow** when Chrome/Edge requests folder access. |
| **"Out of Memory / Zip Allocation Failed"** | Browser ran out of RAM constructing a large `.zip` archive in Zip Mode. | Switch to Chrome/Edge to use Direct Folder Mode, or lower `zipChunkBytes` in app config (e.g. to 300MB). |
| **"HTTP 401 / 403 Unauthorized"** | The active OHIF session authentication token expired during a long export. | Refresh the OHIF Viewer browser page, re-authenticate, and restart the download. |
| **"PACS HTTP 500 / 504 Timeout"** | The PACS/DICOMweb server failed to retrieve bulk DICOM frame data. | Check PACS server logs. The Download Manager will retry failed instances up to `retryCount` times. |
| **"Path Too Long / File Creation Error"** | Destination directory is nested inside a deep local folder structure on Windows. | Select a target folder closer to the drive root (e.g., `C:\DICOM_Exports`). |
| **"Encapsulated Syntax Transcode Error"** | Image frame uses compressed syntax that cannot be parsed by browser canvas. | Disable **Enable Pixel Redaction** for non-standard compressed series. |

---

## 5. System Configuration Options

System administrators can customize default Download Manager parameters in the main OHIF configuration file (`platform/app/public/config/default.js`):

```javascript
window.config = {
  // OHIF configuration...
  aquestDownloadManager: {
    enabled: true,
    maxParallel: 3,             // Maximum concurrent DICOM instance fetch requests
    preferFolderWriter: true,   // Prefer File System Access API over Zip fallback
    retryCount: 2,              // Network retry attempts per instance
    zipChunkBytes: 700 * 1024 * 1024, // 700 MB max per zip archive chunk
    zipMaxEntries: 60000        // Maximum DICOM instances per zip file
  }
};
```

---

## Summary of Documentation Suite

This completes the 5-part user and technical documentation for the OHIF Download Manager:
1. **[01. Overview & Quickstart](./01-overview-and-quickstart.md)**
2. **[02. Dataset Selection & Filtering](./02-dataset-selection-and-filtering.md)**
3. **[03. DICOM Metadata Anonymization](./03-metadata-anonymization.md)**
4. **[04. Burned-in Pixel Redaction & Limitations](./04-pixel-redaction-and-limitations.md)**
5. **[05. Storage Writers, Directory Layout & Troubleshooting](./05-storage-directory-layout-troubleshooting.md)**
