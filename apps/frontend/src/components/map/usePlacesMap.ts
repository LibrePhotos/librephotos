import type { MapBounds, PhotoMapPoints } from "@librephotos/api-client";
import { useViewportSize } from "@mantine/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import { initialViewForClusters } from "./locationClusters";
import { ignoreMissingStyleImages } from "./mapImages";
import { spotForClick, type MapSpot } from "./mapSpot";
import { mapBoundsOf, photoPointCollection } from "./photoPoints";
import { clusterLayers } from "./placesLayers";
import { useMapLayerColors } from "./useMapLayerColors";

// The padding keeps edge points strictly inside the bounds the grid filters by
const FIT_PLACES = { padding: 40, maxZoom: 10 };

/** The last zoom the "locations" source clusters at; a click on a cluster there opens it. */
export const CLUSTER_MAX_ZOOM = 14;

/**
 * The Places page's map (#343): a clustered source of the photos where they were taken, its
 * layers, the view it shows (which the place grid under it filters by), and the point or cluster
 * a click opened. A click on a cluster zooms in until it splits; on a single spot, or on a cluster
 * at the last clustering zoom, it opens that spot's photos.
 */
export function usePlacesMap(points: PhotoMapPoints | undefined, height: number) {
  const { width } = useViewportSize();
  const mapRef = useRef<MapRef | null>(null);
  const setMapRef = useCallback((map: MapRef | null) => {
    mapRef.current = map;
    ignoreMissingStyleImages(map);
  }, []);
  // Null until the map reports a view: it is still being created, its style never loaded, or
  // maps are turned off. The page lists every place until then.
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [spot, setSpot] = useState<MapSpot | null>(null);

  const geojsonData = useMemo(() => photoPointCollection(points?.points), [points]);
  // Open on every photo rather than a fixed view: the grid lists only what the map shows.
  const initialViewState = useMemo(() => initialViewForClusters(geojsonData, FIT_PLACES), [geojsonData]);
  const layerColors = useMapLayerColors();
  const layers = useMemo(() => clusterLayers(layerColors), [layerColors]);

  const readBounds = useCallback(() => {
    const view = mapRef.current?.getBounds();
    if (view) setBounds(mapBoundsOf(view));
  }, []);

  // Each click starts afresh: a zoom or a click beside every point closes the open spot
  const onClick = useCallback((event: MapLayerMouseEvent) => {
    setSpot(null);
    if (mapRef.current) void spotForClick(mapRef.current, event, CLUSTER_MAX_ZOOM).then(setSpot);
  }, []);

  const closeSpot = useCallback(() => setSpot(null), []);

  // A resized map or window shows another part of the world
  useEffect(() => {
    readBounds();
  }, [width, height, points, readBounds]);

  return {
    setMapRef,
    bounds,
    spot,
    closeSpot,
    geojsonData,
    initialViewState,
    layers,
    onMoveEnd: readBounds,
    onLoad: readBounds,
    onClick,
  };
}
