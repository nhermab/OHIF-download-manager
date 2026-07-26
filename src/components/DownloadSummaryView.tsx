/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import React, { useState, useMemo } from 'react';
import { Button } from '@ohif/ui-next';
import { formatBytes, formatDuration } from '../utils';

interface DownloadSummaryViewProps {
  summary?: any;
  error?: any;
  issue?: any;
  logs?: Array<{ timestamp: string; message: string; type: string }>;
  onClose: () => void;
  onRetryFailed?: () => void;
}

export function groupAnonymizationWarnings(anonWarnings: string[]) {
  const categoryCounts: Record<string, number> = {};

  anonWarnings.forEach(entry => {
    const colonIdx = entry.indexOf(': ');
    const msg =
      colonIdx !== -1 && (entry.slice(0, colonIdx).includes('.dcm') || entry.slice(0, colonIdx).includes('SOP'))
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
  onClose,
  onRetryFailed,
}: DownloadSummaryViewProps) {
  const [showFailedDetails, setShowFailedDetails] = useState(false);
  const [showAnonDetails, setShowAnonDetails] = useState(false);
  const [showErrorStackTrace, setShowErrorStackTrace] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const doneCount = summary?.done || 0;
  const failedCount = summary?.failed || 0;
  const totalCount = summary?.total || 0;

  const hasDoneFiles = doneCount > 0;
  const hasFailedFiles = failedCount > 0;
  const isPartialSuccess = hasDoneFiles && hasFailedFiles;
  const isCompleteSuccess = hasDoneFiles && !hasFailedFiles && !error && !issue;
  const isCancelled = summary?.cancelled;

  const failedItems = summary?.failedItems || [];
  const anonWarnings = summary?.anonymizationWarnings || [];

  const groupedAnonWarnings = useMemo(
    () => groupAnonymizationWarnings(anonWarnings),
    [anonWarnings]
  );

  const errorMessageText = error?.message || (typeof error === 'string' ? error : null);
  const errorStackText = error?.stack || (error && typeof error === 'object' ? JSON.stringify(error, null, 2) : null);

  return (
    <div className="text-foreground space-y-4 p-1 text-sm">
      {/* Header Banner */}
      <div
        className={`flex items-start gap-3 rounded border p-4 ${
          isCompleteSuccess
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : isPartialSuccess
              ? 'border-amber-500/30 bg-amber-500/10'
              : isCancelled
                ? 'border-amber-500/30 bg-amber-500/10'
                : 'border-destructive/40 bg-destructive/10'
        }`}
      >
        <div className="text-3xl">
          {isCompleteSuccess ? '✅' : isPartialSuccess || isCancelled ? '⚠️' : '❌'}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground text-base font-semibold">
            {isCompleteSuccess
              ? 'Download Complete'
              : isPartialSuccess
                ? 'Download Completed with Warnings'
                : isCancelled
                  ? 'Download Cancelled'
                  : issue?.title || 'Download Failed'}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {isCompleteSuccess
              ? `All ${doneCount} DICOM image file(s) were successfully saved and verified.`
              : isPartialSuccess
                ? `${doneCount} of ${totalCount} files were saved. ${failedCount} file(s) failed but saved files are intact in your export.`
                : isCancelled
                  ? `Download stopped. ${doneCount} of ${totalCount} files were saved prior to cancellation.`
                  : issue?.message || errorMessageText || 'No files could be downloaded.'}
          </p>
        </div>
      </div>

      {/* Numerical Metrics Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div className="border-input bg-background rounded border p-2.5">
            <span className="text-muted-foreground block text-[11px]">Saved</span>
            <span className="text-emerald-500 text-sm font-bold">{doneCount}</span>
          </div>
          <div className="border-input bg-background rounded border p-2.5">
            <span className="text-muted-foreground block text-[11px]">Failed</span>
            <span className={`text-sm font-bold ${failedCount > 0 ? 'text-amber-500' : 'text-muted-foreground'}`}>
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
              className="text-primary hover:underline"
            >
              {showErrorStackTrace ? 'Hide stack trace' : 'View stack trace'}
            </button>
          </div>
          {showErrorStackTrace && (
            <pre className="border-input bg-background text-destructive max-h-40 overflow-y-auto rounded border p-2 font-mono text-[11px]">
              {errorStackText}
            </pre>
          )}
        </div>
      )}

      {/* Partial Failure Items Breakdown (Collapsed by default) */}
      {failedItems.length > 0 && (
        <div className="border-amber-500/30 bg-amber-500/5 space-y-2 rounded border p-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-semibold text-amber-500">
              <span aria-hidden="true">⚠️</span>
              <span>Failed Files Breakdown ({failedItems.length})</span>
            </div>
            <button
              type="button"
              onClick={() => setShowFailedDetails(!showFailedDetails)}
              className="text-primary hover:underline"
            >
              {showFailedDetails ? 'Hide details' : 'View failed items'}
            </button>
          </div>

          <p className="text-muted-foreground">
            The saved files are complete and usable. You can re-download only the missing items below.
          </p>

          {showFailedDetails && (
            <div className="border-input bg-background max-h-40 space-y-1.5 overflow-y-auto rounded border p-2 font-mono text-[11px]">
              {failedItems.map((f: any, idx: number) => (
                <div key={idx} className="border-b border-input/40 pb-1 last:border-b-0 last:pb-0">
                  <div className="font-semibold text-foreground">
                    {f.item?.patientDir ? `${f.item.patientDir} / ` : ''}
                    {f.item?.sopUid ? `SOP: ${f.item.sopUid.slice(-12)}` : `Item ${idx + 1}`}
                  </div>
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
                className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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
            <div className="flex items-center gap-1.5 font-semibold text-primary">
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
                className="text-primary hover:underline"
              >
                {showAnonDetails ? 'Hide itemized log' : `View itemized log (${anonWarnings.length})`}
              </button>
            )}
          </div>

          {/* Grouped Category Summary (Always Visible & Compact) */}
          <div className="space-y-1 text-muted-foreground">
            {groupedAnonWarnings.map((cat, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-primary shrink-0">•</span>
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
                <div key={i} className="border-b border-input/30 pb-0.5 last:border-b-0">
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
              className="text-primary hover:underline"
            >
              {showLogs ? 'Hide Log' : `Show Log (${logs.length} entries)`}
            </button>
          </div>

          {showLogs && (
            <div className="border-input bg-background text-muted-foreground max-h-48 select-text space-y-1 overflow-y-auto rounded border p-2.5 font-mono text-xs">
              {logs.map((log, index) => {
                const typeClass =
                  log.type === 'error'
                    ? 'text-destructive font-bold'
                    : log.type === 'warning'
                      ? 'text-amber-500'
                      : log.type === 'success'
                        ? 'text-emerald-500'
                        : 'text-muted-foreground';
                return (
                  <div key={index} className={`flex items-start gap-1.5 ${typeClass}`}>
                    <span className="text-muted-foreground shrink-0">[{log.timestamp}]</span>
                    <span>{log.message}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer Actions */}
      <div className="border-input flex items-center justify-between border-t pt-3">
        {onRetryFailed && failedItems.length > 0 ? (
          <Button
            onClick={onRetryFailed}
            variant="outline"
            size="sm"
            className="gap-1 text-amber-500 border-amber-500/40 hover:bg-amber-500/10"
          >
            Retry Failed Files ({failedItems.length})
          </Button>
        ) : (
          <div />
        )}
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
