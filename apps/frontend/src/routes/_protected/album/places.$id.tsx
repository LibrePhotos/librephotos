import { IconMap as Map } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPlaceAlbumQuery } from "../../../api_client/albums/hooks";
import { albumNotFoundState } from "../../../components/album/albumNotFound";
import { validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";

export const Route = createFileRoute("/_protected/album/places/$id")({
  component: AlbumPlaceGallery,
  validateSearch: validateMediaSearch,
});

function AlbumPlaceGallery() {
  const { t } = useTranslation();
  const { id: albumID } = Route.useParams();
  const mediaType = useMediaTypeFilter();
  // isLoading, not isFetching: a background refetch must not unmount the grid
  const { data: album, isLoading, isError } = useFetchPlaceAlbumQuery(albumID ?? "", mediaType);
  // A failed background refetch also sets isError, with the album still on screen
  const notFound = isError && !album;

  return (
    <PhotoListView
      title={album?.title ?? (notFound ? t("places") : t("loading"))}
      loading={isLoading}
      emptyStateConfig={notFound ? albumNotFoundState(t, <Map size={40} />, "/album/places") : undefined}
      icon={<Map size={50} />}
      photoset={album?.grouped_photos ?? []}
      idx2hash={album?.grouped_photos.flatMap(el => el.items) ?? []}
      // No photo filter for an album that is not there
      mediaType={notFound ? undefined : mediaType}
      selectable
    />
  );
}
