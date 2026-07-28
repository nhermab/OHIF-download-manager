/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Core DICOM PS 3.15 Annex E header anonymization engine for OHIF Download Manager.
 * Incorporates tag transformation semantics and rules derived from:
 *  - RSNA DICOM Anonymizer V18.0 / MIRC CTP Anonymizer (Apache-2.0)
 *  - DicomCleaner™ / PixelMed Toolkit (BSD-3-Clause)
 */

import { anonymizerRules } from "../anonymizer-rules.js";
import { safePrivateRules } from "./safePrivateRules.js";
import { redactDicomPixelData } from "./pixelRedactor.js";
import dcmjs from "dcmjs";

const uidMap = new Map();
const dateOffsetMap = new Map();

const defaultOptions = {
  newPatientName: "ANONYMOUS",
  newPatientId: "ANON1234",
  newPatientBirthDate: "",
  newAccessionNumber: "",
  keepDescriptors: false,
  keepSeriesDescriptors: false,
  keepProtocolName: false,
  keepPatientCharacteristics: false,
  aggregateAgesOver89: true,
  roundAgeToYears: 5,
  keepExactTimes: false,
  keepDeviceIdentity: false,
  keepInstitutionIdentity: false,
  keepSafePrivate: false,
  addContributingEquipment: true,
  preserveUidReferences: true,
  remapUids: true,
  keepDates: false,
  privateTagsPolicy: "remove_all",
  tagWhitelist: "",
  structuredContentPolicy: "remove",
  rejectEncapsulatedDocuments: true,
  rejectEncryptedContent: true,
  enablePixelRedaction: true,
  forceIgnoreBurnedInAnnotation: false,
  multiFrameRedactionMethod: "ask",
  borderWidth: 0,
  borderColor: "none",
  verboseLogging: false,
  warnings: null,
};

function generateUid() {
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new Error("Secure random number generation is unavailable; refusing to create anonymized UIDs");
  }
  globalThis.crypto.getRandomValues(bytes);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return "2.25." + value.toString(10);
}

export function resetAnonymizationSession() {
  uidMap.clear();
  dateOffsetMap.clear();
}

export function getMappedUid(oldUid) {
  if (!oldUid) return generateUid();
  if (!uidMap.has(oldUid)) {
    uidMap.set(oldUid, generateUid());
  }
  return uidMap.get(oldUid);
}

function hashDate(oldDate, offsetDays, keepExactTimes = false) {
  if (!oldDate || typeof oldDate !== "string") return "";
  const cleanDate = oldDate.replace(/[-.\/\s]/g, "");
  const datePart = cleanDate.substring(0, 8);
  const timePart = keepExactTimes && cleanDate.length > 8 ? cleanDate.substring(8) : "";

  if (/^\d{8}$/.test(datePart)) {
    const y = parseInt(datePart.substring(0, 4), 10);
    const m = parseInt(datePart.substring(4, 6), 10) - 1;
    const d = parseInt(datePart.substring(6, 8), 10);
    const date = new Date(Date.UTC(y, m, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m || date.getUTCDate() !== d) return "";
    date.setUTCDate(date.getUTCDate() + offsetDays);
    const ny = date.getUTCFullYear();
    const nm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const nd = String(date.getUTCDate()).padStart(2, '0');
    return `${ny}${nm}${nd}${timePart}`;
  }
  return "";
}

function getDateOffset(subjectKey) {
  let key = String(subjectKey || "").trim();
  if (!key || key === "UNKNOWN") {
    key = "FALLBACK_SUBJECT_KEY";
  }
  if (!dateOffsetMap.has(key)) {
    const random = new Uint32Array(1);
    if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
      throw new Error("Secure random number generation is unavailable; refusing to shift dates");
    }
    globalThis.crypto.getRandomValues(random);
    let offset = (random[0] % 3651) - 1825;
    if (offset === 0) offset = 1;
    dateOffsetMap.set(key, offset);
  }
  return dateOffsetMap.get(key);
}

function parseAgeString(ageString) {
  if (!ageString || typeof ageString !== "string") return null;
  const m = /^(\d{1,3})\s*([DWMY])$/.exec(ageString.trim().toUpperCase());
  if (!m) return null;
  return { value: parseInt(m[1], 10), unit: m[2] };
}

