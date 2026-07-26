/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import dcmjs from 'dcmjs';
import { TextDecoder, TextEncoder } from 'util';
import {
  extractMultipartPayload,
  frameUrl,
  instanceUrl,
  reconstructStaticDicom,
  reconstructDicomFromFrames,
  usesFrameRetrieval,
} from './static-dicom-reconstruction';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

describe('static DICOMweb reconstruction', () => {
  it('rebuilds a Part 10 DICOM file from metadata and uncompressed frame data', async () => {
    const metadata = {
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.7',
      SOPInstanceUID: '2.25.123',
      Rows: 1,
      Columns: 2,
      SamplesPerPixel: 1,
      PhotometricInterpretation: 'MONOCHROME2',
      BitsAllocated: 8,
      BitsStored: 8,
      HighBit: 7,
      PixelRepresentation: 0,
    };
    const blob = reconstructDicomFromFrames(metadata, [new Uint8Array([10, 20]).buffer]);
    const dicom = dcmjs.data.DicomMessage.readFile(await readBlob(blob));
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicom.dict);

    expect(dataset.PixelData[0]).toEqual(new Uint8Array([10, 20]).buffer);
  });

  it('extracts a frame payload from a multipart response and addresses each frame', () => {
    const multipart = new TextEncoder().encode(
      '--boundary\r\nContent-Type: application/octet-stream\r\n\r\nabc\r\n--boundary--\r\n'
    );
    expect(new TextDecoder().decode(extractMultipartPayload(multipart.buffer))).toBe('abc');
    expect(frameUrl('wadors:https://example.test/instances/1/frames/1', 2)).toBe(
      'https://example.test/instances/1/frames/2'
    );
    expect(instanceUrl('wadors:https://example.test/instances/1/frames/1')).toBe(
      'https://example.test/instances/1'
    );
  });

  it('uses same-origin credentials for cross-origin static frame retrieval', async () => {
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([10, 20]).buffer),
    });
    global.fetch = fetchSpy;
    await reconstructStaticDicom(
      {
        url: 'wadors:https://example.test/studies/1/series/2/instances/3/frames/1',
        metadata: {
          SOPClassUID: '1.2.840.10008.5.1.4.1.1.7',
          SOPInstanceUID: '2.25.123',
          Rows: 1,
          Columns: 2,
          SamplesPerPixel: 1,
          PhotometricInterpretation: 'MONOCHROME2',
          BitsAllocated: 8,
          BitsStored: 8,
          HighBit: 7,
          PixelRepresentation: 0,
        },
      },
      {},
      new AbortController().signal
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.test/studies/1/series/2/instances/3/frames/1',
      expect.objectContaining({ credentials: 'same-origin' })
    );
    global.fetch = originalFetch;
  });

  it('uses the unframed instance URL for non-image SOP classes without retrying', async () => {
    const originalFetch = global.fetch;
    const part10 = new Uint8Array(132);
    part10.set([68, 73, 67, 77], 128);
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(part10.buffer),
    });
    global.fetch = fetchSpy;
    const metadata = {
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.11',
      SOPInstanceUID: '2.25.123',
    };

    await reconstructStaticDicom(
      { url: 'wadors:https://example.test/instances/3/frames/1', metadata },
      {},
      new AbortController().signal
    );

    expect(usesFrameRetrieval(metadata)).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.test/instances/3',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/dicom,*/*' }),
      })
    );
    global.fetch = originalFetch;
  });

  it('rebuilds a Part 10 DICOM file with JPEG Baseline transfer syntax and empty BOT by default', async () => {
    const metadata = {
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.7',
      SOPInstanceUID: '2.25.123',
      Rows: 1,
      Columns: 2,
      SamplesPerPixel: 1,
      PhotometricInterpretation: 'MONOCHROME2',
      BitsAllocated: 8,
      BitsStored: 8,
      HighBit: 7,
      PixelRepresentation: 0,
    };
    const frameBytes = new Uint8Array([1, 2, 3]);
    const blob = reconstructDicomFromFrames(metadata, [frameBytes.buffer], '1.2.840.10008.1.2.4.50');
    const dicom = dcmjs.data.DicomMessage.readFile(await readBlob(blob));
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicom.dict);
    const fileMeta = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicom.meta);

    expect(fileMeta.TransferSyntaxUID).toBe('1.2.840.10008.1.2.4.50');
    expect(dataset.PixelData.length).toBe(2);
    expect(dataset.PixelData[0].byteLength).toBe(0);
    expect(new Uint8Array(dataset.PixelData[1])).toEqual(new Uint8Array([1, 2, 3, 0]));
  });

  it('rebuilds a Part 10 DICOM file with JPEG 2000 and populated BOT', async () => {
    const metadata = {
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.7',
      SOPInstanceUID: '2.25.123',
      Rows: 1,
      Columns: 2,
      SamplesPerPixel: 1,
      PhotometricInterpretation: 'MONOCHROME2',
      BitsAllocated: 8,
      BitsStored: 8,
      HighBit: 7,
      PixelRepresentation: 0,
      NumberOfFrames: 2,
    };
    const frame1 = new Uint8Array([1, 2]);
    const frame2 = new Uint8Array([3, 4, 5]);
    const blob = reconstructDicomFromFrames(
      metadata,
      [frame1.buffer, frame2.buffer],
      '1.2.840.10008.1.2.4.90',
      { populateBot: true }
    );
    const dicom = dcmjs.data.DicomMessage.readFile(await readBlob(blob));
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicom.dict);
    const fileMeta = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicom.meta);

    expect(fileMeta.TransferSyntaxUID).toBe('1.2.840.10008.1.2.4.90');
    expect(dataset.PixelData.length).toBe(3);
    
    const botView = new DataView(dataset.PixelData[0]);
    expect(botView.getUint32(0, true)).toBe(0);
    expect(botView.getUint32(4, true)).toBe(10);

    expect(new Uint8Array(dataset.PixelData[1])).toEqual(new Uint8Array([1, 2]));
    expect(new Uint8Array(dataset.PixelData[2])).toEqual(new Uint8Array([3, 4, 5, 0]));
  });

  it('verifies support for RLE Lossless and JPEG-LS transfer syntaxes', async () => {
    const metadata = {
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.7',
      SOPInstanceUID: '2.25.123',
      Rows: 1,
      Columns: 2,
      BitsAllocated: 8,
    };
    const blobRle = reconstructDicomFromFrames(metadata, [new Uint8Array([99]).buffer], '1.2.840.10008.1.2.5');
    const dicomRle = dcmjs.data.DicomMessage.readFile(await readBlob(blobRle));
    const fileMetaRle = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomRle.meta);
    expect(fileMetaRle.TransferSyntaxUID).toBe('1.2.840.10008.1.2.5');

    const blobJpegls = reconstructDicomFromFrames(metadata, [new Uint8Array([99]).buffer], '1.2.840.10008.1.2.4.81');
    const dicomJpegls = dcmjs.data.DicomMessage.readFile(await readBlob(blobJpegls));
    const fileMetaJpegls = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomJpegls.meta);
    expect(fileMetaJpegls.TransferSyntaxUID).toBe('1.2.840.10008.1.2.4.81');

    const metadataWithNested = {
      ...metadata,
      RedPaletteColorLookupTableData: [[new Uint8Array([1, 2, 3, 4])]],
      '7FE00010': new Uint8Array([10, 20]),
    };
    const blobJpeglsLossless = reconstructDicomFromFrames(
      metadataWithNested,
      [new Uint8Array([99]).buffer],
      '1.2.840.10008.1.2.4.80'
    );
    const dicomJpeglsLossless = dcmjs.data.DicomMessage.readFile(await readBlob(blobJpeglsLossless));
    const metadataWithInlineBinary = {
      ...metadata,
      ModalityLUTSequence: [
        {
          LUTDescriptor: [{ InlineBinary: 'ABAAABAA' }],
          LUTData: [{ InlineBinary: 'AAAA' }],
        },
      ],
    };
    const blobInline = reconstructDicomFromFrames(
      metadataWithInlineBinary,
      [new Uint8Array([99]).buffer],
      '1.2.840.10008.1.2.4.80'
    );
    const dicomInline = dcmjs.data.DicomMessage.readFile(await readBlob(blobInline));
    expect(dicomInline).toBeDefined();
  });

  it('rejects multi-frame retrieval when inconsistent transfer syntaxes are returned', async () => {
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn();
    
    const multipart1 = new TextEncoder().encode(
      '--boundary\r\nContent-Type: application/octet-stream; transfer-syntax=1.2.840.10008.1.2.4.50\r\n\r\nabc\r\n--boundary--\r\n'
    );
    const multipart2 = new TextEncoder().encode(
      '--boundary\r\nContent-Type: application/octet-stream; transfer-syntax=1.2.840.10008.1.2.4.90\r\n\r\ndef\r\n--boundary--\r\n'
    );
    
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(multipart1.buffer),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(multipart2.buffer),
      });
      
    global.fetch = fetchSpy;

    await expect(
      reconstructStaticDicom(
        {
          url: 'wadors:https://example.test/studies/1/series/2/instances/3/frames/1',
          metadata: {
            SOPClassUID: '1.2.840.10008.5.1.4.1.1.7',
            SOPInstanceUID: '2.25.123',
            Rows: 1,
            Columns: 2,
            BitsAllocated: 8,
            NumberOfFrames: 2,
          },
        },
        {},
        new AbortController().signal
      )
    ).rejects.toThrow('Inconsistent transfer syntax across frames');

    global.fetch = originalFetch;
  });
});

function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
