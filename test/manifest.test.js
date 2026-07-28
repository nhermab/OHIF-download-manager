/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import {
  buildManifest,
  normalizeDownloadUrl,
  removeFrameParameter,
  validateManifestSelection,
} from '../src/downloader/manifest';
import { validateSopInstanceUid } from '../src/utils/pathUtils';

describe('download URL normalization', () => {
  it.each([
    ['wadouri:https://example.test/object', 'https://example.test/object'],
    ['dicomweb:https://example.test/object', 'https://example.test/object'],
    ['wadors:https://example.test/object/frames/1', 'https://example.test/object'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeDownloadUrl(input)).toBe(expected);
  });

  it('removes WADO-URI frame parameters', () => {
    expect(removeFrameParameter('https://example.test/object?frame=2&token=x')).toBe(
      'https://example.test/object?token=x'
    );
  });

  it.each(['1.02.3', '1..2', '.1.2', '1.2.', '1.2.a', '1.' + '2'.repeat(63)])(
    'rejects malformed DICOM UID %s',
    uid => {
      expect(validateSopInstanceUid(uid)).toBeNull();
    }
  );

  it('uses non-identifying output paths', () => {
    const manifest = buildManifest([
      {
        studyIndex: 0,
        seriesIndex: 0,
        study: {
          StudyInstanceUID: '1.2.3',
          PatientID: 'PATIENT-123',
          PatientName: 'Doe^Jane',
          AccessionNumber: 'ACCESSION-123',
        },
        series: {
          SeriesInstanceUID: '1.2.3.4',
          SeriesDescription: 'Sensitive description',
          instances: [
            {
              url: 'https://example.test/instances/1',
              metadata: {
                SOPInstanceUID: '1.2.3.4.5',
                StudyInstanceUID: '1.2.3',
                SeriesInstanceUID: '1.2.3.4',
              },
            },
          ],
        },
      },
    ]);

    expect(manifest).toHaveLength(1);
    expect(`${manifest[0].patientDir}/${manifest[0].studyDir}/${manifest[0].seriesDir}`).not.toMatch(
      /PATIENT-123|Doe|ACCESSION-123|Sensitive description/i
    );
  });

  it('reports missing sources and required UIDs before export', () => {
    const errors = validateManifestSelection([
      {
        study: { StudyInstanceUID: 'invalid' },
        series: {
          SeriesInstanceUID: '1.2.3.4',
          instances: [{ metadata: { SOPInstanceUID: '1.2.3.4.5' } }],
        },
      },
    ]);

    expect(errors).toContain('Instance 1 has no downloadable source.');
    expect(errors).not.toContain('Instance 1 has an invalid or missing Study Instance UID.');

    const withSource = validateManifestSelection([
      {
        study: { StudyInstanceUID: 'invalid' },
        series: {
          SeriesInstanceUID: '1.2.3.4',
          instances: [{ url: 'https://example.test/instance', metadata: { SOPInstanceUID: '1.2.3.4.5' } }],
        },
      },
    ]);
    expect(withSource).toContain('Instance 1 has an invalid or missing Study Instance UID.');
  });
});
