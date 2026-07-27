# Download Manager — UI/UX Shortcomings: Errors, Retries & Notifications

**Package:** `@ohif/extension-download-manager` (OHIF Viewer v3 Platform)
**Scope:** user-facing behaviour of the download manager — messaging, failure handling, retry
and recovery paths, notifications, and accessibility of status information.
**Companion document:** [`docs/06-ui-error-and-retry-flows.md`](./docs/06-ui-error-and-retry-flows.md) — diagrams of the as-built flows.
**Not in scope:** de-identification correctness and DICOM conformance — see [`SHORTCOMINGS.md`](./SHORTCOMINGS.md).

---

## Executive summary

The export engine is defensive and fail-closed; the **UI wrapped around it is not**. The
engine distinguishes cancellation, per-file failure, terminal issues, and partial success —
but almost all of that resolution is flattened into two visual outcomes: a green
*"Download Complete"* or a red *"Download Failed"*.

Five structural problems account for most of the findings below:

1. **Messages are delivered to a component that may not exist.** The engine reports via
   React callbacks bound to the modal. ESC, overlay click, or the modal's X unmount the
   modal *without* cancelling the export, after which every completion and error message is
   discarded. Nothing is mirrored to `uiNotificationService`.
2. **Recovery almost always means "close and start over."** Of the seven terminal failure
   modes, six have an obvious in-place fix (re-pick a folder, re-authenticate, shrink the
   selection, click the picker again) and none of them offer it. Closing the modal discards
   the user's series selection, modality filters, anonymizer configuration, and PHI
   acknowledgement.
3. **Deliberate user actions are reported as errors.** Cancelling the export and dismissing
   the OS folder picker both surface as ❌ *"Download Failed"*, the latter with the raw
   browser string *"The user aborted a request."*
4. **The retry path silently produces a divergent second export.** It clears the original
   log, starts a new anonymization session (new UID mapping), writes a second archive, and
   emits a second manifest that describes only the retried subset.
5. **A green checkmark can be shown for an export containing identifiable data.** Files
   recorded as `NOT ANONYMIZED` do not affect the success banner, which states all files were
   *"successfully saved and verified."*

**Severity legend:** 🔴 blocker for clinical/research use · 🟠 high · 🟡 medium · ⚪ low.

