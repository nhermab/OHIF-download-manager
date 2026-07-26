/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Configurator and rule parser for DICOM header anonymization presets,
 * supporting RSNA MIRC CTP anonymizer script rule definitions (Apache-2.0).
 */

import { anonymizerRules } from "./anonymizer-rules.js";

export const DEFAULT_ANONYMIZER_CONFIG = {
  // Patient / Identifier overrides
  newPatientName: "ANONYMOUS",
  newPatientId: "ANON1234",
  newPatientBirthDate: "",
  newAccessionNumber: "",
  newPatientSex: "",
  newStudyDescription: "",
  newSeriesDescription: "",

  // UIDs
  remapUids: true,                     // true = remap UIDs to 2.25 UUIDs, false = preserve original UIDs

  // Dates & Times
  keepDates: false,                    // false = shift dates, true = keep original dates
  keepExactTimes: false,               // false = delete TM times, true = keep exact times

  // Descriptors & Clinical Metadata
  keepDescriptors: false,              // true = keep Study/Series Descriptions and Protocol Name
  keepSeriesDescriptors: false,        // true = keep Series Description
  keepProtocolName: false,             // true = keep Protocol Name
  keepPhysicians: false,               // true = keep Referring/Performing Physician Name
  keepAcquisitionParameters: false,   // true = keep KVP, Slice Thickness, Contrast, TE/TR
  keepComments: false,                 // true = keep Image/Study comments
  keepOverlays: false,                 // true = keep Group 60xx vector overlays
  keepCurves: false,                   // true = keep Group 50xx curves

  // Patient Characteristics
  keepPatientCharacteristics: false,   // true = keep sex, weight, size, age
  aggregateAgesOver89: true,           // true = aggregate age > 89 to 90
  roundAgeToYears: 5,                  // round age to nearest N years (0 = disable)

  // Device & Institution
  keepDeviceIdentity: false,           // true = keep StationName, DeviceSerialNumber, etc.
  keepInstitutionIdentity: false,      // true = keep InstitutionName, InstitutionAddress, etc.

  // Private Tags & Whitelist
  privateTagsPolicy: "remove_all",     // "remove_all", "keep_safe", "keep_all"
  tagWhitelist: "",                    // Multiline / comma-separated DICOM tags to keep

  // Advanced
  structuredContentPolicy: "remove",   // "remove" or "sanitize"
  addContributingEquipment: true,
  preserveUidReferences: true,
  rejectEncapsulatedDocuments: true,
  rejectEncryptedContent: true,

  // Pixel PHI Redaction
  enablePixelRedaction: true,          // true = scan OCR & redact pixel PHI when BurnedInAnnotation=YES
  forceIgnoreBurnedInAnnotation: false, // true = force scan & redact pixel PHI even if BurnedInAnnotation!=YES
  multiFrameRedactionMethod: "ask",    // "ask" (prompt user once when multi-frame burned-in clip found), "aggressive" (all frames), "sampling" (key frames)
  ocrPerformanceMode: "balanced",      // "balanced" (default), "fast" (downscale frame & fast ROI scan for low-power CPUs), "thorough" (full resolution scan)
  ocrMaxResolution: 1024,              // Max canvas dimension for fast OCR downscaling on low-end hardware
  requireOcrModelConfirmation: false,  // true = prompt user before executing fallback micro-OCR when WASM model missing
  borderWidth: 0,                      // Redaction mask border width in pixels (0 = OFF by default)
  borderColor: "none",                 // Border color: "none" (default OFF), "double" (black & white), "red", "white", "black"
  verboseLogging: false                // never log OCR/PHI-derived details from a browser client
};

const STORAGE_KEY_CONFIG = "aquest_anonymizer_config";
const STORAGE_KEY_ENABLED = "aquest_anonymizer_enabled";

export function loadAnonymizerConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return { ...DEFAULT_ANONYMIZER_CONFIG };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_ANONYMIZER_CONFIG, ...parsed };
  } catch (ignore) {
    return { ...DEFAULT_ANONYMIZER_CONFIG };
  }
}

export function saveAnonymizerConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(cfg));
  } catch (ignore) {
    // Persistence best-effort
  }
}

export function loadAnonymizerEnabled() {
  try {
    const val = localStorage.getItem(STORAGE_KEY_ENABLED);
    return val !== "false";
  } catch (ignore) {
    return true;
  }
}

export function saveAnonymizerEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? "true" : "false");
  } catch (ignore) {
    // Persistence best-effort
  }
}

