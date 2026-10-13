import type { BulkPhotoQuery } from "@librephotos/api-client";
import { IconCalendarOff as CalendarOff } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotosWithoutTimestampQuery } from "../../api_client/photos/hooks/useFetchPhotosWithoutTimestampQuery";
import { useListFailure } from "../../components/common/useListFailure";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../../components/photolist/mediaTypeFilter";
import type { EmptyStateConfig } from "../../components/photolist/PhotoListView";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../components/photolist/useMediaTypeFilter";
import { usePagedPhotoList } from "../../components/photolist/usePagedPhotoList";

// The page loads 100 photos at a time, so select all names the whole set for the server.
// The list shows stacked photos too, not only each stack's primary photo.
const NO_TIMESTAMP_QUERY: BulkPhotoQuery = { no_timestamp: true, show_all_stack_photos: true };

export const Route = createFileRoute("/_protected/notimestamp")({
  component: NoTimestampPhotosView,
  validateSearch: validateMediaSearch,
  // A new filter starts over at page 1 with a fresh list of placeholders.
  remountDeps: ({ search }) => search.media,
});

function NoTimestampPhotosView() {
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();
  const [page, setPage] = useState(1);
  const photosQuery = useFetchPhotosWithoutTimestampQuery(page, mediaType);
  const listFailure = useListFailure(photosQuery);
  const { photosFlat, loadVisiblePage } = usePagedPhotoList(photosQuery, page, setPage);

  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <CalendarOff size={40} />,
      title: t("emptystate.notimestamp.title"),
      description: t("emptystate.notimestamp.description"),
    }),
    [t]
  );

  return (
    <PhotoListView
      title={t("photos.notimestamp")}
      loading={photosQuery.status === "pending"}
      icon={CalendarOff}
      photoset={photosFlat}
      idx2hash={photosFlat}
      numberOfItems={photosFlat.length}
      updateItems={loadVisiblePage}
      selectable
      photosetQuery={{ ...NO_TIMESTAMP_QUERY, ...mediaTypeToBulkQuery(mediaType) }}
      emptyStateConfig={mediaType === "all" ? emptyStateConfig : undefined}
      error={listFailure}
      mediaType={mediaType}
    />
  );
}
