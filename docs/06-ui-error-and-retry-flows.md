# 06. UI States, Messages, Failures & Retry Flows

> **Package**: `@ohif/extension-download-manager` (OHIF Viewer v3 Platform)
> **Scope**: everything the user *sees* and *can act on* when something goes wrong.
> **Companion document**: [`UI-shortcomings.md`](../UI-shortcomings.md) — how these flows should be improved.

## Developer-only raw DICOM diagnostics

The runtime option `window.config.aquestDownloadManager.devMode` defaults to
`false`. When explicitly set to `true`, final per-instance DICOM errors include
a clickable `SOPInstanceUID` in both the live activity log and retained summary
log. The resulting large diagnostic dialog shows a `dcmdump`-style listing of
all parsed elements except `(7FE0,0008)`, `(7FE0,0009)`, and `(7FE0,0010)`.
Transfer Syntax is repeated prominently above the dump.

The dialog can copy or download the text dump and download the raw response as
`.raw.dcm`. The raw response is captured before anonymization, pixel redaction,
hashing, and output-writer processing. If no body was received, the dialog
attempts one authenticated raw refetch. It never reconstructs a synthetic file
for frame-only sources.

This mode exposes identifiable data and may retain failed raw instances in
browser memory until the run log is reset or the modal unmounts. It must only
be enabled in trusted development environments.

This document diagrams the **as-built** behaviour of the extension's user interface: which
surfaces render messages, which state each surface can enter, how a failure is classified,
what the user is told, and what recovery actions are actually reachable from that point.

Diagrams marked **⚠️ as-built defect** show a path that behaves incorrectly today. Each is
cross-referenced to a finding ID in [`UI-shortcomings.md`](../UI-shortcomings.md).

---

## 1. UI surface map — where messages come from

There are four independent surfaces that can show the user a message, and they do **not**
share a single message bus.

```mermaid
flowchart TB
    subgraph Engine["Download engine (non-React)"]
        DL["downloader.js<br/>startDownload / downloadManifest"]
        ST["state.js<br/>state.downloadStats<br/>state.downloadIssue<br/>state.activeAbortController"]
        DL <--> ST
    end

    subgraph Surfaces["User-visible surfaces"]
        MODAL["Download Manager Modal<br/>DownloadManagerModal.tsx<br/><i>step: selection / downloading /<br/>complete / error / unavailable</i>"]
        PANEL["Side Panel card<br/>DownloadManagerPanel.tsx<br/><i>polls state every 1000 ms</i>"]
        TOAST["OHIF uiNotificationService<br/><i>used exactly once</i>"]
        NATIVE["Browser-native dialogs<br/>showDirectoryPicker / window.confirm"]
    end

    DL -->|"onProgress / onLog<br/>onComplete / onError<br/>onPromptMultiFrame"| MODAL
    ST -.->|"1 s polling, read-only"| PANEL
    DL --> NATIVE
    CMD["getCommandsModule.ts<br/>openDownloadManager"] -->|"'No study is currently<br/>available to download.'"| TOAST

    classDef gap fill:#3b2f14,stroke:#d97706,color:#fde68a
    class TOAST gap
```

