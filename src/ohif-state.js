/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Interface with OHIF state services.
 * Reads study metadata from OHIF DisplaySetService.
 */

import { numericValue } from './utils.js';

let displaySetService;
let userAuthenticationService;
let extensionManager;

export function setOhifServices(servicesManager, manager) {
  displaySetService = servicesManager?.services?.displaySetService || null;
  userAuthenticationService = servicesManager?.services?.userAuthenticationService || null;
  extensionManager = manager || null;
}

export function ohifDisplaySetService() {
  return displaySetService;
}

export function authorizationHeaders() {
  return userAuthenticationService?.getAuthorizationHeader?.() || {};
}

export function getDownloadAvailabilityMessage() {
  return '';
}

export function ohifDisplaySets() {
  const displaySetService = ohifDisplaySetService();
  if (!displaySetService) {
    return [];
  }
  try {
    if (typeof displaySetService.getActiveDisplaySets === 'function') {
      const active = displaySetService.getActiveDisplaySets();
      if (active && active.length > 0) {
        return active;
      }
    }
    if (typeof displaySetService.getDisplaySetCache === 'function') {
      const cache = displaySetService.getDisplaySetCache();
      if (cache && typeof cache.values === 'function') {
        return Array.from(cache.values());
      }
    }
  } catch (ignore) {
    // OHIF still initializing
  }
  return [];
}

export function displaySetInstances(displaySet) {
  if (!displaySet) {
    return [];
  }
  if (Array.isArray(displaySet.instances) && displaySet.instances.length > 0) {
    return displaySet.instances;
  }
  if (Array.isArray(displaySet.images) && displaySet.images.length > 0) {
    return displaySet.images;
  }
  if (displaySet.instance) {
    return [displaySet.instance];
  }
  return [];
}

export function hasOhifStudyData() {
  const displaySets = ohifDisplaySets();
  for (const ds of displaySets) {
    const instances = displaySetInstances(ds);
    for (const inst of instances) {
      if (instanceDownloadFile(inst) || instanceDownloadUrl(inst)) {
        return true;
      }
    }
  }
  return false;
}

export function buildPayloadFromOhif() {
  const displaySets = ohifDisplaySets();
  if (displaySets.length === 0) {
    return null;
  }

  const studies = [];
  const studiesByUid = {};
  const seriesByKey = {};
  const seenInstances = {};

  displaySets.forEach(displaySet => {
    displaySetInstances(displaySet).forEach(instance => {
      const file = instanceDownloadFile(instance);
      const url = instanceDownloadUrl(instance);
      const reconstructFromFrames = isStaticWadoDataSource();
      if (!instance || (!file && !url)) {
        return;
      }

      const studyUid = instance.StudyInstanceUID || displaySet.StudyInstanceUID || '';
      let study = studiesByUid[studyUid];
      if (!study) {
        study = {
          StudyInstanceUID: studyUid,
          StudyDescription: instance.StudyDescription || '',
          StudyDate: instance.StudyDate || '',
          Modalities: instance.Modalities || '',
          PatientID: instance.PatientID || displaySet.PatientID || '',
          PatientName: instance.PatientName || displaySet.PatientName || '',
          series: [],
        };
        studiesByUid[studyUid] = study;
        studies.push(study);
      }

      const seriesUid = instance.SeriesInstanceUID || displaySet.SeriesInstanceUID || '';
      const seriesKey = `${studyUid}|${seriesUid}`;
      let series = seriesByKey[seriesKey];
      if (!series) {
        series = {
          SeriesInstanceUID: seriesUid,
          SeriesNumber: firstDefined(instance.SeriesNumber, displaySet.SeriesNumber),
          SeriesDescription: firstDefined(instance.SeriesDescription, displaySet.SeriesDescription),
          Modality: firstDefined(instance.Modality, displaySet.Modality),
          instances: [],
        };
        seriesByKey[seriesKey] = series;
        study.series.push(series);
      }

      const instanceKey = `${seriesKey}|${instance.SOPInstanceUID || ''}|${url || file?.name || ''}`;
      if (seenInstances[instanceKey]) {
        return;
      }
      seenInstances[instanceKey] = true;
      series.instances.push({
        url,
        ...(file ? { file } : {}),
        ...(reconstructFromFrames ? { reconstructFromFrames: true } : {}),
        metadata: instance,
      });
    });
  });

  studies.forEach(study => {
    study.series.sort(
      (left, right) => numericValue(left.SeriesNumber) - numericValue(right.SeriesNumber)
    );
    if (!study.Modalities) {
      const seen = {};
      study.Modalities = study.series
        .map(series => series.Modality || '')
        .filter(modality => {
          if (!modality || seen[modality]) {
            return false;
          }
          seen[modality] = true;
          return true;
        })
        .join('/');
    }
  });

  return studies.length > 0 ? { studies } : null;
}

export function instanceDownloadUrl(instance) {
  if (!instance) {
    return '';
  }

  const configuration = activeDataSourceConfiguration();
  if (configuration?.staticWado) {
    return instance.url || instance.imageId || instance.wadouri || instance.wadorsuri || '';
  }

  const wadoUriRoot = configuration?.wadoUriRoot || configuration?.wadoUri;
  if (
    wadoUriRoot &&
    instance.StudyInstanceUID &&
    instance.SeriesInstanceUID &&
    instance.SOPInstanceUID
  ) {
    return buildWadoUriDownloadUrl(wadoUriRoot, instance);
  }

  const url = instance.url || instance.imageId || instance.wadouri || instance.wadorsuri || '';
  return url.startsWith('dicomfile:') ? '' : url;
}

export function instanceDownloadFile(instance) {
  const file = instance?.localFile;
  return file && typeof file.arrayBuffer === 'function' ? file : null;
}

export function isStaticWadoDataSource() {
  return Boolean(activeDataSourceConfiguration()?.staticWado);
}

function activeDataSourceConfiguration() {
  const dataSource =
    extensionManager?.getActiveDataSourceOrNull?.() ||
    extensionManager?.getActiveDataSource?.()?.[0];
  return dataSource?.getConfig?.() || null;
}

function buildWadoUriDownloadUrl(wadoUriRoot, instance) {
  const separator = wadoUriRoot.includes('?') ? '&' : '?';
  const params = new URLSearchParams({
    requestType: 'WADO',
    studyUID: instance.StudyInstanceUID,
    seriesUID: instance.SeriesInstanceUID,
    objectUID: instance.SOPInstanceUID,
    contentType: 'application/dicom',
    transferSyntax: '*',
  });
  return `${wadoUriRoot}${separator}${params.toString()}`;
}

function firstDefined(primary, fallback) {
  if (primary !== undefined && primary !== null && primary !== '') {
    return primary;
  }
  return fallback;
}
