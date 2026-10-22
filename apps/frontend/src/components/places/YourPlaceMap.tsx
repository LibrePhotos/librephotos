import type { UserPlace } from "@librephotos/api-client";
import { Box } from "@mantine/core";
import React, { useMemo } from "react";
import { AttributionControl, Layer, NavigationControl, Source } from "react-map-gl/maplibre";
import { PAGE_GUTTER } from "../../uiConstants";
import { useMapStyle } from "../../util/mapStyle";
import { ignoreMissingStyleImages } from "../map/mapImages";
import { ThemedMap } from "../map/ThemedMap";
import { useMapLayerColors } from "../map/useMapLayerColors";
import { boxAround, circlePolygon } from "./placeGeometry";

type Props = Readonly<{ place: UserPlace }>;

const HEIGHT = 180;

/** A place's circle on a small map, at the top of its page (#1365). Nothing while maps are off. */
export function YourPlaceMap({ place }: Props) {
  const { mapStyle } = useMapStyle();
  const colors = useMapLayerColors();
  const circle = useMemo(
    () => ({ center: { lat: place.center_lat, lon: place.center_lon }, radiusM: place.radius_m }),
    [place]
  );
  // The circle and some room around it
  const initialViewState = useMemo(() => ({ bounds: boxAround(place) }), [place]);
  if (mapStyle === null) return null;
  return (
    <Box px={PAGE_GUTTER} pb={PAGE_GUTTER}>
      <ThemedMap
        ref={ignoreMissingStyleImages}
        h={HEIGHT}
        initialViewState={initialViewState}
        mapStyle={mapStyle}
        attributionControl={false}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <AttributionControl compact={true} />
        <Source id="your-place" type="geojson" data={circlePolygon(circle)}>
          <Layer id="your-place-fill" type="fill" paint={{ "fill-color": colors.place, "fill-opacity": 0.15 }} />
          <Layer id="your-place-line" type="line" paint={{ "line-color": colors.place, "line-width": 2 }} />
        </Source>
      </ThemedMap>
    </Box>
  );
}
