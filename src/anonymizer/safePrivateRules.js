/**
 * Copyright (c) 2001-2026 David A. Clunie DBA PixelMed Publishing.
 * Ported to JavaScript for OHIF Download Manager by Nick Hermans (UZ Leuven).
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Auto-derived (mechanical port) from PixelMed
 * com.pixelmed.dicom.ClinicalTrialsAttributes.isSafePrivateAttribute(String,AttributeTag).
 */
export const safePrivateRules = {
  "ELSCINT1": {
    "00e1": { elements: ["21", "50"], ranges: [] },
    "01e1": { elements: ["26"], ranges: [] },
    "01f1": { elements: ["01", "07", "26", "27"], ranges: [] },
  },
  "Eigen Artemis": {
    "1129": { elements: ["04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "15", "16", "17", "18", "19", "20", "21", "23", "24", "25", "26", "27", "29", "30", "31", "32", "33", "36", "37", "38", "39", "40", "41", "70", "71", "72", "73", "74", "75", "76", "78", "79", "80", "81", "82"], ranges: [] },
  },
  "GEIIS PACS": {
    "0903": { elements: ["10", "11", "12", "01", "02"], ranges: [] },
  },
  "GEMS_ACQU_01": {
    "0019": { elements: ["23", "24", "27", "9e"], ranges: [] },
  },
  "GEMS_HELIOS_01": {
    "0045": { elements: ["01", "02"], ranges: [] },
  },
  "GEMS_IDI_01": {
    "0073": { elements: ["20", "21", "30", "31", "32", "40", "50"], ranges: [] },
  },
  "GEMS_PARM_01": {
    "0043": { elements: ["27", "6f"], ranges: [] },
  },
  "GEMS_SENO_02": {
    "0045": { elements: ["06", "1b", "20", "27", "29", "2a", "2b", "49", "58", "59", "60", "61", "62", "63", "64", "71", "72", "90", "a0", "a1", "a2", "a4", "a7", "a8", "ab", "ac", "ad"], ranges: [] },
  },
  "GEMS_SERS_01": {
    "0025": { elements: ["07"], ranges: [] },
  },
  "HOLOGIC, Inc.": {
    "0019": { elements: ["06", "07", "08", "16", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "37", "40", "41", "42", "43", "44", "45", "46", "50", "51", "52", "53", "60", "61", "62", "70", "71", "80", "85", "87", "89", "8a", "90", "97", "98"], ranges: [] },
  },
  "LORAD Selenia": {
    "0019": { elements: ["06", "07", "08", "16", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "37", "40", "41", "50", "51", "52", "53", "60", "70", "71", "80", "90"], ranges: [] },
  },
  "NQHeader": {
    "0099": { elements: ["01", "04", "05", "10", "20", "21"], ranges: [] },
  },
  "NQLeft": {
    "0199": { elements: [], ranges: [["01", "3a"]] },
  },
  "NQRight": {
    "0299": { elements: [], ranges: [["01", "3a"]] },
  },
  "PHILIPS MR IMAGING DD 001": {
    "2005": { elements: ["0d", "0e"], ranges: [] },
  },
  "Philips MR Imaging DD 001": {
    "2005": { elements: ["0d", "0e"], ranges: [] },
  },
  "Philips PET Private Group": {
    "7053": { elements: ["00", "09"], ranges: [] },
  },
  "Philips US Imaging DD 023": {
    "200d": { elements: ["45"], ranges: [] },
  },
  "Philips US Imaging DD 033": {
    "200d": { elements: ["00", "01", "02", "03", "04", "05", "06", "07", "08", "0d", "0f", "10", "11", "14", "21"], ranges: [] },
  },
  "Philips US Imaging DD 034": {
    "200d": { elements: ["01", "02", "03", "04", "05", "08", "09", "0a", "0b", "0c", "0d", "0e", "0f", "10", "11", "12", "13", "14", "17", "18", "1b", "1c", "1d", "1e", "1f", "20", "21", "22", "23", "24", "25", "26", "27", "28"], ranges: [] },
  },
  "Philips US Imaging DD 035": {
    "200d": { elements: ["01", "03", "04", "07", "08", "09", "0a", "0c", "0d"], ranges: [] },
  },
  "Philips US Imaging DD 036": {
    "200d": { elements: ["15", "16", "17", "18", "19", "20"], ranges: [] },
  },
  "Philips US Imaging DD 038": {
    "200d": { elements: ["01", "02", "03", "04"], ranges: [] },
  },
  "Philips US Imaging DD 039": {
    "200d": { elements: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "0a", "0b", "0c", "0d", "15"], ranges: [] },
  },
  "Philips US Imaging DD 040": {
    "200d": { elements: ["01", "02", "03", "04", "05", "06", "07", "20"], ranges: [] },
  },
  "Philips US Imaging DD 042": {
    "200d": { elements: ["15", "16", "20", "30", "31", "40", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "5a", "5b", "5c", "5d", "5e", "5f", "60", "70", "71", "72", "73", "74", "75", "76", "77", "78", "8c"], ranges: [] },
  },
  "Philips US Imaging DD 045": {
    "200d": { elements: ["f1", "f3", "f4", "f5", "f6", "f8", "fa", "fb"], ranges: [] },
  },
  "Philips US Imaging DD 046": {
    "200d": { elements: ["17"], ranges: [] },
  },
  "Philips US Imaging DD 048": {
    "200d": { elements: ["01"], ranges: [] },
  },
  "Philips US Imaging DD 065": {
    "200d": { elements: ["07"], ranges: [] },
  },
  "Philips US Imaging DD 066": {
    "200d": { elements: ["00", "01", "03", "04"], ranges: [] },
  },
  "SIEMENS SYNGO ULTRA-SOUND TOYON DATA STREAMING": {
    "7fd1": { elements: ["01", "09", "10", "11"], ranges: [] },
  },
  "SIEMENS Ultrasound SC2000": {
    "0119": { elements: ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "21"], ranges: [] },
    "0129": { elements: ["00", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "20", "21", "22", "29", "30"], ranges: [] },
    "0139": { elements: ["01"], ranges: [] },
    "0149": { elements: ["01", "02", "03"], ranges: [] },
    "7fd1": { elements: ["01", "09", "10", "11"], ranges: [] },
  },
};
