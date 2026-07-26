/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Export Manifest Builder & Software Provenance Recorder.
 */

import { MAX_MULTIFRAME_SELECTION_OPTIONS } from './config.js';
import {
  valueOr,
  numericValue,
  firstNonEmpty,
  trimText,
  safeName,
  shortUid,
  padLeft,
  escapeHtml,
  sanitize,
  normalizeDate,
  normalizeSeriesNumber,
  validateSopInstanceUid,
} from './utils.js';

export const MODALITY_DISPLAY_NAMES = {
  CR: 'Computed Radiography',
  CT: 'Computed Tomography',
  DOC: 'Document',
  DX: 'Digital Radiography',
  ECG: 'Electrocardiography',
  ES: 'Endoscopy',
  IO: 'Intra-Oral Radiography',
  MG: 'Mammography',
  MR: 'Magnetic Resonance',
  NM: 'Nuclear Medicine',
  OT: 'Other',
  PR: 'Presentation State',
  PT: 'Positron Emission Tomography',
  PX: 'Panoramic X-Ray',
  RF: 'Radio Fluoroscopy',
  RG: 'Radiographic Imaging',
  RTDOSE: 'Radiotherapy Dose',
  RTIMAGE: 'Radiotherapy Image',
  RTPLAN: 'Radiotherapy Plan',
  RTSTRUCT: 'Radiotherapy Structure Set',
  SC: 'Secondary Capture',
  SEG: 'Segmentation',
  SM: 'Slide Microscopy',
  SR: 'Structured Report',
  US: 'Ultrasound',
  XA: 'X-Ray Angiography',
  XC: 'External-Camera Photography',
};

export function flattenSeries(studies) {
  const result = [];
  studies.forEach((study, studyIndex) => {
    (study.series || []).forEach((series, seriesIndex) => {
      result.push(...selectionEntriesForSeries(study, studyIndex, series, seriesIndex));
    });
  });
  return result;
}

export function selectionEntriesForSeries(study, studyIndex, series, seriesIndex) {
  const seriesEntry = {
    study,
    studyIndex,
    series,
    seriesIndex,
    id: `s-${studyIndex}-${seriesIndex}`,
    selectionType: 'series',
  };
  const groups = multiframeObjectGroups(series);
  if (groups.length <= 1 || groups.length > MAX_MULTIFRAME_SELECTION_OPTIONS) {
    return [seriesEntry];
  }

  const entries = [];
  const nonMultiframeInstances = (series.instances || []).filter(
    instance => !isMultiframeInstance(instance)
  );
  if (nonMultiframeInstances.length > 0) {
    entries.push({
      ...seriesEntry,
      id: `${seriesEntry.id}-single`,
      instances: nonMultiframeInstances,
      selectionType: 'singleframe',
    });
  }

  groups.forEach((group, groupIndex) => {
    entries.push({
      ...seriesEntry,
      id: `${seriesEntry.id}-mf-${groupIndex}`,
      instances: group.instances,
      selectionType: 'multiframe',
      objectUid: group.objectUid,
      frameCount: group.frameCount,
      objectIndex: groupIndex + 1,
    });
  });
  return entries;
}

export function multiframeObjectGroups(series) {
  const groups = [];
  const groupsByKey = {};
  (series.instances || []).forEach((instance, instanceIndex) => {
    if (!isMultiframeInstance(instance)) {
      return;
    }
    const metadata = instance.metadata || {};
    const sourceUrl = normalizeDownloadUrl(instance.url);
    const objectUrl = sourceUrl ? removeFrameParameter(sourceUrl) : '';
    const objectUid = metadata.SOPInstanceUID || uidFromQuery(objectUrl, 'objectUID') || '';
    const keyUid = objectUid || objectUrl || `instance-${instanceIndex}`;
    const key = `${keyUid}|${objectUrl}`;
    let group = groupsByKey[key];
    if (!group) {
      group = {
        objectUid: objectUid || keyUid,
        objectUrl,
        frameCount: 0,
        instances: [],
      };
      groupsByKey[key] = group;
      groups.push(group);
    }
    group.instances.push(instance);
    group.frameCount = Math.max(group.frameCount, numericValue(metadata.NumberOfFrames));
  });
  return groups;
}

