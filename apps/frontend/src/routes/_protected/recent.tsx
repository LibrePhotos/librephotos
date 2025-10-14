import { IconClock as Clock } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchRecentlyAddedPhotosQuery } from "../../api_client/photos/hooks/useFetchRecentlyAddedPhotosQuery";
import { PhotoListView } from "../../components/photolist/PhotoListView";

export const Route = createFileRoute("/_protected/recent")();

export function RecentlyAddedPhotos() {
  const { t } = useTranslation();
  const { data, status } = useFetchRecentlyAddedPhotosQuery();
  const photosFlat = data?.results || [];
  const recentlyAddedPhotosDate = data?.results[0].date;

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
    />
  );
}

Route.update({ component: RecentlyAddedPhotos });
