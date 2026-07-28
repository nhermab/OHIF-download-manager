/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import React, { useState, useMemo } from 'react';
import { Button } from '@ohif/ui-next';
import { formatBytes, formatDuration } from '../utils/index.js';
import {
  buildRunReport,
  copyTextToClipboard,
  groupFailuresBySeries,
  itemIdentityLabel,
} from '../anonymizer/report';
import DicomDiagnosticLink from './DicomDiagnosticLink';

interface DownloadSummaryViewProps {
  summary?: any;
  error?: any;
  issue?: any;
  logs?: Array<{
    timestamp: string;
    message: string;
    type: string;
    dicomDiagnostic?: any;
  }>;
  droppedLogCount?: number;
  runId?: string;
  startedAt?: number;
  onClose: () => void;
  onRetryFailed?: () => void;
  onRetryAll?: () => void;
  onBackToSelection?: () => void;
  onInspectDicom?: (diagnostic: any) => void;
}

export function groupAnonymizationWarnings(anonWarnings: string[]) {
  const categoryCounts: Record<string, number> = {};

  anonWarnings.forEach(entry => {
    const colonIdx = entry.indexOf(': ');
    const msg =
      colonIdx !== -1 &&
      (entry.slice(0, colonIdx).includes('.dcm') || entry.slice(0, colonIdx).includes('SOP'))
        ? entry.slice(colonIdx + 2)
        : entry;
    categoryCounts[msg] = (categoryCounts[msg] || 0) + 1;
  });

  return Object.entries(categoryCounts).map(([message, count]) => ({
    message,
    count,
  }));
}

