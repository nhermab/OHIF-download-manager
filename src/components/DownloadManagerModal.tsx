import React, { useMemo, useState } from 'react';
import { Button, ScrollArea } from '@ohif/ui-next';
import { currentPayload, state as globalState } from '../state';
import {
  flattenSeries,
  buildManifest,
  validateManifestSelection,
  availableModalities,
  modalityCodeForEntry,
  studyLabel,
} from '../manifest';
import {
  loadAnonymizerConfig,
  saveAnonymizerConfig,
  loadAnonymizerEnabled,
  saveAnonymizerEnabled,
} from '../anonymizer-config';
import { startDownload, canUseFolderWriter, defaultOutputMethod } from '../downloader';
import { getDownloadAvailabilityMessage } from '../ohif-state';

import SeriesList from './SeriesList';
import DownloadProgressView from './DownloadProgressView';
import DownloadSummaryView from './DownloadSummaryView';
import AnonymizerPanel from './AnonymizerPanel';

interface DownloadManagerModalProps {
  hideModal?: () => void;
  servicesManager?: any;
}

export default function DownloadManagerModal({
  hideModal,
  servicesManager,
}: DownloadManagerModalProps) {
  const payload = useMemo(() => currentPayload(), []);
  const studies = payload?.studies || [];
  const allSeries = useMemo(() => flattenSeries(studies), [studies]);
  const modalities = useMemo(() => availableModalities(allSeries), [allSeries]);

  const totalFilesAvailable = useMemo(
    () => allSeries.reduce((sum, s) => sum + buildManifest([s]).length, 0),
    [allSeries]
  );

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

  // Download Progress state
  const [downloadStats, setDownloadStats] = useState<any>(null);
  const [downloadLogs, setDownloadLogs] = useState<
    Array<{ timestamp: string; message: string; type: string }>
  >([]);
  const [downloadSummary, setDownloadSummary] = useState<any>(null);
  const [downloadError, setDownloadError] = useState<any>(null);
  const [downloadIssue, setDownloadIssue] = useState<any>(null);

  const handleClose = () => {
    if (globalState.activeAbortController) {
      globalState.activeAbortController.abort();
      globalState.activeAbortController = null;
    }
    if (hideModal) {
      hideModal();
    } else if (servicesManager?.services?.uiModalService) {
      servicesManager.services.uiModalService.hide();
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

  const selectedFilesCount = useMemo(() => {
    return selectedSeriesList.reduce((sum, s) => sum + buildManifest([s]).length, 0);
  }, [selectedSeriesList]);

  const manifestErrors = useMemo(
    () => validateManifestSelection(selectedSeriesList),
    [selectedSeriesList]
  );

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

  const handleStartDownload = (customTargetItems?: any) => {
    const itemsToDownload = Array.isArray(customTargetItems)
      ? customTargetItems
      : selectedSeriesList;
    if (!itemsToDownload || itemsToDownload.length === 0) return;

    setStep('downloading');
    setDownloadLogs([]);
    setDownloadError(null);
    setDownloadIssue(null);
    setMultiFramePrompt(null);

    const targetCallbacks = {
      onProgress: (stats: any) => {
        setDownloadStats(stats);
      },
      onLog: (logEntry: { timestamp: string; message: string; type: string }) => {
        setDownloadLogs(prev => [...prev, logEntry]);
      },
      onComplete: (summary: any) => {
        setDownloadSummary(summary);
        setStep('complete');
        setMultiFramePrompt(null);
      },
      onError: (err: any, issue: any) => {
        setDownloadError(err);
        setDownloadIssue(issue);
        setStep('error');
        setMultiFramePrompt(null);
      },
      onPromptMultiFrame: ({ numberOfFrames }: any, resolve: (method: string) => void) => {
        setMultiFramePrompt({ numberOfFrames, resolve });
      },
    };

    startDownload(targetCallbacks, itemsToDownload, anonEnabled ? anonConfig : null, outputMethod);
  };

  const handleRetryFailed = () => {
    const failedItems = downloadSummary?.failedItems?.map((f: any) => f.item) || [];
    if (failedItems.length > 0) {
      handleStartDownload(failedItems);
    }
  };

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
            <div className="border-primary/30 bg-primary/10 text-foreground rounded border p-4 text-sm">
              {getDownloadAvailabilityMessage() ||
                'Your medical images are not ready yet. Please wait until the viewer finishes loading, then try again.'}
            </div>
          )}

          {step === 'selection' && (
            <div className="space-y-4">
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
                    Your browser does not support saving directly to a folder, so ZIP download is used.
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

              {manifestErrors.length > 0 && (
                <div className="border-destructive/50 bg-destructive/10 text-foreground rounded border p-3 text-sm">
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
                <div className="border-amber-500/40 bg-amber-500/10 text-foreground space-y-2 rounded border p-3 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-amber-500">
                    <span>⚠️</span>
                    <span>Multi-Frame DICOM Redaction Mode Required</span>
                  </div>
                  <p>
                    A multi-frame DICOM instance ({multiFramePrompt.numberOfFrames} frames) with burned-in annotations was detected.
                    Select how pixel redaction should scan these frames:
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
              <DownloadProgressView
                stats={downloadStats}
                logs={downloadLogs}
                onCancel={handleClose}
              />
            </div>
          )}

          {(step === 'complete' || step === 'error') && (
            <DownloadSummaryView
              summary={downloadSummary}
              error={downloadError}
              issue={downloadIssue}
              logs={downloadLogs}
              onClose={handleClose}
              onRetryFailed={downloadSummary?.failedItems?.length > 0 ? handleRetryFailed : undefined}
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
            onClick={handleStartDownload}
            disabled={selectedFilesCount === 0 || (!anonEnabled && !identifiedExportConfirmed) || manifestErrors.length > 0}
            className="gap-1.5"
          >
            <svg
              className="h-4 w-4"
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
    </div>
  );
}
