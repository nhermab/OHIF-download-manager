import { state, currentPayload, saveLastDirectoryHandle } from './state.js';
import { config } from './config.js';
import { FolderWriter } from './writers/folderWriter.js';
import { ChunkedZipWriter } from './writers/zipWriter.js';
import { buildManifest, fileName, truncateStudyDir, truncateSeriesDir, validateManifestSelection } from './manifest.js';
import {
  errorMessage,
  formatBytes,
  formatTransferSpeed,
  formatDuration,
  escapeHtml,
  createNamedError,
  safeName,
  sanitize,
  shortUid,
} from './utils.js';
import { closeDialog, renderComplete, renderError } from './dialog.js';
import { anonymizeDicom, getMappedUid, resetAnonymizationSession } from './anonymizer.js';
import { authorizationHeaders } from './ohif-state.js';
import { reconstructStaticDicom } from './static-dicom-reconstruction.js';
import dicomParser from 'dicom-parser';

export function startDownload(target, selected, anonOptions, outputMethod = defaultOutputMethod()) {
  if (state.activeAbortController) {
    return Promise.reject(createNamedError('ExportInProgressError', 'An export is already in progress.'));
  }
  const manifestErrors = validateManifestSelection(selected);
  if (manifestErrors.length) {
    const error = createNamedError('ManifestValidationError', manifestErrors.join(' '));
    if (typeof target?.onError === 'function') {
      target.onError(error, null);
      return Promise.resolve(null);
    }
    return Promise.reject(error);
  }
  const manifest = buildManifest(selected);
  if (!manifest.length) {
    return;
  }
  state.downloadIssue = null;
  state.downloadStats = {
    total: manifest.length,
    done: 0,
    failed: 0,
    totalBytes: 0,
    startTime: Date.now(),
    currentItem: 'Preparing your download…',
    writer: null,
  };
  state.activeAbortController = new AbortController();

  const isDomElement = target && typeof target.querySelector === 'function';

  if (isDomElement) {
    target.innerHTML = `<div class="aquest-dm-header">
        <h2 class="aquest-dm-title" id="aquest-dm-title">Downloading medical images</h2>
        <div class="aquest-dm-subtitle"><span data-progress-label>Preparing your download...</span></div>
      </div>
      <div class="aquest-dm-body">
        <div class="aquest-dm-progress">
          <div class="aquest-dm-progress-stats">
            <span data-progress-count>0 / ${manifest.length}</span>
            <span data-progress-bytes>0 B</span>
            <span data-progress-speed>--</span>
          </div>
          <div class="aquest-dm-progress-track"><div class="aquest-dm-progress-bar" data-progress-bar></div></div>
          <div class="aquest-dm-progress-current" data-progress-current>Preparing your download…</div>
          <div class="aquest-dm-log" data-log></div>
        </div>
      </div>
      <div class="aquest-dm-footer">
        <button type="button" class="aquest-dm-secondary" data-action="cancel">Cancel</button>
      </div>`;

    const cancelBtn = target.querySelector('[data-action="cancel"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeDialog);
    }
  }

  updateProgress(target, state.downloadStats);
  appendLog(target, 'Preparing your download…', 'info');

  if (anonOptions) {
    resetAnonymizationSession();

    if (!anonOptions.onPromptMultiFrameMethod) {
      let promptPromise = null;
      anonOptions.onPromptMultiFrameMethod = async ({ numberOfFrames }) => {
        if (anonOptions.multiFrameRedactionMethod && anonOptions.multiFrameRedactionMethod !== 'ask') {
          return anonOptions.multiFrameRedactionMethod;
        }
        if (promptPromise) return promptPromise;

        promptPromise = new Promise(resolve => {
          if (typeof target?.onPromptMultiFrame === 'function') {
            target.onPromptMultiFrame({ numberOfFrames }, method => {
              anonOptions.multiFrameRedactionMethod = method;
              resolve(method);
            });
          } else if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            const useAggressive = window.confirm(
              `Multi-frame DICOM image (${numberOfFrames} frames) with burned-in annotations detected.\n\n` +
              `Do you want to use the AGGRESSIVE method (scans all frames sequentially - recommended to prevent PHI leaks) instead of SAMPLING?\n\n` +
              `Click OK for Aggressive Method, or Cancel for Sampling Method.`
            );
            const choice = useAggressive ? 'aggressive' : 'sampling';
            anonOptions.multiFrameRedactionMethod = choice;
            resolve(choice);
          } else {
            anonOptions.multiFrameRedactionMethod = 'aggressive';
            resolve('aggressive');
          }
        });

        return promptPromise;
      };
    }

    // Identify distinct real patients in multi-study batch selections (F4 fix)
    const patientMap = new Map();
    manifest.forEach(item => {
      const realPatientKey = `${item.rawPatientId || 'UNKNOWN'}|${item.rawPatientName || 'UNKNOWN'}`;
      if (!patientMap.has(realPatientKey)) {
        patientMap.set(realPatientKey, patientMap.size + 1);
      }
    });

    const isMultiPatient = patientMap.size > 1;
    const basePid = sanitize(anonOptions.newPatientId || 'ANON1234', 'ANON1234');
    const basePname = sanitize(anonOptions.newPatientName || 'ANONYMOUS', 'ANONYMOUS');

    manifest.forEach(item => {
      const realPatientKey = `${item.rawPatientId || 'UNKNOWN'}|${item.rawPatientName || 'UNKNOWN'}`;
      const patientIndex = patientMap.get(realPatientKey);

      let itemPid = basePid;
      let itemPname = basePname;
      if (isMultiPatient) {
        itemPid = `${basePid}_P${patientIndex}`;
        itemPname = `${basePname}_P${patientIndex}`;
      }

      item.patientDir = `${itemPid}_${itemPname}`;
      item.itemAnonOptions = {
        ...anonOptions,
        newPatientId: itemPid,
        newPatientName: itemPname,
      };

      if (anonOptions.remapUids !== false) {
        item.studyDir = truncateStudyDir(
          '',
          'ANON_STUDY',
          `ANON_${shortUid(getMappedUid(item.studyUid))}`,
          120
        );
        item.seriesDir = truncateSeriesDir(
          'ANON_SERIES',
          `${String(item.seriesNumber || '1')}_${shortUid(getMappedUid(item.seriesUid))}`,
          120
        );
      }
    });
  }

  chooseWriter(target, anonOptions, outputMethod)
    .then(writer => downloadManifest(manifest, writer, target, state.activeAbortController.signal, anonOptions))
    .then(summary => {
      if (typeof target?.onComplete === 'function') {
        target.onComplete(summary);
      } else if (isDomElement) {
        renderComplete(target, summary);
      }
      return summary;
    })
    .catch(error => {
      if (typeof target?.onError === 'function') {
        target.onError(error, issueForError(error));
      } else if (isDomElement) {
        if (state.downloadIssue) {
          renderError(target, error);
        } else if (error && error.name === 'AbortError') {
          closeDialog();
        } else {
          renderError(target, error);
        }
      }
    })
    .finally(() => {
      state.activeAbortController = null;
      state.downloadStats = null;
      if (anonOptions) {
        // Clean up UID/date reversal maps from heap memory (F7 fix)
        resetAnonymizationSession();
      }
    });
}