function formatAgeString(value, unit) {
  const clamped = Math.max(0, Math.min(999, value));
  return String(clamped).padStart(3, "0") + unit;
}

function processPatientAge(rawValue, options) {
  const parsed = parseAgeString(rawValue);
  if (!parsed) return rawValue;
  let { value, unit } = parsed;
  if (unit === "Y") {
    if (options.aggregateAgesOver89 && value > 89) {
      return "090Y";
    }
    if (options.roundAgeToYears > 0) {
      value = Math.floor(value / options.roundAgeToYears) * options.roundAgeToYears;
    }
  }
  return formatAgeString(value, unit);
}

function getPrivateCreator(dict, tag) {
  const group = tag.substring(0, 4);
  const elementInt = parseInt(tag.substring(4, 8), 16);
  const blockNumber = (elementInt >> 8) & 0xff;
  if (blockNumber < 0x10) return null;
  const creatorTag = group + "00" + blockNumber.toString(16).padStart(2, "0").toUpperCase();
  const creatorEl = dict[creatorTag];
  if (!creatorEl || !creatorEl.Value || !creatorEl.Value.length) return null;
  return creatorEl.Value[0];
}

function isSafePrivateAttribute(dict, tag) {
  const elementInt = parseInt(tag.substring(4, 8), 16);
  if (elementInt >= 0x0010 && elementInt <= 0x00ff) {
    return true;
  }
  const creator = getPrivateCreator(dict, tag);
  if (!creator) return false;
  const rulesForCreator = safePrivateRules[creator];
  if (!rulesForCreator) return false;
  const group = tag.substring(0, 4).toLowerCase();
  const groupRules = rulesForCreator[group];
  if (!groupRules) return false;
  const elementInBlock = elementInt & 0xff;
  const elementInBlockHex = elementInBlock.toString(16).padStart(2, "0");
  if (groupRules.elements.indexOf(elementInBlockHex) !== -1) return true;
  for (const range of groupRules.ranges) {
    if (elementInBlock >= parseInt(range[0], 16) && elementInBlock <= parseInt(range[1], 16)) return true;
  }
  return false;
}

function addCode(items, value, scheme, meaning) {
  items.push({
    "00080100": { vr: "SH", Value: [value] },
    "00080102": { vr: "SH", Value: [scheme] },
    "00080104": { vr: "LO", Value: [meaning] },
  });
}

function buildDeidentificationCodeSequence(options) {
  const items = [];
  addCode(items, "113100", "DCM", "Basic Application Confidentiality Profile");

  if (options.keepDescriptors) {
    addCode(items, "210005", "99AQST", "Retain all descriptors unchanged");
  } else if (options.keepSeriesDescriptors && options.keepProtocolName) {
    addCode(items, "210008", "99AQST", "Remove all descriptors except Series Description & Protocol Name");
  } else if (options.keepProtocolName) {
    addCode(items, "210009", "99AQST", "Remove all descriptors except Protocol Name");
  } else if (options.keepSeriesDescriptors) {
    addCode(items, "210003", "99AQST", "Remove all descriptors except Series Description");
  } else {
    addCode(items, "210004", "99AQST", "Remove all descriptors");
  }

  if (options.keepPatientCharacteristics) {
    addCode(items, "113108", "DCM", "Retain Patient Characteristics Option");
    if (options.aggregateAgesOver89) {
      addCode(items, "210012", "99AQST", "Patient ages > 89 years set to 90");
    }
  }

  if (options.keepDeviceIdentity) {
    addCode(items, "113109", "DCM", "Retain Device Identity Option");
  }
  if (options.keepInstitutionIdentity) {
    addCode(items, "113112", "DCM", "Retain Institution Identity Option");
  }

  addCode(items, "210001", "99AQST", "Remap UIDs");
  addCode(items, "113107", "DCM", "Retain Longitudinal Temporal Information Modified Dates Option");
  if (options.enablePixelRedaction !== false) {
    addCode(items, "113101", "DCM", "Clean Pixel Data Option");
  }

  if (options.keepSafePrivate) {
    addCode(items, "113111", "DCM", "Retain Safe Private Option");
  } else {
    addCode(items, "210002", "99AQST", "Remove all private elements");
  }

  return items;
}

