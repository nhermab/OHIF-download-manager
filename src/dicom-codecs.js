/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Native WebAssembly & JavaScript DICOM Codecs for Encapsulated Pixel Data
 * Supports decoding and re-compressing/transcoding for all standard DICOM transfer syntaxes:
 * - JPEG 2000 (1.2.840.10008.1.2.4.90, 1.2.840.10008.1.2.4.91)
 * - JPEG-LS (1.2.840.10008.1.2.4.80, 1.2.840.10008.1.2.4.81)
 * - HTJ2K (1.2.840.10008.1.2.4.201, 1.2.840.10008.1.2.4.202, 1.2.840.10008.1.2.4.203)
 * - RLE Lossless (1.2.840.10008.1.2.5)
 * - JPEG Lossless (1.2.840.10008.1.2.4.57, 1.2.840.10008.1.2.4.70)
 * - JPEG Baseline 8-bit & Extended (1.2.840.10008.1.2.4.50, 1.2.840.10008.1.2.4.51)
 * - Uncompressed (1.2.840.10008.1.2, 1.2.840.10008.1.2.1, 1.2.840.10008.1.2.2)
 */

export const TRANSFER_SYNTAX_UIDS = {
  IMPLICIT_VR_LITTLE_ENDIAN: "1.2.840.10008.1.2",
  EXPLICIT_VR_LITTLE_ENDIAN: "1.2.840.10008.1.2.1",
  EXPLICIT_VR_BIG_ENDIAN: "1.2.840.10008.1.2.2",
  JPEG_BASELINE_8BIT: "1.2.840.10008.1.2.4.50",
  JPEG_EXTENDED_12BIT: "1.2.840.10008.1.2.4.51",
  JPEG_LOSSLESS_PROCESS_14: "1.2.840.10008.1.2.4.57",
  JPEG_LOSSLESS_SV1: "1.2.840.10008.1.2.4.70",
  JPEGLS_LOSSLESS: "1.2.840.10008.1.2.4.80",
  JPEGLS_LOSSY: "1.2.840.10008.1.2.4.81",
  JPEG2000_LOSSLESS: "1.2.840.10008.1.2.4.90",
  JPEG2000_LOSSY: "1.2.840.10008.1.2.4.91",
  HTJ2K_LOSSLESS: "1.2.840.10008.1.2.4.201",
  HTJ2K_LOSSLESS_RPCL: "1.2.840.10008.1.2.4.202",
  HTJ2K_LOSSY: "1.2.840.10008.1.2.4.203",
  RLE_LOSSLESS: "1.2.840.10008.1.2.5",
};

export function isEncapsulatedTransferSyntax(tsUid) {
  if (!tsUid) return false;
  const clean = String(tsUid).trim();
  return (
    clean !== TRANSFER_SYNTAX_UIDS.IMPLICIT_VR_LITTLE_ENDIAN &&
    clean !== TRANSFER_SYNTAX_UIDS.EXPLICIT_VR_LITTLE_ENDIAN &&
    clean !== TRANSFER_SYNTAX_UIDS.EXPLICIT_VR_BIG_ENDIAN
  );
}

// Global WASM Codec instances cache
const codecCache = {
  openjpeg: null,
  charls: null,
  openjph: null,
  libjpeg: null,
  jpegLossless: null,
};

async function getOpenJPEGCodec() {
  if (codecCache.openjpeg) return codecCache.openjpeg;
  try {
    const mod = await import("@cornerstonejs/codec-openjpeg/wasmjs");
    const factory = mod.default || mod;
    codecCache.openjpeg = typeof factory === "function" ? await factory() : factory;
  } catch (e) {
    try {
      const mod = await import("@cornerstonejs/codec-openjpeg");
      const factory = mod.default || mod;
      codecCache.openjpeg = typeof factory === "function" ? await factory() : factory;
    } catch (e2) {
      try {
        const openjpegModule = require("@cornerstonejs/codec-openjpeg/wasmjs");
        const factory = openjpegModule.default || openjpegModule;
        codecCache.openjpeg = typeof factory === "function" ? await factory() : factory;
      } catch (err) {
        try {
          const openjpegRoot = require("@cornerstonejs/codec-openjpeg");
          const factory = openjpegRoot.default || openjpegRoot;
          codecCache.openjpeg = typeof factory === "function" ? await factory() : factory;
        } catch (err2) {}
      }
    }
  }
  return codecCache.openjpeg;
}

