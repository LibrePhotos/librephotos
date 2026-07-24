import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";

/**
 * i18next scaffold. Only English is bundled today; additional locales are
 * pulled from Weblate in a later phase and registered here. `compatibilityJSON:
 * "v4"` keeps plural rules aligned with the web frontend.
 */
export const defaultNS = "translation";

if (!i18n.isInitialized) {
  // eslint-disable-next-line import/no-named-as-default-member
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: "en",
    fallbackLng: "en",
    defaultNS,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export default i18n;