export function isMultiframeInstance(instance) {
  const metadata = (instance && instance.metadata) || {};
  const sourceUrl = normalizeDownloadUrl(instance && instance.url);
  return numericValue(metadata.NumberOfFrames) > 1 || hasFrameParameter(sourceUrl);
}

export function modalityCodeForEntry(entry) {
  const series = (entry && entry.series) || {};
  const instances = (entry && (entry.instances || series.instances)) || [];
  const firstMetadata = (instances[0] && instances[0].metadata) || {};
  return String(
    valueOr(
      series.Modality || series.modality || firstMetadata.Modality || firstMetadata.modality,
      'IMG'
    )
  ).toUpperCase();
}

export function modalityDisplayName(code) {
  const normalized = String(code || 'IMG').toUpperCase();
  return MODALITY_DISPLAY_NAMES[normalized] || normalized;
}

export function availableModalities(allSeries) {
  const seen = {};
  const result = [];
  (allSeries || []).forEach(entry => {
    const code = modalityCodeForEntry(entry);
    if (seen[code]) {
      return;
    }
    seen[code] = true;
    result.push({
      code,
      label: modalityDisplayName(code),
    });
  });
  result.sort((left, right) => left.label.localeCompare(right.label));
  return result;
}

export function seriesRow(entry, isChecked) {
  const series = entry.series;
  const manifest = buildManifest([entry]);
  const number = valueOr(series.SeriesNumber, entry.seriesIndex + 1);
  const modality = modalityDisplayName(modalityCodeForEntry(entry));
  const description = seriesDescription(series);
  const name = selectionEntryName(entry, number, modality, description);
  const meta = selectionEntryMeta(entry, number, modality);
  const thumbnailSrc = seriesThumbnailSrc(entry);
  const checked = isChecked === false ? '' : ' checked';
  return `<label class="aquest-dm-series">
    <input type="checkbox"${checked} data-series-id="${escapeHtml(entry.id)}">
    ${seriesThumbnailMarkup(thumbnailSrc, modality)}
    <span class="aquest-dm-series-copy">
      <span class="aquest-dm-series-name">${escapeHtml(name)}</span>
      <span class="aquest-dm-series-meta">${escapeHtml(meta)}</span>
    </span>
    <span class="aquest-dm-pill">${manifest.length} image file${manifest.length === 1 ? '' : 's'}</span>
  </label>`;
}

export function selectionEntryName(entry, number, modality, description) {
  const baseName = description || `Images ${number} / ${modality}`;
  if (entry.selectionType === 'multiframe') {
    return `${baseName} - grouped images ${valueOr(entry.objectIndex, '')}`;
  }
  return baseName;
}

export function selectionEntryMeta(entry, number, modality) {
  const fileCount = buildManifest([entry]).length;
  const countLabel = fileCount ? ` • ${fileCount} image${fileCount === 1 ? '' : 's'}` : '';
  if (entry.selectionType === 'multiframe') {
    const frameCount = entry.frameCount || maxNumberOfFrames(entry.instances || []);
    return `${modality}${countLabel}${frameCount > 1 ? ` • ${frameCount} images grouped together` : ' • grouped images'}`;
  }
  return `${modality}${countLabel}`;
}

export function maxNumberOfFrames(instances) {
  return (instances || []).reduce((max, instance) => {
    return Math.max(
      max,
      numericValue(instance && instance.metadata && instance.metadata.NumberOfFrames)
    );
  }, 0);
}

export function seriesDescription(series) {
  const instances = series.instances || [];
  const firstMetadata = (instances[0] && instances[0].metadata) || {};
  return firstNonEmpty([
    series.SeriesDescription,
    series.seriesDescription,
    series.Description,
    series.description,
    firstMetadata.SeriesDescription,
    firstMetadata.seriesDescription,
  ]);
}