async function getCharLSCodec() {
  if (codecCache.charls) return codecCache.charls;
  try {
    const mod = await import("@cornerstonejs/codec-charls/wasmjs");
    const factory = mod.default || mod;
    codecCache.charls = typeof factory === "function" ? await factory() : factory;
  } catch (e) {
    try {
      const mod = await import("@cornerstonejs/codec-charls");
      const factory = mod.default || mod;
      codecCache.charls = typeof factory === "function" ? await factory() : factory;
    } catch (e2) {
      try {
        const charlsModule = require("@cornerstonejs/codec-charls/wasmjs");
        const factory = charlsModule.default || charlsModule;
        codecCache.charls = typeof factory === "function" ? await factory() : factory;
      } catch (err) {
        try {
          const charlsRoot = require("@cornerstonejs/codec-charls");
          const factory = charlsRoot.default || charlsRoot;
          codecCache.charls = typeof factory === "function" ? await factory() : factory;
        } catch (err2) {}
      }
    }
  }
  return codecCache.charls;
}

async function getOpenJPHCodec() {
  if (codecCache.openjph) return codecCache.openjph;
  try {
    const mod = await import("@cornerstonejs/codec-openjph/wasmjs");
    const factory = mod.default || mod;
    codecCache.openjph = typeof factory === "function" ? await factory() : factory;
  } catch (e) {
    try {
      const mod = await import("@cornerstonejs/codec-openjph");
      const factory = mod.default || mod;
      codecCache.openjph = typeof factory === "function" ? await factory() : factory;
    } catch (e2) {
      try {
        const openjphModule = require("@cornerstonejs/codec-openjph/wasmjs");
        const factory = openjphModule.default || openjphModule;
        codecCache.openjph = typeof factory === "function" ? await factory() : factory;
      } catch (err) {
        try {
          const openjphRoot = require("@cornerstonejs/codec-openjph");
          const factory = openjphRoot.default || openjphRoot;
          codecCache.openjph = typeof factory === "function" ? await factory() : factory;
        } catch (err2) {}
      }
    }
  }
  return codecCache.openjph;
}

async function getLibJPEGCodec() {
  if (codecCache.libjpeg) return codecCache.libjpeg;
  try {
    const mod = await import("@cornerstonejs/codec-libjpeg-turbo-8bit/wasmjs");
    const factory = mod.default || mod;
    codecCache.libjpeg = typeof factory === "function" ? await factory() : factory;
  } catch (e) {
    try {
      const mod = await import("@cornerstonejs/codec-libjpeg-turbo-8bit");
      const factory = mod.default || mod;
      codecCache.libjpeg = typeof factory === "function" ? await factory() : factory;
    } catch (e2) {
      try {
        const libjpegModule = require("@cornerstonejs/codec-libjpeg-turbo-8bit/wasmjs");
        const factory = libjpegModule.default || libjpegModule;
        codecCache.libjpeg = typeof factory === "function" ? await factory() : factory;
      } catch (err) {
        try {
          const libjpegRoot = require("@cornerstonejs/codec-libjpeg-turbo-8bit");
          const factory = libjpegRoot.default || libjpegRoot;
          codecCache.libjpeg = typeof factory === "function" ? await factory() : factory;
        } catch (err2) {}
      }
    }
  }
  return codecCache.libjpeg;
}