| ID | Finding | Sev |
|---|---|---|
| [UX-01](#ux-01) | Closing the modal does not cancel the export; all subsequent messages are lost | 🔴 |
| [UX-02](#ux-02) | Cancellation is rendered as a failure; the "Download Cancelled" state is unreachable | 🟠 |
| [UX-03](#ux-03) | Successful export can show ✅ "verified" while containing un-anonymized PHI | 🔴 |
| [UX-04](#ux-04) | Stale summary data renders under a fresh error banner | 🟠 |
| [UX-05](#ux-05) | Total failure — the case that most needs retry — offers no retry at all | 🟠 |
| [UX-06](#ux-06) | A network blip is misreported as "Session expired" and kills the whole export | 🔴 |
| [UX-07](#ux-07) | Terminal issues offer no in-place recovery action | 🟠 |
| [UX-08](#ux-08) | Retry erases the log that documents the original failure | 🟠 |
| [UX-09](#ux-09) | Retry starts a new anonymization session → divergent UIDs for one study | 🔴 |
| [UX-10](#ux-10) | Retry writes a second archive with a manifest covering only the retried subset | 🟠 |
| [UX-11](#ux-11) | Side panel is a read-only poller with no failure or terminal state | 🟡 |
| [UX-12](#ux-12) | "Not ready yet" state has no explanation and no retry control | 🟡 |
| [UX-13](#ux-13) | Blocking multi-frame prompt is indistinguishable from a hang | 🟠 |
| [UX-14](#ux-14) | All selection and configuration state is discarded on close | 🟠 |
| [UX-15](#ux-15) | Error copy mixes registers, leaks internals, has no codes and no export | 🟡 |
| [UX-16](#ux-16) | Log identity differs from failed-file identity — the two cannot be correlated | 🟡 |
| [UX-17](#ux-17) | Unbounded log in React state degrades the UI on large exports | 🟠 |
| [UX-18](#ux-18) | ZIP size limit fails at the end of the export instead of warning before it | 🟠 |
| [UX-19](#ux-19) | Finalization can appear frozen for minutes with no progress | 🟡 |
| [UX-20](#ux-20) | Status is invisible to assistive technology; emoji and colour carry meaning alone | 🟠 |
| [UX-21](#ux-21) | Concurrency makes "current item" flicker and hides where failures cluster | ⚪ |
| [UX-22](#ux-22) | Folder export silently overwrites a previous export in the same directory | 🟡 |
| [UX-23](#ux-23) | Quota detection is a substring heuristic that can misdiagnose the failure | 🟡 |
| [UX-24](#ux-24) | The "allow multiple downloads" hint is shown at the start, needed at the end | ⚪ |

---

## Implementation status — UI pass of 2026-07-27

This pass changed the view layer only (`src/components/*`, new `src/report.js`). The export
engine, its error classification, and the anonymization session lifetime are untouched, so
every finding whose cause lives in `downloader.js` is still open.

| ID | Status | What changed |
|---|---|---|
| UX-01 | partial | ESC and overlay click are disabled while `step === 'downloading'` (via the injected `show()`); every terminal outcome is mirrored to `uiNotificationService`, so it is reported even when the modal is gone; `startDownload`'s rejection is caught and `ExportInProgressError` is surfaced as an actionable message. The engine is still bound to the modal's callbacks and the dialog's X still unmounts it. |
| UX-02 | fixed (UI) | Cancel asks for confirmation, states how many files are already saved, and no longer hides the modal. Abort now renders the cancelled summary instead of ❌ *Download Failed*. The engine still rejects rather than resolving; the summary is synthesized from the last progress snapshot. |
| UX-03 | fixed | ✅ requires `notAnonymizedItems.length === 0`; otherwise an amber **Completed — not fully de-identified** banner with the count, plus an always-visible list. The selection step warns before the run when non-DICOM payloads are selected with anonymization on. |
| UX-04 | fixed | `downloadSummary`, `downloadStats`, `downloadError`, `downloadIssue`, logs and prompt are reset together at the start of every run. |
| UX-05 | fixed | The zero-success case now offers **Retry all files**, **Copy report** and **Back to selection**. |
| UX-06 | open | Engine-side classification. |
| UX-07 | partial | **Back to selection** preserves the whole configuration for any terminal issue; issue-specific primary actions (re-pick folder, resume) still need engine support. |
| UX-08 | open | Retry still clears the log. |
| UX-09 | open | Engine-side; retry still starts a new anonymization session. |
| UX-10 | open | Engine-side. |
| UX-11 | partial | The panel shows the failed count, exposes `role="progressbar"`, polls at 500 ms, and confirms before cancelling. It still has no completion or error state and remains a poller. |
| UX-12 | fixed (UI) | A **Check again** control re-reads the payload and enters selection when the study has finished loading. `getDownloadAvailabilityMessage()` still returns `''`. |
| UX-13 | partial | The progress view has an explicit **Awaiting your input** state: the ETA halts, the bar changes, the prompt scrolls into view and takes focus, and the copy says the choice applies to the whole export. No timeout default; the `window.confirm` fallback is unchanged. |
| UX-14 | partial | Configuration survives a failure within the session (**Back to selection**); it is still discarded when the modal closes. |
| UX-15 | partial | Picker dismissal returns to selection with a neutral notice instead of ❌ *"The user aborted a request."*; **Copy report** produces run metadata, counts, per-file causes and the log as text. No stable error codes yet. |
| UX-16 | fixed | One identity string (`report.js:itemIdentityLabel`) shared by the breakdown and the report, prefixed exactly like the activity log, plus a per-image-set grouping ("N file(s) missing from image set 3 — T1 AXIAL"). |
| UX-17 | fixed | Log appends are batched (250 ms) into a bounded 500-entry tail, with the trimmed count shown; filter counts are computed in a single memoized pass. Not virtualized. |
| UX-18 | partial | The exact entry-count limit is pre-flighted at selection and blocks **Start Download** with a one-click switch to folder output. A byte-size estimate is not derivable from the available metadata and was not attempted. |
| UX-19 | partial | Finalization is its own phase with an explanation, a keep-this-tab-open warning, the multiple-download hint, and a disabled Cancel. No byte-level progress. |
| UX-20 | fixed | `role="status"` / `role="alert"` live regions for progress and outcomes, `role="progressbar"` with values, `aria-pressed` on the log filters, `aria-expanded` on every disclosure, `aria-hidden` on decorative glyphs, and text severity prefixes in the log. |
| UX-21 | open | Needs per-series progress from the engine. |
| UX-22 | open | Writer-side. |
| UX-23 | open | Engine-side classification. |
| UX-24 | fixed | The hint is shown as part of the finalization notice, when the browser prompt actually appears. |

---

## Findings

### UX-01
### Closing the modal does not cancel the export, and every subsequent message is lost
**Severity: 🔴 blocker**

`ModalProvider` wires the dialog's `onClose` directly to `hide()`
(`platform/ui-next/src/contextProviders/ModalProvider.tsx:85`), with `shouldCloseOnEsc: true`
by default. `DownloadManagerModal.handleClose` — the only function that aborts the export —
is bound exclusively to the extension's own Cancel buttons. So ESC, an overlay click, or the
dialog's X unmount the modal while `state.activeAbortController` stays live.

Consequences, in order:

- The export keeps running with no visible UI. Files continue to be written; a ZIP finalize
  will eventually fire a browser download with no context for the user.
- `onComplete` / `onError` / `onLog` are delivered to an unmounted component and discarded.
  Nothing is mirrored to `uiNotificationService`, so a failure that occurs after the modal
  closed is invisible everywhere.
- Reopening and pressing **Start Download** hits the guard at `src/downloader.js:31-33`,
  which returns `Promise.reject(ExportInProgressError)`. `DownloadManagerModal.tsx:222` calls
  `startDownload(...)` with **no `.catch()`**, so this becomes an unhandled rejection —
  meanwhile `setStep('downloading')` already ran at line 193. The user is left staring at a
  progress screen that will never receive a single callback.

**Fix**
- Pass `shouldCloseOnEsc: false` / `shouldCloseOnOverlayClick: false` while `step === 'downloading'`, or intercept `onClose` and route it through `handleClose`.
- Better: decouple the export from the modal's lifetime. Keep the engine authoritative, let the modal be a view onto it, and mirror terminal outcomes to `uiNotificationService` so the user is told regardless of which surface is mounted.
- Add `.catch()` on every `startDownload` call site and surface `ExportInProgressError` as an actionable message ("An export is already running — [View progress] [Cancel it]").

---

### UX-02
### Cancellation is rendered as a failure, and the "Download Cancelled" state is unreachable
**Severity: 🟠 high**

`DownloadSummaryView` has a fully-built cancelled branch keyed on `summary.cancelled`
(`src/components/DownloadSummaryView.tsx:58, 95, 104`). It can never render:
`downloadManifest` hard-codes `cancelled: false` (`src/downloader.js:558`), and on abort the
promise **rejects** rather than resolving, so the summary object is never produced at all.

What the user actually gets:

| Cancel from | Result |
|---|---|
| Progress view "Cancel Download" | `onCancel={handleClose}` (`DownloadManagerModal.tsx:513`) aborts **and immediately hides the modal**. No summary. The user never learns how many files were already written to the destination folder. |
| Side panel "Cancel" | `activeAbortController.abort()` (`DownloadManagerPanel.tsx:109`) with no confirmation. The card disappears on the next 1 s poll. If the modal is open it flips to ❌ **"Download Failed — The download was cancelled."** |

Reporting a deliberate user action as a failure is the wrong outcome, and with the folder
writer it is materially misleading: partial files *are* on disk and the user is told nothing
about them.

**Fix**
- Resolve rather than reject on abort, with `cancelled: true` and the real `done`/`failed` counts, so the existing cancelled branch renders.
- Confirm before cancelling: *"N of M files already saved. Stop the download? [Keep what's saved] [Discard and stop] [Continue]"*.
- Do not hide the modal as part of cancelling — show the cancelled summary, then let the user close.

---

### UX-03
### A successful export can show ✅ "successfully saved and verified" while containing un-anonymized PHI
**Severity: 🔴 blocker**

`isCompleteSuccess = hasDoneFiles && !hasFailedFiles && !error && !issue`
(`src/components/DownloadSummaryView.tsx:57`) ignores `anonymizationWarnings` and
`notAnonymizedItems` entirely. An export where every MP4 was written as retrieved — recorded
by `recordNotAnonymized` as *"NOT ANONYMIZED — Patient identity may remain in the frames,
audio, or container metadata"* (`src/downloader.js:358-373`) — still renders the green banner
with the copy *"All N DICOM image file(s) were successfully saved and verified."*

The audit card below it does list the warnings, but it is one of five collapsible cards under
a banner that has already told the user the export is clean. This directly contradicts DM-016
in [`SHORTCOMINGS.md`](./SHORTCOMINGS.md), which requires that such instances "must never be
silently counted as anonymized."

**Fix**
- Add a fourth outcome between complete and partial: **"Completed — not fully de-identified"**, amber, with the count of un-anonymized instances in the banner text, not in a collapsed card.
- Gate the ✅ state on `anonymizationRequested === false || notAnonymizedItems.length === 0`.
- Warn at *selection* time, not after the fact: if the selection contains non-DICOM payloads and anonymization is on, say so before the user starts.

---

### UX-04
### Stale summary data renders under a fresh error banner
**Severity: 🟠 high**

`handleStartDownload` resets logs, error, issue, and the multi-frame prompt
(`DownloadManagerModal.tsx:194-198`) but **not** `downloadSummary` and **not**
`downloadStats`. Both `step === 'complete'` and `step === 'error'` render
`DownloadSummaryView` with whatever `downloadSummary` currently holds
(`DownloadManagerModal.tsx:518-527`).

Reproduction: run 1 partially fails → summary set. Click **Retry Failed Files** → run 2 hits
a terminal issue → `step = 'error'`. The view now shows run 2's red banner above run 1's
metric cards (Saved / Failed / Volume / Duration), run 1's failed-file breakdown, and a
**Retry Failed Files** button wired to run 1's items. Every number on screen belongs to a
different run than the error message above it.

**Fix** — reset `downloadSummary`, `downloadStats`, and `state.downloadIssue` at the start of
every run. Better: hold one `run` object in state and replace it wholesale, so partial resets
are structurally impossible.

---

### UX-05
### Total failure — the case that most needs a retry — offers no retry at all
**Severity: 🟠 high**

When every instance fails, `downloadManifest` throws `IncompleteExportError`
(`src/downloader.js:481-486`) instead of returning a summary. The rejection reaches
`onError`, so `downloadSummary` is never set for that run, so `failedItems` is empty, so
`onRetryFailed` is not passed (`DownloadManagerModal.tsx:525`).

The user sees: ❌ *"All 500 requested instance(s) failed to download; no files were saved."*
and a single **Close** button. No failed-file list, no per-file causes in the breakdown, no
retry — the only place the causes survive is the raw activity log, which is collapsed by
default. Recovery coverage is inverted: a 4 %-failure export gets a retry button, a
100 %-failure export gets nothing.

**Fix** — attach the summary payload to `IncompleteExportError` (or resolve with
`status: 'failed'` and let the view decide). The zero-success case should offer **Retry all**,
**Copy report**, and **Back to selection**.

---

### UX-06
### A transient network error is misreported as "Session expired" and aborts the entire export
**Severity: 🔴 blocker**

`fetchItem`'s own catch (`src/downloader.js:629-637`) runs `isCorsError(error)` before the
retry logic ever sees the error. `isCorsError` matches on substrings including
`'failed to fetch'`, `'load failed'`, and `'network request failed'`
(`src/downloader.js:789-801`) — exactly what a dropped Wi-Fi packet, a proxy hiccup, or one
reset connection produces. The error is rewritten as `SessionExpiredError`, which
`handleTerminalIssue` treats as terminal: `stopAllForIssue` aborts all three workers
(`src/downloader.js:375-384, 723-730`).

Two failures compound:

1. **Wrong diagnosis.** The user is told *"Your viewing session ended while the images were
   downloading. Close this window, reopen the exam, and then try again"* — advice that does
   nothing for a network blip and misleads them into re-authenticating.
2. **Retry is unreachable.** `isRetryableError` explicitly whitelists `error.name === 'TypeError'`
   (`src/downloader.js:821`), but a network `TypeError` is converted before that check, so
   that branch is dead for the case it was written for. A single transient error terminates a
   multi-thousand-file export with zero automatic recovery.

**Fix**
- Only classify as session expiry on actual evidence: a 401/403/3xx response, an
  `opaqueredirect`, or a failed auth-probe request. A bare `TypeError` from `fetch` is a
  network error and must stay retryable.
- Distinguish "connection lost" as its own recoverable state: pause the queue, watch
  `navigator.onLine` / `online` events, and offer **Resume** rather than aborting.
- Never let a per-instance transport error abort an export that has already written files.

---

### UX-07
### Terminal issues state the remediation but do not offer it
**Severity: 🟠 high**

All three issue objects (`src/downloader.js:748-776`) describe an action the UI could take
directly:

| Issue | Message tells the user to… | Available control |
|---|---|---|
| Session expired | close, reopen the exam, try again | **Close** |
| Protected folder | choose a regular folder such as Downloads | **Close** |
| Not enough disk space | start again and choose a folder on a bigger drive | **Close** |

For the folder cases the fix is a single `showDirectoryPicker()` call against a queue that is
still in memory. The user instead loses the run, reopens the modal, and rebuilds the entire
selection (see [UX-14](#ux-14)).

**Fix** — give every issue a primary action: **Choose another folder and continue**,
**Sign in again and resume**, **Reduce selection**. Preserve the queue and the writer so
"continue" means continue, not restart.

---

### UX-08
### Retry erases the log that documents the original failure
**Severity: 🟠 high**

`handleStartDownload` calls `setDownloadLogs([])` (`DownloadManagerModal.tsx:195`) on every
run, including retries. The activity log — the only place per-file causes are recorded in
readable form, and the only evidence available for a support ticket — is destroyed at the
exact moment the user acts on the failure. After the retry the summary shows the retry's log
only; the original 480 successes and 20 causes are gone.

**Fix** — append to a persistent per-session log with run boundaries
(`── Retry 1 · 20 items ──`), or keep prior runs in a per-attempt tab. Never discard
diagnostic history as a side effect of a recovery action.

---

### UX-09
### Retry starts a new anonymization session, producing divergent UIDs for one study
**Severity: 🔴 blocker**

`startDownload` calls `resetAnonymizationSession()` whenever `anonOptions` is present
(`src/downloader.js:92`), and the `finally` block calls it again to clear the mapping from
memory (`src/downloader.js:199-203`). A retry is a fresh `startDownload`, so it builds a
**brand-new UID mapping table**.

Consequently the retried instances receive different anonymous Study/Series/SOP UIDs than
their 480 siblings from the first pass, and are written to different directories — the
folder names are derived from the mapped UIDs (`src/downloader.js:158-170`). One physical
study is split across two anonymous identities that no downstream tool can reassociate. The
UI presents this as a clean ✅ *"Download Complete — All 20 files saved"*.

Note also that the retry path bypasses validation: `validateManifestSelection` iterates
`entry.instances || series.instances`, which manifest items do not have
(`src/manifest.js:424-454`), so it silently returns `[]` for retries.

**Fix**
- Scope the UID mapping to the *export*, not the `startDownload` call. Retries must reuse the
  session; only a genuinely new export may reset it.
- If the mapping cannot be preserved (e.g. after a page reload), the UI must say so and
  refuse the in-place retry rather than producing a split identity: *"The anonymization
  session for this export has ended. A retry would assign new anonymous identifiers. Start a
  new export instead."*

---

### UX-10
### Retry writes a second archive whose manifest covers only the retried subset
**Severity: 🟠 high**

A retry constructs a new writer. With ZIP output that is a second, separate
`ChunkedZipWriter` and a second browser download; with folder output the user is prompted to
pick a destination **again**, with nothing in the UI indicating it must be the same folder as
the first pass. In both cases the run writes a fresh `export-manifest.json` and
`checksums.sha256` describing only the retried items (`src/downloader.js:491-533`).

The user finishes with two archives, two manifests, two checksum files, neither describing
the complete export — and, with anonymization on, two different anonymous identities
([UX-09](#ux-09)). The summary reports each run in isolation and never presents a combined
result.

**Fix** — treat retry as *continuation of the same export*: same writer, same destination
handle, same UID session, one manifest written at the end covering all attempts, and one
cumulative summary ("500 of 500 saved after 2 attempts").

---

### UX-11
### The side panel is a read-only poller with no failure or terminal state
**Severity: 🟡 medium**

`DownloadManagerPanel` polls `state.downloadStats` every 1000 ms
(`DownloadManagerPanel.tsx:22-32`) and renders a progress card. It shows
`done / total saved` and never `stats.failed`, so an export failing every single file is
visually identical to a healthy one. There is no completion state, no error state, and no
issue display — when the engine's `finally` nulls `downloadStats`, the card simply vanishes,
whether the export succeeded, failed, or was cancelled.

The panel's **Cancel** aborts with no confirmation and no acknowledgement
(`DownloadManagerPanel.tsx:109`). Combined with [UX-01](#ux-01), the panel is often the only
mounted surface — and it is the one surface incapable of reporting an outcome.

Secondary: 1 s polling of a mutated global also makes the progress bar visibly laggy relative
to the modal's push-based updates, so the two surfaces disagree while both are open.

**Fix** — subscribe both surfaces to the same event source (a pub/sub on the engine, as OHIF
services already do) and give the panel the full state machine: progress → outcome, with
failure counts, the issue title, and a **View details** affordance that reopens the modal on
the summary.

---

### UX-12
### The "not ready yet" state has no explanation and no retry control
**Severity: 🟡 medium**

`getDownloadAvailabilityMessage()` returns an empty string unconditionally
(`src/ohif-state.js:29-31`), so the `unavailable` step always falls back to the generic
*"Your medical images are not ready yet. Please wait until the viewer finishes loading, then
try again."* (`DownloadManagerModal.tsx:248-250`).

The step is decided once at mount (`useState(() => !payload || !allSeries.length ? …)`) and
never re-evaluated, so even when the study finishes loading two seconds later the modal stays
in the dead state. There is no **Retry** or **Refresh** button; the user must close and
reopen. The gate has several distinct causes — no display sets, display sets without
downloadable URLs, an inactive data source — and none is distinguishable.

**Fix** — subscribe to `displaySetService` events and recover automatically, add an explicit
**Check again** control, and make `getDownloadAvailabilityMessage()` return the actual reason.

---

### UX-13
### The blocking multi-frame prompt is indistinguishable from a hang
**Severity: 🟠 high**

When a multi-frame instance with burned-in annotations is found, all workers await the user's
answer (`src/downloader.js:96-124`). Meanwhile the progress view keeps its last state: the
bar holds its value, the "current file" dot keeps pulsing, and the ETA keeps counting down
toward a completion that cannot occur.

The prompt renders above `DownloadProgressView` inside a scrollable `ScrollArea`
(`DownloadManagerModal.tsx:475-509`). A user who has scrolled to follow the log will not see
it. There is no attention cue, no state change in the progress area, and no timeout.

The choice is also stickier than the copy admits: the resolved method is stored on
`anonOptions.multiFrameRedactionMethod` and reused for the rest of the export
(`src/downloader.js:97-99`), but the dialog presents it as a question about "a multi-frame
DICOM instance". There is no way to revise it.

Note the non-React fallback is a `window.confirm` whose semantics are encoded as
"OK = Aggressive, Cancel = Sampling" (`src/downloader.js:108-116`) — a modal where *Cancel*
silently selects the less safe redaction mode.

**Fix** — put the progress view into an explicit **Awaiting your input** state (halt the ETA,
change the bar styling, scroll the prompt into view, focus it). Say that the choice applies
to the whole export and allow changing it. Add a safe default on timeout (aggressive) with
the countdown visible. Replace the `window.confirm` fallback with a three-option dialog whose
dismissal is not a silent downgrade.

---

### UX-14
### All selection and configuration state is discarded on close
**Severity: 🟠 high**

Series selection, modality toggles, output method, anonymizer configuration, and the PHI
acknowledgement all live in `useState` inside `DownloadManagerModal`, and `payload`/`allSeries`
are captured once with `useMemo(..., [])`. Every close destroys them. Since recovery from
almost every terminal failure means "close and start over" ([UX-07](#ux-07)), the cost of a
failure is the entire configuration effort — which, for a multi-study selection with a custom
tag whitelist, is substantial.

(`anonConfig` and `anonEnabled` are persisted via `anonymizer-config`; selection and output
method are not.)

**Fix** — lift export configuration into module state or a service keyed by study, so
reopening restores the previous selection, and so **Back to selection** from the summary is
possible at all.

---

### UX-15
### Error copy mixes registers, leaks internals, has no codes and no export
**Severity: 🟡 medium**

The extension writes deliberately plain language for expected paths — *"image set 3 /"*,
*"Trying again…"*, *"Preparing your download…"* — and then drops raw engineering strings into
the same red banner:

- *"The user aborted a request."* — the browser's own words, shown as **❌ Download Failed**,
  because the user pressed Escape in the OS folder picker. `showDirectoryPicker`'s
  `AbortError` propagates through `chooseWriter` straight to `onError`
  (`src/downloader.js:269-279`, `184-196`), after `setStep('downloading')` has already run —
  so dismissing a file picker produces a flash of progress followed by a red failure screen.
- *"HTTP 500"* as a per-file cause, with no interpretation.
- *"All N requested instance(s) failed to download"* — the word "instance" is DICOM jargon
  everywhere else translated to "image file".
- A collapsible **stack trace** (`DownloadSummaryView.tsx:146-165`) — useful, but it is the
  only technical artefact offered and it cannot be copied as a report.

There is no error code, no correlation ID, no timestamp of the run, and no **Copy report** or
**Save report** action. Both the log and the failed-file list are `select-text` only; on a
500-line log a user cannot realistically produce a support ticket.

**Fix** — one message model per failure: short cause, plain-language explanation, next action,
stable code (`DM-NET-001`). Treat picker dismissal as a return to selection, not a failure.
Add **Copy report** / **Save report** (JSON + text) covering run metadata, counts, per-file
causes, and the log.

---

### UX-16
### Log identity and failed-file identity use different schemes
**Severity: 🟡 medium**

The activity log labels items via `itemDisplayLabel` — `image set 3 / 1.2.840…7821.dcm`
(`src/downloader.js:859-861`). The failed-file breakdown labels the same items as
`Patient_a1b2c3 / SOP: …3ef9012a45` — patient directory plus the **last 12 characters** of the
SOP UID (`DownloadSummaryView.tsx:190-197`). Neither shows series description or instance
number.

A user reading *"Failed Files Breakdown (20)"* cannot find those files in the log, cannot tell
which series or anatomical region is affected, and cannot judge whether the missing 20 files
matter clinically.

**Fix** — one identity string everywhere: `Series 3 — T1 AXIAL · image 42 of 180`, with the
UID available on hover / in the copied report. Group failures by series in the breakdown and
show "17 of 180 images missing from Series 3".

---

### UX-17
### The unbounded log in React state degrades the UI on large exports
**Severity: 🟠 high**

Every engine event appends via `setDownloadLogs(prev => [...prev, logEntry])`
(`DownloadManagerModal.tsx:203-205`), and the engine logs one `success` line **per file**
(`src/downloader.js:345`). A 5,000-image study therefore performs ~5,000 array copies of an
ever-growing array, each triggering a re-render of a list that renders every entry — no
virtualization, no cap (`DownloadProgressView.tsx:156-171`). The cost is quadratic in file
count, precisely during the period when the UI must stay responsive, and it competes with the
SHA-256 hashing and anonymization work on the same main thread.

The three log filter buttons also recompute `logs.filter(...)` plus two more full passes for
the counts on every render.

**Fix** — cap the in-memory log (ring buffer of ~500 entries with "N earlier entries" and a
full log available for export), batch appends with a flush interval, and virtualize the list.
Consider logging successes only at series granularity.

---

### UX-18
### The ZIP size limit fails at the end of the export instead of warning before it
**Severity: 🟠 high**

`ChunkedZipWriter.write` throws `ZipSizeError` — *"The requested export exceeds the safe
single-archive limit; no archive was downloaded."* — when the running total crosses 700 MB or
60,000 entries (`src/writers/zipWriter.js:35-48`). The check is deliberate (a partial
multi-part archive is too easy to mistake for a complete dataset), but the *timing* is
punitive: the user learns after downloading and anonymizing hundreds of megabytes, and every
byte of that work is discarded.

The information needed to warn earlier is already on screen: the selection step displays
`selectedFilesCount`, and a size estimate is derivable from instance metadata.

**Fix** — estimate export size during selection and show it against the limit
(*"~1.4 GB estimated — exceeds the 700 MB ZIP limit. Save to a folder instead, or reduce the
selection."*). Block **Start Download** with an explanation rather than failing an hour in.
Offer folder output as the one-click alternative where supported.

---

### UX-19
### Finalization can appear frozen for minutes with no progress
**Severity: 🟡 medium**

After the last file, the ZIP writer computes CRC-32 over every entry, assembles the central
directory, and materializes the final blob (`src/writers/zipWriter.js:87-93`,
`188-215`, `412-427`). For a multi-gigabyte export this takes minutes. The UI shows a bar at
100 %, the static line *"Preparing the final verified download file, please wait…"*
(`src/downloader.js:536-540`), and an ETA that has already reached
*"Finalizing output archive…"* (`DownloadProgressView.tsx:48-49`). There is no progress, no
byte counter, and no indication that the tab must stay open.

**Fix** — report finalization progress as its own phase with its own bar, warn that closing
the tab will lose the archive, and disable the controls that imply the export can still be
cancelled cleanly.

---

### UX-20
### Status is invisible to assistive technology; emoji and colour carry meaning alone
**Severity: 🟠 high**

There is no `aria-live`, `role="status"`, `role="alert"`, or `aria-busy` anywhere in the
component tree (verified across `src/components/`). Screen-reader users receive **no**
announcement when the download starts, when files fail, when the multi-frame prompt blocks the
export, or when the export completes or fails.

Additional issues:

- The summary banner's status glyph is a bare emoji in a `<div className="text-3xl">`
  (`DownloadSummaryView.tsx:85-87`) with no `aria-hidden` and no text alternative — announced
  as "check mark button" / "cross mark". (The ⚠️ and 🛡️ glyphs further down *are* correctly
  `aria-hidden`.)
- Log severity is conveyed by colour only (`DownloadProgressView.tsx:157-160`) — no prefix, no
  icon, no `role`.
- The three log filter buttons are plain `<button>` with no `aria-pressed`, so the active
  filter is not exposed.
- Progress is not exposed as a progressbar: no `role="progressbar"`, `aria-valuenow`,
  `aria-valuemax`.

**Fix** — a polite live region for progress milestones and an assertive one for errors and the
blocking prompt; `role="progressbar"` with values; text/icon severity prefixes in the log;
`aria-pressed` on the filters; `aria-hidden` on decorative glyphs with the status in text.

---

### UX-21
### Concurrency makes "current item" flicker and hides where failures cluster
**Severity: ⚪ low**

Three workers share a single mutable `stats.currentItem` string
(`src/downloader.js:285, 394-395`), so the "current file" line jumps between unrelated files
and can read *"Saved …"* while another worker is failing. There is no per-series progress: the
user cannot see that Series 4 is failing wholesale while Series 1–3 are fine, which is exactly
the pattern that indicates a server-side or codec problem worth acting on.

**Fix** — show per-series progress rows (as the series list already exists) with per-series
saved/failed counts, and reduce the single-line "current item" to a summary of active work
("3 files in flight").

---

### UX-22
### Folder export silently overwrites a previous export in the same directory
**Severity: 🟡 medium**

`FolderWriter` creates every directory and file with `create: true`
(`src/writers/folderWriter.js:23-27`) and `pickDirectoryHandle` defaults the picker to the
last used directory (`src/downloader.js:262-268`). Re-running an export into the same folder
silently overwrites same-named files, and — critically — overwrites `export-manifest.json` and
`checksums.sha256`, so the integrity artefacts of the previous export are lost. A user
retrying into the same folder after a partial failure has no way to know whether the manifest
now describes the full set or only the retry ([UX-10](#ux-10)).

**Fix** — detect existing export artefacts in the chosen directory and ask:
**Merge and update manifest** / **Write to a new subfolder** / **Choose another folder**.
Default to a timestamped subfolder.

---

### UX-23
### Quota detection is a substring heuristic that can misdiagnose the failure
**Severity: 🟡 medium**

`isQuotaError` returns true for any error whose message contains `quota`, `disk`, `space`, or
`storage` (`src/downloader.js:803-813`). Any error message that happens to contain one of
those words — including messages from writer internals, extension code, or a localized
browser build — is classified as a terminal disk-space issue, aborts the entire export
(`src/downloader.js:378-379`), and tells the user to *"choose a folder on a drive with more
free space."* If the real cause was a permission or transient write error, that advice sends
them down a dead end.

`isCorsError` has the same shape ([UX-06](#ux-06)).

**Fix** — classify on structure, not prose: `DOMException.name === 'QuotaExceededError'`,
`NotAllowedError`, `NoModificationAllowedError`, HTTP status codes. Use
`navigator.storage.estimate()` to confirm before claiming a space problem, and label anything
unmatched as "Unexpected error" with a report action rather than guessing.

---

### UX-24
### The "allow multiple downloads" hint is shown at the start and needed at the end
**Severity: ⚪ low**

`appendMultipleDownloadNotice` logs *"If your browser asks to allow multiple downloads, choose
Allow…"* as a warning at the moment the ZIP writer is created (`src/downloader.js:250-256`) —
i.e. before the first file is fetched. The browser's download prompt appears at `finalize()`,
potentially an hour later, by which time the hint has scrolled out of a 44 px-tall log box and
is filtered out of the default "All" view among thousands of entries. If the user misses the
browser prompt, the archive is silently blocked and the extension reports success.

**Fix** — show the hint as a persistent notice during finalization, and detect a blocked
download (no `download` event / suppressed popup) to offer a **Download again** control from
the summary.

---

## Prioritized remediation plan

### P0 — correctness of what the user is told
1. [UX-03](#ux-03) — never show ✅ for an export containing un-anonymized instances.
2. [UX-09](#ux-09) — retry must reuse the anonymization session, or be refused with an explanation.
3. [UX-06](#ux-06) — stop misclassifying network errors as session expiry; keep them retryable.
4. [UX-01](#ux-01) — closing the modal must either cancel the export or keep reporting it.
5. [UX-04](#ux-04) — reset run state atomically; never mix two runs on one screen.

### P1 — make recovery possible without starting over
6. [UX-07](#ux-07) — every terminal issue gets a primary recovery action.
7. [UX-05](#ux-05) — total failure gets retry, report, and back-to-selection.
8. [UX-02](#ux-02) — cancellation is an outcome, not an error; confirm, then summarize.
9. [UX-14](#ux-14) — preserve selection and configuration across close and failure.
10. [UX-10](#ux-10) — retry continues the same export: one writer, one manifest, one summary.
11. [UX-18](#ux-18) — pre-flight the ZIP size limit at selection time.

### P2 — comprehensibility and reach of messages
12. [UX-20](#ux-20) — live regions, progressbar semantics, non-colour severity.
13. [UX-13](#ux-13) — explicit awaiting-input state for the multi-frame prompt.
14. [UX-11](#ux-11) — one event source for panel and modal; panel gets outcomes.
15. [UX-08](#ux-08) — persistent, run-segmented log.
16. [UX-15](#ux-15) / [UX-16](#ux-16) — one message model, one identity scheme, copyable report.
17. [UX-17](#ux-17) — bounded, batched, virtualized log.

### P3 — polish
18. [UX-19](#ux-19), [UX-12](#ux-12), [UX-21](#ux-21), [UX-22](#ux-22), [UX-23](#ux-23), [UX-24](#ux-24).

---

## Design principles proposed for this UI

1. **Every message has an addressee that exists.** No outcome may depend on a specific
   component still being mounted. Terminal outcomes are mirrored to
   `uiNotificationService`.
2. **Every failure names its recovery.** If the UI can describe the fix in prose, it can offer
   it as a button.
3. **User intent is never an error.** Cancelling and dismissing a picker are outcomes, not
   failures.
4. **A retry continues; it does not restart.** Same destination, same identity mapping, same
   manifest, cumulative summary.
5. **Green means clean.** The success state asserts both *saved* and *de-identified as
   requested*. Any exception downgrades the banner.
6. **Fail early where the failure is predictable.** Size limits, unsupported outputs, and
   missing capabilities are checked at selection time.
7. **Status is text first.** Colour and emoji are reinforcement, never the only carrier of
   meaning.

---

## References

- Flow diagrams: [`docs/06-ui-error-and-retry-flows.md`](./docs/06-ui-error-and-retry-flows.md)
- Safety / DICOM conformance audit: [`SHORTCOMINGS.md`](./SHORTCOMINGS.md)
- Storage writers and troubleshooting: [`docs/05-storage-directory-layout-troubleshooting.md`](./docs/05-storage-directory-layout-troubleshooting.md)
- OHIF notification service: `platform/core/src/services/UINotificationService`
- OHIF modal provider: `platform/ui-next/src/contextProviders/ModalProvider.tsx`