export function seriesThumbnailSrc(entry) {
  const fromOhif = ohifThumbnailSrc(entry);
  if (fromOhif) {
    return fromOhif;
  }

  const series = entry.series;
  const instances = entry.instances || series.instances || [];
  const firstInstance = instances[0] || {};
  const firstMetadata = firstInstance.metadata || {};
  return firstNonEmpty([
    series.thumbnailSrc,
    series.thumbnailUrl,
    series.thumbnailURL,
    series.thumbnail,
    series.thumbnail && series.thumbnail.src,
    series.thumbnail && series.thumbnail.url,
    series.imageSrc,
    firstInstance.thumbnailSrc,
    firstInstance.thumbnailUrl,
    firstInstance.thumbnail && firstInstance.thumbnail.src,
    firstInstance.thumbnail && firstInstance.thumbnail.url,
    firstMetadata.thumbnailSrc,
    firstMetadata.thumbnailUrl,
  ]);
}

export function ohifThumbnailSrc(entry) {
  if (!document.querySelectorAll) {
    return '';
  }
  const series = entry.series;
  const number = String(valueOr(series.SeriesNumber, entry.seriesIndex + 1));
  const uid = String(series.SeriesInstanceUID || '');
  const description = seriesDescription(series);
  const thumbnails = document.querySelectorAll('[data-cy="study-browser-thumbnail"]');
  for (let i = 0; i < thumbnails.length; i++) {
    const thumbnail = thumbnails[i];
    const dataSeries = thumbnail.getAttribute('data-series') || '';
    const descriptionLabel = thumbnail.querySelector('[data-cy="series-description-label"]');
    const labelText = descriptionLabel ? trimText(descriptionLabel.textContent) : '';
    const matchesSeries = dataSeries === number || dataSeries === uid;
    const matchesDescription = Boolean(description && labelText === description);
    if (matchesSeries || matchesDescription) {
      const image = thumbnail.querySelector('img[src]');
      if (image && image.getAttribute('src')) {
        return image.getAttribute('src');
      }
    }
  }
  return '';
}

export function seriesThumbnailMarkup(src, modality) {
  const label = escapeHtml(
    String(modality || 'IMG')
      .substring(0, 3)
      .toUpperCase()
  );
  if (src) {
    return `<span class="aquest-dm-thumbnail"><img src="${escapeHtml(src)}" alt="" loading="lazy" crossorigin="anonymous"><span class="aquest-dm-thumbnail-modality">${label}</span></span>`;
  }
  return `<span class="aquest-dm-thumbnail aquest-dm-thumbnail--empty"><span class="aquest-dm-thumbnail-modality">${label}</span></span>`;
}