export function chooseWriter(dialog, anonOptions, outputMethod = defaultOutputMethod()) {
  const cfg = config();
  const studyLabelText = exportStudyLabel(anonOptions);
  if (outputMethod === 'folder') {
    if (!canUseFolderWriter()) {
      return Promise.reject(
        createNamedError(
          'NotSupportedError',
          'Saving directly to a folder is not supported by this browser. Choose ZIP download instead.'
        )
      );
    }
    return pickDirectoryHandle()
      .then(directory => {
        state.lastDirHandle = directory;
        saveLastDirectoryHandle(directory);
        return new FolderWriter(directory);
      });
  }
  appendMultipleDownloadNotice(dialog);
  return Promise.resolve(
    new ChunkedZipWriter(studyLabelText, cfg.zipChunkBytes, cfg.zipMaxEntries)
  );
}

export function defaultOutputMethod() {
  return canUseFolderWriter() ? 'folder' : 'zip';
}

export function exportStudyLabel(anonOptions) {
  const payload = currentPayload();
  const studies = payload && payload.studies;
  if (studies && studies.length > 1) {
    return `Imaging_${studies.length}_Exams${anonOptions ? '_ANON' : ''}`;
  }
  if (studies && studies.length > 0 && studies[0].StudyInstanceUID) {
    let uid = studies[0].StudyInstanceUID;
    if (anonOptions) uid = getMappedUid(uid);
    return `Imaging_Exam_${safeName(shortUid(uid))}${anonOptions ? '_ANON' : ''}`;
  }
  return `Medical_Images${anonOptions ? '_ANON' : ''}`;
}

