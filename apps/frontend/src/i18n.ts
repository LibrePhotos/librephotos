import i18n, { type BackendModule, type ResourceKey } from "i18next";
import { Settings } from "luxon";
import { initReactI18next } from "react-i18next";
import { formatCount, intlLocale } from "./util/formatCount";
import { browserLanguageDetector } from "./util/languageDetector";

export const i18nResolvedLanguage = () => intlLocale(i18n.resolvedLanguage);

const localeFiles = import.meta.glob<{ default: ResourceKey }>("./locales/*/translation.json");
const englishInTests =
  import.meta.env.MODE === "test"
    ? import.meta.glob<ResourceKey>("./locales/en/translation.json", { eager: true, import: "default" })[
        "./locales/en/translation.json"
      ]
    : undefined;
// The names of the things the tagger finds (#2744), one chunk per language,
// English included: an English name is the stored tag itself, so nothing waits
// for it, and only the pages that show things load the namespace.
const tagFiles = import.meta.glob<{ default: ResourceKey }>("./locales/*/tags.json");

type LocaleLoader = () => Promise<{ default: ResourceKey }>;

// "./locales/pt_BR/translation.json" -> "pt_BR"
const byLanguage = (files: Record<string, LocaleLoader>) =>
  new Map(Object.entries(files).map(([path, load]) => [path.split("/")[2] ?? path, load]));

const namespaceLoaders: Record<string, Map<string, LocaleLoader> | undefined> = {
  translation: byLanguage(localeFiles),
  tags: byLanguage(tagFiles),
};

const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init: () => {},
  read(language, namespace, callback) {
    const load = namespaceLoaders[namespace]?.get(language);
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
  .use(browserLanguageDetector)
  .use(lazyLocaleBackend)
  // pass the i18n instance to react-i18next.
  .use(initReactI18next)
  // init i18next
  // for all options read: https://www.i18next.com/overview/configuration-options
  .init({
    resources: englishInTests ? { en: { translation: englishInTests } } : undefined,
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
