/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Dedicated DICOM Repair, Patch, and Fix Utility Module.
 * Contains isolated functions for DICOM file header repair, VR resolution,
 * fragment alignment, preamble verification, and metadata sanitization.
 */

import dcmjs from 'dcmjs';
import {
  EXPLICIT_VR_LITTLE_ENDIAN,
  IMPLEMENTATION_CLASS_UID,
  AMBIGUOUS_VR_CODES,
  AMBIGUOUS_VR,
  DCMJS_META_KEYS,
  NON_DICOM_METADATA_KEYS,
} from '../constants/dicom.js';

/**
 * Ensures standard 128-byte zero-padded preamble + 4-byte 'DICM' prefix.
 *
 * @param {ArrayBuffer|Uint8Array} buffer - Raw DICOM binary buffer
 * @returns {Uint8Array} Repaired or verified DICOM byte array with valid preamble
 */
export function repairDicomPreamble(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (
    bytes.length >= 132 &&
    bytes[128] === 0x44 && // 'D'
    bytes[129] === 0x49 && // 'I'
    bytes[130] === 0x43 && // 'C'
    bytes[131] === 0x4d    // 'M'
  ) {
    return bytes;
  }

  // Prepend 128 null bytes + 'DICM'
  const repaired = new Uint8Array(132 + bytes.length);
  repaired.fill(0, 0, 128);
  repaired[128] = 0x44;
  repaired[129] = 0x49;
  repaired[130] = 0x43;
  repaired[131] = 0x4d;
  repaired.set(bytes, 132);
  return repaired;
}

/**
 * Pads odd-length DICOM pixel data fragments to an even byte boundary per PS3.5.
 *
 * @param {Uint8Array} fragmentBuffer - Fragment byte array
 * @returns {Uint8Array} Even-length padded fragment
 */
export function fixOddLengthFragment(fragmentBuffer) {
  if (!fragmentBuffer || fragmentBuffer.length % 2 === 0) {
    return fragmentBuffer;
  }
  const padded = new Uint8Array(fragmentBuffer.length + 1);
  padded.set(fragmentBuffer, 0);
  padded[fragmentBuffer.length] = 0; // Pad byte
  return padded;
}

/**
 * Checks if a value is binary (ArrayBuffer, TypedArray view, or InlineBinary).
 */
export function hasBinaryValue(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== 'object') return false;
  return (
    first instanceof ArrayBuffer ||
    ArrayBuffer.isView(first) ||
    typeof first.InlineBinary === 'string'
  );
}

/**
 * Resolves context-dependent ambiguous VRs (US|SS, US|OW) based on dataset values.
 *
 * @param {string} vr - Declared VR string or ambiguous code
 * @param {any} value - Attribute value
 * @param {number|string} pixelRepresentation - DICOM Pixel Representation (0=unsigned, 1=signed)
 * @returns {string} Concrete resolved VR string
 */
export function resolveAmbiguousVr(vr, value, pixelRepresentation) {
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

/**
 * Recursively resolves context-dependent representations in naturalized datasets.
 * Recovers dictionary VRs incorrectly labeled UN, fixes backslash-delimited strings,
 * and preserves exact binary VR structures.
 *
 * @param {Object} node - Naturalized DICOM dataset node
 * @param {number|string} pixelRepresentation - DICOM Pixel Representation
 * @returns {Object} Dataset node with resolved VRs
 */
export function withResolvedVrs(node, pixelRepresentation) {
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
    const dictionaryEntry = DicomMetaDictionary.nameMap[name];
    const dictionaryVr = dictionaryEntry?.vr;
    if (
      typeof node[name] === 'string' &&
      node[name].includes('\\') &&
      dictionaryEntry?.vm &&
      dictionaryEntry.vm !== '1'
    ) {
      clone()[name] = node[name].split('\\');
    }
    const declaredVr = vrMap && vrMap[name];
    let vr = declaredVr || dictionaryVr;
    let changed = false;
    if (vr === 'UN' && dictionaryVr && dictionaryVr !== 'UN' && !hasBinaryValue(node[name])) {
      vr = dictionaryVr;
      changed = true;
    }
    if (typeof vr === 'string' && AMBIGUOUS_VR.test(vr)) {
      vr = resolveAmbiguousVr(vr, node[name], pixelRepresentation);
      changed = true;
    }
    if (changed || (vrMap && vrMap[name] !== vr)) {
      if (!resolved) {
        resolved = { ...(vrMap || {}) };
      }
      resolved[name] = vr;
    }
    const updated = resolveChildVrs(node[name], pixelRepresentation);
    if (updated !== node[name]) {
      clone()[name] = updated;
    }
  }

  if (resolved) {
    clone()._vrMap = resolved;
  }
  return result;
}

/**
 * Resolves child node VRs in sequences or nested structures.
 */
export function resolveChildVrs(value, pixelRepresentation) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  if (typeof value.InlineBinary === 'string' || typeof value.BulkDataURI === 'string') {
    return value;
  }
  return withResolvedVrs(value, pixelRepresentation);
}

/**
 * Repairs File Meta Information header (_meta) for DICOM Part 10 dataset serialization.
 *
 * @param {Object} naturalizedDataset - Naturalized DICOM dataset object
 * @param {Object} meta - Existing meta header object
 * @param {string} targetTransferSyntax - Target transfer syntax UID
 * @returns {Object} Repaired DICOM meta object
 */
export function repairDicomMeta(naturalizedDataset, meta, targetTransferSyntax) {
  const transferSyntax = targetTransferSyntax || EXPLICIT_VR_LITTLE_ENDIAN;
  const sopClassUid =
    naturalizedDataset?.SOPClassUID ||
    meta?.MediaStorageSOPClassUID ||
    '1.2.840.10008.5.1.4.1.1.7'; // Secondary Capture Image Storage default
  const sopInstanceUid =
    naturalizedDataset?.SOPInstanceUID ||
    meta?.MediaStorageSOPInstanceUID ||
    '1.2.840.10008.5.1.4.1.1.7.1';

  return {
    FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
    MediaStorageSOPClassUID: sopClassUid,
    MediaStorageSOPInstanceUID: sopInstanceUid,
    TransferSyntaxUID: transferSyntax,
    ImplementationClassUID: IMPLEMENTATION_CLASS_UID,
    ...meta,
  };
}

/**
 * Removes non-DICOM keys attached by UI/viewer state before dataset encoding.
 *
 * @param {Object} naturalizedDataset - Raw dataset object
 * @returns {Object} Cleaned DICOM dataset object
 */
export function sanitizeDicomDataset(naturalizedDataset) {
  if (!naturalizedDataset || typeof naturalizedDataset !== 'object') {
    return naturalizedDataset;
  }
  const clean = { ...naturalizedDataset };
  for (const key of NON_DICOM_METADATA_KEYS) {
    delete clean[key];
  }
  return clean;
}
