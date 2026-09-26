/**
 * Supported-locale registry, mirroring the web frontend's locale list
 * (apps/frontend/src/locales). English is the bundled base; other locales fall
 * back to English for any key not yet translated (i18next fallbackLng), and are
 * populated from Weblate / the legacy import script over time.
 */
export type LocaleMeta = { code: string; label: string; rtl?: boolean };

export const AVAILABLE_LOCALES: LocaleMeta[] = [
  { code: "en", label: "English" },
  { code: "ar", label: "العربية", rtl: true },
  { code: "ca", label: "Català" },
  { code: "cs", label: "Čeština" },
  { code: "da", label: "Dansk" },
  { code: "de", label: "Deutsch" },
  { code: "eo", label: "Esperanto" },
  { code: "es", label: "Español" },
  { code: "et", label: "Eesti" },
  { code: "eu", label: "Euskara" },
  { code: "fi", label: "Suomi" },
  { code: "fr", label: "Français" },
  { code: "hi", label: "हिन्दी" },
  { code: "hu", label: "Magyar" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "nb_NO", label: "Norsk bokmål" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "pt", label: "Português" },
  { code: "pt_BR", label: "Português (Brasil)" },
  { code: "ro", label: "Română" },
  { code: "ru", label: "Русский" },
  { code: "sk", label: "Slovenčina" },
  { code: "sv", label: "Svenska" },
  { code: "ta", label: "தமிழ்" },
  { code: "tr", label: "Türkçe" },
  { code: "uk", label: "Українська" },
  { code: "ur", label: "اردو", rtl: true },
  { code: "vi", label: "Tiếng Việt" },
  { code: "zh_Hans", label: "简体中文" },
  { code: "zh_Hant", label: "繁體中文" },
];

const RTL_CODES = new Set(AVAILABLE_LOCALES.filter((l) => l.rtl).map((l) => l.code));

/** Whether a locale code is right-to-left (drives layout direction). */
export function isRTL(code: string): boolean {
  return RTL_CODES.has(code);
}
