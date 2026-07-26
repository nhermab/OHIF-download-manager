/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@ohif/ui-next';
import { formatBytes, formatTransferSpeed } from '../utils';

interface DownloadProgressViewProps {
  stats: any;
  logs: Array<{ timestamp: string; message: string; type: string }>;
  onCancel: () => void;
}

export default function DownloadProgressView({ stats, logs, onCancel }: DownloadProgressViewProps) {
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

  // ETA Calculation
  const elapsedMs = stats?.startTime ? Math.max(1, Date.now() - stats.startTime) : 0;
  const itemsPerMs = completed > 0 ? completed / elapsedMs : 0;
  const remainingItems = total - completed;
  const etaSec = itemsPerMs > 0 && remainingItems > 0 ? Math.ceil((remainingItems / itemsPerMs) / 1000) : 0;
  const etaText =
    etaSec > 0
      ? etaSec < 60
        ? `~${etaSec}s remaining`
        : `~${Math.floor(etaSec / 60)}m ${etaSec % 60}s remaining`
      : completed === total
        ? 'Finalizing output archive…'
        : 'Estimating time remaining…';

  const filteredLogs = logs.filter(log => {
    if (logFilter === 'errors') return log.type === 'error' || log.type === 'warning';
    if (logFilter === 'success') return log.type === 'success';
    return true;
  });

  const errorCount = logs.filter(l => l.type === 'error' || l.type === 'warning').length;
  const successCount = logs.filter(l => l.type === 'success').length;

  return (
    <div className="text-foreground space-y-4 text-sm">
      {/* Header Info */}
      <div className="border-input bg-background flex items-center justify-between rounded border p-3">
        <div>
          <span className="text-muted-foreground block text-xs">Overall Progress</span>
          <div className="flex items-baseline gap-2">
            <span className="text-foreground text-base font-semibold">
              {completed} / {total} Files ({percent}%)
            </span>
            {stats?.failed > 0 && (
              <span className="text-amber-500 text-xs font-medium">
                ({stats.failed} failed)
              </span>
            )}
          </div>
          <span className="text-muted-foreground block text-[11px] font-mono mt-0.5">
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
      <div className="border-input bg-background h-3 w-full overflow-hidden rounded-full border p-0.5">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${
            stats?.failed > 0 ? 'bg-amber-500' : 'bg-primary'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Current File */}
      <div className="border-input bg-background text-muted-foreground flex items-center gap-2 truncate rounded border p-2 text-xs">
        <div className="bg-primary h-2 w-2 shrink-0 animate-ping rounded-full" />
        <span className="truncate">{stats?.currentItem || 'Preparing your download…'}</span>
      </div>

      {/* Real-time Scrollable Log Box */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs font-medium">Activity Log</span>
          {/* Log Filters */}
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setLogFilter('all')}
              className={`px-2 py-0.5 rounded text-[11px] ${
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
              className={`px-2 py-0.5 rounded text-[11px] ${
                logFilter === 'errors'
                  ? 'bg-amber-500 text-white font-medium'
                  : 'text-muted-foreground hover:bg-amber-500/10'
              }`}
            >
              Warnings/Errors ({errorCount})
            </button>
            <button
              type="button"
              onClick={() => setLogFilter('success')}
              className={`px-2 py-0.5 rounded text-[11px] ${
                logFilter === 'success'
                  ? 'bg-emerald-500 text-white font-medium'
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
          className="border-input bg-background text-muted-foreground h-44 select-text space-y-1 overflow-y-auto rounded border p-2.5 font-mono text-xs relative"
        >
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
                  <span>{log.message}</span>
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
              className="text-primary hover:underline text-[11px]"
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
        >
          Cancel Download
        </Button>
      </div>
    </div>
  );
}

