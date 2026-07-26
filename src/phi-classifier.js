/**
 * DICOM-Aware PHI Classifier for OCR Pixel Redaction (RSNA Anonymizer Standard)
 * Compares recognized OCR text strings against DICOM header metadata,
 * regex patterns (dates, phone numbers, emails, MRNs), PHI label adjacency,
 * and safe clinical/measurement whitelists.
 * Disambiguates Protected Health Information (PHI) from clinical measurement text.
 */

export function normalizePhi(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

// Levenshtein distance for fuzzy matching OCR character misreadings (e.g. 0 vs O, 1 vs I/L, 5 vs S)
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1,   // insertion
            matrix[i - 1][j] + 1    // deletion
          )
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function fuzzyMatch(str, target, maxDistance = 2) {
  const normStr = normalizePhi(str);
  const normTarget = normalizePhi(target);
  if (!normStr || !normTarget) return false;
  if (normStr === normTarget) return true;
  if (normTarget.length >= 4 && normStr.length >= 4) {
    if (normStr.includes(normTarget) || normTarget.includes(normStr)) return true;
    const dist = levenshteinDistance(normStr, normTarget);
    if (dist <= maxDistance && dist / Math.max(normStr.length, normTarget.length) <= 0.35) {
      return true;
    }
  }
  return false;
}

const PHI_LABELS = new Set([
  "NAME",
  "PATIENT",
  "PATIENTNAME",
  "PATIENTID",
  "PAT",
  "DOB",
  "BIRTH",
  "BIRTHDATE",
  "MRN",
  "SSN",
  "ACC",
  "ACCESSION",
  "PHYSICIAN",
  "DOCTOR",
  "OPERATOR",
  "HOSPITAL",
  "CLINIC",
  "DEPT",
  "DEPARTMENT"
]);

const SAFE_TOKENS = new Set([
  "-",
  "+",
  "=",
  ".",
  ",",
  ":",
  ";",
  "/",
  "\\",
  "|",
  "_",
  "*",
  "°",
  "%",
  "L",
  "R",
  "AP",
  "PA",
  "LAT",
  "MED",
  "SUP",
  "INF",
  "PROX",
  "DIST",
  "ANT",
  "POST",
  "RT",
  "LT",
  "MHZ",
  "GHZ",
  "KHZ",
  "HZ",
  "DB",
  "CM",
  "MM",
  "M",
  "KM",
  "IN",
  "FT",
  "KG",
  "G",
  "LB",
  "FPS",
  "GAIN",
  "DEPTH",
  "MI",
  "TIB",
  "TIC",
  "TIS",
  "FR",
  "DR",
  "PRF",
  "PRR",
  "KV",
  "KVP",
  "MA",
  "MAS",
  "MS",
  "SL",
  "SP",
  "FOV",
  "ST",
  "MONO",
  "COLOR",
  "SCALE",
  "GRADIENT",
  "MEASURE",
  "MEASUREMENT",
  "CALIPER",
  "TICKS",
  "BAR",
  "ZOOM",
  "ANGLE",
  "AREA",
  "VOL",
  "VOLUME",
  "STD",
  "MEAN",
  "MAX",
  "MIN",
  "US",
  "CT",
  "MR",
  "DX",
  "CR",
  "XA",
  "RF",
  "NM",
  "PT",
  "MG",
  "LIVER",
  "KIDNEY",
  "AORTA",
  "HEART",
  "SPLEEN",
  "GALLBLADDER",
  "PANCREAS",
  "BRAIN",
  "LUNG",
  "BREAST",
  "PROSTATE",
  "BLADDER",
  "THYROID",
  "SPINE",
  "CAROTID",
  "FEMORAL"
]);

const MEASUREMENT_REGEX = /^\s*[-+]?\d+(\.\d+)?\s*(CM|MM|M|HZ|KHZ|MHZ|GHZ|DB|KV|KVP|MA|MAS|FPS|MS|S|G|KG|LB|DEG|DEGREE|°|%|B|M|D|2D|3D|CC|ML|BPM|MMHG|CM2|CM3|MM2|MM3)\b/i;

function isSafeToken(text, normText) {
  const cleanUpper = (text || "").toUpperCase().trim();
  if (SAFE_TOKENS.has(cleanUpper) || SAFE_TOKENS.has(normText)) {
    return true;
  }
  if (MEASUREMENT_REGEX.test(cleanUpper) || MEASUREMENT_REGEX.test(text)) {
    return true;
  }
  // Diagnostic measurement pattern check (e.g. "5.2 CM", "120 KVP", "MI 1.2", "GAIN 0DB")
  if (/^\s*(MI|TIB|TIC|TIS|GAIN|DR|FR|PRF|D)\s*[-+]?\d+(\.\d+)?/i.test(cleanUpper)) {
    return true;
  }
  return false;
}

