/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import dcmjs from 'dcmjs';
import { TextDecoder, TextEncoder } from 'util';
import {
  extractMultipart,
  extractMultipartPayload,
  frameUrl,
  instanceUrl,
  reconstructDicomFromMetadata,
  reconstructStaticDicom,
  reconstructDicomFromFrames,
  usesFrameRetrieval,
} from '../src/dicom/staticDicomReconstruction';

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

  it('detects JPEG-LS from multipart and single-part content types', () => {
    const multipart = new TextEncoder().encode(
      '--boundary\r\nContent-Type: image/jls\r\n\r\nabc\r\n--boundary--\r\n'
    );
    const extracted = extractMultipart(multipart.buffer, 'multipart/related');
    expect(new TextDecoder().decode(extracted.buffer)).toBe('abc');
    expect(extracted.transferSyntax).toBe('1.2.840.10008.1.2.4.80');

    const singlePart = new Uint8Array([0xff, 0xd8, 0xff, 0xf7]).buffer;
    expect(extractMultipart(singlePart, 'image/jls').transferSyntax).toBe('1.2.840.10008.1.2.4.80');
  });

  it('preserves backslash-delimited multi-value metadata from static DICOM JSON', async () => {
    const metadata = {
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.128',
      SOPInstanceUID: '2.25.128',
      Rows: 1,
      Columns: 2,
      BitsAllocated: 8,
      CorrectedImage: 'DECY\\ATTN\\SCAT\\DTIM\\RANSNG\\DCAL\\SLSENS\\NORM',
    };
    const blob = reconstructDicomFromFrames(metadata, [new Uint8Array([10, 20]).buffer]);
    const dicom = dcmjs.data.DicomMessage.readFile(await readBlob(blob));
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicom.dict);

    expect(dataset.CorrectedImage).toEqual([
      'DECY',
      'ATTN',
      'SCAT',
      'DTIM',
      'RANSNG',
      'DCAL',
      'SLSENS',
      'NORM',
    ]);
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
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.objectContaining({
          Accept: expect.stringContaining('type="image/jls"'),
        }),
      })
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

  it('reconstructs an RTSTRUCT from metadata when the static Part 10 object is absent', async () => {
    const originalFetch = global.fetch;
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });
    const metadata = {
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.481.3',
      SOPInstanceUID: '2.25.4813',
      StudyInstanceUID: '2.25.1',
      SeriesInstanceUID: '2.25.2',
      Modality: 'RTSTRUCT',
      AvailableTransferSyntaxUID: '1.2.840.10008.1.2.4.80',
      _vrMap: {
        AvailableTransferSyntaxUID: 'UN',
      },
      ROIContourSequence: [
        {
          ContourSequence: [
            {
              ContourGeometricType: 'CLOSED_PLANAR',
              NumberOfContourPoints: 1,
              ContourData: { InlineBinary: 'MVwyXDMg' },
              _vrMap: {
                ContourData: 'UN',
              },
            },
          ],
          37733005: {
            BulkDataURI: 'bulkdata/unavailable-private-value',
          },
        },
      ],
    };

    const blob = await reconstructStaticDicom(
      {
        url: 'wadors:https://example.test/studies/2.25.1/series/2.25.2/instances/2.25.4813/frames/1',
        metadata,
      },
      {},
      new AbortController().signal
    );
    const rawDicom = await readBlob(blob);
    const rawBytes = new Uint8Array(rawDicom);
    const contourOffset = findByteSequence(rawBytes, [0x06, 0x30, 0x50, 0x00]);
    const encodedContourVr = String.fromCharCode(
      rawBytes[contourOffset + 4],
      rawBytes[contourOffset + 5]
    );
    const dicom = dcmjs.data.DicomMessage.readFile(rawDicom);
    const contourItem = dicom.dict['30060039'].Value[0]['30060040'].Value[0]['30060050'];

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(dicom.meta['00020010'].Value[0]).toBe('1.2.840.10008.1.2.1');
    expect(dicom.dict['00083002']).toMatchObject({
      vr: 'UI',
      Value: ['1.2.840.10008.1.2.4.80'],
    });
    expect(dicom.dict['7FE00010']).toBeUndefined();
    expect(encodedContourVr).toBe('UN');
    expect(contourItem.Value).toEqual([1, 2, 3]);
    expect(dicom.dict['30060039'].Value[0]['37733005']).toBeUndefined();

    global.fetch = originalFetch;
    debug.mockRestore();
  });

  it('fails metadata-only reconstruction when required standard bulk data is unavailable', () => {
    expect(() =>
      reconstructDicomFromMetadata({
        SOPClassUID: '1.2.840.10008.5.1.4.1.1.104.1',
        SOPInstanceUID: '2.25.1041',
        EncapsulatedDocument: {
          BulkDataURI: 'bulkdata/unavailable-document',
        },
      })
    ).toThrow('unavailable standard BulkData for EncapsulatedDocument');
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
    const blob = reconstructDicomFromFrames(
      metadata,
      [frameBytes.buffer],
      '1.2.840.10008.1.2.4.50'
    );
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
    const blobRle = reconstructDicomFromFrames(
      metadata,
      [new Uint8Array([99]).buffer],
      '1.2.840.10008.1.2.5'
    );
    const dicomRle = dcmjs.data.DicomMessage.readFile(await readBlob(blobRle));
    const fileMetaRle = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomRle.meta);
    expect(fileMetaRle.TransferSyntaxUID).toBe('1.2.840.10008.1.2.5');

    const blobJpegls = reconstructDicomFromFrames(
      metadata,
      [new Uint8Array([99]).buffer],
      '1.2.840.10008.1.2.4.81'
    );
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
    const dicomJpeglsLossless = dcmjs.data.DicomMessage.readFile(
      await readBlob(blobJpeglsLossless)
    );
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

  it('resolves context dependent value representations without degrading them to UN', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const metadata = {
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.7',
      SOPInstanceUID: '2.25.123',
      Rows: 1,
      Columns: 2,
      SamplesPerPixel: 1,
      PhotometricInterpretation: 'MONOCHROME2',
      BitsAllocated: 16,
      BitsStored: 16,
      HighBit: 15,
      PixelRepresentation: 1,
      SmallestImagePixelValue: -1024,
      PixelPaddingValue: -2000,
      ModalityLUTSequence: [
        {
          LUTDescriptor: [4, -1024, 16],
          LUTData: [{ InlineBinary: 'AAECAw==' }],
          _vrMap: { LUTDescriptor: 'US|SS', LUTData: 'US|OW' },
        },
      ],
      _vrMap: { SmallestImagePixelValue: 'US|SS', PixelPaddingValue: 'US|SS' },
    };
    const blob = reconstructDicomFromFrames(metadata, [new Uint8Array([10, 20, 30, 40]).buffer]);
    const dicom = dcmjs.data.DicomMessage.readFile(await readBlob(blob));

    expect(error).not.toHaveBeenCalled();
    expect(dicom.dict['00280106'].vr).toBe('SS');
    expect(dicom.dict['00280106'].Value).toEqual([-1024]);
    expect(dicom.dict['00280120'].vr).toBe('SS');
    expect(dicom.dict['00280120'].Value).toEqual([-2000]);
    const lutItem = dicom.dict['00283000'].Value[0];
    expect(lutItem['00283002'].vr).toBe('SS');
    expect(lutItem['00283002'].Value).toEqual([4, -1024, 16]);
    expect(lutItem['00283006'].vr).toBe('OW');
    expect(metadata._vrMap.SmallestImagePixelValue).toBe('US|SS');
    expect(metadata.ModalityLUTSequence[0]._vrMap.LUTData).toBe('US|OW');

    error.mockRestore();
  });

  it('keeps private tags without a dictionary entry instead of warning about them', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
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
      '00090010': 'dedupped',
      '00091010': ['d4458c12', 'b5285639'],
      '00091012': 'instance',
      imageId: 'wadors:https://example.test/instances/3/frames/1',
      wadoRoot: 'https://example.test',
    };
    const blob = reconstructDicomFromFrames(metadata, [new Uint8Array([10, 20]).buffer]);
    const dicom = dcmjs.data.DicomMessage.readFile(await readBlob(blob));

    expect(warn).not.toHaveBeenCalled();
    expect(dicom.dict['00090010'].vr).toBe('LO');
    expect(dicom.dict['00090010'].Value).toEqual(['dedupped']);
    expect(dicom.dict['00091012'].vr).toBe('UN');
    expect(new TextDecoder().decode(dicom.dict['00091012'].Value[0])).toBe('instance');
    expect(new TextDecoder().decode(dicom.dict['00091010'].Value[0])).toBe('d4458c12\\b5285639 ');
    expect(dicom.dict['0009103A']).toBeUndefined();

    warn.mockRestore();
  });

  it('drops private values whose binary representation cannot be recovered', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const metadata = {
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.7',
      SOPInstanceUID: '2.25.123',
      Rows: 1,
      Columns: 2,
      BitsAllocated: 8,
      '00191001': 4096,
      '00191002': { BulkDataURI: 'https://example.test/bulk/1' },
    };
    const blob = reconstructDicomFromFrames(metadata, [new Uint8Array([10, 20]).buffer]);
    const dicom = dcmjs.data.DicomMessage.readFile(await readBlob(blob));

    expect(warn).not.toHaveBeenCalled();
    expect(dicom.dict['00191001']).toBeUndefined();
    expect(dicom.dict['00191002']).toBeUndefined();
    const messages = debug.mock.calls.map(call => call.join(' '));
    expect(messages.filter(message => message.includes('00191001'))).toHaveLength(1);
    expect(messages.filter(message => message.includes('00191002'))).toHaveLength(1);

    debug.mockClear();
    reconstructDicomFromFrames(metadata, [new Uint8Array([10, 20]).buffer]);
    expect(debug).not.toHaveBeenCalled();

    warn.mockRestore();
    debug.mockRestore();
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

function findByteSequence(bytes, sequence) {
  outer: for (let index = 0; index <= bytes.length - sequence.length; index++) {
    for (let offset = 0; offset < sequence.length; offset++) {
      if (bytes[index + offset] !== sequence[offset]) continue outer;
    }
    return index;
  }
  return -1;
}