export function appendMultipleDownloadNotice(dialog) {
  appendLog(
    dialog,
    'If your browser asks to allow multiple downloads, choose Allow so all parts of the download can be saved.',
    'warning'
  );
}

export function canUseFolderWriter() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function pickDirectoryHandle() {
  const options = { mode: 'readwrite', id: 'aquest-dicom-download' };
  if (state.lastDirHandle) {
    options.startIn = state.lastDirHandle;
  } else {
    options.startIn = 'downloads';
  }
  return window.showDirectoryPicker(options).catch(error => {
    if (error && error.name === 'TypeError' && state.lastDirHandle) {
      return window.showDirectoryPicker({
        mode: 'readwrite',
        id: 'aquest-dicom-download',
        startIn: 'downloads',
      });
    }
    throw error;
  });
}

export function downloadManifest(manifest, writer, dialog, signal, anonOptions) {
  const cfg = config();
  const queue = manifest.map(item => ({ _attempts: 0, ...item }));
  const total = queue.length;
  const parallel = Math.min(3, Math.max(1, Number(cfg.maxParallel) || 3));
  const retryCount = Math.max(0, Number(cfg.retryCount) || 0);
  const stats = state.downloadStats;
  const integrityRecords = [];

  const failedItems = [];
  const anonymizationWarnings = [];
  let doneCount = 0;
  let failedCount = 0;

  if (stats) {
    stats.total = total;
    stats.writer = writer.name;
    stats.currentItem = 'Preparing your downloads…';
  }

  updateProgress(dialog, stats);
  appendLog(dialog, `Saving ${total} image file${total === 1 ? '' : 's'}.`, 'info');

  function scheduleRetry(item, error) {
    item._attempts++;
    const delayMs = retryDelayMs(item._attempts, error?.retryAfterMs);
    appendLog(
      dialog,
      `Trying again: ${itemDisplayLabel(item)} (attempt ${item._attempts + 1} of ${retryCount + 1}) after ${Math.ceil(delayMs / 1000)} seconds.`,
      'warning'
    );
    if (stats) {
      stats.currentItem = `Trying again: ${fileName(item)}`;
    }
    updateProgress(dialog, stats);
    return delay(delayMs).then(() => {
      if (!signal.aborted) queue.push(item);
    });
  }

  function finalizeFailure(item, error) {
    failedCount++;
    const errText = errorMessage(error);
    failedItems.push({ item, error: errText });
    if (stats) {
      stats.failed++;
      stats.currentItem = `Could not download ${fileName(item)}`;
    }
    appendLog(
      dialog,
      `Could not download ${itemDisplayLabel(item)}: ${errText}`,
      'error'
    );
    updateProgress(dialog, stats);
  }

  function finalizeSuccess(item, blob) {
    doneCount++;
    if (stats) {
      stats.done++;
      stats.totalBytes += blob && blob.size ? blob.size : 0;
      stats.currentItem = `Saved ${fileName(item)}`;
    }
    appendLog(dialog, `Saved ${itemDisplayLabel(item)}`, 'success');
    updateProgress(dialog, stats);
  }

  function handleTerminalIssue(error) {
    if (error && error.name === 'SessionExpiredError') {
      stopAllForIssue(sessionExpiredIssue());
    } else if (isQuotaError(error)) {
      stopAllForIssue(storageIssue());
    } else if (error && error.name === 'SecurityError') {
      stopAllForIssue(protectedFolderIssue());
    }
    throw error;
  }

  function worker() {
    if (signal.aborted) {
      return Promise.reject(abortError());
    }
    if (!queue.length) {
      return Promise.resolve();
    }
    const item = queue.shift();
    if (stats) {
      stats.currentItem = `Downloading ${fileName(item)}`;
    }
    updateProgress(dialog, stats);

    return fetchItem(item, signal)
      .then(blob => {
        if (!anonOptions) {
          return blob;
        }
        if (item.extension && item.extension !== 'dcm' && item.extension !== 'dicom') {
          return blob; // Don't anonymize non-DICOM (like mp4)
        }
        return blob.arrayBuffer().then(async buffer => {
          try {
            const baseOptions = item.itemAnonOptions || anonOptions;
            const itemWarnings = [];
            const optsToUse = {
              ...baseOptions,
              warnings: itemWarnings,
              onPixelDataFallback: message => appendLog(dialog, `${itemDisplayLabel(item)}: ${message}`, 'warning'),
            };
            const outBuffer = await anonymizeDicom(buffer, optsToUse);
            if (itemWarnings.length > 0) {
              itemWarnings.forEach(w => anonymizationWarnings.push(`${fileName(item)}: ${w}`));
            }
            if (anonOptions.remapUids !== false) {
              if (item.sopUid) {
                item.sopUid = getMappedUid(item.sopUid);
              }
              if (item.seriesUid) {
                item.seriesUid = getMappedUid(item.seriesUid);
              }
              if (item.studyUid) {
                item.studyUid = getMappedUid(item.studyUid);
              }
            }
            return new Blob([outBuffer], { type: blob.type });
          } catch (err) {
            throw err;
          }
        });
      })
      .then(async blob => {
        const sha256 = await sha256Blob(blob);
        await writer.write(item, blob);
        integrityRecords.push({
          studyInstanceUid: item.studyUid,
          seriesInstanceUid: item.seriesUid,
          sopInstanceUid: item.sopUid,
          file: `${item.patientDir}/${item.studyDir}/${item.seriesDir}/${fileName(item)}`,
          bytes: blob.size,
          sha256,
        });
        return blob;
      })
      .then(blob => {
        finalizeSuccess(item, blob);
      })
      .catch(error => {
        if (error && error.name === 'AbortError') {
          throw error;
        }
        if (
          error &&
          (error.name === 'SessionExpiredError' ||
            error.name === 'SecurityError' ||
            isQuotaError(error))
        ) {
          handleTerminalIssue(error);
        }
        if (item._attempts < retryCount && isRetryableError(error)) {
          return scheduleRetry(item, error);
        }
        finalizeFailure(item, error);
      })
      .then(worker);
  }

  const workers = [];
  for (let i = 0; i < Math.min(parallel, queue.length); i++) {
    workers.push(worker());
  }
  return Promise.all(workers)
    .then(() => {
      if (doneCount === 0 && total > 0) {
        throw createNamedError(
          'IncompleteExportError',
          `All ${total} requested instance(s) failed to download; no files were saved.`
        );
      }

      if (typeof writer.writeArtifact !== 'function') {
        throw createNamedError('IntegrityManifestError', 'The selected export writer cannot record the required integrity manifest.');
      }
      return writer
        .writeArtifact(
          'export-manifest.json',
          new Blob(
            [
              JSON.stringify(
                {
                  format: 'ohif-download-manager-export-manifest-v1',
                  status: failedCount === 0 ? 'complete' : 'partial_success',
                  requested: manifest.map(item => ({
                    studyInstanceUid: item.studyUid,
                    seriesInstanceUid: item.seriesUid,
                    sopInstanceUid: item.sopUid,
                  })),
                  written: integrityRecords,
                  failed: failedItems.map(f => ({
                    studyInstanceUid: f.item.studyUid,
                    seriesInstanceUid: f.item.seriesUid,
                    sopInstanceUid: f.item.sopUid,
                    fileName: fileName(f.item),
                    error: f.error,
                  })),
                },
                null,
                2
              ),
            ],
            { type: 'application/json' }
          )
        )
        .then(() =>
          writer.writeArtifact(
            'checksums.sha256',
            new Blob(
              [integrityRecords.map(record => `${record.sha256}  ${record.file}`).join('\n') + '\n'],
              { type: 'text/plain' }
            )
          )
        )
        .then(() => {
          if (!signal.aborted && writer && typeof writer.finalize === 'function') {
            if (stats && writer.name === 'chunked-zip') {
              stats.currentItem = 'Preparing the final verified download file...';
              appendLog(dialog, 'Preparing the final verified download file, please wait...', 'info');
              updateProgress(dialog, stats);
            }
            return writer.finalize();
          }
          return null;
        });
    })
    .catch(error => {
      if (writer && typeof writer.abort === 'function') {
        writer.abort().catch(() => {});
      }
      throw error;
    })
    .then(() => ({
      done: doneCount,
      failed: failedCount,
      total,
      totalBytes: stats ? stats.totalBytes : 0,
      durationMs: stats ? Date.now() - stats.startTime : 0,
      cancelled: false,
      status: failedCount > 0 ? (doneCount > 0 ? 'partial_success' : 'failed') : 'complete',
      failedItems,
      anonymizationWarnings,
    }));
}

