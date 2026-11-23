import type { PigPhoto } from "@librephotos/api-client";
import { Box } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { AttributionControl, Layer, Marker, NavigationControl, Source } from "react-map-gl/maplibre";
import { z } from "zod";
import type { ResolvedMapStyle } from "../../util/mapStyle";
import { STORAGE_KEYS, useStoredState } from "../../util/storage";
import { Segmented } from "../common/Segmented";
import { MapResizeHandle } from "./MapResizeHandle";
import { PHOTO_DENSITY_SOURCE } from "./placesLayers";
import classes from "./PlacesPhotoMap.module.css";
import { SpotCard, SpotRing } from "./SpotCard";
import { SpotLightbox } from "./SpotLightbox";
import { ThemedMap } from "./ThemedMap";
import { CLUSTER_MAX_ZOOM, type usePlacesMap } from "./usePlacesMap";

/** How tall the Places map can be made with its grip, in pixels. */
export const PLACES_MAP_HEIGHTS = { min: 240, max: 560 } as const;

/** The map's height until its grip is dragged: 40 % of the window, from 320 to 480 px. */
export function defaultPlacesMapHeight(windowHeight: number): number {
  return Math.round(Math.min(480, Math.max(320, windowHeight * 0.4)));
}

const MapModeSchema = z.enum(["clusters", "heatmap"]);

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
  const { t } = useTranslation();
  const [viewer, setViewer] = useState<{ photos: PigPhoto[]; startId: string } | null>(null);
  const [mode, setMode] = useStoredState(STORAGE_KEYS.placesMapMode, MapModeSchema, "clusters");
  const heatmap = mode === "heatmap";
  const { spot } = placesMap;
  const shown = (hidden: boolean): { visibility: "none" | "visible" } => ({
    visibility: hidden ? "none" : "visible",
  });

  return (
    <>
      <Box pos="relative">
        <ThemedMap
          ref={placesMap.setMapRef}
          h={height}
          className={classes.map}
          // One world, fitted to the photos: a wide map repeated the continents side by side
          renderWorldCopies={false}
          initialViewState={placesMap.initialViewState}
          mapStyle={mapStyle}
          onMoveEnd={placesMap.onMoveEnd}
          onLoad={placesMap.onLoad}
          onClick={placesMap.onClick}
          interactiveLayerIds={heatmap ? [] : ["clusters", "unclustered-point"]}
          attributionControl={false}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <AttributionControl compact={true} />
          <Source id={PHOTO_DENSITY_SOURCE} type="geojson" data={placesMap.geojsonData} cluster={false}>
            <Layer {...placesMap.layers.heatmap} layout={shown(!heatmap)} />
          </Source>
          <Source
            id="locations"
            type="geojson"
            data={placesMap.geojsonData}
            cluster={true}
            clusterMaxZoom={CLUSTER_MAX_ZOOM}
            clusterRadius={50}
            clusterProperties={{ photos: ["+", ["get", "photos"]] }}
          >
            <Layer {...placesMap.layers.clusters} layout={shown(heatmap)} />
            <Layer
              {...placesMap.layers.clusterCount}
              layout={{ ...placesMap.layers.clusterCount.layout, ...shown(heatmap) }}
            />
            <Layer {...placesMap.layers.unclusteredPoint} layout={shown(heatmap)} />
          </Source>
          {overlay}
          {spot && (
            <Marker longitude={spot.longitude} latitude={spot.latitude}>
              <SpotRing />
            </Marker>
          )}
        </ThemedMap>
        <Box className={classes.modeToggle}>
          <Segmented
            value={mode}
            onChange={value => {
              if (value === "heatmap") placesMap.closeSpot();
              setMode(() => value);
            }}
            aria-label={t("placealbum.mapMode")}
            segments={[
              { value: "clusters", label: t("placealbum.mapModeClusters") },
              { value: "heatmap", label: t("placealbum.mapModeHeatmap") },
            ]}
          />
        </Box>
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
