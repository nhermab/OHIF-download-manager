import { state, currentPayload } from './state.js';
import { getDownloadAvailabilityMessage } from './ohif-state.js';
import {
  flattenSeries,
  buildManifest,
  seriesRow,
  studyLabel,
  modalityCodeForEntry,
  modalityDisplayName,
} from './manifest.js';
import { escapeHtml, shortUid, errorMessage, formatBytes, formatDuration } from './utils.js';
import {
  canUseFolderWriter,
  defaultOutputMethod,
  folderTipMarkup,
  startDownload,
  issueForError,
} from './downloader.js';
import {
  loadAnonymizerConfig,
  saveAnonymizerConfig,
  loadAnonymizerEnabled,
  saveAnonymizerEnabled,
  isNonDefaultConfig,
  getNonDefaultDetails,
  getPresets,
  parseTagWhitelist,
  getCommonWhitelistedTags,
  DEFAULT_ANONYMIZER_CONFIG,
} from './anonymizer-config.js';

export function openDialog() {
  const payload = currentPayload();
  const overlay = createOverlay();
  const dialog = overlay.querySelector('.aquest-dm-dialog');
  if (!payload) {
    renderUnavailable(dialog);
  } else {
    renderSelection(dialog, payload);
  }
  document.body.appendChild(overlay);
}

export function createOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'aquest-dm-overlay';
  overlay.innerHTML =
    '<div class="aquest-dm-dialog" role="dialog" aria-modal="true" aria-labelledby="aquest-dm-title"></div>';
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeDialog();
    }
  });
  document.addEventListener('keydown', closeOnEscape);
  return overlay;
}

export function closeOnEscape(event) {
  if (event.key === 'Escape') {
    closeDialog();
  }
}

export function closeDialog() {
  if (state.activeAbortController) {
    state.activeAbortController.abort();
    state.activeAbortController = null;
  }
  document.removeEventListener('keydown', closeOnEscape);
  const overlay = document.querySelector('.aquest-dm-overlay');
  if (overlay) {
    overlay.remove();
  }
}

export function renderUnavailable(dialog) {
  const message =
    getDownloadAvailabilityMessage() ||
    'Your medical images are not ready yet. Please wait until the viewer finishes loading, then try again.';
  dialog.innerHTML = `<div class="aquest-dm-header">
      <h2 class="aquest-dm-title" id="aquest-dm-title">Download medical images</h2>
    </div>
    <div class="aquest-dm-body">
      <div class="aquest-dm-error">${escapeHtml(message)}</div>
    </div>
    <div class="aquest-dm-footer">
      <button type="button" class="aquest-dm-secondary" data-action="close">Close</button>
    </div>`;
  dialog.querySelector('[data-action="close"]').addEventListener('click', closeDialog);
}

export function renderSelection(dialog, payload) {
  const studies = payload.studies || [];
  const allSeries = flattenSeries(studies);
  const modalities = availableModalities(allSeries);
  const totalObjects = allSeries.reduce((sum, series) => sum + buildManifest([series]).length, 0);
  const folderWriterAvailable = canUseFolderWriter();

  dialog.innerHTML = `<div class="aquest-dm-header">
      <h2 class="aquest-dm-title" id="aquest-dm-title">Download medical images</h2>
      <div class="aquest-dm-subtitle">${escapeHtml(studies.length === 1 ? studyLabel(studies[0]) : `${studies.length} exams`)}</div>
    </div>
    <div class="aquest-dm-body">
      <div class="aquest-dm-toolbar">
        <div class="aquest-dm-note"><span data-selected-count></span> selected, ${totalObjects} image file${totalObjects === 1 ? '' : 's'} available</div>
        <div class="aquest-dm-selection-actions">
          <button type="button" class="aquest-dm-link-button" data-action="select-all">Select all</button>
          <button type="button" class="aquest-dm-link-button" data-action="deselect-all">Clear selection</button>
        </div>
      </div>
      ${modalityActionMarkup(modalities)}
      ${folderTipMarkup()}
      ${outputMethodMarkup(folderWriterAvailable)}
      ${anonymizerPanelMarkup()}
      <div class="aquest-dm-series-list">${seriesListMarkup(studies, allSeries)}</div>
    </div>
    <div class="aquest-dm-footer">
      <button type="button" class="aquest-dm-secondary" data-action="close">Cancel</button>
      <button type="button" class="aquest-dm-action" data-action="download">Start download</button>
    </div>`;

  dialog.querySelector('[data-action="close"]').addEventListener('click', closeDialog);

  setupAnonymizerControlPanel(dialog);

  dialog.querySelector('[data-action="select-all"]').addEventListener('click', () => {
    setSelectedEntries(dialog, allSeries, () => true);
  });
  dialog.querySelector('[data-action="deselect-all"]').addEventListener('click', () => {
    setSelectedEntries(dialog, allSeries, () => false);
  });

  dialog.querySelectorAll('[data-action="select-modality"]').forEach(button => {
    button.addEventListener('click', () => {
      const modality = button.getAttribute('data-modality') || '';
      setSelectedEntries(dialog, allSeries, entry => modalityCodeForEntry(entry) === modality);
    });
  });

  dialog.querySelectorAll('[data-action="select-study"]').forEach(button => {
    button.addEventListener('click', () => {
      const studyIndex = Number(button.getAttribute('data-study-index'));
      setSelectedEntries(dialog, allSeries, entry => entry.studyIndex === studyIndex);
    });
  });

  dialog.querySelectorAll('.aquest-dm-series input[type="checkbox"]').forEach(box => {
    box.addEventListener('change', () => {
      updateSelectionSummary(dialog, allSeries);
    });
  });

  dialog.querySelector('[data-action="download"]').addEventListener('click', () => {
    const selected = selectedSeries(dialog, allSeries);
    const anonToggle = dialog.querySelector('#anon-toggle');
    let anonOptions = null;
    if (anonToggle && anonToggle.checked) {
      anonOptions = collectConfigFromInputs(dialog);
    }
    if (selected.length > 0) {
      const outputMethod = dialog.querySelector('input[name="output-method"]:checked')?.value;
      startDownload(dialog, selected, anonOptions, outputMethod);
    }
  });

  updateSelectionSummary(dialog, allSeries);
}

