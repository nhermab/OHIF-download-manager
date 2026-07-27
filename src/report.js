/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * One identity scheme and one copyable report for the export UI.
 *
 * The activity log labels items with `itemDisplayLabel` ("image set 3 / <sop>.dcm").
 * Everything the user sees afterwards — the failed-file breakdown, the copied
 * support report — is built from the helpers here so the two can be correlated.
 */

import { fileName } from './manifest.js';
import { formatBytes, formatDuration } from './utils.js';

export function seriesLabelForItem(item) {
  if (!item || typeof item !== 'object') {
    return 'Unknown image set';
  }
  const seriesNumber = item.seriesNumber != null && item.seriesNumber !== '' ? item.seriesNumber : '?';
  const description =
    item.metadata?.SeriesDescription || item.metadata?.seriesDescription || '';
  return `image set ${seriesNumber}${description ? ` — ${description}` : ''}`;
}

/**
 * Full identity of a single instance, sharing its prefix with the activity log
 * so a failed file can be found in the log by searching for the same text.
 */
export function itemIdentityLabel(item) {
  if (!item || typeof item !== 'object') {
    return 'Unknown image file';
  }
  const parts = [seriesLabelForItem(item)];
  if (item.instanceNumber != null && item.instanceNumber !== '') {
    parts.push(`image ${item.instanceNumber}`);
  }
  if (item.sopUid) {
    parts.push(fileName(item));
  }
  return parts.join(' · ');
}

/**
 * Group failures by image set so the user can see that one series failed
 * wholesale instead of reading N unrelated lines.
 */
export function groupFailuresBySeries(failedItems = []) {
  const groups = new Map();

  failedItems.forEach(entry => {
    const item = entry?.item || {};
    const key = item.seriesUid || seriesLabelForItem(item);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: seriesLabelForItem(item),
        count: 0,
        causes: new Map(),
        items: [],
      });
    }
    const group = groups.get(key);
    group.count++;
    group.items.push(entry);
    const cause = entry?.error || 'Unknown download error';
    group.causes.set(cause, (group.causes.get(cause) || 0) + 1);
  });

  return Array.from(groups.values()).map(group => ({
    key: group.key,
    label: group.label,
    count: group.count,
    items: group.items,
    causes: Array.from(group.causes.entries()).map(([cause, count]) => ({ cause, count })),
  }));
}

function outcomeLine({ summary, error, issue }) {
  if (summary?.cancelled) {
    return 'Cancelled by user';
  }
  if (issue) {
    return `Failed — ${issue.title}: ${issue.message}`;
  }
  if (error) {
    return `Failed — ${error.message || String(error)}`;
  }
  if (summary?.failed > 0) {
    return 'Completed with failures';
  }
  if (summary?.notAnonymizedItems?.length) {
    return 'Completed — not fully de-identified';
  }
  return 'Completed';
}

/**
 * Plain-text run report for support tickets. Everything on screen, in one
 * selectable block: run metadata, counts, per-file causes and the activity log.
 *
 * @param {{
 *   summary?: any,
 *   error?: any,
 *   issue?: any,
 *   logs?: Array<{ timestamp: string, message: string, type: string }>,
 *   runId?: string,
 *   startedAt?: number,
 * }} [options]
 */
export function buildRunReport(options = {}) {
  const { summary, error, issue, logs = [], runId, startedAt } = options;
  const lines = [];

  lines.push('OHIF Download Manager — export report');
  lines.push('=====================================');
  if (runId) {
    lines.push(`Run ID:      ${runId}`);
  }
  if (startedAt) {
    lines.push(`Started:     ${new Date(startedAt).toISOString()}`);
  }
  lines.push(`Generated:   ${new Date().toISOString()}`);
  lines.push(`Outcome:     ${outcomeLine({ summary, error, issue })}`);

  if (summary) {
    lines.push(`Saved:       ${summary.done || 0}`);
    lines.push(`Failed:      ${summary.failed || 0}`);
    lines.push(`Requested:   ${summary.total || 0}`);
    lines.push(`Volume:      ${formatBytes(summary.totalBytes || 0)}`);
    lines.push(`Duration:    ${formatDuration(summary.durationMs || 0)}`);
  }

  if (issue) {
    lines.push('');
    lines.push(`Issue: ${issue.title}`);
    lines.push(issue.message);
  }

  if (error) {
    lines.push('');
    lines.push(`Error: ${error.name || 'Error'}: ${error.message || String(error)}`);
    if (error.stack) {
      lines.push(String(error.stack));
    }
  }

  const failedItems = summary?.failedItems || [];
  if (failedItems.length) {
    lines.push('');
    lines.push(`Failed files (${failedItems.length})`);
    lines.push('-'.repeat(30));
    groupFailuresBySeries(failedItems).forEach(group => {
      lines.push(`${group.label} — ${group.count} file(s) missing`);
      group.causes.forEach(({ cause, count }) => {
        lines.push(`    ${count}× ${cause}`);
      });
      group.items.forEach(entry => {
        lines.push(`    ${itemIdentityLabel(entry.item)}: ${entry.error || 'Unknown download error'}`);
      });
    });
  }

  const notAnonymized = summary?.notAnonymizedItems || [];
  if (notAnonymized.length) {
    lines.push('');
    lines.push(`NOT ANONYMIZED (${notAnonymized.length})`);
    lines.push('-'.repeat(30));
    notAnonymized.forEach(entry => {
      lines.push(`${entry.fileName || entry.sopInstanceUid}: ${entry.reason}`);
    });
  }

  const anonWarnings = summary?.anonymizationWarnings || [];
  if (anonWarnings.length) {
    lines.push('');
    lines.push(`Anonymization notes (${anonWarnings.length})`);
    lines.push('-'.repeat(30));
    anonWarnings.forEach(warning => lines.push(warning));
  }

  if (logs.length) {
    lines.push('');
    lines.push(`Activity log (${logs.length} entries)`);
    lines.push('-'.repeat(30));
    logs.forEach(log => {
      lines.push(`[${log.timestamp}] ${String(log.type || 'info').toUpperCase()}: ${log.message}`);
    });
  }

  return lines.join('\n');
}

/**
 * Clipboard write that also works outside a secure context, where
 * navigator.clipboard is undefined.
 */
export async function copyTextToClipboard(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (ignore) {
    // fall through to the legacy path
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch (ignore) {
    return false;
  }
}
