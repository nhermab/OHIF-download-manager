# Download Manager Safety, Privacy, and DICOM Compliance Audit & Technical Reference

**Package:** `@ohif/extension-download-manager` (OHIF Viewer v3 Platform)  
**Author:** **Nick Hermans** (Medical Imaging Engineer, UZ Leuven — Information Technology and Data Department, PACS, eHealth HUB and Telematics team) — [`nick.hermans@uzleuven.be`](mailto:nick.hermans@uzleuven.be)  
**Audit date:** 2026-07-25  
**Scope:** `extensions/download-manager` as present in this working tree  
**Audience:** engineering, clinical safety, security/privacy, research governance, quality, and regulatory/compliance teams  

## Release conclusion

The extension is **not ready to be relied on as a medical-grade de-identifier or as the sole control preventing disclosure of identifiable health information**. It should not claim DICOM Basic Application Level Confidentiality Profile conformance, “Full Anonymization,” or verified Clean Pixel Data at this time.

There are multiple release-blocking failure modes:

- some compressed images can be written with RLE bytes while retaining a JPEG Transfer Syntax UID;
- OCR/decode failures and partial multi-frame scans can still result in `BurnedInAnnotation = NO` and Clean Pixel Data provenance;
- multi-frame redaction can apply every detected box to every frame, altering unrelated diagnostic pixels;
- Structured Report content and other required clinical structures can be deleted without SOP/IOD-aware validation;
- failed instances are omitted while the UI still reports “Download Complete”;
- retrieved or reconstructed payloads are not verified to be the requested DICOM instances.

Until the blocker findings below are closed and independently verified, the safe deployment posture is to disable anonymization claims and restrict this extension to explicitly authorized, identified-data export in a controlled environment. If identified export is not an approved intended use, disable the extension entirely.

## Remediation status — 2026-07-25

This approved deployment enables the **client-side anonymization workflow**. The UI and
downloader are enabled again, while the client-side fail-closed constraints documented
below remain in force: unsupported pixel organization/fragmentation aborts processing,
and no unverified Clean Pixel Data or profile provenance is emitted.

Supported-export controls added in this change:

- DM-008: any failed requested instance aborts the archive and produces an incomplete
  error rather than a completion state; ZIP parts are not emitted before finalization.
  Final ZIPs contain a requested/written-instance manifest and SHA-256 digest list.
- DM-009: DICOM media type, parseability, and Study/Series/SOP Instance UID identity
  are verified before a file is written.
- DM-019/020: direct folder output is disabled pending transactional staging; one active
  export is enforced and `onModeExit` cancels active work.
  ZIP temporary storage is retained for the document lifetime and reclaimed by orphan
  cleanup on a later export, so browser download consumers cannot race deletion of
  OPFS/IndexedDB-backed archive data.
- DM-021/022: `enabled: false` prevents registration/commands, and the extension no
  longer replaces the host toolbar section.
- DM-023/025/026: the UI requires an identified-PHI acknowledgement, no longer persists
  anonymization settings in the supported workflow, uses non-identifying paths, and
  caps concurrency at three.
- DM-024: malformed DICOM UIDs are rejected instead of silently accepted.
- Export failures retain the per-instance transfer log in the final error view so the
  user can read and copy the underlying cause instead of only seeing the aggregate count.
- DM-030: README and operator documentation now state the supported boundary.
  Legacy documentation index, feature descriptions, storage descriptions, and directory
  examples were updated to remove contradictory anonymization, direct-folder, and PHI-path claims.

Client-only anonymization hardening added after this audit:

- DM-001: `encodeDicomFrame` no longer falls back to RLE for an unsupported
  requested transfer syntax. It returns failure, allowing the caller to use its
  explicit uncompressed representation path rather than mislabel bytes.
- DM-002: no-OCR-findings no longer change `BurnedInAnnotation` to `NO` or report
  a successful redaction. The result carries `verifiedClean: false` and preserves
  the original annotation state.
- DM-003: a finding is applied only to its own `frameIndex`; it is no longer copied
  to every frame of a multi-frame object.
  The default client-only multi-frame mode now scans every frame and does not offer a
  browser-dialog fallback to sparse sampling.
- DM-004: the client now rejects ambiguous encapsulated fragment layouts and populated
  Basic Offset Tables instead of assigning fragments to frames by index. The currently
  supported client-only layout is explicitly limited to an empty BOT with one fragment
  per frame; other layouts remain unsupported rather than being misprocessed.
- DM-005: the client redactor rejects unvalidated pixel organizations before it
  modifies image data, instead of attempting best-effort decoding.
- DM-017: verbose OCR/pixel logging is opt-in rather than enabled by default.
  OCR fallback failures are also silent by default and never log recognized text.
- DM-024: the UI now preflights every selected instance and blocks export with an
  explicit omission message when a downloadable source or Study/Series/SOP UID is
  missing or malformed; the downloader enforces the same check for direct callers.
- DM-026: retries are limited to transient network failures and HTTP 408/429/5xx,
  with bounded exponential backoff and `Retry-After` support. Parse, validation,
  codec, storage, and other deterministic failures now fail immediately.
- DM-006: when client-side pixel processing does not return an independently
  verified-clean result, the anonymizer now removes `PatientIdentityRemoved` and
  De-identification Method provenance fields rather than asserting Basic Profile
  or Clean Pixel Data conformance.

### Correctness fixes — 2026-07-27

