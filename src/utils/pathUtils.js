/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Path Safety, Sanitization, UID and Date Normalization Utilities.
 */

import { padLeft } from './stringUtils.js';

/**
 * Sanitizes strings for safe single-segment filenames/labels.
 * Strictly prevents path traversal ('..') and invalid character sequences.
 */
export function safeName(value) {
  let str = String(value || "unknown").replace(/\.\./g, "_");
  str = str.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+|[._]+$/g, "");
  return str || "unknown";
}

export function shortUid(uid) {
  const value = String(uid || "");
  if (value.length <= 28) {
    return value;
  }
  return value.substring(Math.max(0, value.length - 28));
}

/**
 * Robust filesystem path sanitization.
 * Replaces illegal directory characters, control characters, whitespace, and
 * dangerous path traversal sequences ('..') with underscores across Windows/macOS/Linux.
 */
export function sanitize(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  let str = String(value);
  if (typeof str.normalize === "function") {
    str = str.normalize("NFKC");
  }
  str = str.trim();
  // Prevent path traversal attempts
  str = str.replace(/\.\./g, "_");
  // Replace illegal OS filename characters & control chars
  str = str.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  // Compress whitespace and multiple underscores
  str = str.replace(/\s+/g, "_");
  str = str.replace(/_+/g, "_");
  // Trim leading/trailing dots and underscores
  str = str.replace(/^[._]+|[._]+$/g, "");
  return str || fallback;
}

export function normalizeDate(value) {
  if (!value) return "UNKNOWN_DATE";
  const str = String(value).trim();
  if (/^\d{8}$/.test(str)) {
    return str;
  }
  return "UNKNOWN_DATE";
}

export function normalizeSeriesNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "NO_SERIES_NUMBER";
  }
  const trimmed = String(value).trim();
  if (/^-?\d+$/.test(trimmed)) {
    const number = parseInt(trimmed, 10);
    if (number >= 0) {
      return padLeft(String(number), 3);
    }
    return "-" + padLeft(String(-number), 3);
  }
  return sanitize(trimmed, "NO_SERIES_NUMBER");
}

export function validateSopInstanceUid(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  // PS3.5 UID: numeric components separated by single dots, no leading zero
  // in multi-digit components, maximum 64 characters.
  if (
    trimmed.length <= 64 &&
    /^([0-9]|[1-9][0-9]*)(\.([0-9]|[1-9][0-9]*))*$/.test(trimmed)
  ) {
    return trimmed;
  }
  return null;
}
