import type { ComboboxData, ComboboxItem } from "@mantine/core";
import type { TFunction } from "i18next";
import { intlLocale } from "../../util/formatCount";
import { LANGUAGE_OPTIONS } from "./languageOptions";

/** The place-name language Select's value for an empty GEOCODE_LANGUAGE: the provider's default. */
export const PROVIDER_DEFAULT = "default";

// One language tag ("de", "pt-BR") or a list in order of preference ("de,en"), as the backend
// accepts it (SiteSettingsRequest.validate_geocode_language).
const TAG = "[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*";
const LANGUAGE_CODES = new RegExp(`^${TAG}(?:,${TAG})*$`);

/** Whether `text` is a value the backend stores as the place-name language. */
export function isLanguageCode(text: string): boolean {
  return LANGUAGE_CODES.test(text);
}

type Language = Readonly<{ code: string; name: string }>;

/** The interface languages, as the codes providers take ("pt-BR"), named in the interface language. */
function knownLanguages(t: TFunction): Language[] {
  return LANGUAGE_OPTIONS.map(({ value, label }) => ({ code: intlLocale(value), name: t(label) }));
}

const sameCode = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A code's language name for the "New lookups name places in ..." line; the code itself when unknown. */
export function placeLanguageName(t: TFunction, code: string): string {
  return knownLanguages(t).find(language => sameCode(language.code, code))?.name ?? code;
}

/**
 * The place-name language options (#2745): the provider's default first (what happens today), then
 * the admin's interface language, then every language LibrePhotos has, each with its code. A code
 * no language has (a list such as "de,en", a stored value, one being typed) is offered under Other codes.
 */
export function placeLanguageOptions(
  t: TFunction,
  interfaceLanguage: string,
  extraCodes: readonly string[]
): ComboboxData {
  const languages = knownLanguages(t);
  const option = ({ code, name }: Language): ComboboxItem => ({
    value: code,
    label: t("sitesettings.placelanguage_option", { name, code }),
  });
  const yours = languages.find(language => sameCode(language.code, interfaceLanguage));
  const others = [...new Set(extraCodes)].filter(
    // Exact: the Select matches its value exactly, so "PT-br" needs its own option
    code => code !== "" && !languages.some(language => language.code === code)
  );
  return [
    { value: PROVIDER_DEFAULT, label: t("sitesettings.placelanguage_default") },
    ...(yours ? [{ group: t("sitesettings.placelanguage_yours"), items: [option(yours)] }] : []),
    {
      group: t("sitesettings.placelanguage_all"),
      items: languages.filter(language => language !== yours).map(option),
    },
    ...(others.length > 0 ? [{ group: t("sitesettings.placelanguage_morecodes"), items: others }] : []),
  ];
}
