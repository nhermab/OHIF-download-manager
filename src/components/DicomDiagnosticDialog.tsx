/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@ohif/ui-next';
import {
  createDicomDump,
  diagnosticFileName,
  downloadDiagnosticBlob,
  fetchRawDicomForDiagnostics,
} from '../dicom/dicomDiagnostics';
import { copyTextToClipboard } from '../anonymizer/report';

interface DicomDiagnosticDialogProps {
  diagnostic: any;
  onClose: () => void;
}

export default function DicomDiagnosticDialog({ diagnostic, onClose }: DicomDiagnosticDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [rawBlob, setRawBlob] = useState<Blob | null>(diagnostic?.rawBlob || null);
  const [dump, setDump] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dumpError, setDumpError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;

    const load = async () => {
      let sourceBlob = diagnostic?.rawBlob || null;
      try {
        if (!sourceBlob) {
          sourceBlob = await fetchRawDicomForDiagnostics(diagnostic?.item, abortController.signal);
        }
        if (!active) {
          return;
        }
        diagnostic.rawBlob = sourceBlob;
        setRawBlob(sourceBlob);
      } catch (error: any) {
        if (active && error?.name !== 'AbortError') {
          setLoadError(error?.message || 'The raw DICOM response could not be loaded.');
        }
        return;
      }

      try {
        const nextDump = await createDicomDump(sourceBlob);
        if (active) {
          setDump(nextDump);
        }
      } catch (error: any) {
        if (active) {
          setDumpError(
            error?.message ||
              'The raw response is not a parseable DICOM Part 10 file. You can still download it unchanged.'
          );
        }
      }
    };

    load();
    return () => {
      active = false;
      abortController.abort();
    };
  }, [diagnostic]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const sopInstanceUid = dump?.sopInstanceUid || diagnostic?.item?.sopUid || 'dicom-instance';

  const handleCopy = async () => {
    const copied = await copyTextToClipboard(dump?.text || '');
    setCopyState(copied ? 'copied' : 'failed');
    window.setTimeout(() => setCopyState('idle'), 3000);
  };

  const content = (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-3 sm:p-6"
      role="presentation"
      onMouseDown={event => {
        if (event.currentTarget === event.target) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="aquest-dicom-diagnostic-title"
        className="border-input bg-background text-foreground flex h-[92vh] min-h-0 w-[min(97vw,1440px)] flex-col overflow-hidden rounded-lg border shadow-2xl"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="border-input flex shrink-0 items-start justify-between gap-4 border-b p-4">
          <div className="min-w-0">
            <h2
              id="aquest-dicom-diagnostic-title"
              className="text-lg font-semibold"
            >
              Raw DICOM diagnostic
            </h2>
            <p className="text-muted-foreground mt-1 break-all font-mono text-xs">
              SOPInstanceUID: {sopInstanceUid}
            </p>
          </div>
          <Button
            ref={closeButtonRef}
            variant="outline"
            size="sm"
            onClick={onClose}
          >
            Close
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            Developer mode exposes identifiable, unprocessed DICOM data. The text view omits pixel
            data, but all other displayed tags and the raw file may contain protected health
            information.
          </div>

          {dump && (
            <div className="border-primary/40 bg-primary/10 rounded border p-3">
              <span className="text-muted-foreground block text-xs">Transfer Syntax</span>
              <strong className="text-primary block text-base">{dump.transferSyntaxName}</strong>
              <code className="select-text break-all text-sm">{dump.transferSyntaxUid}</code>
            </div>
          )}

          {!rawBlob && !loadError && (
            <div
              role="status"
              className="text-muted-foreground p-4 text-center"
            >
              Fetching the raw DICOM response…
            </div>
          )}

          {loadError && (
            <div
              role="alert"
              className="border-destructive/40 bg-destructive/10 text-destructive rounded border p-3 text-sm"
            >
              {loadError}
            </div>
          )}

          {dumpError && (
            <div
              role="alert"
              className="border-destructive/40 bg-destructive/10 text-destructive rounded border p-3 text-sm"
            >
              The response could not be rendered as a DICOM dump: {dumpError}
            </div>
          )}

          {dump?.text && (
            <pre className="border-input text-foreground min-h-[28rem] whitespace-pre-wrap break-words rounded border bg-black/40 p-4 font-mono text-xs leading-relaxed">
              {dump.text}
            </pre>
          )}
        </div>

        <footer className="border-input flex shrink-0 flex-wrap items-center justify-between gap-2 border-t p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!dump?.text}
              onClick={handleCopy}
            >
              {copyState === 'copied'
                ? 'Dump copied'
                : copyState === 'failed'
                  ? 'Copy failed'
                  : 'Copy dcmdump'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!dump?.text}
              onClick={() =>
                downloadDiagnosticBlob(
                  new Blob([dump.text], { type: 'text/plain;charset=utf-8' }),
                  diagnosticFileName(sopInstanceUid, 'dcmdump.txt')
                )
              }
            >
              Download dcmdump text
            </Button>
            <Button
              size="sm"
              disabled={!rawBlob}
              onClick={() =>
                downloadDiagnosticBlob(
                  rawBlob,
                  diagnosticFileName(diagnostic?.item?.sopUid || sopInstanceUid, 'raw.dcm')
                )
              }
            >
              Download raw .dcm
            </Button>
          </div>
          <span className="text-muted-foreground text-xs">
            Raw file is downloaded without anonymization or processing.
          </span>
        </footer>
      </section>
    </div>
  );

  return createPortal(content, document.body);
}
