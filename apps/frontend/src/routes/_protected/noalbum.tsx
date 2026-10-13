import { IconAlbumOff as AlbumOff } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotosNotInAlbumQuery } from "../../api_client/photos/hooks/useFetchPhotosNotInAlbumQuery";
import { useListFailure } from "../../components/common/useListFailure";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../../components/photolist/mediaTypeFilter";
import type { EmptyStateConfig } from "../../components/photolist/PhotoListView";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../components/photolist/useMediaTypeFilter";
import { usePagedPhotoList } from "../../components/photolist/usePagedPhotoList";

export const Route = createFileRoute("/_protected/noalbum")({
  component: NotInAlbumPhotosView,
  validateSearch: validateMediaSearch,
  // A new filter starts over at page 1 with a fresh list of placeholders.
  remountDeps: ({ search }) => search.media,
});

// The photos in none of my own albums (#530); albums others share with me do not count.
function NotInAlbumPhotosView() {
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();
  const [page, setPage] = useState(1);
  const photosQuery = useFetchPhotosNotInAlbumQuery(page, mediaType);
  const listFailure = useListFailure(photosQuery);
  const { photosFlat, loadVisiblePage } = usePagedPhotoList(photosQuery, page, setPage);

  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <AlbumOff size={40} />,
      title: t("emptystate.notinalbum.title"),
      description: t("emptystate.notinalbum.description"),
      actionLabel: t("emptystate.notinalbum.action"),
      actionLink: "/album/user",
    }),
    [t]
  );

  return (
    <PhotoListView
      title={t("photos.notinalbum")}
      loading={photosQuery.status === "pending"}
      icon={AlbumOff}
      photoset={photosFlat}
      idx2hash={photosFlat}
      numberOfItems={photosFlat.length}
      updateItems={loadVisiblePage}
      selectable
      emptyStateConfig={mediaType === "all" ? emptyStateConfig : undefined}
      error={listFailure}
      mediaType={mediaType}
      // Select all reaches every photo of the list, not only the loaded pages. The list shows each
      // member of a stack, so select all does too.
      photosetQuery={{ no_album: true, show_all_stack_photos: true, ...mediaTypeToBulkQuery(mediaType) }}
    />
  );
}
