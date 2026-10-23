import type { PigPhoto } from "@librephotos/api-client";
import { Box } from "@mantine/core";
import React, { useState } from "react";
import { AttributionControl, Layer, Marker, NavigationControl, Source } from "react-map-gl/maplibre";
import type { ResolvedMapStyle } from "../../util/mapStyle";
import { MapResizeHandle } from "./MapResizeHandle";
import { SpotCard, SpotRing } from "./SpotCard";
import { SpotLightbox } from "./SpotLightbox";
import { ThemedMap } from "./ThemedMap";
import { CLUSTER_MAX_ZOOM, type usePlacesMap } from "./usePlacesMap";

/** How tall the Places map can be made with its grip, in pixels. */
export const PLACES_MAP_HEIGHTS = { min: 240, max: 560 } as const;

type Props = Readonly<{
  placesMap: ReturnType<typeof usePlacesMap>;
  mapStyle: Exclude<ResolvedMapStyle, null>;
  height: number;
  onHeightChange: (height: number) => void;
  /** More on the map, over the photos: your places (#1365). */
  overlay?: React.ReactNode;
  /** Over the map's corner, instead of a spot's card: the editor of a place being drawn. */
  panel?: React.ReactNode;
  /** The grip under the map; off while a place is drawn on a taller map. */
  resizable?: boolean;
}>;

/**
 * The Places page's map of photos (#343): clusters that count photos, the popover of a spot, the
 * lightbox it opens, and the grip that makes the map taller.
 */
export function PlacesPhotoMap({
  placesMap,
  mapStyle,
  height,
  onHeightChange,
  overlay,
  panel,
  resizable = true,
}: Props) {
  const [viewer, setViewer] = useState<{ photos: PigPhoto[]; startId: string } | null>(null);
  const { spot } = placesMap;

  return (
    <>
      <Box pos="relative">
        <ThemedMap
          ref={placesMap.setMapRef}
          h={height}
          initialViewState={placesMap.initialViewState}
          mapStyle={mapStyle}
          onMoveEnd={placesMap.onMoveEnd}
          onLoad={placesMap.onLoad}
          onClick={placesMap.onClick}
          interactiveLayerIds={["clusters", "unclustered-point"]}
          attributionControl={false}
        >
          <NavigationControl position="top-right" />
          <AttributionControl compact={true} />
          <Source
            id="locations"
            type="geojson"
            data={placesMap.geojsonData}
            cluster={true}
            clusterMaxZoom={CLUSTER_MAX_ZOOM}
            clusterRadius={50}
            clusterProperties={{ photos: ["+", ["get", "photos"]] }}
          >
            <Layer {...placesMap.layers.clusters} />
            <Layer {...placesMap.layers.clusterCount} />
            <Layer {...placesMap.layers.unclusteredPoint} />
          </Source>
          {overlay}
          {spot && (
            <Marker longitude={spot.longitude} latitude={spot.latitude}>
              <SpotRing />
            </Marker>
          )}
        </ThemedMap>
        {panel}
        {spot && !panel && (
          <SpotCard
            // A new spot starts with its own photos, not the last one's
            key={`${spot.longitude},${spot.latitude}`}
            spot={spot}
            onClose={placesMap.closeSpot}
            onOpen={(photos, startId) => setViewer({ photos, startId })}
          />
        )}
      </Box>
      {resizable && (
        <MapResizeHandle
          height={height}
          min={PLACES_MAP_HEIGHTS.min}
          max={PLACES_MAP_HEIGHTS.max}
          onChange={onHeightChange}
        />
      )}
      {viewer && <SpotLightbox photos={viewer.photos} startId={viewer.startId} onClose={() => setViewer(null)} />}
    </>
  );
}