export function buildManifest(selected) {
  if (!selected) return [];
  const selectedList = Array.isArray(selected) ? selected : [selected];
  if (selectedList.length > 0 && selectedList[0]?.sopUid && selectedList[0]?.patientDir && selectedList[0]?.studyDir) {
    return selectedList;
  }
  const seen = {};
  const items = [];
  const usedStudyNamesByPatient = {};
  const studyDirNameCache = {};
  const usedSeriesNamesByStudy = {};
  const seriesDirNameCache = {};

  selectedList.forEach(entry => {
    const study = entry.study;
    const series = entry.series;
    (entry.instances || series.instances || []).forEach((instance, instanceIndex) => {
      const metadata = instance.metadata || {};
      const localFile = instance.file || null;
      const reconstructFromFrames = instance.reconstructFromFrames === true;
      const sourceUrl = normalizeDownloadUrl(instance.url);
      if (!localFile && !sourceUrl) return;

      const objectUrl = sourceUrl
        ? reconstructFromFrames
          ? sourceUrl
          : removeFrameParameter(sourceUrl)
        : '';
      const sopUidRaw =
        metadata.SOPInstanceUID ||
        uidFromQuery(objectUrl, 'objectUID') ||
        objectUrl ||
        `instance-${instanceIndex}`;
      const dedupeKey = `${study.StudyInstanceUID || ''}|${series.SeriesInstanceUID || ''}|${sopUidRaw}|${objectUrl}`;
      if (seen[dedupeKey]) return;
      seen[dedupeKey] = true;

      const sopUid = validateSopInstanceUid(
        metadata.SOPInstanceUID || uidFromQuery(objectUrl, 'objectUID')
      );
      if (!sopUid) return;

      const pNameObj = study.PatientName || study.patientName || metadata.PatientName;
      let pNameRaw = '';
      if (typeof pNameObj === 'string') {
        pNameRaw = pNameObj;
      } else if (pNameObj && typeof pNameObj === 'object') {
        pNameRaw = pNameObj.Alphabetic || pNameObj.Ideographic || pNameObj.Phonetic || '';
      }

      const pIdRaw = firstNonEmpty([study.PatientID, study.patientId, metadata.PatientID]);
      const studyUid = study.StudyInstanceUID || metadata.StudyInstanceUID || 'study';
      // Paths are routinely indexed and backed up. Never place Patient ID,
      // name, accession number, or descriptions in an identified export path.
      const patientId = `Patient_${shortUid(studyUid)}`;
      const studyCacheKey = `${patientId}|${studyUid}`;
      let studyDir = studyDirNameCache[studyCacheKey];

      if (!studyDir) {
        const baseStudyDir = `Study_${shortUid(studyUid)}`;
        if (!usedStudyNamesByPatient[patientId]) usedStudyNamesByPatient[patientId] = {};
        const studyCollisions = usedStudyNamesByPatient[patientId];

        studyDir = baseStudyDir;
        let dupIdx = 2;
        while (studyCollisions[studyDir]) {
          const suffix = `_DUP${padLeft(String(dupIdx), 2)}`;
          studyDir = `${baseStudyDir.substring(0, 120 - suffix.length)}${suffix}`;
          dupIdx++;
        }
        studyCollisions[studyDir] = true;
        studyDirNameCache[studyCacheKey] = studyDir;
      }

      const seriesUid = series.SeriesInstanceUID || metadata.SeriesInstanceUID || 'series';
      const seriesCacheKey = `${studyCacheKey}|${seriesUid}`;
      let seriesDir = seriesDirNameCache[seriesCacheKey];

      if (!seriesDir) {
        const srNum = normalizeSeriesNumber(
          firstNonEmpty([series.SeriesNumber, series.seriesNumber, metadata.SeriesNumber])
        );

        const baseSeriesDir = `Series_${srNum}_${shortUid(seriesUid)}`;
        if (!usedSeriesNamesByStudy[studyCacheKey]) usedSeriesNamesByStudy[studyCacheKey] = {};
        const seriesCollisions = usedSeriesNamesByStudy[studyCacheKey];

        seriesDir = baseSeriesDir;
        let srDupIdx = 2;
        while (seriesCollisions[seriesDir]) {
          const srSuffix = `_DUP${padLeft(String(srDupIdx), 2)}`;
          seriesDir = `${baseSeriesDir.substring(0, 120 - srSuffix.length)}${srSuffix}`;
          srDupIdx++;
        }
        seriesCollisions[seriesDir] = true;
        seriesDirNameCache[seriesCacheKey] = seriesDir;
      }

      items.push({
        url: objectUrl,
        file: localFile,
        reconstructFromFrames,
        metadata,
        studyUid,
        seriesUid,
        sopUid,
        seriesNumber: series.SeriesNumber || metadata.SeriesNumber || entry.seriesIndex + 1,
        instanceNumber: metadata.InstanceNumber || instanceIndex + 1,
        extension: isVideoUrl(objectUrl) ? 'mp4' : 'dcm',
        patientDir: patientId,
        studyDir,
        seriesDir,
        // Raw patient/study identifiers needed for batch subject grouping (F4)
        rawPatientId: pIdRaw || 'UNKNOWN',
        rawPatientName: pNameRaw || 'UNKNOWN',
        rawStudyUid: studyUid,
      });
    });
  });
  return items;
}

