/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Client-Side Optical Character Recognition (OCR) Engine & Feature Extractor.
 */

let paddleOcrPromise = null;

export async function getPaddleOcr() {
  if (paddleOcrPromise) return paddleOcrPromise;

  paddleOcrPromise = (async () => {
    if (typeof window !== "undefined" && window.PaddleOCR) {
      try {
        return await window.PaddleOCR.create({
          textDetectionModelName: "PP-OCRv6_tiny_det",
          textRecognitionModelName: "PP-OCRv6_tiny_rec",
          worker: true,
          textDetectionBatchSize: 1,
          textRecognitionBatchSize: 4,
          ortOptions: {
            backend: "wasm",
            wasmPaths: "/assets/onnxruntime/",
            numThreads: 1,
            simd: true
          }
        });
      } catch (err) {
      }
    }
    return null;
  })();

  return paddleOcrPromise;
}

const GLYPH_TEMPLATES = {
  'A': ["  ***  ", " *   * ", " *   * ", " ***** ", " *   * ", " *   * ", " *   * "],
  'B': [" ****  ", " *   * ", " *   * ", " ****  ", " *   * ", " *   * ", " ****  "],
  'C': ["  **** ", " *    *", " *     ", " *     ", " *     ", " *    *", "  **** "],
  'D': [" ****  ", " *   * ", " *   * ", " *   * ", " *   * ", " *   * ", " ****  "],
  'E': [" ***** ", " *     ", " *     ", " ****  ", " *     ", " *     ", " ***** "],
  'F': [" ***** ", " *     ", " *     ", " ****  ", " *     ", " *     ", " *     "],
  'G': ["  **** ", " *    *", " *     ", " *  ** ", " *   * ", " *   * ", "  **** "],
  'H': [" *   * ", " *   * ", " *   * ", " ***** ", " *   * ", " *   * ", " *   * "],
  'I': [" ***** ", "   *   ", "   *   ", "   *   ", "   *   ", "   *   ", " ***** "],
  'J': ["  **** ", "    *  ", "    *  ", "    *  ", " *  *  ", " *  *  ", "  **   "],
  'K': [" *   * ", " *  *  ", " * *   ", " **    ", " * *   ", " *  *  ", " *   * "],
  'L': [" *     ", " *     ", " *     ", " *     ", " *     ", " *     ", " ***** "],
  'M': [" *   * ", " ** ** ", " * * * ", " *   * ", " *   * ", " *   * ", " *   * "],
  'N': [" *   * ", " **  * ", " * * * ", " * * * ", " *  ** ", " *   * ", " *   * "],
  'O': ["  ***  ", " *   * ", " *   * ", " *   * ", " *   * ", " *   * ", "  ***  "],
  'P': [" ****  ", " *   * ", " *   * ", " ****  ", " *     ", " *     ", " *     "],
  'Q': ["  ***  ", " *   * ", " *   * ", " *   * ", " * * * ", " *  ** ", "  **** "],
  'R': [" ****  ", " *   * ", " *   * ", " ****  ", " * *   ", " *  *  ", " *   * "],
  'S': ["  **** ", " *     ", " *     ", "  ***  ", "     * ", "     * ", " ****  "],
  'T': [" ***** ", "   *   ", "   *   ", "   *   ", "   *   ", "   *   ", "   *   "],
  'U': [" *   * ", " *   * ", " *   * ", " *   * ", " *   * ", " *   * ", "  ***  "],
  'V': [" *   * ", " *   * ", " *   * ", " *   * ", " *   * ", "  * *  ", "   *   "],
  'W': [" *   * ", " *   * ", " *   * ", " * * * ", " * * * ", " ** ** ", " *   * "],
  'X': [" *   * ", " *   * ", "  * *  ", "   *   ", "  * *  ", " *   * ", " *   * "],
  'Y': [" *   * ", " *   * ", "  * *  ", "   *   ", "   *   ", "   *   ", "   *   "],
  'Z': [" ***** ", "     * ", "    *  ", "   *   ", "  *    ", " *     ", " ***** "],
  '0': ["  ***  ", " *   * ", " *  ** ", " * * * ", " **  * ", " *   * ", "  ***  "],
  '1': ["   *   ", "  **   ", "   *   ", "   *   ", "   *   ", "   *   ", " ***** "],
  '2': ["  ***  ", " *   * ", "     * ", "   **  ", "  *    ", " *     ", " ***** "],
  '3': [" ****  ", "     * ", "    *  ", "   **  ", "     * ", "     * ", " ****  "],
  '4': ["   **  ", "  * *  ", " *  *  ", " ***** ", "    *  ", "    *  ", "    *  "],
  '5': [" ***** ", " *     ", " ****  ", "     * ", "     * ", " *   * ", "  ***  "],
  '6': ["  **** ", " *     ", " ****  ", " *   * ", " *   * ", " *   * ", "  ***  "],
  '7': [" ***** ", "     * ", "    *  ", "   *   ", "  *    ", "  *    ", "  *    "],
  '8': ["  ***  ", " *   * ", " *   * ", "  ***  ", " *   * ", " *   * ", "  ***  "],
  '9': ["  ***  ", " *   * ", " *   * ", "  **** ", "     * ", "     * ", "  ***  "],
  '.': ["       ", "       ", "       ", "       ", "       ", "  **   ", "  **   "],
  ',': ["       ", "       ", "       ", "       ", "       ", "  **   ", " *     "],
  '-': ["       ", "       ", "       ", " ***** ", "       ", "       ", "       "],
  '/': ["     * ", "    *  ", "   *   ", "  *    ", " *     ", " *     ", "       "],
  ':': ["       ", "  **   ", "  **   ", "       ", "  **   ", "  **   ", "       "],
  '°': ["  **   ", " *  *  ", "  **   ", "       ", "       ", "       ", "       "],
  '%': [" **  * ", " ** *  ", "   *   ", "  *    ", " *  ** ", " *  ** ", "       "],
  '+': ["       ", "   *   ", "   *   ", " ***** ", "   *   ", "   *   ", "       "],
  '=': ["       ", " ***** ", "       ", " ***** ", "       ", "       ", "       "],
  '^': ["   *   ", "  * *  ", " *   * ", "       ", "       ", "       ", "       "]
};

