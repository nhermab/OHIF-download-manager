/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import { isRetryableError, retryAfterMs, retryDelayMs, downloadManifest } from '../src/downloader/downloader';
import { buildManifest } from '../src/downloader/manifest';

function readBlobText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('download retry policy', () => {
  it('retries only transient network and server failures', () => {
    expect(isRetryableError(Object.assign(new Error('server'), { name: 'HttpError', status: 500 }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error('busy'), { name: 'HttpError', status: 429 }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error('missing'), { name: 'HttpError', status: 404 }))).toBe(false);
    expect(isRetryableError(Object.assign(new Error('invalid DICOM'), { name: 'PayloadValidationError' }))).toBe(false);
    expect(isRetryableError(new TypeError('network failed'))).toBe(true);
  });

  it('uses bounded exponential backoff and Retry-After', () => {
    expect(retryDelayMs(1, null)).toBe(500);
    expect(retryDelayMs(3, null)).toBe(2000);
    expect(retryDelayMs(20, null)).toBe(30000);
    expect(retryDelayMs(1, 1200)).toBe(1200);
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs('999')).toBe(30000);
    expect(retryAfterMs('not-a-date')).toBeNull();
  });
});

describe('partial download and retry behavior', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation(async (url) => {
      if (String(url).includes('bad-sop')) {
        return {
          ok: false,
          status: 500,
          headers: {
            get: (key) => null,
          },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (key) => (key.toLowerCase() === 'content-type' ? 'video/mp4' : null),
        },
        blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
      };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('allows partial exports when some items fail, recording failed items and finalizing writer', async () => {
    const mockWriter = {
      name: 'mock-writer',
      write: jest.fn().mockResolvedValue(undefined),
      writeArtifact: jest.fn().mockResolvedValue(undefined),
      finalize: jest.fn().mockResolvedValue(undefined),
    };

    const goodItem = {
      sopUid: 'good-sop-1',
      seriesUid: 'series-1',
      studyUid: 'study-1',
      url: 'http://localhost/good-sop-1.mp4',
      extension: 'mp4',
      patientDir: 'ANON_P1',
      studyDir: 'ANON_S1',
      seriesDir: 'ANON_SE1',
    };

    const badItem = {
      sopUid: 'bad-sop',
      seriesUid: 'series-1',
      studyUid: 'study-1',
      url: 'http://localhost/bad-sop.dcm',
      extension: 'dcm',
      patientDir: 'ANON_P1',
      studyDir: 'ANON_S1',
      seriesDir: 'ANON_SE1',
    };

    const manifestItems = [goodItem, badItem];

    const abortController = new AbortController();
    const summary = await downloadManifest(
      manifestItems,
      mockWriter,
      null,
      abortController.signal,
      null
    );

    expect(summary.status).toBe('partial_success');
    expect(summary.done).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failedItems.length).toBe(1);
    expect(summary.failedItems[0].item.sopUid).toBe('bad-sop');
    expect(mockWriter.finalize).toHaveBeenCalled();
    expect(mockWriter.writeArtifact).toHaveBeenCalledWith(
      'export-manifest.json',
      expect.any(Blob)
    );
  });

  it('never counts a bypassed video item as anonymized (DM-016)', async () => {
    const artifacts = {};
    const mockWriter = {
      name: 'mock-writer',
      write: jest.fn().mockResolvedValue(undefined),
      writeArtifact: jest.fn().mockImplementation(async (name, blob) => {
        artifacts[name] = blob;
      }),
      finalize: jest.fn().mockResolvedValue(undefined),
    };

    const videoItem = {
      sopUid: 'video-sop-1',
      seriesUid: 'series-1',
      studyUid: 'study-1',
      url: 'http://localhost/video-sop-1.mp4',
      extension: 'mp4',
      patientDir: 'ANON_P1',
      studyDir: 'ANON_S1',
      seriesDir: 'ANON_SE1',
    };

    const abortController = new AbortController();
    const summary = await downloadManifest(
      [videoItem],
      mockWriter,
      null,
      abortController.signal,
      { anonymize: true, patientName: 'ANON' }
    );

    expect(summary.status).toBe('complete');
    expect(summary.notAnonymizedItems).toHaveLength(1);
    expect(summary.notAnonymizedItems[0]).toMatchObject({
      sopInstanceUid: 'video-sop-1',
      contentType: 'mp4',
    });
    expect(summary.anonymizationWarnings).toHaveLength(1);
    expect(summary.anonymizationWarnings[0]).toContain('NOT ANONYMIZED');

    const manifestJson = JSON.parse(await readBlobText(artifacts['export-manifest.json']));
    expect(manifestJson.anonymizationRequested).toBe(true);
    expect(manifestJson.notAnonymized).toHaveLength(1);
    expect(manifestJson.notAnonymized[0].sopInstanceUid).toBe('video-sop-1');
  });

  it('throws IncompleteExportError when 0 items succeed out of total', async () => {
    const mockWriter = {
      name: 'mock-writer',
      write: jest.fn().mockRejectedValue(new Error('Write failed')),
      writeArtifact: jest.fn(),
      finalize: jest.fn(),
      abort: jest.fn().mockResolvedValue(undefined),
    };

    const manifestItems = [
      {
        sopUid: 'bad-sop',
        seriesUid: 'series-1',
        studyUid: 'study-1',
        url: 'http://localhost/bad-sop.dcm',
        patientDir: 'ANON_P1',
        studyDir: 'ANON_S1',
        seriesDir: 'ANON_SE1',
      },
    ];

    const abortController = new AbortController();

    await expect(
      downloadManifest(manifestItems, mockWriter, null, abortController.signal, null)
    ).rejects.toThrow('All 1 requested instance(s) failed to download; no files were saved.');

    expect(mockWriter.abort).toHaveBeenCalled();
  });

  it('allows buildManifest to accept retry failed items directly', () => {
    const failedItems = [
      {
        sopUid: 'failed-sop-1',
        seriesUid: 'series-1',
        studyUid: 'study-1',
        patientDir: 'Patient_1',
        studyDir: 'Study_1',
        seriesDir: 'Series_1',
      },
    ];

    const result = buildManifest(failedItems);
    expect(result).toBe(failedItems);
  });
});
