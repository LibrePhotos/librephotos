import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { DateTime } from "luxon";
import { initReactI18next } from "react-i18next";

import translationCs from "./locales/cs/translation.json";
import translationDe from "./locales/de/translation.json";
import translationEn from "./locales/en/translation.json";
import translationEs from "./locales/es/translation.json";
import translationEu from "./locales/eu/translation.json";
import translationFi from "./locales/fi/translation.json";
import translationFr from "./locales/fr/translation.json";
import translationIt from "./locales/it/translation.json";
import translationJa from "./locales/ja/translation.json";
import translationNb_NO from "./locales/nb_NO/translation.json";
import translationNl from "./locales/nl/translation.json";
import translationPl from "./locales/pl/translation.json";
import translationPt from "./locales/pt/translation.json";
import translationRu from "./locales/ru/translation.json";
import translationSv from "./locales/sv/translation.json";
import translationZh_Hans from "./locales/zh_Hans/translation.json";

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