**Key observation:** the engine pushes to the modal via callbacks, but the panel only
*polls global mutable state*. When the modal is unmounted, every `onError` / `onComplete`
message is delivered to a dead listener and is never shown anywhere.
→ *[UX-01](../UI-shortcomings.md#ux-01), [UX-11](../UI-shortcomings.md#ux-11)*

---

## 2. Modal state machine — as built

```mermaid
stateDiagram-v2
    direction TB
    [*] --> Gate

    Gate: Mount gate
    note right of Gate
        !payload || !allSeries.length
        → 'unavailable'
    end note

    Gate --> Unavailable: no display sets
    Gate --> Selection: study present

    Unavailable: unavailable
    note right of Unavailable
        Static text only.
        getDownloadAvailabilityMessage()
        returns '' → generic fallback.
        ⚠️ No Retry / Refresh control.
        (UX-12)
    end note
    Unavailable --> [*]: Close

    Selection: selection
    note left of Selection
        Series pickers, modality chips,
        anonymizer panel, PHI ack,
        manifest validation errors
    end note

    Selection --> Downloading: Start Download
    Selection --> [*]: Cancel / ESC

    Downloading: downloading
    note right of Downloading
        Progress bar, ETA, live log,
        optional multi-frame prompt
    end note

    Downloading --> Complete: onComplete(summary)
    Downloading --> Error: onError(err, issue)
    Downloading --> Downloading: multi-frame prompt blocks all workers

    Complete: complete
    Error: error
    note right of Error
        Both render DownloadSummaryView.
        ⚠️ downloadSummary is NOT reset
        between runs → stale metrics
        render under a fresh error. (UX-04)
    end note

    Complete --> Downloading: Retry Failed Files
    Error --> [*]: Close only
    Complete --> [*]: Close

    Cancelled: cancelled
    note right of Cancelled
        ⚠️ UNREACHABLE.
        DownloadSummaryView renders a
        'Download Cancelled' branch on
        summary.cancelled, but
        downloadManifest always returns
        cancelled: false and aborts
        reject instead. (UX-02)
    end note
```

---

## 3. Error classification — from HTTP response to user message

This is the decision tree the engine walks for **every single instance**. The branch taken
decides whether the user sees a retry, a per-file failure, or a hard stop of the whole export.

```mermaid
flowchart TD
    F["fetchItem(item, signal)"] --> R{"Response?"}

    R -->|"3xx / 401 / 403 /<br/>opaqueredirect"| SESS["SessionExpiredError"]
    R -->|"!response.ok"| HTTP["HttpError + status<br/>+ Retry-After"]
    R -->|"wrong Content-Type"| PAY["PayloadValidationError<br/>'Server did not return DICOM content.'"]
    R -->|"OK"| VAL{"UID identity check<br/>validateRetrievedPayload"}
    R -->|"network throw"| NET{"isCorsError?<br/>message contains 'cors' /<br/>'failed to fetch' / 'load failed'"}

    VAL -->|"UID mismatch or<br/>unparseable Part 10"| PAY
    VAL -->|"match"| OK["Anonymize → hash → write"]

    NET -->|"yes"| SESS
    NET -->|"no"| OTHER["TypeError / other"]

    SESS --> TERM
    PAY --> CLASS
    HTTP --> CLASS
    OTHER --> CLASS

    CLASS{"Terminal issue?<br/>SessionExpiredError,<br/>SecurityError, isQuotaError"}
    CLASS -->|"yes"| TERM["stopAllForIssue(issue)<br/>→ abort ALL workers"]
    CLASS -->|"no"| RETRY{"_attempts &lt; retryCount (2)<br/>AND isRetryableError?"}

    RETRY -->|"HttpError 408/429/5xx<br/>or bare TypeError"| SCHED["scheduleRetry<br/>backoff 500 ms · 2^n, cap 30 s<br/>log: 'Trying again: image set N / file'"]
    RETRY -->|"no"| FAIL["finalizeFailure<br/>log: 'Could not download …'<br/>push to failedItems[]"]

    SCHED --> F
    FAIL --> AGG["Aggregate: done / failed"]
    OK --> AGG

    TERM --> ISSUE["issueForError → issue card:<br/>Session expired /<br/>Protected folder /<br/>Not enough disk space"]
    ISSUE --> ERRSTEP["step = 'error'<br/>❌ banner, Close only"]

    AGG --> DONE{"doneCount === 0?"}
    DONE -->|"yes"| INC["IncompleteExportError<br/>⚠️ no summary object →<br/>no failed list, NO retry button<br/>(UX-05)"]
    DONE -->|"no"| WRITE["Write export-manifest.json<br/>+ checksums.sha256 → finalize()"]
    WRITE --> SUMMARY["step = 'complete'<br/>DownloadSummaryView"]
    INC --> ERRSTEP

    classDef bad fill:#3f1d1d,stroke:#dc2626,color:#fecaca
    class NET,INC,TERM bad
```

**⚠️ as-built defect — the network-blip trap.** A transient `TypeError: Failed to fetch`
(Wi-Fi drop, proxy hiccup, one dropped connection out of thousands) matches `isCorsError`
and is rewritten into `SessionExpiredError` **inside `fetchItem`'s own catch — before the
retry check ever runs**. `SessionExpiredError` is terminal, so it aborts every worker and
tells the user *"Your viewing session ended … close this window, reopen the exam."* The
export is dead, the advice is wrong, and the retryable `TypeError` branch of
`isRetryableError` is effectively unreachable for network errors.
→ *[UX-06](../UI-shortcomings.md#ux-06)*

---

## 4. Failure taxonomy → what the user is told → what they can do

```mermaid
flowchart LR
    subgraph Recoverable["Per-file, retried automatically"]
        A1["HTTP 408 / 429 / 5xx"]
    end
    subgraph PerFile["Per-file, permanent — export continues"]
        B1["HTTP 4xx (non-session)"]
        B2["PayloadValidationError<br/>wrong type / UID mismatch"]
        B3["Anonymization fail-closed"]
    end
    subgraph Terminal["Terminal — whole export aborted"]
        C1["SessionExpiredError<br/>incl. any network error"]
        C2["SecurityError<br/>protected folder"]
        C3["QuotaExceededError<br/>heuristic string match"]
        C4["ZipSizeError<br/>&gt;700 MB / &gt;60k entries"]
        C5["IntegrityManifestError<br/>no SubtleCrypto"]
    end
    subgraph UserAction["User-initiated"]
        D1["Cancel in progress view"]
        D2["Cancel in side panel"]
        D3["ESC / overlay / X"]
        D4["Escape in folder picker"]
    end

    A1 --> M1["⚠️ amber log line<br/>'Trying again: … attempt 2 of 3'"]
    B1 & B2 & B3 --> M2["Amber 'Failed Files Breakdown'<br/>+ 🔁 Retry Failed Files"]
    C1 & C2 & C3 --> M3["❌ red issue card<br/>title + remediation text<br/><b>Close only</b>"]
    C4 & C5 --> M4["❌ red banner + raw message<br/><b>Close only</b>"]
    D1 --> M5["⚠️ modal closes immediately —<br/>no summary of what was saved"]
    D2 --> M6["⚠️ card vanishes, zero feedback;<br/>modal (if open) shows<br/>'❌ Download Failed'"]
    D3 --> M7["⚠️ nothing — export keeps<br/>running headless"]
    D4 --> M8["❌ 'Download Failed:<br/>The user aborted a request.'"]

    classDef bad fill:#3f1d1d,stroke:#dc2626,color:#fecaca
    classDef warn fill:#3b2f14,stroke:#d97706,color:#fde68a
    class M5,M6,M7,M8 bad
    class M3,M4 warn
```

---

## 5. The retry flow — partial success

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant M as DownloadManagerModal
    participant S as DownloadSummaryView
    participant D as downloader.js
    participant W as Writer (ZIP / Folder)

    D->>M: onComplete({done: 480, failed: 20, failedItems[…]})
    M->>S: step 'complete' → render
    S-->>U: ⚠️ "Download Completed with Warnings"<br/>480 of 500 saved · Retry Failed Files (20)

    U->>S: click "Retry Failed Files (20)"
    S->>M: onRetryFailed()
    Note over M: failedItems.map(f => f.item)<br/>handleStartDownload(items)

    rect rgb(70, 30, 30)
        Note over M: ⚠️ setDownloadLogs([]) wipes the<br/>evidence of the original failure (UX-08)
        Note over M: ⚠️ downloadSummary / downloadStats<br/>are NOT reset (UX-04)
    end

    M->>D: startDownload(callbacks, items, anonConfig, outputMethod)

    rect rgb(70, 30, 30)
        Note over D: ⚠️ resetAnonymizationSession()<br/>→ brand-new UID mapping table (UX-09)
    end

    alt outputMethod === 'folder'
        D->>U: showDirectoryPicker() — pick the folder AGAIN
        Note over U: no hint that it must be the<br/>same folder as the first pass
    else outputMethod === 'zip'
        D->>W: new ChunkedZipWriter → a SECOND, separate archive
    end

    D->>W: write 20 files
    D->>W: writeArtifact('export-manifest.json')<br/>writeArtifact('checksums.sha256')
    Note over W: ⚠️ describes only the 20 retried files —<br/>no combined manifest for the 500 (UX-10)
    D->>M: onComplete({done: 20, failed: 0})
    M->>S: ✅ "Download Complete — All 20 files saved"
    S-->>U: green banner
    Note over U: User now holds 2 archives, 2 manifests,<br/>and (with anonymization on) 2 different<br/>anonymous Study/Series UIDs for one study.
```

---

## 6. Cancellation — three entry points, three different outcomes

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant P as Side Panel
    participant M as Modal
    participant D as downloader.js
    participant ST as state.js

    Note over U,ST: Path A — "Cancel Download" in the progress view
    U->>M: click Cancel Download
    M->>ST: activeAbortController.abort()
    M->>M: hideModal()  ← modal unmounts immediately
    D-->>M: onError(AbortError) → delivered to a dead component
    Note over U: Sees nothing. Never learns how many<br/>files were already written to disk.

    Note over U,ST: Path B — "Cancel" in the side panel card
    U->>P: click Cancel
    P->>ST: activeAbortController.abort()
    D->>ST: finally → downloadStats = null
    P-->>U: card silently disappears (next 1 s poll)
    alt modal still open
        D->>M: onError(AbortError, null)
        M-->>U: ❌ "Download Failed —<br/>The download was cancelled."
    end

    Note over U,ST: Path C — ESC / overlay click / X
    U->>M: ESC
    M->>M: ModalProvider onClose = hide()
    Note over M: handleClose() is NEVER called →<br/>no abort, no cleanup
    D->>D: export keeps running headless
    D->>U: browser download fires with no UI context
    U->>M: reopen, click Start Download
    M->>D: startDownload(...)
    D-->>M: Promise.reject(ExportInProgressError)
    Note over M: no .catch() → unhandled rejection.<br/>UI sits on 'downloading' forever. (UX-01)
```

---

## 7. Multi-frame redaction prompt — a blocking question inside the progress view

```mermaid
sequenceDiagram
    autonumber
    participant A as anonymizer.js
    participant D as downloader.js
    participant M as Modal
    actor U as User

    A->>D: onPromptMultiFrameMethod({numberOfFrames: 240})
    D->>M: target.onPromptMultiFrame(…, resolve)
    M->>M: setMultiFramePrompt(...)
    Note over M: amber card renders ABOVE the progress<br/>view, inside a scrollable ScrollArea

    par all three workers stall
        D--xD: worker 1 awaiting resolve
        D--xD: worker 2 awaiting resolve
        D--xD: worker 3 awaiting resolve
    end

    Note over M,U: ⚠️ progress bar keeps its last value,<br/>ETA keeps counting down, spinner keeps<br/>pulsing → looks like a hang, not a question.<br/>If the user scrolled down, the prompt is<br/>off-screen entirely. (UX-13)

    U->>M: "Aggressive" or "Sampling"
    M->>D: resolve(method)
    Note over D: anonOptions.multiFrameRedactionMethod = method<br/>⚠️ applied to the WHOLE export; the copy<br/>never says the choice is one-shot and final.
    D->>A: continue
```

---

## 8. Message inventory

| # | Message (user-facing) | Type | Surface | Source | Reachable action |
|---|---|---|---|---|---|
| 1 | "No study is currently available to download." | info toast | notification | `getCommandsModule.ts:24` | dismiss |
| 2 | "Your medical images are not ready yet…" | inline | modal `unavailable` | `DownloadManagerModal.tsx:249` | *none* |
| 3 | "This selection cannot be exported." + list | error | modal `selection` | `DownloadManagerModal.tsx:448` | fix selection |
| 4 | "Before the download starts, you will be asked where to save…" | tip | modal `selection` | `DownloadManagerModal.tsx:258` | — |
| 5 | "If your browser asks to allow multiple downloads, choose Allow…" | warning log | progress log | `downloader.js:252` | — (logged at t=0, needed at t=end) |
| 6 | "Trying again: image set N / file (attempt 2 of 3) after 1 seconds." | warning log | progress log | `downloader.js:310` | — |
| 7 | "Could not download image set N / file: `<error>`" | error log | progress log | `downloader.js:332` | — |
| 8 | "Not anonymized: … — MP4 content is exported as retrieved…" | warning log | progress log + audit card | `downloader.js:372` | — |
| 9 | "Preparing the final verified download file, please wait…" | info | progress | `downloader.js:538` | — (no progress, can last minutes) |
| 10 | "Download Complete" ✅ | banner | summary | `DownloadSummaryView.tsx:91` | Close |
| 11 | "Download Completed with Warnings" ⚠️ | banner | summary | `DownloadSummaryView.tsx:93` | **Retry Failed Files** ×2, Close |
| 12 | "Download Cancelled" ⚠️ | banner | summary | `DownloadSummaryView.tsx:95` | **unreachable** |
| 13 | "Download Failed" ❌ | banner | summary | `DownloadSummaryView.tsx:96` | Close |
| 14 | "Session expired" | issue card | summary | `downloader.js:748` | Close |
| 15 | "Protected folder selected" | issue card | summary | `downloader.js:758` | Close |
| 16 | "Not enough disk space" | issue card | summary | `downloader.js:768` | Close |
| 17 | "The requested export exceeds the safe single-archive limit; no archive was downloaded." | raw error | summary | `zipWriter.js:42` | Close |
| 18 | "All N requested instance(s) failed to download; no files were saved." | raw error | summary | `downloader.js:483` | Close |
| 19 | "The user aborted a request." | raw browser error | summary | `showDirectoryPicker` rejection | Close |
| 20 | "Multi-Frame DICOM Redaction Mode Required" | blocking prompt | progress | `DownloadManagerModal.tsx:479` | Aggressive / Sampling |

**Register mismatch.** Rows 1–11 are written in plain patient-facing language; rows 17–19
leak engineering strings and browser internals into the same red banner, with no error code,
no "what to do next", and no way to copy a report.
→ *[UX-15](../UI-shortcomings.md#ux-15)*

---

## 9. Recovery coverage matrix

Which failures can the user actually recover from **without** losing their selection and
anonymization configuration?

```mermaid
flowchart TB
    subgraph Good["✅ In-place recovery exists"]
        G1["Transient 5xx / 429<br/>→ automatic retry"]
        G2["Partial failure<br/>→ Retry Failed Files"]
    end
    subgraph None["❌ No in-place recovery — Close and start over"]
        N1["Session expired"]
        N2["Protected folder<br/><i>a folder re-pick would fix it</i>"]
        N3["Disk full<br/><i>a folder re-pick would fix it</i>"]
        N4["ZIP size limit<br/><i>a smaller selection would fix it</i>"]
        N5["All files failed<br/><i>the exact case that most needs retry</i>"]
        N6["Folder picker dismissed<br/><i>one click would fix it</i>"]
        N7["Network / CORS blip<br/><i>misreported as session expiry</i>"]
    end

    None --> LOSS["Modal unmounts →<br/>series selection, modality filters,<br/>anonymizer config and PHI ack<br/>are all discarded (UX-14)"]

    classDef bad fill:#3f1d1d,stroke:#dc2626,color:#fecaca
    classDef ok fill:#14321f,stroke:#16a34a,color:#bbf7d0
    class N1,N2,N3,N4,N5,N6,N7,LOSS bad
    class G1,G2 ok
```

---

## 10. Proposed target-state flow

The shape the UI should converge on. Rationale and per-item detail in
[`UI-shortcomings.md`](../UI-shortcomings.md).

```mermaid
stateDiagram-v2
    direction TB
    [*] --> Selection

    Selection: Selection + pre-flight
    note right of Selection
        Estimated size vs ZIP limit,
        destination pre-check,
        connectivity check
    end note

    Selection --> Destination: Start
    Destination: Choose destination
    Destination --> Selection: picker dismissed<br/>(non-error, keeps selection)
    Destination --> Running

    Running: Downloading
    Running --> Paused: recoverable terminal issue<br/>(network lost, disk full,<br/>folder rejected)
    Running --> AwaitingInput: multi-frame question
    AwaitingInput --> Running: answered
    AwaitingInput --> Paused: 60 s no answer

    Paused: Paused — recoverable
    note left of Paused
        Keeps queue, writer, UID session.
        Actions: Resume · Change folder ·
        Sign in again · Reduce selection ·
        Save partial and finish
    end note
    Paused --> Running: Resume / re-auth / new folder
    Paused --> Summary: Finish with what was saved

    Running --> Confirm: user cancels
    Confirm: Confirm cancel
    note right of Confirm
        "N files already saved.
        Keep them or discard?"
    end note
    Confirm --> Running: continue
    Confirm --> Summary: stop

    Running --> Summary: all items settled

    Summary: Summary
    note right of Summary
        Distinct outcomes: complete ·
        complete-but-not-fully-anonymized ·
        partial · cancelled · failed.
        Always: Retry failed · Copy report ·
        Back to selection (state preserved).
        Mirrored to uiNotificationService.
    end note

    Summary --> Selection: Back to selection
    Summary --> Running: Retry failed<br/>(same writer, same UID session)
    Summary --> [*]: Close
```

---

## Navigation

- Previous: **[05. Storage Writers & Troubleshooting](./05-storage-directory-layout-troubleshooting.md)**
- Related: **[UI-shortcomings.md](../UI-shortcomings.md)** — improvement backlog
- Index: **[Documentation Suite](./index.md)**
