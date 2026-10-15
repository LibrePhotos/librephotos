// Formatters are cached per locale and style because Intl.NumberFormat is costly to build.
const numberFormatters = new Map<string, Intl.NumberFormat>();

/**
 * The cached formatter for a locale and a named style. A tag Intl rejects (i18next's `pt_BR`
 * before it is turned into `pt-BR`, or a made-up one) falls back to English rather than throwing.
 */
export function numberFormatter(locale: string, style: string, options?: Intl.NumberFormatOptions) {
  const cacheKey = `${locale}|${style}`;
  let formatter = numberFormatters.get(cacheKey);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, options);
    } catch {
      formatter = new Intl.NumberFormat("en", options);
    }
    numberFormatters.set(cacheKey, formatter);
  }
  return formatter;
}

/** An i18next language code as an Intl locale tag: `pt_BR` -> `pt-BR`, `zh_Hans` -> `zh-Hans`. */
export function intlLocale(language: string | undefined): string {
  return language ? language.replace("_", "-") : "en";
}

/** Exact count with locale-aware digit grouping, e.g. 25123 -> "25,123" (en) or "25.123" (de). */
export function formatCount(value: number, locale = "en"): string {
  return numberFormatter(locale, "full").format(value);
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
  return numberFormatter(locale, "compact", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/**
 * A fraction as a percentage in the locale's style, with at most `fractionDigits` decimals:
 * 0.1234 -> "12.3%" (en), "12,3 %" (de).
 */
export function formatPercent(fraction: number, locale = "en", fractionDigits = 1): string {
  return numberFormatter(locale, `percent:${fractionDigits}`, {
    style: "percent",
    maximumFractionDigits: fractionDigits,
  }).format(fraction);
}

/** Phrases that each hold a count, joined the way the locale lists them: "12 days, 340 photos" (en). */
export function formatUnitList(parts: string[], locale = "en"): string {
  try {
    return new Intl.ListFormat(locale, { style: "short", type: "unit" }).format(parts);
  } catch {
    // An unknown language tag
    return new Intl.ListFormat("en", { style: "short", type: "unit" }).format(parts);
  }
}
