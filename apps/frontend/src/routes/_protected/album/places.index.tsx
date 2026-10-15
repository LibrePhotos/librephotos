import { Flex, Text } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { IconMap2 as Map2 } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { orderBy } from "lodash-es";
import type { GeoJSONSource, Source as MapSource } from "maplibre-gl";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import { AttributionControl, Layer, NavigationControl, Source } from "react-map-gl/maplibre";
import type { PlaceAlbumList } from "../../../api_client/albums/hooks";
import { useFetchLocationClustersQuery, useFetchPlacesAlbumsQuery } from "../../../api_client/albums/hooks";
import gridClasses from "../../../components/album/AlbumGridCell.module.css";
import { EmptyState } from "../../../components/common/EmptyState";
import { ErrorState } from "../../../components/common/ErrorState";
import { PageLoader } from "../../../components/common/PageLoader";
import { useListFailure } from "../../../components/common/useListFailure";
import {
  clusterFeatureCollection,
  clusterPoints,
  initialViewForClusters,
} from "../../../components/map/locationClusters";
import { MapDisabledPlaceholder } from "../../../components/map/MapDisabledPlaceholder";
import { ignoreMissingStyleImages } from "../../../components/map/mapImages";
import { clusterLayers } from "../../../components/map/placesLayers";
import { ThemedMap } from "../../../components/map/ThemedMap";
import { useMapLayerColors } from "../../../components/map/useMapLayerColors";
import { PageHeader } from "../../../components/PageHeader";
import { Tile } from "../../../components/Tile";
import { TileGrid } from "../../../components/virtual/TileGrid";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";
import { useMapStyle } from "../../../util/mapStyle";

export const Route = createFileRoute("/_protected/album/places/")({
  component: AlbumPlace,
});

type Props = Readonly<{
  height?: number;
}>;

// Broad places first, and within a level the ones with the most photos
const sortPlaces = (albums: PlaceAlbumList) => orderBy(albums, ["geolocation_level", "photo_count"], ["asc", "desc"]);

// The map (or its placeholder) above the grid, and the padding under it
const MAP_HEIGHT = 240;
const MAP_BLOCK_HEIGHT = MAP_HEIGHT + 10;

// MapLibre refuses to register another source type under a built-in name, so
// "geojson" is always its own GeoJSONSource
const isGeoJSONSource = (source: MapSource | undefined): source is GeoJSONSource => source?.type === "geojson";

// The padding keeps edge points strictly inside the bounds the grid filters by
const FIT_PLACES = { padding: 40, maxZoom: 10 };

