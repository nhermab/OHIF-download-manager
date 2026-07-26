/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * DICOM Stored-Pixel PHI Redactor
 * Intercepts DICOM pixel data, extracts 8-bit RGBA preview frames, runs OCR,
 * classifies PHI, and redacts identified text boxes directly in stored pixel data.
 * Supports multi-frame, multi-buffer, and encapsulated pixel data.
 * It never asserts BurnedInAnnotation="NO" merely because OCR found no text.
 */

import { runOcrOnFrame } from "./ocr-engine.js";
import { extractMetadataValues, classifyPhiInOcrResults } from "./phi-classifier.js";
import {
  decodeDicomFrame,
  encodeDicomFrame,
  encodeRLEFrame,
  encapsulateFrameBuffers,
  isEncapsulatedTransferSyntax,
  TRANSFER_SYNTAX_UIDS,
} from "./dicom-codecs.js";

function getTagValue(dict, tag, defaultValue = null) {
  const el = dict[tag];
  if (!el || !el.Value || !el.Value.length) return defaultValue;
  return el.Value[0];
}

export function isBurnedInAnnotation(dict) {
  const val = getTagValue(dict, "00280301", "");
  if (typeof val === "string") {
    const clean = val.trim().toUpperCase();
    return clean === "YES" || clean === "Y" || clean === "1";
  }
  return false;
}

