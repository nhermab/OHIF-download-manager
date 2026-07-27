/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Reconstruction engine for static DICOM SOP Instances.
 */

import dcmjs from 'dcmjs';

const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';
const IMPLEMENTATION_CLASS_UID = '2.25.80302813137786398554742050926734630921603366648225212145404';

// Keys of a naturalized dataset that are raw hexadecimal tags: dcmjs leaves
// private and otherwise unrecognized tags under their group/element number
// because the data dictionary has no keyword for them.
const RAW_TAG_KEY = /^[0-9A-Fa-f]{8}$/;

// Keys OHIF attaches to instance metadata that are not DICOM at all.
const NON_DICOM_METADATA_KEYS = [
  'url',
  'imageId',
  'wadouri',
  'wadorsuri',
  'wadoRoot',
  'wadoUri',
  'localFile',
];

// dcmjs reads the original value representation of data dependent tags from
// _vrMap, so it has to survive the split below.
const DCMJS_META_KEYS = ['_vrMap', '_meta'];

// Tags whose value representation could not be recovered are reported once per
// session instead of once per instance, which would flood the console.
const reportedUnwritableTags = new Set();

// PS3.6 gives a handful of attributes a context dependent value representation.
// dcmjs encodes those in its dictionary with its own codes, while a DICOMweb
// origin is free to hand back the standard's notation ("US|SS", "US|OW") in its
// JSON metadata, which dcmjs then carries into _vrMap because it differs from
// the dictionary entry. It can write neither form: both reach the writer as
// "Invalid vr type ... - using UN" and the element is degraded to UN.
//
// "ox" is deliberately absent: dcmjs resolves that one itself from _vrMap.
const AMBIGUOUS_VR_CODES = { xs: 'US|SS', lt: 'US|OW' };
const AMBIGUOUS_VR = /\||^(xs|lt)$/;

function hasBinaryValue(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== 'object') return false;
  return (
    first instanceof ArrayBuffer ||
    ArrayBuffer.isView(first) ||
    typeof first.InlineBinary === 'string'
  );
}

/**
 * Picks the concrete value representation the standard leaves to context. The
 * choice has to be made from the data itself: signedness follows Pixel
 * Representation, and lookup table data is words or numbers depending on how
 * the origin serialized it.
 */
function resolveAmbiguousVr(vr, value, pixelRepresentation) {
  const parts = (AMBIGUOUS_VR_CODES[vr] || String(vr)).split('|');
  if (parts.length < 2) return vr;
  if (parts.includes('US') && parts.includes('OW')) {
    return hasBinaryValue(value) ? 'OW' : 'US';
  }
  if (parts.includes('US') && parts.includes('SS')) {
    const values = Array.isArray(value) ? value.flat(Infinity) : [value];
    const signed =
      Number(pixelRepresentation) === 1 || values.some(v => typeof v === 'number' && v < 0);
    return signed ? 'SS' : 'US';
  }
  return parts[0];
}

function resolveChildVrs(value, pixelRepresentation) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  if (typeof value.InlineBinary === 'string' || typeof value.BulkDataURI === 'string') {
    return value;
  }
  return withResolvedVrs(value, pixelRepresentation);
}

/**
 * Resolves every context dependent representation recorded in a naturalized
 * dataset's _vrMap, including the ones inside sequence items. Only the levels
 * that actually change are cloned, so the viewer's shared instance metadata is
 * never mutated.
 */
