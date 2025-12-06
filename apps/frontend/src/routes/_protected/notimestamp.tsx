import { IconCalendarOff as CalendarOff } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotosWithoutTimestampQuery } from "../../api_client/photos/hooks/useFetchPhotosWithoutTimestampQuery";
import { PigPhoto } from "../../api_client/photos/types";
import { EmptyStateConfig, PhotoListView } from "../../components/photolist/PhotoListView";
import { addTempElementsToFlatList } from "../../util/util";

export const Route = createFileRoute("/_protected/notimestamp")();

export function NoTimestampPhotosView() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  // Fetch actual photos
  const { data: photosData, status } = useFetchPhotosWithoutTimestampQuery(page);

  useEffect(() => {
    if (photosData) {
      let tempPhotos: PigPhoto[];

      // If we have a count but no results yet, add temp elements
      if (page === 1) {
        tempPhotos = addTempElementsToFlatList(photosData.count);
      } else {
        tempPhotos = [...photosFlat];
      }
      // If we have results, update the flat list
      if (photosData.results) {
        // a page has 100 photos, so we need to splice the results into the photosFlat
        const index = (page - 1) * 100;
        tempPhotos.splice(index, 100, ...photosData.results);
        setPhotosFlat(tempPhotos);
      }
    }
  }, [photosData]);

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

Route.update({ component: NoTimestampPhotosView });
