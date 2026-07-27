/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import {
  clearCodecDiagnostics,
  decodeRLEFrame,
  describeLastCodecFailure,
  encapsulateFrameBuffers,
  encodeRLEFrame,
  getCodecDiagnostics,
  recordCodecFailure,
  setCodecVerboseLogging,
} from './dicom-codecs';

describe('encapsulated pixel data fragments (DM-011)', () => {
  it('pads odd-length fragments to an even Item length without altering content', () => {
    const oddFragment = new Uint8Array([1, 2, 3, 4, 5]);
    const evenFragment = new Uint8Array([9, 8, 7, 6]);

    const items = encapsulateFrameBuffers([oddFragment, evenFragment]);

    // Item 0 is the (empty) Basic Offset Table.
    expect(items).toHaveLength(3);
    expect(items[0].byteLength).toBe(0);

    items.forEach(item => expect(item.byteLength % 2).toBe(0));

    expect(items[1].byteLength).toBe(6);
    expect(Array.from(new Uint8Array(items[1]))).toEqual([1, 2, 3, 4, 5, 0]);

    // An already-even fragment must be passed through untouched.
    expect(items[2].byteLength).toBe(4);
    expect(Array.from(new Uint8Array(items[2]))).toEqual([9, 8, 7, 6]);
  });
});

describe('RLE Lossless segment handling (DM-005)', () => {
  function roundTrip(pixels, imageInfo) {
    const encoded = encodeRLEFrame(pixels, imageInfo);
    return decodeRLEFrame(encoded, imageInfo);
  }

  it('round-trips 16-bit monochrome pixels', () => {
    const rows = 4;
    const cols = 4;
    const pixels = new Uint16Array(rows * cols);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = 1000 + i * 37; // spans both the high and low byte
    }

    const decoded = roundTrip(pixels, {
      rows,
      cols,
      bitsAllocated: 16,
      samplesPerPixel: 1,
      pixelRepresentation: 0,
    });

    expect(Array.from(decoded)).toEqual(Array.from(pixels));
  });

  it('round-trips 8-bit colour pixels', () => {
    const rows = 3;
    const cols = 3;
    const samplesPerPixel = 3;
    const pixels = new Uint8Array(rows * cols * samplesPerPixel);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = (i * 11) % 256;
    }

    const decoded = roundTrip(pixels, {
      rows,
      cols,
      bitsAllocated: 8,
      samplesPerPixel,
      pixelRepresentation: 0,
    });

    expect(Array.from(decoded)).toEqual(Array.from(pixels));
  });

  it('round-trips 16-bit colour pixels across all six segments', () => {
    // PS3.5 G.2 orders segments by sample, most significant byte first, so
    // 16-bit RGB uses six segments. Indexing that ignores the sample would
    // silently corrupt every channel.
    const rows = 4;
    const cols = 4;
    const samplesPerPixel = 3;
    const pixels = new Uint16Array(rows * cols * samplesPerPixel);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = (i * 2731) % 65536;
    }

    const imageInfo = {
      rows,
      cols,
      bitsAllocated: 16,
      samplesPerPixel,
      pixelRepresentation: 0,
    };

    const encoded = encodeRLEFrame(pixels, imageInfo);
    expect(new DataView(encoded.buffer, encoded.byteOffset).getInt32(0, true)).toBe(6);

    expect(Array.from(decodeRLEFrame(encoded, imageInfo))).toEqual(Array.from(pixels));
  });

  it('rejects pixel organizations needing more than the 15 available segments', () => {
    const imageInfo = {
      rows: 2,
      cols: 2,
      bitsAllocated: 64,
      samplesPerPixel: 3,
      pixelRepresentation: 0,
    };

    expect(() => encodeRLEFrame(new Uint8Array(2 * 2 * 3 * 8), imageInfo)).toThrow(
      /RLE requires 1-15 segments/
    );
  });

  it('bounds the final segment by the fragment end rather than trailing pixel bytes', () => {
    // A stream that declares the maximum 15 segments: the "next segment offset"
    // for the last one lies outside the 64-byte header, so reading it would
    // interpret compressed pixel bytes as a length.
    const header = new DataView(new ArrayBuffer(64));
    header.setInt32(0, 15, true);
    for (let s = 0; s < 15; s++) {
      header.setInt32((s + 1) * 4, s === 0 ? 64 : 0, true);
    }

    // Segment 0: a literal run of four bytes, then a replicate run of four.
    const body = new Uint8Array([3, 10, 20, 30, 40, 0xfd, 50]);
    const stream = new Uint8Array(64 + body.length);
    stream.set(new Uint8Array(header.buffer), 0);
    stream.set(body, 64);

    const decoded = decodeRLEFrame(stream, {
      rows: 1,
      cols: 8,
      bitsAllocated: 8,
      samplesPerPixel: 1,
      pixelRepresentation: 0,
    });

    expect(Array.from(decoded)).toEqual([10, 20, 30, 40, 50, 50, 50, 50]);
  });
});

describe('codec failure diagnostics (DM-027)', () => {
  beforeEach(() => {
    clearCodecDiagnostics();
    setCodecVerboseLogging(false);
  });

  afterEach(() => {
    clearCodecDiagnostics();
    setCodecVerboseLogging(false);
  });

  it('records the cause of a codec failure instead of discarding it', () => {
    expect(describeLastCodecFailure()).toBeNull();

    recordCodecFailure('decode', '1.2.840.10008.1.2.4.90', new Error('truncated codestream'));

    const diagnostics = getCodecDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      stage: 'decode',
      context: '1.2.840.10008.1.2.4.90',
      message: 'truncated codestream',
    });
    expect(describeLastCodecFailure()).toContain('truncated codestream');
  });

  it('keeps console output opt-in so diagnostics do not leak by default', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    recordCodecFailure('load', '@cornerstonejs/codec-openjpeg', new Error('not installed'));
    expect(warn).not.toHaveBeenCalled();

    setCodecVerboseLogging(true);
    recordCodecFailure('load', '@cornerstonejs/codec-openjpeg', new Error('not installed'));
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('bounds the diagnostics buffer so a long export cannot grow it without limit', () => {
    for (let i = 0; i < 120; i++) {
      recordCodecFailure('decode', '1.2.840.10008.1.2.5', new Error(`failure ${i}`));
    }

    const diagnostics = getCodecDiagnostics();
    expect(diagnostics.length).toBeLessThanOrEqual(50);
    expect(diagnostics[diagnostics.length - 1].message).toBe('failure 119');
  });
});