export async function sha256Blob(blob) {
  let buffer;
  if (blob && typeof blob.arrayBuffer === 'function') {
    buffer = await blob.arrayBuffer();
  } else if (typeof Response !== 'undefined') {
    buffer = await new Response(blob).arrayBuffer();
  } else {
    buffer = new ArrayBuffer(0);
  }

  if (globalThis.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  try {
    const req = typeof __webpack_require__ === 'function' ? null : require;
    const nodeCrypto = typeof req === 'function' ? req('crypto') : null;
    if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
      return nodeCrypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
    }
  } catch (ignore) {}
  throw createNamedError('IntegrityManifestError', 'This browser cannot calculate the required SHA-256 export manifest.');
}

export function fetchItem(item, signal) {
  if (item.file && typeof item.file.arrayBuffer === 'function') {
    return validateRetrievedPayload(item, item.file);
  }

  const authHeaders = authorizationHeaders();
  if (item.reconstructFromFrames) {
    return reconstructStaticDicom(item, authHeaders, signal);
  }
  return fetch(item.url, {
    method: 'GET',
    credentials: 'include',
    signal,
    redirect: 'manual',
    headers: {
      ...authHeaders,
      Accept: item.extension === 'mp4' ? 'video/mp4,*/*' : 'application/dicom,*/*',
    },
  })
    .then(response => {
      if (isSessionErrorResponse(response)) {
        throw sessionExpiredError();
      }
      if (!response.ok) {
        const error = createNamedError('HttpError', `HTTP ${response.status}`);
        error.status = response.status;
        error.retryAfterMs = retryAfterMs(response.headers.get('retry-after'));
        throw error;
      }
      const contentType = response.headers.get('content-type') || '';
      if (item.extension === 'mp4') {
        if (!/^video\/mp4(?:;|$)/i.test(contentType)) {
          throw createNamedError('PayloadValidationError', 'Server did not return MP4 video content.');
        }
      } else if (!/^application\/dicom(?:;|$)/i.test(contentType)) {
        throw createNamedError('PayloadValidationError', 'Server did not return DICOM content.');
      }
      return response.blob().then(blob => validateRetrievedPayload(item, blob));
    })
    .catch(error => {
      if (signal.aborted && (!error || error.name !== 'SessionExpiredError')) {
        throw abortError();
      }
      if (isCorsError(error)) {
        throw sessionExpiredError();
      }
      throw error;
    });
}

