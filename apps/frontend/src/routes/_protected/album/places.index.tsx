import type { UserPlace } from "@librephotos/api-client";
import { Button, Group, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconMapPinPlus, IconMap2 as Map2 } from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PlaceAlbumList } from "../../../api_client/albums/hooks";
import {
  useFetchPhotoMapPointsQuery,
  useFetchPlacesAlbumsQuery,
  usePlaceAlbumsInBoundsQuery,
  useUserPlacesQuery,
} from "../../../api_client/albums/hooks";
import { PLACE_SORT } from "../../../components/album/albumSortConfigs";
import { AlbumSortMenu } from "../../../components/album/AlbumSortMenu";
import { useAlbumSort } from "../../../components/album/useAlbumSort";
import { DisabledReason } from "../../../components/common/DisabledReason";
import { EmptyState } from "../../../components/common/EmptyState";
import { ErrorState } from "../../../components/common/ErrorState";
import { PageLoader } from "../../../components/common/PageLoader";
import { useListFailure } from "../../../components/common/useListFailure";
import { PLACES_MAP_HEIGHTS } from "../../../components/map/PlacesPhotoMap";
import { usePlacesMap } from "../../../components/map/usePlacesMap";
import { PageHeader } from "../../../components/PageHeader";
import { PlaceAlbumGrid } from "../../../components/places/PlaceAlbumGrid";
import { boxAround } from "../../../components/places/placeGeometry";
import { PlacesMapSection } from "../../../components/places/PlacesMapSection";
import { validatePlacesSearch } from "../../../components/places/placesSearch";
import { addPlaceBlocked, usePlaceEditor } from "../../../components/places/usePlaceEditor";
import { YourPlacesRow } from "../../../components/places/YourPlacesRow";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";
import { useMapStyle } from "../../../util/mapStyle";
import { STORAGE_KEYS, useStoredState } from "../../../util/storage";

export const Route = createFileRoute("/_protected/album/places/")({
  component: AlbumPlace,
  validateSearch: validatePlacesSearch,
});

type Props = Readonly<{
  height?: number;
}>;

// One empty list while loading, so the sorted list is not recomputed on every render
const NO_PLACES: PlaceAlbumList = [];
const NO_USER_PLACES: UserPlace[] = [];

// What the page reserves under the map (or its placeholder): its grip and the padding
const MAP_EXTRA_HEIGHT = 24;
// The map while a place is drawn (#1365): tall enough to draw on, and on a phone short enough to
// leave room for the editor under it
const EDITOR_MAP_HEIGHT = { wide: 560, narrow: 320 };
// "Your places" and the "Places in view" heading above the grid
const YOUR_PLACES_ROW_HEIGHT = 230;
const MapHeight = z.number().int().min(PLACES_MAP_HEIGHTS.min).max(PLACES_MAP_HEIGHTS.max);

/** The place albums the map's view holds a photo of, or all of them before it reports a view. */
function placesInView(albums: PlaceAlbumList | undefined, ids: readonly number[] | undefined) {
  if (!albums || !ids) return albums;
  const inView = new Set(ids);
  return albums.filter(album => inView.has(album.id));
}

