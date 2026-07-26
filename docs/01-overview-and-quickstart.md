# 01. Download Manager — Overview & Quickstart Guide

> **Author**: **Nick Hermans** (Medical Imaging Engineer, UZ Leuven — Information Technology and Data Department, PACS, eHealth HUB and Telematics team) — [`nick.hermans@uzleuven.be`](mailto:nick.hermans@uzleuven.be)  
> **Package**: `@ohif/extension-download-manager` (OHIF Viewer v3 Platform)

---

This guide introduces the OHIF Viewer Download Manager, explaining its core architecture, user interface layout, and step-by-step export workflow for medical imaging datasets.

---

## 1. Executive Overview

The **OHIF Download Manager** is a medical-grade browser extension engineered for the OHIF Viewer v3 platform. Developed at UZ Leuven by medical imaging engineers, it bridges clinical viewer workflows with research data governance, enabling clinicians, researchers, and PACS administrators to filter, batch export, package, and anonymize DICOM imaging datasets directly within client-side browser sessions.

### Key Characteristics
* **100% Client-Side Execution**: All network operations, DICOM tag modifications, pixel parsing, and file archiving occur locally within the browser. No imaging data or DICOM metadata is sent to third-party cloud servers.
* **PACS Credentials Preservation**: Downloads reuse the active DICOMweb session security context and bearer authorization tokens managed by OHIF's `UserAuthenticationService`.
* **Neutral Directory Structure**: Exported files are organized into non-identifying folder structures (`dataset/Patient_<StudyUID_suffix>/Study_<StudyUID_suffix>/Series_<SeriesNumber>_<SeriesUID_suffix>/<SOPInstanceUID>.dcm`) accompanied by `export-manifest.json` and `checksums.sha256`.
* **Storage Flexibility**: Streams data directly to a local hard drive folder using Chrome/Edge File System Access API, or packages files into chunked `.zip` archives backed by browser OPFS/IndexedDB tiered storage.

---

## 2. Launching the Download Manager

Access the Download Manager from the main OHIF Viewer interface:

1. Load a patient study in the OHIF Viewer.
2. In the top toolbar, click the **Download** icon (or execute the `openDownloadManager` command).
3. The **Download Manager Modal** will open over the main viewer viewport.

![Figure 1.1: OHIF Toolbar Download Button Location](placeholder_toolbar_download_button.png)  
*Figure 1.1: Location of the Download toolbar action within the main OHIF Viewer interface.*

---

## 3. User Interface Overview

The Download Manager interface is divided into five operational sections:

![Figure 1.2: Download Manager Main Modal Dialog](placeholder_download_manager_modal_overview.png)  
*Figure 1.2: The primary Download Manager modal window showing study series selection and anonymization controls.*

### Key UI Elements
1. **Header Bar**: Displays total available studies, series counts, total SOP instances, and total estimated download size.
2. **Modality Quick-Filters**: Instantaneous toggle buttons to quickly filter series by DICOM modality (`CT`, `MR`, `PT`, `US`, `DX`, `CR`, `MG`, `SR`, `SEG`, `RTSTRUCT`, `XA`, `ES`, `DOC`).
3. **Series Selection Panel**: Hierarchical list of loaded studies and series with checkboxes, study-level selection controls, and SOP instance counts.
4. **Anonymizer Configuration Panel**: Expandable panel containing tabbed categories for metadata tag cleaning, privacy presets, vendor tag policies, and visual pixel redaction controls.
5. **Action Footer**: Displays destination mode (Direct Folder vs. Zip Archive) and buttons for **Cancel** and **Start Export**.

---

## 4. Step-by-Step Export Workflow

### Step 1: Scope the Dataset
Upon opening the modal, all series from the loaded patient studies are selected by default. Use the series checkboxes or modality filter buttons to narrow down the exported series (for example, exporting only axial CT series).

### Step 2: Configure Anonymization (Optional)
If exporting for research or external sharing:
* Check the **Anonymize DICOM metadata** checkbox.
* Select an anonymization preset (`Full Anonymization`, `Research Profile`, `Keep Dates`, `Minimal Anonymization`) or adjust individual tag settings under the configuration tabs.
* Enable **Visual Image Text Redaction (OCR)** if burned-in patient demographics require pixel-level blackouts.

### Step 3: Initiate Export
Click **Start Export**. The browser will initiate the download pipeline:

* **Direct Folder Mode (Chrome / Edge / Opera)**: A system folder picker dialog prompts you to select a destination directory on your computer. Files stream directly to disk without holding full archives in RAM.
* **Zip Archive Mode (Firefox / Safari / Fallback)**: The browser streams DICOM instances into tiered OPFS or IndexedDB chunk buffers, constructs `.zip` archives (up to 700 MB per chunk by default), and triggers standard browser downloads.

![Figure 1.3: Target Directory Selection Dialog](placeholder_folder_picker_dialog.png)  
*Figure 1.3: Native OS directory selection prompt when using Direct Folder Mode.*

### Step 4: Monitor Progress
During export, the modal switches to the **Download Progress View**:

![Figure 1.4: Real-time Download Progress View](placeholder_download_progress_view.png)  
*Figure 1.4: Live progress bar, transfer rate metrics, error counter, and activity log.*

* **Progress Bar**: Indicates completed file count versus total queued files.
* **Metrics**: Real-time throughput (MB/s), elapsed time, estimated time remaining, and failed request counts.
* **Activity Log**: Displays granular per-instance status, anonymization notices, or network retries.
* **Abort Button**: Stops the download operation at any point and safely cleans up open streams.

---

## 5. Export Completion & Verification

Once processing finishes, the modal displays the **Download Summary View**:

![Figure 1.5: Download Completion Summary Screen](placeholder_download_summary_view.png)  
*Figure 1.5: Final summary screen displaying total saved instances, byte size, elapsed time, and error quarantine report.*

* Every export generates an `export-manifest.json` manifest log and a `checksums.sha256` integrity manifest file.
* If any DICOM instances failed to fetch (for example, network timeouts or PACS 500 errors), they will be listed in an **Error Report** with options to retry failed instances.
* Click **Done** to close the Download Manager and return to the viewer.

---

## Next Steps

- Proceed to **[02. Dataset Selection & Filtering](./02-dataset-selection-and-filtering.md)** to learn about multi-study scoping and modality filters.
