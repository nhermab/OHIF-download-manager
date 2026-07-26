import React, { useState } from 'react';
import { Button } from '@ohif/ui-next';
import {
  DEFAULT_ANONYMIZER_CONFIG,
  getPresets,
  getCommonWhitelistedTags,
  parseTagWhitelist,
  isNonDefaultConfig,
  getNonDefaultDetails,
} from '../anonymizer-config';

interface AnonymizerPanelProps {
  config: any;
  enabled: boolean;
  onChangeConfig: (newConfig: any) => void;
  onChangeEnabled: (enabled: boolean) => void;
}

export default function AnonymizerPanel({
  config,
  enabled,
  onChangeConfig,
  onChangeEnabled,
}: AnonymizerPanelProps) {
  const [activeTab, setActiveTab] = useState<
    'patient' | 'dates' | 'descriptors' | 'tags' | 'advanced'
  >('patient');

  const presets = getPresets();
  const commonTags = getCommonWhitelistedTags();
  const isNonDefault = isNonDefaultConfig(config);
  const nonDefaultDetails = isNonDefault ? getNonDefaultDetails(config) : [];
  const parsedTags = parseTagWhitelist(config.tagWhitelist || '');

  const handleFieldChange = (field: string, value: any) => {
    onChangeConfig({
      ...config,
      [field]: value,
    });
  };

  const handleApplyPreset = (presetConfig: any) => {
    onChangeConfig({ ...presetConfig });
  };

  const handleAddTag = (tagToAdd: string) => {
    const existing = (config.tagWhitelist || '').trim();
    const nextVal = existing ? `${existing}\n${tagToAdd}` : tagToAdd;
    handleFieldChange('tagWhitelist', nextVal);
  };

  const handleRestoreDefaults = () => {
    onChangeConfig({ ...DEFAULT_ANONYMIZER_CONFIG });
  };

  return (
    <section className="border-input bg-background text-foreground rounded border text-sm">
      {/* Header Bar */}
      <div className="border-input flex items-center justify-between gap-3 border-b p-3">
        <label className="text-foreground flex cursor-pointer select-none items-center gap-2 font-semibold">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => onChangeEnabled(e.target.checked)}
            className="border-primary text-primary h-4 w-4 rounded"
          />
          <span>Anonymize DICOM metadata</span>
        </label>
        <div>
          {enabled ? (
            isNonDefault ? (
              <span className="flex items-center gap-1 rounded border border-yellow-500/40 bg-yellow-500/10 px-2 py-1 text-xs font-medium text-yellow-500">
                ⚠️ Custom Settings
              </span>
            ) : (
              <span className="border-primary/40 bg-primary/10 text-primary flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium">
                🛡️ Client-side anonymization
              </span>
            )
          ) : (
            <span className="border-input bg-background text-muted-foreground rounded border px-2 py-1 text-xs font-medium">
              Off
            </span>
          )}
        </div>
      </div>

      {enabled && (
        <div className="space-y-3 p-3">
          {/* Warning Banner if Non-Default */}
          {isNonDefault && nonDefaultDetails.length > 0 && (
            <div className="space-y-2 rounded border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs">
              <div className="flex items-center gap-1.5 text-sm font-bold text-yellow-500">
                <span>⚠️</span>
                <span>WARNING: Non-default anonymization options active!</span>
              </div>
              <p className="text-foreground">
                Your current settings preserve original DICOM fields which may expose Patient
                Identifiable Information (PHI):
              </p>
              <ul className="text-foreground list-inside list-disc space-y-0.5 pl-1">
                {nonDefaultDetails.map((detail: string, idx: number) => (
                  <li key={idx}>{detail}</li>
                ))}
              </ul>
              <div className="flex justify-end pt-1">
                <Button
                  onClick={handleRestoreDefaults}
                  variant="outline"
                  size="sm"
                >
                  🛡️ Restore Strict Defaults
                </Button>
              </div>
            </div>
          )}

          {/* Presets Bar */}
          <div className="flex flex-wrap items-center gap-1.5 pb-1 text-xs">
            <span className="text-muted-foreground mr-1 font-medium">Presets:</span>
            {presets.map(p => {
              const isActive = JSON.stringify(p.config) === JSON.stringify(config);
              return (
                <Button
                  key={p.id}
                  type="button"
                  title={p.description}
                  onClick={() => handleApplyPreset(p.config)}
                  variant={isActive ? 'default' : 'outline'}
                  size="sm"
                  className={`text-xs ${isActive ? '' : 'text-muted-foreground'}`}
                >
                  {p.name}
                </Button>
              );
            })}
          </div>

          {/* Tab Controls */}
          <div className="border-input flex overflow-x-auto border-b text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('patient')}
              className={`border-b-2 px-3 py-1.5 transition-colors ${
                activeTab === 'patient'
                  ? 'border-primary text-primary bg-primary/10 font-semibold'
                  : 'text-muted-foreground hover:text-foreground border-transparent'
              }`}
            >
              👤 Patient & Identifiers
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('dates')}
              className={`border-b-2 px-3 py-1.5 transition-colors ${
                activeTab === 'dates'
                  ? 'border-primary text-primary bg-primary/10 font-semibold'
                  : 'text-muted-foreground hover:text-foreground border-transparent'
              }`}
            >
              📅 Dates & Times
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('descriptors')}
              className={`border-b-2 px-3 py-1.5 transition-colors ${
                activeTab === 'descriptors'
                  ? 'border-primary text-primary bg-primary/10 font-semibold'
                  : 'text-muted-foreground hover:text-foreground border-transparent'
              }`}
            >
              📝 Clinical & Descriptors
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tags')}
              className={`border-b-2 px-3 py-1.5 transition-colors ${
                activeTab === 'tags'
                  ? 'border-primary text-primary bg-primary/10 font-semibold'
                  : 'text-muted-foreground hover:text-foreground border-transparent'
              }`}
            >
              🔒 Vendor Tags & Whitelist
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('advanced')}
              className={`border-b-2 px-3 py-1.5 transition-colors ${
                activeTab === 'advanced'
                  ? 'border-primary text-primary bg-primary/10 font-semibold'
                  : 'text-muted-foreground hover:text-foreground border-transparent'
              }`}
            >
              ⚙️ Advanced Settings
            </button>
          </div>

          {/* Tab Content 1: Patient & Identifiers */}
          {activeTab === 'patient' && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-[#8b949e]">
                    Replacement Patient Name
                  </label>
                  <input
                    type="text"
                    value={config.newPatientName || ''}
                    placeholder="ANONYMOUS"
                    onChange={e => handleFieldChange('newPatientName', e.target.value)}
                    className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#8b949e]">
                    Replacement Patient ID
                  </label>
                  <input
                    type="text"
                    value={config.newPatientId || ''}
                    placeholder="ANON1234"
                    onChange={e => handleFieldChange('newPatientId', e.target.value)}
                    className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#8b949e]">
                    Replacement Birth Date
                  </label>
                  <input
                    type="text"
                    value={config.newPatientBirthDate || ''}
                    placeholder="YYYYMMDD (Optional)"
                    onChange={e => handleFieldChange('newPatientBirthDate', e.target.value)}
                    className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#8b949e]">
                    Replacement Patient Sex
                  </label>
                  <select
                    value={config.newPatientSex || ''}
                    onChange={e => handleFieldChange('newPatientSex', e.target.value)}
                    className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Default (Remove / Keep Blank)</option>
                    <option value="M">Male (M)</option>
                    <option value="F">Female (F)</option>
                    <option value="O">Other (O)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#8b949e]">
                    Replacement Accession Number
                  </label>
                  <input
                    type="text"
                    value={config.newAccessionNumber || ''}
                    placeholder="Optional (e.g. ACC_ANON)"
                    onChange={e => handleFieldChange('newAccessionNumber', e.target.value)}
                    className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#8b949e]">
                    Replacement Study Description
                  </label>
                  <input
                    type="text"
                    value={config.newStudyDescription || ''}
                    placeholder="Optional (e.g. ANON_STUDY)"
                    onChange={e => handleFieldChange('newStudyDescription', e.target.value)}
                    className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#8b949e]">
                    Replacement Series Description
                  </label>
                  <input
                    type="text"
                    value={config.newSeriesDescription || ''}
                    placeholder="Optional (e.g. ANON_SERIES)"
                    onChange={e => handleFieldChange('newSeriesDescription', e.target.value)}
                    className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                  <input
                    type="checkbox"
                    checked={config.remapUids !== false}
                    onChange={e => handleFieldChange('remapUids', e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#455265] bg-[#1c2331] text-blue-500 focus:ring-blue-500/30"
                  />
                  <div>
                    <strong className="text-white">
                      Generate new DICOM Unique Identifiers (UIDs) (Recommended)
                    </strong>
                    <p className="mt-0.5 text-[11px] text-[#8b949e]">
                      Replaces study, series, and image UIDs with new random identifiers. Uncheck
                      only if original UID references across systems must be preserved.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Tab Content 2: Dates & Times */}
          {activeTab === 'dates' && (
            <div className="space-y-3 pt-1 text-xs">
              <label className="flex cursor-pointer items-start gap-2.5 rounded border border-transparent p-2 hover:border-[#2b3342] hover:bg-[#1c2331]/50">
                <input
                  type="checkbox"
                  checked={config.keepDates === true}
                  onChange={e => handleFieldChange('keepDates', e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#455265] bg-[#1c2331] text-blue-500 focus:ring-blue-500/30"
                />
                <div>
                  <strong className="text-white">Keep original study dates</strong>
                  <p className="mt-0.5 text-[11px] text-[#8b949e]">
                    Unchecked (default): Shift all study dates by a consistent random offset per
                    patient. Checked: Keep true original study dates.
                  </p>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-2.5 rounded border border-transparent p-2 hover:border-[#2b3342] hover:bg-[#1c2331]/50">
                <input
                  type="checkbox"
                  checked={config.keepExactTimes === true}
                  onChange={e => handleFieldChange('keepExactTimes', e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#455265] bg-[#1c2331] text-blue-500 focus:ring-blue-500/30"
                />
                <div>
                  <strong className="text-white">Keep exact clock times</strong>
                  <p className="mt-0.5 text-[11px] text-[#8b949e]">
                    Unchecked (default): Remove exact acquisition and study clock times to prevent
                    correlation with facility logs. Checked: Keep exact time stamps.
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* Tab Content 3: Clinical & Descriptors */}
          {activeTab === 'descriptors' && (
            <div className="space-y-2.5 pt-1 text-xs">
              {[
                {
                  key: 'keepDescriptors',
                  title: 'Keep all study & series descriptions and protocol names',
                  hint: 'Keep Study Description, Series Description, and Protocol Name.',
                },
                {
                  key: 'keepSeriesDescriptors',
                  title: 'Keep series descriptions only',
                  hint: 'Keep Series Description (e.g. "Axial T2"), while removing Study Description.',
                },
                {
                  key: 'keepProtocolName',
                  title: 'Keep protocol names only',
                  hint: 'Keep acquisition Protocol Name.',
                },
                {
                  key: 'keepPhysicians',
                  title: 'Keep physician and staff names',
                  hint: 'Keep Referring Physician, Performing Physician, and Operator names.',
                },
                {
                  key: 'keepAcquisitionParameters',
                  title: 'Keep technical imaging & scanner parameters',
                  hint: 'Keep technical settings (kVp, Slice Thickness, Contrast Agent, TR/TE, Field Strength).',
                },
                {
                  key: 'keepComments',
                  title: 'Keep study and image text notes',
                  hint: 'Keep free-text comments attached to studies or images.',
                },
                {
                  key: 'keepOverlays',
                  title: 'Keep graphic & ROI overlays',
                  hint: 'Keep vector graphics and burned-in ROI drawings stored in DICOM Group 60xx.',
                },
                {
                  key: 'keepCurves',
                  title: 'Keep waveform & ECG curve data',
                  hint: 'Keep ECG signals and physiological waveform measurements in DICOM Group 50xx.',
                },
                {
                  key: 'keepPatientCharacteristics',
                  title: 'Keep patient physical traits (age, sex, height, weight)',
                  hint: 'Keep patient physical attributes.',
                },
              ].map(item => (
                <label
                  key={item.key}
                  className="flex cursor-pointer items-start gap-2.5 rounded p-1.5 hover:bg-[#1c2331]/50"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(config[item.key])}
                    onChange={e => handleFieldChange(item.key, e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#455265] bg-[#1c2331] text-blue-500 focus:ring-blue-500/30"
                  />
                  <div>
                    <strong className="text-white">{item.title}</strong>
                    <p className="text-[11px] text-[#8b949e]">{item.hint}</p>
                  </div>
                </label>
              ))}

              <div className="grid grid-cols-1 gap-3 border-t border-[#2b3342] pt-2 sm:grid-cols-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.aggregateAgesOver89 !== false}
                    onChange={e => handleFieldChange('aggregateAgesOver89', e.target.checked)}
                    className="h-4 w-4 rounded border-[#455265] bg-[#1c2331] text-blue-500"
                  />
                  <span className="text-[#d1d5db]">
                    Group ages over 89 as "90" (HIPAA standard)
                  </span>
                </label>
                <div>
                  <label className="mb-1 block font-medium text-[#8b949e]">
                    Round patient age (Years)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={config.roundAgeToYears ?? 5}
                    onChange={e =>
                      handleFieldChange('roundAgeToYears', Number(e.target.value) || 0)
                    }
                    className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Tab Content 4: Vendor Tags & Whitelist */}
          {activeTab === 'tags' && (
            <div className="space-y-3 pt-1 text-xs">
              <div>
                <label className="mb-1 block font-medium text-[#8b949e]">
                  Private Vendor Tags Policy
                </label>
                <select
                  value={config.privateTagsPolicy || 'remove_all'}
                  onChange={e => handleFieldChange('privateTagsPolicy', e.target.value)}
                  className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="remove_all">
                    Remove All Private Vendor Tags (Default / Safest)
                  </option>
                  <option value="keep_safe">
                    Keep Safe Scanner Vendor Tags (Dose, SUV, Calibration)
                  </option>
                  <option value="keep_all">
                    Keep ALL Private Vendor Tags (Unsafe - may contain patient info)
                  </option>
                </select>
                <p className="mt-1 text-[11px] text-[#8b949e]">
                  Private tags are manufacturer-specific DICOM attributes (GE, Siemens, Philips,
                  etc.). Safe Vendor Tags keeps non-identifying quantitative measurements.
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="font-medium text-[#8b949e]">Custom DICOM Tag Whitelist</label>
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-[11px] font-semibold text-[#8b949e]">
                    Quick Add Tag:
                  </span>
                  {commonTags.map(item => (
                    <button
                      key={item.tag}
                      type="button"
                      onClick={() => handleAddTag(item.tag)}
                      className="rounded border border-[#364153] bg-[#1c2331] px-2 py-0.5 text-[11px] text-blue-300 transition-colors hover:bg-[#283245]"
                    >
                      + {item.name}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={3}
                  value={config.tagWhitelist || ''}
                  placeholder="Enter 8-character DICOM tag hex codes (one per line or comma-separated)&#10;e.g. 00100040, 0008103E"
                  onChange={e => handleFieldChange('tagWhitelist', e.target.value)}
                  className="w-full rounded border border-[#364153] bg-[#1c2331] p-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Resolved Tags Preview */}
              <div>
                <span className="mb-1 block font-medium text-[#8b949e]">
                  Recognized Whitelisted Tags:
                </span>
                {parsedTags.length === 0 ? (
                  <p className="text-[11px] italic text-[#6e7681]">
                    No DICOM tags whitelisted yet.
                  </p>
                ) : (
                  <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                    {parsedTags.map((item: any, idx: number) => (
                      <span
                        key={idx}
                        className="flex items-center gap-1 rounded border border-[#364153] bg-[#1c2331] px-2 py-0.5 font-mono text-[11px] text-[#d1d5db]"
                      >
                        <span className="font-bold text-blue-400">{item.formattedTag}</span>
                        <span className="text-[#8b949e]">— {item.name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab Content 5: Advanced Settings */}
          {activeTab === 'advanced' && (
            <div className="space-y-3 pt-1 text-xs">
              <div>
                <label className="mb-1 block font-medium text-[#8b949e]">
                  Structured Report (SR) Policy
                </label>
                <select
                  value={config.structuredContentPolicy || 'remove'}
                  onChange={e => handleFieldChange('structuredContentPolicy', e.target.value)}
                  className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="remove">
                    Remove Structured Report Content (Default / Safest)
                  </option>
                  <option value="sanitize">
                    Sanitize Structured Report Text (Best-effort text clean)
                  </option>
                </select>
                <p className="mt-1 text-[11px] text-[#8b949e]">
                  Structured Reports contain clinical measurements, findings, and narrative text.
                </p>
              </div>

              <div className="space-y-2">
                {[
                  {
                    key: 'keepInstitutionIdentity',
                    title: 'Keep hospital & institution identity',
                    hint: 'Keep Institution Name, Address, and Department Name.',
                  },
                  {
                    key: 'keepDeviceIdentity',
                    title: 'Keep scanner & equipment identity',
                    hint: 'Keep Station Name, Scanner Model, Device Serial Number, and Equipment UIDs.',
                  },
                  {
                    key: 'rejectEncapsulatedDocuments',
                    title: 'Reject embedded document files (PDF / CDA)',
                    hint: 'Block export if DICOM file contains embedded PDF or XML documents.',
                  },
                  {
                    key: 'enablePixelRedaction',
                    title: 'Enable visual text redaction on images (OCR)',
                    hint: 'Scans image pixels using browser OCR and blackouts burned-in patient text automatically.',
                  },
                  {
                    key: 'forceIgnoreBurnedInAnnotation',
                    title: 'Force visual text redaction on all images',
                    hint: 'Always scan and redact image pixels, even if the DICOM file does not flag burned-in text.',
                  },
                ].map(item => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-start gap-2.5 rounded p-1 hover:bg-[#1c2331]/50"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(config[item.key])}
                      onChange={e => handleFieldChange(item.key, e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-[#455265] bg-[#1c2331] text-blue-500 focus:ring-blue-500/30"
                    />
                    <div>
                      <strong className="text-white">{item.title}</strong>
                      <p className="text-[11px] text-[#8b949e]">{item.hint}</p>
                    </div>
                  </label>
                ))}
              </div>

              <div className="pt-2">
                <label className="mb-1 block font-medium text-[#8b949e]">
                  Multi-Frame Image Redaction Mode
                </label>
                <select
                  value={config.multiFrameRedactionMethod || 'ask'}
                  onChange={e => handleFieldChange('multiFrameRedactionMethod', e.target.value)}
                  className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="ask">
                    Prompt When Multi-Frame Image Detected (Default)
                  </option>
                  <option value="aggressive">
                    Aggressive (Scan All Frames Sequentially - Recommended / Safest)
                  </option>
                  <option value="sampling">
                    Sampling (Scan Key Frames Only - Faster)
                  </option>
                </select>
                <p className="mt-1 text-[11px] text-[#8b949e]">
                  Determines whether all frames or key frames are scanned for burned-in PHI in multi-frame DICOM clips.
                </p>
              </div>

              <div className="pt-2">
                <label className="mb-1 block font-medium text-[#8b949e]">
                  OCR Hardware & Performance Mode
                </label>
                <select
                  value={config.ocrPerformanceMode || 'balanced'}
                  onChange={e => handleFieldChange('ocrPerformanceMode', e.target.value)}
                  className="w-full rounded border border-[#364153] bg-[#1c2331] px-2.5 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="balanced">Balanced (Default - Micro-OCR Character Recognition)</option>
                  <option value="fast">Fast (Downscale High-Res Frames for Low-Power Devices)</option>
                  <option value="thorough">Thorough (Full Resolution Character Scanning)</option>
                </select>
                <p className="mt-1 text-[11px] text-[#8b949e]">
                  Optimizes browser OCR character recognition speed vs canvas resolution for low-end hardware.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t border-[#2b3342] pt-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[#8b949e]">Redaction Border Style:</span>
                  <select
                    value={config.borderColor || 'none'}
                    onChange={e => handleFieldChange('borderColor', e.target.value)}
                    className="rounded border border-[#364153] bg-[#1c2331] px-2 py-1 text-xs text-white focus:outline-none"
                  >
                    <option value="none">No Border (Default)</option>
                    <option value="double">Black & White Double Border</option>
                    <option value="red">Red Border</option>
                    <option value="white">White Border</option>
                    <option value="black">Black Border</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#8b949e]">Width:</span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={config.borderWidth ?? 0}
                    onChange={e => handleFieldChange('borderWidth', Number(e.target.value) || 0)}
                    className="w-14 rounded border border-[#364153] bg-[#1c2331] px-2 py-1 text-xs text-white focus:outline-none"
                  />
                  <span className="text-[#8b949e]">px</span>
                </div>
              </div>
            </div>
          )}

          {/* Footer bar */}
          <div className="flex items-center justify-between border-t border-[#2b3342] pt-2 text-xs">
            <Button
              onClick={handleRestoreDefaults}
              variant="outline"
              size="sm"
            >
              🛡️ Restore Strict Defaults
            </Button>
            <span className="text-[11px] text-[#8b949e]">Saved to browser storage</span>
          </div>
        </div>
      )}
    </section>
  );
}
