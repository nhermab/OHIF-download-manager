# 01. Download Manager — Overview & Quickstart Guide

> **Author**: **Nick Hermans** (Medical Imaging Engineer, UZ Leuven — Information Technology and Data Department, PACS, eHealth HUB and Telematics team) — [`nick.hermans@uzleuven.be`](mailto:nick.hermans@uzleuven.be)  
> **Package**: `@ohif/extension-download-manager` (OHIF Viewer v3 Platform)

---

This guide introduces the OHIF Viewer Download Manager, explaining its core architecture, user interface layout, and step-by-step export workflow for medical imaging datasets.

---

## 1. Executive Overview

The **OHIF Download Manager** enables clinical researchers and medical staff to export DICOM datasets and derivative objects directly from the OHIF Viewer. 

### Key Characteristics
* **100% Client-Side Execution**: All network operations, DICOM tag modifications, pixel parsing, and file archiving occur locally within the browser. No imaging data or DICOM metadata is sent to third-party cloud servers or external processing backends.
* **PACS Credentials Preservation**: Downloads reuse the active DICOMweb session security context and bearer authorization tokens managed by OHIF's `UserAuthenticationService`.
* **Deterministic File Organization**: Exported files are organized into standard, OS-safe folder structures (`Patient/Study/Series/SOPInstanceUID.dcm`).
* **Storage Flexibility**: Streams data directly to a local hard drive folder when using chromium-based browsers, or packages files into chunked `.zip` archives for other browsers.

---

## 2. Launching the Download Manager

The Download Manager is accessed via the OHIF Viewer primary toolbar or command panel.

1. Load a patient study in the OHIF Viewer.
2. In the top toolbar, click the **Download** icon (or press the configured hotkey / execute the `openDownloadManager` command).
3. The **Download Manager Modal** will open over the main viewer viewport.

![Figure 1.1: OHIF Toolbar Download Button Location](placeholder_toolbar_download_button.png)  
*Figure 1.1: Location of the Download toolbar action within the main OHIF Viewer interface.*

---

## 3. User Interface Overview

The Download Manager interface is divided into five operational sections:

![Figure 1.2: Download Manager Main Modal Dialog](placeholder_download_manager_modal_overview.png)  
*Figure 1.2: The primary Download Manager modal window showing study series selection and anonymization controls.*

### Key UI Elements
1. **Header Bar**: Displays total available studies, series counts, total SOP instances, and total estimated size.
2. **Modality Filter Bar**: Fast-filter buttons to quickly toggle series by imaging modality (e.g., `CT`, `MR`, `PT`, `US`, `SR`, `SEG`).
3. **Series Selection Panel**: List of studies and series currently loaded in the viewer context, with individual checkboxes, study-level selection controls, and SOP instance counts.
4. **Anonymizer Configuration Panel**: Expandable accordion box containing 5 tabbed categories for metadata tag cleaning, presets, and pixel redaction controls.
5. **Action Footer**: Displays destination mode (Direct Folder vs. Zip Archive) and buttons for **Cancel** and **Start Export**.

---

## 4. Step-by-Step Export Workflow

### Step 1: Scope the Dataset
Upon opening the modal, all series from the loaded patient studies are selected by default. Use the series checkboxes or modality filter buttons to narrow down the exported series (e.g., export only thin-slice axial CT series).

### Step 2: Configure Anonymization (Optional)
If exporting for research, teaching, or external distribution:
* Check the **Anonymize DICOM metadata** checkbox.
* Select an anonymization preset (e.g., `Full Anonymization`, `Research Profile`, `Keep Dates`) or manually adjust individual tag settings under the configuration tabs.
* Verify if **Visual Image Text Redaction (OCR)** is required for burned-in annotations.

### Step 3: Initiate Export
Click **Start Export**. The browser will initiate the download pipeline:

* **Direct Folder Mode (Chrome / Edge / Opera)**: A system folder picker dialog will prompt you to select or create a destination directory on your computer. Once selected, files stream directly to disk.
* **Zip Archive Mode (Firefox / Safari / Fallback)**: The browser fetches DICOM instances into memory, constructs `.zip` archive chunks (up to 700 MB per chunk by default), and triggers standard browser file downloads.

![Figure 1.3: Target Directory Selection Dialog](placeholder_folder_picker_dialog.png)  
*Figure 1.3: Native OS directory selection prompt when using Direct Folder Mode.*

### Step 4: Monitor Progress
During export, the modal switches to the **Download Progress View**:

![Figure 1.4: Real-time Download Progress View](placeholder_download_progress_view.png)  
*Figure 1.4: Live progress bar, transfer rate metrics, error counter, and activity log.*

* **Progress Bar**: Indicates completed file count versus total queued files.
* **Metrics**: Real-time throughput (MB/s), elapsed time, estimated time remaining, and failed request counts.
* **Activity Log**: Displays granular per-instance status, anonymization warnings, or HTTP retries.
* **Abort Button**: Stops the download operation at any point and cleanly closes open file handles.

---

## 5. Export Completion & Verification

Once processing finishes, the modal displays the **Download Summary View**:

![Figure 1.5: Download Completion Summary Screen](placeholder_download_summary_view.png)  
*Figure 1.5: Final summary screen displaying total saved instances, byte size, elapsed time, and error quarantine report.*

* If any DICOM instances failed to fetch (e.g., network timeouts or PACS 500 errors), they will be listed in an **Error Report** with options to retry failed instances.
* Click **Done** to close the Download Manager and return to the viewer.

---

## Next Steps

- Proceed to **[02. Dataset Selection & Filtering](./02-dataset-selection-and-filtering.md)** to learn about multi-study scoping and modality filters.
