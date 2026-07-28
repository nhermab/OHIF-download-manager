/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Data Size and Time Formatting Utilities.
 */

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
