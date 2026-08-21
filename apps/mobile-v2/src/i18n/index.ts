import { I18nManager } from "react-native";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import { isRTL } from "./locales";

export { AVAILABLE_LOCALES, isRTL } from "./locales";

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

/**
 * Switch the active UI language and align the RTL layout direction. RTL takes
 * effect fully after an app reload (I18nManager), but the flag is set eagerly so
 * new mounts lay out correctly.
 */
export async function changeAppLanguage(code: string): Promise<void> {
  // eslint-disable-next-line import/no-named-as-default-member
  await i18n.changeLanguage(code);
  const rtl = isRTL(code);
  if (I18nManager.isRTL !== rtl) {
    try {
      I18nManager.allowRTL(rtl);
      I18nManager.forceRTL(rtl);
    } catch {
      // no-op in environments without the native module (e.g. tests)
    }
  }
}

export default i18n;