function AlbumPlace({ height = 0 }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { edit } = Route.useSearch();
  // The loader waits for the first answer only: on a background refetch the map
  // stays mounted and keeps the user's pan and zoom.
  const albumsQuery = useFetchPlacesAlbumsQuery();
  const { data: albums, isFetching: isFetchingAlbums, isLoading: isLoadingAlbums } = albumsQuery;
  const listFailure = useListFailure(albumsQuery);
  // The map shows photos where they were taken, and the grid the places with a photo in view (#343)
  const { data: mapPoints, isFetching: isFetchingPoints, isLoading: isLoadingPoints } = useFetchPhotoMapPointsQuery();
  const userPlaces = useUserPlacesQuery().data ?? NO_USER_PLACES;
  const { mapStyle, mapsDisabled } = useMapStyle();
  const [storedHeight, setMapHeight] = useStoredState(STORAGE_KEYS.placesMapHeight, MapHeight, PLACES_MAP_HEIGHTS.min);
  const placeEditor = usePlaceEditor();
  const { start: startEditing, editor } = placeEditor;
  const wide = useMediaQuery("(min-width: 48em)", true);
  const editorHeight = wide ? EDITOR_MAP_HEIGHT.wide : EDITOR_MAP_HEIGHT.narrow;
  const mapHeight = editor ? editorHeight : storedHeight;
  const placesMap = usePlacesMap(mapPoints, height + mapHeight, editor ? placeEditor.pick : undefined, editor?.radiusM);
  const { fitTo } = placesMap;
  const { data: idsInView } = usePlaceAlbumsInBoundsQuery(mapStyle === null ? null : placesMap.bounds);
  const visibleAlbums = useMemo(() => placesInView(albums, idsInView), [albums, idsInView]);
  // In the order the user picked (#620); by default countries first, then the most photos
  const placeSort = useAlbumSort(PLACE_SORT, visibleAlbums ?? NO_PLACES);
  const shownAlbums = placeSort.sorted;
  // The hook leaves room for the header only. Less the map, so the page does not scroll
  // as well as the grid, but always tall enough for one row on a short screen.
  const rowHeight = userPlaces.length > 0 ? YOUR_PLACES_ROW_HEIGHT : 0;
  const sizing = useAlbumListGridConfig({ reservedHeight: mapHeight + MAP_EXTRA_HEIGHT + rowHeight });

  // The place page's Edit place (?edit=<id>): the editor opens on it once the places are there
  const placeToEdit = userPlaces.find(place => place.id === edit);
  useEffect(() => {
    if (!placeToEdit) return;
    startEditing(placeToEdit);
    fitTo(boxAround(placeToEdit));
    void navigate({ to: "/album/places", search: {}, replace: true });
  }, [placeToEdit, startEditing, fitTo, navigate]);

  if (isLoadingAlbums || isLoadingPoints) {
    return <PageLoader label={t("placealbum.maploading")} />;
  }

  const hasPlaces = (albums && albums.length > 0) || userPlaces.length > 0;
  const blocked = addPlaceBlocked(t, mapStyle === null, editor !== null);

  return (
    <div>
      <PageHeader
        icon={Map2}
        title={t("places")}
        loading={isFetchingPoints || isFetchingAlbums}
        // Without a map nothing filters the list, so there is no "on the map" to speak of
        subtitle={
          mapsDisabled
            ? t("placealbum.placecount", { count: shownAlbums.length })
            : `${t("placealbum.photosOnMap", { count: mapPoints?.photo_count ?? 0 })} · ${t("placealbum.placesInView", { count: shownAlbums.length })}`
        }
        actions={
          <Group gap="xs" wrap="nowrap">
            <DisabledReason reason={blocked}>
              <Button variant="light" leftSection={<IconMapPinPlus size={18} />} onClick={() => startEditing()}>
                {t("yourplaces.add")}
              </Button>
            </DisabledReason>
            {hasPlaces && <AlbumSortMenu {...placeSort.menu} />}
          </Group>
        }
      />
      {listFailure ? (
        <ErrorState failure={listFailure} />
      ) : !hasPlaces && !editor ? (
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
          <div style={{ padding: "0 10px 4px" }}>
            <PlacesMapSection
              placesMap={placesMap}
              mapStyle={mapStyle}
              height={mapHeight}
              onHeightChange={next => setMapHeight(() => next)}
              userPlaces={userPlaces}
              placeEditor={placeEditor}
              onOpenPlace={place => void navigate({ to: "/album/places/mine/$id", params: { id: String(place.id) } })}
            />
          </div>
          {userPlaces.length > 0 && (
            <>
              <YourPlacesRow places={userPlaces} addDisabledReason={blocked} onAdd={() => startEditing()} />
              <Text size="sm" fw={600} px={10}>
                {t("yourplaces.inView")}
              </Text>
            </>
          )}
          {/* Only the places with a photo inside the map's view */}
          <PlaceAlbumGrid places={shownAlbums} orderKey={placeSort.orderKey} sizing={sizing} />
        </>
      )}
    </div>
  );
}
