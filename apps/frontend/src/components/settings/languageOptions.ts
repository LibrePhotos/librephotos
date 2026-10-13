import type { ParseKeys } from "i18next";

/**
 * The Profile language picker, in the order it lists them. `value` is the directory under
 * `src/locales/` (i18n.ts loads every directory there on its own); `label` is the language's name
 * in the UI language. Weblate adds a directory when a translator starts a language, and
 * `src/i18n.test.ts` fails until it has an entry here and a dayjs locale in `i18n.ts`.
 */
export const LANGUAGE_OPTIONS: readonly { value: string; label: ParseKeys }[] = [
  { value: "en", label: "settings.english" },
  { value: "ca", label: "settings.catalan" },
  { value: "de", label: "settings.german" },
  { value: "es", label: "settings.spanish" },
  { value: "eo", label: "settings.esperanto" },
  { value: "et", label: "settings.estonian" },
  { value: "fr", label: "settings.french" },
  { value: "it", label: "settings.italian" },
  { value: "nb_NO", label: "settings.norwegianbokmal" },
  { value: "zh_Hans", label: "settings.simplifiedchinese" },
  { value: "zh_Hant", label: "settings.traditionalchinese" },
  { value: "ru", label: "settings.russian" },
  { value: "ja", label: "settings.japanese" },
  { value: "sv", label: "settings.swedish" },
  { value: "pl", label: "settings.polish" },
  { value: "nl", label: "settings.dutch" },
  { value: "cs", label: "settings.czech" },
  { value: "da", label: "settings.danish" },
  { value: "pt", label: "settings.portuguese" },
  { value: "fi", label: "settings.finnish" },
  { value: "eu", label: "settings.basque" },
  { value: "uk", label: "settings.ukrainian" },
  { value: "vi", label: "settings.vietnamese" },
  { value: "ar", label: "settings.arabic" },
  { value: "hu", label: "settings.hungarian" },
  { value: "ko", label: "settings.korean" },
  { value: "pt_BR", label: "settings.portuguesebr" },
  { value: "ro", label: "settings.romanian" },
  { value: "sk", label: "settings.slovak" },
  { value: "ur", label: "settings.urdu" },
  { value: "hi", label: "settings.hindi" },
  { value: "ta", label: "settings.tamil" },
  { value: "tr", label: "settings.turkish" },
];