export async function redactDicomPixelData(dicomDict, options = {}) {
  const dict = dicomDict.dict;
  if (!dict) return { redacted: false, count: 0 };

  const verbose = options.verboseLogging === true;
  const log = (msg) => {
    if (verbose && typeof console !== "undefined") {
      console.log(`[Pixel Redactor] ${msg}`);
    }
  };

  const isBurnedIn = isBurnedInAnnotation(dict);
  const forceIgnore = options.forceIgnoreBurnedInAnnotation === true;
  const enablePixelRedaction = options.enablePixelRedaction !== false;

  log(`Evaluating trigger: enablePixelRedaction=${enablePixelRedaction}, BurnedInAnnotation=${isBurnedIn}, forceIgnoreBurnedInAnnotation=${forceIgnore}`);

  // Trigger condition: only redact when BurnedInAnnotation=YES OR forceIgnoreBurnedInAnnotation is true
  if (!enablePixelRedaction || (!isBurnedIn && !forceIgnore)) {
    log("Skipping pixel redaction (trigger condition not met).");
    return { redacted: false, count: 0 };
  }

  const pixelElement = dict["7FE00010"];
  if (!pixelElement || !pixelElement.Value || !pixelElement.Value.length) {
    log("No PixelData (7FE0,0010) element found in DICOM dataset.");
    return { redacted: false, count: 0 };
  }

  const rows = parseInt(getTagValue(dict, "00280010", 0), 10);
  const cols = parseInt(getTagValue(dict, "00280011", 0), 10);
  if (!rows || !cols) {
    log("Invalid image dimensions (Rows or Columns missing).");
    return { redacted: false, count: 0 };
  }

  const bitsAllocated = parseInt(getTagValue(dict, "00280100", 16), 10);
  const bitsStored = parseInt(getTagValue(dict, "00280101", bitsAllocated), 10);
  const pixelRepresentation = parseInt(getTagValue(dict, "00280103", 0), 10);
  const samplesPerPixel = parseInt(getTagValue(dict, "00280002", 1), 10);
  const photometric = String(getTagValue(dict, "00280004", "MONOCHROME2")).toUpperCase();
  const numberOfFrames = Math.max(1, parseInt(getTagValue(dict, "00280008", 1), 10) || 1);
  const pixelPaddingValue = getTagValue(dict, "00280120", null);

  const frameElements = rows * cols * samplesPerPixel;

  if (
    ![8, 16].includes(bitsAllocated) ||
    ![1, 3].includes(samplesPerPixel) ||
    !['MONOCHROME1', 'MONOCHROME2', 'RGB'].includes(photometric)
  ) {
    throw new Error(
      `Unsupported pixel organization: ${bitsAllocated}-bit ${photometric} with ${samplesPerPixel} sample(s) per pixel.`
    );
  }

  const transferSyntax = String(
    getTagValue(dicomDict.meta || dict, "00020010", "1.2.840.10008.1.2.1")
  ).trim();
  const isEncapsulated = isEncapsulatedTransferSyntax(transferSyntax);

  log(`Image Metadata: dimensions=${cols}x${rows}, frames=${numberOfFrames}, bitsAllocated=${bitsAllocated}, bitsStored=${bitsStored}, samplesPerPixel=${samplesPerPixel}, photometric=${photometric}, transferSyntax=${transferSyntax}, isEncapsulated=${isEncapsulated}`);

  const imageInfo = {
    rows,
    cols,
    bitsAllocated,
    bitsStored,
    pixelRepresentation,
    samplesPerPixel,
    photometric,
  };

  // Unify pixel buffers into a contiguous writable TypedArray view or decoded frame set
  let fullTypedArray = null;

  if (!isEncapsulated && pixelElement.Value.length === 1) {
    let raw = pixelElement.Value[0];
    if (ArrayBuffer.isView(raw)) {
      if (bitsAllocated === 8) {
        fullTypedArray = pixelRepresentation === 1
          ? new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength)
          : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      } else {
        fullTypedArray = pixelRepresentation === 1
          ? new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
          : new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
      }
    } else if (raw instanceof ArrayBuffer) {
      if (bitsAllocated === 8) {
        fullTypedArray = pixelRepresentation === 1 ? new Int8Array(raw) : new Uint8Array(raw);
      } else {
        fullTypedArray = pixelRepresentation === 1 ? new Int16Array(raw) : new Uint16Array(raw);
      }
    }
  }

  if (!fullTypedArray) {
    const totalElements = numberOfFrames * frameElements;
    log(`Allocating contiguous TypedArray buffer for ${numberOfFrames} frame(s) (${totalElements} elements)`);
    if (bitsAllocated === 8) {
      fullTypedArray = pixelRepresentation === 1 ? new Int8Array(totalElements) : new Uint8Array(totalElements);
    } else {
      fullTypedArray = pixelRepresentation === 1 ? new Int16Array(totalElements) : new Uint16Array(totalElements);
    }

    for (let f = 0; f < numberOfFrames; f++) {
      let frameBuf = getFrameBuffer(pixelElement.Value, f, numberOfFrames);
      if (frameBuf) {
        if (isEncapsulated) {
          const decodedArray = await decodeDicomFrame(frameBuf, transferSyntax, imageInfo);
          if (decodedArray) {
            const frameOffset = f * frameElements;
            const len = Math.min(decodedArray.length, frameElements);
            for (let i = 0; i < len; i++) {
              fullTypedArray[frameOffset + i] = decodedArray[i];
            }
          } else {
            // The source file remains a valid DICOM object even when a browser
            // codec is unavailable. Do not turn an otherwise usable metadata
            // anonymization export into a failed download. Pixel bytes and the
            // source transfer syntax are deliberately left untouched here.
            const message = `Pixel redaction skipped: unable to decode frame ${f} for Transfer Syntax ${transferSyntax}. The original compressed pixel data was preserved.`;
            log(message);
            if (Array.isArray(options.warnings)) {
              options.warnings.push(message);
            }
            if (typeof options.onPixelDataFallback === "function") {
              options.onPixelDataFallback(message);
            }
            return {
              redacted: false,
              count: 0,
              transferSyntax,
              verifiedClean: false,
              pixelDataPreserved: true,
            };
          }
        } else {
          copyRawBufferToTypedArray(frameBuf, fullTypedArray, f, frameElements, bitsAllocated, pixelRepresentation);
        }
      }
    }
  }

  // Handle multi-frame redaction method selection (Aggressive vs Sampling)
  let redactionMethod = options.multiFrameRedactionMethod;
  if (numberOfFrames > 1 && (!redactionMethod || redactionMethod === "ask")) {
    if (typeof options.onPromptMultiFrameMethod === "function") {
      redactionMethod = await options.onPromptMultiFrameMethod({ numberOfFrames, dict });
    } else {
      redactionMethod = "aggressive";
    }
    options.multiFrameRedactionMethod = redactionMethod;
  }

  if (!redactionMethod || redactionMethod === "ask") {
    redactionMethod = "aggressive";
  }

  // Select frame indices for OCR scan based on chosen method
  const sampledFrameIndices = new Set();
  if (numberOfFrames > 1 && redactionMethod === "sampling") {
    sampledFrameIndices.add(0);
    sampledFrameIndices.add(Math.floor(numberOfFrames / 2));
    sampledFrameIndices.add(numberOfFrames - 1);
    for (let f = 0; f < numberOfFrames; f += 20) {
      sampledFrameIndices.add(f);
    }
    log(`Multi-frame redaction mode: SAMPLING (scanned ${sampledFrameIndices.size} of ${numberOfFrames} frames)`);
  } else {
    // Aggressive method or single-frame: scan all frames sequentially
    for (let f = 0; f < numberOfFrames; f++) {
      sampledFrameIndices.add(f);
    }
    if (numberOfFrames > 1) {
      log(`Multi-frame redaction mode: AGGRESSIVE (scanned all ${numberOfFrames} frames sequentially)`);
    }
  }

  const metadataValues = extractMetadataValues(dict);
  log(`Extracted metadata PHI tokens (${metadataValues.length}): ${JSON.stringify(metadataValues)}`);

  const allOcrFindings = [];

  for (const f of sampledFrameIndices) {
    if (f >= numberOfFrames) continue;

    const imageData = createFrameImageData(
      fullTypedArray,
      f,
      rows,
      cols,
      samplesPerPixel,
      bitsAllocated,
      bitsStored,
      photometric,
      dict
    );

    const frameFindings = await runOcrOnFrame(imageData, f, options);
    allOcrFindings.push(...frameFindings);
  }

  log(`Sampled ${sampledFrameIndices.size} frame(s). Detected ${allOcrFindings.length} total raw text region(s).`);

  // Classify PHI
  const classifiedFindings = classifyPhiInOcrResults(allOcrFindings, metadataValues, {
    ...options,
    isBurnedIn,
    imageWidth: cols,
    imageHeight: rows
  });

  const redactableFindings = classifiedFindings.filter(item => item.decision === "redact");

  log(`Classified ${redactableFindings.length} region(s) as PHI to redact.`);
  redactableFindings.forEach((r, idx) => {
    log(`  [Redact Region #${idx + 1}] Frame ${r.frameIndex} | bbox=(x:${r.bbox.x}, y:${r.bbox.y}, w:${r.bbox.w}, h:${r.bbox.h}) | text="${r.text}" | phiScore=${r.phiScore} | reasons=${r.reasons.join("; ")}`);
  });

  if (redactableFindings.length === 0) {
    log("No PHI text regions detected. BurnedInAnnotation is left unchanged because OCR is not proof of clean pixels.");
    if (Array.isArray(options.warnings)) {
      options.warnings.push("Burned-in pixel data scanned with OCR: no PHI text detected. BurnedInAnnotation was not changed.");
    }

    let outTS = transferSyntax;
    if (options.forceUncompressed === true && isEncapsulated) {
      const outBuffer = (fullTypedArray.byteOffset === 0 && fullTypedArray.byteLength === fullTypedArray.buffer.byteLength)
        ? fullTypedArray.buffer
        : fullTypedArray.buffer.slice(fullTypedArray.byteOffset, fullTypedArray.byteOffset + fullTypedArray.byteLength);
      pixelElement.Value = [outBuffer];
      pixelElement.vr = bitsAllocated === 8 ? "OB" : "OW";
      outTS = "1.2.840.10008.1.2.1";
      if (dicomDict.meta) dicomDict.meta["00020010"] = { vr: "UI", Value: [outTS] };
      if (dict["00020010"]) dict["00020010"] = { vr: "UI", Value: [outTS] };
    }
    return { redacted: false, count: 0, transferSyntax: outTS, verifiedClean: false };
  }

  // Determine fill values & border parameters for stored pixel redaction
  const marginPixels = options.marginPixels !== undefined ? options.marginPixels : 4;
  const borderColor = String(options.borderColor || options.redactionBorderColor || "none").toLowerCase();
  const borderWidth = options.borderWidth !== undefined
    ? Math.max(0, Number(options.borderWidth))
    : (borderColor !== "none" ? 2 : 0);

  let fillVal;
  if (pixelPaddingValue !== null && pixelPaddingValue !== undefined) {
    fillVal = Number(pixelPaddingValue);
  } else if (photometric === "MONOCHROME1") {
    fillVal = (1 << bitsStored) - 1;
  } else {
    fillVal = 0;
  }

  const maxPixelVal = (1 << bitsStored) - 1;
  const minPixelVal = 0;

  let redactedBoxCount = 0;

  for (let f = 0; f < numberOfFrames; f++) {
    const frameOffset = f * frameElements;

    const frameBoxes = redactableFindings.filter(item => item.frameIndex === f);

    for (const item of frameBoxes) {
      const { x, y, w, h } = item.bbox;
      const minX = Math.max(0, Math.floor(x - marginPixels));
      const minY = Math.max(0, Math.floor(y - marginPixels));
      const maxX = Math.min(cols - 1, Math.ceil(x + w + marginPixels));
      const maxY = Math.min(rows - 1, Math.ceil(y + h + marginPixels));

      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const idx = frameOffset + (py * cols + px) * samplesPerPixel;
          const distEdge = Math.min(px - minX, maxX - px, py - minY, maxY - py);

          let rVal = fillVal;
          let gVal = fillVal;
          let bVal = fillVal;

          if (borderWidth > 0 && distEdge < borderWidth) {
            if (borderColor === "red") {
              if (samplesPerPixel === 3) {
                rVal = 255;
                gVal = 0;
                bVal = 0;
              } else {
                rVal = distEdge === 0 ? maxPixelVal : minPixelVal;
              }
            } else if (borderColor === "double") {
              // Black & White double border
              if (distEdge === 0) {
                rVal = gVal = bVal = samplesPerPixel === 3 ? 255 : maxPixelVal; // White outer line
              } else {
                rVal = gVal = bVal = samplesPerPixel === 3 ? 0 : minPixelVal;   // Black inner line
              }
            } else if (borderColor === "white") {
              rVal = gVal = bVal = samplesPerPixel === 3 ? 255 : maxPixelVal;
            } else if (borderColor === "black") {
              rVal = gVal = bVal = samplesPerPixel === 3 ? 0 : minPixelVal;
            }
          }

          if (samplesPerPixel === 1) {
            fullTypedArray[idx] = rVal;
          } else {
            fullTypedArray[idx] = rVal;     // R
            fullTypedArray[idx + 1] = gVal; // G
            fullTypedArray[idx + 2] = bVal; // B
          }
        }
      }
      redactedBoxCount++;
    }
  }

  // Handle encoding / transfer syntax output
  const preserveSyntax = options.preserveTransferSyntax !== false && options.recompressEncapsulated !== false;
  const forceUncompressed = options.forceUncompressed === true;
  let reencodedEncapsulated = false;
  let outputTransferSyntax = "1.2.840.10008.1.2.1"; // Explicit VR Little Endian fallback

  if (isEncapsulated && preserveSyntax && !forceUncompressed) {
    const compressedFrames = [];
    let encodeSuccess = true;

    for (let f = 0; f < numberOfFrames; f++) {
      const frameOffset = f * frameElements;
      const framePixels = fullTypedArray.subarray(frameOffset, frameOffset + frameElements);
      const encodedFrame = await encodeDicomFrame(framePixels, transferSyntax, imageInfo);
      if (encodedFrame && encodedFrame.length > 0) {
        compressedFrames.push(encodedFrame);
      } else {
        encodeSuccess = false;
        break;
      }
    }

    if (encodeSuccess && compressedFrames.length === numberOfFrames) {
      pixelElement.Value = encapsulateFrameBuffers(compressedFrames);
      pixelElement.vr = "OB";
      outputTransferSyntax = transferSyntax;
      reencodedEncapsulated = true;
    }
  }

  // If the original encoder is not available, retain compression with the
  // universally supported, lossless RLE transfer syntax before expanding the
  // export to uncompressed pixels. This only runs after successful decoding,
  // so it never relabels compressed bytes as another transfer syntax.
  if (
    !reencodedEncapsulated &&
    isEncapsulated &&
    !forceUncompressed &&
    // The in-browser RLE encoder supports monochrome 8/16-bit and RGB 8-bit
    // samples. Preserve correctness for other layouts by using the explicit
    // uncompressed fallback below.
    (samplesPerPixel === 1 || bitsAllocated === 8)
  ) {
    try {
      const rleFrames = [];
      for (let f = 0; f < numberOfFrames; f++) {
        const frameOffset = f * frameElements;
        rleFrames.push(encodeRLEFrame(fullTypedArray.subarray(frameOffset, frameOffset + frameElements), imageInfo));
      }
      pixelElement.Value = encapsulateFrameBuffers(rleFrames);
      pixelElement.vr = "OB";
      outputTransferSyntax = TRANSFER_SYNTAX_UIDS.RLE_LOSSLESS;
      reencodedEncapsulated = true;
    } catch (error) {
      log(`RLE fallback encoding failed; writing Explicit VR Little Endian instead: ${error?.message || error}`);
    }
  }

  if (!reencodedEncapsulated) {
    // Write updated contiguous uncompressed buffer back into PixelData element
    const outBuffer = (fullTypedArray.byteOffset === 0 && fullTypedArray.byteLength === fullTypedArray.buffer.byteLength)
      ? fullTypedArray.buffer
      : fullTypedArray.buffer.slice(fullTypedArray.byteOffset, fullTypedArray.byteOffset + fullTypedArray.byteLength);

    pixelElement.Value = [outBuffer];
    pixelElement.vr = bitsAllocated === 8 ? "OB" : "OW";
    outputTransferSyntax = "1.2.840.10008.1.2.1";
  }

  // Update TransferSyntaxUID
  if (dicomDict.meta) {
    dicomDict.meta["00020010"] = { vr: "UI", Value: [outputTransferSyntax] };
  }
  if (dict["00020010"]) {
    dict["00020010"] = { vr: "UI", Value: [outputTransferSyntax] };
  }

  // Clear BurnedInAnnotation to NO
  dict["00280301"] = { vr: "CS", Value: ["NO"] };
  if (dicomDict.meta && dicomDict.meta["00280301"]) {
    dicomDict.meta["00280301"] = { vr: "CS", Value: ["NO"] };
  }

  log(`Successfully redacted ${redactedBoxCount} region(s) across ${numberOfFrames} frame(s). Output Transfer Syntax: ${outputTransferSyntax}. BurnedInAnnotation updated to NO.`);

  if (Array.isArray(options.warnings)) {
    options.warnings.push(
      `Pixel PHI Redacted: ${redactedBoxCount} text region(s) redacted across ${numberOfFrames} frame(s) via client-side OCR. Transfer Syntax: ${outputTransferSyntax}. BurnedInAnnotation updated to NO.`
    );
  }

  return { redacted: true, count: redactedBoxCount, transferSyntax: outputTransferSyntax };
}

