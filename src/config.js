/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Download Manager configuration constants.
 */

import { PLUGIN_ID } from './constants/app.js';

export const MAX_MULTIFRAME_SELECTION_OPTIONS = 100;
export const PREF_DB_NAME = `${PLUGIN_ID}Prefs`;
export const PREF_DB_STORE = 'handles';
export const PREF_DB_KEY = 'lastDirHandle';

export function config() {
  const cfg = window.config && window.config[PLUGIN_ID];
  return {
    // Client-side anonymization is enabled for this approved deployment. Pixel
    // processing remains fail-closed for unsupported or unverified inputs.
    enabled: true,
    // Explicitly opt in to raw DICOM diagnostics. This may retain identifiable
    // failed instances in memory and exposes controls to download them unchanged.
    devMode: false,
    maxParallel: 3,
    preferFolderWriter: true,
    retryCount: 2,
    zipChunkBytes: 700 * 1024 * 1024,
    zipMaxEntries: 60000,
    ...(cfg || {}),
  };
}

export function isEnabled() {
  return config().enabled !== false;
}
