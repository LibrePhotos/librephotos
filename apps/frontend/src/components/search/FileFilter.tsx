import type { SearchFilters } from "@librephotos/api-client";
import { Autocomplete, SegmentedControl, Stack, Switch } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

// Common extensions to pick from; any other known media extension can be typed.
const COMMON_EXTENSIONS = [
  "jpg",
  "heic",
  "png",
  "webp",
  "avif",
  "jxl",
  "tif",
  "dng",
  "cr3",
  "cr2",
  "nef",
  "arw",
  "raf",
  "orf",
  "rw2",
  "mp4",
  "mov",
];

type LocationChoice = "any" | "with" | "without";

function isLocationChoice(value: string): value is LocationChoice {
  return value === "any" || value === "with" || value === "without";
}

function locationChoice(hasLocation: boolean | undefined): LocationChoice {
  if (hasLocation === undefined) return "any";
  return hasLocation ? "with" : "without";
}

type LocationProps = Readonly<{
  value: boolean | undefined;
  onChange: (hasLocation: boolean | undefined) => void;
  labelId: string;
}>;

// Has GPS coordinates, has none, or either.
export function LocationFilter({ value, onChange, labelId }: LocationProps) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      fullWidth
      size="xs"
      aria-labelledby={labelId}
      value={locationChoice(value)}
      onChange={choice => {
        if (!isLocationChoice(choice)) return;
        onChange(choice === "any" ? undefined : choice === "with");
      }}
      data={[
        { value: "any", label: t("searchfilter.location.any") },
        { value: "with", label: t("searchfilter.location.with") },
        { value: "without", label: t("searchfilter.location.without") },
      ]}
    />
  );
}

type FileProps = Readonly<{
  filters: SearchFilters;
  onChange: (patch: SearchFilters) => void;
}>;

const normalizeExtension = (value: string) => value.trim().toLowerCase().replace(/^\./, "");

// What the media button cannot say: a RAW file among the photo's files, and the main file's
// extension (applied on blur, Enter or a pick). Photo / video stays on the media button.
export function FileFilter({ filters, onChange }: FileProps) {
  const { t } = useTranslation();
  // The parent re-keys this on the applied extension, so the draft starts from it.
  const [draft, setDraft] = useState(filters.extension ?? "");
  const apply = (value: string) => {
    const extension = normalizeExtension(value) || undefined;
    if (extension !== filters.extension) onChange({ extension });
  };

  return (
    <Stack gap="xs">
      <Switch
        checked={filters.file_type === "raw"}
        onChange={event => onChange({ file_type: event.currentTarget.checked ? "raw" : undefined })}
        label={t("searchfilter.file.raw")}
        description={t("searchfilter.file.rawhint")}
      />
      <Autocomplete
        label={t("searchfilter.file.extension")}
        placeholder={t("searchfilter.file.extensionplaceholder")}
        data={COMMON_EXTENSIONS}
        value={draft}
        onChange={setDraft}
        onOptionSubmit={apply}
        onBlur={() => apply(draft)}
        onClear={() => apply("")}
        onKeyDown={event => {
          if (event.key === "Enter") apply(draft);
        }}
        size="xs"
        clearable
        comboboxProps={{ withinPortal: false }}
      />
    </Stack>
  );
}
