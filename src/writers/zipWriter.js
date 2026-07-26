/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Streaming ZIP archive writer.
 */

import { fileName } from "../manifest.js";
import { safeName, createNamedError, sanitize } from "../utils.js";
import { triggerBlobDownload } from "../downloader.js";

let crcTableCache = null;

export class ChunkedZipWriter {
  constructor(studyLabel, maxBytes, maxEntries) {
    this.name = "chunked-zip";
    this.studyLabel = safeName(studyLabel || "Medical_Images");
    this.maxBytes = Math.max(1, Number(maxBytes) || 700 * 1024 * 1024);
    this.maxEntries = Math.max(1, Math.min(60000, Number(maxEntries) || 60000));
    this.currentBytes = 0;
    this.currentEntries = 0;
    this.partNumber = 1;
    this.writeLock = Promise.resolve();
    this._initNewZip();
  }

  _initNewZip() {
    this.zipBuilderPromise = createZipBuilder();
    this.currentBytes = 0;
    this.currentEntries = 0;
  }

  write(item, blob) {
    this.writeLock = this.writeLock.then(async () => {
      const wouldExceedBytes = this.currentBytes + blob.size > this.maxBytes && this.currentBytes > 0;
      const wouldExceedEntries = this.currentEntries >= this.maxEntries && this.currentEntries > 0;
      if (wouldExceedBytes || wouldExceedEntries) {
        // Do not emit earlier ZIP parts before all requested instances have
        // succeeded. A partial multipart archive is too easy to mistake for a
        // completed clinical/research dataset.
        throw createNamedError(
          'ZipSizeError',
          'The requested export exceeds the safe single-archive limit; no archive was downloaded.'
        );
      }
      return this._addBlob(item, blob);
    });
    return this.writeLock;
  }

  async _addBlob(item, blob) {
    const patientName = sanitize(item.patientDir, "UNKNOWN_PATIENT");
    const studyName = sanitize(item.studyDir, "UNKNOWN_STUDY");
    const seriesName = sanitize(item.seriesDir, "UNKNOWN_SERIES");
    const fullPath = `${patientName}/${studyName}/${seriesName}/${fileName(item)}`;
    const builder = await this.zipBuilderPromise;
    await builder.add(fullPath, blob);
    this.currentBytes += blob.size;
    this.currentEntries++;
  }

  writeArtifact(name, blob) {
    this.writeLock = this.writeLock.then(async () => {
      if (
        (this.currentBytes + blob.size > this.maxBytes && this.currentBytes > 0) ||
        (this.currentEntries >= this.maxEntries && this.currentEntries > 0)
      ) {
        throw createNamedError('ZipSizeError', 'The verified export manifest exceeds the safe single-archive limit.');
      }
      const builder = await this.zipBuilderPromise;
      await builder.add(safeName(name), blob);
      this.currentBytes += blob.size;
      this.currentEntries++;
    });
    return this.writeLock;
  }

  async _flushCurrentZip() {
    const partName = `${this.studyLabel}_Part${this.partNumber}.zip`;
    const builder = await this.zipBuilderPromise;
    const finalBlob = await builder.close();
    // The browser may read an OPFS/IndexedDB-backed Blob lazily after click().
    // Keep its backing data for this document's lifetime so Firefox can finish.
    triggerBlobDownload(finalBlob, partName);
  }

  async finalize() {
    await this.writeLock;
    if (this.currentBytes > 0) {
      await this._flushCurrentZip();
    }
    return null;
  }

  async abort() {
    try {
      const builder = await this.zipBuilderPromise;
      if (builder && typeof builder.abort === 'function') {
        await builder.abort();
      }
    } catch (ignore) {}
  }
}

