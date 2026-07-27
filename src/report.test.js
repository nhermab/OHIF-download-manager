/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import { itemIdentityLabel, groupFailuresBySeries, buildRunReport } from './report.js';

function item(overrides = {}) {
  return {
    seriesNumber: 3,
    instanceNumber: 42,
    sopUid: '1.2.840.10008.1.2.3.4.5',
    extension: 'dcm',
    seriesUid: '1.2.840.10008.9.9.9',
    metadata: { SeriesDescription: 'T1 AXIAL' },
    ...overrides,
  };
}

describe('export report identity', () => {
  it('shares its prefix with the activity log label', () => {
    // downloader.itemDisplayLabel writes "image set 3 / <sop>.dcm"
    expect(itemIdentityLabel(item())).toBe(
      'image set 3 — T1 AXIAL · image 42 · 1.2.840.10008.1.2.3.4.5.dcm'
    );
  });

  it('degrades gracefully when metadata is missing', () => {
    expect(itemIdentityLabel({})).toBe('image set ?');
    expect(itemIdentityLabel(null)).toBe('Unknown image file');
  });

  it('groups failures by image set with per-cause counts', () => {
    const groups = groupFailuresBySeries([
      { item: item(), error: 'HTTP 500' },
      { item: item({ instanceNumber: 43 }), error: 'HTTP 500' },
      { item: item({ seriesUid: 'other', seriesNumber: 4 }), error: 'HTTP 404' },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(2);
    expect(groups[0].label).toBe('image set 3 — T1 AXIAL');
    expect(groups[0].causes).toEqual([{ cause: 'HTTP 500', count: 2 }]);
    expect(groups[1].count).toBe(1);
  });
});

describe('buildRunReport', () => {
  const summary = {
    done: 480,
    failed: 20,
    total: 500,
    totalBytes: 1024,
    durationMs: 60000,
    failedItems: [{ item: item(), error: 'HTTP 500' }],
    anonymizationWarnings: ['file.dcm: pixel fallback'],
    notAnonymizedItems: [{ fileName: 'clip.mp4', contentType: 'mp4', reason: 'no path' }],
  };

  it('reports counts, causes and the log in one copyable block', () => {
    const report = buildRunReport({
      summary,
      logs: [{ timestamp: '10:00:00', message: 'Saved image set 3', type: 'success' }],
    });

    expect(report).toContain('Outcome:     Completed with failures');
    expect(report).toContain('Saved:       480');
    expect(report).toContain('Failed:      20');
    expect(report).toContain('1× HTTP 500');
    expect(report).toContain('NOT ANONYMIZED (1)');
    expect(report).toContain('[10:00:00] SUCCESS: Saved image set 3');
  });

  it('names cancellation and terminal issues as outcomes rather than errors', () => {
    expect(buildRunReport({ summary: { ...summary, cancelled: true } })).toContain(
      'Outcome:     Cancelled by user'
    );
    expect(
      buildRunReport({ issue: { title: 'Session expired', message: 'Reopen the exam.' } })
    ).toContain('Outcome:     Failed — Session expired: Reopen the exam.');
  });

  it('flags an otherwise clean export that contains un-anonymized files', () => {
    const report = buildRunReport({
      summary: { ...summary, failed: 0, failedItems: [] },
    });
    expect(report).toContain('Outcome:     Completed — not fully de-identified');
  });
});
