/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * String, Value, and Error Handling Utilities.
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
