/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import dcmjs from 'dcmjs';
import { TextDecoder, TextEncoder } from 'util';
import { webcrypto } from 'crypto';
import { anonymizeDicom, resetAnonymizationSession, getMappedUid } from './anonymizer';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto = webcrypto;
}

function createDummyDicomBuffer(customTags = {}) {
  const dict = {
    '00100010': { vr: 'PN', Value: [{ Alphabetic: 'DOE^JOHN' }] },
    '00100020': { vr: 'LO', Value: ['PAT12345'] },
    '00100030': { vr: 'DA', Value: ['19800101'] },
    '00080050': { vr: 'SH', Value: ['ACC9876'] },
    '0020000D': { vr: 'UI', Value: ['1.2.840.113619.2.1.1.12345678'] },
    '0020000E': { vr: 'UI', Value: ['1.2.840.113619.2.1.2.12345678'] },
    '00080018': { vr: 'UI', Value: ['1.2.840.113619.2.1.3.12345678'] },
    '00080016': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.7'] },
    ...customTags,
  };
  const meta = {
    '00020002': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.7'] },
    '00020003': { vr: 'UI', Value: ['1.2.840.113619.2.1.3.12345678'] },
    '00020010': { vr: 'UI', Value: ['1.2.840.10008.1.2.1'] },
  };
  const dicomDict = new dcmjs.data.DicomDict(meta);
  dicomDict.dict = dict;
  return dicomDict.write();
}

describe('DICOM Anonymizer & Provenance Attributes (TASK-04)', () => {
  beforeEach(() => {
    resetAnonymizationSession();
  });

  it('omits de-identification provenance when pixel cleanliness is unverified', async () => {
    const buffer = createDummyDicomBuffer();
    const anonymizedBuffer = await anonymizeDicom(buffer, {
      enablePixelRedaction: false, // disable pixel redaction for fast metadata test
    });

    const dicomDict = dcmjs.data.DicomMessage.readFile(anonymizedBuffer);
    const dataset = dicomDict.dict;

    expect(dataset['00120062']).toBeUndefined();
    expect(dataset['00120063']).toBeUndefined();
    expect(dataset['00120064']).toBeUndefined();
  });

  it('populates ContributingEquipmentSequence (0018,A001) when addContributingEquipment is true', async () => {
    const buffer = createDummyDicomBuffer();
    const anonymizedBuffer = await anonymizeDicom(buffer, {
      addContributingEquipment: true,
      enablePixelRedaction: false,
    });

    const dicomDict = dcmjs.data.DicomMessage.readFile(anonymizedBuffer);
    const dataset = dicomDict.dict;

    expect(dataset['0018A001']).toBeDefined();
    expect(dataset['0018A001'].vr).toBe('SQ');
    const equipmentItems = dataset['0018A001'].Value;
    expect(equipmentItems.length).toBeGreaterThan(0);

    const item = equipmentItems[0];
    expect(item['00080070']?.Value?.[0]).toBe('OHIF');
    expect(item['00081090']?.Value?.[0]).toBe('Download Manager Client-Side Anonymizer');
    expect(item['0018A003']?.Value?.[0]).toBe('De-identified in-browser prior to download');
  });

  it('does not emit option provenance as a de-identification claim when unverified', async () => {
    const buffer = createDummyDicomBuffer();
    const anonymizedBuffer = await anonymizeDicom(buffer, {
      keepDescriptors: true,
      keepPatientCharacteristics: true,
      aggregateAgesOver89: true,
      keepDeviceIdentity: true,
      keepInstitutionIdentity: true,
      keepSafePrivate: true,
      enablePixelRedaction: false,
    });

    const dicomDict = dcmjs.data.DicomMessage.readFile(anonymizedBuffer);
    const dataset = dicomDict.dict;
    expect(dataset['00120062']).toBeUndefined();
    expect(dataset['00120063']).toBeUndefined();
    expect(dataset['00120064']).toBeUndefined();
  });

  it('correctly replaces PatientName and PatientID with defaults or user specified values', async () => {
    const buffer = createDummyDicomBuffer();
    const anonymizedBuffer = await anonymizeDicom(buffer, {
      newPatientName: 'ANON^PATIENT',
      newPatientId: 'SAFE1234',
      enablePixelRedaction: false,
    });

    const dicomDict = dcmjs.data.DicomMessage.readFile(anonymizedBuffer);
    const natural = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);

    expect(natural.PatientName[0].Alphabetic).toBe('ANON^PATIENT');
    expect(natural.PatientID).toBe('SAFE1234');
  });

  it('rejects encapsulated documents when rejectEncapsulatedDocuments is true', async () => {
    // 0042,0011 Encapsulated Document
    const buffer = createDummyDicomBuffer({
      '00420011': { vr: 'OB', Value: [new Uint8Array([1, 2, 3, 4]).buffer] },
    });

    await expect(
      anonymizeDicom(buffer, {
        rejectEncapsulatedDocuments: true,
        enablePixelRedaction: false,
      })
    ).rejects.toThrow('Encapsulated document rejected');
  });
});
