import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { DateTime } from "luxon";
import { initReactI18next } from "react-i18next";

import translationAr from "./locales/ar/translation.json";
import translationCs from "./locales/cs/translation.json";
import translationDe from "./locales/de/translation.json";
import translationEn from "./locales/en/translation.json";
import translationEs from "./locales/es/translation.json";
import translationEu from "./locales/eu/translation.json";
import translationFi from "./locales/fi/translation.json";
import translationFr from "./locales/fr/translation.json";
import translationIt from "./locales/it/translation.json";
import translationJa from "./locales/ja/translation.json";
import translationKo from "./locales/ko/translation.json";
import translationNb_NO from "./locales/nb_NO/translation.json";
import translationNl from "./locales/nl/translation.json";
import translationPl from "./locales/pl/translation.json";
import translationPt from "./locales/pt/translation.json";
import translationPt_BR from "./locales/pt_BR/translation.json";
import translationRu from "./locales/ru/translation.json";
import translationSk from "./locales/sk/translation.json";
import translationSv from "./locales/sv/translation.json";
import translationUK from "./locales/uk/translation.json";
import translationUr from "./locales/ur/translation.json";
import translationVi from "./locales/vi/translation.json";
import translationZh_Hans from "./locales/zh_Hans/translation.json";
import translationZh_Hant from "./locales/zh_Hant/translation.json";

export const i18nResolvedLanguage = i18n.resolvedLanguage ? i18n.resolvedLanguage.replace("_", "-") : "en";

const resources = {
  en: {
    translation: translationEn,
  },
  de: {
    translation: translationDe,
  },
  es: {
    translation: translationEs,
  },
  fr: {
    translation: translationFr,
  },
  it: {
    translation: translationIt,
  },
  nb_NO: {
    translation: translationNb_NO,
  },
  zh_Hant: {
    translation: translationZh_Hant,
  },
  zh_Hans: {
    translation: translationZh_Hans,
  },
  ru: {
    translation: translationRu,
  },
  ja: {
    translation: translationJa,
  },
  sv: {
    translation: translationSv,
  },
  pl: {
    translation: translationPl,
  },
  nl: {
    translation: translationNl,
  },
  cs: {
    translation: translationCs,
  },
  pt: {
    translation: translationPt,
  },
  fi: {
    translation: translationFi,
  },
  eu: {
    translation: translationEu,
  },
  uk: {
    translation: translationUK,
  },
  vi: {
    translation: translationVi,
  },
  ar: {
    translation: translationAr,
  },
  ko: {
    translation: translationKo,
  },
  pt_BR: {
    translation: translationPt_BR,
  },
  sk: {
    translation: translationSk,
  },
  ur: {
    translation: translationUr,
  },
};
i18n
  // detect user language
  // learn more: https://github.com/i18next/i18next-browser-languageDetector
  .use(LanguageDetector)
  // pass the i18n instance to react-i18next.
  .use(initReactI18next)
  // init i18next
  // for all options read: https://www.i18next.com/overview/configuration-options
  .init({
    resources,
    debug: process.env.NODE_ENV === "development",
    fallbackLng: "en",
    interpolation: {
      format: (value, format, lng) => {
        if (value instanceof Date) {
          return DateTime.fromJSDate(value).setLocale(lng).toLocaleString(DateTime[format]);
        }
        return value;
      },
      escapeValue: false,
    },
  });

export default i18n;
