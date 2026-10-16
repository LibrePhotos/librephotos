import { Box } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconSettingsAutomation as SettingsAutomation } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { sortBy } from "lodash-es";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchAutoAlbumQuery } from "../../../api_client/albums/hooks";
import { albumNotFoundState } from "../../../components/album/albumNotFound";
import { eventPhotoGroups } from "../../../components/album/eventGrid";
import { EventHeaderMenu } from "../../../components/album/EventHeaderMenu";
import { eventLocationNames } from "../../../components/album/eventLocations";
import { EventSubHeader } from "../../../components/album/EventSubHeader";
import { AlbumLocationMap } from "../../../components/AlbumLocationMap";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { validatePhotoSearch } from "../../../components/photolist/photoSearch";
import { useEventTitle } from "../../../hooks/useEventTitle";

export const Route = createFileRoute("/_protected/album/events/$id")({
  component: AlbumAutoGalleryView,
  validateSearch: validatePhotoSearch,
});

function AlbumAutoGalleryView() {
  const { id } = Route.useParams();
  // isLoading, not isFetching: a background refetch (window focus after the
  // stale time) must not swap the gallery, its selection and scroll for a loader.
  const { data: album, isLoading, isError } = useFetchAutoAlbumQuery(id);
  const [showMap, { toggle: toggleMap }] = useDisclosure(false);
  const { t } = useTranslation();
  const eventTitle = useEventTitle();

  if (!album) {
    return (
      <PhotoListView
        title={isError ? t("events") : t("loading")}
        loading={isLoading}
        icon={SettingsAutomation}
        photoset={[]}
        idx2hash={[]}
        emptyStateConfig={
          isError ? albumNotFoundState(t, <SettingsAutomation size={40} />, "/album/events") : undefined
        }
        selectable={false}
      />
    );
  }

  const photos = sortBy(album.photos, "exif_timestamp").map((el, idx) => ({ ...el, idx }));
  const hasGPSCoordinates = photos.some(photo => photo.exif_gps_lat !== null && photo.exif_gps_lon !== null);
  const groupedPhotos = eventPhotoGroups(photos);

  const title = eventTitle(album);
  // The grid's own items in its order: the photos are sorted by time, so the days are too
  const gridPhotos = groupedPhotos.flatMap(group => group.items);

  return (
    <div>
      {showMap && hasGPSCoordinates && (
        <Box p={10}>
          <AlbumLocationMap photos={photos} />
        </Box>
      )}

      <PhotoListView
        title={title}
        loading={false}
        icon={SettingsAutomation}
        photoset={groupedPhotos}
        idx2hash={gridPhotos}
        additionalSubHeader={
          album.people.length > 0 || hasGPSCoordinates ? (
            <EventSubHeader
              people={album.people}
              hasGPSCoordinates={hasGPSCoordinates}
              showMap={showMap}
              onToggleMap={toggleMap}
              locationNames={eventLocationNames(photos)}
            />
          ) : null
        }
        headerActions={
          <EventHeaderMenu
            event={{ id: String(album.id), title, coverPhoto: album.cover_photo ?? null }}
            photos={gridPhotos}
          />
        }
        // The selection's "Set album cover" (#429)
        albumID={String(album.id)}
        selectable
      />
    </div>
  );
}
