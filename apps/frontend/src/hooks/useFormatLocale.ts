import { useTranslation } from "react-i18next";

/**
 * The UI language as Intl takes it ("pt-BR" for "pt_BR"), for numbers that read
 * like the rest of the page (`ƒ/5,6` in German). English until i18n is ready.
 */
export function useFormatLocale(): string {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage?.replace("_", "-") ?? "en";
}
