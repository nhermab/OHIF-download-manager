/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Developer-only helpers for inspecting the exact DICOM response that failed
 * during export. Pixel payloads are never included in the textual dump.
 */

import dcmjs from 'dcmjs';
import { authorizationHeaders } from '../downloader/ohifState.js';
import { config } from '../config.js';
import { createNamedError } from '../utils/stringUtils.js';

const PIXEL_DATA_TAGS = new Set(['7FE00008', '7FE00009', '7FE00010']);
const BINARY_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'UN']);

const TRANSFER_SYNTAX_NAMES = {
  '1.2.840.10008.1.2': 'Implicit VR Little Endian',
  '1.2.840.10008.1.2.1': 'Explicit VR Little Endian',
  '1.2.840.10008.1.2.1.99': 'Deflated Explicit VR Little Endian',
  '1.2.840.10008.1.2.2': 'Explicit VR Big Endian',
  '1.2.840.10008.1.2.4.50': 'JPEG Baseline (Process 1)',
  '1.2.840.10008.1.2.4.51': 'JPEG Extended (Process 2 & 4)',
  '1.2.840.10008.1.2.4.57': 'JPEG Lossless, Non-Hierarchical (Process 14)',
  '1.2.840.10008.1.2.4.70': 'JPEG Lossless, Non-Hierarchical, First-Order Prediction',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless',
  '1.2.840.10008.1.2.4.81': 'JPEG-LS Near-Lossless',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
  '1.2.840.10008.1.2.4.201': 'HTJ2K Lossless',
  '1.2.840.10008.1.2.4.202': 'HTJ2K Lossless RPCL',
  '1.2.840.10008.1.2.4.203': 'HTJ2K',
  '1.2.840.10008.1.2.5': 'RLE Lossless',
};

function normalizedTag(tag) {
  return String(tag || '')
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase()
    .padStart(8, '0');
}

function punctuatedTag(tag) {
  const value = normalizedTag(tag);
  return `(${value.slice(0, 4).toLowerCase()},${value.slice(4).toLowerCase()})`;
}

function dictionaryEntry(tag) {
  const value = normalizedTag(tag);
  return dcmjs.data.DicomMetaDictionary.dictionary[`(${value.slice(0, 4)},${value.slice(4)})`];
}

function byteLength(value) {
  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }
  return null;
}

