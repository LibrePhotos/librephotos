const UNITS = ["B", "KB", "MB", "GB", "TB"];
const formatters = new Map<string, Intl.NumberFormat>();

function sizeFormat(locale: string): Intl.NumberFormat {
  let formatter = formatters.get(locale);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    } catch {
      formatter = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
    }
    formatters.set(locale, formatter);
  }
  return formatter;
}

/** `8.37 MB` (1024-based, at most two decimals) in the UI language: `8,37 MB` in German. */
export function formatFileSize(bytes: number, locale = "en"): string {
  if (bytes <= 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  return `${sizeFormat(locale).format(bytes / 1024 ** exponent)} ${UNITS[exponent]}`;
}