export function isNonDefaultConfig(cfg) {
  if (!cfg) return false;
  const def = DEFAULT_ANONYMIZER_CONFIG;

  if (cfg.remapUids !== def.remapUids) return true;
  if (cfg.keepDates !== def.keepDates) return true;
  if (cfg.keepExactTimes !== def.keepExactTimes) return true;
  if (cfg.keepDescriptors !== def.keepDescriptors) return true;
  if (cfg.keepSeriesDescriptors !== def.keepSeriesDescriptors) return true;
  if (cfg.keepProtocolName !== def.keepProtocolName) return true;
  if (cfg.keepPhysicians !== def.keepPhysicians) return true;
  if (cfg.keepAcquisitionParameters !== def.keepAcquisitionParameters) return true;
  if (cfg.keepComments !== def.keepComments) return true;
  if (cfg.keepOverlays !== def.keepOverlays) return true;
  if (cfg.keepCurves !== def.keepCurves) return true;
  if (cfg.keepPatientCharacteristics !== def.keepPatientCharacteristics) return true;
  if (cfg.aggregateAgesOver89 !== def.aggregateAgesOver89) return true;
  if (cfg.roundAgeToYears !== def.roundAgeToYears) return true;
  if (cfg.keepDeviceIdentity !== def.keepDeviceIdentity) return true;
  if (cfg.keepInstitutionIdentity !== def.keepInstitutionIdentity) return true;
  if (cfg.privateTagsPolicy !== def.privateTagsPolicy) return true;
  if ((cfg.tagWhitelist || "").trim() !== (def.tagWhitelist || "").trim()) return true;
  if (cfg.structuredContentPolicy !== def.structuredContentPolicy) return true;
  if (cfg.newPatientName !== def.newPatientName) return true;
  if (cfg.newPatientId !== def.newPatientId) return true;
  if (cfg.newPatientBirthDate !== def.newPatientBirthDate) return true;
  if (cfg.newAccessionNumber !== def.newAccessionNumber) return true;
  if ((cfg.newPatientSex || "") !== def.newPatientSex) return true;
  if ((cfg.newStudyDescription || "") !== def.newStudyDescription) return true;
  if ((cfg.newSeriesDescription || "") !== def.newSeriesDescription) return true;
  if (cfg.enablePixelRedaction !== def.enablePixelRedaction) return true;
  if (cfg.forceIgnoreBurnedInAnnotation !== def.forceIgnoreBurnedInAnnotation) return true;
  if (cfg.multiFrameRedactionMethod && cfg.multiFrameRedactionMethod !== def.multiFrameRedactionMethod) return true;

  return false;
}

export function getNonDefaultDetails(cfg) {
  if (!cfg) return [];
  const details = [];
  const def = DEFAULT_ANONYMIZER_CONFIG;

  if (cfg.remapUids === false) {
    details.push("Original DICOM UIDs preserved (not remapped)");
  }
  if (cfg.keepDates === true) {
    details.push("Original study dates kept (not shifted)");
  }
  if (cfg.keepExactTimes === true) {
    details.push("Exact acquisition clock times kept");
  }
  if (cfg.keepDescriptors === true) {
    details.push("Study/series descriptions and protocol names kept");
  } else {
    if (cfg.keepSeriesDescriptors === true) details.push("Series descriptions kept");
    if (cfg.keepProtocolName === true) details.push("Protocol names kept");
  }
  if (cfg.keepPhysicians === true) {
    details.push("Physician and staff names kept");
  }
  if (cfg.keepAcquisitionParameters === true) {
    details.push("Technical imaging and scanner parameters kept");
  }
  if (cfg.keepComments === true) {
    details.push("Study and image text notes kept");
  }
  if (cfg.keepOverlays === true) {
    details.push("Graphic overlay annotations kept");
  }
  if (cfg.keepCurves === true) {
    details.push("Waveform and ECG curve data kept");
  }
  if (cfg.keepPatientCharacteristics === true) {
    details.push("Patient age, sex, height, and weight kept");
  }
  if (cfg.keepDeviceIdentity === true) {
    details.push("Scanner and equipment identity kept");
  }
  if (cfg.keepInstitutionIdentity === true) {
    details.push("Hospital and institution identity kept");
  }
  if (cfg.privateTagsPolicy === "keep_safe") {
    details.push("Safe scanner vendor private tags kept");
  } else if (cfg.privateTagsPolicy === "keep_all") {
    details.push("ALL private vendor tags kept (high risk)");
  }
  if ((cfg.tagWhitelist || "").trim()) {
    details.push(`Custom Tag Whitelist active (${parseTagWhitelist(cfg.tagWhitelist).length} tag(s))`);
  }
  if (cfg.structuredContentPolicy === "sanitize") {
    details.push("Structured report content kept (sanitized text)");
  }
  if (cfg.newPatientName !== def.newPatientName || cfg.newPatientId !== def.newPatientId) {
    details.push(`Custom Patient ID/Name override ("${cfg.newPatientId}" / "${cfg.newPatientName}")`);
  }
  if (cfg.newPatientBirthDate) {
    details.push(`Custom Patient Birth Date override ("${cfg.newPatientBirthDate}")`);
  }
  if (cfg.newAccessionNumber) {
    details.push(`Custom Accession Number override ("${cfg.newAccessionNumber}")`);
  }
  if (cfg.newPatientSex) {
    details.push(`Custom Patient Sex override ("${cfg.newPatientSex}")`);
  }
  if (cfg.newStudyDescription) {
    details.push(`Custom Study Description override ("${cfg.newStudyDescription}")`);
  }
  if (cfg.newSeriesDescription) {
    details.push(`Custom Series Description override ("${cfg.newSeriesDescription}")`);
  }
  if (cfg.enablePixelRedaction === false) {
    details.push("Visual image text redaction (OCR) disabled");
  }
  if (cfg.forceIgnoreBurnedInAnnotation === true) {
    details.push("Force visual text redaction active (always scan & redact pixel data)");
  }
  if (cfg.multiFrameRedactionMethod === "aggressive") {
    details.push("Multi-frame pixel redaction pre-set to Aggressive (full sequential scan)");
  } else if (cfg.multiFrameRedactionMethod === "sampling") {
    details.push("Multi-frame pixel redaction pre-set to Sampling (key-frame scan)");
  }

  return details;
}

