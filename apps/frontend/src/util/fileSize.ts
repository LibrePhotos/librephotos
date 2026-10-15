import { numberFormatter } from "./formatCount";

// Decimal units (1 kB = 1000 bytes), the ones Intl can name in every language.
const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte", "petabyte"] as const;
const STEP = 1000;
// Three significant digits: "512 kB", "26.4 MB", "8.42 MB", "1.5 GB".
const DIGITS = 3;

/** The unit a size is shown in: the largest one it has at least 1 of, after rounding. */
function unitIndex(bytes: number): number {
  let index = 0;
  let value = bytes;
  // 999,960 bytes rounds to "1,000 kB": show it as "1 MB" instead.
  while (index < UNITS.length - 1 && Number(value.toPrecision(DIGITS)) >= STEP) {
    value /= STEP;
    index += 1;
  }
  return index;
}

/**
 * A file or storage size in the UI language, with its localized unit:
 * 8_420_000 -> "8.42 MB" (en), "8,42 MB" (de), "8,42 Mo" (fr).
 */
export function formatFileSize(bytes: number, locale: string): string {
  const size = Math.max(0, bytes);
  const index = unitIndex(size);
  const unit = UNITS[index] ?? "byte";
  return numberFormatter(locale, `size:${unit}`, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumSignificantDigits: DIGITS,
  }).format(size / STEP ** index);
}
