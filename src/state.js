/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Download Manager reactive state container.
 */

import { PREF_DB_NAME, PREF_DB_STORE, PREF_DB_KEY } from "./config.js";
import { createNamedError } from "./utils.js";
import { buildPayloadFromOhif } from "./ohif-state.js";

export const state = {
  installed: false,
  activeAbortController: null,
  button: null,
  logoutButton: null,
  uiObserver: null,
  mountQueued: false,
  lastDirHandle: null,
  downloadStats: null,
  downloadIssue: null,
  payload: null,
  sourceUrl: null
};

export function openPreferenceDb(callback) {
  if (!window.indexedDB) {
    callback(createNamedError("NotSupportedError", "IndexedDB is unavailable."), null);
    return;
  }
  const request = window.indexedDB.open(PREF_DB_NAME, 1);
  request.onupgradeneeded = event => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains(PREF_DB_STORE)) {
      db.createObjectStore(PREF_DB_STORE);
    }
  };
  request.onsuccess = event => {
    callback(null, event.target.result);
  };
  request.onerror = event => {
    callback(event.target.error || createNamedError("UnknownError", "Unable to open preferences."), null);
  };
}

export function saveLastDirectoryHandle(handle) {
  if (!handle) {
    return;
  }
  try {
    openPreferenceDb((error, db) => {
      if (error || !db) {
        return;
      }
      try {
        const transaction = db.transaction(PREF_DB_STORE, "readwrite");
        transaction.objectStore(PREF_DB_STORE).put(handle, PREF_DB_KEY);
      } catch (ignore) {
        // Structured clone rejection fallback
      }
    });
  } catch (ignore) {
    // Best-effort handle persistence
  }
}

export function loadLastDirectoryHandle() {
  try {
    openPreferenceDb((error, db) => {
      if (error || !db) {
        return;
      }
      try {
        const transaction = db.transaction(PREF_DB_STORE, "readonly");
        const request = transaction.objectStore(PREF_DB_STORE).get(PREF_DB_KEY);
        request.onsuccess = event => {
          state.lastDirHandle = event.target.result || null;
        };
      } catch (ignore) {
        state.lastDirHandle = null;
      }
    });
  } catch (ignore) {
    state.lastDirHandle = null;
  }
}

export function currentPayload() {
  return buildPayloadFromOhif() || state.payload;
}