const COMPILED_GLYPH_TEMPLATES = (() => {
  const map = {};
  for (const [char, rows] of Object.entries(GLYPH_TEMPLATES)) {
    const grid = new Uint8Array(49);
    for (let r = 0; r < 7; r++) {
      const rowStr = rows[r] || "       ";
      for (let c = 0; c < 7; c++) {
        grid[r * 7 + c] = rowStr[c] === "*" || rowStr[c] === "#" ? 1 : 0;
      }
    }
    map[char] = grid;
  }
  return map;
})();

export function matchGlyphToCharacter(glyphData, glyphW, glyphH) {
  if (glyphW <= 0 || glyphH <= 0 || !glyphData || glyphData.length === 0) {
    return { char: "", confidence: 0 };
  }

  const sampled = new Uint8Array(49);
  for (let r = 0; r < 7; r++) {
    const srcY = Math.floor((r / 7) * glyphH);
    for (let c = 0; c < 7; c++) {
      const srcX = Math.floor((c / 7) * glyphW);
      sampled[r * 7 + c] = glyphData[srcY * glyphW + srcX] ? 1 : 0;
    }
  }

  let bestChar = "?";
  let bestScore = -1;

  for (const [char, template] of Object.entries(COMPILED_GLYPH_TEMPLATES)) {
    let matchCount = 0;
    let totalCount = 0;

    for (let i = 0; i < 49; i++) {
      if (template[i] === 1 || sampled[i] === 1) {
        totalCount++;
        if (template[i] === sampled[i]) matchCount++;
      }
    }

    const score = totalCount > 0 ? matchCount / totalCount : 0;
    if (score > bestScore) {
      bestScore = score;
      bestChar = char;
    }
  }

  const confidence = Math.max(0, Math.min(1, bestScore));
  return { char: confidence >= 0.55 ? bestChar : "", confidence };
}

export function isAnatomicalEdgeNotText(binaryPatch, patchW, patchH) {
  if (patchW < 8 || patchH < 6) return false;

  const strokeWidths = [];
  for (let y = 0; y < patchH; y++) {
    let inStroke = false;
    let strokeLen = 0;
    for (let x = 0; x < patchW; x++) {
      const val = binaryPatch[y * patchW + x];
      if (val === 1) {
        strokeLen++;
        inStroke = true;
      } else {
        if (inStroke) {
          if (strokeLen > 0) strokeWidths.push(strokeLen);
          strokeLen = 0;
          inStroke = false;
        }
      }
    }
    if (inStroke && strokeLen > 0) strokeWidths.push(strokeLen);
  }

  if (strokeWidths.length === 0) return true;

  const mean = strokeWidths.reduce((a, b) => a + b, 0) / strokeWidths.length;
  const variance = strokeWidths.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / strokeWidths.length;

  if (mean > patchH * 0.45 || (mean > 12 && variance > 25)) {
    return true;
  }

  return false;
}

