import { IconCalendarOff as CalendarOff } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotosWithoutTimestampQuery } from "../../api_client/photos/hooks/useFetchPhotosWithoutTimestampQuery";
import { PigPhoto } from "../../api_client/photos/types";
import { EmptyStateConfig, PhotoListView } from "../../components/photolist/PhotoListView";
import { addTempElementsToFlatList } from "../../util/util";

export const Route = createFileRoute("/_protected/notimestamp")({
  component: NoTimestampPhotosView,
});

function NoTimestampPhotosView() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  // Fetch actual photos
  const { data: photosData, isPlaceholderData, status } = useFetchPhotosWithoutTimestampQuery(page);

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

  const getImages = (visibleItems: any) => {
    if (visibleItems.filter((i: any) => i.isTemp).length > 0) {
      const firstTempObject = visibleItems.filter((i: any) => i.isTemp)[0];
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
      icon={<CalendarOff size={50} />}
      photoset={photosFlat}
      idx2hash={photosFlat}
      numberOfItems={photosFlat?.length}
      updateItems={getImages}
      selectable
      emptyStateConfig={emptyStateConfig}
    />
  );
}
