/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import React from 'react';
import { Button } from '@ohif/ui-next';
import {
  flattenSeries,
  modalityCodeForEntry,
  modalityDisplayName,
  seriesDescription,
  selectionEntryName,
  selectionEntryMeta,
  seriesThumbnailSrc,
  buildManifest,
  studyLabel,
} from '../manifest';

interface SeriesListProps {
  studies: any[];
  allSeries: any[];
  selectedSeriesIds: Set<string>;
  onToggleSeries: (id: string) => void;
  onSelectStudy: (studyIndex: number) => void;
}

export default function SeriesList({
  studies,
  allSeries,
  selectedSeriesIds,
  onToggleSeries,
  onSelectStudy,
}: SeriesListProps) {
  if (!allSeries || allSeries.length === 0) {
    return (
      <div className="text-muted-foreground p-6 text-center text-sm italic">
        No DICOM series available to download.
      </div>
    );
  }

  const renderSeriesItem = (entry: any) => {
    const isChecked = selectedSeriesIds.has(entry.id);
    const series = entry.series;
    const number = series.SeriesNumber || entry.seriesIndex + 1;
    const modalityCode = modalityCodeForEntry(entry);
    const modalityName = modalityDisplayName(modalityCode);
    const description = seriesDescription(series);
    const name = selectionEntryName(entry, number, modalityName, description);
    const meta = selectionEntryMeta(entry, number, modalityName);
    const thumbnailSrc = seriesThumbnailSrc(entry);
    const count = buildManifest([entry]).length;

    return (
      <label
        key={entry.id}
        className={`flex cursor-pointer select-none items-center gap-3 rounded-lg border p-2.5 transition-colors ${
          isChecked
            ? 'border-primary bg-primary/10 hover:bg-primary/20'
            : 'border-input bg-background hover:bg-primary/10 opacity-80'
        }`}
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleSeries(entry.id)}
          className="border-primary text-primary h-4 w-4 rounded"
        />

        {/* Thumbnail or Modality Badge */}
        <div className="border-input bg-background relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border">
          {thumbnailSrc ? (
            <img
              src={thumbnailSrc}
              alt=""
              className="h-full w-full object-cover"
              crossOrigin="anonymous"
            />
          ) : (
            <span className="text-muted-foreground text-xs font-bold uppercase">
              {modalityCode.substring(0, 3)}
            </span>
          )}
          <span className="bg-primary text-primary-foreground absolute right-0 bottom-0 rounded-tl px-1 py-0.5 text-[9px] font-extrabold">
            {modalityCode}
          </span>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p
            className="text-foreground truncate text-sm font-semibold"
            title={name}
          >
            {name}
          </p>
          <p className="text-muted-foreground truncate text-xs">{meta}</p>
        </div>

        {/* Image File Count Pill */}
        <span className="border-input bg-background text-muted-foreground shrink-0 rounded-full border px-2 py-1 text-xs font-semibold">
          {count} file{count === 1 ? '' : 's'}
        </span>
      </label>
    );
  };

  return (
    <div className="space-y-3">
      {studies.length <= 1 ? (
        <div className="space-y-2">{allSeries.map(entry => renderSeriesItem(entry))}</div>
      ) : (
        studies.map((study, studyIndex) => {
          const entries = allSeries.filter(entry => entry.studyIndex === studyIndex);
          if (entries.length === 0) return null;

          return (
            <div
              key={studyIndex}
              className="border-input space-y-2 border-b pb-3 last:border-0"
            >
              <div className="border-input bg-background flex items-center justify-between rounded border p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="border-primary/30 bg-primary/20 text-primary shrink-0 rounded border px-2 py-0.5 text-xs font-bold">
                    Exam {studyIndex + 1} of {studies.length}
                  </span>
                  <span
                    className="text-foreground truncate text-sm font-semibold"
                    title={studyLabel(study)}
                  >
                    {studyLabel(study)}
                  </span>
                </div>
                <Button
                  onClick={() => onSelectStudy(studyIndex)}
                  variant="link"
                  size="sm"
                  className="ml-2 shrink-0"
                >
                  Select this exam
                </Button>
              </div>
              <div className="space-y-2 pl-2">{entries.map(entry => renderSeriesItem(entry))}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