function outputMethodMarkup(folderWriterAvailable) {
  const defaultMethod = defaultOutputMethod();
  return `<fieldset class="aquest-dm-output-method">
    <legend>Save format</legend>
    ${
      folderWriterAvailable
        ? `<label><input type="radio" name="output-method" value="folder" ${defaultMethod === 'folder' ? 'checked' : ''}> Save files to a folder</label>`
        : ''
    }
    <label><input type="radio" name="output-method" value="zip" ${defaultMethod === 'zip' ? 'checked' : ''}> Download a ZIP file</label>
    ${
      folderWriterAvailable
        ? ''
        : '<div class="aquest-dm-note">Your browser does not support saving directly to a folder, so ZIP download is used.</div>'
    }
  </fieldset>`;
}

function anonymizerPanelMarkup() {
  const presets = getPresets();
  const presetButtonsHtml = presets
    .map(
      p =>
        `<button type="button" class="aquest-dm-anon-preset-btn" data-preset="${escapeHtml(p.id)}" title="${escapeHtml(
          p.description
        )}">${escapeHtml(p.name)}</button>`
    )
    .join('');

  const commonTags = getCommonWhitelistedTags();
  const quickTagChipsHtml = commonTags
    .map(
      item =>
        `<button type="button" class="aquest-dm-anon-tag-chip-add" data-add-tag="${escapeHtml(item.tag)}">+ ${escapeHtml(item.name)}</button>`
    )
    .join('');

  return `<div class="aquest-dm-anon-card" id="anon-card">
    <div class="aquest-dm-anon-header-bar">
      <label class="aquest-dm-anon-toggle-label">
        <input type="checkbox" id="anon-toggle">
        <span>Anonymize DICOM metadata</span>
      </label>
      <div id="anon-status-badge" class="aquest-dm-anon-badge"></div>
    </div>
    <div id="anon-warning-container" style="display:none;"></div>
    <div id="anon-inputs" style="display:none;">
      <div class="aquest-dm-anon-presets">
        <span class="aquest-dm-anon-presets-label">Presets:</span>
        ${presetButtonsHtml}
      </div>
      <div class="aquest-dm-anon-body">
        <div class="aquest-dm-anon-tabs">
          <button type="button" class="aquest-dm-anon-tab-btn is-active" data-tab="patient">👤 Patient & Identifiers</button>
          <button type="button" class="aquest-dm-anon-tab-btn" data-tab="dates">📅 Dates & Times</button>
          <button type="button" class="aquest-dm-anon-tab-btn" data-tab="descriptors">📝 Clinical & Descriptors</button>
          <button type="button" class="aquest-dm-anon-tab-btn" data-tab="tags">🔒 Vendor Tags & Whitelist</button>
          <button type="button" class="aquest-dm-anon-tab-btn" data-tab="advanced">⚙️ Advanced Settings</button>
        </div>

        <!-- Tab Content 1: Patient & Identifiers -->
        <div class="aquest-dm-anon-tab-content is-active" data-tab-content="patient">
          <div class="aquest-dm-anon-grid">
            <div class="aquest-dm-anon-field">
              <label for="anon-patient-name">Replacement Patient Name</label>
              <input type="text" id="anon-patient-name" placeholder="ANONYMOUS">
            </div>
            <div class="aquest-dm-anon-field">
              <label for="anon-patient-id">Replacement Patient ID</label>
              <input type="text" id="anon-patient-id" placeholder="ANON1234">
            </div>
            <div class="aquest-dm-anon-field">
              <label for="anon-patient-birthdate">Replacement Birth Date</label>
              <input type="text" id="anon-patient-birthdate" placeholder="YYYYMMDD (Optional)">
            </div>
            <div class="aquest-dm-anon-field">
              <label for="anon-patient-sex">Replacement Patient Sex</label>
              <select id="anon-patient-sex">
                <option value="">Default (Remove / Keep Blank)</option>
                <option value="M">Male (M)</option>
                <option value="F">Female (F)</option>
                <option value="O">Other (O)</option>
              </select>
            </div>
            <div class="aquest-dm-anon-field">
              <label for="anon-accession">Replacement Accession Number</label>
              <input type="text" id="anon-accession" placeholder="Optional (e.g. ACC_ANON)">
            </div>
            <div class="aquest-dm-anon-field">
              <label for="anon-study-desc">Replacement Study Description</label>
              <input type="text" id="anon-study-desc" placeholder="Optional (e.g. ANON_STUDY)">
            </div>
            <div class="aquest-dm-anon-field">
              <label for="anon-series-desc">Replacement Series Description</label>
              <input type="text" id="anon-series-desc" placeholder="Optional (e.g. ANON_SERIES)">
            </div>
          </div>
          <div style="margin-top: 12px;">
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-remap-uids">
              <div>
                <strong>Generate new DICOM Unique Identifiers (UIDs) (Recommended)</strong>
                <div class="aquest-dm-anon-hint">Replaces study, series, and image UIDs with new random identifiers. Uncheck only if original UID references across systems must be preserved.</div>
              </div>
            </label>
          </div>
        </div>

        <!-- Tab Content 2: Dates & Times -->
        <div class="aquest-dm-anon-tab-content" data-tab-content="dates">
          <div class="aquest-dm-anon-checkbox-group">
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-dates">
              <div>
                <strong>Keep original study dates</strong>
                <div class="aquest-dm-anon-hint">Unchecked (default): Shift all study dates by a consistent random offset per patient. Checked: Keep true original study dates.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-exact-times">
              <div>
                <strong>Keep exact clock times</strong>
                <div class="aquest-dm-anon-hint">Unchecked (default): Remove exact acquisition and study clock times to prevent correlation with facility logs. Checked: Keep exact time stamps.</div>
              </div>
            </label>
          </div>
        </div>

        <!-- Tab Content 3: Clinical & Descriptors -->
        <div class="aquest-dm-anon-tab-content" data-tab-content="descriptors">
          <div class="aquest-dm-anon-checkbox-group">
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-descriptors">
              <div>
                <strong>Keep all study & series descriptions and protocol names</strong>
                <div class="aquest-dm-anon-hint">Keep Study Description, Series Description, and Protocol Name.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-series-descriptors">
              <div>
                <strong>Keep series descriptions only</strong>
                <div class="aquest-dm-anon-hint">Keep Series Description (e.g. 'Axial T2'), while removing Study Description.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-protocol">
              <div>
                <strong>Keep protocol names only</strong>
                <div class="aquest-dm-anon-hint">Keep acquisition Protocol Name.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-physicians">
              <div>
                <strong>Keep physician and staff names</strong>
                <div class="aquest-dm-anon-hint">Keep Referring Physician, Performing Physician, and Operator names.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-acq-params">
              <div>
                <strong>Keep technical imaging & scanner parameters</strong>
                <div class="aquest-dm-anon-hint">Keep technical settings (kVp, Slice Thickness, Contrast Agent, TR/TE, Field Strength).</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-comments">
              <div>
                <strong>Keep study and image text notes</strong>
                <div class="aquest-dm-anon-hint">Keep free-text comments attached to studies or images.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-overlays">
              <div>
                <strong>Keep graphic & ROI overlays</strong>
                <div class="aquest-dm-anon-hint">Keep vector graphics and burned-in ROI drawings stored in DICOM Group 60xx.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-curves">
              <div>
                <strong>Keep waveform & ECG curve data</strong>
                <div class="aquest-dm-anon-hint">Keep ECG signals and physiological waveform measurements in DICOM Group 50xx.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-patient-char">
              <div>
                <strong>Keep patient physical traits (age, sex, height, weight)</strong>
                <div class="aquest-dm-anon-hint">Keep patient physical attributes.</div>
              </div>
            </label>
          </div>
          <div class="aquest-dm-anon-grid" style="margin-top: 12px;">
            <div class="aquest-dm-anon-field">
              <label class="aquest-dm-anon-checkbox-item" style="margin-top: 6px;">
                <input type="checkbox" id="anon-aggregate-ages">
                <span>Group ages over 89 as "90" (HIPAA standard)</span>
              </label>
            </div>
            <div class="aquest-dm-anon-field">
              <label for="anon-round-age">Round patient age (Years)</label>
              <input type="number" id="anon-round-age" min="0" max="20" placeholder="5">
            </div>
          </div>
        </div>

        <!-- Tab Content 4: Vendor Tags & Whitelist -->
        <div class="aquest-dm-anon-tab-content" data-tab-content="tags">
          <div class="aquest-dm-anon-whitelist-editor-wrap">
            <div class="aquest-dm-anon-field">
              <label for="anon-private-tags-policy">Private Vendor Tags Policy</label>
              <select id="anon-private-tags-policy">
                <option value="remove_all">Remove All Private Vendor Tags (Default / Safest)</option>
                <option value="keep_safe">Keep Safe Scanner Vendor Tags (Dose, SUV, Calibration)</option>
                <option value="keep_all">Keep ALL Private Vendor Tags (Unsafe - may contain patient info)</option>
              </select>
              <div class="aquest-dm-anon-hint">Private tags are manufacturer-specific DICOM attributes (GE, Siemens, Philips, etc.). Safe Vendor Tags keeps non-identifying quantitative measurements like radiation dose and SUV calibration.</div>
            </div>

            <div class="aquest-dm-anon-field" style="margin-top: 10px;">
              <label for="anon-tag-whitelist">Custom DICOM Tag Whitelist</label>
              <div class="aquest-dm-anon-tag-chips">
                <span style="font-size:11px; color:var(--ohif-text-muted); font-weight:600; align-self:center; margin-right:4px;">Quick Add Tag:</span>
                ${quickTagChipsHtml}
              </div>
              <textarea id="anon-tag-whitelist" class="aquest-dm-anon-whitelist-textarea" rows="4" placeholder="Enter 8-character DICOM tag hex codes (one per line or comma-separated)&#10;e.g.&#10;00100040&#10;0008103E&#10;00181030"></textarea>
              <div class="aquest-dm-anon-hint">Enter DICOM tag hex codes to preserve specific fields. Recognized tags will display below:</div>
            </div>

            <!-- Live Tag Resolver Container -->
            <div id="anon-tag-whitelist-resolved" class="aquest-dm-anon-tag-resolved-list"></div>
          </div>
        </div>

        <!-- Tab Content 5: Advanced Settings -->
        <div class="aquest-dm-anon-tab-content" data-tab-content="advanced">
          <div class="aquest-dm-anon-grid" style="margin-bottom: 10px;">
            <div class="aquest-dm-anon-field">
              <label for="anon-sr-policy">Structured Report (SR) Policy</label>
              <select id="anon-sr-policy">
                <option value="remove">Remove Structured Report Content (Default / Safest)</option>
                <option value="sanitize">Sanitize Structured Report Text (Best-effort text clean)</option>
              </select>
              <div class="aquest-dm-anon-hint">Structured Reports contain clinical measurements, findings, and narrative text.</div>
            </div>
          </div>
          <div class="aquest-dm-anon-checkbox-group">
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-institution">
              <div>
                <strong>Keep hospital & institution identity</strong>
                <div class="aquest-dm-anon-hint">Keep Institution Name, Address, and Department Name.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-keep-device">
              <div>
                <strong>Keep scanner & equipment identity</strong>
                <div class="aquest-dm-anon-hint">Keep Station Name, Scanner Model, Device Serial Number, and Equipment UIDs.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-reject-encapsulated">
              <div>
                <strong>Reject embedded document files (PDF / CDA)</strong>
                <div class="aquest-dm-anon-hint">Block export if DICOM file contains embedded PDF or XML documents that cannot be safely scanned for patient info.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-enable-pixel-redaction">
              <div>
                <strong>Enable visual text redaction on images (OCR)</strong>
                <div class="aquest-dm-anon-hint">Scans image pixels using browser OCR and blackouts burned-in patient text automatically.</div>
              </div>
            </label>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-force-ignore-burned-in">
              <div>
                <strong>Force visual text redaction on all images</strong>
                <div class="aquest-dm-anon-hint">Always scan and redact image pixels, even if the DICOM file does not flag burned-in text.</div>
              </div>
            </label>
            <div class="aquest-dm-anon-field" style="margin-top: 8px;">
              <label for="anon-multiframe-redaction-method">Multi-Frame Redaction Method</label>
              <select id="anon-multiframe-redaction-method">
                <option value="ask">Prompt When Multi-Frame Image Detected (Default)</option>
                <option value="aggressive">Aggressive (Scan All Frames Sequentially - Safest)</option>
                <option value="sampling">Sampling (Scan Key Frames Only - Faster)</option>
              </select>
              <div class="aquest-dm-anon-hint">Controls whether all frames or key frames are scanned for burned-in PHI in multi-frame DICOM clips.</div>
            </div>
            <div class="aquest-dm-anon-field" style="margin-top: 8px;">
              <label for="anon-ocr-performance-mode">OCR Hardware & Performance Mode</label>
              <select id="anon-ocr-performance-mode">
                <option value="balanced">Balanced (Default - Micro-OCR Character Recognition)</option>
                <option value="fast">Fast (Downscale High-Res Frames for Low-Power Devices)</option>
                <option value="thorough">Thorough (Full Resolution Character Scanning)</option>
              </select>
              <div class="aquest-dm-anon-hint">Optimizes browser OCR character recognition speed vs canvas resolution for low-end hardware.</div>
            </div>
            <div class="aquest-dm-anon-redaction-options">
              <label style="font-size: 0.85em; color: #ccc; display: flex; align-items: center; gap: 6px;">
                Redaction Border Style:
                <select id="anon-border-color" style="background: #2c3440; color: #fff; border: 1px solid #455265; border-radius: 4px; padding: 2px 6px; font-size: 0.9em;">
                  <option value="none">No Border (Default)</option>
                  <option value="double">Black & White Double Border</option>
                  <option value="red">Red Border</option>
                  <option value="white">White Border</option>
                  <option value="black">Black Border</option>
                </select>
              </label>
              <label style="font-size: 0.85em; color: #ccc; display: flex; align-items: center; gap: 6px;">
                Width:
                <input type="number" id="anon-border-width" min="0" max="10" value="0" style="width: 45px; background: #2c3440; color: #fff; border: 1px solid #455265; border-radius: 4px; padding: 2px 4px; font-size: 0.9em;"> px
              </label>
            </div>
            <label class="aquest-dm-anon-checkbox-item">
              <input type="checkbox" id="anon-verbose-logging">
              <div>
                <strong>Enable detailed redaction logging</strong>
                <div class="aquest-dm-anon-hint">Prints detailed OCR text matching and pixel redaction statistics to browser console.</div>
              </div>
            </label>
          </div>
        </div>

        <div class="aquest-dm-anon-footer-bar">
          <button type="button" class="aquest-dm-secondary-sm" id="anon-reset-btn">🛡️ Restore Strict Defaults</button>
          <span class="aquest-dm-anon-hint" id="anon-save-status">Saved to browser storage</span>
        </div>
      </div>
    </div>
  </div>`;
}