async function getJPEGLosslessDecoder() {
  if (codecCache.jpegLossless) return codecCache.jpegLossless;
  try {
    const mod = await import("jpeg-lossless-decoder-js");
    codecCache.jpegLossless = mod.Decoder || mod.default?.Decoder || mod.default;
  } catch (e) {
    try {
      const pkg = require("jpeg-lossless-decoder-js");
      codecCache.jpegLossless = pkg.Decoder || pkg.default?.Decoder || pkg.default || pkg;
    } catch (err) {}
  }
  return codecCache.jpegLossless;
}

/**
 * DICOM RLE Lossless Decoder (PS 3.5 Annex G)
 */
export function decodeRLEFrame(compressedBuffer, imageInfo) {
  const { rows, cols, bitsAllocated, samplesPerPixel = 1, pixelRepresentation = 0 } = imageInfo;
  const frameElements = rows * cols;
  const bytesPerSample = Math.ceil(bitsAllocated / 8);
  const outByteLength = frameElements * samplesPerPixel * bytesPerSample;
  const outBuffer = new ArrayBuffer(outByteLength);

  const raw = ArrayBuffer.isView(compressedBuffer)
    ? compressedBuffer.buffer.slice(compressedBuffer.byteOffset, compressedBuffer.byteOffset + compressedBuffer.byteLength)
    : compressedBuffer;
  const dataView = new DataView(raw);
  const int8Data = new Int8Array(raw);

  const numSegments = dataView.getInt32(0, true);
  if (numSegments < 1 || numSegments > 15) {
    throw new Error(`Invalid RLE numSegments: ${numSegments}`);
  }

  const outInt8 = new Int8Array(outBuffer);

  for (let s = 0; s < numSegments; s++) {
    let inIndex = dataView.getInt32((s + 1) * 4, true);
    let maxIndex = dataView.getInt32((s + 2) * 4, true);
    if (!maxIndex || maxIndex === 0 || maxIndex > raw.byteLength) {
      maxIndex = raw.byteLength;
    }

    if (bitsAllocated === 8) {
      let outIndex = (samplesPerPixel === 3) ? s : s * frameElements;
      const step = (samplesPerPixel === 3) ? 3 : 1;
      while (inIndex < maxIndex && outIndex < outByteLength) {
        const n = int8Data[inIndex++];
        if (n >= 0 && n <= 127) {
          const count = n + 1;
          for (let i = 0; i < count && inIndex < maxIndex && outIndex < outByteLength; i++) {
            outInt8[outIndex] = int8Data[inIndex++];
            outIndex += step;
          }
        } else if (n <= -1 && n >= -127) {
          const count = -n + 1;
          const val = int8Data[inIndex++];
          for (let j = 0; j < count && outIndex < outByteLength; j++) {
            outInt8[outIndex] = val;
            outIndex += step;
          }
        }
      }
    } else if (bitsAllocated === 16) {
      // s=0 is MSB, s=1 is LSB (for monochrome)
      const highByte = (s === 0) ? 1 : 0;
      let outIndex = 0;
      while (inIndex < maxIndex && outIndex < frameElements) {
        const n = int8Data[inIndex++];
        if (n >= 0 && n <= 127) {
          const count = n + 1;
          for (let i = 0; i < count && inIndex < maxIndex && outIndex < frameElements; i++) {
            outInt8[outIndex * 2 + highByte] = int8Data[inIndex++];
            outIndex++;
          }
        } else if (n <= -1 && n >= -127) {
          const count = -n + 1;
          const val = int8Data[inIndex++];
          for (let j = 0; j < count && outIndex < frameElements; j++) {
            outInt8[outIndex * 2 + highByte] = val;
            outIndex++;
          }
        }
      }
    }
  }

  return bitsAllocated === 8
    ? (pixelRepresentation === 1 ? new Int8Array(outBuffer) : new Uint8Array(outBuffer))
    : (pixelRepresentation === 1 ? new Int16Array(outBuffer) : new Uint16Array(outBuffer));
}

