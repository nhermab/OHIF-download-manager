/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import {
  scanImageDataForText,
  matchGlyphToCharacter,
  isAnatomicalEdgeNotText,
  runOcrOnFrame
} from '../src/anonymizer/ocrEngine';
import { classifyPhiInOcrResults } from '../src/anonymizer/phiClassifier';

describe('Micro-OCR Character Recognition & RSNA PHI Classifier (TASK-02)', () => {
  it('correctly matches 7x7 glyph patches against character templates', () => {
    const aGlyph = new Uint8Array([
      0,0,1,1,1,0,0,
      0,1,0,0,0,1,0,
      0,1,0,0,0,1,0,
      0,1,1,1,1,1,0,
      0,1,0,0,0,1,0,
      0,1,0,0,0,1,0,
      0,1,0,0,0,1,0
    ]);

    const result = matchGlyphToCharacter(aGlyph, 7, 7);
    expect(result.char).toBe('A');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('filters out high-contrast anatomical edges via Stroke-Width Transform (TASK-06)', () => {
    const anatomicalPatch = new Uint8Array([
      1,1,1,1,1,1,1,1,1,1,
      0,1,1,1,1,1,1,1,1,0,
      0,0,1,1,1,1,1,1,0,0,
      0,0,0,1,1,1,1,0,0,0,
      0,0,0,0,1,1,0,0,0,0,
      0,0,0,0,0,0,0,0,0,0
    ]);

    const isEdge = isAnatomicalEdgeNotText(anatomicalPatch, 10, 6);
    expect(isEdge).toBe(true);
  });

  it('accurately classifies and distinguishes PHI text from clinical measurement text', () => {
    const mockFindings = [
      { frameIndex: 0, bbox: { x: 10, y: 10, w: 60, h: 15 }, text: '5.2 CM' },
      { frameIndex: 0, bbox: { x: 10, y: 30, w: 70, h: 15 }, text: '120 KVP' },
      { frameIndex: 0, bbox: { x: 10, y: 50, w: 50, h: 15 }, text: 'LIVER' },
      { frameIndex: 0, bbox: { x: 10, y: 70, w: 40, h: 15 }, text: 'AP' },
      { frameIndex: 0, bbox: { x: 10, y: 90, w: 100, h: 15 }, text: 'SMITH^JOHN' },
      { frameIndex: 0, bbox: { x: 10, y: 110, w: 90, h: 15 }, text: '1982-04-15' },
      { frameIndex: 0, bbox: { x: 10, y: 130, w: 80, h: 15 }, text: 'MRN 94820' },
    ];

    const dicomMetadata = ['SMITH^JOHN', '94820', '19820415'];

    const classified = classifyPhiInOcrResults(mockFindings, dicomMetadata);

    const measurementItem = classified.find(c => c.text === '5.2 CM');
    expect(measurementItem.decision).toBe('keep');
    expect(measurementItem.phiScore).toBe(0);

    const kvpItem = classified.find(c => c.text === '120 KVP');
    expect(kvpItem.decision).toBe('keep');
    expect(kvpItem.phiScore).toBe(0);

    const liverItem = classified.find(c => c.text === 'LIVER');
    expect(liverItem.decision).toBe('keep');
    expect(liverItem.phiScore).toBe(0);

    const apItem = classified.find(c => c.text === 'AP');
    expect(apItem.decision).toBe('keep');
    expect(apItem.phiScore).toBe(0);

    const nameItem = classified.find(c => c.text === 'SMITH^JOHN');
    expect(nameItem.decision).toBe('redact');
    expect(nameItem.phiScore).toBeGreaterThanOrEqual(80);

    const dateItem = classified.find(c => c.text === '1982-04-15');
    expect(dateItem.decision).toBe('redact');
    expect(dateItem.phiScore).toBeGreaterThanOrEqual(80);

    const mrnItem = classified.find(c => c.text === 'MRN 94820');
    expect(mrnItem.decision).toBe('redact');
    expect(mrnItem.phiScore).toBeGreaterThanOrEqual(80);
  });

  it('handles low-power hardware downscaling performance mode without errors', async () => {
    const width = 2000;
    const height = 2000;
    const rgba = new Uint8ClampedArray(width * height * 4);

    const imageData = { width, height, data: rgba };

    const findings = await runOcrOnFrame(imageData, 0, {
      ocrPerformanceMode: 'fast',
      ocrMaxResolution: 512,
      verboseLogging: false
    });

    expect(Array.isArray(findings)).toBe(true);
  });

  it('supports requireOcrModelConfirmation prompt fallback on slower devices', async () => {
    const imageData = { width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4) };

    const promptSpy = jest.fn().mockResolvedValue(false);

    const findings = await runOcrOnFrame(imageData, 0, {
      requireOcrModelConfirmation: true,
      onOcrFallbackPrompt: promptSpy
    });

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(findings).toEqual([]);
  });
});