function setupAnonymizerControlPanel(dialog) {
  const anonCard = dialog.querySelector('#anon-card');
  if (!anonCard) return;

  const anonToggle = dialog.querySelector('#anon-toggle');
  let currentConfig = loadAnonymizerConfig();
  const isEnabled = loadAnonymizerEnabled();

  if (anonToggle) {
    anonToggle.checked = isEnabled;
  }

  populateInputsFromConfig(dialog, currentConfig);
  updateResolvedTagsPreview(dialog);

  const updateUiAndSave = () => {
    currentConfig = collectConfigFromInputs(dialog);
    saveAnonymizerConfig(currentConfig);
    if (anonToggle) {
      saveAnonymizerEnabled(anonToggle.checked);
    }
    updateResolvedTagsPreview(dialog);
    syncAnonymizerUi(dialog, currentConfig, anonToggle ? anonToggle.checked : false);
  };

  if (anonToggle) {
    anonToggle.addEventListener('change', updateUiAndSave);
  }

  // Setup tab switches
  const tabBtns = dialog.querySelectorAll('.aquest-dm-anon-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabTarget = btn.getAttribute('data-tab');
      tabBtns.forEach(b => b.classList.toggle('is-active', b === btn));
      const contents = dialog.querySelectorAll('.aquest-dm-anon-tab-content');
      contents.forEach(c =>
        c.classList.toggle('is-active', c.getAttribute('data-tab-content') === tabTarget)
      );
    });
  });

  // Setup presets
  const presetBtns = dialog.querySelectorAll('.aquest-dm-anon-preset-btn');
  const presets = getPresets();
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const presetId = btn.getAttribute('data-preset');
      const match = presets.find(p => p.id === presetId);
      if (match) {
        currentConfig = { ...match.config };
        populateInputsFromConfig(dialog, currentConfig);
        updateUiAndSave();
      }
    });
  });

  // Setup quick add tag chips
  const tagChipBtns = dialog.querySelectorAll('[data-add-tag]');
  tagChipBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tagToAdd = btn.getAttribute('data-add-tag');
      const textarea = dialog.querySelector('#anon-tag-whitelist');
      if (textarea) {
        const existing = textarea.value.trim();
        textarea.value = existing ? `${existing}\n${tagToAdd}` : tagToAdd;
        updateUiAndSave();
      }
    });
  });

  // Setup inputs change listeners
  const formInputs = dialog.querySelectorAll(
    '#anon-inputs input, #anon-inputs select, #anon-inputs textarea'
  );
  formInputs.forEach(input => {
    input.addEventListener('input', updateUiAndSave);
    input.addEventListener('change', updateUiAndSave);
  });

  // Reset defaults button
  const resetBtn = dialog.querySelector('#anon-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      currentConfig = { ...DEFAULT_ANONYMIZER_CONFIG };
      populateInputsFromConfig(dialog, currentConfig);
      updateUiAndSave();
    });
  }

  syncAnonymizerUi(dialog, currentConfig, isEnabled);
}