export async function validateRetrievedPayload(item, blob) {
  if (item.extension === 'mp4') {
    return blob;
  }
  try {
    const dataSet = dicomParser.parseDicom(new Uint8Array(await blob.arrayBuffer()));
    const actual = {
      sopUid: dataSet.string('x00080018'),
      seriesUid: dataSet.string('x0020000e'),
      studyUid: dataSet.string('x0020000d'),
    };
    if (
      actual.sopUid !== item.sopUid ||
      actual.seriesUid !== item.seriesUid ||
      actual.studyUid !== item.studyUid
    ) {
      throw createNamedError('PayloadValidationError', 'Retrieved DICOM instance does not match the requested study, series, and instance UIDs.');
    }
    return blob;
  } catch (error) {
    if (error?.name === 'PayloadValidationError') {
      throw error;
    }
    throw createNamedError('PayloadValidationError', 'Server response is not a parseable DICOM Part 10 instance.');
  }
}

export function updateProgress(target, stats) {
  if (!stats) {
    return;
  }
  if (typeof target?.onProgress === 'function') {
    target.onProgress({ ...stats });
  }
  if (target && typeof target.querySelector === 'function') {
    const completed = stats.done + stats.failed;
    const percent = stats.total ? Math.round((completed * 100) / stats.total) : 0;
    const label = target.querySelector('[data-progress-label]');
    const count = target.querySelector('[data-progress-count]');
    const bytes = target.querySelector('[data-progress-bytes]');
    const speed = target.querySelector('[data-progress-speed]');
    const current = target.querySelector('[data-progress-current]');
    const bar = target.querySelector('[data-progress-bar]');

    if (label) {
      label.textContent = `${completed} / ${stats.total} complete${stats.failed ? `, ${stats.failed} not saved` : ''}`;
    }
    if (count) {
      count.textContent = `${stats.done} saved / ${stats.total}`;
    }
    if (bytes) {
      bytes.textContent = formatBytes(stats.totalBytes);
    }
    if (speed) {
      speed.textContent = formatTransferSpeed(stats.totalBytes, stats.startTime);
    }
    if (current) {
      current.textContent = stats.currentItem || 'Preparing your download…';
    }
    if (bar) {
      bar.style.width = `${percent}%`;
    }
  }
}

