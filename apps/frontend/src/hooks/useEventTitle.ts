import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useUserPlacesQuery } from "../api_client/albums/hooks/useUserPlaces";
import { formatEventTitle, type EventTitleSource } from "../util/eventTitle";

/**
 * Words event titles in the UI language, naming the user's own places (#1365); the returned
 * function changes when the language or the places do.
 */
export function useEventTitle(): (album: EventTitleSource) => string {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const { data: places } = useUserPlacesQuery();
  const names = useMemo(() => new Map((places ?? []).map(place => [place.id, place.name])), [places]);
  return useCallback(
    (album: EventTitleSource) => formatEventTitle(album, t, locale, placeId => names.get(placeId)),
    [t, locale, names]
  );
}