function updateResolvedTagsPreview(dialog) {
  const textarea = dialog.querySelector('#anon-tag-whitelist');
  const container = dialog.querySelector('#anon-tag-whitelist-resolved');
  if (!textarea || !container) return;

  const text = textarea.value;
  const parsed = parseTagWhitelist(text);

  if (parsed.length === 0) {
    container.innerHTML =
      '<span class="aquest-dm-anon-hint">No DICOM tags whitelisted yet. Enter tags above or click quick-add buttons.</span>';
    return;
  }

  const html = parsed
    .map(
      item =>
        `<div class="aquest-dm-anon-resolved-tag-pill">
      <span class="aquest-dm-anon-tag-code-text">${escapeHtml(item.formattedTag)}</span>
      <span class="aquest-dm-anon-tag-name-text">— ${escapeHtml(item.name)}</span>
    </div>`
    )
    .join('');

  container.innerHTML = html;
}

function syncAnonymizerUi(dialog, cfg, enabled) {
  const anonCard = dialog.querySelector('#anon-card');
  const anonInputs = dialog.querySelector('#anon-inputs');
  const warningContainer = dialog.querySelector('#anon-warning-container');
  const badge = dialog.querySelector('#anon-status-badge');
  if (!anonCard || !anonInputs || !badge || !warningContainer) return;

  const isNonDef = isNonDefaultConfig(cfg);

  if (enabled) {
    anonInputs.style.display = 'block';
    if (isNonDef) {
      anonCard.classList.add('has-warning');
      badge.textContent = '⚠️ Custom Settings';
      badge.className = 'aquest-dm-anon-badge aquest-dm-anon-badge--warning';

      const details = getNonDefaultDetails(cfg);
      renderWarningBanner(warningContainer, details, () => {
        const defaultCfg = { ...DEFAULT_ANONYMIZER_CONFIG };
        populateInputsFromConfig(dialog, defaultCfg);
        saveAnonymizerConfig(defaultCfg);
        updateResolvedTagsPreview(dialog);
        syncAnonymizerUi(dialog, defaultCfg, true);
      });
    } else {
      anonCard.classList.remove('has-warning');
      badge.textContent = '🛡️ Full Anonymization';
      badge.className = 'aquest-dm-anon-badge aquest-dm-anon-badge--strict';
      warningContainer.style.display = 'none';
      warningContainer.innerHTML = '';
    }
  } else {
    anonInputs.style.display = 'none';
    anonCard.classList.remove('has-warning');
    badge.textContent = 'Off';
    badge.className = 'aquest-dm-anon-badge aquest-dm-anon-badge--disabled';
    warningContainer.style.display = 'none';
    warningContainer.innerHTML = '';
  }

  // Highlight active preset button if matching
  const presetBtns = dialog.querySelectorAll('.aquest-dm-anon-preset-btn');
  const presets = getPresets();
  presetBtns.forEach(btn => {
    const pid = btn.getAttribute('data-preset');
    const preset = presets.find(p => p.id === pid);
    const isActive = preset && !isNonDefaultConfigComparing(cfg, preset.config);
    btn.classList.toggle('is-active', isActive);
  });
}

