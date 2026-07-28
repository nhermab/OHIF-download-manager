/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import React from 'react';

interface DicomDiagnosticLinkProps {
  entry: any;
  onInspect?: (diagnostic: any) => void;
}

export default function DicomDiagnosticLink({ entry, onInspect }: DicomDiagnosticLinkProps) {
  const diagnostic = entry?.dicomDiagnostic;
  const sopInstanceUid = diagnostic?.item?.sopUid;

  return (
    <span className="min-w-0">
      <span>{entry?.message}</span>
      {diagnostic && sopInstanceUid && onInspect && (
        <span className="mt-0.5 block">
          SOPInstanceUID:{' '}
          <button
            type="button"
            className="text-primary break-all underline decoration-dotted underline-offset-2 hover:decoration-solid"
            onClick={() => onInspect(diagnostic)}
            title="Inspect the raw DICOM response"
          >
            {sopInstanceUid}
          </button>
        </span>
      )}
    </span>
  );
}