/**
 * DICOM RLE Lossless Encoder (PS 3.5 Annex G)
 */
export function encodeRLEFrame(pixelArray, imageInfo) {
  const { rows, cols, bitsAllocated = 16, samplesPerPixel = 1 } = imageInfo;
  const frameElements = rows * cols;
  const bytesPerSample = Math.ceil(bitsAllocated / 8);
  const numSegments = bytesPerSample * samplesPerPixel;

  const header = new DataView(new ArrayBuffer(64));
  header.setInt32(0, numSegments, true);

  const segmentBuffers = [];
  let currentOffset = 64;

  for (let s = 0; s < numSegments; s++) {
    header.setInt32((s + 1) * 4, currentOffset, true);

    const plane = new Uint8Array(frameElements);
    if (bitsAllocated === 8) {
      if (samplesPerPixel === 1) {
        for (let i = 0; i < frameElements; i++) plane[i] = pixelArray[i];
      } else {
        for (let i = 0; i < frameElements; i++) plane[i] = pixelArray[i * samplesPerPixel + s];
      }
    } else if (bitsAllocated === 16) {
      const isMSB = (s === 0);
      const view = new DataView(pixelArray.buffer, pixelArray.byteOffset, pixelArray.byteLength);
      for (let i = 0; i < frameElements; i++) {
        const val = view.getUint16(i * 2, true);
        plane[i] = isMSB ? ((val >> 8) & 0xff) : (val & 0xff);
      }
    }

    const compressedPlane = packBitsCompress(plane);
    let finalBuf = compressedPlane;
    if (compressedPlane.length % 2 !== 0) {
      finalBuf = new Uint8Array(compressedPlane.length + 1);
      finalBuf.set(compressedPlane);
      finalBuf[compressedPlane.length] = 0;
    }
    segmentBuffers.push(finalBuf);
    currentOffset += finalBuf.length;
  }

  const out = new Uint8Array(currentOffset);
  out.set(new Uint8Array(header.buffer), 0);
  let offset = 64;
  for (const seg of segmentBuffers) {
    out.set(seg, offset);
    offset += seg.length;
  }
  return out;
}

function packBitsCompress(src) {
  const out = [];
  let i = 0;
  const max = src.length;
  while (i < max) {
    let runLen = 1;
    while (i + runLen < max && runLen < 128 && src[i + runLen] === src[i]) runLen++;
    if (runLen > 2) {
      out.push((256 - runLen + 1) & 0xff);
      out.push(src[i]);
      i += runLen;
    } else {
      let litStart = i;
      let litLen = 0;
      while (i < max && litLen < 128) {
        if (i + 2 < max && src[i] === src[i + 1] && src[i] === src[i + 2]) break;
        litLen++;
        i++;
      }
      out.push(litLen - 1);
      for (let k = litStart; k < litStart + litLen; k++) out.push(src[k]);
    }
  }
  return new Uint8Array(out);
}

/**
 * Universal Frame Decoder
 */