function isNonDefaultConfigComparing(cfg, target) {
  if (!cfg || !target) return true;
  const keys = Object.keys(target);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (String(cfg[k] || '').trim() !== String(target[k] || '').trim()) {
      return true;
    }
  }
  return false;
}

function renderWarningBanner(container, nonDefaultDetails, onRestoreDefaults) {
  if (!nonDefaultDetails || nonDefaultDetails.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  container.style.display = 'block';
  const itemsHtml = nonDefaultDetails.map(item => `<li>${escapeHtml(item)}</li>`).join('');

  container.innerHTML = `<div class="aquest-dm-anon-warning-banner">
      <div class="aquest-dm-anon-warning-title">
        <span>⚠️</span>
        <span>WARNING: Non-default anonymization options active!</span>
      </div>
      <div class="aquest-dm-anon-warning-text">
        Your current anonymization settings contain non-default retention rules. Selected DICOM metadata will NOT be anonymized and may expose patient-identifiable data (PHI):
      </div>
      <ul class="aquest-dm-anon-warning-list">${itemsHtml}</ul>
      <div style="display:flex; justify-content:flex-end; margin-top:4px;">
        <button type="button" class="aquest-dm-secondary-sm" id="anon-warning-restore-btn">🛡️ Restore Strict Defaults</button>
      </div>
    </div>`;

  const restoreBtn = container.querySelector('#anon-warning-restore-btn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', onRestoreDefaults);
  }
}

