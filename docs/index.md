# OHIF Download Manager — Technical Documentation Suite

> **Author**: **Nick Hermans** (Medical Imaging Engineer)  
> **Institution**: **UZ Leuven** (University Hospitals Leuven, Information Technology and Data Department — PACS, eHealth HUB and Telematics team)  
> **Contact**: [`nick.hermans@uzleuven.be`](mailto:nick.hermans@uzleuven.be)  
> **Package**: `@ohif/extension-download-manager` (OHIF Viewer v3 Platform)

---

Welcome to the technical documentation suite for `@ohif/extension-download-manager`. This extension provides client-side DICOM dataset selection, batch exporting, PS 3.15 header anonymization, optical pixel text redaction, and memory-safe streaming storage writers for the OHIF Viewer.

---

## Documentation Guides

| Guide | Description | Target Audience |
| :--- | :--- | :--- |
| **[01. Overview & Quickstart](./01-overview-and-quickstart.md)** | System architecture, UI toolbar integration, export workflow, and operational modes. | All Users, Radiologists, Technologists |
| **[02. Dataset Selection & Filtering](./02-dataset-selection-and-filtering.md)** | Multi-study scoping, modality filtering, SOP instance validation, and manifest queueing. | Clinical Researchers, Data Curators |
| **[03. Metadata Anonymization](./03-metadata-anonymization.md)** | DICOM PS 3.15 Annex E tag rules engine, privacy presets, tag whitelists, and provenance injection. | Privacy Officers, Data Managers |
| **[04. Pixel Redaction & Technical Limitations](./04-pixel-redaction-and-limitations.md)** | Micro-OCR engine, Stroke-Width Transform (SWT) edge topology filtering, WebAssembly codecs, and safety boundaries. | Compliance Officers, Researchers |
| **[05. Storage Writers & Troubleshooting](./05-storage-directory-layout-troubleshooting.md)** | Direct Folder streaming, OPFS/IndexedDB ZIP streaming, neutral directory layout, and troubleshooting. | IT / PACS Admins, System Integrators |
| **[06. UI States, Messages, Failures & Retry Flows](./06-ui-error-and-retry-flows.md)** | UI surface map, modal state machine, error classification tree, retry and cancellation flows, message inventory. | UX, Support, Front-end Engineers |

> **Improvement backlog**: [`UI-shortcomings.md`](../UI-shortcomings.md) documents how error handling, retries, and notifications in the user interface should be improved. It is the UX counterpart to the safety/conformance audit in [`SHORTCOMINGS.md`](../SHORTCOMINGS.md).

---

## Core Capabilities & Technical Architecture

* **100% Client-Side Processing**: Operates entirely inside the web browser session. No DICOM instances or metadata are transmitted to external servers or cloud services.
* **DICOM PS 3.15 Annex E Compliance**: Implements the Basic Application Level Confidentiality Profile and injects standard audit provenance tags (`PatientIdentityRemoved`, `DeidentificationMethod`, `DeidentificationMethodCodeSequence`, `ContributingEquipmentSequence`).
* **In-Browser WebAssembly Transcoding**: Decodes and re-encodes encapsulated compressed pixel data (JPEG 2000, JPEG-LS, HTJ2K, RLE Lossless, JPEG Baseline/Lossless) using WebAssembly DICOM codecs.
* **Neutral Directory Layout & Integrity Checks**: Exports datasets using non-identifying paths (`dataset/Patient_<StudyUID_suffix>/...`) accompanied by `export-manifest.json` and cryptographic `checksums.sha256` integrity files.

---

## System Requirements & Browser Support

| Feature | Google Chrome / Microsoft Edge | Mozilla Firefox | Apple Safari |
| :--- | :--- | :--- | :--- |
| **DICOM Export & Zip Streaming** | Supported (OPFS / IndexedDB) | Supported (IndexedDB) | Supported (IndexedDB) |
| **Direct Folder Streaming** | Supported (File System Access API) | Zip Streaming Fallback | Zip Streaming Fallback |
| **DICOM PS 3.15 Header Anonymization** | Supported | Supported | Supported |
| **Micro-OCR Pixel Text Redaction** | Supported | Supported | Supported |
| **WASM Codec Transcoding** | Supported | Supported | Supported |

---

## Limitation of Liability & Legal Disclaimer

Licensed under the **MIT License**.

> **DISCLAIMER**: THIS SOFTWARE AND DOCUMENTATION ARE PROVIDED **"AS IS"**, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. 
> 
> IN NO EVENT SHALL THE AUTHOR (**NICK HERMANS**), **UZ LEUVEN** (UNIVERSITY HOSPITALS LEUVEN), OR ANY CONTRIBUTORS / COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, DATA LOSS, PRIVACY BREACH, REGULATORY NON-COMPLIANCE, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## Navigation

- Next: **[01. Overview & Quickstart](./01-overview-and-quickstart.md)**

