/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Reconstruction engine for static DICOM SOP Instances.
 */

import dcmjs from 'dcmjs';
import {
  EXPLICIT_VR_LITTLE_ENDIAN,
  IMPLEMENTATION_CLASS_UID,
  DICOM_FRAME_ACCEPT_HEADER as FRAME_ACCEPT,
  MEDIA_TYPE_TRANSFER_SYNTAXES,
  RAW_TAG_KEY,
  NON_DICOM_METADATA_KEYS,
  DCMJS_META_KEYS,
  AMBIGUOUS_VR,
  BINARY_VRS,
} from '../constants/dicom.js';
import {
  resolveAmbiguousVr,
  withResolvedVrs,
  fixOddLengthFragment,
  repairDicomPreamble,
} from './dicomFixes.js';

const reportedUnwritableTags = new Set();

export async function reconstructStaticDicom(item, authorizationHeaders, signal, options = {}) {
  if (!usesFrameRetrieval(item.metadata)) {
    try {
      const instanceData = await retrieveStaticResource(
        instanceUrl(item.url),
        authorizationHeaders,
        signal,
        'application/dicom,*/*'
      );
      if (isPart10File(instanceData.buffer)) {
        return new Blob([instanceData.buffer], { type: 'application/dicom' });
      }
    } catch (error) {
      if (!hasMetadataForReconstruction(item.metadata) || ![403, 404].includes(error?.status)) {
        throw error;
      }
    }

    if (!hasMetadataForReconstruction(item.metadata)) {
      throw new Error(
        'The static DICOMweb source did not return a Part 10 DICOM file or enough metadata for this non-image SOP class.'
      );
    }
    return reconstructDicomFromMetadata(item.metadata);
  }

  const frameCount = Math.max(1, Number(item.metadata?.NumberOfFrames) || 1);
  const frameUrls = Array.from({ length: frameCount }, (_, index) => frameUrl(item.url, index + 1));
  const frames = [];
  let detectedTransferSyntax = null;

  for (const url of frameUrls) {
    const frameData = await retrieveStaticResource(url, authorizationHeaders, signal, FRAME_ACCEPT);
    const frameTransferSyntax = frameData.transferSyntax || EXPLICIT_VR_LITTLE_ENDIAN;
    if (detectedTransferSyntax === null) {
      detectedTransferSyntax = frameTransferSyntax;
    } else if (frameTransferSyntax !== detectedTransferSyntax) {
      throw new Error(
        'Inconsistent transfer syntax across frames for a reconstructed multi-frame instance.'
      );
    }
    frames.push(frameData.buffer);
  }

  const transferSyntax = detectedTransferSyntax || EXPLICIT_VR_LITTLE_ENDIAN;
  return reconstructDicomFromFrames(item.metadata, frames, transferSyntax, options);
}

