/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import dcmjs from 'dcmjs';
import { TextDecoder, TextEncoder } from 'util';
import {
  createDicomDiagnostic,
  createDicomDump,
  fetchRawDicomForDiagnostics,
} from './dicomDiagnostics';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

function createDicomBlob() {
  const meta = {
    '00020002': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.7'] },
    '00020003': { vr: 'UI', Value: ['2.25.123'] },
    '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.4.90'] },
  };
  const dicom = new dcmjs.data.DicomDict(meta);
  dicom.dict = {
    '00080018': { vr: 'UI', Value: ['2.25.123'] },
    '00100010': { vr: 'PN', Value: [{ Alphabetic: 'DOE^JANE' }] },
    '00081115': {
      vr: 'SQ',
      Value: [
        {
          '0020000E': { vr: 'UI', Value: ['2.25.456'] },
        },
      ],
    },
    '7FE00010': { vr: 'OB', Value: [new Uint8Array([1, 2, 3, 4]).buffer] },
  };
  return new Blob([dicom.write()], { type: 'application/dicom' });
}

describe('developer DICOM diagnostics', () => {
  const originalConfig = window.config;
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.config = {
      ...(originalConfig || {}),
      aquestDownloadManager: {
        devMode: true,
      },
    };
  });

  afterEach(() => {
    window.config = originalConfig;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('creates a dcmdump-style view with prominent transfer syntax and no pixel data', async () => {
    const result = await createDicomDump(createDicomBlob());

    expect(result.transferSyntaxUid).toBe('1.2.840.10008.1.2.4.90');
    expect(result.transferSyntaxName).toBe('JPEG 2000 Lossless');
    expect(result.text).toContain('# Transfer Syntax: JPEG 2000 Lossless [1.2.840.10008.1.2.4.90]');
    expect(result.text).toContain('(0008,0018) UI [2.25.123] # SOPInstanceUID');
    expect(result.text).toContain('(0008,1115) SQ (Sequence with 1 item)');
    expect(result.text).toContain('(0020,000e) UI [2.25.456] # SeriesInstanceUID');
    expect(result.text).not.toMatch(/\n\(7fe0,0010\)/);
    expect(result.text).not.toContain('1\\2\\3\\4');
  });

  it('only creates diagnostic handles when developer mode is explicitly enabled', () => {
    const item = { sopUid: '2.25.123', extension: 'dcm', url: '/dicom/2.25.123' };
    expect(createDicomDiagnostic(item, createDicomBlob())).toMatchObject({
      item: { sopUid: '2.25.123' },
    });

    window.config.aquestDownloadManager.devMode = false;
    expect(createDicomDiagnostic(item, createDicomBlob())).toBeNull();
  });

  it('refetches a raw response without parsing or transforming it', async () => {
    const rawBlob = new Blob(['not parsed here'], { type: 'application/octet-stream' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      type: 'basic',
      blob: jest.fn().mockResolvedValue(rawBlob),
    });

    const result = await fetchRawDicomForDiagnostics(
      { url: 'https://example.test/instance', sopUid: '2.25.123' },
      new AbortController().signal
    );

    expect(result).toBe(rawBlob);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.test/instance',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        redirect: 'manual',
      })
    );
  });

  it('does not reconstruct a synthetic DICOM when only frames were supplied', async () => {
    await expect(
      fetchRawDicomForDiagnostics(
        { reconstructFromFrames: true, url: 'https://example.test/frames/1' },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: 'RawDicomUnavailableError' });
  });
});