function AlbumPlace({ height = 0 }: Props) {
  const { width } = useViewportSize();
  const mapRef = useRef<MapRef | null>(null);
  const setMapRef = useCallback((map: MapRef | null) => {
    mapRef.current = map;
    ignoreMissingStyleImages(map);
  }, []);
  const { t } = useTranslation();
  // `null` means the map has not reported any bounds yet: it is still being created, its
  // style never loaded, or map display is turned off altogether. Falling back to the full
  // album list keeps the page from sitting empty until the user pans or zooms.
  const [visibleAlbums, setVisibleAlbums] = useState<PlaceAlbumList | null>(null);
  // The loader waits for the first answer only: on a background refetch the map
  // stays mounted and keeps the user's pan and zoom.
  const albumsQuery = useFetchPlacesAlbumsQuery();
  const { data: albums, isFetching: isFetchingAlbums, isLoading: isLoadingAlbums } = albumsQuery;
  const listFailure = useListFailure(albumsQuery);
  const {
    data: locationClusters,
    isFetching: isFetchingLocationClusters,
    isLoading: isLoadingLocationClusters,
  } = useFetchLocationClustersQuery();
  const { mapStyle, mapsDisabled } = useMapStyle();
  const shownAlbums = useMemo(() => visibleAlbums ?? sortPlaces(albums ?? []), [visibleAlbums, albums]);
  // The hook leaves room for the header only. Less the map, so the page does not scroll
  // as well as the grid, but always tall enough for one row on a short screen.
  const sizing = useAlbumListGridConfig({ reservedHeight: MAP_BLOCK_HEIGHT });

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
      setVisibleAlbums(sortPlaces(visiblePlaceAlbums));
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

  // Handle click on clusters to zoom in
  const onClick = useCallback(async (event: MapLayerMouseEvent) => {
    if (!mapRef.current) return;

    const features = mapRef.current.queryRenderedFeatures(event.point, {
      layers: ["clusters"],
    });

    const feature = features[0];
    if (feature !== undefined) {
      const clusterId: unknown = feature.properties?.cluster_id;
      // The clustered GeoJSON source declared below
      const mapboxSource = mapRef.current.getSource("locations");

      if (isGeoJSONSource(mapboxSource) && typeof clusterId === "number") {
        try {
          const zoom = await mapboxSource.getClusterExpansionZoom(clusterId);
          const { geometry } = feature;

          // A cluster is always a point
          if (geometry.type === "Point") {
            const [lng, lat] = geometry.coordinates;
            if (lng !== undefined && lat !== undefined) {
              mapRef.current.easeTo({ center: [lng, lat], zoom });
            }
          }
        } catch (err) {
          console.error("Error getting cluster expansion zoom:", err);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!mapRef.current || !albums || !locationClusters) return;
    updateVisibleAlbums(mapRef.current);
  }, [width, height, albums, locationClusters, updateVisibleAlbums]);

  if (isLoadingAlbums || isLoadingLocationClusters) {
    return <PageLoader label={t("placealbum.maploading")} />;
  }

  const hasPlaces = albums && albums.length > 0;

  return (
    <div>
      <PageHeader
        icon={Map2}
        title={t("places")}
        loading={isFetchingLocationClusters || isFetchingAlbums}
        // Without a map nothing filters the list, so there is no "on the map" to speak of
        subtitle={t(mapsDisabled ? "placealbum.placecount" : "placealbum.showingplaces", {
          count: shownAlbums.length,
          number: shownAlbums.length,
        })}
      />
      {listFailure ? (
        <ErrorState failure={listFailure} />
      ) : !isLoadingAlbums && !hasPlaces ? (
        <EmptyState
          icon={<Map2 size={40} />}
          title={t("emptystate.places.title")}
          description={t("emptystate.places.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      ) : (
        <>
          {/* Inset like the header above it, rather than pulled into the menu's edge */}
          <div style={{ padding: "0 10px 10px" }}>
            {mapStyle === null ? (
              <MapDisabledPlaceholder height={MAP_HEIGHT} />
            ) : (
              <ThemedMap
                ref={setMapRef}
                h={MAP_HEIGHT}
                initialViewState={initialViewState}
                mapStyle={mapStyle}
                onMoveEnd={onMoveEnd}
                onLoad={onMapLoad}
                onClick={onClick}
                interactiveLayerIds={["clusters"]}
                attributionControl={false}
              >
                <NavigationControl position="top-right" />
                <AttributionControl compact={true} />
                <Source
                  id="locations"
                  type="geojson"
                  data={geojsonData}
                  cluster={true}
                  clusterMaxZoom={14}
                  clusterRadius={50}
                >
                  <Layer {...layers.clusters} />
                  <Layer {...layers.clusterCount} />
                  <Layer {...layers.unclusteredPoint} />
                </Source>
              </ThemedMap>
            )}
          </div>
          {/* Only the places inside the map bounds; laid out like the other album grids:
              square cover, then a one-line title */}
          <TileGrid
            scrollRestorationId="album-places"
            items={shownAlbums}
            getKey={place => place.id}
            sizing={sizing}
            renderItem={(place, size) => {
              // A cover or a placeholder, so a place never depends on its cover to open (#2234)
              const cover = place.cover_photos[0];
              return (
                <Link to="/album/places/$id" params={{ id: String(place.id) }} aria-label={place.title}>
                  {cover ? (
                    <Tile
                      className={gridClasses.cover}
                      video={cover.video === true}
                      height={size}
                      width={size}
                      image_hash={cover.image_hash}
                    />
                  ) : (
                    <Flex
                      className={gridClasses.cover}
                      align="center"
                      justify="center"
                      h={size}
                      w={size}
                      bg="var(--mantine-color-default-hover)"
                    >
                      <Map2 size={40} stroke={1.5} color="var(--mantine-color-gray-5)" />
                    </Flex>
                  )}
                </Link>
              );
            }}
            renderCaption={place => (
              <Flex gap={0} justify="flex-start" direction="column" px={8}>
                <Link to="/album/places/$id" params={{ id: String(place.id) }} className={gridClasses.titleLink}>
                  <Text size="sm" fw={500} lineClamp={1} title={place.title}>
                    {place.title}
                  </Text>
                </Link>
                <Text size="xs">{t("numberofphotos", { count: place.photo_count, number: place.photo_count })}</Text>
              </Flex>
            )}
          />
        </>
      )}
    </div>
  );
}