async function retrieveStaticResource(url, authorizationHeaders, signal, accept) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    signal,
    headers: {
      ...authorizationHeaders,
      Accept: accept,
    },
  });
  if (!response.ok) {
    const error = new Error(`Unable to retrieve DICOM resource: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return extractMultipart(
    await response.arrayBuffer(),
    response.headers?.get?.('content-type') || ''
  );
}

function hasMetadataForReconstruction(metadata) {
  return Boolean(metadata?.SOPClassUID && metadata?.SOPInstanceUID);
}

export function isCompressedTransferSyntax(transferSyntax) {
  if (!transferSyntax) return false;
  const clean = String(transferSyntax).trim();
  return (
    clean !== '1.2.840.10008.1.2' &&
    clean !== '1.2.840.10008.1.2.1' &&
    clean !== '1.2.840.10008.1.2.2'
  );
}

function base64ToUint8Array(base64) {
  if (typeof atob === 'function') {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(base64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return new Uint8Array(0);
}

function isPrivateCreatorTag(tag) {
  const group = parseInt(tag.slice(0, 4), 16);
  const element = parseInt(tag.slice(4), 16);
  return group % 2 === 1 && element >= 0x0010 && element <= 0x00ff;
}

function toEvenLengthBuffer(bytes, padByte) {
  if (bytes.length % 2 === 0) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const padded = new Uint8Array(bytes.length + 1);
  padded.set(bytes);
  padded[bytes.length] = padByte;
  return padded.buffer;
}

function rawTagElement(tag, value) {
  if (value === null || value === undefined) {
    return { vr: isPrivateCreatorTag(tag) ? 'LO' : 'UN', Value: [] };
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.InlineBinary === 'string') {
      return { vr: 'UN', Value: [toEvenLengthBuffer(base64ToUint8Array(value.InlineBinary), 0)] };
    }
    return null;
  }

  const values = Array.isArray(value) ? value : [value];
  if (!values.length) {
    return { vr: 'UN', Value: [] };
  }
  if (!values.every(entry => typeof entry === 'string')) {
    return null;
  }
  if (isPrivateCreatorTag(tag)) {
    return { vr: 'LO', Value: values };
  }
  return {
    vr: 'UN',
    Value: [toEvenLengthBuffer(new TextEncoder().encode(values.join('\\')), 0x20)],
  };
}

function isPrivateRawTag(key) {
  return RAW_TAG_KEY.test(key) && parseInt(key.slice(0, 4), 16) % 2 === 1;
}

function withoutUnavailableBulkData(node, depth = 0) {
  if (
    !node ||
    typeof node !== 'object' ||
    node instanceof ArrayBuffer ||
    ArrayBuffer.isView(node)
  ) {
    return node;
  }
  if (Array.isArray(node)) {
    let result = node;
    for (let index = 0; index < node.length; index++) {
      const value = withoutUnavailableBulkData(node[index], depth);
      if (value !== node[index]) {
        if (result === node) result = node.slice();
        result[index] = value;
      }
    }
    return result;
  }

  let result = node;
  const clone = () => {
    if (result === node) result = { ...node };
    return result;
  };
  for (const key of Object.keys(node)) {
    if (DCMJS_META_KEYS.includes(key) || key === 'PixelData' || key === '7FE00010') {
      continue;
    }
    const value = node[key];
    if (depth > 0 && isPrivateRawTag(key)) {
      delete clone()[key];
      reportUnwritableTag(
        key.toUpperCase(),
        'is a nested private attribute that cannot be safely serialized'
      );
      continue;
    }
    if (value && typeof value === 'object' && typeof value.BulkDataURI === 'string') {
      if (!isPrivateRawTag(key)) {
        throw new Error(
          `The static DICOMweb metadata references unavailable standard BulkData for ${key}.`
        );
      }
      delete clone()[key];
      reportUnwritableTag(key.toUpperCase(), 'references unavailable private BulkData');
      continue;
    }
    const next = withoutUnavailableBulkData(value, depth + 1);
    if (next !== value) clone()[key] = next;
  }
  return result;
}

function splitDataset(rawMetadata) {
  const { DicomMetaDictionary } = dcmjs.data;
  const metadata = withResolvedVrs(
    withoutUnavailableBulkData(rawMetadata),
    rawMetadata.PixelRepresentation
  );
  const dataset = {};
  const rawElements = {};

  for (const key of Object.keys(metadata)) {
    if (key === 'PixelData' || key === '7FE00010' || NON_DICOM_METADATA_KEYS.includes(key)) {
      continue;
    }
    if (DicomMetaDictionary.nameMap[key] || DCMJS_META_KEYS.includes(key)) {
      dataset[key] = metadata[key];
      continue;
    }
    if (!RAW_TAG_KEY.test(key)) {
      reportUnwritableTag(key, 'is not a DICOM attribute');
      continue;
    }
    const tag = key.toUpperCase();
    const element = rawTagElement(tag, metadata[key]);
    if (element) {
      rawElements[tag] = element;
    } else {
      reportUnwritableTag(tag, 'has no recoverable value representation');
    }
  }

  return { dataset, rawElements };
}

function reportUnwritableTag(tag, reason) {
  if (reportedUnwritableTags.has(tag)) {
    return;
  }
  reportedUnwritableTags.add(tag);
  console.debug(
    `Download manager: ${tag} ${reason} and is omitted from reconstructed DICOM files.`
  );
}

function parseInlineBinary(inlineBinary, vr) {
  const bytes = base64ToUint8Array(inlineBinary);
  if (!BINARY_VRS.has(vr)) {
    return Array.from(
      new Uint16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
    );
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function toNormalizedValue(value, vr) {
  let normalized = value;
  if (normalized && typeof normalized === 'object' && typeof normalized.InlineBinary === 'string') {
    normalized = parseInlineBinary(normalized.InlineBinary, vr);
  }
  if (
    !BINARY_VRS.has(vr) &&
    (normalized instanceof ArrayBuffer || ArrayBuffer.isView(normalized))
  ) {
    const buffer =
      normalized instanceof ArrayBuffer
        ? normalized
        : normalized.buffer.slice(
            normalized.byteOffset,
            normalized.byteOffset + normalized.byteLength
          );
    return Array.from(new Uint16Array(buffer));
  }
  if (normalized instanceof ArrayBuffer) return normalized;
  if (ArrayBuffer.isView(normalized)) {
    return normalized.buffer.slice(
      normalized.byteOffset,
      normalized.byteOffset + normalized.byteLength
    );
  }
  return normalized;
}

function normalizeElementValue(value, vr) {
  if (value === null || value === undefined) return value;
  let items = Array.isArray(value) ? value : [value];
  while (items.some(item => Array.isArray(item))) {
    items = items.flat(Infinity);
  }
  items = items.map(item => toNormalizedValue(item, vr));
  while (items.some(item => Array.isArray(item))) {
    items = items.flat(Infinity);
  }
  if (vr === 'DA') {
    items = items.map(item => (typeof item === 'string' ? item.replace(/[-.\/\s]/g, '') : item));
  }
  return items;
}

function normalizeDataset(dict, pixelRepresentation) {
  for (const tag of Object.keys(dict)) {
    const element = dict[tag];
    if (!element) continue;

    if (element.vr && typeof element.vr === 'string' && AMBIGUOUS_VR.test(element.vr)) {
      element.vr = resolveAmbiguousVr(element.vr, element.Value, pixelRepresentation);
    }

    if (element.Value !== undefined) {
      element.Value = normalizeElementValue(element.Value, element.vr);
    }

    if (element.vr === 'SQ' && Array.isArray(element.Value)) {
      for (const item of element.Value) {
        if (item && typeof item === 'object') {
          normalizeDataset(item, pixelRepresentation);
        }
      }
    }
  }
}

function normalizedDictionaryTag(entry) {
  return String(entry?.tag || '')
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase();
}

function applyResolvedVrMaps(dict, naturalizedDataset) {
  if (!dict || !naturalizedDataset || typeof naturalizedDataset !== 'object') {
    return;
  }
  const { DicomMetaDictionary } = dcmjs.data;
  const vrMap =
    naturalizedDataset._vrMap && typeof naturalizedDataset._vrMap === 'object'
      ? naturalizedDataset._vrMap
      : {};

  for (const [name, vr] of Object.entries(vrMap)) {
    const tag = normalizedDictionaryTag(DicomMetaDictionary.nameMap[name]);
    if (tag && dict[tag] && typeof vr === 'string') {
      dict[tag].vr = vr;
    }
  }

  for (const [name, value] of Object.entries(naturalizedDataset)) {
    if (!Array.isArray(value)) continue;
    const tag = normalizedDictionaryTag(DicomMetaDictionary.nameMap[name]);
    const element = tag && dict[tag];
    if (!element || element.vr !== 'SQ' || !Array.isArray(element.Value)) continue;
    for (let index = 0; index < Math.min(value.length, element.Value.length); index++) {
      applyResolvedVrMaps(element.Value[index], value[index]);
    }
  }
}

function createDicomDict(metadata, transferSyntax) {
  const { dataset, rawElements } = splitDataset(metadata);
  if (!dataset.SOPClassUID || !dataset.SOPInstanceUID) {
    throw new Error(
      'The static DICOMweb metadata is missing the SOP Class UID or SOP Instance UID.'
    );
  }

  const { DicomDict, DicomMetaDictionary } = dcmjs.data;
  const fileMeta = {
    MediaStorageSOPClassUID: dataset.SOPClassUID,
    MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
    ImplementationVersionName: 'OHIF-DM',
    TransferSyntaxUID: transferSyntax,
    ImplementationClassUID: IMPLEMENTATION_CLASS_UID,
    FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(fileMeta));
  dicomDict.dict = Object.assign(DicomMetaDictionary.denaturalizeDataset(dataset), rawElements);
  applyResolvedVrMaps(dicomDict.dict, dataset);
  normalizeDataset(dicomDict.dict, metadata.PixelRepresentation);
  if (dicomDict.meta) {
    normalizeDataset(dicomDict.meta, metadata.PixelRepresentation);
  }
  return dicomDict;
}

export function reconstructDicomFromMetadata(metadata, transferSyntax = EXPLICIT_VR_LITTLE_ENDIAN) {
  if (transferSyntax !== EXPLICIT_VR_LITTLE_ENDIAN) {
    throw new Error('Metadata-only DICOM reconstruction requires Explicit VR Little Endian.');
  }
  const dicomDict = createDicomDict(metadata, transferSyntax);
  return new Blob([dicomDict.write()], { type: 'application/dicom' });
}

export function reconstructDicomFromFrames(
  metadata,
  frames,
  transferSyntax = EXPLICIT_VR_LITTLE_ENDIAN,
  options = {}
) {
  if (!isCompressedTransferSyntax(transferSyntax)) {
    const pixelData = concatenateFrames(frames);
    const expectedLength = expectedPixelDataLength(metadata);
    if (expectedLength === null || pixelData.byteLength !== expectedLength) {
      throw new Error(
        'The static DICOMweb source returned encoded frame data that cannot be safely rebuilt into a DICOM file.'
      );
    }

    const dicomDict = createDicomDict(metadata, EXPLICIT_VR_LITTLE_ENDIAN);
    dicomDict.dict['7FE00010'] = { vr: 'OW', Value: [pixelData] };
    return new Blob([dicomDict.write()], { type: 'application/dicom' });
  }

  const dicomDict = createDicomDict(metadata, transferSyntax);

  const paddedFrames = frames.map(frame => {
    let buffer;
    if (frame instanceof ArrayBuffer) {
      buffer = frame;
    } else if (ArrayBuffer.isView(frame)) {
      buffer = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    } else {
      buffer = new Uint8Array(frame || []).buffer;
    }
    return fixOddLengthFragment(new Uint8Array(buffer)).buffer;
  });

  let botBuffer;
  if (options.populateBot || options.populatedBot) {
    botBuffer = new ArrayBuffer(paddedFrames.length * 4);
    const botView = new DataView(botBuffer);
    let currentOffset = 0;
    for (let i = 0; i < paddedFrames.length; i++) {
      botView.setUint32(i * 4, currentOffset, true);
      currentOffset += 8 + paddedFrames[i].byteLength;
    }
  } else {
    botBuffer = new ArrayBuffer(0);
  }

  dicomDict.dict['7FE00010'] = { vr: 'OB', Value: [botBuffer, ...paddedFrames] };
  return new Blob([dicomDict.write()], { type: 'application/dicom' });
}

export function frameUrl(url, frameNumber) {
  return `${instanceUrl(url)}/frames/${frameNumber}`;
}

export function instanceUrl(url) {
  return String(url || '')
    .replace(/^(wadors:|dicomweb:|wadouri:)/, '')
    .replace(/\/frames\/\d+(?=\/|$|\?)/, '');
}

export function usesFrameRetrieval(metadata = {}) {
  return (
    Number(metadata.Rows) > 0 && Number(metadata.Columns) > 0 && Number(metadata.BitsAllocated) > 0
  );
}

function transferSyntaxFromContentType(contentType) {
  const value = String(contentType || '');
  const match = value.match(/transfer-syntax\s*=\s*(?:"([^"]+)"|([^;\s\r\n,]+))/i);
  if (match) {
    return match[1] || match[2];
  }
  const mediaTypeMatch = value.match(
    /(?:^|\r?\n)\s*(?:content-type\s*:\s*)?([a-z][a-z0-9.+-]*\/[a-z0-9.+-]+)/i
  );
  const mediaType = String(mediaTypeMatch?.[1] || '').toLowerCase();
  return MEDIA_TYPE_TRANSFER_SYNTAXES[mediaType] || null;
}

export function extractMultipart(buffer, responseContentType = '') {
  const bytes = new Uint8Array(buffer);
  const responseTransferSyntax = transferSyntaxFromContentType(responseContentType);
  const headerEnd = findBytes(bytes, [13, 10, 13, 10]);
  if (headerEnd === -1 || !startsWith(bytes, [45, 45])) {
    return { buffer, transferSyntax: responseTransferSyntax };
  }
  const boundaryEnd = findBytes(bytes, [13, 10], 2);
  if (boundaryEnd === -1) {
    return { buffer, transferSyntax: responseTransferSyntax };
  }
  const boundary = bytes.slice(0, boundaryEnd);

  const headersBytes = bytes.slice(boundaryEnd + 2, headerEnd);
  const headersText = new TextDecoder('utf-8').decode(headersBytes);
  const transferSyntax = transferSyntaxFromContentType(headersText) || responseTransferSyntax;

  const payloadStart = headerEnd + 4;
  const delimiter = new Uint8Array(boundary.length + 2);
  delimiter.set([13, 10]);
  delimiter.set(boundary, 2);
  const payloadEnd = findBytes(bytes, delimiter, payloadStart);
  const end = payloadEnd === -1 ? bytes.length : payloadEnd;
  const payloadBuffer = buffer.slice(payloadStart, end);

  return { buffer: payloadBuffer, transferSyntax };
}

export function extractMultipartPayload(buffer) {
  return extractMultipart(buffer).buffer;
}

function expectedPixelDataLength(metadata = {}) {
  const rows = Number(metadata.Rows);
  const columns = Number(metadata.Columns);
  const samples = Number(metadata.SamplesPerPixel || 1);
  const bitsAllocated = Number(metadata.BitsAllocated);
  const frames = Math.max(1, Number(metadata.NumberOfFrames) || 1);
  if (!rows || !columns || !bitsAllocated || bitsAllocated % 8 !== 0) {
    return null;
  }
  return rows * columns * samples * (bitsAllocated / 8) * frames;
}

function concatenateFrames(frames) {
  const size = frames.reduce((total, frame) => total + frame.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  frames.forEach(frame => {
    result.set(new Uint8Array(frame), offset);
    offset += frame.byteLength;
  });
  return result.buffer;
}

function startsWith(bytes, prefix) {
  return prefix.every((value, index) => bytes[index] === value);
}

function findBytes(bytes, needle, start = 0) {
  outer: for (let index = start; index <= bytes.length - needle.length; index++) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function isPart10File(buffer) {
  const bytes = new Uint8Array(buffer);
  return (
    bytes.length >= 132 &&
    bytes[128] === 68 &&
    bytes[129] === 73 &&
    bytes[130] === 67 &&
    bytes[131] === 77
  );
}