function getFrameBuffer(valueArray, frameIndex, numberOfFrames) {
  if (!Array.isArray(valueArray) || valueArray.length === 0) return null;
  // The legacy representation exposes the Basic Offset Table as item 0. This
  // client supports only the unambiguous one-fragment-per-frame layout with an
  // empty BOT. It must not guess frame boundaries for fragmented encapsulated
  // Pixel Data, populated/extended offset tables, or other layouts.
  if (valueArray.length !== numberOfFrames + 1) {
    throw new Error('Unsupported encapsulated Pixel Data fragmentation; frame boundaries are ambiguous.');
  }
  const basicOffsetTable = valueArray[0];
  const botLength = ArrayBuffer.isView(basicOffsetTable)
    ? basicOffsetTable.byteLength
    : basicOffsetTable instanceof ArrayBuffer
      ? basicOffsetTable.byteLength
      : -1;
  if (botLength !== 0) {
    throw new Error('Unsupported populated Basic Offset Table; frame boundaries require a standards-tested parser.');
  }
  return valueArray[frameIndex + 1];
}

async function decodeFrameBufferToImageData(buf, cols, rows) {
  try {
    const raw = ArrayBuffer.isView(buf) ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf;
    const blob = new Blob([raw], { type: "image/jpeg" });
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(blob);
      let canvas;
      if (typeof OffscreenCanvas !== "undefined") {
        canvas = new OffscreenCanvas(cols, rows);
      } else {
        canvas = document.createElement("canvas");
        canvas.width = cols;
        canvas.height = rows;
      }
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, cols, rows);
      return ctx.getImageData(0, 0, cols, rows);
    }
  } catch (ignore) {}
  return null;
}

