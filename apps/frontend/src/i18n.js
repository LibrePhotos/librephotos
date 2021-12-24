import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import translationEn from "./locales/en/translation.json";
import translationDe from "./locales/de/translation.json";
import translationEs from "./locales/es/translation.json";
import translationFr from "./locales/fr/translation.json";
import translationIt from "./locales/it/translation.json";
import translationNb_NO from "./locales/nb_NO/translation.json";
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
    debug: true,
    fallbackLng: "en",
  });

export default i18n;
