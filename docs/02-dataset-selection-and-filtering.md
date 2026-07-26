# 02. Dataset Selection & Filtering Guide

> **Safety notice:** selected files are identified data. This extension does not
> de-identify DICOM or verify clean pixel data.

This document details how the Download Manager extracts study metadata from the OHIF Viewer context, filters series by modality and study, computes export manifests, and handles missing or non-standard DICOM objects.

---

## 1. Study Context & Data Payload

When the Download Manager opens, it reads the active viewer state from OHIF's `DisplaySetService` and `DicomMetadataStore`. The dataset payload includes:

- All studies currently loaded in the viewer session (including multi-study comparison views).
- Series level metadata (Series Description, Series Number, Modality, SOP Class UID, instance count).
- SOP Instance UIDs and raw DICOMweb retrieve URLs (WADO-RS / bulk data endpoints).

![Figure 2.1: Dataset Scoping and Loaded Studies Panel](placeholder_dataset_studies_panel.png)  
*Figure 2.1: Study browser panel showing loaded multi-study datasets ready for download scoping.*

---

## 2. Modality Filtering

Medical imaging datasets frequently contain auxiliary or secondary series (e.g., dose reports, structured reports, key object selections, or secondary captures) alongside primary volumetric cross-sectional images. The Download Manager provides modality filtering to isolate relevant imaging data quickly.

![Figure 2.2: Modality Filter Selection Controls](placeholder_modality_filters.png)  
*Figure 2.2: Quick-filter buttons dynamically generated from available modalities in the loaded dataset.*

### Supported Modalities
The system inspects every series and categorizes it based on DICOM Modality (`0008,0600`) or SOP Class UID (`0008,0016`):

| Modality Code | Description | Typical Use Case |
| :--- | :--- | :--- |
| **CT** | Computed Tomography | Cross-sectional volumetric scans |
| **MR** | Magnetic Resonance | Cross-sectional anatomical & functional scans |
| **PT / PET** | Positron Emission Tomography | Nuclear medicine molecular imaging |
| **US** | Ultrasound | Dynamic 2D/3D acoustic imaging |
| **CR / DX** | Computed / Digital Radiography | Projection X-ray images |
| **MG** | Mammography | Breast X-ray imaging |
| **SR** | Structured Report | Radiation dose summary, CAD findings, measurements |
| **SEG** | Segmentation Object | 3D binary/fractional tissue segmentations |
| **PR** | Softcopy Presentation State | Display annotations, window level presets, ROIs |
| **DOC / OT** | Encapsulated PDF / Other | Scanned reports, clinical documents |

### Filter Operations
* **Single Modality Toggle**: Clicking a modality button (e.g., `CT`) isolates the selection to CT series only.
* **Filter Toggle Off**: Clicking the active modality button again clears the filter and selects all series.
* **Multi-Study Isolation**: Clicking a study header selects all series within that specific study while ignoring others.

---

## 3. Series List & Selection Controls

The **Series Selection Panel** renders a detailed hierarchical list of all available series grouped by study:

![Figure 2.3: Series List View with Checkboxes and Metadata](placeholder_series_list_view.png)  
*Figure 2.3: Detailed series list view displaying Series Description, Series Number, Modality badge, and Instance Count.*

### Selection Actions
* **Select All**: Selects 100% of available series across all loaded studies.
* **Clear Selection**: Deselects all series (Export button becomes disabled).
* **Per-Series Checkbox**: Toggles individual series inclusion.
* **Study Header Select**: Selects all series belonging to a specific Patient/Study.

---

## 4. Manifest Construction & Validation

Before download execution, the system passes selected series through `buildManifest()`. This process normalizes metadata, generates destination paths, and validates instance integrity.

```text
Selected Series
     │
     ▼
flattenSeries() ──► Extracts SOP Instances
     │
     ▼
buildManifest() ──► Validates SOPInstanceUID
     │              Generates Directory Hierarchy
     │              Sanitizes Path Characters
     │              Caps String Lengths (120 chars)
     ▼
Final Download Manifest Queue
```

### Missing SOP Instance UID Quarantine
If a DICOM instance returned by the PACS server lacks a valid `SOPInstanceUID` (`0008,0018`), the item is automatically **quarantined and excluded** from the manifest. A warning entry is written to the download log.

### Dynamic File & Byte Count Estimation
As selection state changes, the footer dynamically displays:
- **Total Selected Series**: e.g., `4 of 6 series`.
- **Total File Count**: Computed by summing valid SOP instances across selected series.
- **Estimated Size**: Calculated using image dimensions (`Rows * Columns * SamplesPerPixel * (BitsAllocated / 8) * NumberOfFrames`) or actual bulk metadata byte flags when available.

---

## Next Steps

- Proceed to **[03. DICOM Metadata Anonymization](./03-metadata-anonymization.md)** to configure DICOM header tag cleaning and privacy presets.