function writeImageDataToTypedArray(imageData, targetTypedArray, frameIndex, frameElements, samplesPerPixel, photometric, bitsStored) {
  const { data } = imageData;
  const frameOffset = frameIndex * frameElements;

  for (let i = 0; i < imageData.width * imageData.height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];

    if (samplesPerPixel === 1) {
      let gray = Math.round((r * 299 + g * 587 + b * 114) / 1000);
      if (photometric === "MONOCHROME1") {
        gray = 255 - gray;
      }
      targetTypedArray[frameOffset + i] = gray;
    } else {
      targetTypedArray[frameOffset + i * 3] = r;
      targetTypedArray[frameOffset + i * 3 + 1] = g;
      targetTypedArray[frameOffset + i * 3 + 2] = b;
    }
  }
}

function copyRawBufferToTypedArray(srcBuf, targetTypedArray, frameIndex, frameElements, bitsAllocated, pixelRepresentation) {
  const frameOffset = frameIndex * frameElements;
  let srcView;

  if (ArrayBuffer.isView(srcBuf)) {
    srcView = srcBuf;
  } else if (srcBuf instanceof ArrayBuffer) {
    srcView = bitsAllocated === 8
      ? (pixelRepresentation === 1 ? new Int8Array(srcBuf) : new Uint8Array(srcBuf))
      : (pixelRepresentation === 1 ? new Int16Array(srcBuf) : new Uint16Array(srcBuf));
  }

  if (srcView) {
    const len = Math.min(srcView.length, frameElements);
    for (let i = 0; i < len; i++) {
      targetTypedArray[frameOffset + i] = srcView[i];
    }
  }
}