export async function decodeDicomFrame(compressedBuffer, transferSyntax, imageInfo) {
  const ts = String(transferSyntax || "").trim();
  const rawBytes = ArrayBuffer.isView(compressedBuffer)
    ? new Uint8Array(compressedBuffer.buffer, compressedBuffer.byteOffset, compressedBuffer.byteLength)
    : new Uint8Array(compressedBuffer);

  // 1. RLE Lossless
  if (ts === TRANSFER_SYNTAX_UIDS.RLE_LOSSLESS) {
    try {
      return decodeRLEFrame(rawBytes, imageInfo);
    } catch (e) {}
  }

  // 2. JPEG 2000 (Lossless & Lossy)
  if (
    ts === TRANSFER_SYNTAX_UIDS.JPEG2000_LOSSLESS ||
    ts === TRANSFER_SYNTAX_UIDS.JPEG2000_LOSSY
  ) {
    const openjpeg = await getOpenJPEGCodec();
    if (openjpeg && openjpeg.J2KDecoder) {
      try {
        const decoder = new openjpeg.J2KDecoder();
        const encBuf = decoder.getEncodedBuffer(rawBytes.length);
        encBuf.set(rawBytes);
        decoder.decode();
        const frameInfo = decoder.getFrameInfo();
        const decodedBufferInWASM = decoder.getDecodedBuffer();
        return createTypedArrayFromBuffer(decodedBufferInWASM, frameInfo, imageInfo);
      } catch (e) {}
    }
  }

  // 3. JPEG-LS (Lossless & Lossy)
  if (
    ts === TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSLESS ||
    ts === TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSY
  ) {
    const charls = await getCharLSCodec();
    if (charls && charls.JpegLSDecoder) {
      try {
        const decoder = new charls.JpegLSDecoder();
        const encBuf = decoder.getEncodedBuffer(rawBytes.length);
        encBuf.set(rawBytes);
        decoder.decode();
        const frameInfo = decoder.getFrameInfo();
        const decodedBufferInWASM = decoder.getDecodedBuffer();
        return createTypedArrayFromBuffer(decodedBufferInWASM, frameInfo, imageInfo);
      } catch (e) {}
    }
  }

  // 4. HTJ2K (Lossless & Lossy)
  if (
    ts === TRANSFER_SYNTAX_UIDS.HTJ2K_LOSSLESS ||
    ts === TRANSFER_SYNTAX_UIDS.HTJ2K_LOSSLESS_RPCL ||
    ts === TRANSFER_SYNTAX_UIDS.HTJ2K_LOSSY
  ) {
    const openjph = await getOpenJPHCodec();
    if (openjph && openjph.HTJ2KDecoder) {
      try {
        const decoder = new openjph.HTJ2KDecoder();
        const encBuf = decoder.getEncodedBuffer(rawBytes.length);
        encBuf.set(rawBytes);
        decoder.decode();
        const frameInfo = decoder.getFrameInfo();
        const decodedBufferInWASM = decoder.getDecodedBuffer();
        return createTypedArrayFromBuffer(decodedBufferInWASM, frameInfo, imageInfo);
      } catch (e) {}
    }
  }

  // 5. JPEG Lossless (Process 14 & SV1)
  if (
    ts === TRANSFER_SYNTAX_UIDS.JPEG_LOSSLESS_PROCESS_14 ||
    ts === TRANSFER_SYNTAX_UIDS.JPEG_LOSSLESS_SV1
  ) {
    const DecoderClass = await getJPEGLosslessDecoder();
    if (DecoderClass) {
      try {
        const decoder = new DecoderClass();
        const byteOutput = imageInfo.bitsAllocated <= 8 ? 1 : 2;
        const decompressedData = decoder.decode(
          rawBytes.buffer,
          rawBytes.byteOffset,
          rawBytes.length,
          byteOutput
        );
        if (imageInfo.pixelRepresentation === 1) {
          return imageInfo.bitsAllocated <= 8
            ? new Int8Array(decompressedData.buffer)
            : new Int16Array(decompressedData.buffer);
        }
        return imageInfo.bitsAllocated <= 8
          ? new Uint8Array(decompressedData.buffer)
          : new Uint16Array(decompressedData.buffer);
      } catch (e) {}
    }
  }

  // 6. JPEG Baseline 8-bit & Extended 12-bit
  if (
    ts === TRANSFER_SYNTAX_UIDS.JPEG_BASELINE_8BIT ||
    ts === TRANSFER_SYNTAX_UIDS.JPEG_EXTENDED_12BIT
  ) {
    const libjpeg = await getLibJPEGCodec();
    if (libjpeg && libjpeg.JPEGDecoder) {
      try {
        const decoder = new libjpeg.JPEGDecoder();
        const encBuf = decoder.getEncodedBuffer(rawBytes.length);
        encBuf.set(rawBytes);
        decoder.decode();
        const frameInfo = decoder.getFrameInfo();
        const decodedBufferInWASM = decoder.getDecodedBuffer();
        return createTypedArrayFromBuffer(decodedBufferInWASM, frameInfo, imageInfo);
      } catch (e) {}
    }
  }

  // 7. Fallback to Canvas API / createImageBitmap (for standard 8-bit JPEG frames)
  return await decodeFrameViaCanvasFallback(rawBytes, imageInfo);
}