export function appendLog(target, message, type) {
  const timestamp = new Date().toLocaleTimeString();
  if (typeof target?.onLog === 'function') {
    target.onLog({ timestamp, message, type: type || 'info' });
  }
  if (target && typeof target.querySelector === 'function') {
    const log = target.querySelector('[data-log]');
    if (!log) {
      return;
    }
    const entry = document.createElement('div');
    entry.className = `aquest-dm-log-entry aquest-dm-log-entry--${type || 'info'}`;
    entry.innerHTML = `<span class="aquest-dm-log-time">[${escapeHtml(timestamp)}]</span>${escapeHtml(message)}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }
}

export function stopAllForIssue(issue) {
  if (!state.downloadIssue) {
    state.downloadIssue = issue;
  }
  if (state.activeAbortController) {
    state.activeAbortController.abort();
  }
}

export function issueForError(error) {
  if (state.downloadIssue) {
    return state.downloadIssue;
  }
  if (error && error.name === 'SessionExpiredError') {
    return sessionExpiredIssue();
  }
  if (error && error.name === 'SecurityError') {
    return protectedFolderIssue();
  }
  if (isQuotaError(error)) {
    return storageIssue();
  }
  return null;
}

export function sessionExpiredIssue() {
  return {
    type: 'session',
    title: 'Session expired',
    message:
      'Your viewing session ended while the images were downloading. Close this window, reopen the exam, and then try again.',
    variant: 'session',
  };
}

export function protectedFolderIssue() {
  return {
    type: 'folder',
    title: 'Protected folder selected',
    message:
      'That folder is protected by your device. Choose a regular folder such as Downloads, or create a new folder there before starting the download again.',
    variant: 'tip',
  };
}

export function storageIssue() {
  return {
    type: 'storage',
    title: 'Not enough disk space',
    message:
      'The selected location does not have enough free space for these images. Start the download again and choose a folder on a drive with more free space.',
    variant: 'tip',
  };
}

export function isSessionErrorResponse(response) {
  if (!response) {
    return false;
  }
  if (response.type === 'opaqueredirect') {
    return true;
  }
  const status = Number(response.status || 0);
  return (status >= 300 && status < 400) || status === 401 || status === 403;
}

export function isCorsError(error) {
  if (!error) {
    return false;
  }
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('cors') ||
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('networkerror when attempting to fetch resource') ||
    message.includes('network request failed')
  );
}

export function isQuotaError(error) {
  const message = errorMessage(error).toLowerCase();
  return (
    !!error &&
    (error.name === 'QuotaExceededError' ||
      message.includes('quota') ||
      message.includes('disk') ||
      message.includes('space') ||
      message.includes('storage'))
  );
}

export function isRetryableError(error) {
  if (!error || isQuotaError(error)) return false;
  if (error.name === 'HttpError') {
    const status = Number(error.status);
    return status === 408 || status === 429 || status >= 500;
  }
  return error.name === 'TypeError';
}

export function retryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.min(Math.max(0, date - Date.now()), 30000);
}

export function retryDelayMs(attempt, retryAfter) {
  if (Number.isFinite(retryAfter)) return retryAfter;
  return Math.min(30000, 500 * 2 ** Math.max(0, attempt - 1));
}

export function delay(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

export function protectedFolderError() {
  return createNamedError('SecurityError', protectedFolderIssue().message);
}

export function sessionExpiredError() {
  return createNamedError('SessionExpiredError', sessionExpiredIssue().message);
}

export function abortError() {
  try {
    return new DOMException('The download was cancelled.', 'AbortError');
  } catch (ignore) {
    const error = new Error('The download was cancelled.');
    error.name = 'AbortError';
    return error;
  }
}

export function itemDisplayLabel(item) {
  return `image set ${safeName(String(item.seriesNumber))} / ${fileName(item)}`;
}

export function triggerBlobDownload(blob, filename) {
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Do not revoke this URL or delete backing OPFS/IndexedDB data on a timer.
  // Firefox can resolve a download lazily after click(), in which case either
  // action turns the archive into a "File not found" blob URL. The document
  // owns the URL for its lifetime; temporary writer data is reclaimed by the
  // next-export orphan cleanup or on an aborted export.
}

export function folderTipMarkup() {
  if (!canUseFolderWriter()) {
    return '';
  }
  return `<div class="aquest-dm-tip">
    <span class="aquest-dm-tip-icon" aria-hidden="true">📁</span>
    <span class="aquest-dm-tip-text">Before the download starts, you will be asked where to save the images. If the browser warns that a folder contains system files, choose a regular folder such as <strong>Downloads</strong> or create a new folder there first.</span>
  </div>`;
}
