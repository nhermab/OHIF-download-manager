/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Reconstruction engine for static DICOM SOP Instances.
 */

import dcmjs from 'dcmjs';

const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';
const IMPLEMENTATION_CLASS_UID = '2.25.80302813137786398554742050926734630921603366648225212145404';

export async function reconstructStaticDicom(item, authorizationHeaders, signal, options = {}) {
  if (!usesFrameRetrieval(item.metadata)) {
    const instanceData = await retrieveStaticResource(
      instanceUrl(item.url),
      authorizationHeaders,
      signal,
      'application/dicom,*/*'
    );
    if (!isPart10File(instanceData.buffer)) {
      throw new Error(
        'The static DICOMweb source did not return a Part 10 DICOM file for this non-image SOP class.'
      );
    }
    return new Blob([instanceData.buffer], { type: 'application/dicom' });
  }

  const frameCount = Math.max(1, Number(item.metadata?.NumberOfFrames) || 1);
  const frameUrls = Array.from({ length: frameCount }, (_, index) => frameUrl(item.url, index + 1));
  const frames = [];
  let detectedTransferSyntax = null;

  for (const url of frameUrls) {
    const frameData = await retrieveStaticResource(
      url,
      authorizationHeaders,
      signal,
      'multipart/related; type=application/octet-stream; transfer-syntax=*'
    );
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
    // Static WADO hosts commonly return Access-Control-Allow-Origin: *.
    // Sending cross-origin cookies would make that otherwise-valid response
    // fail CORS validation in the browser.
    credentials: 'same-origin',
    signal,
    headers: {
      ...authorizationHeaders,
      Accept: accept,
    },
  });
  if (!response.ok) {
    throw new Error(`Unable to retrieve DICOM pixels: HTTP ${response.status}`);
  }
  return extractMultipart(await response.arrayBuffer());
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