/**
 * Universal Frame Encoder / Transcoder
 */
export async function encodeDicomFrame(pixelTypedArray, targetTransferSyntax, imageInfo) {
  const ts = String(targetTransferSyntax || "").trim();
  const { rows, cols, bitsAllocated = 8, bitsStored = bitsAllocated, pixelRepresentation = 0, samplesPerPixel = 1 } = imageInfo;
  const isSigned = pixelRepresentation === 1;

  // 1. RLE Lossless (1.2.840.10008.1.2.5)
  if (ts === TRANSFER_SYNTAX_UIDS.RLE_LOSSLESS) {
    try {
      return encodeRLEFrame(pixelTypedArray, imageInfo);
    } catch (e) {}
  }

  // 2. JPEG-LS (1.2.840.10008.1.2.4.80 or .81)
  if (
    ts === TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSLESS ||
    ts === TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSY
  ) {
    const charls = await getCharLSCodec();
    if (charls && charls.JpegLSEncoder) {
      try {
        const encoder = new charls.JpegLSEncoder();
        const frameInfo = {
          width: cols,
          height: rows,
          bitsPerSample: bitsStored,
          componentCount: samplesPerPixel,
          isSigned,
        };
        const decodedBuffer = encoder.getDecodedBuffer(frameInfo);
        const sourceView = new Uint8Array(pixelTypedArray.buffer, pixelTypedArray.byteOffset, pixelTypedArray.byteLength);
        decodedBuffer.set(sourceView);
        encoder.encode();
        const encodedBuffer = encoder.getEncodedBuffer();
        return new Uint8Array(encodedBuffer.buffer, encodedBuffer.byteOffset, encodedBuffer.byteLength);
      } catch (e) {}
    }
  }

  // 3. JPEG 2000 (1.2.840.10008.1.2.4.90 or .91)
  if (
    ts === TRANSFER_SYNTAX_UIDS.JPEG2000_LOSSLESS ||
    ts === TRANSFER_SYNTAX_UIDS.JPEG2000_LOSSY
  ) {
    const openjpeg = await getOpenJPEGCodec();
    if (openjpeg && openjpeg.J2KEncoder) {
      try {
        const encoder = new openjpeg.J2KEncoder();
        const frameInfo = {
          width: cols,
          height: rows,
          bitsPerSample: bitsStored,
          componentCount: samplesPerPixel,
          isSigned,
        };
        const decodedBuffer = encoder.getDecodedBuffer(frameInfo);
        const sourceView = new Uint8Array(pixelTypedArray.buffer, pixelTypedArray.byteOffset, pixelTypedArray.byteLength);
        decodedBuffer.set(sourceView);
        encoder.encode();
        const encodedBuffer = encoder.getEncodedBuffer();
        return new Uint8Array(encodedBuffer.buffer, encodedBuffer.byteOffset, encodedBuffer.byteLength);
      } catch (e) {}
    }
  }

  // 4. HTJ2K (1.2.840.10008.1.2.4.201, .202, .203)
  if (
    ts === TRANSFER_SYNTAX_UIDS.HTJ2K_LOSSLESS ||
    ts === TRANSFER_SYNTAX_UIDS.HTJ2K_LOSSLESS_RPCL ||
    ts === TRANSFER_SYNTAX_UIDS.HTJ2K_LOSSY
  ) {
    const openjph = await getOpenJPHCodec();
    if (openjph && openjph.HTJ2KEncoder) {
      try {
        const encoder = new openjph.HTJ2KEncoder();
        const frameInfo = {
          width: cols,
          height: rows,
          bitsPerSample: bitsStored,
          componentCount: samplesPerPixel,
          isSigned,
          isUsingColorTransform: false,
        };
        const decodedBuffer = encoder.getDecodedBuffer(frameInfo);
        const sourceView = new Uint8Array(pixelTypedArray.buffer, pixelTypedArray.byteOffset, pixelTypedArray.byteLength);
        decodedBuffer.set(sourceView);
        encoder.encode();
        const encodedBuffer = encoder.getEncodedBuffer();
        return new Uint8Array(encodedBuffer.buffer, encodedBuffer.byteOffset, encodedBuffer.byteLength);
      } catch (e) {}
    }
  }

  // Never substitute a different codec while retaining the requested transfer
  // syntax. The caller may explicitly transcode to an uncompressed syntax.
  return null;
}

