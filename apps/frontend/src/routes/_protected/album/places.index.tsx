import { Center, Flex, Loader, Text } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { IconMap2 as Map2 } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { orderBy } from "lodash-es";
import type {
  CircleLayerSpecification,
  GeoJSONSource,
  Source as MapSource,
  SymbolLayerSpecification,
} from "maplibre-gl";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import MapGL, {
  AttributionControl,
  Layer,
  MapLayerMouseEvent,
  MapRef,
  NavigationControl,
  Source,
} from "react-map-gl/maplibre";
import type { PlaceAlbumList } from "../../../api_client/albums/hooks";
import { useFetchLocationClustersQuery, useFetchPlacesAlbumsQuery } from "../../../api_client/albums/hooks";
import { EmptyState } from "../../../components/common/EmptyState";
import { HeaderComponent } from "../../../components/HeaderComponent";
import { clusterFeatureCollection, clusterPoints } from "../../../components/map/locationClusters";
import { MapDisabledPlaceholder } from "../../../components/map/MapDisabledPlaceholder";
import { ignoreMissingStyleImages } from "../../../components/map/mapImages";
import { Tile } from "../../../components/Tile";
import { VirtualGrid } from "../../../components/virtual/VirtualGrid";
import type { GridCellProps } from "../../../components/virtual/VirtualGrid";
import { ALBUM_GRID_GUTTER, useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";
import { useMapStyle } from "../../../util/mapStyle";

export const Route = createFileRoute("/_protected/album/places/")({
  component: AlbumPlace,
});

type Props = Readonly<{
  height?: number;
}>;

// Broad places first, and within a level the ones with the most photos
const sortPlaces = (albums: PlaceAlbumList) => orderBy(albums, ["geolocation_level", "photo_count"], ["asc", "desc"]);

// Where the map opens when there is nothing to fit it to
const WORLD_VIEW = { longitude: 0, latitude: 40, zoom: 2 };

// The map (or its placeholder) above the grid, and the padding under it
const MAP_HEIGHT = 240;
const MAP_BLOCK_HEIGHT = MAP_HEIGHT + 10;

// MapLibre refuses to register another source type under a built-in name, so
// "geojson" is always its own GeoJSONSource
const isGeoJSONSource = (source: MapSource | undefined): source is GeoJSONSource => source?.type === "geojson";

// Layer styles for clustered points
const clusterLayer: CircleLayerSpecification = {
  id: "clusters",
  type: "circle",
  source: "locations",
  filter: ["has", "point_count"],
  paint: {
    "circle-color": ["step", ["get", "point_count"], "#51bbd6", 10, "#f1f075", 50, "#f28cb1"],
    "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 50, 25],
  },
};

const clusterCountLayer: SymbolLayerSpecification = {
  id: "cluster-count",
  type: "symbol",
  source: "locations",
  filter: ["has", "point_count"],
  layout: {
    "text-field": "{point_count_abbreviated}",
    "text-font": ["Open Sans Bold"],
    "text-size": 12,
  },
  paint: {
    "text-color": "#000",
  },
};

const unclusteredPointLayer: CircleLayerSpecification = {
  id: "unclustered-point",
  type: "circle",
  source: "locations",
  filter: ["!", ["has", "point_count"]],
  paint: {
    "circle-color": "#11b4da",
    "circle-radius": 8,
    "circle-stroke-width": 2,
    "circle-stroke-color": "#fff",
  },
};

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
  const { data: albums, isFetching: isFetchingAlbums, isLoading: isLoadingAlbums } = useFetchPlacesAlbumsQuery();
  const {
    data: locationClusters,
    isFetching: isFetchingLocationClusters,
    isLoading: isLoadingLocationClusters,
  } = useFetchLocationClustersQuery();
  const { mapStyle, mapsDisabled } = useMapStyle();
  const shownAlbums = useMemo(() => visibleAlbums ?? sortPlaces(albums ?? []), [visibleAlbums, albums]);
  // The grid only shows the places inside the map bounds, so size it from those
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(shownAlbums);

  // Convert locationClusters to GeoJSON FeatureCollection
  const geojsonData = useMemo(() => clusterFeatureCollection(locationClusters), [locationClusters]);

  // Open on every place rather than a fixed view of Europe: the grid lists only
  // what the map shows, so places outside that view were missing until a pan.
  const initialViewState = useMemo(() => {
    const coordinates = geojsonData.features.map(feature => feature.geometry.coordinates);
    if (coordinates.length === 0) return WORLD_VIEW;
    const longitudes = coordinates.map(([lng]) => lng);
    const latitudes = coordinates.map(([, lat]) => lat);
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...longitudes), Math.min(...latitudes)],
      [Math.max(...longitudes), Math.max(...latitudes)],
    ];
    return {
      bounds,
      // The padding keeps edge points strictly inside the bounds the grid filters by
      fitBoundsOptions: { padding: 40, maxZoom: 10 },
    };
  }, [geojsonData]);

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

    if (features.length > 0) {
      const clusterId: unknown = features[0].properties?.cluster_id;
      // The clustered GeoJSON source declared below
      const mapboxSource = mapRef.current.getSource("locations");

      if (isGeoJSONSource(mapboxSource) && typeof clusterId === "number") {
        try {
          const zoom = await mapboxSource.getClusterExpansionZoom(clusterId);
          const { geometry } = features[0];

          // A cluster is always a point
          if (geometry.type === "Point") {
            const [lng, lat] = geometry.coordinates;
            mapRef.current.easeTo({ center: [lng, lat], zoom });
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

  function renderCell({ columnIndex, key, rowIndex, style }: GridCellProps) {
    if (shownAlbums.length === 0) {
      return null;
    }
    const index = rowIndex * entriesPerRow + columnIndex;
    if (index >= shownAlbums.length) {
      return <div key={key} style={style} />;
    }
    const place = shownAlbums[index];
    // Laid out like the other album grids: square cover, then a one-line title
    return (
      <div key={key} style={style}>
        <div style={{ padding: 5 }}>
          {place.cover_photos.slice(0, 1).map(photo => (
            <Link key={place.id} to="/album/places/$id" params={{ id: String(place.id) }}>
              <Tile
                video={photo.video === true}
                height={entrySquareSize - 10}
                width={entrySquareSize - 10}
                image_hash={photo.image_hash}
              />
            </Link>
          ))}
        </div>
        <Flex gap={0} justify="flex-start" direction="column" px={8}>
          <Text size="sm" fw={500} lineClamp={1} title={place.title}>
            {place.title}
          </Text>
          <Text size="xs">{t("numberofphotos", { count: place.photo_count, number: place.photo_count })}</Text>
        </Flex>
      </div>
    );
  }

  if (isLoadingAlbums || isLoadingLocationClusters) {
    // A Loader with children renders only them, so the spinner sits beside the text
    return (
      <Center py="xl" style={{ minHeight: height }}>
        <Loader size="sm" />
        <Text size="sm" c="dimmed" ml="xs">
          {t("placealbum.maploading")}
        </Text>
      </Center>
    );
  }

  const hasPlaces = albums && albums.length > 0;

  return (
    <div>
      <HeaderComponent
        icon={<Map2 size={50} />}
        title={t("places")}
        fetching={isFetchingLocationClusters || isFetchingAlbums}
        // Without a map nothing filters the list, so there is no "on the map" to speak of
        subtitle={t(mapsDisabled ? "placealbum.placecount" : "placealbum.showingplaces", {
          count: shownAlbums.length,
          number: shownAlbums.length,
        })}
      />
      {!isLoadingAlbums && !hasPlaces ? (
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
              <MapGL
                ref={setMapRef}
                initialViewState={initialViewState}
                style={{ width: "100%", height: MAP_HEIGHT }}
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
                  <Layer {...clusterLayer} />
                  <Layer {...clusterCountLayer} />
                  <Layer {...unclusteredPointLayer} />
                </Source>
              </MapGL>
            )}
          </div>
          <VirtualGrid
            style={{ outline: "none", paddingLeft: ALBUM_GRID_GUTTER }}
            cellRenderer={renderCell}
            columnWidth={entrySquareSize}
            columnCount={entriesPerRow}
            // The hook leaves room for the header only. Less the map, so the page does not scroll
            // as well as the grid, but always tall enough for one row on a short screen.
            height={Math.max(gridHeight - MAP_BLOCK_HEIGHT, entrySquareSize + 60)}
            rowHeight={entrySquareSize + 60}
            rowCount={numberOfRows}
          />
        </>
      )}
    </div>
  );
}
