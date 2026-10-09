import { IconClock as Clock } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchRecentlyAddedPhotosQuery } from "../../api_client/photos/hooks/useFetchRecentlyAddedPhotosQuery";
import { EmptyStateConfig, PhotoListView } from "../../components/photolist/PhotoListView";
import { useScanEmptyStateAction } from "../../components/photolist/useScanEmptyStateAction";

export const Route = createFileRoute("/_protected/recent")({
  component: RecentlyAddedPhotos,
});

function RecentlyAddedPhotos() {
  const { t } = useTranslation();
  const { data, status } = useFetchRecentlyAddedPhotosQuery();
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
      icon={<Clock size={50} />}
      date={recentlyAddedPhotosDate}
      photoset={photosFlat}
      idx2hash={photosFlat}
      dayHeaderPrefix={t("photos.addedon")}
      selectable
      emptyStateConfig={emptyStateConfig}
    />
  );
}
