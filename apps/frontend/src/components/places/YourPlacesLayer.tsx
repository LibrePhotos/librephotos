import type { UserPlace } from "@librephotos/api-client";
import clsx from "clsx";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Layer, Marker, Source } from "react-map-gl/maplibre";
import { useMapLayerColors } from "../map/useMapLayerColors";
import { circleCollection, circlePolygon, edgeOf, type LatLon } from "./placeGeometry";
import { PLACE_ICONS } from "./placeIcons";
import type { PlaceEditorState } from "./usePlaceEditor";
import classes from "./YourPlacesLayer.module.css";

type Props = Readonly<{
  places: readonly UserPlace[];
  /** The place being drawn, if any; the others are dimmed meanwhile. */
  editor: PlaceEditorState | null;
  onEdgeDrag: (edge: LatLon) => void;
  onOpenPlace: (place: UserPlace) => void;
}>;

// Under the photo clusters, which stay clickable on top of a place.
const UNDER_CLUSTERS = "clusters";

/**
 * Your places on the Places map (#1365): each a circle with its name, and while one is drawn, its
 * circle, its centre and the handle on its edge that sets the size.
 */
export function YourPlacesLayer({ places, editor, onEdgeDrag, onOpenPlace }: Props) {
  const { t } = useTranslation();
  const colors = useMapLayerColors();
  const editing = editor !== null;
  const others = useMemo(() => places.filter(place => place.id !== editor?.id), [places, editor?.id]);
  const circles = useMemo(
    () =>
      circleCollection(
        others.map(place => ({
          id: place.id,
          center: { lat: place.center_lat, lon: place.center_lon },
          radiusM: place.radius_m,
        }))
      ),
    [others]
  );
  const draft = editor?.center ? { center: editor.center, radiusM: editor.radiusM } : null;
  const edge = draft && edgeOf(draft);

  return (
    <>
      <Source id="your-places" type="geojson" data={circles}>
        <Layer
          id="your-places-fill"
          type="fill"
          beforeId={UNDER_CLUSTERS}
          paint={{ "fill-color": colors.place, "fill-opacity": editing ? 0.05 : 0.12 }}
        />
        <Layer
          id="your-places-line"
          type="line"
          beforeId={UNDER_CLUSTERS}
          paint={{ "line-color": colors.place, "line-width": 2, "line-opacity": editing ? 0.4 : 1 }}
        />
      </Source>
      {draft && (
        <Source id="place-draft" type="geojson" data={circlePolygon(draft)}>
          <Layer
            id="place-draft-fill"
            type="fill"
            beforeId={UNDER_CLUSTERS}
            paint={{ "fill-color": colors.place, "fill-opacity": 0.2 }}
          />
          <Layer
            id="place-draft-line"
            type="line"
            beforeId={UNDER_CLUSTERS}
            paint={{ "line-color": colors.place, "line-width": 2, "line-dasharray": [2, 2] }}
          />
        </Source>
      )}
      {others.map(place => {
        const Icon = PLACE_ICONS[place.icon];
        return (
          <Marker
            key={place.id}
            longitude={place.center_lon}
            latitude={place.center_lat}
            anchor="bottom"
            offset={[0, -6]}
          >
            <button
              type="button"
              className={clsx(classes.label, editing && classes.labelDimmed)}
              onClick={event => {
                event.stopPropagation();
                if (!editing) onOpenPlace(place);
              }}
              tabIndex={editing ? -1 : 0}
            >
              <Icon size={14} aria-hidden />
              {place.name}
            </button>
          </Marker>
        );
      })}
      {draft && (
        <Marker longitude={draft.center.lon} latitude={draft.center.lat}>
          <div className={classes.centre} />
        </Marker>
      )}
      {edge && (
        <Marker
          longitude={edge.lon}
          latitude={edge.lat}
          draggable
          onDrag={event => onEdgeDrag({ lat: event.lngLat.lat, lon: event.lngLat.lng })}
        >
          <div className={classes.edge} title={t("yourplaces.editor.dragEdge")} />
        </Marker>
      )}
    </>
  );
}
