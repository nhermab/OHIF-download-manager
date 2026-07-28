/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Application and Extension Constants for Download Manager.
 */

export const PLUGIN_ID = "aquestDownloadManager";

export const OUTPUT_METHODS = {
  FOLDER: "folder",
  ZIP: "zip",
};

export const DEFAULT_ANONYMIZER_CONFIG = {
  patientName: 'ANONYMOUS',
  patientId: 'ANON1234',
  patientBirthDate: '',
  patientSex: '',
  accessionNumber: '',
  studyDescription: '',
  seriesDescription: '',
  remapUids: true,
  keepDates: false,
  keepExactTimes: false,
  keepDescriptors: false,
  keepSeriesDescriptors: false,
  keepProtocol: false,
  keepPhysicians: false,
  keepAcqParams: false,
  keepComments: false,
  keepOverlays: false,
  keepCurves: false,
  keepPatientChar: false,
  aggregateAgesOver89: true,
  roundPatientAgeYears: 0,
  privateTagsPolicy: 'remove_all', // 'remove_all' | 'keep_safe' | 'keep_all'
  tagWhitelist: [],
  srPolicy: 'remove', // 'remove' | 'sanitize'
  keepInstitution: false,
  keepDevice: false,
  rejectEncapsulatedDocuments: false,
  enablePixelRedaction: false,
  forceIgnoreBurnedIn: false,
  multiFrameRedactionMethod: 'ask', // 'ask' | 'aggressive' | 'sampling'
  ocrPerformanceMode: 'balanced', // 'balanced' | 'fast' | 'thorough'
  redactionBorderColor: 'none',
  redactionBorderWidth: 0,
  verboseLogging: false,
};