These close specific defects listed under the findings below. They narrow the
findings; they do not close them, because the external conformance, pixel-integrity,
and OCR-performance evidence those findings also require is still absent.

- DM-011 (partial): `encapsulateFrameBuffers` now pads every Pixel Data fragment
  to an even Item length. Odd-length codec output previously produced an invalid
  encapsulated Pixel Data element (PS3.5 7.5, A.4). The offset-table and
  round-trip pixel-verification parts of DM-011 remain open.
- DM-005 (partial): the maximum stored pixel value is no longer computed with
  `1 << bitsStored`. That 32-bit signed shift is negative at 31 bits and wraps to
  `1` at 32, which corrupted the MONOCHROME1 fill value and the redaction clamp
  for wide stored representations.
- DM-005 (partial): RLE Lossless segment handling was generalised to the PS3.5
  G.2 model — segments ordered by sample, most significant byte first. The
  previous 16-bit branch ignored `SamplesPerPixel`, so 16-bit colour was both
  decoded and encoded incorrectly. The last segment is now bounded by the end of
  the fragment instead of by a 17th offset-table entry that does not exist, and
  `encodeRLEFrame` rejects pixel organizations needing more than 15 segments
  rather than emitting a truncated header. The wider unsupported-pixel-format
  matrix in DM-005 remains open.
- DM-027 (partial): codec load, decode, and encode failures are recorded in a
  bounded, PHI-free diagnostics buffer instead of being swallowed by empty catch
  blocks, and the reason is appended to the operator-visible "pixel redaction
  skipped" warning. A caller can now distinguish an absent codec package from a
  corrupt bitstream. Console output remains opt-in per DM-017. Build-time codec
  presence checks and the transfer-syntax conformance matrix remain open.
- DM-016 (partial): video and other non-DICOM payloads are still exported, but
  are no longer bypassed silently. Each is logged as `Not anonymized`, added to
  the summary warning list, and recorded under `notAnonymized` in
  `export-manifest.json` alongside an `anonymizationRequested` flag. The
  blocking preflight for unsupported objects remains open.

Test evidence added with these fixes: `src/dicom-codecs.test.js` (fragment
padding, RLE round-trips for 16-bit monochrome, 8-bit colour, and 16-bit colour,
segment-count rejection, final-segment bounding, and diagnostics behaviour) and a
DM-016 case in `src/downloader.test.js`. The suite is 9 files and 68 tests.

DM-011, DM-012, DM-013, DM-014, DM-015, DM-018, DM-028, and DM-029 require an
organization-governed validated de-identification/export service, authorization/audit
integration, and quality-system evidence. They cannot truthfully be closed by a
browser extension; they are explicitly out of the supported functionality until such
an independently verified system is integrated.

This is a source-code audit, not a certification, privacy determination, penetration test, or complete ISO 14971 risk analysis. Medical-device status and applicable legal requirements depend on intended use and jurisdiction.

## Severity model

| Severity | Meaning |
| --- | --- |
| **Blocker** | Credible path to PHI disclosure, silent diagnostic-data corruption, invalid DICOM, or materially misleading safety state. Do not release the affected function. |
| **High** | Serious interoperability, privacy, completeness, authorization, or operational-safety gap requiring closure before clinical/research production use. |
| **Medium** | Important robustness, maintainability, usability, or evidence gap that can contribute to harm. |
| **Low** | Quality issue with limited direct safety impact. |

## Findings register

| ID | Severity | Finding |
| --- | --- | --- |
| DM-001 | **Blocker** | JPEG-family inputs can be re-encoded as RLE but labeled with the original JPEG Transfer Syntax |
| DM-002 | **Blocker** | Clean Pixel Data and `BurnedInAnnotation = NO` can be asserted without proving pixel PHI was removed |
| DM-003 | **Blocker** | Multi-frame redaction applies findings to the wrong frames and can erase diagnostic pixels |
| DM-004 | **Blocker** | Encapsulated frame extraction does not implement general DICOM fragmentation/offset rules |
| DM-005 | **Blocker** | Pixel decoding and redaction support only a narrow subset of valid DICOM pixel organizations |
| DM-006 | **Blocker** | De-identification provenance can make false claims about the options and operations actually performed |
| DM-007 | **Blocker** | The rules engine is not IOD-aware and can create invalid or clinically unusable SOP Instances |
| DM-008 | **Blocker** | Incomplete exports are finalized and presented as complete |
| DM-009 | **High** | Downloaded payload identity, media type, and DICOM validity are not verified |
| DM-010 | **High** | Static WADO reconstruction guesses the transfer syntax and pixel representation |
| DM-011 | **High** | Re-encoding lacks pixel-integrity verification and correct lossy-compression/derivation accounting |
| DM-012 | **High** | UID, date, and patient pseudonym consistency is not governed across exports |
| DM-013 | **High** | The runtime confidentiality profile is unversioned and can drift behind the DICOM Standard |
| DM-014 | **High** | Three divergent rule artifacts create configuration-control and review ambiguity |
| DM-015 | **High** | OCR is unvalidated, language-limited, and has no mandatory human verification gate |
| DM-016 | **High** | Identified MP4/video exports bypass anonymization without a blocking warning |
| DM-017 | **High** | PHI and OCR results can be written to browser logs by default |
| DM-018 | **High** | Export authorization, purpose, consent/policy, and audit-event controls are absent |
| DM-019 | **High** | Temporary PHI and partial output are not transactionally cleaned up |
| DM-020 | **High** | Cancellation, navigation, and concurrent-export lifecycle behavior is unsafe |
| DM-021 | **High** | Administrative disablement does not control the registered OHIF extension |
| DM-022 | **High** | The extension can replace the host application's primary toolbar section |
| DM-023 | **High** | Unsafe settings persist across browser users and the UI overstates protection |
| DM-024 | **High** | Manifest construction can silently omit instances and accepts malformed UIDs |
| DM-025 | **Medium** | Patient identifiers are exposed in output directory names |
| DM-026 | **Medium** | Retry and parallelism policy can overload the PACS, browser, and workstation |
| DM-027 | **High** | Codec dependencies and failure behavior are not reproducible or fail-closed |
| DM-028 | **High** | Conformance, safety-lifecycle, usability, and cybersecurity evidence is insufficient |
| DM-029 | **High** | Automated tests do not establish de-identification, IOD, pixel, or end-to-end export safety |
| DM-030 | **Medium** | Documentation marks unverified safety work as resolved and conflicts with runtime behavior |