function createFrameImageData(
  typedArray,
  frameIndex,
  rows,
  cols,
  samplesPerPixel,
  bitsAllocated,
  bitsStored,
  photometric,
  dict
) {
  const frameElementCount = rows * cols * samplesPerPixel;
  const frameOffset = frameIndex * frameElementCount;
  const rgba = new Uint8ClampedArray(rows * cols * 4);

  let windowCenter = null;
  let windowWidth = null;
  const wcEl = dict["00281050"];
  const wwEl = dict["00281051"];
  if (wcEl && wcEl.Value && wcEl.Value.length) windowCenter = parseFloat(wcEl.Value[0]);
  if (wwEl && wwEl.Value && wwEl.Value.length) windowWidth = parseFloat(wwEl.Value[0]);

  let minVal = 0;
  let maxVal = (1 << bitsStored) - 1;

  if (windowCenter !== null && windowWidth !== null && windowWidth > 0) {
    minVal = windowCenter - windowWidth / 2;
    maxVal = windowCenter + windowWidth / 2;
  }

  const range = Math.max(1, maxVal - minVal);

  for (let i = 0; i < rows * cols; i++) {
    const rgbaIdx = i * 4;

    if (samplesPerPixel === 1) {
      const rawVal = typedArray[frameOffset + i];
      let norm = Math.max(0, Math.min(255, ((rawVal - minVal) / range) * 255));
      if (photometric === "MONOCHROME1") {
        norm = 255 - norm;
      }
      rgba[rgbaIdx] = norm;
      rgba[rgbaIdx + 1] = norm;
      rgba[rgbaIdx + 2] = norm;
      rgba[rgbaIdx + 3] = 255;
    } else {
      const r = typedArray[frameOffset + i * 3];
      const g = typedArray[frameOffset + i * 3 + 1];
      const b = typedArray[frameOffset + i * 3 + 2];
      rgba[rgbaIdx] = Math.max(0, Math.min(255, r));
      rgba[rgbaIdx + 1] = Math.max(0, Math.min(255, g));
      rgba[rgbaIdx + 2] = Math.max(0, Math.min(255, b));
      rgba[rgbaIdx + 3] = 255;
    }
  }

  if (typeof ImageData !== "undefined") {
    return new ImageData(rgba, cols, rows);
  }

  return { width: cols, height: rows, data: rgba };
}
