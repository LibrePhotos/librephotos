import { Flex, Text } from "@mantine/core";
import { IconMap2 as Map2 } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { AttributionControl, Layer, NavigationControl, Source } from "react-map-gl/maplibre";
import type { PlaceAlbumList } from "../../../api_client/albums/hooks";
import { useFetchLocationClustersQuery, useFetchPlacesAlbumsQuery } from "../../../api_client/albums/hooks";
import gridClasses from "../../../components/album/AlbumGridCell.module.css";
import { PLACE_SORT } from "../../../components/album/albumSortConfigs";
import { AlbumSortMenu } from "../../../components/album/AlbumSortMenu";
import { useAlbumSort } from "../../../components/album/useAlbumSort";
import { EmptyState } from "../../../components/common/EmptyState";
import { ErrorState } from "../../../components/common/ErrorState";
import { PageLoader } from "../../../components/common/PageLoader";
import { useListFailure } from "../../../components/common/useListFailure";
import { MapDisabledPlaceholder } from "../../../components/map/MapDisabledPlaceholder";
import { ThemedMap } from "../../../components/map/ThemedMap";
import { usePlacesMap } from "../../../components/map/usePlacesMap";
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

// One empty list while loading, so the sorted list is not recomputed on every render
const NO_PLACES: PlaceAlbumList = [];

// The map (or its placeholder) above the grid, and the padding under it
const MAP_HEIGHT = 240;
const MAP_BLOCK_HEIGHT = MAP_HEIGHT + 10;

function AlbumPlace({ height = 0 }: Props) {
  const { t } = useTranslation();
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
  const placesMap = usePlacesMap(albums, locationClusters, height);
  const { visibleAlbums } = placesMap;
  // In the order the user picked (#620); by default countries first, then the most photos
  const placeSort = useAlbumSort(PLACE_SORT, visibleAlbums ?? albums ?? NO_PLACES);
  const shownAlbums = placeSort.sorted;
  // The hook leaves room for the header only. Less the map, so the page does not scroll
  // as well as the grid, but always tall enough for one row on a short screen.
  const sizing = useAlbumListGridConfig({ reservedHeight: MAP_BLOCK_HEIGHT });

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
        actions={hasPlaces ? <AlbumSortMenu {...placeSort.menu} /> : null}
      />
      {listFailure ? (
        <ErrorState failure={listFailure} />
      ) : !hasPlaces ? (
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
                ref={placesMap.setMapRef}
                h={MAP_HEIGHT}
                initialViewState={placesMap.initialViewState}
                mapStyle={mapStyle}
                onMoveEnd={placesMap.onMoveEnd}
                onLoad={placesMap.onLoad}
                onClick={placesMap.onClick}
                interactiveLayerIds={["clusters"]}
                attributionControl={false}
              >
                <NavigationControl position="top-right" />
                <AttributionControl compact={true} />
                <Source
                  id="locations"
                  type="geojson"
                  data={placesMap.geojsonData}
                  cluster={true}
                  clusterMaxZoom={14}
                  clusterRadius={50}
                >
                  <Layer {...placesMap.layers.clusters} />
                  <Layer {...placesMap.layers.clusterCount} />
                  <Layer {...placesMap.layers.unclusteredPoint} />
                </Source>
              </ThemedMap>
            )}
          </div>
          {/* Only the places inside the map bounds; laid out like the other album grids:
              square cover, then a one-line title */}
          <TileGrid
            scrollRestorationId="album-places"
            items={shownAlbums}
            orderKey={placeSort.orderKey}
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
