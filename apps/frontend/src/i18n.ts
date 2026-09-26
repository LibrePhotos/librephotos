import i18n, { type BackendModule, type ResourceKey } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { DateTime } from "luxon";
import { initReactI18next } from "react-i18next";
import translationEn from "./locales/en/translation.json";

export const i18nResolvedLanguage = () => (i18n.resolvedLanguage ? i18n.resolvedLanguage.replace("_", "-") : "en");

// English ships in the main bundle: it is the fallback language and the one
// most people use. Every other locale is its own chunk, fetched the first time
// that language is needed (initial detection or a switch in the settings).
const localeLoaders: Record<string, () => Promise<{ default: ResourceKey }>> = {
  ar: () => import("./locales/ar/translation.json"),
  ca: () => import("./locales/ca/translation.json"),
  cs: () => import("./locales/cs/translation.json"),
  de: () => import("./locales/de/translation.json"),
  eo: () => import("./locales/eo/translation.json"),
  es: () => import("./locales/es/translation.json"),
  et: () => import("./locales/et/translation.json"),
  eu: () => import("./locales/eu/translation.json"),
  fi: () => import("./locales/fi/translation.json"),
  fr: () => import("./locales/fr/translation.json"),
  hi: () => import("./locales/hi/translation.json"),
  hu: () => import("./locales/hu/translation.json"),
  it: () => import("./locales/it/translation.json"),
  ja: () => import("./locales/ja/translation.json"),
  ko: () => import("./locales/ko/translation.json"),
  nb_NO: () => import("./locales/nb_NO/translation.json"),
  nl: () => import("./locales/nl/translation.json"),
  pl: () => import("./locales/pl/translation.json"),
  pt: () => import("./locales/pt/translation.json"),
  pt_BR: () => import("./locales/pt_BR/translation.json"),
  ro: () => import("./locales/ro/translation.json"),
  ru: () => import("./locales/ru/translation.json"),
  sk: () => import("./locales/sk/translation.json"),
  sv: () => import("./locales/sv/translation.json"),
  ta: () => import("./locales/ta/translation.json"),
  tr: () => import("./locales/tr/translation.json"),
  uk: () => import("./locales/uk/translation.json"),
  ur: () => import("./locales/ur/translation.json"),
  vi: () => import("./locales/vi/translation.json"),
  zh_Hans: () => import("./locales/zh_Hans/translation.json"),
  zh_Hant: () => import("./locales/zh_Hant/translation.json"),
};

const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init: () => {},
  read(language, _namespace, callback) {
    const load = localeLoaders[language];
    if (!load) {
      // Region variants ("de-DE", "en-US") and unknown codes have no file of
      // their own; an empty bundle lets i18next fall through to "de" / "en".
      callback(null, {});
      return;
    }
    load().then(
      module => callback(null, module.default),
      error => callback(error, false)
    );
  },
};

/** Resolves once the detected (or saved) language has been loaded. */
export const i18nReady = i18n
  // detect user language
  // learn more: https://github.com/i18next/i18next-browser-languageDetector
  .use(LanguageDetector)
  .use(lazyLocaleBackend)
  // pass the i18n instance to react-i18next.
  .use(initReactI18next)
  // init i18next
  // for all options read: https://www.i18next.com/overview/configuration-options
  .init({
    resources: { en: { translation: translationEn } },
    // Load everything that is not in `resources` through lazyLocaleBackend.
    partialBundledLanguages: true,
    debug: process.env.NODE_ENV === "development",
    fallbackLng: "en",
    interpolation: {
      format: (value, format, lng) => {
        if (value instanceof Date) {
          // @ts-ignore
          return DateTime.fromJSDate(value).setLocale(lng).toLocaleString(DateTime[format]);
        }
        return value;
      },
      escapeValue: false,
    },
  });

export default i18n;
