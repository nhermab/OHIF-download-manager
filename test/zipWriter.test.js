/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import {
  ChunkedZipWriter,
  OPFSZipBuilder,
  IndexedDBZipBuilder,
  StoredZipBuilder,
  createZipBuilder,
  crc32Blob,
  crc32ArrayBuffer,
  blobToArrayBuffer,
  createLocalZipHeader,
  createCentralZipHeader,
  createEndOfCentralDirectory,
  attachCleanup,
} from '../src/writers/zipWriter.js';

describe('ZipWriter and ZipBuilder suite', () => {
  it('crc32Blob produces correct CRC32 matching crc32ArrayBuffer', async () => {
    const data = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]);
    const blob = new Blob([data]);
    const expectedCrc = crc32ArrayBuffer(data.buffer);
    const blobCrc = await crc32Blob(blob);
    expect(blobCrc).toBe(expectedCrc);
  });

  it('StoredZipBuilder creates valid ZIP binary structures', async () => {
    const builder = new StoredZipBuilder();
    const testBlob = new Blob(['Test content for DICOM image']);
    await builder.add('PATIENT_01/STUDY_01/SERIES_01/image001.dcm', testBlob);
    const resultBlob = await builder.close();

    expect(resultBlob).toBeInstanceOf(Blob);
    const buffer = await blobToArrayBuffer(resultBlob);
    const view = new DataView(buffer);

    expect(view.getUint32(0, true)).toBe(0x04034b50);

    const eocdOffset = buffer.byteLength - 22;
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
  });

  it('OPFSZipBuilder streams chunks to disk when OPFS is available', async () => {
    const writtenChunks = [];
    let closed = false;
    let tempRemoved = false;

    const mockWritable = {
      write: jest.fn(async chunk => {
        writtenChunks.push(chunk);
      }),
      close: jest.fn(async () => {
        closed = true;
      }),
      abort: jest.fn(async () => {}),
    };

    const mockFileHandle = {
      createWritable: jest.fn(async () => mockWritable),
      getFile: jest.fn(async () => new Blob(writtenChunks, { type: 'application/zip' })),
    };

    const mockRoot = {
      getFileHandle: jest.fn(async (name, opts) => mockFileHandle),
      removeEntry: jest.fn(async name => {
        tempRemoved = true;
      }),
    };

    const originalStorage = window.navigator.storage;
    try {
      Object.defineProperty(window.navigator, 'storage', {
        value: {
          getDirectory: jest.fn(async () => mockRoot),
        },
        configurable: true,
        writable: true,
      });

      const builder = new OPFSZipBuilder();
      const testBlob = new Blob(['Mock DICOM Frame Bytes']);
      await builder.add('STUDY1/SERIES1/instance1.dcm', testBlob);
      const outputBlob = await builder.close();

      expect(mockRoot.getFileHandle).toHaveBeenCalled();
      expect(mockWritable.write).toHaveBeenCalled();
      expect(closed).toBe(true);
      expect(outputBlob).toBeDefined();

      if (typeof outputBlob._cleanup === 'function') {
        outputBlob._cleanup();
      }
      expect(tempRemoved).toBe(true);
    } finally {
      if (originalStorage) {
        Object.defineProperty(window.navigator, 'storage', {
          value: originalStorage,
          configurable: true,
          writable: true,
        });
      } else {
        delete window.navigator.storage;
      }
    }
  });

  it('IndexedDBZipBuilder stores chunks when IndexedDB is supported', async () => {
    const storedItems = [];
    let dbClosed = false;
    let dbDeleted = false;

    const mockStore = {
      add: jest.fn(chunk => {
        storedItems.push(chunk);
        const req = { onsuccess: null, onerror: null };
        setTimeout(() => {
          if (req.onsuccess) req.onsuccess();
        }, 0);
        return req;
      }),
      getAll: jest.fn(() => {
        const req = { result: storedItems, onsuccess: null, onerror: null };
        setTimeout(() => {
          if (req.onsuccess) req.onsuccess();
        }, 0);
        return req;
      }),
    };

    const mockTx = {
      objectStore: jest.fn(() => mockStore),
    };

    const mockDb = {
      transaction: jest.fn(() => mockTx),
      close: jest.fn(() => {
        dbClosed = true;
      }),
    };

    const mockIndexedDB = {
      open: jest.fn((name, ver) => {
        const req = { result: mockDb, onupgradeneeded: null, onsuccess: null, onerror: null };
        setTimeout(() => {
          if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
      }),
      deleteDatabase: jest.fn(name => {
        dbDeleted = true;
      }),
    };

    const originalIndexedDB = window.indexedDB;
    try {
      window.indexedDB = mockIndexedDB;

      const builder = new IndexedDBZipBuilder();
      const testBlob = new Blob(['IndexedDB DICOM Data']);
      await builder.add('PATIENT_02/STUDY_02/img.dcm', testBlob);
      const outputBlob = await builder.close();

      expect(mockIndexedDB.open).toHaveBeenCalled();
      expect(storedItems.length).toBeGreaterThan(0);
      expect(outputBlob).toBeInstanceOf(Blob);

      if (typeof outputBlob._cleanup === 'function') {
        outputBlob._cleanup();
      }
      expect(dbDeleted).toBe(true);
    } finally {
      window.indexedDB = originalIndexedDB;
    }
  });

  it('createZipBuilder falls back gracefully depending on environment support', async () => {
    const builder = await createZipBuilder();
    expect(builder).toBeInstanceOf(StoredZipBuilder);
  });

  it('ChunkedZipWriter handles adding items and finalizing', async () => {
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = jest.fn();

    try {
      const writer = new ChunkedZipWriter('Test_Exam', 100 * 1024 * 1024, 1000);
      const item = {
        patientDir: 'PATIENT_100',
        studyDir: 'STUDY_100',
        seriesDir: 'SERIES_100',
        sopUid: '1.2.3.4.5',
        extension: 'dcm',
      };
      const blob = new Blob(['Dummy file data']);

      await writer.write(item, blob);
      expect(writer.currentEntries).toBe(1);
      expect(writer.currentBytes).toBe(blob.size);

      const finalizeResult = await writer.finalize();
      expect(finalizeResult).toBeNull();
      expect(URL.createObjectURL).toHaveBeenCalled();
    } finally {
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });
});