export function parseTagWhitelist(text) {
  if (!text) return [];
  const tokens = String(text).split(/[\n,;\s]+/);
  const results = [];
  const seen = {};

  tokens.forEach(token => {
    const clean = token.trim().replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
    if (clean.length === 8 && !seen[clean]) {
      seen[clean] = true;
      const info = formatTagWithLabel(clean);
      results.push(info);
    }
  });

  return results;
}

export function formatTagWithLabel(rawTag) {
  const clean = String(rawTag || "").trim().replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (clean.length !== 8) {
    return { valid: false, raw: rawTag, clean: "", formattedTag: rawTag, name: "Invalid Tag Format" };
  }
  const group = clean.substring(0, 4);
  const element = clean.substring(4, 8);
  const formattedTag = `(${group},${element})`;
  const rule = anonymizerRules[clean];
  let name = rule && rule.name ? rule.name : "";
  if (!name) {
    const groupNum = parseInt(group, 16);
    if (groupNum % 2 !== 0) {
      name = "Private Attribute (Vendor Specific)";
    } else {
      name = "Unknown DICOM Attribute";
    }
  }
  return {
    valid: true,
    raw: rawTag,
    clean,
    formattedTag,
    name
  };
}

export function getCommonWhitelistedTags() {
  return [
    { tag: "00100040", name: "Patient's Sex" },
    { tag: "0008103E", name: "Series Description" },
    { tag: "00181030", name: "Protocol Name" },
    { tag: "00180015", name: "Body Part Examined" },
    { tag: "00180010", name: "Contrast/Bolus Agent" },
    { tag: "00180050", name: "Slice Thickness" },
    { tag: "00180600", name: "KVP / Exposure" },
    { tag: "00080090", name: "Referring Physician's Name" },
    { tag: "00204000", name: "Image Comments" }
  ];
}

export function getPresets() {
  return [
    {
      id: "strict",
      name: "🛡️ Strict Client Profile (Default)",
      description: "Removes configured identifiers, remaps UIDs, shifts dates, and removes private attributes. Unsupported or unverified pixel processing fails closed.",
      config: { ...DEFAULT_ANONYMIZER_CONFIG }
    },
    {
      id: "research",
      name: "🔬 Research Profile",
      description: "Replaces patient identifiers and shifts dates, but keeps imaging parameters, series descriptions, and safe scanner metadata.",
      config: {
        ...DEFAULT_ANONYMIZER_CONFIG,
        keepSeriesDescriptors: true,
        keepProtocolName: true,
        keepAcquisitionParameters: true,
        privateTagsPolicy: "keep_safe",
        structuredContentPolicy: "sanitize"
      }
    },
    {
      id: "retain_dates",
      name: "📅 Keep Dates & Clinical Text",
      description: "Replaces patient identifiers and DICOM UIDs, but keeps original study dates, clinical descriptions, and physician names.",
      config: {
        ...DEFAULT_ANONYMIZER_CONFIG,
        keepDates: true,
        keepExactTimes: true,
        keepDescriptors: true,
        keepPhysicians: true
      }
    },
    {
      id: "preserve_all",
      name: "⚠️ Minimal Anonymization (Unsafe)",
      description: "Replaces primary patient name and ID, but keeps original dates, DICOM UIDs, descriptions, equipment, and private vendor tags.",
      config: {
        ...DEFAULT_ANONYMIZER_CONFIG,
        remapUids: false,
        keepDates: true,
        keepExactTimes: true,
        keepDescriptors: true,
        keepPhysicians: true,
        keepAcquisitionParameters: true,
        keepComments: true,
        keepOverlays: true,
        keepCurves: true,
        keepPatientCharacteristics: true,
        keepDeviceIdentity: true,
        keepInstitutionIdentity: true,
        privateTagsPolicy: "keep_all"
      }
    }
  ];
}
