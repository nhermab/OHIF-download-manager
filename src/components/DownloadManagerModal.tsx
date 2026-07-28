/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, ScrollArea } from '@ohif/ui-next';
import { currentPayload, state as globalState } from '../downloader/state';
import {
  flattenSeries,
  buildManifest,
  validateManifestSelection,
  availableModalities,
  modalityCodeForEntry,
  studyLabel,
} from '../downloader/manifest';
import {
  loadAnonymizerConfig,
  saveAnonymizerConfig,
  loadAnonymizerEnabled,
  saveAnonymizerEnabled,
} from '../anonymizer/anonymizerConfig';
import { startDownload, canUseFolderWriter, defaultOutputMethod } from '../downloader/downloader';
import { getDownloadAvailabilityMessage } from '../downloader/ohifState';
import { config } from '../config';

import SeriesList from './SeriesList';
import DownloadProgressView from './DownloadProgressView';
import DownloadSummaryView from './DownloadSummaryView';
import AnonymizerPanel from './AnonymizerPanel';
import DicomDiagnosticDialog from './DicomDiagnosticDialog';

interface DownloadManagerModalProps {
  hideModal?: () => void;
  servicesManager?: any;
  /** Injected by ModalProvider — updates the host dialog's options in place. */
  show?: (options: Record<string, unknown>) => void;
}

/**
 * The activity log is unbounded in the engine (one line per file). Keeping all
 * of it in React state re-renders the whole list on every file, so the view
 * keeps a bounded tail and reports how much was trimmed.
 */
const MAX_LOG_ENTRIES = 500;
const LOG_FLUSH_MS = 250;