function buildDeidentificationMethodValues(options) {
  return [
    "Deidentified",
    "Descriptors " + (options.keepDescriptors
      ? "retained"
      : ("removed" + (options.keepSeriesDescriptors ? " except series" : "") + (options.keepProtocolName ? " except protocol" : ""))),
    "Patient Characteristics " + (options.keepPatientCharacteristics
      ? (options.aggregateAgesOver89 ? "retained with ages >89 set to 90" : "retained")
      : "removed"),
    "Device identity " + (options.keepDeviceIdentity ? "retained" : "removed"),
    "Institution identity " + (options.keepInstitutionIdentity ? "retained" : "removed"),
    "Private attributes " + (options.keepSafePrivate ? "unsafe removed, safe retained" : "all removed"),
    "Structured content " + (options.structuredContentPolicy === "sanitize" ? "sanitized (best effort)" : "removed"),
    "Pixel data " + (options.enablePixelRedaction !== false ? "PHI redacted via client-side OCR" : "retained"),
    "UIDs remapped",
    "Dates modified (per-subject consistent offset)",
  ];
}

function addContributingEquipmentItem(dict) {
  const item = {
    "0040A170": {
      vr: "SQ",
      Value: [{
        "00080100": { vr: "SH", Value: ["109104"] },
        "00080102": { vr: "SH", Value: ["DCM"] },
        "00080104": { vr: "LO", Value: ["De-identifying Equipment"] },
      }],
    },
    "00080070": { vr: "LO", Value: ["OHIF"] },
    "00081090": { vr: "LO", Value: ["Download Manager Client-Side Anonymizer"] },
    "0018A003": { vr: "ST", Value: ["De-identified in-browser prior to download"] },
  };
  const existing = dict["0018A001"];
  if (existing && existing.vr === "SQ" && Array.isArray(existing.Value)) {
    existing.Value.push(item);
  } else {
    dict["0018A001"] = { vr: "SQ", Value: [item] };
  }
}

function elementHasPayload(element) {
  if (!element || !element.Value) return false;
  if (ArrayBuffer.isView(element.Value)) return element.Value.byteLength > 0;
  if (element.Value instanceof ArrayBuffer) return element.Value.byteLength > 0;
  return Array.isArray(element.Value) ? element.Value.length > 0 : true;
}

function containsPayloadTag(dict, wantedTag) {
  if (!dict || typeof dict !== "object") return false;
  if (elementHasPayload(dict[wantedTag])) return true;
  for (const tag of Object.keys(dict)) {
    const element = dict[tag];
    if (!element || element.vr !== "SQ" || !Array.isArray(element.Value)) continue;
    for (const item of element.Value) {
      if (containsPayloadTag(item, wantedTag)) return true;
    }
  }
  return false;
}

function hazardousPayloadError(message) {
  const error = new Error(message);
  error.name = "UnsafeDicomPayloadError";
  return error;
}

const invariantUidTags = new Set([
  "00020002",
  "00020010",
  "00041510",
  "00041512",
  "00080016",
  "0008010C",
  "00081150",
]);

function sequenceContainsRemappableUid(items) {
  if (!Array.isArray(items)) return false;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    for (const tag of Object.keys(item)) {
      const element = item[tag];
      if (!element) continue;
      if (element.vr === "UI" && !invariantUidTags.has(tag)) return true;
      if (element.vr === "SQ" && sequenceContainsRemappableUid(element.Value)) return true;
    }
  }
  return false;
}

