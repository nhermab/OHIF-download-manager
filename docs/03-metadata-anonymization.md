# 03. DICOM Metadata Anonymization Guide

> **Author**: **Nick Hermans** (Medical Imaging Engineer, UZ Leuven — Information Technology and Data Department, PACS, eHealth HUB and Telematics team) — [`nick.hermans@uzleuven.be`](mailto:nick.hermans@uzleuven.be)  
> **Package**: `@ohif/extension-download-manager` (OHIF Viewer v3 Platform)

---

This document describes the DICOM header anonymization engine (`src/anonymizer.js`) within the OHIF Download Manager, detailing tag handling policies, built-in privacy profiles, tag whitelists, and audit provenance injection.

---

## 1. Anonymization Architecture & Compliance Standard

The metadata anonymization engine operates client-side on DICOM headers before storage writing. Tag transformation rules follow **DICOM Standard PS 3.15 Annex E (Basic Application Level Confidentiality Profile)**, drawing dictionary definitions and tag action mapping schemas from standard open-source tools including DicomCleaner™ (BSD License) and RSNA DICOM Anonymizer V18.0 (Apache License 2.0).

![Figure 3.1: Anonymization Engine Architecture Flow](placeholder_anonymizer_architecture.png)  
*Figure 3.1: Sequence flow of client-side DICOM header tag parsing, replacement, UID remapping, and rule validation.*

### De-identification Audit Provenance Injection
Whenever anonymization is enabled, the engine injects standard compliance metadata into exported DICOM headers per DICOM PS 3.15 Annex E:

* **`PatientIdentityRemoved (0012,0062)`**: Injected as `"YES"`.
* **`DeidentificationMethod (0012,0063)`**: Injected as a descriptive string array detailing applied methodology (e.g. `["OHIF_DOWNLOAD_MANAGER_BASIC_PROFILE", "DATES_SHIFTED"]`).
* **`DeidentificationMethodCodeSequence (0012,0064)`**: Injected with standard DICOM CID 7050 codes (e.g. `113100` for Basic Application Confidentiality Profile, `113107` for Retain Longitudinal Temporal Information Options).
* **`ContributingEquipmentSequence (0018,A001)`**: Appends software provenance details including manufacturer (`"UZ Leuven"`), software name (`"@ohif/extension-download-manager"`), version, and execution timestamp.

---

## 2. Built-in Privacy Presets

The Download Manager includes four pre-configured anonymization presets for research data sharing:

![Figure 3.2: Anonymization Presets Toolbar](placeholder_anonymizer_presets.png)  
*Figure 3.2: One-click anonymization presets bar located at the top of the Anonymizer panel.*

| Preset Name | ID | Behavior Summary | Target Risk Profile |
| :--- | :--- | :--- | :--- |
| **🛡️ Full Anonymization** | `strict` | **Strict Default**. Replaces patient demographics, remaps all UIDs, shifts dates per patient ID, removes clinical narrative text, strips physician names, and deletes all private vendor tags. | **Minimal PHI Risk** |
| **🔬 Research Profile** | `research` | Replaces patient demographics and shifts dates, but preserves acquisition parameters (kVp, slice thickness, repetition time), protocol names, and safe scanner vendor tags. | **Low PHI Risk** |
| **📅 Keep Dates & Clinical Text** | `retain_dates` | Replaces primary patient ID/Name and remaps UIDs, but retains original study dates, acquisition times, clinical study descriptions, and physician names. | **Moderate Risk** |
| **⚠️ Minimal Anonymization** | `preserve_all` | Overrides Patient Name and Patient ID only. Retains original DICOM UIDs, acquisition dates, equipment serial numbers, and all private vendor tags. | **High PHI Exposure Risk** |

---

## 3. Tabbed Configuration Breakdown

When anonymization is enabled, configuration options are organized across five functional tabs:

![Figure 3.3: Tabbed Anonymizer Configuration Interface](placeholder_anonymizer_tabs.png)  
*Figure 3.3: Tabbed interface for granular control over patient identifiers, dates, descriptors, vendor tags, and advanced policies.*

---

### Tab 1: Patient & Identifiers

Configures primary patient demographic overrides and DICOM UID remapping:

| Field | DICOM Tag | Target VR | Default Value | Description / Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Replacement Patient Name** | `(0010,0010)` | `PN` | `ANONYMOUS` | Overrides original patient full name string. |
| **Replacement Patient ID** | `(0010,0020)` | `LO` | `ANON1234` | Overrides medical record number / patient ID. |
| **Replacement Birth Date** | `(0010,0030)` | `DA` | `""` (Blank) | Optional fixed replacement birth date (`YYYYMMDD`). |
| **Replacement Patient Sex** | `(0010,0040)` | `CS` | `""` (Blank) | Overrides sex attribute (`M`, `F`, `O`, or blank). |
| **Replacement Accession Number** | `(0008,0050)` | `SH` | `""` (Blank) | Overrides order/accession tracking ID. |
| **Replacement Study Description** | `(0008,1030)` | `LO` | `""` (Blank) | Overrides study clinical description text. |
| **Replacement Series Description** | `(0008,103E)` | `LO` | `""` (Blank) | Overrides series description text. |
| **Generate New DICOM UIDs** | Multi-Tag | `UI` | `true` | Remaps `StudyInstanceUID`, `SeriesInstanceUID`, `SOPInstanceUID`, and `FrameOfReferenceUID` to deterministic `2.25.xxx` UUIDs. |

> [!WARNING]
> Disabling **Generate New DICOM UIDs** (`remapUids: false`) preserves original DICOM UIDs. UIDs generated by PACS hardware frequently embed hidden timestamps, MAC addresses, or serial numbers that can be cross-referenced to identify origin facilities or patients.