/**
 * Encapsulate Array of Frame Byte Buffers into DICOM Encapsulated Pixel Sequence (7FE0,0010)
 */
export function encapsulateFrameBuffers(frameBuffers) {
  const result = [new ArrayBuffer(0)]; // Item 0: Basic Offset Table (BOT)
  for (const buf of frameBuffers) {
    const arrayBuffer = ArrayBuffer.isView(buf)
      ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      : buf;
    result.push(arrayBuffer);
  }
  return result;
}

function createTypedArrayFromBuffer(decodedWasmBuffer, frameInfo, imageInfo) {
  const { bitsPerSample, isSigned } = frameInfo;
  const signed = isSigned !== undefined ? isSigned : (imageInfo.pixelRepresentation === 1);
  const bits = bitsPerSample || imageInfo.bitsAllocated;

  const ab = decodedWasmBuffer.buffer.slice(
    decodedWasmBuffer.byteOffset,
    decodedWasmBuffer.byteOffset + decodedWasmBuffer.byteLength
  );

  if (bits > 8) {
    return signed ? new Int16Array(ab) : new Uint16Array(ab);
  }
  return signed ? new Int8Array(ab) : new Uint8Array(ab);
}

async function decodeFrameViaCanvasFallback(rawBytes, imageInfo) {
  if (typeof createImageBitmap !== "function" || typeof Blob === "undefined") {
    return null;
  }
  try {
    const blob = new Blob([rawBytes], { type: "image/jpeg" });
    const bitmap = await createImageBitmap(blob);
    let canvas;
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(imageInfo.cols, imageInfo.rows);
    } else if (typeof document !== "undefined") {
      canvas = document.createElement("canvas");
      canvas.width = imageInfo.cols;
      canvas.height = imageInfo.rows;
    } else {
      return null;
    }
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, imageInfo.cols, imageInfo.rows);
    const imgData = ctx.getImageData(0, 0, imageInfo.cols, imageInfo.rows);
    const { data } = imgData;

    const frameElements = imageInfo.cols * imageInfo.rows;
    const samples = imageInfo.samplesPerPixel || 1;
    const target = imageInfo.bitsAllocated === 8
      ? (imageInfo.pixelRepresentation === 1 ? new Int8Array(frameElements * samples) : new Uint8Array(frameElements * samples))
      : (imageInfo.pixelRepresentation === 1 ? new Int16Array(frameElements * samples) : new Uint16Array(frameElements * samples));

    for (let i = 0; i < frameElements; i++) {
      if (samples === 1) {
        let gray = Math.round((data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000);
        if (imageInfo.photometric === "MONOCHROME1") gray = 255 - gray;
        target[i] = gray;
      } else {
        target[i * 3] = data[i * 4];
        target[i * 3 + 1] = data[i * 4 + 1];
        target[i * 3 + 2] = data[i * 4 + 2];
      }
    }
    return target;
  } catch (e) {
    return null;
  }
}
