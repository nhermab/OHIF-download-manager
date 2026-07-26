# OHIF Download Manager — User & Technical Documentation

> **Author**: **Nick Hermans** (Medical Imaging Engineer, UZ Leuven — Information Technology and Data Department, PACS, eHealth HUB and Telematics team) — [`nick.hermans@uzleuven.be`](mailto:nick.hermans@uzleuven.be)  
> **Package**: `@ohif/extension-download-manager` (OHIF Viewer v3 Platform)

---

Welcome to the official user and technical documentation suite for the **OHIF Download Manager Extension** (`@ohif/extension-download-manager`).

This documentation describes the architecture, dataset selection, metadata anonymization, pixel redaction safeguards, and streaming storage writer implementation.

---

## Documentation Structure

| Guide | Description | Target Audience |
| :--- | :--- | :--- |
| **[01. Overview & Quickstart](./01-overview-and-quickstart.md)** | Core concepts, browser requirements, UI navigation, and step-by-step export workflow. | All Users, Radiologists, Technologists |
| **[02. Dataset Selection & Filtering](./02-dataset-selection-and-filtering.md)** | Selecting studies and series, filtering by imaging modality, file count estimation, and dataset scoping. | Clinical Researchers, Data Curators |
| **[03. DICOM Metadata Anonymization](./03-metadata-anonymization.md)** | Client-side metadata anonymization controls and limitations. | Privacy Officers, Data Managers |
| **[04. Burned-in Pixel Redaction & Limitations](./04-pixel-redaction-and-limitations.md)** | Client-side pixel processing limitations; not a Clean Pixel Data claim. | Compliance Officers, Researchers |
| **[05. Storage Writers, Directory Layout & Troubleshooting](./05-storage-directory-layout-troubleshooting.md)** | Current single-ZIP output, neutral paths, and troubleshooting. | IT / PACS Admins, System Integrators |

---

## High-Level Capabilities & Product Reality

> [!IMPORTANT]
> **Product boundary**  
> The Download Manager operates **100% client-side** and supports identified export and
> approved client-side metadata anonymization. Unsupported/ambiguous pixel processing
> fails closed; no Clean Pixel Data or confidentiality-profile conformance is claimed.

---

## System Requirements & Browser Compatibility

| Feature | Google Chrome / Microsoft Edge | Mozilla Firefox | Apple Safari |
| :--- | :--- | :--- | :--- |
| **DICOM Export & Zip Download** | Supported | Supported | Supported |
| **Single ZIP Download** | Supported | Supported | Supported |
| **Direct Folder Streaming** | Unavailable | Unavailable | Unavailable |
| **Client-side Metadata Anonymization** | Supported with limitations | Supported with limitations | Supported with limitations |
| **Browser OCR Pixel Redaction** | Supported with fail-closed limitations | Supported with fail-closed limitations | Supported with fail-closed limitations |

---

## Quick Navigation

- Next: **[01. Overview & Quickstart](./01-overview-and-quickstart.md)**