const DATE_REGEX = /\b(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4}|\d{8}|\d{1,2}-[A-Z]{3}-\d{2,4})\b/i;
const PHONE_REGEX = /\b(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const MRN_ID_REGEX = /\b(MRN|PATIENTID|PATIENT_ID|ID|SSN|ACC|ACCESSION)\s*[:#]?\s*([A-Z0-9-]+)\b/i;

export function extractMetadataValues(dict) {
  const metadata = [];

  function addVal(tag) {
    const el = dict[tag];
    if (!el || !el.Value) return;
    for (const item of el.Value) {
      let str = "";
      if (typeof item === "string" && item.trim()) {
        str = item.trim();
      } else if (item && typeof item === "object") {
        if (item.Alphabetic) str = String(item.Alphabetic).trim();
      }
      if (str) {
        metadata.push(str);
        // Tokenize name components (e.g. ABUKHATER^AMANI -> ABUKHATER, AMANI)
        const parts = str.split(/[\^,\/\-\_\s]+/);
        for (const p of parts) {
          if (p.length >= 2) metadata.push(p);
        }
      }
    }
  }

  // Patient identifiers
  addVal("00100010"); // PatientName
  addVal("00100020"); // PatientID
  addVal("00101000"); // OtherPatientIDs
  addVal("00100030"); // PatientBirthDate
  addVal("00080050"); // AccessionNumber
  addVal("00200010"); // StudyID

  // Physicians
  addVal("00080090"); // ReferringPhysicianName
  addVal("00081050"); // PerformingPhysicianName
  addVal("00081070"); // OperatorsName
  addVal("00081048"); // PhysiciansOfRecord

  // Institution & Device
  addVal("00080080"); // InstitutionName
  addVal("00081040"); // InstitutionalDepartmentName
  addVal("00181010"); // StationName
  addVal("00181000"); // DeviceSerialNumber

  return metadata;
}

export function classifyPhiInOcrResults(findings, metadataValues, options = {}) {
  const normalizedMetadata = metadataValues
    .map(v => normalizePhi(v))
    .filter(v => v.length >= 2);

  const classified = findings.map(item => {
    const text = (item.text || "").trim();
    const normText = normalizePhi(text);
    const reasons = [];
    let phiScore = 0;

    // 1. Direct DICOM metadata match / fuzzy match check
    let isDirectMetaMatch = false;
    for (const metaNorm of normalizedMetadata) {
      if (metaNorm.length >= 2 && fuzzyMatch(normText, metaNorm)) {
        isDirectMetaMatch = true;
        phiScore = 100;
        reasons.push(`Direct match with DICOM metadata ("${metaNorm}")`);
        break;
      }
    }

    if (!isDirectMetaMatch) {
      // 2. Safe token / measurement / non-PHI symbol check
      if (!text || normText.length === 0 || isSafeToken(text, normText)) {
        return {
          ...item,
          phiScore: 0,
          reasons: ["Non-PHI measurement or clinical technical label"],
          decision: "keep"
        };
      }

      // 3. Pattern detection
      if (DATE_REGEX.test(text)) {
        phiScore = Math.max(phiScore, 90);
        reasons.push("Matches Date pattern");
      }
      if (PHONE_REGEX.test(text)) {
        phiScore = Math.max(phiScore, 95);
        reasons.push("Matches Phone number pattern");
      }
      if (EMAIL_REGEX.test(text)) {
        phiScore = Math.max(phiScore, 100);
        reasons.push("Matches Email address pattern");
      }
      if (MRN_ID_REGEX.test(text)) {
        phiScore = Math.max(phiScore, 95);
        reasons.push("Matches MRN/Patient ID pattern");
      }

      // 4. PHI Label check
      const rawWords = text.toUpperCase().split(/[\s_:\-\^\/\,\.\[\]]+/);
      for (const rawWord of rawWords) {
        const cleanWord = rawWord.replace(/[^A-Z]/g, "");
        if (cleanWord.length >= 3 && PHI_LABELS.has(cleanWord)) {
          phiScore = Math.max(phiScore, 85);
          reasons.push(`Contains PHI label ("${cleanWord}")`);
        }
      }
    }

    const decision = phiScore >= 50 ? "redact" : "keep";

    return {
      ...item,
      phiScore,
      reasons,
      decision
    };
  });

  // 5. Label adjacency pass
  classified.sort((a, b) => {
    if (a.frameIndex !== b.frameIndex) return a.frameIndex - b.frameIndex;
    const yDiff = a.bbox.y - b.bbox.y;
    if (Math.abs(yDiff) > 10) return yDiff;
    return a.bbox.x - b.bbox.x;
  });

  for (let i = 0; i < classified.length - 1; i++) {
    const current = classified[i];
    const next = classified[i + 1];

    if (
      current.frameIndex === next.frameIndex &&
      Math.abs(current.bbox.y - next.bbox.y) <= 15 &&
      next.bbox.x > current.bbox.x &&
      (next.bbox.x - (current.bbox.x + current.bbox.w)) <= 50
    ) {
      const isLabel = current.reasons.some(r => r.includes("PHI label"));
      if (isLabel && next.decision === "keep" && !isSafeToken(next.text, normalizePhi(next.text))) {
        next.phiScore = 90;
        next.decision = "redact";
        next.reasons.push(`Adjacent to PHI label "${current.text}"`);
      }
    }
  }

  return classified;
}