function collectConfigFromInputs(dialog) {
  const getValue = (id, fallback) => {
    const el = dialog.querySelector(`#${id}`);
    return el ? el.value : fallback;
  };
  const getChecked = (id, fallback) => {
    const el = dialog.querySelector(`#${id}`);
    return el ? el.checked : fallback;
  };

  return {
    newPatientName: getValue('anon-patient-name', 'ANONYMOUS') || 'ANONYMOUS',
    newPatientId: getValue('anon-patient-id', 'ANON1234') || 'ANON1234',
    newPatientBirthDate: getValue('anon-patient-birthdate', ''),
    newPatientSex: getValue('anon-patient-sex', ''),
    newAccessionNumber: getValue('anon-accession', ''),
    newStudyDescription: getValue('anon-study-desc', ''),
    newSeriesDescription: getValue('anon-series-desc', ''),
    remapUids: getChecked('anon-remap-uids', true),
    keepDates: getChecked('anon-keep-dates', false),
    keepExactTimes: getChecked('anon-keep-exact-times', false),
    keepDescriptors: getChecked('anon-keep-descriptors', false),
    keepSeriesDescriptors: getChecked('anon-keep-series-descriptors', false),
    keepProtocolName: getChecked('anon-keep-protocol', false),
    keepPhysicians: getChecked('anon-keep-physicians', false),
    keepAcquisitionParameters: getChecked('anon-keep-acq-params', false),
    keepComments: getChecked('anon-keep-comments', false),
    keepOverlays: getChecked('anon-keep-overlays', false),
    keepCurves: getChecked('anon-keep-curves', false),
    keepPatientCharacteristics: getChecked('anon-keep-patient-char', false),
    aggregateAgesOver89: getChecked('anon-aggregate-ages', true),
    roundAgeToYears: Number(getValue('anon-round-age', 5)) || 0,
    keepDeviceIdentity: getChecked('anon-keep-device', false),
    keepInstitutionIdentity: getChecked('anon-keep-institution', false),
    privateTagsPolicy: getValue('anon-private-tags-policy', 'remove_all'),
    tagWhitelist: getValue('anon-tag-whitelist', ''),
    structuredContentPolicy: getValue('anon-sr-policy', 'remove'),
    addContributingEquipment: true,
    preserveUidReferences: true,
    rejectEncapsulatedDocuments: getChecked('anon-reject-encapsulated', true),
    rejectEncryptedContent: true,
    enablePixelRedaction: getChecked('anon-enable-pixel-redaction', true),
    forceIgnoreBurnedInAnnotation: getChecked('anon-force-ignore-burned-in', false),
    multiFrameRedactionMethod: getValue('anon-multiframe-redaction-method', 'ask'),
    ocrPerformanceMode: getValue('anon-ocr-performance-mode', 'balanced'),
    borderWidth: Number(getValue('anon-border-width', 0)) || 0,
    borderColor: getValue('anon-border-color', 'none'),
    verboseLogging: getChecked('anon-verbose-logging', false),
  };
}

