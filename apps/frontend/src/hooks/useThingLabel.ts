import type { i18n as I18n } from "i18next";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

/**
 * The name of a thing in the first of `languages` that has one, else the thing
 * as stored. Read straight from the `tags` bundles: a thing is a whole key
 * ("st. patrick's day" has a dot) and t()'s keys are checked against the
 * English translation file, which things are not in.
 */
export function thingLabel(i18n: I18n, languages: readonly string[], thing: string): string {
  for (const language of languages) {
    const bundle: unknown = i18n.getResourceBundle(language, "tags");
    const name: unknown = isRecord(bundle) && Object.hasOwn(bundle, thing) ? bundle[thing] : undefined;
    if (typeof name === "string" && name !== "") {
      return name;
    }
  }
  return thing;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Names the things the tagger finds (#2744) in the interface language, for
 * display only: the stored English word stays what links, search and album
 * titles use. A word without a translation (a hashtag, an admin's own word,
 * a language Weblate has not covered) shows as it is. The namespace loads in
 * the background; until it is there, things show in English.
 */
export function useThingLabel(): (thing: string) => string {
  const { i18n, ready } = useTranslation("tags", { useSuspense: false });
  const { languages } = i18n;
  return useCallback((thing: string) => (ready ? thingLabel(i18n, languages, thing) : thing), [i18n, languages, ready]);
}
