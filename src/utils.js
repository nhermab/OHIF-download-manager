/**
 * Utility functions for download-manager plugin.
 * Includes formatting, sanitization, path safety, and type conversions.
 */

export function valueOr(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : value;
}

export function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function firstNonEmpty(values) {
  if (!Array.isArray(values)) return "";
  for (const candidate of values) {
    if (typeof candidate !== "string" && typeof candidate !== "number") {
      continue;
    }
    const value = trimText(candidate);
    if (value) {
      return value;
    }
  }
  return "";
}

export function trimText(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

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

export function padLeft(value, size) {
  let str = String(value);
  while (str.length < size) {
    str = "0" + str;
  }
  return str;
}

export function errorMessage(error) {
  return error && error.message ? error.message : String(error || "Unknown error");
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / Math.pow(1024, unitIndex);
  return scaled.toFixed(scaled >= 10 || unitIndex === 0 ? 0 : 1) + " " + units[unitIndex];
}

export function formatTransferSpeed(bytes, startTime) {
  if (!startTime || !bytes) {
    return "--";
  }
  const elapsedSeconds = Math.max(1, (Date.now() - startTime) / 1000);
  return formatBytes(bytes / elapsedSeconds) + "/s";
}

export function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function createNamedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
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
