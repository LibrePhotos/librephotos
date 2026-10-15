import type { LocationClusters } from "@librephotos/api-client";
import { useViewportSize } from "@mantine/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import type { PlaceAlbumList } from "../../api_client/albums/hooks";
import { zoomIntoCluster } from "./clusterZoom";
import { clusterFeatureCollection, clusterPoints, initialViewForClusters } from "./locationClusters";
import { ignoreMissingStyleImages } from "./mapImages";
import { clusterLayers } from "./placesLayers";
import { useMapLayerColors } from "./useMapLayerColors";

// The padding keeps edge points strictly inside the bounds the grid filters by
const FIT_PLACES = { padding: 40, maxZoom: 10 };

/**
 * The Places page's map: its clustered source and layers, the zoom into a clicked cluster, and the
 * place albums inside its bounds, which the grid under it lists.
 */
export function usePlacesMap(
  albums: PlaceAlbumList | undefined,
  locationClusters: LocationClusters | undefined,
  height: number
) {
  const { width } = useViewportSize();
  const mapRef = useRef<MapRef | null>(null);
  const setMapRef = useCallback((map: MapRef | null) => {
    mapRef.current = map;
    ignoreMissingStyleImages(map);
  }, []);
  // `null` means the map has not reported any bounds yet: it is still being created, its
  // style never loaded, or map display is turned off altogether. Falling back to the full
  // album list keeps the page from sitting empty until the user pans or zooms.
  const [visibleAlbums, setVisibleAlbums] = useState<PlaceAlbumList | null>(null);

  // Convert locationClusters to GeoJSON FeatureCollection
  const geojsonData = useMemo(() => clusterFeatureCollection(locationClusters), [locationClusters]);

  // Open on every place rather than a fixed view of Europe: the grid lists only
  // what the map shows, so places outside that view were missing until a pan.
  const initialViewState = useMemo(() => initialViewForClusters(geojsonData, FIT_PLACES), [geojsonData]);
  const layerColors = useMapLayerColors();
  const layers = useMemo(() => clusterLayers(layerColors), [layerColors]);

  const updateVisibleAlbums = useCallback(
    (map: MapRef) => {
      if (!locationClusters || !albums) return;

      const bounds = map.getBounds();
      if (!bounds) return;

      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();

      const markers = clusterPoints(locationClusters).filter(
        ({ lng, lat }) => lat < ne.lat && lat > sw.lat && lng < ne.lng && lng > sw.lng
      );

      const visiblePlaceNames = markers.map(el => el.name);
      const visiblePlaceAlbums = albums.filter(el => visiblePlaceNames.includes(el.title));
      setVisibleAlbums(visiblePlaceAlbums);
    },
    [albums, locationClusters]
  );

  const onMoveEnd = useCallback(() => {
    if (!mapRef.current) return;
    updateVisibleAlbums(mapRef.current);
  }, [updateVisibleAlbums]);

  const onMapLoad = useCallback(() => {
    if (!mapRef.current) return;
    updateVisibleAlbums(mapRef.current);
  }, [updateVisibleAlbums]);

  // A click on a cluster zooms in until it splits
  const onClick = useCallback((event: MapLayerMouseEvent) => {
    if (mapRef.current) void zoomIntoCluster(mapRef.current, [event.point.x, event.point.y]);
  }, []);

  useEffect(() => {
    if (!mapRef.current || !albums || !locationClusters) return;
    updateVisibleAlbums(mapRef.current);
  }, [width, height, albums, locationClusters, updateVisibleAlbums]);

  return { setMapRef, visibleAlbums, geojsonData, initialViewState, layers, onMoveEnd, onLoad: onMapLoad, onClick };
}
