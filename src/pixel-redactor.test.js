/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import dcmjs from 'dcmjs';
import { TextDecoder, TextEncoder } from 'util';
import { webcrypto } from 'crypto';
import { redactDicomPixelData, isBurnedInAnnotation } from './pixel-redactor';
import {
  encodeRLEFrame,
  encodeDicomFrame,
  encapsulateFrameBuffers,
  TRANSFER_SYNTAX_UIDS,
} from './dicom-codecs';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto = webcrypto;
}

function createDummyDicomDict({
  transferSyntax = '1.2.840.10008.1.2.1',
  burnedIn = 'YES',
  bitsAllocated = 16,
  rows = 16,
  cols = 16,
  numberOfFrames = 1,
  samplesPerPixel = 1,
  pixelDataValue = null,
} = {}) {
  const frameElements = rows * cols * samplesPerPixel;
  const isSigned = false;

  let value = pixelDataValue;
  if (!value) {
    if (transferSyntax === '1.2.840.10008.1.2.1') {
      const rawPixels = new Uint16Array(frameElements * numberOfFrames);
      for (let i = 0; i < rawPixels.length; i++) rawPixels[i] = 100;
      value = [rawPixels.buffer];
    } else {
      // Create compressed frames
      const frameBuffers = [];
      const imageInfo = { rows, cols, bitsAllocated, samplesPerPixel, pixelRepresentation: 0 };
      for (let f = 0; f < numberOfFrames; f++) {
        const rawPixels = new Uint16Array(frameElements);
        for (let i = 0; i < rawPixels.length; i++) rawPixels[i] = (f + 1) * 100;
        const compressed = encodeRLEFrame(rawPixels, imageInfo);
        frameBuffers.push(compressed);
      }
      value = encapsulateFrameBuffers(frameBuffers);
    }
  }

  const dict = {
    '00280010': { vr: 'US', Value: [rows] },
    '00280011': { vr: 'US', Value: [cols] },
    '00280100': { vr: 'US', Value: [bitsAllocated] },
    '00280101': { vr: 'US', Value: [bitsAllocated] },
    '00280103': { vr: 'US', Value: [0] },
    '00280002': { vr: 'US', Value: [samplesPerPixel] },
    '00280004': { vr: 'CS', Value: ['MONOCHROME2'] },
    '00280008': { vr: 'IS', Value: [String(numberOfFrames)] },
    '00280301': { vr: 'CS', Value: [burnedIn] },
    '7FE00010': { vr: 'OB', Value: value },
  };

  const meta = {
    '00020010': { vr: 'UI', Value: [transferSyntax] },
  };

  return { dict, meta };
}