function readBlobArrayBuffer(blob) {
  if (blob && typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function personName(value) {
  if (!value || typeof value !== 'object') {
    return String(value ?? '');
  }
  return value.Alphabetic || value.Ideographic || value.Phonetic || JSON.stringify(value);
}

function displayValue(element) {
  const values = Array.isArray(element?.Value) ? element.Value : [];
  const vr = String(element?.vr || 'UN').toUpperCase();

  if (!values.length) {
    return '(no value available)';
  }

  if (BINARY_VRS.has(vr)) {
    const totalBytes = values.reduce((total, value) => total + (byteLength(value) || 0), 0);
    return `<binary data omitted; ${totalBytes} byte${totalBytes === 1 ? '' : 's'}>`;
  }

  return values
    .map(value => {
      const binaryBytes = byteLength(value);
      if (binaryBytes !== null) {
        return `<binary data omitted; ${binaryBytes} byte${binaryBytes === 1 ? '' : 's'}>`;
      }
      if (vr === 'PN') {
        return personName(value);
      }
      if (value && typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value ?? '');
    })
    .join('\\');
}

function formatDataset(dataset, depth = 0) {
  const lines = [];
  const indent = '  '.repeat(depth);
  const tags = Object.keys(dataset || {}).sort((left, right) =>
    normalizedTag(left).localeCompare(normalizedTag(right))
  );

  tags.forEach(rawTag => {
    const tag = normalizedTag(rawTag);
    if (PIXEL_DATA_TAGS.has(tag)) {
      return;
    }

    const element = dataset[rawTag] || {};
    const dictionary = dictionaryEntry(tag);
    const vr = String(element.vr || dictionary?.vr || 'UN').toUpperCase();
    const name =
      dictionary?.name || (Number.parseInt(tag.slice(0, 4), 16) % 2 ? 'PrivateTag' : 'UnknownTag');

    if (vr === 'SQ') {
      const items = Array.isArray(element.Value) ? element.Value : [];
      lines.push(
        `${indent}${punctuatedTag(tag)} SQ (Sequence with ${items.length} item${
          items.length === 1 ? '' : 's'
        }) # ${name}`
      );
      items.forEach((item, index) => {
        lines.push(`${indent}  (fffe,e000) na (Item ${index + 1})`);
        lines.push(...formatDataset(item, depth + 2));
        lines.push(`${indent}  (fffe,e00d) na (ItemDelimitationItem)`);
      });
      lines.push(`${indent}(fffe,e0dd) na (SequenceDelimitationItem)`);
      return;
    }

    lines.push(
      `${indent}${punctuatedTag(tag)} ${vr.padEnd(2)} [${displayValue(element)}] # ${name}`
    );
  });

  return lines;
}

export function isDicomDiagnosticsEnabled() {
  return config().devMode === true;
}

export function transferSyntaxName(uid) {
  return TRANSFER_SYNTAX_NAMES[uid] || 'Unknown transfer syntax';
}

export function createDicomDiagnostic(item, rawBlob) {
  if (
    !isDicomDiagnosticsEnabled() ||
    !item ||
    (item.extension && item.extension !== 'dcm' && item.extension !== 'dicom')
  ) {
    return null;
  }

  return {
    item: {
      url: item.url,
      file: item.file,
      reconstructFromFrames: item.reconstructFromFrames === true,
      studyUid: item.studyUid,
      seriesUid: item.seriesUid,
      sopUid: item.sopUid,
      extension: item.extension || 'dcm',
    },
    rawBlob: rawBlob || null,
  };
}

export async function fetchRawDicomForDiagnostics(item, signal) {
  if (!isDicomDiagnosticsEnabled()) {
    throw createNamedError('DiagnosticsDisabledError', 'DICOM diagnostics are disabled.');
  }
  if (item?.file && typeof item.file.arrayBuffer === 'function') {
    return item.file;
  }
  if (item?.reconstructFromFrames) {
    throw createNamedError(
      'RawDicomUnavailableError',
      'This data source supplied metadata and frames separately, so there is no original DICOM file to download without reconstruction.'
    );
  }
  if (!item?.url) {
    throw createNamedError(
      'RawDicomUnavailableError',
      'This instance does not have a raw DICOM URL.'
    );
  }

  const response = await fetch(item.url, {
    method: 'GET',
    credentials: 'include',
    signal,
    redirect: 'manual',
    headers: {
      ...authorizationHeaders(),
      Accept: 'application/dicom,*/*',
    },
  });
  if (!response.ok || response.type === 'opaqueredirect') {
    throw createNamedError(
      'RawDicomFetchError',
      `The raw DICOM response could not be retrieved (HTTP ${response.status || 'redirect'}).`
    );
  }
  return response.blob();
}

export async function createDicomDump(blob) {
  const arrayBuffer = await readBlobArrayBuffer(blob);
  const dicom = dcmjs.data.DicomMessage.readFile(arrayBuffer);
  const transferSyntaxUid = String(dicom.meta?.['00020010']?.Value?.[0] || 'Unknown');
  const syntaxName = transferSyntaxName(transferSyntaxUid);
  const sopInstanceUid = String(
    dicom.dict?.['00080018']?.Value?.[0] || dicom.meta?.['00020003']?.Value?.[0] || 'Unknown'
  );
  const lines = [
    '# OHIF Download Manager browser dcmdump',
    '# Raw response; no anonymization, pixel redaction, transcoding, or writer processing applied',
    '# Pixel Data (7fe0,0008), (7fe0,0009), and (7fe0,0010) omitted',
    `# Transfer Syntax: ${syntaxName} [${transferSyntaxUid}]`,
    `# SOP Instance UID: ${sopInstanceUid}`,
    `# File size: ${blob.size} bytes`,
    '',
    '# File Meta Information',
    ...formatDataset(dicom.meta),
    '',
    '# DICOM Dataset',
    ...formatDataset(dicom.dict),
    '',
  ];

  return {
    text: lines.join('\n'),
    transferSyntaxUid,
    transferSyntaxName: syntaxName,
    sopInstanceUid,
  };
}

export function diagnosticFileName(sopInstanceUid, suffix) {
  const safeUid = String(sopInstanceUid || 'dicom-instance').replace(/[^0-9.]/g, '_');
  return `${safeUid}.${suffix}`;
}

export function downloadDiagnosticBlob(blob, filename) {
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