export default function DownloadManagerModal({
  hideModal,
  servicesManager,
  show,
}: DownloadManagerModalProps) {
  const [payload, setPayload] = useState<any>(() => currentPayload());
  const studies = useMemo(() => payload?.studies || [], [payload]);
  const allSeries = useMemo(() => flattenSeries(studies), [studies]);
  const modalities = useMemo(() => availableModalities(allSeries), [allSeries]);

  // Counted from one manifest pass so the "x of y" totals cannot disagree with
  // the selected count below, which is built the same way.
  const totalFilesAvailable = useMemo(() => buildManifest(allSeries).length, [allSeries]);

  const [step, setStep] = useState<
    'selection' | 'downloading' | 'complete' | 'error' | 'unavailable'
  >(!payload || !allSeries.length ? 'unavailable' : 'selection');

  // Selection state
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<Set<string>>(() => {
    return new Set(allSeries.map(s => s.id));
  });

  const [anonEnabled, setAnonEnabled] = useState<boolean>(() => loadAnonymizerEnabled());
  const [anonConfig, setAnonConfig] = useState<any>(() => loadAnonymizerConfig());
  const [identifiedExportConfirmed, setIdentifiedExportConfirmed] = useState(false);
  const [outputMethod, setOutputMethod] = useState<'folder' | 'zip'>(() => defaultOutputMethod());
  const folderWriterAvailable = canUseFolderWriter();
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [availabilityNotice, setAvailabilityNotice] = useState<string | null>(null);

  // Download Progress state
  const [downloadStats, setDownloadStats] = useState<any>(null);
  const [downloadLogs, setDownloadLogs] = useState<
    Array<{
      timestamp: string;
      message: string;
      type: string;
      dicomDiagnostic?: any;
    }>
  >([]);
  const [droppedLogCount, setDroppedLogCount] = useState(0);
  const [downloadSummary, setDownloadSummary] = useState<any>(null);
  const [downloadError, setDownloadError] = useState<any>(null);
  const [downloadIssue, setDownloadIssue] = useState<any>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [activeDicomDiagnostic, setActiveDicomDiagnostic] = useState<any>(null);

  // Progress arrives faster than React state settles; the outcome handlers need
  // the latest counts synchronously.
  const statsRef = useRef<any>(null);
  const lastRunItemsRef = useRef<any[]>([]);

  const logsRef = useRef<
    Array<{
      timestamp: string;
      message: string;
      type: string;
      dicomDiagnostic?: any;
    }>
  >([]);
  const pendingLogsRef = useRef<
    Array<{
      timestamp: string;
      message: string;
      type: string;
      dicomDiagnostic?: any;
    }>
  >([]);
  const droppedLogsRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);

  const flushLogs = useCallback(() => {
    flushTimerRef.current = null;
    const pending = pendingLogsRef.current;
    if (!pending.length) {
      return;
    }
    pendingLogsRef.current = [];

    let next = logsRef.current.concat(pending);
    if (next.length > MAX_LOG_ENTRIES) {
      droppedLogsRef.current += next.length - MAX_LOG_ENTRIES;
      next = next.slice(next.length - MAX_LOG_ENTRIES);
      setDroppedLogCount(droppedLogsRef.current);
    }
    logsRef.current = next;
    setDownloadLogs(next);
  }, []);

  const scheduleLogFlush = useCallback(() => {
    if (flushTimerRef.current === null) {
      flushTimerRef.current = window.setTimeout(flushLogs, LOG_FLUSH_MS);
    }
  }, [flushLogs]);

  const resetLogs = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingLogsRef.current = [];
    logsRef.current = [];
    droppedLogsRef.current = 0;
    setDownloadLogs([]);
    setDroppedLogCount(0);
  }, []);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  // An export in flight must not be dismissed by ESC or an overlay click: the
  // engine would keep running with no surface reporting it.
  useEffect(() => {
    if (typeof show !== 'function') {
      return;
    }
    const isBusy = step === 'downloading';
    show({ shouldCloseOnEsc: !isBusy, shouldCloseOnOverlayClick: !isBusy });
  }, [show, step]);

  const notify = useCallback(
    (title: string, message: string, type: 'success' | 'warning' | 'error' | 'info') => {
      const notificationService = servicesManager?.services?.uiNotificationService;
      notificationService?.show?.({
        title,
        message,
        type,
        duration: type === 'error' ? 10000 : 5000,
      });
    },
    [servicesManager]
  );

  const closeModal = useCallback(() => {
    if (typeof show === 'function') {
      show({ shouldCloseOnEsc: true, shouldCloseOnOverlayClick: true });
    }
    if (hideModal) {
      hideModal();
    } else if (servicesManager?.services?.uiModalService) {
      servicesManager.services.uiModalService.hide();
    }
  }, [hideModal, servicesManager, show]);

  const handleClose = () => {
    if (globalState.activeAbortController) {
      globalState.activeAbortController.abort();
      globalState.activeAbortController = null;
    }
    closeModal();
  };

  const handleCheckAvailability = () => {
    const nextPayload = currentPayload();
    const nextSeries = flattenSeries(nextPayload?.studies || []);
    setPayload(nextPayload);
    if (nextSeries.length) {
      setSelectedSeriesIds(new Set(nextSeries.map(s => s.id)));
      setAvailabilityNotice(null);
      setStep('selection');
    } else {
      setAvailabilityNotice(
        'The viewer still reports no downloadable images. Wait for the study to finish loading, then check again.'
      );
    }
  };

  const handleToggleSeries = (id: string) => {
    setSelectedSeriesIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedSeriesIds(new Set(allSeries.map(s => s.id)));
  };

  const handleClearSelection = () => {
    setSelectedSeriesIds(new Set());
  };

  const handleToggleModality = (modalityCode: string) => {
    const matchingIds = allSeries
      .filter(s => modalityCodeForEntry(s) === modalityCode)
      .map(s => s.id);

    setSelectedSeriesIds(previousIds => {
      const nextIds = new Set(previousIds);
      const isFullySelected = matchingIds.every(id => previousIds.has(id));

      matchingIds.forEach(id => {
        if (isFullySelected) {
          nextIds.delete(id);
        } else {
          nextIds.add(id);
        }
      });

      return nextIds;
    });
  };

  const handleSelectStudy = (studyIndex: number) => {
    const studySeriesIds = allSeries.filter(s => s.studyIndex === studyIndex).map(s => s.id);
    setSelectedSeriesIds(new Set(studySeriesIds));
  };

  const handleAnonConfigChange = (newConfig: any) => {
    setAnonConfig(newConfig);
    saveAnonymizerConfig(newConfig);
  };

  const handleAnonEnabledChange = (enabled: boolean) => {
    setAnonEnabled(enabled);
    saveAnonymizerEnabled(enabled);
  };

  const selectedSeriesList = useMemo(() => {
    return allSeries.filter(s => selectedSeriesIds.has(s.id));
  }, [allSeries, selectedSeriesIds]);

  const selectedManifest = useMemo(() => buildManifest(selectedSeriesList), [selectedSeriesList]);

  const selectedFilesCount = selectedManifest.length;

  const nonDicomSelectedCount = useMemo(
    () =>
      selectedManifest.filter(
        item => item.extension && item.extension !== 'dcm' && item.extension !== 'dicom'
      ).length,
    [selectedManifest]
  );

  const manifestErrors = useMemo(
    () => validateManifestSelection(selectedSeriesList),
    [selectedSeriesList]
  );

  // The ZIP writer refuses to emit a partial multi-part archive, so an export
  // over the entry limit fails after every file has been fetched. The limit is
  // exact and known here: say so before the run instead of an hour into it.
  const zipMaxEntries = useMemo(() => Number(config().zipMaxEntries) || 60000, []);
  const exceedsZipEntryLimit = outputMethod === 'zip' && selectedFilesCount + 2 > zipMaxEntries;

  const modalitySelections = useMemo(
    () =>
      modalities.map(modality => {
        const matchingSeries = allSeries.filter(
          series => modalityCodeForEntry(series) === modality.code
        );
        const selectedCount = matchingSeries.reduce(
          (count, series) => count + Number(selectedSeriesIds.has(series.id)),
          0
        );
        const totalCount = matchingSeries.length;

        return {
          ...modality,
          selectedCount,
          totalCount,
          state:
            selectedCount === 0
              ? ('none' as const)
              : selectedCount === totalCount
                ? ('all' as const)
                : ('some' as const),
        };
      }),
    [allSeries, modalities, selectedSeriesIds]
  );

  const [multiFramePrompt, setMultiFramePrompt] = useState<{
    numberOfFrames: number;
    resolve: (method: string) => void;
  } | null>(null);

  const multiFramePromptRef = useRef<HTMLDivElement>(null);

  // The prompt blocks every worker, so it must not be possible to miss it in a
  // scrolled log.
  useEffect(() => {
    if (!multiFramePrompt || !multiFramePromptRef.current) {
      return;
    }
    multiFramePromptRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const firstButton = multiFramePromptRef.current.querySelector('button');
    if (firstButton instanceof HTMLElement) {
      firstButton.focus();
    }
  }, [multiFramePrompt]);

  const handleStartDownload = (customTargetItems?: any) => {
    const itemsToDownload = Array.isArray(customTargetItems)
      ? customTargetItems
      : selectedSeriesList;
    if (!itemsToDownload || itemsToDownload.length === 0) return;

    lastRunItemsRef.current = itemsToDownload;
    statsRef.current = null;

    setStep('downloading');
    resetLogs();
    // Reset every artefact of the previous run together: a stale summary under a
    // fresh error banner mixes two runs on one screen.
    setDownloadStats(null);
    setDownloadSummary(null);
    setDownloadError(null);
    setDownloadIssue(null);
    setMultiFramePrompt(null);
    setConfirmCancel(false);
    setSelectionNotice(null);
    setRunStartedAt(Date.now());
    globalState.downloadIssue = null;

    const targetCallbacks = {
      onProgress: (stats: any) => {
        statsRef.current = stats;
        setDownloadStats(stats);
      },
      onLog: (logEntry: {
        timestamp: string;
        message: string;
        type: string;
        dicomDiagnostic?: any;
      }) => {
        pendingLogsRef.current.push(logEntry);
        scheduleLogFlush();
      },
      onComplete: (summary: any) => {
        flushLogs();
        setDownloadSummary(summary);
        setStep('complete');
        setMultiFramePrompt(null);
        setConfirmCancel(false);

        const notAnonymized = summary?.notAnonymizedItems?.length || 0;
        if (summary?.failed > 0) {
          notify(
            'Download completed with failures',
            `${summary.done} of ${summary.total} files were saved. ${summary.failed} file(s) failed.`,
            'warning'
          );
        } else if (notAnonymized > 0) {
          notify(
            'Download completed — not fully de-identified',
            `${summary.done} file(s) saved, of which ${notAnonymized} were exported without de-identification.`,
            'warning'
          );
        } else {
          notify('Download complete', `${summary?.done || 0} file(s) were saved.`, 'success');
        }
      },
      onError: (err: any, issue: any) => {
        flushLogs();
        setMultiFramePrompt(null);
        setConfirmCancel(false);

        const stats = statsRef.current;
        const isUserAbort = err?.name === 'AbortError' && !issue;

        if (isUserAbort && !stats?.writer) {
          // The destination picker was dismissed before anything was fetched.
          // That is a change of mind, not a failure — keep the configuration.
          setStep('selection');
          setSelectionNotice(
            'No destination was chosen, so nothing was downloaded. Your selection and settings are unchanged.'
          );
          return;
        }

        if (isUserAbort) {
          // Render the cancelled outcome instead of a red failure banner, and
          // account for the files already written to the destination.
          setDownloadSummary({
            cancelled: true,
            done: stats?.done || 0,
            failed: stats?.failed || 0,
            total: stats?.total || 0,
            totalBytes: stats?.totalBytes || 0,
            durationMs: stats?.startTime ? Date.now() - stats.startTime : 0,
            status: 'cancelled',
            failedItems: [],
            anonymizationWarnings: [],
            notAnonymizedItems: [],
          });
          setDownloadError(null);
          setDownloadIssue(null);
          setStep('complete');
          notify(
            'Download cancelled',
            `${stats?.done || 0} of ${stats?.total || 0} files were saved before the download stopped.`,
            'warning'
          );
          return;
        }

        setDownloadError(err);
        setDownloadIssue(issue);
        setStep('error');
        notify(
          issue?.title || 'Download failed',
          issue?.message || err?.message || 'The export could not be completed.',
          'error'
        );
      },
      onPromptMultiFrame: ({ numberOfFrames }: any, resolve: (method: string) => void) => {
        setMultiFramePrompt({ numberOfFrames, resolve });
      },
    };

    const started = startDownload(
      targetCallbacks,
      itemsToDownload,
      anonEnabled ? anonConfig : null,
      outputMethod
    );

    // startDownload rejects synchronously when an export is already running;
    // without this the modal would sit on a progress view that never updates.
    if (started && typeof started.catch === 'function') {
      started.catch((err: any) => {
        if (err?.name === 'ExportInProgressError') {
          setStep('selection');
          setSelectionNotice(
            'Another export is still running. Wait for it to finish, or cancel it from the Download Manager panel, and then start this one.'
          );
          notify('Export already running', 'Only one export can run at a time.', 'warning');
          return;
        }
        setDownloadError(err);
        setDownloadIssue(null);
        setStep('error');
      });
    }
  };

  const handleRetryFailed = () => {
    const failedItems = downloadSummary?.failedItems?.map((f: any) => f.item) || [];
    if (failedItems.length > 0) {
      handleStartDownload(failedItems);
    }
  };

  const handleRetryAll = () => {
    if (lastRunItemsRef.current?.length) {
      handleStartDownload(lastRunItemsRef.current);
    }
  };

  const handleBackToSelection = () => {
    setStep('selection');
    setDownloadError(null);
    setDownloadIssue(null);
    setDownloadSummary(null);
    setDownloadStats(null);
    setSelectionNotice(null);
  };

  const handleRequestCancel = () => setConfirmCancel(true);

  const handleConfirmCancel = () => {
    setConfirmCancel(false);
    if (globalState.activeAbortController) {
      globalState.activeAbortController.abort();
    }
  };

  const showBackToSelection =
    step === 'error' || Boolean(downloadSummary?.cancelled) || downloadSummary?.failed > 0;

  return (
    <div className="text-foreground flex h-[calc(90vh-6.5rem)] max-h-[796px] min-h-0 flex-col">
      <div className="text-muted-foreground mb-3 text-sm">
        {studies.length === 1
          ? studyLabel(studies[0])
          : `${studies.length} medical exams available`}
      </div>

      <ScrollArea
        className="min-h-0 flex-1 pr-3"
        type="always"
        showArrows
      >
        <div className="space-y-4 pb-1">
          {step === 'unavailable' && (
            <div
              className="border-primary/30 bg-primary/10 text-foreground space-y-3 rounded border p-4 text-sm"
              role="status"
            >
              <p>
                {availabilityNotice ||
                  getDownloadAvailabilityMessage() ||
                  'Your medical images are not ready yet. Please wait until the viewer finishes loading, then check again.'}
              </p>
              <Button
                onClick={handleCheckAvailability}
                variant="outline"
                size="sm"
              >
                Check again
              </Button>
            </div>
          )}

          {step === 'selection' && (
            <div className="space-y-4">
              {selectionNotice && (
                <div
                  className="border-primary/30 bg-primary/10 text-foreground rounded border p-3 text-sm"
                  role="status"
                  aria-live="polite"
                >
                  {selectionNotice}
                </div>
              )}

              {folderWriterAvailable && (
                <div className="border-primary/30 bg-primary/10 text-muted-foreground flex items-start gap-2 rounded border p-3 text-sm">
                  <span aria-hidden="true">📁</span>
                  <span>
                    Before the download starts, you will be asked where to save the images. Select a
                    regular folder such as <strong>Downloads</strong> or create a new folder.
                  </span>
                </div>
              )}

              <fieldset className="space-y-2 rounded border p-3 text-sm">
                <legend className="px-1 font-medium">Save format</legend>
                {folderWriterAvailable && (
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      name="download-output-method"
                      value="folder"
                      checked={outputMethod === 'folder'}
                      onChange={() => setOutputMethod('folder')}
                      className="mt-0.5"
                    />
                    <span>
                      <strong>Save files to a folder</strong>
                      <span className="text-muted-foreground block">
                        Choose a destination folder and save the DICOM files individually.
                      </span>
                    </span>
                  </label>
                )}
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name="download-output-method"
                    value="zip"
                    checked={outputMethod === 'zip'}
                    onChange={() => setOutputMethod('zip')}
                    className="mt-0.5"
                  />
                  <span>
                    <strong>Download a ZIP file</strong>
                    <span className="text-muted-foreground block">
                      Download all selected files together in one archive.
                    </span>
                  </span>
                </label>
                {!folderWriterAvailable && (
                  <p className="text-muted-foreground">
                    Your browser does not support saving directly to a folder, so ZIP download is
                    used.
                  </p>
                )}
              </fieldset>

              {/* Selection Toolbar */}
              <div className="border-input bg-background flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-2">
                  <span>
                    <strong className="text-foreground font-semibold">
                      {selectedSeriesList.length}
                    </strong>{' '}
                    of {allSeries.length} series
                  </span>
                  <span aria-hidden="true">•</span>
                  <span>
                    <strong className="text-foreground font-semibold">{selectedFilesCount}</strong>{' '}
                    of {totalFilesAvailable} image files
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleSelectAll}
                    disabled={selectedSeriesIds.size === allSeries.length}
                    variant="link"
                    size="sm"
                  >
                    Select all
                  </Button>
                  <span className="text-muted-foreground">|</span>
                  <Button
                    onClick={handleClearSelection}
                    disabled={selectedSeriesIds.size === 0}
                    variant="link"
                    size="sm"
                  >
                    Clear selection
                  </Button>
                </div>
              </div>

              {/* Multi-select modality toggles */}
              {modalitySelections.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground mr-1">Select by type:</span>
                  <div
                    className="flex flex-wrap items-center gap-1.5"
                    role="group"
                    aria-label="Select series by type"
                  >
                    {modalitySelections.map(modality => {
                      const isAllSelected = modality.state === 'all';
                      const isPartiallySelected = modality.state === 'some';
                      const nextAction = isAllSelected ? 'Deselect' : 'Select';

                      return (
                        <Button
                          key={modality.code}
                          onClick={() => handleToggleModality(modality.code)}
                          variant={isAllSelected ? 'default' : 'outline'}
                          size="sm"
                          className={`gap-1.5 rounded-full ${
                            isPartiallySelected
                              ? 'border-primary bg-primary/20 text-primary hover:bg-primary/30'
                              : isAllSelected
                                ? ''
                                : 'text-muted-foreground'
                          }`}
                          aria-pressed={isPartiallySelected ? 'mixed' : isAllSelected}
                          title={`${nextAction} all ${modality.totalCount} ${modality.label} series`}
                        >
                          <span
                            className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${
                              isAllSelected
                                ? 'border-primary-foreground/70'
                                : isPartiallySelected
                                  ? 'border-primary'
                                  : 'border-muted-foreground/70'
                            }`}
                            aria-hidden="true"
                          >
                            {isAllSelected && (
                              <svg
                                className="h-3 w-3"
                                viewBox="0 0 16 16"
                                fill="none"
                              >
                                <path
                                  d="m3.5 8 3 3 6-6"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                            {isPartiallySelected && (
                              <span className="bg-primary h-0.5 w-2 rounded-full" />
                            )}
                          </span>
                          <span>{modality.label}</span>
                          <span
                            className={`rounded-full px-1.5 text-[11px] ${
                              isAllSelected ? 'bg-background/20' : 'bg-primary/10'
                            }`}
                          >
                            {modality.selectedCount}/{modality.totalCount}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              <AnonymizerPanel
                config={anonConfig}
                enabled={anonEnabled}
                onChangeConfig={handleAnonConfigChange}
                onChangeEnabled={handleAnonEnabledChange}
              />

              {anonEnabled ? (
                <div className="border-primary/30 bg-primary/10 text-foreground rounded border p-3 text-sm">
                  Client-side anonymization is enabled. Unsupported pixel formats, ambiguous
                  encapsulation, and unverified clean-pixel results fail closed and do not create
                  de-identification provenance claims.
                </div>
              ) : (
                <label className="text-foreground flex items-start gap-2 rounded border p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={identifiedExportConfirmed}
                    onChange={event => setIdentifiedExportConfirmed(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I understand that this export may contain protected health information and I am
                    authorized to save it to the selected destination.
                  </span>
                </label>
              )}

              {/* Warn before the export, not in the summary afterwards. */}
              {anonEnabled && nonDicomSelectedCount > 0 && (
                <div className="text-foreground flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <span aria-hidden="true">🛡️</span>
                  <span>
                    <strong>
                      {nonDicomSelectedCount} selected file(s) cannot be de-identified.
                    </strong>{' '}
                    Video and other non-DICOM payloads have no de-identification path here and will
                    be exported exactly as retrieved, so patient identity may remain in the frames,
                    audio, or container metadata. Deselect them if the export must be fully
                    de-identified.
                  </span>
                </div>
              )}

              {exceedsZipEntryLimit && (
                <div
                  className="border-destructive/50 bg-destructive/10 text-foreground space-y-2 rounded border p-3 text-sm"
                  role="alert"
                >
                  <p>
                    <strong>
                      This selection is too large for a single ZIP archive ({selectedFilesCount}{' '}
                      files, limit {zipMaxEntries}).
                    </strong>{' '}
                    The archive would be rejected only after every file had been downloaded, so the
                    export is blocked here instead.
                  </p>
                  {folderWriterAvailable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOutputMethod('folder')}
                    >
                      Save to a folder instead
                    </Button>
                  ) : (
                    <p>Reduce the selection to continue.</p>
                  )}
                </div>
              )}

              {manifestErrors.length > 0 && (
                <div
                  className="border-destructive/50 bg-destructive/10 text-foreground rounded border p-3 text-sm"
                  role="alert"
                >
                  <strong>This selection cannot be exported.</strong>
                  <ul className="mt-1 list-inside list-disc">
                    {manifestErrors.map(error => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Series List */}
              <div className="space-y-2">
                <span className="text-muted-foreground text-sm font-medium">
                  Select DICOM series
                </span>
                <SeriesList
                  studies={studies}
                  allSeries={allSeries}
                  selectedSeriesIds={selectedSeriesIds}
                  onToggleSeries={handleToggleSeries}
                  onSelectStudy={handleSelectStudy}
                />
              </div>
            </div>
          )}

          {step === 'downloading' && (
            <div className="space-y-4">
              {multiFramePrompt && (
                <div
                  ref={multiFramePromptRef}
                  role="alert"
                  aria-live="assertive"
                  className="text-foreground space-y-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
                >
                  <div className="flex items-center gap-2 font-semibold text-amber-500">
                    <span aria-hidden="true">⚠️</span>
                    <span>Multi-Frame DICOM Redaction Mode Required</span>
                  </div>
                  <p>
                    A multi-frame DICOM instance ({multiFramePrompt.numberOfFrames} frames) with
                    burned-in annotations was detected. The export is paused until you choose how
                    pixel redaction should scan these frames. Your choice applies to every
                    multi-frame instance in this export.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => {
                        const res = multiFramePrompt.resolve;
                        setMultiFramePrompt(null);
                        res('aggressive');
                      }}
                    >
                      Aggressive (Scan All Frames Sequentially - Recommended)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const res = multiFramePrompt.resolve;
                        setMultiFramePrompt(null);
                        res('sampling');
                      }}
                    >
                      Sampling (Scan Key Frames Only)
                    </Button>
                  </div>
                </div>
              )}

              {confirmCancel && (
                <div
                  role="alertdialog"
                  aria-label="Stop the download?"
                  className="text-foreground space-y-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                >
                  <p>
                    <strong>Stop this download?</strong>{' '}
                    {downloadStats
                      ? `${downloadStats.done || 0} of ${downloadStats.total || 0} files have already been saved to your destination and will stay there.`
                      : 'Nothing has been saved yet.'}{' '}
                    The remaining files will not be downloaded.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleConfirmCancel}
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    >
                      Stop download
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setConfirmCancel(false)}
                    >
                      Continue downloading
                    </Button>
                  </div>
                </div>
              )}

              <DownloadProgressView
                stats={downloadStats}
                logs={downloadLogs}
                droppedLogCount={droppedLogCount}
                awaitingInput={Boolean(multiFramePrompt)}
                onCancel={handleRequestCancel}
                onInspectDicom={setActiveDicomDiagnostic}
              />
            </div>
          )}

          {(step === 'complete' || step === 'error') && (
            <DownloadSummaryView
              summary={downloadSummary}
              error={downloadError}
              issue={downloadIssue}
              logs={downloadLogs}
              droppedLogCount={droppedLogCount}
              startedAt={runStartedAt || undefined}
              onClose={handleClose}
              onRetryFailed={
                downloadSummary?.failedItems?.length > 0 ? handleRetryFailed : undefined
              }
              onRetryAll={
                step === 'error' &&
                !downloadSummary?.failedItems?.length &&
                lastRunItemsRef.current?.length
                  ? handleRetryAll
                  : undefined
              }
              onBackToSelection={showBackToSelection ? handleBackToSelection : undefined}
              onInspectDicom={setActiveDicomDiagnostic}
            />
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      {step === 'selection' && (
        <div className="border-input mt-4 flex shrink-0 items-center justify-between border-t pt-4">
          <Button
            onClick={handleClose}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleStartDownload()}
            disabled={
              selectedFilesCount === 0 ||
              (!anonEnabled && !identifiedExportConfirmed) ||
              manifestErrors.length > 0 ||
              exceedsZipEntryLimit
            }
            className="gap-1.5"
          >
            <svg
              className="h-4 w-4"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Start Download ({selectedFilesCount} Files)
          </Button>
        </div>
      )}

      {activeDicomDiagnostic && (
        <DicomDiagnosticDialog
          diagnostic={activeDicomDiagnostic}
          onClose={() => setActiveDicomDiagnostic(null)}
        />
      )}
    </div>
  );
}