export function scanImageDataForText(imageData, frameIndex = 0, options = {}) {
  const { width, height, data } = imageData;
  const boxes = [];
  const verbose = options.verboseLogging === true;

  const maxRes = options.ocrMaxResolution || 1024;
  let workWidth = width;
  let workHeight = height;
  let scaleX = 1;
  let scaleY = 1;
  let workData = data;

  if (options.ocrPerformanceMode === "fast" || width > maxRes || height > maxRes) {
    const scale = Math.min(maxRes / width, maxRes / height);
    if (scale < 1.0) {
      workWidth = Math.max(16, Math.floor(width * scale));
      workHeight = Math.max(16, Math.floor(height * scale));
      scaleX = width / workWidth;
      scaleY = height / workHeight;

      const downsampled = new Uint8ClampedArray(workWidth * workHeight * 4);
      for (let y = 0; y < workHeight; y++) {
        const srcY = Math.floor(y * scaleY);
        for (let x = 0; x < workWidth; x++) {
          const srcX = Math.floor(x * scaleX);
          const srcIdx = (srcY * width + srcX) * 4;
          const dstIdx = (y * workWidth + x) * 4;
          downsampled[dstIdx] = data[srcIdx];
          downsampled[dstIdx + 1] = data[srcIdx + 1];
          downsampled[dstIdx + 2] = data[srcIdx + 2];
          downsampled[dstIdx + 3] = data[srcIdx + 3];
        }
      }
      workData = downsampled;
      if (verbose && typeof console !== "undefined") {
        console.log(`[OCR Engine] Downscaled frame ${frameIndex} from ${width}x${height} to ${workWidth}x${workHeight} for performance mode.`);
      }
    }
  }

  const gray = new Uint8Array(workWidth * workHeight);
  let totalLuminance = 0;
  for (let i = 0; i < workWidth * workHeight; i++) {
    const r = workData[i * 4];
    const g = workData[i * 4 + 1];
    const b = workData[i * 4 + 2];
    const lum = (r * 299 + g * 587 + b * 114) / 1000;
    gray[i] = lum;
    totalLuminance += lum;
  }

  const avgGray = totalLuminance / (workWidth * workHeight);

  const binary = new Uint8Array(workWidth * workHeight);
  const threshDelta = options.contrastThreshold !== undefined ? options.contrastThreshold : 22;

  for (let i = 0; i < gray.length; i++) {
    const val = gray[i];
    if (avgGray < 128) {
      binary[i] = val > avgGray + threshDelta || val > 180 ? 1 : 0;
    } else {
      binary[i] = val < avgGray - threshDelta || val < 80 ? 1 : 0;
    }
  }

  const gridW = 8;
  const gridH = 8;
  const cols = Math.floor(workWidth / gridW);
  const rows = Math.floor(workHeight / gridH);
  const activeGrid = new Uint8Array(cols * rows);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let count = 0;
      const startX = gx * gridW;
      const startY = gy * gridH;
      for (let y = startY; y < startY + gridH && y < workHeight; y++) {
        for (let x = startX; x < startX + gridW && x < workWidth; x++) {
          if (binary[y * workWidth + x] === 1) count++;
        }
      }
      if (count >= 2) {
        activeGrid[gy * cols + gx] = 1;
      }
    }
  }

  const visited = new Uint8Array(cols * rows);
  const rawBoxes = [];

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (activeGrid[gy * cols + gx] === 1 && visited[gy * cols + gx] === 0) {
        let minGx = gx, maxGx = gx;
        let minGy = gy, maxGy = gy;

        const queue = [[gx, gy]];
        visited[gy * cols + gx] = 1;

        while (queue.length > 0) {
          const [cx, cy] = queue.pop();
          minGx = Math.min(minGx, cx);
          maxGx = Math.max(maxGx, cx);
          minGy = Math.min(minGy, cy);
          maxGy = Math.max(maxGy, cy);

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
                const idx = ny * cols + nx;
                if (activeGrid[idx] === 1 && visited[idx] === 0) {
                  visited[idx] = 1;
                  queue.push([nx, ny]);
                }
              }
            }
          }
        }

        const boxX = minGx * gridW;
        const boxY = minGy * gridH;
        const boxW = Math.min(workWidth - boxX, (maxGx - minGx + 1) * gridW);
        const boxH = Math.min(workHeight - boxY, (maxGy - minGy + 1) * gridH);

        rawBoxes.push({ x: boxX, y: boxY, w: boxW, h: boxH });
      }
    }
  }

  const maxBoxH = Math.min(60, Math.round(workHeight * 0.10));
  const maxBoxW = Math.min(600, Math.round(workWidth * 0.65));
  const maxBoxArea = Math.round(workWidth * workHeight * 0.05);

  for (const b of rawBoxes) {
    if (b.w < 16 || b.h < 8 || (b.w * b.h) < 140) continue;

    if (b.h > maxBoxH || b.w > maxBoxW || (b.w * b.h) > maxBoxArea) {
      continue;
    }

    const patch = new Uint8Array(b.w * b.h);
    for (let py = 0; py < b.h; py++) {
      for (let px = 0; px < b.w; px++) {
        patch[py * b.w + px] = binary[(b.y + py) * workWidth + (b.x + px)];
      }
    }

    if (isAnatomicalEdgeNotText(patch, b.w, b.h)) {
      if (verbose && typeof console !== "undefined") {
        console.log(`[OCR Engine] Discarded anatomical contour edge box at (x:${b.x}, y:${b.y}, w:${b.w}, h:${b.h})`);
      }
      continue;
    }

    const textResult = recognizeBoxTextWithMicroOcr(patch, b.w, b.h, b.x, b.y, workWidth, workHeight, options);

    if (textResult.text && textResult.text.length > 0) {
      const origX = Math.round(b.x * scaleX);
      const origY = Math.round(b.y * scaleY);
      const origW = Math.round(b.w * scaleX);
      const origH = Math.round(b.h * scaleY);

      boxes.push({
        frameIndex,
        bbox: { x: origX, y: origY, w: origW, h: origH },
        polygon: [
          [origX, origY],
          [origX + origW, origY],
          [origX + origW, origY + origH],
          [origX, origY + origH]
        ],
        text: textResult.text,
        confidence: textResult.confidence
      });
    }
  }

  if (verbose && typeof console !== "undefined") {
    console.log(`[OCR Engine] Frame ${frameIndex}: Detected ${boxes.length} text region box(es)`);
    boxes.forEach((box, i) => {
      console.log(`  [Box #${i + 1}] Frame ${frameIndex} | x:${box.bbox.x}, y:${box.bbox.y}, w:${box.bbox.w}, h:${box.bbox.h} | text: "${box.text}"`);
    });
  }

  return boxes;
}

