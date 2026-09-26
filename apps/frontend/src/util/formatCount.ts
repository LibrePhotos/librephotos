// Formatters are cached per locale because Intl.NumberFormat is costly to build.
const fullFormatters = new Map<string, Intl.NumberFormat>();
const compactFormatters = new Map<string, Intl.NumberFormat>();

function getFormatter(cache: Map<string, Intl.NumberFormat>, locale: string, options?: Intl.NumberFormatOptions) {
  let formatter = cache.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    cache.set(locale, formatter);
  }
  return formatter;
}

/** Exact count with locale-aware digit grouping, e.g. 25123 -> "25,123" (en) or "25.123" (de). */
export function formatCount(value: number, locale = "en"): string {
  return getFormatter(fullFormatters, locale).format(value);
}

/**
 * Abbreviates large counts for narrow layouts, e.g. 25123 -> "25.1K" (en).
 *
 * This deliberately follows the locale's CLDR compact rules instead of forcing
 * English suffixes. Some locales do not abbreviate thousands at all (de renders
 * 25123 as "25.123" and only shortens from a million: "1,5 Mio."); that is the
 * correct convention for those readers, so we accept the longer string there.
 */
export function formatCompactCount(value: number, locale = "en"): string {
  return getFormatter(compactFormatters, locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