export default function DownloadSummaryView({
  summary,
  error,
  issue,
  logs = [],
  droppedLogCount = 0,
  runId,
  startedAt,
  onClose,
  onRetryFailed,
  onRetryAll,
  onBackToSelection,
  onInspectDicom,
}: DownloadSummaryViewProps) {
  const [showFailedDetails, setShowFailedDetails] = useState(false);
  const [showAnonDetails, setShowAnonDetails] = useState(false);
  const [showErrorStackTrace, setShowErrorStackTrace] = useState(false);
  const [showLogs, setShowLogs] = useState(() =>
    logs.some(logEntry => Boolean(logEntry.dicomDiagnostic))
  );
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const doneCount = summary?.done || 0;
  const failedCount = summary?.failed || 0;
  const totalCount = summary?.total || 0;

  const failedItems = summary?.failedItems || [];
  const anonWarnings = summary?.anonymizationWarnings || [];
  const notAnonymizedItems = summary?.notAnonymizedItems || [];

  const hasDoneFiles = doneCount > 0;
  const hasFailedFiles = failedCount > 0;

  // Outcome resolution, most specific first. A green banner asserts both
  // "saved" and "de-identified as requested" — anything less is downgraded.
  const isCancelled = Boolean(summary?.cancelled);
  const isFailure = !isCancelled && Boolean(error || issue || (!hasDoneFiles && totalCount > 0));
  const isPartialSuccess = !isCancelled && !isFailure && hasDoneFiles && hasFailedFiles;
  const isIncompleteAnonymization =
    !isCancelled &&
    !isFailure &&
    !isPartialSuccess &&
    hasDoneFiles &&
    notAnonymizedItems.length > 0;
  const isCompleteSuccess =
    !isCancelled && !isFailure && !isPartialSuccess && !isIncompleteAnonymization && hasDoneFiles;

  const tone: 'success' | 'warning' | 'destructive' = isCompleteSuccess
    ? 'success'
    : isFailure
      ? 'destructive'
      : 'warning';

  const statusGlyph = isCompleteSuccess
    ? '✅'
    : isIncompleteAnonymization
      ? '🛡️'
      : isFailure
        ? '❌'
        : '⚠️';

  const statusTitle = isCancelled
    ? 'Download Cancelled'
    : isCompleteSuccess
      ? 'Download Complete'
      : isIncompleteAnonymization
        ? 'Completed — not fully de-identified'
        : isPartialSuccess
          ? 'Download Completed with Warnings'
          : issue?.title || 'Download Failed';

  const errorMessageText = error?.message || (typeof error === 'string' ? error : null);
  const errorStackText =
    error?.stack || (error && typeof error === 'object' ? JSON.stringify(error, null, 2) : null);

  const statusDetail = isCancelled
    ? `Download stopped. ${doneCount} of ${totalCount} files were saved prior to cancellation${
        doneCount > 0 ? ' and are intact in your export destination' : ''
      }.`
    : isCompleteSuccess
      ? `All ${doneCount} DICOM image file(s) were successfully saved and verified.`
      : isIncompleteAnonymization
        ? `${doneCount} file(s) saved, but ${notAnonymizedItems.length} of them were exported without de-identification and may still contain patient information.`
        : isPartialSuccess
          ? `${doneCount} of ${totalCount} files were saved. ${failedCount} file(s) failed but saved files are intact in your export.`
          : issue?.message || errorMessageText || 'No files could be downloaded.';

  const groupedAnonWarnings = useMemo(
    () => groupAnonymizationWarnings(anonWarnings),
    [anonWarnings]
  );

  const failureGroups = useMemo(() => groupFailuresBySeries(failedItems), [failedItems]);

  const handleCopyReport = async () => {
    const report = buildRunReport({ summary, error, issue, logs, runId, startedAt });
    const copied = await copyTextToClipboard(report);
    setCopyState(copied ? 'copied' : 'failed');
    window.setTimeout(() => setCopyState('idle'), 4000);
  };

  return (
    <div className="text-foreground space-y-4 p-1 text-sm">
      {/* Header Banner */}
      <div
        role={isFailure ? 'alert' : 'status'}
        aria-live={isFailure ? 'assertive' : 'polite'}
        className={`flex items-start gap-3 rounded border p-4 ${
          tone === 'success'
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : tone === 'warning'
              ? 'border-amber-500/30 bg-amber-500/10'
              : 'border-destructive/40 bg-destructive/10'
        }`}
      >
        <div
          className="text-3xl"
          aria-hidden="true"
        >
          {statusGlyph}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground text-base font-semibold">{statusTitle}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">{statusDetail}</p>
        </div>
      </div>

      {/* Numerical Metrics Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div className="border-input bg-background rounded border p-2.5">
            <span className="text-muted-foreground block text-[11px]">Saved</span>
            <span className="text-sm font-bold text-emerald-500">{doneCount}</span>
          </div>
          <div className="border-input bg-background rounded border p-2.5">
            <span className="text-muted-foreground block text-[11px]">Failed</span>
            <span
              className={`text-sm font-bold ${failedCount > 0 ? 'text-amber-500' : 'text-muted-foreground'}`}
            >
              {failedCount}
            </span>
          </div>
          <div className="border-input bg-background rounded border p-2.5">
            <span className="text-muted-foreground block text-[11px]">Volume</span>
            <span className="text-primary text-sm font-bold">
              {formatBytes(summary.totalBytes || 0)}
            </span>
          </div>
          <div className="border-input bg-background rounded border p-2.5">
            <span className="text-muted-foreground block text-[11px]">Duration</span>
            <span className="text-foreground text-sm font-bold">
              {formatDuration(summary.durationMs || 0)}
            </span>
          </div>
        </div>
      )}

      {/* Un-anonymized instances — stated in full, never behind a collapsed card */}
      {notAnonymizedItems.length > 0 && (
        <div className="text-foreground space-y-1.5 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-amber-500">
            <span aria-hidden="true">🛡️</span>
            <span>{notAnonymizedItems.length} file(s) exported without de-identification</span>
          </div>
          <p className="text-muted-foreground">
            Anonymization was requested for this export, but these files have no de-identification
            path in the viewer and were written exactly as retrieved. Patient identity may remain in
            the frames, audio, or container metadata. Handle them as identifiable data.
          </p>
          <ul className="border-input bg-background max-h-32 select-text space-y-0.5 overflow-y-auto rounded border p-2 font-mono text-[11px]">
            {notAnonymizedItems.map((entry: any, idx: number) => (
              <li key={idx}>
                {entry.fileName || entry.sopInstanceUid || `Item ${idx + 1}`}
                {entry.contentType ? ` (${String(entry.contentType).toUpperCase()})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Terminal Issue Box */}
      {issue && (
        <div className="border-destructive/40 bg-destructive/10 text-foreground space-y-1 rounded border p-3 text-xs">
          <span className="text-destructive block font-bold">{issue.title}</span>
          <p>{issue.message}</p>
        </div>
      )}

      {/* Error Technical Stack Trace (Collapsed by Default to prevent text wall) */}
      {!issue && error && errorStackText && (
        <div className="border-destructive/30 bg-destructive/5 space-y-1.5 rounded border p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-destructive font-semibold">Technical Error Details</span>
            <button
              type="button"
              onClick={() => setShowErrorStackTrace(!showErrorStackTrace)}
              aria-expanded={showErrorStackTrace}
              className="text-primary hover:underline"
            >
              {showErrorStackTrace ? 'Hide stack trace' : 'View stack trace'}
            </button>
          </div>
          {showErrorStackTrace && (
            <pre className="border-input bg-background text-destructive max-h-40 select-text overflow-y-auto rounded border p-2 font-mono text-[11px]">
              {errorStackText}
            </pre>
          )}
        </div>
      )}

      {/* Failed Items Breakdown, grouped by image set (Collapsed by default) */}
      {failedItems.length > 0 && (
        <div className="space-y-2 rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-semibold text-amber-500">
              <span aria-hidden="true">⚠️</span>
              <span>Failed Files Breakdown ({failedItems.length})</span>
            </div>
            <button
              type="button"
              onClick={() => setShowFailedDetails(!showFailedDetails)}
              aria-expanded={showFailedDetails}
              className="text-primary hover:underline"
            >
              {showFailedDetails ? 'Hide details' : 'View failed items'}
            </button>
          </div>

          <p className="text-muted-foreground">
            The saved files are complete and usable. You can re-download only the missing items
            below.
          </p>

          {/* Where the failures cluster — always visible, one line per image set */}
          <ul className="text-muted-foreground space-y-1">
            {failureGroups.map(group => (
              <li
                key={group.key}
                className="flex items-start gap-1.5"
              >
                <span
                  className="shrink-0 text-amber-500"
                  aria-hidden="true"
                >
                  •
                </span>
                <span>
                  <strong className="text-foreground">{group.count} file(s)</strong> missing from{' '}
                  {group.label}
                  {group.causes.length > 0 && (
                    <span className="block">
                      {group.causes.map(cause => `${cause.count}× ${cause.cause}`).join(' · ')}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {showFailedDetails && (
            <div className="border-input bg-background max-h-40 select-text space-y-1.5 overflow-y-auto rounded border p-2 font-mono text-[11px]">
              {failedItems.map((f: any, idx: number) => (
                <div
                  key={idx}
                  className="border-input/40 border-b pb-1 last:border-b-0 last:pb-0"
                >
                  <div className="text-foreground font-semibold">{itemIdentityLabel(f.item)}</div>
                  {f.dicomDiagnostic?.item?.sopUid && onInspectDicom && (
                    <div>
                      SOPInstanceUID:{' '}
                      <button
                        type="button"
                        className="text-primary break-all underline decoration-dotted underline-offset-2 hover:decoration-solid"
                        onClick={() => onInspectDicom(f.dicomDiagnostic)}
                      >
                        {f.dicomDiagnostic.item.sopUid}
                      </button>
                    </div>
                  )}
                  <div className="text-destructive">{f.error || 'Unknown download error'}</div>
                </div>
              ))}
            </div>
          )}

          {onRetryFailed && (
            <div className="pt-1">
              <Button
                onClick={onRetryFailed}
                variant="default"
                size="sm"
                className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
              >
                <svg
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Retry Failed Files ({failedItems.length})
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Anonymization Audit Report Card (Category Summarized & Collapsible) */}
      {anonWarnings.length > 0 && (
        <div className="border-primary/30 bg-primary/5 space-y-2 rounded border p-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="text-primary flex items-center gap-1.5 font-semibold">
              <span aria-hidden="true">🛡️</span>
              <span>
                Anonymization Audit & Governance ({anonWarnings.length} note
                {anonWarnings.length === 1 ? '' : 's'})
              </span>
            </div>
            {anonWarnings.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAnonDetails(!showAnonDetails)}
                aria-expanded={showAnonDetails}
                className="text-primary hover:underline"
              >
                {showAnonDetails
                  ? 'Hide itemized log'
                  : `View itemized log (${anonWarnings.length})`}
              </button>
            )}
          </div>

          {/* Grouped Category Summary (Always Visible & Compact) */}
          <div className="text-muted-foreground space-y-1">
            {groupedAnonWarnings.map((cat, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5"
              >
                <span
                  className="text-primary shrink-0"
                  aria-hidden="true"
                >
                  •
                </span>
                <span>
                  {cat.count > 1 && (
                    <strong className="text-foreground mr-1">({cat.count} files)</strong>
                  )}
                  {cat.message}
                </span>
              </div>
            ))}
          </div>

          {/* Detailed Per-File Itemized Log (Collapsed by Default to prevent text walls) */}
          {showAnonDetails && (
            <div className="border-input bg-background text-muted-foreground max-h-40 select-text space-y-1 overflow-y-auto rounded border p-2 font-mono text-[11px]">
              {anonWarnings.map((warning: string, i: number) => (
                <div
                  key={i}
                  className="border-input/30 border-b pb-0.5 last:border-b-0"
                >
                  {warning}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Real-time Transfer Logs Toggle (Collapsed by default) */}
      {logs.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-medium">Detailed Activity Log</span>
            <button
              type="button"
              onClick={() => setShowLogs(!showLogs)}
              aria-expanded={showLogs}
              className="text-primary hover:underline"
            >
              {showLogs ? 'Hide Log' : `Show Log (${logs.length} entries)`}
            </button>
          </div>

          {showLogs && (
            <div className="border-input bg-background text-muted-foreground max-h-48 select-text space-y-1 overflow-y-auto rounded border p-2.5 font-mono text-xs">
              {droppedLogCount > 0 && (
                <div className="text-muted-foreground italic">
                  {droppedLogCount} earlier entries were trimmed from this view. Use Copy report for
                  the retained log.
                </div>
              )}
              {logs.map((log, index) => {
                const typeClass =
                  log.type === 'error'
                    ? 'text-destructive font-bold'
                    : log.type === 'warning'
                      ? 'text-amber-500'
                      : log.type === 'success'
                        ? 'text-emerald-500'
                        : 'text-muted-foreground';
                const severityPrefix =
                  log.type === 'error'
                    ? 'ERROR'
                    : log.type === 'warning'
                      ? 'WARN'
                      : log.type === 'success'
                        ? 'OK'
                        : 'INFO';
                return (
                  <div
                    key={index}
                    className={`flex items-start gap-1.5 ${typeClass}`}
                  >
                    <span className="text-muted-foreground shrink-0">[{log.timestamp}]</span>
                    <span className="shrink-0 font-semibold">{severityPrefix}</span>
                    <DicomDiagnosticLink
                      entry={log}
                      onInspect={onInspectDicom}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer Actions */}
      <div className="border-input flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {onRetryFailed && failedItems.length > 0 && (
            <Button
              onClick={onRetryFailed}
              variant="outline"
              size="sm"
              className="gap-1 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
            >
              Retry Failed Files ({failedItems.length})
            </Button>
          )}
          {onRetryAll && (
            <Button
              onClick={onRetryAll}
              variant="outline"
              size="sm"
              className="gap-1 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
            >
              Retry all files
            </Button>
          )}
          {onBackToSelection && (
            <Button
              onClick={onBackToSelection}
              variant="outline"
              size="sm"
            >
              Back to selection
            </Button>
          )}
          <Button
            onClick={handleCopyReport}
            variant="outline"
            size="sm"
          >
            {copyState === 'copied'
              ? 'Report copied'
              : copyState === 'failed'
                ? 'Copy failed — select the log manually'
                : 'Copy report'}
          </Button>
          <span
            role="status"
            aria-live="polite"
            className="sr-only"
          >
            {copyState === 'copied' ? 'Export report copied to the clipboard.' : ''}
          </span>
        </div>
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
