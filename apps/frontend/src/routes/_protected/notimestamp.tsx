import type { BulkPhotoQuery, PigPhoto } from "@librephotos/api-client";
import { IconCalendarOff as CalendarOff } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotosWithoutTimestampQuery } from "../../api_client/photos/hooks/useFetchPhotosWithoutTimestampQuery";
import { useListFailure } from "../../components/common/useListFailure";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../../components/photolist/mediaTypeFilter";
import type { EmptyStateConfig } from "../../components/photolist/PhotoListView";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../components/photolist/useMediaTypeFilter";
import { addTempElementsToFlatList } from "../../util/util";

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
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  // Fetch actual photos
  const photosQuery = useFetchPhotosWithoutTimestampQuery(page, mediaType);
  const { data: photosData, isPlaceholderData, status } = photosQuery;
  const listFailure = useListFailure(photosQuery);

  useEffect(() => {
    // While the next page loads, the query keeps showing the previous page's photos as placeholder
    // data. Splicing those in at the new page's offset would duplicate them over its placeholders.
    if (!photosData || isPlaceholderData) {
      return;
    }
    setPhotosFlat(previous => {
      // The first page tells us the total, so it lays out a placeholder for every photo
      const photos = page === 1 ? addTempElementsToFlatList(photosData.count) : [...previous];
      // a page has 100 photos, so splice the results into their slots
      photos.splice((page - 1) * 100, 100, ...photosData.results);
      return photos;
    });
  }, [photosData, isPlaceholderData, page]);

  const getImages = (visibleItems: PigPhoto[]) => {
    const firstTempObject = visibleItems.find(i => i.isTemp);
    if (firstTempObject) {
      // Extract the numeric part from temp IDs like "temp-0", "temp-1", etc.
      const tempIndex = parseInt(firstTempObject.id.replace("temp-", ""), 10);
      const pageNumber = Math.ceil((tempIndex + 1) / 100);
      if (pageNumber > 1) {
        setPage(pageNumber);
      }
    }
  };

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
      loading={status === "pending"}
      icon={CalendarOff}
      photoset={photosFlat}
      idx2hash={photosFlat}
      numberOfItems={photosFlat?.length}
      updateItems={getImages}
      selectable
      photosetQuery={{ ...NO_TIMESTAMP_QUERY, ...mediaTypeToBulkQuery(mediaType) }}
      emptyStateConfig={mediaType === "all" ? emptyStateConfig : undefined}
      error={listFailure}
      mediaType={mediaType}
    />
  );
}
