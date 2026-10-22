import type translationEn from "../locales/en/translation.json";

// t() only accepts keys that exist in the English file: a typo, a key that was never added or a
// plain `string` fails the type check. English is the source language (other locales come from
// Weblate), so it is the one resource the compiler knows. `tags` holds the names of the things
// the tagger finds (hooks/useThingLabel): any stored word may be looked up, so it is not a key set.
declare module "i18next" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- module augmentation merges into i18next's interface
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof translationEn; tags: Record<string, string> };
    strictKeyChecks: true;
  }
}