function withResolvedVrs(node, pixelRepresentation) {
  if (!node || typeof node !== 'object') return node;

  let result = node;
  const clone = () => {
    if (result === node) {
      result = { ...node };
    }
    return result;
  };

  const { DicomMetaDictionary } = dcmjs.data;
  const vrMap = node._vrMap && typeof node._vrMap === 'object' ? node._vrMap : null;
  let resolved = null;
  for (const name of Object.keys(node)) {
    if (DCMJS_META_KEYS.includes(name)) continue;
    // What the origin declared wins over the dictionary's context free entry.
    const vr = (vrMap && vrMap[name]) || DicomMetaDictionary.nameMap[name]?.vr;
    if (typeof vr === 'string' && AMBIGUOUS_VR.test(vr)) {
      resolved = resolved || {};
      resolved[name] = resolveAmbiguousVr(vr, node[name], pixelRepresentation);
    }
  }
  if (resolved) {
    clone()._vrMap = { ...vrMap, ...resolved };
  }

  for (const key of Object.keys(node)) {
    if (DCMJS_META_KEYS.includes(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      let items = null;
      for (let index = 0; index < value.length; index++) {
        const next = resolveChildVrs(value[index], pixelRepresentation);
        if (next !== value[index]) {
          items = items || value.slice();
          items[index] = next;
        }
      }
      if (items) clone()[key] = items;
      continue;
    }
    const next = resolveChildVrs(value, pixelRepresentation);
    if (next !== value) clone()[key] = next;
  }

  return result;
}

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

/**
 * Rebuilds a raw DICOM element for a tag that has no data dictionary entry.
 * Returns null when the original value representation cannot be recovered from
 * the naturalized metadata, in which case the tag has to be dropped.
 */
function rawTagElement(tag, value) {
  if (value === null || value === undefined) {
    return { vr: isPrivateCreatorTag(tag) ? 'LO' : 'UN', Value: [] };
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.InlineBinary === 'string') {
      return { vr: 'UN', Value: [toEvenLengthBuffer(base64ToUint8Array(value.InlineBinary), 0)] };
    }
    // BulkDataURI values and private sequences are not retrievable here.
    return null;
  }

  const values = Array.isArray(value) ? value : [value];
  if (!values.length) {
    return { vr: 'UN', Value: [] };
  }
  if (!values.every(entry => typeof entry === 'string')) {
    // Numeric values were binary in the source object; their width and
    // signedness are lost during naturalization, so they cannot be re-encoded.
    return null;
  }
  if (isPrivateCreatorTag(tag)) {
    return { vr: 'LO', Value: values };
  }
  // PS3.5 allows UN for private elements of unknown value representation; the
  // original text bytes are preserved verbatim.
  return { vr: 'UN', Value: [toEvenLengthBuffer(new TextEncoder().encode(values.join('\\')), 0x20)] };
}

/**
 * Splits naturalized instance metadata into the part dcmjs can denaturalize and
 * the raw tags it would otherwise discard with a console warning per instance.
 */
function splitDataset(rawMetadata) {
  const { DicomMetaDictionary } = dcmjs.data;
  // Ambiguous representations are resolved before denaturalization so dcmjs
  // sees a representation it can write instead of degrading the element to UN.
  const metadata = withResolvedVrs(rawMetadata, rawMetadata.PixelRepresentation);
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
  console.debug(`Download manager: ${tag} ${reason} and is omitted from reconstructed DICOM files.`);
}

export function reconstructDicomFromFrames(metadata, frames, transferSyntax = EXPLICIT_VR_LITTLE_ENDIAN, options = {}) {
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

      if (element.vr && typeof element.vr === 'string' && AMBIGUOUS_VR.test(element.vr)) {
        element.vr = resolveAmbiguousVr(element.vr, element.Value, metadata.PixelRepresentation);
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

    const { dataset, rawElements } = splitDataset(metadata);

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
    dicomDict.dict = Object.assign(DicomMetaDictionary.denaturalizeDataset(dataset), rawElements);
    dicomDict.dict['7FE00010'] = { vr: 'OW', Value: [pixelData] };
    normalizeDataset(dicomDict.dict);
    if (dicomDict.meta) {
      normalizeDataset(dicomDict.meta);
    }
    return new Blob([dicomDict.write()], { type: 'application/dicom' });
  }

  // Compressed (encapsulated) transfer syntax path
  const { dataset, rawElements } = splitDataset(metadata);

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
