import type { UserPlace, UserPlaceIcon } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { useCallback, useState } from "react";
import { radiusTo, type LatLon } from "./placeGeometry";

/** The place being drawn (#1365): a new one (no `id`) or one being edited. */
export type PlaceEditorState = Readonly<{
  id?: number;
  /** Null until the map is clicked. */
  center: LatLon | null;
  radiusM: number;
  name: string;
  icon: UserPlaceIcon;
  useInTitles: boolean;
}>;

/** A new place's radius before it is dragged: a house and its garden. */
const NEW_PLACE_RADIUS_M = 150;

const NEW_PLACE: PlaceEditorState = {
  center: null,
  radiusM: NEW_PLACE_RADIUS_M,
  name: "",
  icon: "home",
  useInTitles: true,
};

/** The editor's starting point for a place that exists. */
export function editorStateOf(place: UserPlace): PlaceEditorState {
  return {
    id: place.id,
    center: { lat: place.center_lat, lon: place.center_lon },
    radiusM: place.radius_m,
    name: place.name,
    icon: place.icon,
    useInTitles: place.use_in_titles,
  };
}

/**
 * The Places page's editor of your places (#1365): which place is being drawn, and the moves the
 * map makes on it (a click sets the centre, the edge handle the radius).
 */
export function usePlaceEditor() {
  const [editor, setEditor] = useState<PlaceEditorState | null>(null);
  const start = useCallback((place?: UserPlace) => setEditor(place ? editorStateOf(place) : NEW_PLACE), []);
  const close = useCallback(() => setEditor(null), []);
  const pick = useCallback((center: LatLon) => setEditor(state => state && { ...state, center }), []);
  const resize = useCallback((radiusM: number) => setEditor(state => state && { ...state, radiusM }), []);
  const dragEdge = useCallback(
    (edge: LatLon) => setEditor(state => (state?.center ? { ...state, radiusM: radiusTo(state.center, edge) } : state)),
    []
  );
  return { editor, start, close, pick, resize, dragEdge };
}

/** Why a place cannot be added now (maps are off, or one is being drawn), or null. */
export function addPlaceBlocked(t: TFunction, mapsOff: boolean, drawing: boolean): string | null {
  if (mapsOff) return t("yourplaces.mapsOff");
  return drawing ? t("yourplaces.drawing") : null;
}