export function attachCleanup(blob, cleanupFn) {
  if (blob && typeof cleanupFn === 'function') {
    Object.defineProperty(blob, '_cleanup', {
      value: cleanupFn,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  return blob;
}

export async function createZipBuilder() {
  cleanupOrphanedOpfsFiles().catch(() => {});

  try {
    const opfsBuilder = new OPFSZipBuilder();
    await opfsBuilder.initPromise;
    return opfsBuilder;
  } catch (opfsErr) {
    // OPFS not supported or failed
  }

  try {
    const idbBuilder = new IndexedDBZipBuilder();
    await idbBuilder.initPromise;
    return idbBuilder;
  } catch (idbErr) {
    // IndexedDB not supported or failed
  }

  return new StoredZipBuilder();
}

export class OPFSZipBuilder {
  constructor() {
    this.entries = [];
    this.offset = 0;
    this.tempFileName = `ohif_zip_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`;
    this.root = null;
    this.fileHandle = null;
    this.writable = null;
    this.initPromise = this._init();
  }

  async _init() {
    if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
      throw new Error('OPFS is not supported');
    }
    this.root = await navigator.storage.getDirectory();
    this.fileHandle = await this.root.getFileHandle(this.tempFileName, { create: true });
    if (typeof this.fileHandle.createWritable !== 'function') {
      throw new Error('FileSystemFileHandle.createWritable is not supported');
    }
    this.writable = await this.fileHandle.createWritable();
  }

  async add(path, blob) {
    await this.initPromise;
    if (blob.size > 0xffffffff) {
      throw createNamedError("ZipSizeError", "One file is too large to include in a ZIP download.");
    }
    if (this.entries.length >= 0xffff) {
      throw createNamedError("ZipSizeError", "This ZIP file contains too many files.");
    }
    const nameBytes = utf8Bytes(path);
    const crc32 = await crc32Blob(blob);
    const entry = {
      nameBytes,
      crc32,
      size: blob.size,
      offset: this.offset,
      time: zipDosTime(new Date())
    };
    const header = createLocalZipHeader(entry);

    await this.writable.write(header);
    await this.writable.write(blob);

    this.entries.push(entry);
    this.offset += header.byteLength + blob.size;
  }

  async close() {
    await this.initPromise;
    const centralParts = [];
    let centralSize = 0;
    for (const entry of this.entries) {
      const centralHeader = createCentralZipHeader(entry);
      centralParts.push(centralHeader);
      centralSize += centralHeader.byteLength;
    }
    const endHeader = createEndOfCentralDirectory(this.entries.length, centralSize, this.offset);

    for (const cp of centralParts) {
      await this.writable.write(cp);
    }
    await this.writable.write(endHeader);
    await this.writable.close();
    this.writable = null;

    const zipFile = await this.fileHandle.getFile();
    const root = this.root;
    const tempFileName = this.tempFileName;

    return attachCleanup(zipFile, () => {
      if (root && tempFileName) {
        root.removeEntry(tempFileName).catch(() => {});
      }
    });
  }

  async abort() {
    try {
      if (this.writable) {
        await this.writable.abort().catch(() => {});
        this.writable = null;
      }
      if (this.root && this.tempFileName) {
        await this.root.removeEntry(this.tempFileName).catch(() => {});
      }
    } catch (ignore) {}
  }
}

export class IndexedDBZipBuilder {
  constructor() {
    this.entries = [];
    this.offset = 0;
    this.dbName = `ohif_zip_db_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.db = null;
    this.initPromise = this._init();
  }

  async _init() {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not supported');
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        db.createObjectStore('chunks', { autoIncrement: true });
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      request.onerror = (e) => {
        reject(e.target.error || new Error('Failed to open IndexedDB'));
      };
    });
  }

  async _storeChunk(chunk) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['chunks'], 'readwrite');
      const store = tx.objectStore('chunks');
      const req = store.add(chunk);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async add(path, blob) {
    await this.initPromise;
    if (blob.size > 0xffffffff) {
      throw createNamedError("ZipSizeError", "One file is too large to include in a ZIP download.");
    }
    if (this.entries.length >= 0xffff) {
      throw createNamedError("ZipSizeError", "This ZIP file contains too many files.");
    }
    const nameBytes = utf8Bytes(path);
    const crc32 = await crc32Blob(blob);
    const entry = {
      nameBytes,
      crc32,
      size: blob.size,
      offset: this.offset,
      time: zipDosTime(new Date())
    };
    const header = createLocalZipHeader(entry);

    await this._storeChunk(header);
    await this._storeChunk(blob);

    this.entries.push(entry);
    this.offset += header.byteLength + blob.size;
  }

  async close() {
    await this.initPromise;
    const centralParts = [];
    let centralSize = 0;
    for (const entry of this.entries) {
      const centralHeader = createCentralZipHeader(entry);
      centralParts.push(centralHeader);
      centralSize += centralHeader.byteLength;
    }
    const endHeader = createEndOfCentralDirectory(this.entries.length, centralSize, this.offset);

    for (const cp of centralParts) {
      await this._storeChunk(cp);
    }
    await this._storeChunk(endHeader);

    const chunks = await new Promise((resolve, reject) => {
      const tx = this.db.transaction(['chunks'], 'readonly');
      const store = tx.objectStore('chunks');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });

    this.db.close();
    this.db = null;

    const dbName = this.dbName;
    const cleanUp = () => {
      if (typeof indexedDB !== 'undefined') {
        indexedDB.deleteDatabase(dbName);
      }
    };

    const finalBlob = new Blob(chunks, { type: 'application/zip' });
    return attachCleanup(finalBlob, cleanUp);
  }

  async abort() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    if (typeof indexedDB !== 'undefined' && this.dbName) {
      indexedDB.deleteDatabase(this.dbName);
    }
  }
}

export class StoredZipBuilder {
  constructor() {
    this.entries = [];
    this.parts = [];
    this.offset = 0;
  }

  async add(path, blob) {
    if (blob.size > 0xffffffff) {
      throw createNamedError("ZipSizeError", "One file is too large to include in a ZIP download.");
    }
    if (this.entries.length >= 0xffff) {
      throw createNamedError("ZipSizeError", "This ZIP file contains too many files.");
    }
    const nameBytes = utf8Bytes(path);
    const crc32 = await crc32Blob(blob);
    const entry = {
      nameBytes,
      crc32,
      size: blob.size,
      offset: this.offset,
      time: zipDosTime(new Date())
    };
    const header = createLocalZipHeader(entry);
    this.entries.push(entry);
    this.parts.push(header);
    this.parts.push(blob);
    this.offset += header.byteLength + blob.size;
  }

  async close() {
    const centralParts = [];
    let centralSize = 0;
    for (const entry of this.entries) {
      const centralHeader = createCentralZipHeader(entry);
      centralParts.push(centralHeader);
      centralSize += centralHeader.byteLength;
    }
    const endHeader = createEndOfCentralDirectory(this.entries.length, centralSize, this.offset);
    return new Blob([...this.parts, ...centralParts, endHeader], { type: "application/zip" });
  }

  async abort() {
    this.parts = [];
    this.entries = [];
  }
}

export async function cleanupOrphanedOpfsFiles() {
  try {
    if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') return;
    const root = await navigator.storage.getDirectory();
    if (typeof root.values === 'function') {
      for await (const entry of root.values()) {
        if (entry.kind === 'file' && entry.name.startsWith('ohif_zip_') && entry.name.endsWith('.tmp')) {
          await root.removeEntry(entry.name).catch(() => {});
        }
      }
    } else if (typeof root.keys === 'function') {
      for await (const name of root.keys()) {
        if (name.startsWith('ohif_zip_') && name.endsWith('.tmp')) {
          await root.removeEntry(name).catch(() => {});
        }
      }
    }
  } catch (ignore) {}
}

export async function crc32Blob(blob) {
  const table = crc32Table();
  let crc = 0xffffffff;
  const chunkSize = 2 * 1024 * 1024;
  let offset = 0;
  while (offset < blob.size) {
    const slice = blob.slice(offset, offset + chunkSize);
    const buffer = await blobToArrayBuffer(slice);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
      crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    offset += chunkSize;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function blobToArrayBuffer(blob) {
  if (blob.arrayBuffer) {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || createNamedError("ReadError", "Unable to read downloaded file."));
    reader.readAsArrayBuffer(blob);
  });
}

export function utf8Bytes(value) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }
  const result = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    result[i] = value.charCodeAt(i) & 0xff;
  }
  return result;
}

export function zipDosTime(date) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export function createLocalZipHeader(entry) {
  const header = new Uint8Array(30 + entry.nameBytes.length);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, entry.time.time, true);
  view.setUint16(12, entry.time.date, true);
  view.setUint32(14, entry.crc32, true);
  view.setUint32(18, entry.size, true);
  view.setUint32(22, entry.size, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(entry.nameBytes, 30);
  return header;
}

export function createCentralZipHeader(entry) {
  const header = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, entry.time.time, true);
  view.setUint16(14, entry.time.date, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.offset, true);
  header.set(entry.nameBytes, 46);
  return header;
}

export function createEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return header;
}

export function crc32ArrayBuffer(buffer) {
  const table = crc32Table();
  const bytes = new Uint8Array(buffer);
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Table() {
  if (crcTableCache) {
    return crcTableCache;
  }
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let j = 0; j < 8; j++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  crcTableCache = table;
  return table;
}
