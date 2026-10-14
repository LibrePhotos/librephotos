import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { formatEventTitle, type EventTitleSource } from "../util/eventTitle";

/** Words event titles in the UI language; the returned function changes when the language does. */
export function useEventTitle(): (album: EventTitleSource) => string {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  return useCallback((album: EventTitleSource) => formatEventTitle(album, t, locale), [t, locale]);
}
