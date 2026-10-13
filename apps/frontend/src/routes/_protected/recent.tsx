import { IconClock as Clock } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchRecentlyAddedPhotosQuery } from "../../api_client/photos/hooks/useFetchRecentlyAddedPhotosQuery";
import { useListFailure } from "../../components/common/useListFailure";
import { validateMediaSearch } from "../../components/photolist/mediaTypeFilter";
import type { EmptyStateConfig } from "../../components/photolist/PhotoListView";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../components/photolist/useMediaTypeFilter";
import { useScanEmptyStateAction } from "../../components/photolist/useScanEmptyStateAction";

export const Route = createFileRoute("/_protected/recent")({
  component: RecentlyAddedPhotos,
  validateSearch: validateMediaSearch,
});

function RecentlyAddedPhotos() {
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();
  // The whole day comes in one answer, so select-all on the list is complete.
  const recentQuery = useFetchRecentlyAddedPhotosQuery(mediaType);
  const { data, status } = recentQuery;
  const listFailure = useListFailure(recentQuery);
  const photosFlat = data?.results || [];
  // The day the newest import happened (the backend's added_on), not the first
  // photo's capture date; null while the user has no photos.
  const recentlyAddedPhotosDate = data?.date ?? undefined;

  const emptyAction = useScanEmptyStateAction(t("emptystate.recent.description"));
  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <Clock size={40} />,
      title: t("emptystate.recent.title"),
      ...emptyAction,
    }),
    [t, emptyAction]
  );

  return (
    <PhotoListView
      title={t("photos.recentlyadded")}
      loading={status === "pending"}
      icon={Clock}
      date={recentlyAddedPhotosDate}
      photoset={photosFlat}
      idx2hash={photosFlat}
      dayHeaderPrefix={t("photos.addedon")}
      selectable
      emptyStateConfig={mediaType === "all" ? emptyStateConfig : undefined}
      error={listFailure}
      mediaType={mediaType}
    />
  );
}
