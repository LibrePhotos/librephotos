const compactFormatter = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** Abbreviates large counts for narrow layouts, e.g. 25123 -> "25.1K". */
export function formatCompactCount(value: number): string {
  return compactFormatter.format(value);
}
