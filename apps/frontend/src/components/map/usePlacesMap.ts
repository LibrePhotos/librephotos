import type { MapBounds, PhotoMapPoints } from "@librephotos/api-client";
import { useViewportSize } from "@mantine/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import type { LatLon } from "../places/placeGeometry";
import { initialViewForClusters } from "./locationClusters";
import { ignoreMissingStyleImages } from "./mapImages";
import { spotForClick, type MapSpot } from "./mapSpot";
import { mapBoundsOf, photoPointCollection } from "./photoPoints";
import { clusterLayers } from "./placesLayers";
import { revealCircle } from "./revealCircle";
import { useMapLayerColors } from "./useMapLayerColors";

// The padding keeps edge points strictly inside the bounds the grid filters by
const FIT_PLACES = { padding: 40, maxZoom: 10 };

/** A box for the map to show, `[[west, south], [east, north]]`. */
type FitBox = [[number, number], [number, number]];
const FIT_BOX = { padding: 40, duration: 600 };

/** The last zoom the "locations" source clusters at; a click on a cluster there opens it. */
export const CLUSTER_MAX_ZOOM = 14;

/**
 * The Places page's map (#343): a clustered source of the photos where they were taken, its
 * layers, the view it shows (which the place grid under it filters by), and the point or cluster
 * a click opened. A click on a cluster zooms in until it splits; on a single spot, or on a cluster
 * at the last clustering zoom, it opens that spot's photos.
 */
export function usePlacesMap(
  points: PhotoMapPoints | undefined,
  height: number,
  /** While a place is drawn (#1365), a click picks its centre instead. */
  onPick?: (position: LatLon) => void,
  /** The radius of the place being drawn, which a picked centre zooms in to show. */
  pickRadiusM = 0
) {
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
  const onClick = useCallback(
    (event: MapLayerMouseEvent) => {
      setSpot(null);
      const map = mapRef.current;
      if (!map) return;
      const position = { lat: event.lngLat.lat, lon: event.lngLat.lng };
      if (onPick) {
        onPick(position);
        revealCircle(map, position, pickRadiusM);
      } else void spotForClick(map, event, CLUSTER_MAX_ZOOM).then(setSpot);
    },
    [onPick, pickRadiusM]
  );

  // A box asked for before the map was there, shown once it has loaded
  const pendingFit = useRef<FitBox | null>(null);
  /** Show `[[west, south], [east, north]]` (a place about to be edited), now or once the map loads. */
  const fitTo = useCallback((box: FitBox) => {
    if (mapRef.current) mapRef.current.fitBounds(box, FIT_BOX);
    else pendingFit.current = box;
  }, []);
  const onLoad = useCallback(() => {
    readBounds();
    if (pendingFit.current) mapRef.current?.fitBounds(pendingFit.current, FIT_BOX);
    pendingFit.current = null;
  }, [readBounds]);

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
    fitTo,
    geojsonData,
    initialViewState,
    layers,
    onMoveEnd: readBounds,
    onLoad,
    onClick,
  };
}