function sanitizeStructuredContentItems(items, options, offsetDays) {
  if (!Array.isArray(items)) return [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const valueTypeEl = item["0040A040"];
    const valueType = valueTypeEl && valueTypeEl.Value
      ? String(valueTypeEl.Value[0] || "").toUpperCase()
      : "";

    if (item["0040A160"]) item["0040A160"].Value = ["[REMOVED]"];
    if (item["00700006"]) item["00700006"].Value = ["[REMOVED]"];
    if (item["0040A123"]) {
      item["0040A123"].Value = [{ Alphabetic: options.newPatientName || "ANONYMOUS" }];
    }
    if (item["0040A075"]) {
      item["0040A075"].Value = [{ Alphabetic: options.newPatientName || "ANONYMOUS" }];
    }
    if (item["0040A124"] && item["0040A124"].Value) {
      item["0040A124"].Value = item["0040A124"].Value.map(getMappedUid);
    }

    for (const tag of ["0040A120", "0040A121", "0040A13A", "0040A030", "0040A032"]) {
      if (item[tag] && item[tag].Value) {
        item[tag].Value = item[tag].Value.map(value => hashDate(value, offsetDays, options.keepExactTimes));
      }
    }
    if (item["0040A122"]) item["0040A122"].Value = [];

    for (const tag of Object.keys(item)) {
      const element = item[tag];
      const group = parseInt(tag.substring(0, 4), 16);
      if (group % 2 !== 0) {
        delete item[tag];
      } else if (element && element.vr === "PN") {
        element.Value = [{ Alphabetic: options.newPatientName || "ANONYMOUS" }];
      } else if (element && element.vr === "SQ" && tag !== "0040A730") {
        if (element.Value) {
          element.Value = sanitizeStructuredContentItems(element.Value, options, offsetDays);
        }
      }
    }

    const children = item["0040A730"];
    if (children && children.vr === "SQ") {
      children.Value = sanitizeStructuredContentItems(children.Value, options, offsetDays);
    }

    const knownTypes = ["CONTAINER", "TEXT", "CODE", "NUM", "PNAME", "DATE", "TIME", "DATETIME", "UIDREF", "IMAGE", "COMPOSITE", "WAVEFORM", "SCOORD", "SCOORD3D", "TCOORD"];
    if (valueType && knownTypes.indexOf(valueType) === -1) {
      for (const tag of Object.keys(item)) {
        if (!["0040A010", "0040A040", "0040A043", "0040A730"].includes(tag)) delete item[tag];
      }
    }
  }
  return items;
}

