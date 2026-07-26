import React, { useState, useEffect } from 'react';
import { Button } from '@ohif/ui-next';
import { currentPayload, state as globalState } from '../state';
import { flattenSeries, buildManifest, studyLabel } from '../manifest';
import DownloadManagerModal from './DownloadManagerModal';

export default function DownloadManagerPanel({
  servicesManager,
  commandsManager,
}: {
  servicesManager?: any;
  commandsManager?: any;
}) {
  const [payload, setPayload] = useState<any>(() => currentPayload());
  const [activeStats, setActiveStats] = useState<any>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setPayload(currentPayload());
      if (globalState.downloadStats) {
        setActiveStats({ ...globalState.downloadStats });
      } else {
        setActiveStats(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const studies = payload?.studies || [];
  const allSeries = flattenSeries(studies);
  const totalFiles = allSeries.reduce((sum, s) => sum + buildManifest([s]).length, 0);

  const handleOpenModal = () => {
    if (commandsManager) {
      commandsManager.runCommand('openDownloadManager');
    } else if (servicesManager?.services?.uiModalService) {
      servicesManager.services.uiModalService.show({
        title: 'Download Medical Images',
        content: DownloadManagerModal,
        contentProps: {
          servicesManager,
          hideModal: () => servicesManager.services.uiModalService.hide(),
        },
        containerClassName:
          'w-[min(96vw,1024px)] max-w-5xl h-[90vh] max-h-[900px] overflow-hidden p-4 sm:p-6',
      });
    }
  };

  return (
    <div className="bg-secondary-dark text-foreground flex h-full select-none flex-col space-y-4 overflow-y-auto p-4">
      {/* Header */}
      <div className="border-primary-dark flex items-center justify-between border-b pb-3">
        <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
          <svg
            className="text-primary h-5 w-5"
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
          Download Manager
        </h2>
        <Button onClick={handleOpenModal}>Open Downloader</Button>
      </div>

      {/* Active Download Progress Card */}
      {activeStats ? (
        <div className="border-primary bg-background space-y-2 rounded border p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-foreground font-semibold">Active download</span>
            <span className="border-primary/30 bg-primary/20 text-primary animate-pulse rounded border px-2 py-0.5 text-[10px] font-bold uppercase">
              In Progress
            </span>
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {activeStats.currentItem || 'Downloading DICOM files…'}
          </div>
          <div className="border-input bg-background h-2 w-full overflow-hidden rounded-full border">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{
                width: `${
                  activeStats.total
                    ? Math.round(
                        ((activeStats.done + activeStats.failed) * 100) / activeStats.total
                      )
                    : 0
                }%`,
              }}
            />
          </div>
          <div className="text-muted-foreground flex justify-between text-xs">
            <span>
              {activeStats.done} / {activeStats.total} saved
            </span>
            <Button
              onClick={() => globalState.activeAbortController?.abort()}
              variant="link"
              size="sm"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {/* Study Overview Summary */}
      <div className="border-primary-dark bg-background space-y-2 rounded border p-3.5">
        <span className="text-muted-foreground block text-xs font-medium">
          Loaded study overview
        </span>
        {studies.length === 0 ? (
          <p className="text-muted-foreground text-xs italic">No active study loaded in viewer.</p>
        ) : (
          <div className="space-y-2 text-xs">
            {studies.map((s: any, idx: number) => (
              <div
                key={idx}
                className="border-input bg-background rounded border p-2"
              >
                <p className="text-foreground truncate font-semibold">{studyLabel(s)}</p>
                <p className="text-muted-foreground text-xs">
                  {s.series?.length || 0} Series • {totalFiles} Files
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Launch Action */}
      <div className="border-primary-dark bg-background space-y-2 rounded border p-3.5 text-center">
        <p className="text-muted-foreground text-xs">
          Export DICOM images directly or configure anonymization rules before downloading.
        </p>
        <Button
          onClick={handleOpenModal}
          disabled={studies.length === 0}
          className="w-full"
        >
          Export & Anonymize DICOM
        </Button>
      </div>
    </div>
  );
}
