/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@ohif/ui-next';
import { formatBytes, formatTransferSpeed } from '../utils/index.js';
import DicomDiagnosticLink from './DicomDiagnosticLink';

interface DownloadProgressViewProps {
  stats: any;
  logs: Array<{
    timestamp: string;
    message: string;
    type: string;
    dicomDiagnostic?: any;
  }>;
  onCancel: () => void;
  onInspectDicom?: (diagnostic: any) => void;
  awaitingInput?: boolean;
  droppedLogCount?: number;
}

const SEVERITY_LABEL: Record<string, string> = {
  error: 'ERROR',
  warning: 'WARN',
  success: 'OK',
  info: 'INFO',
};

export default function DownloadProgressView({
  stats,
  logs,
  onCancel,
  onInspectDicom,
  awaitingInput = false,
  droppedLogCount = 0,
}: DownloadProgressViewProps) {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [logFilter, setLogFilter] = useState<'all' | 'errors' | 'success'>('all');
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll, logFilter]);

  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 30;
    setAutoScroll(isAtBottom);
  };

  const completed = (stats?.done || 0) + (stats?.failed || 0);
  const total = stats?.total || 1;
  const percent = Math.min(100, Math.round((completed * 100) / total));
  const isFinalizing = Boolean(stats?.total) && completed >= stats.total;
  const isZipOutput = stats?.writer === 'chunked-zip';

  // ETA Calculation. It is meaningless while the export is blocked on the user,
  // and while the writer is assembling the archive.
  const elapsedMs = stats?.startTime ? Math.max(1, Date.now() - stats.startTime) : 0;
  const itemsPerMs = completed > 0 ? completed / elapsedMs : 0;
  const remainingItems = total - completed;
  const etaSec =
    itemsPerMs > 0 && remainingItems > 0 ? Math.ceil(remainingItems / itemsPerMs / 1000) : 0;
  const etaText = awaitingInput
    ? 'Paused — waiting for your answer'
    : isFinalizing
      ? 'Finalizing output…'
      : etaSec > 0
        ? etaSec < 60
          ? `~${etaSec}s remaining`
          : `~${Math.floor(etaSec / 60)}m ${etaSec % 60}s remaining`
        : 'Estimating time remaining…';

  const { filteredLogs, errorCount, successCount } = useMemo(() => {
    let errors = 0;
    let successes = 0;
    const filtered: typeof logs = [];

    logs.forEach(log => {
      const isProblem = log.type === 'error' || log.type === 'warning';
      const isSuccess = log.type === 'success';
      if (isProblem) errors++;
      if (isSuccess) successes++;

      if (
        logFilter === 'all' ||
        (logFilter === 'errors' && isProblem) ||
        (logFilter === 'success' && isSuccess)
      ) {
        filtered.push(log);
      }
    });

    return { filteredLogs: filtered, errorCount: errors, successCount: successes };
  }, [logs, logFilter]);

  const statusLine = awaitingInput
    ? 'Waiting for your answer before the export can continue.'
    : isFinalizing
      ? 'All files processed. Preparing the final verified output.'
      : `${completed} of ${total} files processed${stats?.failed ? `, ${stats.failed} failed` : ''}.`;

  return (
    <div className="text-foreground space-y-4 text-sm">
      {/* Announced status for assistive technology */}
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {statusLine}
      </span>

      {/* Header Info */}
      <div className="border-input bg-background flex items-center justify-between rounded border p-3">
        <div>
          <span className="text-muted-foreground block text-xs">Overall Progress</span>
          <div className="flex items-baseline gap-2">
            <span className="text-foreground text-base font-semibold">
              {completed} / {total} Files ({percent}%)
            </span>
            {stats?.failed > 0 && (
              <span className="text-xs font-medium text-amber-500">({stats.failed} failed)</span>
            )}
          </div>
          <span className="text-muted-foreground mt-0.5 block font-mono text-[11px]">
            {etaText}
          </span>
        </div>
        <div className="text-right">
          <span className="text-muted-foreground block text-xs">Data transferred</span>
          <span className="text-primary text-sm font-semibold">
            {formatBytes(stats?.totalBytes || 0)} (
            {formatTransferSpeed(stats?.totalBytes || 0, stats?.startTime || Date.now())})
          </span>
        </div>
      </div>

      {/* Progress Track */}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${completed} of ${total} files processed`}
        aria-busy={!isFinalizing && !awaitingInput}
        className="border-input bg-background h-3 w-full overflow-hidden rounded-full border p-0.5"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${
            awaitingInput
              ? 'animate-pulse bg-amber-500/50'
              : stats?.failed > 0
                ? 'bg-amber-500'
                : 'bg-primary'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Awaiting input / finalization phase banner */}
      {awaitingInput ? (
        <div className="text-foreground flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <span aria-hidden="true">⏸️</span>
          <span>
            <strong>Awaiting your input.</strong> The export is paused until you choose a redaction
            mode above. Nothing is being downloaded while this question is open.
          </span>
        </div>
      ) : isFinalizing ? (
        <div className="border-primary/30 bg-primary/10 text-foreground flex items-start gap-2 rounded border p-3 text-xs">
          <span aria-hidden="true">⏳</span>
          <span>
            <strong>Finalizing the export.</strong> Checksums and the export manifest are being
            written. For large exports this can take several minutes — keep this tab open until the
            summary appears.
            {isZipOutput && (
              <span className="mt-1 block">
                If your browser asks to allow multiple downloads, choose <strong>Allow</strong> so
                the archive can be saved.
              </span>
            )}
          </span>
        </div>
      ) : null}

      {/* Current File */}
      <div className="border-input bg-background text-muted-foreground flex items-center gap-2 truncate rounded border p-2 text-xs">
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${
            awaitingInput ? 'bg-amber-500' : 'bg-primary animate-ping'
          }`}
          aria-hidden="true"
        />
        <span className="truncate">
          {awaitingInput
            ? 'Paused — waiting for your answer'
            : stats?.currentItem || 'Preparing your download…'}
        </span>
      </div>

      {/* Real-time Scrollable Log Box */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs font-medium">Activity Log</span>
          {/* Log Filters */}
          <div
            className="flex items-center gap-1 text-xs"
            role="group"
            aria-label="Filter activity log"
          >
            <button
              type="button"
              onClick={() => setLogFilter('all')}
              aria-pressed={logFilter === 'all'}
              className={`rounded px-2 py-0.5 text-[11px] ${
                logFilter === 'all'
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-primary/10'
              }`}
            >
              All ({logs.length})
            </button>
            <button
              type="button"
              onClick={() => setLogFilter('errors')}
              aria-pressed={logFilter === 'errors'}
              className={`rounded px-2 py-0.5 text-[11px] ${
                logFilter === 'errors'
                  ? 'bg-amber-500 font-medium text-white'
                  : 'text-muted-foreground hover:bg-amber-500/10'
              }`}
            >
              Warnings/Errors ({errorCount})
            </button>
            <button
              type="button"
              onClick={() => setLogFilter('success')}
              aria-pressed={logFilter === 'success'}
              className={`rounded px-2 py-0.5 text-[11px] ${
                logFilter === 'success'
                  ? 'bg-emerald-500 font-medium text-white'
                  : 'text-muted-foreground hover:bg-emerald-500/10'
              }`}
            >
              Saved ({successCount})
            </button>
          </div>
        </div>

        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          className="border-input bg-background text-muted-foreground relative h-44 select-text space-y-1 overflow-y-auto rounded border p-2.5 font-mono text-xs"
        >
          {droppedLogCount > 0 && (
            <div className="text-muted-foreground italic">
              {droppedLogCount} earlier entries trimmed to keep the viewer responsive.
            </div>
          )}
          {filteredLogs.length === 0 ? (
            <div className="text-muted-foreground italic">No log entries matching filter…</div>
          ) : (
            filteredLogs.map((log, index) => {
              let typeClass = 'text-muted-foreground';
              if (log.type === 'warning') typeClass = 'text-amber-500';
              if (log.type === 'error') typeClass = 'text-destructive font-bold';
              if (log.type === 'success') typeClass = 'text-emerald-500';

              return (
                <div
                  key={index}
                  className={`flex items-start gap-1.5 ${typeClass}`}
                >
                  <span className="text-muted-foreground shrink-0">[{log.timestamp}]</span>
                  <span className="shrink-0 font-semibold">
                    {SEVERITY_LABEL[log.type] || SEVERITY_LABEL.info}
                  </span>
                  <DicomDiagnosticLink
                    entry={log}
                    onInspect={onInspectDicom}
                  />
                </div>
              );
            })
          )}
        </div>

        {!autoScroll && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setAutoScroll(true);
                if (logContainerRef.current) {
                  logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                }
              }}
              className="text-primary text-[11px] hover:underline"
            >
              ↓ Scroll to bottom
            </button>
          </div>
        )}
      </div>

      {/* Cancel Action */}
      <div className="border-input flex justify-end border-t pt-3">
        <Button
          onClick={onCancel}
          variant="outline"
          disabled={isFinalizing}
          title={
            isFinalizing
              ? 'The export can no longer be cancelled cleanly while the output is being finalized.'
              : undefined
          }
        >
          Cancel Download
        </Button>
      </div>
    </div>
  );
}