---

### Tab 2: Dates & Times

Controls date obfuscation and acquisition time retention:

* **Keep original study dates** (`keepDates`):
  * **Unchecked (Default)**: Shifts all study dates (`DA` VR attributes) by a consistent random offset calculated deterministically per Patient ID. Longitudinal temporal intervals between studies are preserved while concealing true calendar dates.
  * **Checked**: Preserves true original calendar dates.
* **Keep exact clock times** (`keepExactTimes`):
  * **Unchecked (Default)**: Clears exact acquisition time attributes (`TM` VRs, such as `AcquisitionTime`, `StudyTime`, `ContentTime`) to prevent cross-referencing against hospital EHR audit logs.
  * **Checked**: Retains true acquisition timestamps down to the second.

---

### Tab 3: Clinical & Descriptors

Controls clinical text descriptions, technical parameters, and patient age handling:

* **Keep study & series descriptions** (`keepDescriptors`): Retains text descriptions of procedures and acquisition protocols.
* **Keep series descriptions only** (`keepSeriesDescriptors`): Retains pulse sequence names (e.g. `"Axial T2 FRFSE"`) while clearing study-level clinical notes.
* **Keep physician and staff names** (`keepPhysicians`): Retains `ReferringPhysicianName` `(0008,0090)`, `PerformingPhysicianName` `(0008,1050)`, and `OperatorsName` `(0008,1070)`.
* **Keep technical imaging parameters** (`keepAcquisitionParameters`): Retains non-identifying scanner parameters: `KVP` `(0018,0600)`, `SliceThickness` `(0018,0050)`, `RepetitionTime` `(0018,0080)`, `EchoTime` `(0018,0081)`, `ContrastBolusAgent` `(0018,0010)`.
* **Keep graphic & ROI overlays** (`keepOverlays`): Retains vector graphics and ROI annotations stored in DICOM Group `60xx` overlay attributes.
* **Keep waveform & ECG curve data** (`keepCurves`): Retains physiological signals stored in DICOM Group `50xx`.
* **Age Grouping & Rounding**:
  * **Group ages over 89 as "90"** (`aggregateAgesOver89`): Enforces HIPAA Safe Harbor requirements aggregating all patient ages over 89 into a single category (`90Y`).
  * **Round patient age** (`roundAgeToYears`): Rounds patient age to nearest N years (default: `5` years).

---

### Tab 4: Vendor Tags & Custom Tag Whitelist

Manages private DICOM group tags and attribute-level exemptions:

![Figure 3.4: Vendor Tag Policy and Whitelist Interface](placeholder_tag_whitelist_tab.png)  
*Figure 3.4: Selection dropdown for Private Tag Policy and custom DICOM tag whitelist editor.*

#### Private Vendor Tags Policy (`privateTagsPolicy`)
Private tags are manufacturer-specific attributes stored in odd-numbered DICOM groups (e.g., GE, Siemens, Philips custom fields):
1. **Remove All Private Vendor Tags (`remove_all`) — Default**: Deletes all odd-group tags (`group % 2 !== 0`).
2. **Keep Safe Scanner Vendor Tags (`keep_safe`)**: Retains non-identifying quantitative private attributes essential for post-processing (such as SUV body weight scale factors, CT radiation dose index, or MR diffusion b-value tables).
3. **Keep ALL Private Vendor Tags (`keep_all`)**: Retains all private vendor tags without filtering (caution: proprietary shadow groups may contain raw technician notes or patient identifiers).

#### Custom Tag Whitelist
Allows users to specify explicit 8-character hexadecimal DICOM tags (e.g. `00100040` for Patient Sex or `0008103E` for Series Description) to exempt them from anonymization deletion.

---

### Tab 5: Advanced Settings

Configures special object handling and equipment identity:

* **Structured Report (SR) Policy** (`structuredContentPolicy`):
  * **Remove (`remove`) — Default**: Strips SR text content items to eliminate free-text narrative PHI.
  * **Sanitize (`sanitize`)**: Retains SR structure while performing regex sanitization on recognized patient names and dates in text strings.
* **Keep hospital & institution identity** (`keepInstitutionIdentity`): Retains `InstitutionName` `(0008,0080)`, `InstitutionAddress` `(0008,0081)`, and `InstitutionalDepartmentName` `(0008,1040)`.
* **Keep scanner & equipment identity** (`keepDeviceIdentity`): Retains `StationName` `(0008,1010)`, `DeviceSerialNumber` `(0018,1000)`, and `ManufacturerModelName` `(0008,1090)`.
* **Reject encapsulated document files** (`rejectEncapsulatedDocuments`): Blocks export of DICOM instances containing embedded PDF, CDA, or XML documents (`SOPClassUID = 1.2.840.10008.5.1.4.1.1.88.11` or `.59`).

---

## 4. Non-Default Setting Alert Banner

Whenever an anonymization profile deviates from strict defaults (for example, preserving original dates, keeping physician names, or retaining private vendor tags), the Download Manager displays a **Yellow Alert Banner**:

![Figure 3.5: Non-Default Settings Warning Banner](placeholder_anonymizer_warning_banner.png)  
*Figure 3.5: Warning indicator alerting the user that current custom settings expose potential PHI fields.*

* **Active PHI Risk Summary**: Lists every setting that exposes potential PHI.
* **Restore Strict Defaults Button**: Single-click action to immediately reset all fields back to `DEFAULT_ANONYMIZER_CONFIG`.

---

## Next Steps

- Proceed to **[04. Burned-in Pixel Redaction & Limitations](./04-pixel-redaction-and-limitations.md)** for an overview of optical character recognition pixel text redaction.
