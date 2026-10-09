import { Avatar, Box, Button, Divider, Group, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconMap2 as Map2, IconSettingsAutomation as SettingsAutomation } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { groupBy, sortBy } from "lodash-es";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchAutoAlbumQuery } from "../../../api_client/albums/hooks";
import { serverAddress } from "../../../api_client/apiClient";
import { Media } from "../../../api_client/photos/types";
import { albumNotFoundState } from "../../../components/album/albumNotFound";
import { eventLocationNames } from "../../../components/album/eventLocations";
import { AlbumLocationMap } from "../../../components/AlbumLocationMap";
import { PhotoListView } from "../../../components/photolist/PhotoListView";

export const Route = createFileRoute("/_protected/album/events/$id")({
  component: AlbumAutoGalleryView,
});

function AlbumAutoGalleryView() {
  const { id } = Route.useParams();
  // isLoading, not isFetching: a background refetch (window focus after the
  // stale time) must not swap the gallery, its selection and scroll for a loader.
  const { data: album, isLoading, isError } = useFetchAutoAlbumQuery(id);
  const [showMap, { toggle: toggleMap }] = useDisclosure(false);
  const { t } = useTranslation();

  if (!album) {
    return (
      <PhotoListView
        title={isError ? t("events") : t("loading")}
        loading={isLoading}
        icon={<SettingsAutomation size={50} />}
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
  const byDate = groupBy(photos, photo => photo.exif_timestamp.split("T")[0]);

  // Check if any photos have GPS coordinates
  const hasGPSCoordinates = photos.some(photo => photo.exif_gps_lat !== null && photo.exif_gps_lon !== null);

  // Convert photos to the format expected by PhotoListView
  const groupedPhotos = Object.entries(byDate).map(([date, items]) => ({
    date,
    location: null,
    items: items.map(photo => ({
      id: photo.id,
      hash: photo.image_hash,
      video: photo.video,
      timestamp: photo.exif_timestamp,
      image_hash: photo.image_hash,
      exif_timestamp: photo.exif_timestamp,
      rating: photo.rating,
      public: photo.public,
      geolocation_json: photo.geolocation_json,
      url: photo.image_hash, // Just pass the image_hash, getUrl will construct the full URL
      // The Media values the tile overlays check, so videos get their play badge
      type: photo.video ? Media.VIDEO : Media.IMAGE,
      // Square only for backends that do not send the ratio yet
      aspectRatio: photo.aspectRatio ?? 1,
      // Empty lets the tile show the page behind it, as other grids do without a colour
      dominantColor: photo.dominantColor ?? "",
      video_length: photo.video_length == null ? undefined : String(photo.video_length),
      is_hdr: photo.is_hdr ?? false,
      // The grid fields an event photo has no source for
      shared_to: [],
      isTemp: false,
      has_raw_variant: false,
      style: {
        width: 200,
        height: 200,
        translateX: 0,
        translateY: 0,
      },
    })),
  }));

  const locationNames = eventLocationNames(photos);

  // Under the title like the folder and album pages, not above it
  const subHeader =
    album.people.length > 0 || hasGPSCoordinates ? (
      <Group align="center" wrap="nowrap" gap="sm" mt="xs">
        {album.people.length > 0 && (
          <Avatar.Group>
            {album.people.slice(0, 5).map(person => (
              <Tooltip key={person.id} label={person.name} withArrow>
                <Avatar
                  // A router link, not an <a href> that reloaded the app
                  renderRoot={props => <Link to="/album/persons/$id" params={{ id: String(person.id) }} {...props} />}
                  radius="xl"
                  src={serverAddress + person.face_url}
                  alt={person.name}
                  size="sm"
                />
              </Tooltip>
            ))}
          </Avatar.Group>
        )}

        {hasGPSCoordinates && (
          <>
            {album.people.length > 0 && <Divider orientation="vertical" />}
            <Button
              variant={showMap ? "filled" : "light"}
              color={showMap ? "blue" : "gray"}
              onClick={() => {
                // The map opens above the (sticky) header: bring it into view
                if (!showMap) window.scrollTo({ top: 0, behavior: "smooth" });
                toggleMap();
              }}
              leftSection={<Map2 size={16} />}
              size="xs"
            >
              {showMap
                ? t("autoalbumgallery.hidemap")
                : locationNames.length > 0
                  ? t("autoalbumgallery.showonmap", { place: locationNames[0] })
                  : t("autoalbumgallery.showmap")}
            </Button>
          </>
        )}
      </Group>
    ) : null;

  return (
    <div>
      {showMap && hasGPSCoordinates && (
        <Box p={10}>
          <AlbumLocationMap photos={photos} />
        </Box>
      )}

      <PhotoListView
        title={album.title}
        loading={false}
        icon={<SettingsAutomation size={50} />}
        photoset={groupedPhotos}
        // The grid's own items in its order: the photos are sorted by time, so the days are too
        idx2hash={groupedPhotos.flatMap(group => group.items)}
        additionalSubHeader={subHeader}
        selectable
      />
    </div>
  );
}