function recognizeBoxTextWithMicroOcr(patch, patchW, patchH, boxX, boxY, imageW, imageH, options) {
  const colCounts = new Uint32Array(patchW);
  for (let x = 0; x < patchW; x++) {
    for (let y = 0; y < patchH; y++) {
      if (patch[y * patchW + x] === 1) colCounts[x]++;
    }
  }

  const glyphs = [];
  let inGlyph = false;
  let startX = 0;

  for (let x = 0; x < patchW; x++) {
    if (colCounts[x] > 0) {
      if (!inGlyph) {
        inGlyph = true;
        startX = x;
      }
    } else {
      if (inGlyph) {
        inGlyph = false;
        const gW = x - startX;
        if (gW >= 2) {
          glyphs.push({ x: startX, w: gW });
        }
      }
    }
  }
  if (inGlyph) {
    const gW = patchW - startX;
    if (gW >= 2) glyphs.push({ x: startX, w: gW });
  }

  let recognizedStr = "";
  let totalConfidence = 0;
  let recognizedCount = 0;

  for (const g of glyphs) {
    const glyphData = new Uint8Array(g.w * patchH);
    for (let y = 0; y < patchH; y++) {
      for (let x = 0; x < g.w; x++) {
        glyphData[y * g.w + x] = patch[y * patchW + (g.x + x)];
      }
    }

    const { char, confidence } = matchGlyphToCharacter(glyphData, g.w, patchH);
    if (char) {
      recognizedStr += char;
      totalConfidence += confidence;
      recognizedCount++;
    }
  }

  if (recognizedStr.length === 0) {
    return { text: "", confidence: 0 };
  }

  const avgConfidence = recognizedCount > 0 ? totalConfidence / recognizedCount : 0.5;

  return { text: recognizedStr, confidence: Math.round(avgConfidence * 100) / 100 };
}

export async function runOcrOnFrame(imageData, frameIndex = 0, options = {}) {
  const paddle = await getPaddleOcr();
  if (paddle) {
    try {
      const results = await paddle.detectAndRecognize(imageData);
      if (Array.isArray(results) && results.length > 0) {
        return results.map(res => ({
          frameIndex,
          bbox: {
            x: Math.round(res.polygon[0][0]),
            y: Math.round(res.polygon[0][1]),
            w: Math.round(res.polygon[1][0] - res.polygon[0][0]),
            h: Math.round(res.polygon[2][1] - res.polygon[0][1])
          },
          polygon: res.polygon,
          text: res.text,
          confidence: res.confidence || 0.9
        }));
      }
    } catch (err) {
      if (options.verboseLogging === true && typeof console !== 'undefined') {
        console.warn("PaddleOCR execution failed; using browser micro-OCR engine.");
      }
    }
  }

  if (options.requireOcrModelConfirmation === true && typeof options.onOcrFallbackPrompt === "function") {
    const proceed = await options.onOcrFallbackPrompt({ frameIndex, options });
    if (!proceed) {
      return [];
    }
  }

  return scanImageDataForText(imageData, frameIndex, options);
}
