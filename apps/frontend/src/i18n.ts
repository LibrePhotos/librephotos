import i18n, { type BackendModule, type ResourceKey } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { Settings } from "luxon";
import { initReactI18next } from "react-i18next";
import translationEn from "./locales/en/translation.json";
import { formatCount, intlLocale } from "./util/formatCount";

export const i18nResolvedLanguage = () => intlLocale(i18n.resolvedLanguage);

// English ships in the main bundle: it is the fallback language and the one
// most people use. Every other directory under ./locales is its own chunk,
// fetched the first time that language is needed (initial detection or a
// switch in the settings). The list comes from the files, so a language that
// Weblate adds loads with no change here.
const localeFiles = import.meta.glob<{ default: ResourceKey }>([
  "./locales/*/translation.json",
  "!./locales/en/translation.json",
]);
// "./locales/pt_BR/translation.json" -> "pt_BR"
const localeLoaders = new Map(Object.entries(localeFiles).map(([path, load]) => [path.split("/")[2] ?? path, load]));

const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init: () => {},
  read(language, _namespace, callback) {
    const load = localeLoaders.get(language);
    if (!load) {
      // Region variants ("de-DE", "en-US") and unknown codes have no file of
      // their own; an empty bundle lets i18next fall through to "de" / "en".
      callback(null, {});
      return;
    }
    load().then(
      module => callback(null, module.default),
      // A failed dynamic import rejects with an Error (TypeError: failed to fetch the chunk).
      (error: unknown) => callback(error instanceof Error ? error : String(error), false)
    );
  },
};

// Mantine's date pickers format through dayjs, which has its own locale data
// and names ("nb", "zh-cn"). Explicit imports: Vite cannot resolve a template
// string into node_modules.
const dayjsLocaleLoaders: Record<string, [string, () => Promise<unknown>]> = {
  ar: ["ar", () => import("dayjs/locale/ar")],
  ca: ["ca", () => import("dayjs/locale/ca")],
  cs: ["cs", () => import("dayjs/locale/cs")],
  da: ["da", () => import("dayjs/locale/da")],
  de: ["de", () => import("dayjs/locale/de")],
  eo: ["eo", () => import("dayjs/locale/eo")],
  es: ["es", () => import("dayjs/locale/es")],
  et: ["et", () => import("dayjs/locale/et")],
  eu: ["eu", () => import("dayjs/locale/eu")],
  fi: ["fi", () => import("dayjs/locale/fi")],
  fr: ["fr", () => import("dayjs/locale/fr")],
  hi: ["hi", () => import("dayjs/locale/hi")],
  hu: ["hu", () => import("dayjs/locale/hu")],
  it: ["it", () => import("dayjs/locale/it")],
  ja: ["ja", () => import("dayjs/locale/ja")],
  ko: ["ko", () => import("dayjs/locale/ko")],
  nb_NO: ["nb", () => import("dayjs/locale/nb")],
  nl: ["nl", () => import("dayjs/locale/nl")],
  pl: ["pl", () => import("dayjs/locale/pl")],
  pt: ["pt", () => import("dayjs/locale/pt")],
  pt_BR: ["pt-br", () => import("dayjs/locale/pt-br")],
  ro: ["ro", () => import("dayjs/locale/ro")],
  ru: ["ru", () => import("dayjs/locale/ru")],
  sk: ["sk", () => import("dayjs/locale/sk")],
  sv: ["sv", () => import("dayjs/locale/sv")],
  ta: ["ta", () => import("dayjs/locale/ta")],
  tr: ["tr", () => import("dayjs/locale/tr")],
  uk: ["uk", () => import("dayjs/locale/uk")],
  ur: ["ur", () => import("dayjs/locale/ur")],
  vi: ["vi", () => import("dayjs/locale/vi")],
  zh_Hans: ["zh-cn", () => import("dayjs/locale/zh-cn")],
  zh_Hant: ["zh-tw", () => import("dayjs/locale/zh-tw")],
};

/** Loads dayjs's data for an app language and resolves to its dayjs name ("en" without one). */
export function loadDayjsLocale(language: string | undefined): Promise<string> {
  const entry = language ? dayjsLocaleLoaders[language] : undefined;
  if (!entry) {
    return Promise.resolve("en");
  }
  const [name, load] = entry;
  return load().then(
    () => name,
    () => "en"
  );
}

// Keep the UI language in step everywhere it is read: luxon formats dates in
// its default locale (util/dateUtils is the only place that parses or formats
// them, so nothing sets a locale per call), and <html lang> drives
// screen-reader pronunciation and hyphenation. Registered before init, so the
// initial detection counts too.
i18n.on("languageChanged", () => {
  Settings.defaultLocale = i18nResolvedLanguage();
  if (typeof document !== "undefined") {
    document.documentElement.lang = i18nResolvedLanguage();
  }
});

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
      escapeValue: false,
    },
  });

// `{{count, number}}` in a translation groups the digits the UI language's way ("25.123" in
// German). i18next's own number format hands Intl the language code as it is, and Intl rejects
// the underscore ones (pt_BR, zh_Hans), which would print the bare number.
i18n.services.formatter?.add("number", (value: unknown, lng: string | undefined) =>
  formatCount(Number(value), intlLocale(lng))
);

export default i18n;