function populateInputsFromConfig(dialog, cfg) {
  const setValue = (id, val) => {
    const el = dialog.querySelector(`#${id}`);
    if (el) el.value = val === undefined || val === null ? '' : val;
  };
  const setChecked = (id, val) => {
    const el = dialog.querySelector(`#${id}`);
    if (el) el.checked = Boolean(val);
  };

  setValue('anon-patient-name', cfg.newPatientName || 'ANONYMOUS');
  setValue('anon-patient-id', cfg.newPatientId || 'ANON1234');
  setValue('anon-patient-birthdate', cfg.newPatientBirthDate || '');
  setValue('anon-patient-sex', cfg.newPatientSex || '');
  setValue('anon-accession', cfg.newAccessionNumber || '');
  setValue('anon-study-desc', cfg.newStudyDescription || '');
  setValue('anon-series-desc', cfg.newSeriesDescription || '');
  setChecked('anon-remap-uids', cfg.remapUids !== false);
  setChecked('anon-keep-dates', cfg.keepDates === true);
  setChecked('anon-keep-exact-times', cfg.keepExactTimes === true);
  setChecked('anon-keep-descriptors', cfg.keepDescriptors === true);
  setChecked('anon-keep-series-descriptors', cfg.keepSeriesDescriptors === true);
  setChecked('anon-keep-protocol', cfg.keepProtocolName === true);
  setChecked('anon-keep-physicians', cfg.keepPhysicians === true);
  setChecked('anon-keep-acq-params', cfg.keepAcquisitionParameters === true);
  setChecked('anon-keep-comments', cfg.keepComments === true);
  setChecked('anon-keep-overlays', cfg.keepOverlays === true);
  setChecked('anon-keep-curves', cfg.keepCurves === true);
  setChecked('anon-keep-patient-char', cfg.keepPatientCharacteristics === true);
  setChecked('anon-aggregate-ages', cfg.aggregateAgesOver89 !== false);
  setValue('anon-round-age', cfg.roundAgeToYears !== undefined ? cfg.roundAgeToYears : 5);
  setChecked('anon-keep-device', cfg.keepDeviceIdentity === true);
  setChecked('anon-keep-institution', cfg.keepInstitutionIdentity === true);
  setValue('anon-private-tags-policy', cfg.privateTagsPolicy || 'remove_all');
  setValue('anon-tag-whitelist', cfg.tagWhitelist || '');
  setValue('anon-sr-policy', cfg.structuredContentPolicy || 'remove');
  setChecked('anon-reject-encapsulated', cfg.rejectEncapsulatedDocuments !== false);
  setChecked('anon-enable-pixel-redaction', cfg.enablePixelRedaction !== false);
  setChecked('anon-force-ignore-burned-in', cfg.forceIgnoreBurnedInAnnotation === true);
  setValue('anon-multiframe-redaction-method', cfg.multiFrameRedactionMethod || 'ask');
  setValue('anon-ocr-performance-mode', cfg.ocrPerformanceMode || 'balanced');
  setValue('anon-border-width', cfg.borderWidth !== undefined ? cfg.borderWidth : 0);
  setValue('anon-border-color', cfg.borderColor || 'none');
  setChecked('anon-verbose-logging', cfg.verboseLogging !== true);
}

export function seriesListMarkup(studies, allSeries) {
  if (studies.length <= 1) {
    return allSeries.map((entry, index) => seriesRow(entry, index === 0)).join('');
  }
  let html = '';
  studies.forEach((study, studyIndex) => {
    const entries = allSeries.filter(entry => entry.studyIndex === studyIndex);
    if (entries.length === 0) {
      return;
    }
    html += `<div class="aquest-dm-study-header">
        <span class="aquest-dm-study-badge">Exam ${studyIndex + 1} of ${studies.length}</span>
        <span class="aquest-dm-study-label">${escapeHtml(studyLabel(study))}</span>
        <button type="button" class="aquest-dm-link-button aquest-dm-study-select" data-action="select-study" data-study-index="${studyIndex}">Select this exam</button>
      </div>`;
    html += entries.map(entry => seriesRow(entry, allSeries.indexOf(entry) === 0)).join('');
  });
  return html;
}