export function reconstructDicomFromFrames(metadata, frames, transferSyntax = EXPLICIT_VR_LITTLE_ENDIAN, options = {}) {
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

  function parseInlineBinary(inlineBinary, vr) {
    const bytes = base64ToUint8Array(inlineBinary);
    const isBinaryVr = vr === 'OB' || vr === 'OW' || vr === 'UN' || vr === 'OF' || vr === 'OD' || vr === 'OL' || vr === 'OV';
    if (!isBinaryVr) {
      return Array.from(new Uint16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2)));
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  function toNormalizedValue(v, vr) {
    if (v && typeof v === 'object' && typeof v.InlineBinary === 'string') {
      v = parseInlineBinary(v.InlineBinary, vr);
    }
    const isBinaryVr = vr === 'OB' || vr === 'OW' || vr === 'UN' || vr === 'OF' || vr === 'OD' || vr === 'OL' || vr === 'OV';
    if (!isBinaryVr && (v instanceof ArrayBuffer || ArrayBuffer.isView(v))) {
      const buf = v instanceof ArrayBuffer ? v : v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
      return Array.from(new Uint16Array(buf));
    }
    if (v instanceof ArrayBuffer) return v;
    if (ArrayBuffer.isView(v)) {
      return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
    }
    return v;
  }

  function normalizeElementValue(value, vr) {
    if (value === null || value === undefined) return value;
    let items = Array.isArray(value) ? value : [value];
    while (items.some(item => Array.isArray(item))) {
      items = items.flat(Infinity);
    }
    items = items.map(v => toNormalizedValue(v, vr));
    while (items.some(item => Array.isArray(item))) {
      items = items.flat(Infinity);
    }
    if (vr === 'DA') {
      items = items.map(v => (typeof v === 'string' ? v.replace(/[-.\/\s]/g, '') : v));
    }
    return items;
  }

  function normalizeDataset(dict) {
    for (const tag of Object.keys(dict)) {
      const element = dict[tag];
      if (!element) continue;

      if (element.vr && typeof element.vr === 'string' && element.vr.includes('|')) {
        const parts = element.vr.split('|');
        element.vr = parts[0] === 'US' && parts[1] === 'OW' ? 'OW' : parts[0];
      }

      if (element.Value !== undefined) {
        element.Value = normalizeElementValue(element.Value, element.vr);
      }

      if (element.vr === 'SQ' && Array.isArray(element.Value)) {
        for (const item of element.Value) {
          if (item && typeof item === 'object') {
            normalizeDataset(item);
          }
        }
      }
    }
  }

  if (!isCompressedTransferSyntax(transferSyntax)) {
    const pixelData = concatenateFrames(frames);
    const expectedLength = expectedPixelDataLength(metadata);
    if (expectedLength === null || pixelData.byteLength !== expectedLength) {
      throw new Error(
        'The static DICOMweb source returned encoded frame data that cannot be safely rebuilt into a DICOM file.'
      );
    }

    const dataset = { ...metadata };
    delete dataset.url;
    delete dataset.imageId;
    delete dataset.wadouri;
    delete dataset.wadorsuri;
    delete dataset.wadoRoot;
    delete dataset.wadoUri;
    delete dataset.localFile;
    delete dataset.PixelData;
    delete dataset['7FE00010'];

    const { DicomDict, DicomMetaDictionary } = dcmjs.data;
    const fileMeta = {
      MediaStorageSOPClassUID: dataset.SOPClassUID,
      MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
      ImplementationVersionName: 'OHIF-DM',
      TransferSyntaxUID: EXPLICIT_VR_LITTLE_ENDIAN,
      ImplementationClassUID: IMPLEMENTATION_CLASS_UID,
      FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
    };
    const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(fileMeta));
    dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
    dicomDict.dict['7FE00010'] = { vr: 'OW', Value: [pixelData] };
    normalizeDataset(dicomDict.dict);
    if (dicomDict.meta) {
      normalizeDataset(dicomDict.meta);
    }
    return new Blob([dicomDict.write()], { type: 'application/dicom' });
  }

  // Compressed (encapsulated) transfer syntax path
  const dataset = { ...metadata };
  delete dataset.url;
  delete dataset.imageId;
  delete dataset.wadouri;
  delete dataset.wadorsuri;
  delete dataset.wadoRoot;
  delete dataset.wadoUri;
  delete dataset.localFile;
  delete dataset.PixelData;
  delete dataset['7FE00010'];

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
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);

  // Preserve even-byte padding for every fragment
  const paddedFrames = frames.map(frame => {
    let buffer;
    if (frame instanceof ArrayBuffer) {
      buffer = frame;
    } else if (ArrayBuffer.isView(frame)) {
      buffer = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    } else {
      buffer = new Uint8Array(frame || []).buffer;
    }
    const bytes = new Uint8Array(buffer);
    if (bytes.length % 2 === 0) {
      return buffer;
    }
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes);
    padded[bytes.length] = 0; // Padding byte
    return padded.buffer;
  });

  // Generate valid offsets if consumers require a populated Basic Offset Table
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
    // Empty Basic Offset Table item
    botBuffer = new ArrayBuffer(0);
  }

  dicomDict.dict['7FE00010'] = { vr: 'OB', Value: [botBuffer, ...paddedFrames] };
  normalizeDataset(dicomDict.dict);
  if (dicomDict.meta) {
    normalizeDataset(dicomDict.meta);
  }
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

export function extractMultipart(buffer) {
  const bytes = new Uint8Array(buffer);
  const headerEnd = findBytes(bytes, [13, 10, 13, 10]);
  if (headerEnd === -1 || !startsWith(bytes, [45, 45])) {
    return { buffer, transferSyntax: null };
  }
  const boundaryEnd = findBytes(bytes, [13, 10], 2);
  if (boundaryEnd === -1) {
    return { buffer, transferSyntax: null };
  }
  const boundary = bytes.slice(0, boundaryEnd);
  
  const headersBytes = bytes.slice(boundaryEnd + 2, headerEnd);
  const headersText = new TextDecoder('utf-8').decode(headersBytes);
  const match = headersText.match(/transfer-syntax\s*=\s*(?:"([^"]+)"|([^;\s\r\n]+))/i);
  const transferSyntax = match ? (match[1] || match[2]) : null;

  const payloadStart = headerEnd + 4;
  const payloadEnd = findBytes(bytes, boundary, payloadStart);
  const end = payloadEnd === -1 ? bytes.length : payloadEnd - 2;
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