## Detailed findings

### DM-001 — RLE data may be labeled as JPEG (**Blocker**)

**Evidence**

- [`encodeDicomFrame`](src/dicom-codecs.js#L412) has explicit encoder branches for RLE, JPEG-LS, JPEG 2000, and HTJ2K, but no encoder branch for JPEG Baseline, JPEG Extended, or JPEG Lossless.
- Its final fallback calls [`encodeRLEFrame`](src/dicom-codecs.js#L506).
- The caller accepts any non-empty result and retains the requested/original transfer syntax in [`pixel-redactor.js`](src/pixel-redactor.js#L350).

For an original JPEG Baseline or JPEG Lossless instance, the resulting Pixel Data can therefore contain an RLE bitstream while File Meta Information continues to declare a JPEG Transfer Syntax UID. This is an invalid representation. Receivers may reject it, misdecode it, or display incorrect pixels.

**Required control and evidence**

- Remove all codec fallbacks across transfer-syntax families.
- Return a typed, fatal “encoder unavailable” result unless the exact requested syntax is encoded.
- Alternatively, explicitly transcode to RLE and update `(0002,0010)` and all representation-dependent metadata.
- Validate the output with at least two independent DICOM implementations and compare every decoded output frame against the intended redacted frame.

This conflicts with DICOM PS3.5, which assigns distinct UIDs to distinct JPEG coding processes and requires the encapsulated stream to match that process: [PS3.5 A.4](https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_A.4.html).

### DM-002 — Clean Pixel Data can be asserted without proof (**Blocker**)

**Evidence**

- Pixel scanning is skipped unless `BurnedInAnnotation` is recognized as affirmative or `forceIgnoreBurnedInAnnotation` is enabled: [`pixel-redactor.js`](src/pixel-redactor.js#L44).
- Missing pixel data/dimensions and unsupported cases return without a verified clean result.
- A scan with no OCR finding sets `BurnedInAnnotation` to `NO`: [`pixel-redactor.js`](src/pixel-redactor.js#L238).
- Sampling mode scans only selected frames, not all frames: [`pixel-redactor.js`](src/pixel-redactor.js#L174).
- The de-identification code advertises CID 7050 code `113101` whenever pixel redaction is enabled, regardless of whether scanning ran or succeeded: [`anonymizer.js`](src/anonymizer.js#L241).

Absence of an OCR detection is not evidence of absence of PHI. An absent/unknown `BurnedInAnnotation` value is also not proof that pixels are clean. The code conflates “attempted,” “no text recognized,” and “verified clean.”

**Required control and evidence**

- Represent pixel processing with explicit states such as `not_applicable`, `not_scanned`, `scan_failed`, `review_required`, and `verified_clean`.
- Set `BurnedInAnnotation = NO` and add `113101` only after every applicable stored-pixel frame passes a validated process.
- Treat unknown annotation status, decoder/OCR failure, unsupported pixel organization, and unscanned frames as fatal when Clean Pixel Data is claimed.
- Require human review for modalities and objects in the validated risk policy, and record the reviewer/action.

DICOM requires identifying pixel information to actually be removed; it notes that human intervention or approval may be necessary: [PS3.15 E.3.1](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_E.3.html).

### DM-003 — Multi-frame boxes are applied to every frame (**Blocker**)

**Evidence**

[`pixel-redactor.js`](src/pixel-redactor.js#L281) filters redaction findings with:

```js
item => item.frameIndex === f || numberOfFrames > 1
```

For every multi-frame object, `numberOfFrames > 1` is always true. Every detected box is consequently painted into every frame, even when the text or anatomy occurs only in another frame. This can erase clinically significant pixels and does not prove that unscanned frames are free of PHI.

**Required control and evidence**

- Apply only findings belonging to the current frame.
- If a region is intentionally propagated, make that a separately validated tracking operation with bounded geometry and reviewer confirmation.
- Add tests with moving anatomy and frame-specific text, then assert exact pixel changes and zero changes outside the approved masks.
- Preserve a mask audit artifact without retaining recognized PHI text.

### DM-004 — Encapsulated frames are assembled incorrectly (**Blocker**)

**Evidence**

- [`getFrameBuffer`](src/pixel-redactor.js#L403) assumes a direct fragment-to-frame relationship.
- DICOM permits one frame to span multiple fragments for several transfer syntaxes; Basic or Extended Offset Tables identify frame boundaries.
- Decode errors are logged and processing can continue with an allocated/empty frame buffer.

This can decode the wrong bytes, omit fragments, associate a fragment with the wrong frame, or redact a fabricated blank image while preserving the original encoded pixels.

**Required control and evidence**

- Use a standards-tested encapsulated pixel parser that handles empty/populated Basic Offset Tables, Extended Offset Tables, multiple fragments per frame, and syntax-specific fragmentation.
- Make any frame-boundary ambiguity or decode error fatal to pixel-clean claims.
- Test single/multi-frame instances with empty BOT, populated BOT, extended offsets, and multiple fragments per frame.

See [PS3.5 A.4](https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_A.4.html) and [PS3.5 A.4.2 RLE](https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_a.4.2.html).

### DM-005 — Valid DICOM pixel formats are mishandled (**Blocker**)

**Evidence**

The redactor largely treats pixels as 8-bit or 16-bit scalar arrays and color as interleaved three-sample RGB. It does not correctly cover, among other cases:

- Explicit VR Big Endian;
- 1-bit Segmentation Pixel Data;
- 32-bit integer, Float Pixel Data, or Double Float Pixel Data;
- signed samples, arbitrary `HighBit`, and stored-value normalization;
- planar color;
- YBR full/partial and subsampled color;
- palette color and other photometric interpretations.

Bit-depth calculations using `1 << bitsStored` are unsafe at larger widths. The custom 16-bit color RLE segment indexing is also incomplete. Unsupported forms do not consistently fail closed.

**Required control and evidence**

- Define and enforce a narrow, explicit supported-input matrix.
- Reject every unvalidated combination before changing metadata or provenance.
- Prefer established DICOM pixel pipelines rather than parallel custom decoding logic.
- Verify decoded pixels, mask application, re-encoding, photometric interpretation, and rendering across the supported matrix.

### DM-006 — De-identification provenance is not truthful (**Blocker**)

**Evidence**

- [`buildDeidentificationMethodCodeSequence`](src/anonymizer.js#L203) always declares remapped UIDs and modified dates, including when the related options retain them.
- The text method likewise states that UIDs were remapped and dates modified: [`anonymizer.js`](src/anonymizer.js#L254).
- `113101` Clean Pixel Data is based on enablement, not a successful per-instance result.
- `PatientIdentityRemoved = YES` and the method fields are written unconditionally after processing: [`anonymizer.js`](src/anonymizer.js#L694).
- Whitelists and retention options can deliberately preserve identifying attributes.
- Original File Meta implementation identity is retained while only the version name is changed. DICOM requires File Meta Information and preamble to describe the de-identifying application.

These tags are safety- and compliance-relevant declarations, not informational badges. A receiver cannot distinguish a verified profile from a partial or failed attempt.

**Required control and evidence**

- Build provenance from an immutable, per-instance execution result, not requested options.
- Use the exact applicable CID 7050 codes, including the correct retain-dates/UID options.
- Do not set `PatientIdentityRemoved = YES` after warnings, unsupported content, or unverified pixel handling.
- Replace the preamble and all File Meta implementation information with the de-identifier's registered values.
- Add negative tests proving that no claim is emitted for partial or failed processing.

See [PS3.15 Annex E](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html) and [CID 7050](https://dicom.nema.org/medical/dicom/current/output/chtml/part16/sect_CID_7050.html).

### DM-007 — No SOP/IOD-aware de-identification validation (**Blocker**)

**Evidence**

- The rules walker applies a global action by tag and does not know the SOP Class, module, attribute Type, or conditional requirements.
- `Content Sequence (0040,A730)` is removed, while the DICOM Basic Profile action is `D` and the Clean Structured Content option is `C`.
- `Segment Sequence (0062,0002)` and its coded property sequences are removed. These are fundamental to Segmentation objects.
- Generic coded content fields such as `Code Value`, `Coding Scheme Designator`, and `Code Meaning` are removed globally.
- No post-operation IOD validator runs before the file is saved.

DICOM action codes are type-sensitive (`D`, `Z`, `X`, `K`, `C`, `U`, and conditional variants). Blind deletion can violate Type 1/2 requirements or destroy the clinical meaning of SR, SEG, RT, presentation-state, waveform, and other non-simple-image objects.

**Required control and evidence**

- Implement the normative PS3.15 action table with profile/option semantics and SOP/IOD type awareness.
- Explicitly scope supported SOP Classes; reject unsupported classes rather than emit damaged objects.
- Handle SR, SEG, RT, encapsulated documents, waveforms, and presentation states with dedicated policies.
- Validate every output against the applicable IOD and test cross-instance references.

The normative action model and the `Content Sequence` requirement are in [PS3.15 Annex E](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html).

### DM-008 — Partial exports are shown as complete (**Blocker**)

**Evidence**

- Per-file errors are counted and the loop continues: [`downloader.js`](src/downloader.js#L388).
- The writer is finalized even when `failed > 0`.
- [`DownloadSummaryView.tsx`](src/components/DownloadSummaryView.tsx#L18) shows the green success treatment and “Download Complete” unless a terminal error object exists; a nonzero failed count does not change the state.
- ZIP parts may already have been downloaded before later failures.

A researcher or clinician can unknowingly use an incomplete series/study. Missing frames, SEG/RT objects, reports, or key images can invalidate research results or clinical interpretation.

**Required control and evidence**

- A nonzero failure or omission count must produce a prominent incomplete/failed state.
- Default to fail-closed for study/series export; make partial export a separately authorized workflow.
- Produce a signed or integrity-protected manifest containing requested, retrieved, transformed, written, skipped, and failed instances plus SHA-256 hashes.
- Mark every partial artifact `INCOMPLETE` and prevent it from being mistaken for a completed dataset.

### DM-009 — Retrieved content is not authenticated as the requested DICOM (**High**)

**Evidence**

[`fetchItem`](src/downloader.js#L444) accepts any HTTP 2xx body. It does not require the expected media type, parse the Part 10 object before saving in the non-anonymized path, or verify Study/Series/SOP Instance UIDs against the manifest. A proxy/login page or wrong instance returned with status 200 can be saved with a `.dcm` name.

**Required control and evidence**

- Validate response media type and DICOM framing/parseability.
- Compare SOP Class, SOP Instance, Study, and Series UIDs to the requested item.
- Detect duplicate or substituted instances and fail the export.
- Record source URL without credentials, response representation, size, and digest in the export manifest.

### DM-010 — Static WADO reconstruction guesses representation metadata (**High**)

**Evidence**

- [`retrieveStaticResource`](src/static-dicom-reconstruction.js#L49) does not robustly bind HTTP `Content-Type` and transfer-syntax parameters to the returned frame representation.
- Missing transfer syntax falls back to Explicit VR Little Endian.
- DICOMweb metadata is copied into a new file even though metadata describes the resource, while pixel attributes may differ for a retrieved representation.
- The multipart parser is ad hoc and selects a part without full MIME validation.
- Native length checks do not cover bit-packed or subsampled representations.
- The hard-coded Implementation Class UID is not supported by a documented UID registration/assignment procedure.

The result can label compressed bytes as native, apply resource metadata to a different representation, or serialize a non-conformant Part 10 file.

**Required control and evidence**

- Negotiate an explicit transfer syntax and verify the response parameters.
- Use a conformant multipart parser.
- Reconcile all representation-dependent attributes with the returned pixel stream.
- Reject ambiguous responses.
- Validate reconstructed files with independent implementations and render/compare every frame.

DICOMweb explicitly states that metadata excludes Group 0002 and that representation-dependent pixel attributes may differ: [PS3.18 Section 10.4](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_10.4.html).

### DM-011 — Re-encoding has no diagnostic-integrity accounting (**High**)

**Evidence**

- No decode → redact → encode → decode round-trip comparison is performed.
- Re-encoding a lossy source may introduce additional changes outside the redaction masks.
- lossy compression history/ratio/method and derivation/source-image metadata are not reliably updated.
- [`encapsulateFrameBuffers`](src/dicom-codecs.js#L515) does not ensure every fragment has even length.
- Codec exceptions are frequently swallowed, reducing traceability.

**Required control and evidence**

- Prefer a validated lossless output syntax for transformed pixels unless a lossy workflow is specifically justified.
- Compare decoded output pixels with the intended transformed buffer; require exact equality for lossless output and validated tolerances/methodology for lossy output.
- Update all derivation, source, compression, and SOP identity attributes consistently.
- Even-pad fragments and validate offset tables.

### DM-012 — Pseudonyms, UID maps, and temporal offsets are session-local (**High**)

**Evidence**

- The default Patient ID is a fixed `ANON1234`; separate exports can therefore collide or be unintentionally linked.
- Patient mapping is initially derived from OHIF manifest metadata rather than verified downloaded headers.
- UID and date maps are in-memory globals and are reset per run.
- Subject fallback may use Study Instance UID or a random key, so one patient can receive inconsistent date shifts across studies/exports.
- Date handling assumes full precision and can corrupt reduced-precision or fractional DICOM DA/DT/TM values.

This is insufficient for controlled longitudinal research and can also merge unrelated patients in downstream systems.

**Required control and evidence**

- Define the pseudonymization domain, issuer, collision resistance, key custody, reversibility, and longitudinal-consistency policy.
- Derive mappings from verified source headers and reject mixed identity.
- Preserve entity and reference consistency across every instance in the export.
- Implement all valid DICOM DA/DT/TM precisions and timezone behavior.
- Include a controlled mapping/audit artifact only where governance permits.

### DM-013 — Profile maintenance is not tied to a DICOM edition (**High**)

**Evidence**

The active ruleset contains 4,659 entries but has no declared DICOM edition, generator provenance, normative table mapping, or automated currency check. A local comparison against the installed `dcmjs` standard dictionary found hundreds of current standard data-set tags not represented in the active file. Unknown tags are generally removed, which limits PHI leakage but may invalidate newer SOP Classes or discard required clinical data.

DICOM explicitly warns that the confidentiality table evolves and that de-identifiers must account for new standard and private attributes.

**Required control and evidence**

- Generate rules from a pinned DICOM edition plus reviewed local policy.
- Store source references and action/profile columns, not only a flattened custom token.
- Add CI drift detection against the supported DICOM dictionary and SOP Classes.
- Reassess the profile with every DICOM edition upgrade.

See [PS3.15 Annex E](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html).

### DM-014 — Divergent rules files undermine configuration control (**High**)

**Evidence**

- Runtime imports [`anonymizer-rules.js`](src/anonymizer-rules.js).
- `anonymizer-rules.json` and `rules.json` contain materially different actions for tags such as Patient Age, Patient Sex, Study Description, and institution/device identity.
- The browser-based rule tool reads the JSON and generates another `rules.json`, not the active module.

A reviewer may approve one file while production executes another. A future developer can regenerate or import the wrong rules without an obvious failure.

**Required control and evidence**

- Establish one canonical source and a deterministic generator.
- Delete or clearly mark non-runtime artifacts; CI must compare generated output byte-for-byte.
- Record rule version/hash in the export provenance and software bill of materials.

### DM-015 — OCR has no medical-grade performance evidence (**High**)

**Evidence**

- The preferred OCR engine depends on an optional browser global rather than a pinned, packaged, integrity-checked model.
- The fallback OCR uses a small handcrafted uppercase Latin/digit/symbol template set and simple threshold/segmentation logic.
- The PHI classifier relies on limited patterns and source metadata; arbitrary names, non-Latin scripts, rotated text, low contrast, overlays, and unusual modality fonts can be missed.
- No validated sensitivity/specificity, confidence calibration, dataset provenance, language coverage, modality coverage, or human-factors study is supplied.

**Required control and evidence**

- Define the validated modalities, photometric formats, languages, orientations, and acquisition conditions.
- Use versioned models with integrity verification and deterministic preprocessing.
- Build an anonymized, governed validation corpus with pre-specified acceptance thresholds emphasizing false negatives.
- Route low-confidence, unsupported, and high-risk cases to a human review interface that displays every frame and mask.

### DM-016 — Video bypasses anonymization (**High**)

**Evidence**

The downloader identifies raw `video/mp4` items and bypasses the DICOM anonymizer. Video frames and container metadata can contain patient identity. The UI does not make this a blocking exception when anonymization is enabled.

**Required control and evidence**

- Reject video during anonymized export until a separately validated pixel/audio/container-metadata workflow exists.
- Never count a bypassed item as anonymized.
- Present a blocking list of unsupported objects before export begins.

### DM-017 — Default logging can disclose PHI (**High**)

**Evidence**

`verboseLogging` defaults to true. Pixel/OCR paths log source metadata and recognized text/coordinates. Browser consoles can be viewed by nearby users, retained in diagnostics, or captured by remote-support/telemetry products.

**Required control and evidence**

- Default all PHI-bearing logs off in production builds.
- Never log recognized text, patient metadata, URLs with credentials/tokens, or raw DICOM.
- Use structured event identifiers and redacted diagnostics with an approved retention policy.
- Test production bundles for PHI leakage into console, telemetry, and error reports.

### DM-018 — Export governance and audit controls are absent (**High**)

**Evidence**

The extension reuses the viewer's current authorization header, but does not itself check export entitlement, approved purpose, patient/research consent or policy, destination classification, or whether identified export is allowed. No durable audit event records actor, subject/data scope, source, destination type, anonymization policy/version, result, or failures.

**Required control and evidence**

- Integrate a server-authoritative export authorization decision; viewing permission must not automatically imply bulk-export permission.
- Require purpose and destination policy where applicable.
- Emit an auditable, privacy-preserving export event, preferably integrated with the organization's DICOM audit/security architecture.
- Define behavior for emergency access, revoked sessions, consent changes, and multi-tenant environments.

### DM-019 — Temporary and partial PHI is not reliably removed (**High**)

**Evidence**

- ZIP assembly may use Origin Private File System or IndexedDB storage.
- Returned blobs can carry a `_cleanup` callback, but the normal download trigger does not call it.
- IndexedDB finalization calls `getAll`, rehydrating the archive in memory and undermining the streaming design.
- Orphan cleanup occurs on a later run and deletes by a broad prefix, which can race another export.
- Folder exports write directly to final paths and can overwrite same-named SOP files.
- Aborted/failed multipart ZIPs and folders have no transaction marker or rollback.

**Required control and evidence**

- Use per-export isolated staging and atomic commit.
- Invoke cleanup in `finally` for success, failure, cancellation, unload, and mode exit.
- Define retention, encryption-at-rest expectations, quota behavior, and user-visible cleanup status.
- Detect destination collisions and never overwrite without an explicit, audited choice.
- Verify cleanup through browser crash/restart and quota-exhaustion tests.

### DM-020 — Lifecycle, cancellation, and concurrent exports are unsafe (**High**)

**Evidence**

- The extension has no `onModeExit`.
- Closing the modal can abort fetches, but mode navigation or service-driven modal removal need not invoke that handler.
- OCR, codecs, serialization, and writer finalization do not consistently observe the abort signal.
- A second `startDownload` overwrites the shared active controller/stats and can race temporary-storage cleanup and toolbar state.

**Required control and evidence**

- Implement idempotent lifecycle teardown and service disposal.
- Enforce a single active export or isolate all state by export ID.
- Propagate cooperative cancellation through every CPU and I/O stage.
- Ensure cancellation cannot finalize an apparently complete artifact.
- Test rapid close, route change, logout, tab close, and two simultaneous export attempts.

This is also inconsistent with the repository's mode/extension guidance requiring state cleanup on exit.

### DM-021 — `enabled: false` does not disable the actual extension (**High**)

**Evidence**

The registered [`index.tsx`](src/index.tsx#L12) initializes services and registers UI without checking the configured enable flag. The apparent enable check exists in a legacy path that is not the exported OHIF extension.

**Required control and evidence**

- Enforce disablement in the actual `preRegistration`, module registration, command evaluation, and mode lifecycle.
- Add a configuration test proving no command, panel, toolbar item, state load, or background work exists when disabled.

### DM-022 — Toolbar registration is disruptive (**High**)

**Evidence**

[`index.tsx`](src/index.tsx#L35) calls:

```ts
toolbarService.updateSection('primary', ['DownloadManager']);
```

This can replace the host mode's primary toolbar contents with only the Download button. There is no restoration on mode exit.

**Required control and evidence**

- Let each mode opt in and compose the button with its existing toolbar definition.
- Do not globally replace a host-owned section from extension lifecycle code.
- Restore any extension-owned registration on exit and test navigation among all supported modes.

### DM-023 — Persistent settings and UI labels create unsafe expectations (**High**)

**Evidence**

- Anonymization is off by default.
- The enabled state and detailed rules persist in `localStorage`, potentially across users on a shared workstation.
- The panel displays “Full Anonymization” for the apparent default state.
- The non-default detector omits some safety-relevant controls, so materially weakened settings may still receive the reassuring badge.
- An identified export has no separate PHI disclosure confirmation or policy decision.

**Required control and evidence**

- Replace “Full Anonymization” with a precise, validated profile/result state.
- Bind policy to authenticated user/tenant and reset it on logout.
- Make administrator-required controls immutable in the client.
- Require explicit confirmation for identified export, showing scope and destination.
- Perform IEC 62366-1 usability validation for the enabled/disabled, incomplete, unsupported, and review-required states.

### DM-024 — Manifest omissions and UID validation are silent (**High**)

**Evidence**

- Items without usable SOP Instance UID can be skipped during manifest construction without a preflight failure.
- UID validation accepts only a broad `[0-9.]+` shape and does not enforce component structure, leading zeros, empty components, or maximum length.
- The manifest is derived from display sets and may not prove that all server-side instances in the requested series/study are included.

**Required control and evidence**

- Compare the requested scope against an authoritative QIDO/WADO inventory.
- Validate UIDs according to DICOM UID syntax and length rules.
- Show omissions before download and require fail-closed behavior for complete-scope exports.
- Reconcile the final artifact against the preflight inventory.

### DM-025 — Identifiers are placed in filesystem paths (**Medium**)

**Evidence**

For identified export, deterministic patient folder names include Patient ID/Patient Name. Filesystem paths leak into recent-file lists, search indexes, backups, screenshots, sync products, and support diagnostics even if file contents remain protected.

**Required control and evidence**

- Default to non-identifying folder names.
- Treat paths as PHI in threat modeling, logging, retention, and cleanup.
- Warn users before writing identified names and apply an institution-approved naming policy.

### DM-026 — Retry and concurrency can overload clinical infrastructure (**Medium**)

**Evidence**

- Default parallelism is 10 and is not capped to a validated safe maximum.
- Many deterministic parse, codec, anonymization, and unsafe-payload errors are treated as retryable.
- OCR, full-file buffering, compression, ZIP assembly, and browser memory pressure compete with the diagnostic viewer UI.

**Required control and evidence**

- Retry only transient network/server statuses with bounded exponential backoff and `Retry-After`.
- Cap concurrency and adapt it to server policy and workstation resources.
- Move heavy processing off the UI thread where possible.
- Define performance budgets and test that viewing, interaction, and logout remain responsive during worst-case exports.

### DM-027 — Codec packaging and errors are not controlled (**High**)

**Evidence**

Codec modules are dynamically imported but not declared as direct extension dependencies; availability depends on the surrounding monorepo's transitive packages/bundler. Multiple codec failures are swallowed. Runtime support can therefore change without a package-level dependency or clear failure.

**Required control and evidence**

- Declare exact direct dependencies and record codec/model versions in the SBOM and provenance.
- Add build-time checks proving every advertised codec is present.
- Replace empty catches with typed errors and fail closed.
- Maintain a transfer-syntax conformance matrix with external corpus tests.

### DM-028 — Required product evidence is absent (**High**)

**Evidence**

No extension-specific evidence was found for:

- intended use, indications, contraindications, and supported environments;
- ISO 14971 hazard analysis, risk controls, residual-risk evaluation, and production feedback;
- IEC 62304 software safety classification, requirements traceability, architecture, SOUP assessment, change/problem resolution, and release records;
- IEC 62366-1 use-related risk analysis and validation;
- cybersecurity threat model, secure update/dependency process, vulnerability handling, and security testing;
- privacy impact assessment/data-flow and retention analysis;
- DICOM Conformance Statement identifying services, roles, media types, transfer syntaxes, SOP Classes, and de-identification profile/options.

**Required control and evidence**

Create these artifacts under the organization's quality system, with requirements and risk controls traced to automated/manual verification. A Conformance Statement does not replace interoperability testing.

References: [ISO 14971:2019](https://www.iso.org/standard/72704.html), [IEC 62304](https://webstore.iec.ch/en/publication/22794), [IEC 62366-1](https://webstore.iec.ch/en/publication/21863), [FDA device software submission guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/content-premarket-submissions-device-software-functions), and [DICOM PS3.2](https://dicom.nema.org/medical/dicom/current/output/html/part02.html).

### DM-029 — Test evidence is not safety-sufficient (**High**)

**Evidence**

Current unit tests cover selected happy paths but do not establish:

- absence of direct/quasi-identifiers across every nested sequence;
- exact PS3.15 action compliance for each supported profile/option and attribute Type;
- validity of SR, SEG, RT, waveform, presentation state, and enhanced multi-frame outputs;
- external decode/validation and cross-vendor interoperability;
- exact pixel preservation outside approved masks;
- OCR false-negative performance;
- malformed/adversarial DICOM and MIME handling;
- cancellation, partial storage, concurrency, quota exhaustion, session expiry, and mode exit;
- complete study/series inventory and integrity.

Some compressed tests are conditional on a codec producing output, so an unavailable codec can make the assertion path disappear.

**Required control and evidence**

- Build a fully anonymized reference corpus covering supported SOP Classes and transfer syntaxes.
- Validate output with independent tools such as DCMTK plus an IOD-aware validator.
- Add golden pixel hashes/diffs, reference-graph checks, property/fuzz tests, and Playwright workflows.
- Make unavailable advertised codecs a test failure, not a skipped branch.
- Trace every safety requirement and risk control to objective pass/fail evidence.

### DM-030 — Documentation overstates completed safety work (**Medium**)

**Evidence**

- [`TODO.md`](TODO.md) marks multi-frame scanning, codec support, and provenance work “RESOLVED,” although DM-001 through DM-006 contradict those acceptance claims.
- [`README.md`](README.md) describes robust standard-inspired anonymization.
- The UI says “Full Anonymization.”
- The existing OCR caveat is useful but does not counteract the stronger success/provenance states.

**Required control and evidence**

- Replace claims with a precise supported/unsupported matrix and known limitations.
- Do not mark a safety task resolved until its acceptance criteria have objective evidence and an independent review.
- Ensure UI, operator instructions, conformance statement, risk controls, and implementation use the same terminology.

## Minimum release gates

The following gates should all pass before enabling anonymized export:

1. **Scope gate:** approved intended use, jurisdictions, data classes, SOP Classes, transfer syntaxes, modalities, browser/workstation matrix, and explicit exclusions.
2. **Risk gate:** reviewed ISO 14971 hazard analysis with risk controls traced to requirements and tests.
3. **DICOM gate:** edition-pinned PS3.15 profile/options, truthful per-instance provenance, IOD validation, reference consistency, and a published Conformance Statement.
4. **Pixel gate:** fail-closed supported-format matrix, validated OCR/manual review, exact outside-mask pixel preservation, and independent decode/render verification.
5. **Integrity gate:** authoritative preflight inventory, verified response identity, transactional output, hashes, and no “complete” state with omissions.
6. **Privacy/security gate:** export authorization and audit, no PHI logs, controlled temporary storage, cleanup evidence, SBOM, threat model, and vulnerability process.
7. **Lifecycle/usability gate:** safe cancel/logout/navigation/concurrency behavior and validated operator comprehension of identified, de-identified, partial, failed, and review-required states.
8. **Independent verification gate:** external DICOM tools and representative receiving systems accept and correctly render every supported output class/syntax.

## Recommended implementation order

1. Disable the anonymization success claims and pixel-clean provenance.
2. Fail closed on compressed-pixel modification and unsupported SOP/pixel formats.
3. Correct the cross-frame redaction predicate and exact transfer-syntax encoding.
4. Add truthful typed per-instance results and make partial output unmistakably incomplete.
5. Add response UID/content validation and transactional manifests/hashes.
6. Replace the flattened rules with an edition-pinned, IOD-aware profile implementation.
7. Establish governed pseudonym/date/UID mapping and export authorization/audit.
8. Build the conformance corpus, independent validator pipeline, OCR validation, and lifecycle/E2E suite.
9. Complete quality-system, risk, usability, cybersecurity, and privacy documentation before production release.

## Audit verification performed

The focused unit command below was run against the audited tree:

```sh
yarn workspace @ohif/extension-download-manager run test:unit:ci --coverage=false
```

Result: **7 suites and 43 tests passed**. The run also emitted DICOM serialization warnings (`Invalid vr type xs - using US` and `Invalid vr type lt - using UN`) from static reconstruction, a missing `window.confirm` implementation warning in the multi-frame test, and logs demonstrating that a failed JPEG 2000 decode was followed by “no PHI” and `BurnedInAnnotation = NO`. These observations reinforce DM-002, DM-010, DM-017, and DM-029. Passing the current unit suite does not close any of the release blockers because the required external conformance, pixel-integrity, OCR-performance, failure-injection, and end-to-end evidence is absent.

## Standards baseline used for this review

- [DICOM PS3.15 2026c, Annex E — Attribute Confidentiality Profiles](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html)
- [DICOM PS3.15 2026c, E.3 — Confidentiality Profile Options](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_E.3.html)
- [DICOM CID 7050 — De-identification Method](https://dicom.nema.org/medical/dicom/current/output/chtml/part16/sect_CID_7050.html)
- [DICOM PS3.5 2026c, A.4 — Encapsulated Pixel Data](https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_A.4.html)
- [DICOM PS3.10 — Media Storage and File Format](https://dicom.nema.org/medical/dicom/current/output/chtml/part10/PS3.10.html)
- [DICOM PS3.18 2026c, 10.4 — Retrieve Transaction](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_10.4.html)
- [DICOM PS3.2 — Conformance](https://dicom.nema.org/medical/dicom/current/output/html/part02.html)
- [ISO 14971:2019 — Medical device risk management](https://www.iso.org/standard/72704.html)
- [IEC 62304 — Medical device software lifecycle processes](https://webstore.iec.ch/en/publication/22794)
- [IEC 62366-1 — Usability engineering](https://webstore.iec.ch/en/publication/21863)
- [FDA — Content of Premarket Submissions for Device Software Functions](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/content-premarket-submissions-device-software-functions)
