/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * DICOM Constants, Transfer Syntaxes, SOP Classes, and VR Definitions.
 */

export const TRANSFER_SYNTAX_UIDS = {
  IMPLICIT_VR_LITTLE_ENDIAN: "1.2.840.10008.1.2",
  EXPLICIT_VR_LITTLE_ENDIAN: "1.2.840.10008.1.2.1",
  EXPLICIT_VR_BIG_ENDIAN: "1.2.840.10008.1.2.2",
  JPEG_BASELINE_8BIT: "1.2.840.10008.1.2.4.50",
  JPEG_EXTENDED_12BIT: "1.2.840.10008.1.2.4.51",
  JPEG_LOSSLESS_PROCESS_14: "1.2.840.10008.1.2.4.57",
  JPEG_LOSSLESS_SV1: "1.2.840.10008.1.2.4.70",
  JPEGLS_LOSSLESS: "1.2.840.10008.1.2.4.80",
  JPEGLS_LOSSY: "1.2.840.10008.1.2.4.81",
  JPEG2000_LOSSLESS: "1.2.840.10008.1.2.4.90",
  JPEG2000_LOSSY: "1.2.840.10008.1.2.4.91",
  HTJ2K_LOSSLESS: "1.2.840.10008.1.2.4.201",
  HTJ2K_LOSSLESS_RPCL: "1.2.840.10008.1.2.4.202",
  HTJ2K_LOSSY: "1.2.840.10008.1.2.4.203",
  RLE_LOSSLESS: "1.2.840.10008.1.2.5",
};

export const EXPLICIT_VR_LITTLE_ENDIAN = TRANSFER_SYNTAX_UIDS.EXPLICIT_VR_LITTLE_ENDIAN;
export const IMPLEMENTATION_CLASS_UID = '2.25.80302813137786398554742050926734630921603366648225212145404';

// Hexadecimal tag key regex for dcmjs naturalized datasets
export const RAW_TAG_KEY = /^[0-9A-Fa-f]{8}$/;

// Non-DICOM metadata keys attached by OHIF or viewer state
export const NON_DICOM_METADATA_KEYS = [
  'url',
  'imageId',
  'wadouri',
  'wadorsuri',
  'wadoRoot',
  'wadoUri',
  'localFile',
];

// Internal dcmjs metadata keys that preserve VR context
export const DCMJS_META_KEYS = ['_vrMap', '_meta'];

// Ambiguous VR codes & maps per DICOM PS3.6
export const AMBIGUOUS_VR_CODES = { xs: 'US|SS', lt: 'US|OW' };
export const AMBIGUOUS_VR = /\||^(xs|lt)$/;
export const BINARY_VRS = new Set(['OB', 'OW', 'UN', 'OF', 'OD', 'OL', 'OV']);

// Standard frame retrieval accept header strings
export const DICOM_FRAME_ACCEPT_HEADER = [
  'multipart/related; type="image/jls"; transfer-syntax=*',
  'multipart/related; type="image/dicom-rle"; transfer-syntax=*',
  'multipart/related; type="image/jpeg"; transfer-syntax=*',
  'multipart/related; type="image/jp2"; transfer-syntax=*',
  'multipart/related; type="image/jpx"; transfer-syntax=*',
  'multipart/related; type="image/jphc"; transfer-syntax=*',
  'multipart/related; type="application/octet-stream"; transfer-syntax=*',
].join(', ');

export const MEDIA_TYPE_TRANSFER_SYNTAXES = {
  'application/octet-stream': EXPLICIT_VR_LITTLE_ENDIAN,
  'image/dicom-rle': TRANSFER_SYNTAX_UIDS.RLE_LOSSLESS,
  'image/jpeg': TRANSFER_SYNTAX_UIDS.JPEG_LOSSLESS_SV1,
  'image/jls': TRANSFER_SYNTAX_UIDS.JPEGLS_LOSSLESS,
  'image/jp2': TRANSFER_SYNTAX_UIDS.JPEG2000_LOSSLESS,
  'image/jpx': TRANSFER_SYNTAX_UIDS.JPEG2000_LOSSY,
  'image/jphc': TRANSFER_SYNTAX_UIDS.HTJ2K_LOSSLESS,
};