export function validateManifestSelection(selected) {
  if (!selected) return [];
  const selectedList = Array.isArray(selected) ? selected : [selected];
  const errors = [];
  selectedList.forEach(entry => {
    if (!entry || typeof entry !== 'object' || entry.nativeEvent || entry.target) {
      return;
    }
    const study = entry.study || {};
    const series = entry.series || {};
    (entry.instances || series.instances || []).forEach((instance, index) => {
      const metadata = instance?.metadata || {};
      const sourceUrl = normalizeDownloadUrl(instance?.url);
      if (!instance?.file && !sourceUrl) {
        errors.push(`Instance ${index + 1} has no downloadable source.`);
        return;
      }
      const identifiers = [
        ['Study Instance UID', study.StudyInstanceUID || metadata.StudyInstanceUID],
        ['Series Instance UID', series.SeriesInstanceUID || metadata.SeriesInstanceUID],
        ['SOP Instance UID', metadata.SOPInstanceUID || uidFromQuery(sourceUrl, 'objectUID')],
      ];
      identifiers.forEach(([label, value]) => {
        if (!validateSopInstanceUid(value)) {
          errors.push(`Instance ${index + 1} has an invalid or missing ${label}.`);
        }
      });
    });
  });
  return [...new Set(errors)];
}

export function normalizeDownloadUrl(url) {
  if (!url || typeof url !== 'string') {
    return '';
  }
  let value = url.trim();
  if (value.startsWith('wadouri:')) {
    value = value.substring('wadouri:'.length);
  } else if (value.startsWith('dicomweb:')) {
    value = value.substring('dicomweb:'.length);
  } else if (value.startsWith('wadors:')) {
    value = value.substring('wadors:'.length);
  }
  value = value.replace(/\/frames\/\d+(?=\/|$|\?)/, '');
  return value;
}

export function removeFrameParameter(url) {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.delete('frame');
    parsed.searchParams.delete('frameNumber');
    return parsed.href;
  } catch (ignore) {
    return url.replace(/([?&])frame(Number)?=[^&#]*&?/g, '$1').replace(/[?&]$/, '');
  }
}

export function hasFrameParameter(url) {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.searchParams.has('frame') || parsed.searchParams.has('frameNumber');
  } catch (ignore) {
    return /[?&]frame(Number)?=/.test(url);
  }
}

export function uidFromQuery(url, name) {
  try {
    return new URL(url, window.location.href).searchParams.get(name);
  } catch (ignore) {
    return '';
  }
}

export function isVideoUrl(url) {
  try {
    return new URL(url, window.location.href).searchParams.get('contentType') === 'video/mp4';
  } catch (ignore) {
    return false;
  }
}

export function fileName(item) {
  return `${item.sopUid}.${item.extension}`;
}

export function studyLabel(study) {
  const description = firstNonEmpty([
    study.StudyDescription,
    study.studyDescription,
    study.Description,
    study.description,
  ]);
  return [description || 'Medical imaging exam', study.StudyDate, study.Modalities]
    .filter(Boolean)
    .join(' • ');
}

export function truncateStudyDir(date, desc, acc, limit) {
  limit = Math.max(limit || 120, 20);
  const joined = [date, desc, acc].filter(Boolean).join('_');
  if (joined.length <= limit) return joined;
  const fixedLen = (date ? date.length + 1 : 0) + (acc ? acc.length + 1 : 0);
  const descAllowed = limit - fixedLen;
  if (descAllowed > 0 && desc) {
    return [date, desc.substring(0, descAllowed).replace(/_+$/, ''), acc].filter(Boolean).join('_');
  }
  if (!desc) {
    const accAllowed = limit - (date ? date.length + 1 : 0);
    if (accAllowed > 0 && acc)
      return [date, acc.substring(0, accAllowed)].filter(Boolean).join('_');
    return date ? date.substring(0, limit) : acc.substring(0, limit);
  }
  return truncateStudyDir(date, '', acc, limit);
}

export function truncateSeriesDir(desc, num, limit) {
  limit = Math.max(limit || 120, 20);
  const joined = [desc, num].filter(Boolean).join('_');
  if (joined.length <= limit) return joined;
  const descAllowed = limit - (num ? num.length + 1 : 0);
  if (descAllowed > 0 && desc) {
    return [desc.substring(0, descAllowed).replace(/_+$/, ''), num].filter(Boolean).join('_');
  }
  return desc ? desc.substring(0, limit) : num.substring(0, limit);
}
