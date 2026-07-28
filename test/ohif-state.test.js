/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import {
  authorizationHeaders,
  buildPayloadFromOhif,
  instanceDownloadFile,
  instanceDownloadUrl,
  setOhifServices,
} from '../src/downloader/ohifState';

describe('OHIF download manager integration', () => {
  it('builds a download payload from active display sets', () => {
    const instance = {
      StudyInstanceUID: '1.2.3',
      SeriesInstanceUID: '1.2.3.4',
      SOPInstanceUID: '1.2.3.4.5',
      PatientID: 'PATIENT-1',
      imageId:
        'wadors:https://example.test/studies/1.2.3/series/1.2.3.4/instances/1.2.3.4.5/frames/1',
    };

    setOhifServices({
      services: {
        displaySetService: {
          getActiveDisplaySets: () => [{ instances: [instance] }],
        },
      },
    });

    const payload = buildPayloadFromOhif();

    expect(payload.studies).toHaveLength(1);
    expect(payload.studies[0].series[0].instances[0]).toEqual({
      url: instance.imageId,
      metadata: instance,
    });
  });

  it('uses OHIF authentication headers for downloads', () => {
    setOhifServices({
      services: {
        displaySetService: null,
        userAuthenticationService: {
          getAuthorizationHeader: () => ({ Authorization: 'Bearer token' }),
        },
      },
    });

    expect(authorizationHeaders()).toEqual({ Authorization: 'Bearer token' });
  });

  it('resolves the common OHIF instance URL fields', () => {
    setOhifServices({ services: {} });
    expect(instanceDownloadUrl({ url: 'url' })).toBe('url');
    expect(instanceDownloadUrl({ imageId: 'image-id' })).toBe('image-id');
    expect(instanceDownloadUrl({ wadouri: 'wado-uri' })).toBe('wado-uri');
    expect(instanceDownloadUrl(null)).toBe('');
  });

  it('uses the active OHIF WADO-URI endpoint to download original DICOM files', () => {
    const instance = {
      StudyInstanceUID: '1.2.3',
      SeriesInstanceUID: '1.2.3.4',
      SOPInstanceUID: '1.2.3.4.5',
      imageId: 'wadors:https://viewer.example/frames/1',
    };
    setOhifServices(
      { services: {} },
      {
        getActiveDataSourceOrNull: () => ({
          getConfig: () => ({ wadoUriRoot: 'https://pacs.example/wado' }),
        }),
      }
    );

    expect(instanceDownloadUrl(instance)).toBe(
      'https://pacs.example/wado?requestType=WADO&studyUID=1.2.3&seriesUID=1.2.3.4&objectUID=1.2.3.4.5&contentType=application%2Fdicom&transferSyntax=*'
    );
  });

  it('keeps WADO-RS frame URLs for static WADO reconstruction', () => {
    const instance = {
      StudyInstanceUID: '1.2.3',
      SeriesInstanceUID: '1.2.3.4',
      SOPInstanceUID: '1.2.3.4.5',
      imageId: 'wadors:https://viewer.example/frames/1',
    };
    setOhifServices(
      { services: {} },
      {
        getActiveDataSourceOrNull: () => ({
          getConfig: () => ({ staticWado: true }),
        }),
      }
    );

    expect(instanceDownloadUrl(instance)).toBe(instance.imageId);
  });

  it('uses the original local file instead of fetching its dicomfile image ID', () => {
    const localFile = new Blob(['local DICOM'], { type: 'application/dicom' });
    localFile.arrayBuffer = () => Promise.resolve(new ArrayBuffer(0));
    const instance = {
      StudyInstanceUID: '1.2.3',
      SeriesInstanceUID: '1.2.3.4',
      SOPInstanceUID: '1.2.3.4.5',
      url: 'dicomfile:0',
      localFile,
    };
    setOhifServices({
      services: {
        displaySetService: {
          getActiveDisplaySets: () => [{ instances: [instance] }],
        },
      },
    });

    const payload = buildPayloadFromOhif();
    expect(instanceDownloadFile(instance)).toBe(localFile);
    expect(instanceDownloadUrl(instance)).toBe('');
    expect(payload.studies[0].series[0].instances[0]).toEqual({
      url: '',
      file: localFile,
      metadata: instance,
    });
  });
});