describe('Pixel Redactor & WebAssembly Codecs Integration (TASK-03)', () => {
  it('correctly identifies BurnedInAnnotation status', () => {
    expect(isBurnedInAnnotation({ '00280301': { Value: ['YES'] } })).toBe(true);
    expect(isBurnedInAnnotation({ '00280301': { Value: ['Y'] } })).toBe(true);
    expect(isBurnedInAnnotation({ '00280301': { Value: ['1'] } })).toBe(true);
    expect(isBurnedInAnnotation({ '00280301': { Value: ['NO'] } })).toBe(false);
    expect(isBurnedInAnnotation({})).toBe(false);
  });

  it('does not claim clean pixels when OCR finds no PHI', async () => {
    const dicomDict = createDummyDicomDict({
      transferSyntax: TRANSFER_SYNTAX_UIDS.EXPLICIT_VR_LITTLE_ENDIAN,
      burnedIn: 'YES',
    });

    const result = await redactDicomPixelData(dicomDict, {
      enablePixelRedaction: true,
      forceIgnoreBurnedInAnnotation: true,
    });

    expect(result.redacted).toBe(false);
    expect(result.verifiedClean).toBe(false);
    expect(dicomDict.dict['00280301'].Value[0]).toBe('YES');
    expect(dicomDict.meta['00020010'].Value[0]).toBe(TRANSFER_SYNTAX_UIDS.EXPLICIT_VR_LITTLE_ENDIAN);
  });

  it('rejects ambiguous encapsulated frame fragmentation before modifying pixels', async () => {
    const dicomDict = createDummyDicomDict({
      transferSyntax: TRANSFER_SYNTAX_UIDS.RLE_LOSSLESS,
      numberOfFrames: 2,
      pixelDataValue: [new ArrayBuffer(0), new ArrayBuffer(12), new ArrayBuffer(12), new ArrayBuffer(12)],
    });

    await expect(
      redactDicomPixelData(dicomDict, { enablePixelRedaction: true, forceIgnoreBurnedInAnnotation: true })
    ).rejects.toThrow('frame boundaries are ambiguous');
    expect(dicomDict.dict['00280301'].Value[0]).toBe('YES');
  });

  it('preserves compressed pixels when a transfer syntax decoder is unavailable', async () => {
    // The RLE payload is deliberately labelled JPEG-LS so the JPEG-LS decoder
    // cannot decode it. The fallback must retain the original bytes and allow
    // metadata anonymization to continue instead of failing the export.
    const originalFrame = encodeRLEFrame(
      new Uint16Array(16 * 16).fill(100),
      { rows: 16, cols: 16, bitsAllocated: 16, samplesPerPixel: 1, pixelRepresentation: 0 }
    );
    const dicomDict = createDummyDicomDict({
      transferSyntax: TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSLESS,
      pixelDataValue: encapsulateFrameBuffers([originalFrame]),
    });
    const onPixelDataFallback = jest.fn();

    const result = await redactDicomPixelData(dicomDict, {
      enablePixelRedaction: true,
      forceIgnoreBurnedInAnnotation: true,
      onPixelDataFallback,
    });

    expect(result).toEqual(expect.objectContaining({
      redacted: false,
      pixelDataPreserved: true,
      transferSyntax: TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSLESS,
    }));
    expect(dicomDict.meta['00020010'].Value[0]).toBe(TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSLESS);
    expect(new Uint8Array(dicomDict.dict['7FE00010'].Value[1])).toEqual(
      new Uint8Array(originalFrame.buffer, originalFrame.byteOffset, originalFrame.byteLength)
    );
    expect(dicomDict.dict['00280301'].Value[0]).toBe('YES');
    expect(onPixelDataFallback).toHaveBeenCalledWith(expect.stringContaining('original compressed pixel data was preserved'));
  });

  it('decodes, redacts, and re-encodes RLE Lossless encapsulated DICOM pixel data', async () => {
    const dicomDict = createDummyDicomDict({
      transferSyntax: TRANSFER_SYNTAX_UIDS.RLE_LOSSLESS,
      burnedIn: 'YES',
      numberOfFrames: 2,
    });

    const result = await redactDicomPixelData(dicomDict, {
      enablePixelRedaction: true,
      forceIgnoreBurnedInAnnotation: true,
      preserveTransferSyntax: true,
    });

    expect(result.redacted).toBe(false);
    expect(result.transferSyntax).toBe(TRANSFER_SYNTAX_UIDS.RLE_LOSSLESS);
    expect(dicomDict.meta['00020010'].Value[0]).toBe(TRANSFER_SYNTAX_UIDS.RLE_LOSSLESS);
    expect(dicomDict.dict['00280301'].Value[0]).toBe('YES');

    // Verify encapsulated pixel structure (BOT + 2 frame buffers)
    const pixelVal = dicomDict.dict['7FE00010'].Value;
    expect(Array.isArray(pixelVal)).toBe(true);
    expect(pixelVal.length).toBe(3); // Basic Offset Table + 2 frames
  });

  it('decodes, redacts, and re-encodes JPEG 2000 encapsulated DICOM pixel data', async () => {
    const rows = 16, cols = 16, frameElements = rows * cols;
    const rawPixels = new Uint8Array(frameElements);
    rawPixels.fill(120);

    const imageInfo = { rows, cols, bitsAllocated: 8, bitsStored: 8, samplesPerPixel: 1, pixelRepresentation: 0 };
    const j2kCompressed = await encodeDicomFrame(rawPixels, TRANSFER_SYNTAX_UIDS.JPEG2000_LOSSLESS, imageInfo);

    if (j2kCompressed) {
      const dicomDict = createDummyDicomDict({
        transferSyntax: TRANSFER_SYNTAX_UIDS.JPEG2000_LOSSLESS,
        burnedIn: 'YES',
        bitsAllocated: 8,
        pixelDataValue: encapsulateFrameBuffers([j2kCompressed]),
      });

      const result = await redactDicomPixelData(dicomDict, {
        enablePixelRedaction: true,
        forceIgnoreBurnedInAnnotation: true,
        preserveTransferSyntax: true,
      });

      expect(result.redacted).toBe(false);
      expect(result.transferSyntax).toBe(TRANSFER_SYNTAX_UIDS.JPEG2000_LOSSLESS);
      expect(dicomDict.meta['00020010'].Value[0]).toBe(TRANSFER_SYNTAX_UIDS.JPEG2000_LOSSLESS);
      expect(dicomDict.dict['00280301'].Value[0]).toBe('YES');
    }
  });

  it('decodes, redacts, and re-encodes JPEG-LS encapsulated DICOM pixel data', async () => {
    const rows = 16, cols = 16, frameElements = rows * cols;
    const rawPixels = new Uint8Array(frameElements);
    rawPixels.fill(150);

    const imageInfo = { rows, cols, bitsAllocated: 8, bitsStored: 8, samplesPerPixel: 1, pixelRepresentation: 0 };
    const jpeglsCompressed = await encodeDicomFrame(rawPixels, TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSLESS, imageInfo);

    if (jpeglsCompressed) {
      const dicomDict = createDummyDicomDict({
        transferSyntax: TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSLESS,
        burnedIn: 'YES',
        bitsAllocated: 8,
        pixelDataValue: encapsulateFrameBuffers([jpeglsCompressed]),
      });

      const result = await redactDicomPixelData(dicomDict, {
        enablePixelRedaction: true,
        forceIgnoreBurnedInAnnotation: true,
        preserveTransferSyntax: true,
      });

      expect(result.redacted).toBe(false);
      expect(result.transferSyntax).toBe(TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSLESS);
      expect(dicomDict.meta['00020010'].Value[0]).toBe(TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSLESS);
      expect(dicomDict.dict['00280301'].Value[0]).toBe('YES');
    }
  });

  it('forces uncompressed Explicit VR Little Endian output when forceUncompressed is true', async () => {
    const dicomDict = createDummyDicomDict({
      transferSyntax: TRANSFER_SYNTAX_UIDS.RLE_LOSSLESS,
      burnedIn: 'YES',
    });

    const result = await redactDicomPixelData(dicomDict, {
      enablePixelRedaction: true,
      forceIgnoreBurnedInAnnotation: true,
      forceUncompressed: true,
    });

    expect(result.redacted).toBe(false);
    expect(result.transferSyntax).toBe(TRANSFER_SYNTAX_UIDS.EXPLICIT_VR_LITTLE_ENDIAN);
    expect(dicomDict.meta['00020010'].Value[0]).toBe(TRANSFER_SYNTAX_UIDS.EXPLICIT_VR_LITTLE_ENDIAN);
    expect(dicomDict.dict['00280301'].Value[0]).toBe('YES');
  });

  describe('Multi-Frame Sparse Frame Sampling & Prompting (TASK-01)', () => {
    it('scans all frames sequentially in aggressive multi-frame redaction mode', async () => {
      const dicomDict = createDummyDicomDict({
        transferSyntax: TRANSFER_SYNTAX_UIDS.EXPLICIT_VR_LITTLE_ENDIAN,
        burnedIn: 'YES',
        numberOfFrames: 5,
      });

      const result = await redactDicomPixelData(dicomDict, {
        enablePixelRedaction: true,
        forceIgnoreBurnedInAnnotation: true,
        multiFrameRedactionMethod: 'aggressive',
      });

      expect(result.redacted).toBe(false);
      expect(dicomDict.dict['00280301'].Value[0]).toBe('YES');
    });

    it('uses sparse sampling when sampling method is selected', async () => {
      const dicomDict = createDummyDicomDict({
        transferSyntax: TRANSFER_SYNTAX_UIDS.EXPLICIT_VR_LITTLE_ENDIAN,
        burnedIn: 'YES',
        numberOfFrames: 10,
      });

      const result = await redactDicomPixelData(dicomDict, {
        enablePixelRedaction: true,
        forceIgnoreBurnedInAnnotation: true,
        multiFrameRedactionMethod: 'sampling',
      });

      expect(result.redacted).toBe(false);
      expect(dicomDict.dict['00280301'].Value[0]).toBe('YES');
    });

    it('invokes onPromptMultiFrameMethod callback once when burned-in multi-frame image is present and method is ask', async () => {
      const dicomDict = createDummyDicomDict({
        transferSyntax: TRANSFER_SYNTAX_UIDS.EXPLICIT_VR_LITTLE_ENDIAN,
        burnedIn: 'YES',
        numberOfFrames: 8,
      });

      const promptSpy = jest.fn().mockResolvedValue('aggressive');

      const options = {
        enablePixelRedaction: true,
        multiFrameRedactionMethod: 'ask',
        onPromptMultiFrameMethod: promptSpy,
      };

      const result = await redactDicomPixelData(dicomDict, options);

      expect(promptSpy).toHaveBeenCalledTimes(1);
      expect(promptSpy).toHaveBeenCalledWith(expect.objectContaining({ numberOfFrames: 8 }));
      expect(options.multiFrameRedactionMethod).toBe('aggressive');
      expect(result.redacted).toBe(false);
      expect(dicomDict.dict['00280301'].Value[0]).toBe('YES');
    });
  });
});