export function availableModalities(allSeries) {
  const seen = {};
  const result = [];
  allSeries.forEach(entry => {
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

export function modalityActionMarkup(modalities) {
  if (!modalities.length) {
    return '';
  }
  return `<div class="aquest-dm-modality-actions" aria-label="Select by imaging type">
    ${modalities
      .map(
        modality =>
          `<button type="button" class="aquest-dm-chip-button" data-action="select-modality" data-modality="${escapeHtml(
            modality.code
          )}" aria-pressed="false">${escapeHtml(modality.label)}</button>`
      )
      .join('')}
  </div>`;
}

export function setSelectedEntries(dialog, allSeries, predicate) {
  const entriesById = {};
  allSeries.forEach(entry => {
    entriesById[entry.id] = entry;
  });
  dialog.querySelectorAll('.aquest-dm-series input[type="checkbox"]').forEach(box => {
    const entry = entriesById[box.dataset.seriesId];
    box.checked = Boolean(entry && predicate(entry));
  });
  updateSelectionSummary(dialog, allSeries);
}

export function updateSelectionSummary(dialog, allSeries) {
  const selected = selectedSeries(dialog, allSeries);
  const count = selected.reduce((sum, series) => sum + buildManifest([series]).length, 0);
  const selectedIds = {};
  selected.forEach(entry => {
    selectedIds[entry.id] = true;
  });
  const selectedCount = dialog.querySelector('[data-selected-count]');
  const download = dialog.querySelector('[data-action="download"]');
  const selectAll = dialog.querySelector('[data-action="select-all"]');
  const deselectAll = dialog.querySelector('[data-action="deselect-all"]');

  if (selectedCount) {
    selectedCount.textContent = `${count} image file${count === 1 ? '' : 's'}`;
  }
  if (download) {
    download.disabled = count === 0;
  }
  if (selectAll) {
    selectAll.disabled = selected.length === allSeries.length && allSeries.length > 0;
  }
  if (deselectAll) {
    deselectAll.disabled = selected.length === 0;
  }
  updateModalityButtonStates(dialog, allSeries, selectedIds, selected.length);
}

export function updateModalityButtonStates(dialog, allSeries, selectedIds, selectedCount) {
  dialog.querySelectorAll('[data-action="select-modality"]').forEach(button => {
    const modality = button.getAttribute('data-modality') || '';
    const matches = allSeries.filter(entry => modalityCodeForEntry(entry) === modality);
    const isActive =
      matches.length > 0 &&
      matches.length === selectedCount &&
      matches.every(entry => Boolean(selectedIds[entry.id]));
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

export function selectedSeries(dialog, allSeries) {
  const checked = {};
  dialog.querySelectorAll('.aquest-dm-series input[type="checkbox"]:checked').forEach(box => {
    checked[box.dataset.seriesId] = true;
  });
  return allSeries.filter(entry => checked[entry.id]);
}

export function renderComplete(dialog, summary) {
  const logMarkup =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'
      ? dialog.querySelector('[data-log]')?.innerHTML
      : '';
  let details = `${summary.done} saved, ${summary.failed} not saved, ${summary.total} total`;
  if (summary.totalBytes) {
    details += ` • ${formatBytes(summary.totalBytes)}`;
  }
  if (summary.durationMs) {
    details += ` • ${formatDuration(summary.durationMs)}`;
  }

  const title = summary.cancelled
    ? 'Download cancelled'
    : summary.failed > 0
      ? 'Download completed with warnings'
      : 'Download complete';

  const failedItems = summary.failedItems || [];
  const anonWarnings = summary.anonymizationWarnings || [];

  const retryBtnHtml =
    failedItems.length > 0
      ? `<button type="button" class="aquest-dm-action" data-action="retry-failed">Retry failed files (${failedItems.length})</button>`
      : '';

  let warningsHtml = '';
  if (anonWarnings.length > 0) {
    const categoryCounts = {};
    anonWarnings.forEach(entry => {
      const colonIdx = entry.indexOf(': ');
      const msg =
        colonIdx !== -1 && (entry.slice(0, colonIdx).includes('.dcm') || entry.slice(0, colonIdx).includes('SOP'))
          ? entry.slice(colonIdx + 2)
          : entry;
      categoryCounts[msg] = (categoryCounts[msg] || 0) + 1;
    });

    const categoryBullets = Object.entries(categoryCounts)
      .map(
        ([msg, count]) =>
          `<li>${count > 1 ? `<strong>(${count} files)</strong> ` : ''}${escapeHtml(msg)}</li>`
      )
      .join('');

    const itemizedLogHtml =
      anonWarnings.length > 5
        ? `<details style="margin-top:6px;"><summary style="cursor:pointer; font-size:11px; color:var(--ohif-text-muted, #6b7280);">View itemized per-file log (${anonWarnings.length} entries)</summary>
            <pre style="margin-top:4px; max-height:120px; overflow-y:auto; font-size:10px; background:rgba(0,0,0,0.2); padding:6px; border-radius:4px; font-family:monospace;">${escapeHtml(anonWarnings.join('\n'))}</pre>
          </details>`
        : '';

    warningsHtml = `<div class="aquest-dm-tip aquest-dm-tip--warning" style="margin-top:10px;">
        <strong>🛡️ Anonymization Audit & Governance (${anonWarnings.length} note${anonWarnings.length === 1 ? '' : 's'}):</strong>
        <ul style="margin-top:4px; padding-left:16px; font-size:12px;">
          ${categoryBullets}
        </ul>
        ${itemizedLogHtml}
      </div>`;
  }

  const failedDetailsHtml =
    failedItems.length > 0
      ? `<div class="aquest-dm-note" style="margin-top:8px; color:var(--ohif-text-warning, #f59e0b);">
          ⚠️ ${summary.failed} requested file(s) were not saved. The saved files are complete and ready to use. Click retry below to download only the missing files.
        </div>`
      : '';

  dialog.innerHTML = `<div class="aquest-dm-header">
      <h2 class="aquest-dm-title" id="aquest-dm-title">${escapeHtml(title)}</h2>
      <div class="aquest-dm-subtitle">${escapeHtml(details)}</div>
    </div>
    <div class="aquest-dm-body">
      ${failedDetailsHtml}
      ${warningsHtml}
      ${
        logMarkup
          ? `<div class="aquest-dm-label" style="margin-top:10px;">Download log (development)</div>
              <div class="aquest-dm-log" data-log>${logMarkup}</div>`
          : ''
      }
    </div>
    <div class="aquest-dm-footer">
      ${retryBtnHtml}
      <button type="button" class="aquest-dm-secondary" data-action="close">Close</button>
    </div>`;

  dialog.querySelector('[data-action="close"]').addEventListener('click', closeDialog);

  const retryBtn = dialog.querySelector('[data-action="retry-failed"]');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      const itemsToRetry = failedItems.map(f => f.item);
      const outputMethod = dialog.querySelector('input[name="output-method"]:checked')?.value || defaultOutputMethod();
      const anonToggle = dialog.querySelector('#anon-toggle');
      const anonOptions = anonToggle && anonToggle.checked ? collectConfigFromInputs(dialog) : null;
      startDownload(dialog, itemsToRetry, anonOptions, outputMethod);
    });
  }
}

export function renderError(dialog, error) {
  const issue = issueForError(error);
  const stats = state.downloadStats;
  const summary = stats
    ? `<div class="aquest-dm-subtitle">${stats.done} saved, ${stats.failed} not saved before the download stopped.</div>`
    : '';
  const content =
    issue && issue.variant === 'session'
      ? `<div class="aquest-dm-session-error"><span class="aquest-dm-session-error-icon" aria-hidden="true">⛔</span><span class="aquest-dm-session-error-text"><strong>${escapeHtml(
          issue.title
        )}</strong><br>${escapeHtml(issue.message)}</span></div>`
      : `<div class="${issue ? 'aquest-dm-tip aquest-dm-tip--error' : 'aquest-dm-error'}">${escapeHtml(
          issue ? issue.message : errorMessage(error)
        )}</div>`;

  dialog.innerHTML = `<div class="aquest-dm-header">
      <h2 class="aquest-dm-title" id="aquest-dm-title">${escapeHtml(issue ? issue.title : 'Download could not be completed')}</h2>
      ${summary}
    </div>
    <div class="aquest-dm-body">${content}</div>
    <div class="aquest-dm-footer"><button type="button" class="aquest-dm-secondary" data-action="close">Close</button></div>`;
  dialog.querySelector('[data-action="close"]').addEventListener('click', closeDialog);
}
