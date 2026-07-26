# 02. Dataset Selection & Filtering Guide

> **Author**: **Nick Hermans** (Medical Imaging Engineer, UZ Leuven — Information Technology and Data Department, PACS, eHealth HUB and Telematics team) — [`nick.hermans@uzleuven.be`](mailto:nick.hermans@uzleuven.be)  
> **Package**: `@ohif/extension-download-manager` (OHIF Viewer v3 Platform)

---

This document details how the Download Manager extracts study metadata from the OHIF Viewer context, filters series by imaging modality and study, validates DICOM SOP instances, and constructs pre-flight export manifests.

---

## 1. Study Context & Data Payload

When launched, the Download Manager inspects the active viewer state through OHIF's `DisplaySetService` and `DicomMetadataStore`. It aggregates all patient studies currently loaded into the active viewport session.

### Context Extraction
- **Multi-Study & Multi-Series Scoping**: Captures single studies as well as multi-study comparison sessions (e.g. prior vs. current follow-up scans).
- **Series Metadata**: Parses Series Description, Series Number, Modality, SOP Class UID, and instance counts.
- **DICOMweb Endpoint Mapping**: Maps SOP Instance UIDs to their raw DICOMweb retrieve URLs (WADO-RS / bulk data endpoints) using active session authorization tokens.

![Figure 2.1: Dataset Scoping and Loaded Studies Panel](placeholder_dataset_studies_panel.png)  
*Figure 2.1: Study selection tree showing loaded multi-study datasets ready for download scoping.*

---

## 2. Modality Quick-Filtering

Medical imaging datasets frequently contain auxiliary or non-image series (such as dose reports, structured reports, presentation states, or secondary captures) alongside primary volumetric scans. The Download Manager provides modality quick-filters to isolate target series immediately.

![Figure 2.2: Modality Filter Selection Controls](placeholder_modality_filters.png)  
*Figure 2.2: Quick-filter buttons dynamically generated from available modalities in the loaded dataset.*

### Supported Modalities
The system inspects every series and categorizes it based on DICOM Modality (`0008,0600`) or SOP Class UID (`0008,0016`):

| Modality Code | Description | Typical Content |
| :--- | :--- | :--- |
| **CT** | Computed Tomography | Cross-sectional volumetric image series |
| **MR** | Magnetic Resonance | Anatomical, functional, and spectroscopic series |
| **PT / PET** | Positron Emission Tomography | Molecular nuclear medicine scans |
| **US** | Ultrasound | 2D/3D acoustic image series and Doppler loops |
| **CR / DX** | Computed / Digital Radiography | Projection X-ray images |
| **MG** | Mammography | Breast projection and tomosynthesis images |
| **SR** | Structured Report | Radiation dose summaries, CAD findings, measurements |
| **SEG** | Segmentation Object | 3D binary and fractional tissue segmentations |
| **RTSTRUCT** | Radiotherapy Structure Set | Contour overlays and treatment planning volumes |
| **PR** | Softcopy Presentation State | Display annotations, window level presets, ROIs |
| **DOC / OT** | Encapsulated PDF / Other | Scanned reports and clinical documents |

### Filter Operations
* **Modality Toggle**: Clicking a modality button (e.g. `CT`) filters the selection tree to show only series matching that modality.
* **Toggle Off**: Clicking an active modality button again clears the filter and restores full series visibility.
* **Study Isolation**: Clicking a study header selects or deselects all series belonging to that specific study.

---

## 3. Series Selection Controls

The **Series Selection Panel** renders a detailed hierarchical tree of all available series grouped by study:

![Figure 2.3: Series List View with Checkboxes and Metadata](placeholder_series_list_view.png)  
*Figure 2.3: Series list view displaying Series Description, Series Number, Modality badge, and Instance Count.*

### Selection Actions
* **Select All**: Selects 100% of available series across all loaded studies.
* **Clear Selection**: Deselects all series (the Export action is disabled until at least one series is selected).
* **Per-Series Checkbox**: Toggles individual series inclusion.
* **Study Checkbox**: Selects or deselects all series under a specific study.

---

## 4. Pre-flight Validation & Manifest Construction

Before download execution, selected series are processed through `buildManifest()` in `src/manifest.js`. This function normalizes metadata, generates OS-safe neutral directory paths, and pre-validates SOP instances.

```text
Selected Series
     │
     ▼
flattenSeries() ──► Extracts SOP Instance UIDs & WADO-RS URLs
     │
     ▼
buildManifest() ──► Validates SOPInstanceUID (Quarantines invalid items)
     │              Generates Neutral Directory Hierarchy
     │              Sanitizes Path Characters & Caps Segment Lengths
     ▼
Final Download Queue & Manifest
```

### SOP Instance Quarantine
If a DICOM instance returned by PACS metadata lacks a valid `SOPInstanceUID` (`0008,0018`), the item is automatically **quarantined and excluded** from the manifest queue to prevent broken exports. A diagnostic entry is written to `export-manifest.json`.

### Dynamic Estimation
As selection state changes, the interface footer dynamically calculates:
- **Selected Series**: e.g., `4 of 6 series`.
- **Total Instance Count**: Calculated by summing valid SOP instances across all selected series.
- **Estimated Size**: Computed using image frame attributes (`Rows * Columns * SamplesPerPixel * (BitsAllocated / 8) * NumberOfFrames`) or actual byte header tags when reported by DICOMweb.

---

## Next Steps

- Proceed to **[03. DICOM Metadata Anonymization](./03-metadata-anonymization.md)** to configure header tag cleaning and privacy presets.
