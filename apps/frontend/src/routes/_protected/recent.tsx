import { IconClock as Clock } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchRecentlyAddedPhotosQuery } from "../../api_client/photos/hooks/useFetchRecentlyAddedPhotosQuery";
import { EmptyStateConfig, PhotoListView } from "../../components/photolist/PhotoListView";

export const Route = createFileRoute("/_protected/recent")();

export function RecentlyAddedPhotos() {
  const { t } = useTranslation();
  const { data, status } = useFetchRecentlyAddedPhotosQuery();
  const photosFlat = data?.results || [];
  const recentlyAddedPhotosDate = data?.results?.[0]?.date;

  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <Clock size={40} />,
      title: t("emptystate.recent.title"),
      description: t("emptystate.recent.description"),
      actionLabel: t("emptystate.goToLibrary"),
      actionLink: "/library",
    }),
    [t]
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

Route.update({ component: RecentlyAddedPhotos });
