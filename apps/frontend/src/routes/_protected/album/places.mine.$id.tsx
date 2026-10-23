import { Text } from "@mantine/core";
import { IconMapPin } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useUserPlacePhotosQuery, useUserPlacesQuery } from "../../../api_client/albums/hooks";
import { ApiError } from "../../../api_client/apiError";
import { albumNotFoundState } from "../../../components/album/albumNotFound";
import { useListFailure } from "../../../components/common/useListFailure";
import { validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";
import { PLACE_ICONS } from "../../../components/places/placeIcons";
import { YourPlaceActions } from "../../../components/places/YourPlaceActions";
import { YourPlaceMap } from "../../../components/places/YourPlaceMap";

export const Route = createFileRoute("/_protected/album/places/mine/$id")({
  component: YourPlaceGallery,
  validateSearch: validateMediaSearch,
});

/** One of your places (#1365): its photos by day, its circle, and the way to edit or delete it. */
function YourPlaceGallery() {
  const { t } = useTranslation();
  const placeId = Number(Route.useParams().id);
  const mediaType = useMediaTypeFilter();
  const query = useUserPlacePhotosQuery(placeId, mediaType);
  const { data: album, isLoading, error } = query;
  const failure = useListFailure(query);
  const { data: places } = useUserPlacesQuery();
  const place = places?.find(candidate => candidate.id === placeId);
  // Another user's place, or one deleted since, is not there; any other failure can be retried
  const notFound = error instanceof ApiError && error.status === 404 && !album;

  return (
    <PhotoListView
      title={album?.name ?? (notFound ? t("places") : t("loading"))}
      loading={isLoading}
      emptyStateConfig={notFound ? albumNotFoundState(t, <IconMapPin size={40} />, "/album/places") : undefined}
      icon={place ? PLACE_ICONS[place.icon] : IconMapPin}
      photoset={album?.grouped_photos ?? []}
      idx2hash={album?.grouped_photos.flatMap(group => group.items) ?? []}
      mediaType={notFound ? undefined : mediaType}
      error={notFound ? undefined : failure}
      additionalSubHeader={
        place && (
          <Text size="sm" c="dimmed">
            {t("yourplaces.pageSubtitle", { radius: place.radius_m })}
          </Text>
        )
      }
      headerActions={place && <YourPlaceActions place={place} />}
      banner={place && <YourPlaceMap place={place} />}
      selectable
    />
  );
}
