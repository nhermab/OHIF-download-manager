/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 *
 * Network fetch helpers & URL utilities.
 */

import { state } from "./state.js";
import { updateButtonState } from "./ui.js";

export function isStudyJsonUrl(url) {
  if (!url) {
    return false;
  }
  return /\/api\/studies(\/json)?(?:[?#]|$)/.test(String(url));
}

export function capturePayload(payload, url) {
  if (!payload || !Array.isArray(payload.studies) || payload.studies.length === 0) {
    return;
  }
  state.payload = payload;
  state.sourceUrl = url || state.sourceUrl;
  window.__AQUEST_DOWNLOAD_MANAGER_STUDY_JSON__ = payload;
  updateButtonState();
}

export function tryCaptureText(text, url) {
  if (!text || (text.charAt(0) !== "{" && text.charAt(0) !== "[")) {
    return;
  }
  try {
    const parsed = JSON.parse(text);
    capturePayload(parsed, url);
  } catch (ignore) {
    // Ignore non-study JSON
  }
}

export function requestUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input && typeof input.url === "string") {
    return input.url;
  }
  return "";
}

export function installNetworkCapture() {
  if (window.__AQUEST_DOWNLOAD_MANAGER_CAPTURE_INSTALLED__) {
    return;
  }
  window.__AQUEST_DOWNLOAD_MANAGER_CAPTURE_INSTALLED__ = true;

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const url = requestUrl(args[0]);
      return originalFetch.apply(this, args).then(response => {
        if (isStudyJsonUrl(url) || contentTypeLooksJson(response)) {
          response
            .clone()
            .text()
            .then(text => {
              tryCaptureText(text, url);
            })
            .catch(() => {});
        }
        return response;
      });
    };
  }

  if (window.XMLHttpRequest) {
    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__aquestDmUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };
    window.XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", function () {
        const responseType = this.responseType || "text";
        if (responseType !== "text" && responseType !== "") {
          return;
        }
        if (isStudyJsonUrl(this.__aquestDmUrl)) {
          tryCaptureText(this.responseText, this.__aquestDmUrl);
        }
      });
      return originalSend.apply(this, args);
    };
  }
}

export function contentTypeLooksJson(response) {
  const header = response && response.headers && response.headers.get("content-type");
  return header && header.toLowerCase().includes("application/json");
}