export async function anonymizeDicom(buffer, callerOptions = {}) {
  const options = Object.assign({}, defaultOptions, callerOptions);
  const dicomDict = dcmjs.data.DicomMessage.readFile(buffer);

  const pixelResult = await redactDicomPixelData(dicomDict, options);

  const patientIdEl = dicomDict.dict["00100020"];
  const origPatientId = patientIdEl && patientIdEl.Value ? String(patientIdEl.Value[0] || "").trim() : "";
  const patientNameEl = dicomDict.dict["00100010"];
  const origPatientName = patientNameEl && patientNameEl.Value ? JSON.stringify(patientNameEl.Value) : "";
  const birthDateEl = dicomDict.dict["00100030"];
  const origBirthDate = birthDateEl && birthDateEl.Value ? String(birthDateEl.Value[0] || "") : "";
  const studyUidEl = dicomDict.dict["0020000D"];
  const origStudyUid = studyUidEl && studyUidEl.Value ? String(studyUidEl.Value[0] || "") : "";

  let subjectKey = origPatientId;
  if (!subjectKey || subjectKey === "UNKNOWN") {
    if (origPatientName || origBirthDate) {
      subjectKey = `NAME_${origPatientName}_DOB_${origBirthDate}`;
    } else if (origStudyUid) {
      subjectKey = `STUDY_${origStudyUid}`;
    } else {
      subjectKey = `INSTANCE_${generateUid()}`;
    }
  }
  const offsetDays = getDateOffset(subjectKey);

  const bodyPartEl = dicomDict.dict["00180015"];
  const modalityEl = dicomDict.dict["00080060"];
  const bodyPart = bodyPartEl && bodyPartEl.Value ? String(bodyPartEl.Value[0] || "").toUpperCase() : "";
  const modality = modalityEl && modalityEl.Value ? String(modalityEl.Value[0] || "").toUpperCase() : "";
  const headParts = ["HEAD", "BRAIN", "FACE", "NECK", "CRANIUM", "SKULL"];
  if (Array.isArray(options.warnings)) {
    if (headParts.some(hp => bodyPart.includes(hp)) || ((modality === "CT" || modality === "MR") && headParts.some(hp => bodyPart.includes(hp)))) {
      options.warnings.push(
        `3D Facial Reconstruction Risk: Head/Neck/Brain imaging (${modality || "volumetric"} / ${bodyPart || "Head"}) retains soft-tissue pixel geometry. DICOM metadata de-identification does not perform pixel-level defacing.`
      );
    }
  }

  const whitelistSet = new Set();
  if (options.tagWhitelist) {
    const rawList = Array.isArray(options.tagWhitelist) ? options.tagWhitelist : String(options.tagWhitelist).split(/[,;\s]+/);
    for (const item of rawList) {
      const clean = String(item || "").trim().replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
      if (clean.length === 8) whitelistSet.add(clean);
    }
  }

  const keepAllPrivate = options.privateTagsPolicy === "keep_all" || options.keepAllPrivate === true;
  const keepSafePrivate = options.privateTagsPolicy === "keep_safe" || options.keepSafePrivate === true;
  const remapUids = options.remapUids !== false;

  if (options.rejectEncapsulatedDocuments && containsPayloadTag(dicomDict.dict, "00420011")) {
    throw hazardousPayloadError(
      "Encapsulated document rejected: PDF/XML/binary content requires format-aware de-identification before DICOM export"
    );
  }
  if (options.rejectEncryptedContent && containsPayloadTag(dicomDict.dict, "04000520")) {
    throw hazardousPayloadError(
      "Encrypted DICOM content rejected: encrypted attributes cannot be inspected for patient identifiers"
    );
  }

  function walk(dict) {
    for (const tag of Object.keys(dict)) {
      const element = dict[tag];

      if (whitelistSet.has(tag.toUpperCase())) {
        continue;
      }

      const group = parseInt(tag.substring(0, 4), 16);

      if ((group & 0xff00) === 0x6000 && options.keepOverlays) {
        continue;
      }
      if ((group & 0xff00) === 0x5000 && options.keepCurves) {
        continue;
      }

      const isPhysicianTag = ["00080090", "00081050", "00081048", "00081070", "00081060"].includes(tag);
      if (isPhysicianTag && options.keepPhysicians) {
        continue;
      }

      const isAcqParamTag = ["00180010", "00180050", "00180080", "00180081", "00180087", "00180600", "00181151", "00181152"].includes(tag);
      if (isAcqParamTag && options.keepAcquisitionParameters) {
        continue;
      }

      const isCommentTag = ["00204000", "00084000"].includes(tag);
      if (isCommentTag && options.keepComments) {
        continue;
      }

      if (tag === "00100040" && options.newPatientSex) {
        element.Value = [options.newPatientSex];
        continue;
      }
      if (tag === "00081030" && options.newStudyDescription) {
        element.Value = [options.newStudyDescription];
        continue;
      }
      if (tag === "0008103E" && options.newSeriesDescription) {
        element.Value = [options.newSeriesDescription];
        continue;
      }

      if (group % 2 !== 0) {
        if (keepAllPrivate) {
          continue;
        }
        if (element.vr !== "SQ" && keepSafePrivate && isSafePrivateAttribute(dict, tag)) {
          continue;
        }
        delete dict[tag];
        continue;
      }

      if (!anonymizerRules.hasOwnProperty(tag)) {
        if (group === 2) {
          const keepMeta = ["00020000", "00020001", "00020002", "00020010", "00020012", "00020013"];
          if (tag === "00020003") {
            if (remapUids) {
              const oldUid = dict[tag].Value && dict[tag].Value[0];
              dict[tag].Value = [getMappedUid(oldUid)];
            }
          } else if (tag === "00020013") {
            dict[tag].Value = ["OHIF"];
          } else if (!keepMeta.includes(tag)) {
            delete dict[tag];
          }
        } else {
          delete dict[tag];
        }
        continue;
      }

      const operation = anonymizerRules[tag].rule;

      if (tag === "00280301" && element.Value && Array.isArray(options.warnings)) {
        const flag = String(element.Value[0] || "").toUpperCase();
        if (flag === "YES") {
          options.warnings.push(
            "BurnedInAnnotation=YES: this instance may contain PHI rendered into the pixel data. " +
            "This client-side tool only removes DICOM metadata and cannot redact pixel data."
          );
        }
      }

      if (element.vr === "SQ" && element.Value) {
        if (tag === "0040A730") {
          if (options.structuredContentPolicy === "sanitize") {
            element.Value = sanitizeStructuredContentItems(element.Value, options, offsetDays);
          } else {
            delete dict[tag];
          }
        } else if (operation && operation.includes("@remove") &&
                   !(options.preserveUidReferences && sequenceContainsRemappableUid(element.Value))) {
          delete dict[tag];
        } else {
          for (const item of element.Value) walk(item);
        }
      } else {
        if (element.vr === "TM" && !options.keepExactTimes) {
          delete dict[tag];
        } else if (element.vr === "UI") {
          if (!invariantUidTags.has(tag) && element.Value && remapUids) {
            element.Value = element.Value.map(value => getMappedUid(value));
          }
        } else if (!operation || operation === "@keep") {
          // Do nothing
        } else if (operation.includes("@empty")) {
          element.Value = [];
        } else if (operation.includes("@uid")) {
          if (element.Value && remapUids) {
            element.Value = element.Value.map(v => getMappedUid(v));
          }
        } else if (operation.includes("@ptid")) {
          if (tag === "00100010") {
            element.Value = [{ Alphabetic: options.newPatientName || "ANONYMOUS" }];
          } else {
            element.Value = [options.newPatientId || "ANON1234"];
          }
        } else if (operation.includes("@birthdate")) {
          element.Value = [options.newPatientBirthDate || ""];
        } else if (operation.includes("@acc")) {
          element.Value = [options.newAccessionNumber || ""];
        } else if (operation.includes("@hashdate")) {
          if (element.Value && !options.keepDates) {
            element.Value = element.Value.map(v => hashDate(v, offsetDays, options.keepExactTimes));
          }
        } else if (operation.includes("@age")) {
          if (!options.keepPatientCharacteristics) {
            delete dict[tag];
          } else if (element.Value && element.Value.length) {
            element.Value = element.Value.map(v => processPatientAge(v, options));
          }
        } else if (operation.includes("@characteristic")) {
          if (!options.keepPatientCharacteristics) {
            delete dict[tag];
          }
        } else if (operation.includes("@device")) {
          if (!options.keepDeviceIdentity) {
            delete dict[tag];
          }
        } else if (operation.includes("@institution")) {
          if (!options.keepInstitutionIdentity) {
            delete dict[tag];
          }
        } else if (operation.includes("@keepseriesdescriptor")) {
          if (!options.keepDescriptors && !options.keepSeriesDescriptors) {
            delete dict[tag];
          }
        } else if (operation.includes("@keepprotocolname")) {
          if (!options.keepDescriptors && !options.keepProtocolName) {
            delete dict[tag];
          }
        } else if (operation.includes("@keepdescriptor")) {
          if (!options.keepDescriptors) {
            delete dict[tag];
          }
        } else if (operation.includes("@remove")) {
          delete dict[tag];
        }
      }
    }
  }

  walk(dicomDict.dict);
  if (dicomDict.meta) {
    walk(dicomDict.meta);
  }

  if (options.addContributingEquipment) {
    addContributingEquipmentItem(dicomDict.dict);
  }

  if (pixelResult?.verifiedClean === true) {
    dicomDict.dict["00120062"] = { vr: "CS", Value: ["YES"] };
    dicomDict.dict["00120063"] = { vr: "LO", Value: buildDeidentificationMethodValues(options) };
    dicomDict.dict["00120064"] = { vr: "SQ", Value: buildDeidentificationCodeSequence(options) };
  } else {
    delete dicomDict.dict["00120062"];
    delete dicomDict.dict["00120063"];
    delete dicomDict.dict["00120064"];
  }

  function normalizeDataset(dict) {
    for (const tag of Object.keys(dict)) {
      const element = dict[tag];
      if (!element) continue;

      if (element.vr === "DA" && element.Value) {
        if (Array.isArray(element.Value)) {
          element.Value = element.Value.map(v => typeof v === "string" ? v.replace(/[-.\/\s]/g, "") : v);
        } else if (typeof element.Value === "string") {
          element.Value = element.Value.replace(/[-.\/\s]/g, "");
        }
      }

      if (element.Value) {
        if (Array.isArray(element.Value)) {
          element.Value = element.Value.map(v => {
            if (ArrayBuffer.isView(v)) {
              return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
            }
            return v;
          });
        } else if (ArrayBuffer.isView(element.Value)) {
          element.Value = element.Value.buffer.slice(
            element.Value.byteOffset,
            element.Value.byteOffset + element.Value.byteLength
          );
        }
      }

      if (element.vr === "SQ" && Array.isArray(element.Value)) {
        for (const item of element.Value) {
          normalizeDataset(item);
        }
      }
    }
  }

  normalizeDataset(dicomDict.dict);
  if (dicomDict.meta) {
    normalizeDataset(dicomDict.meta);
  }

  return dicomDict.write();
}
