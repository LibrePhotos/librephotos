import { IconMap as Map } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPlaceAlbumQuery } from "../../../api_client/albums/hooks";
import { PhotoListView } from "../../../components/photolist/PhotoListView";

export const Route = createFileRoute("/_protected/album/places/$id")();

export function AlbumPlaceGallery() {
  const { t } = useTranslation();
  const { id: albumID } = Route.useParams();
  const { data: album, isFetching } = useFetchPlaceAlbumQuery(albumID ?? "");

  return (
    <PhotoListView
      title={album?.title ?? t("loading")}
      loading={isFetching}
      icon={<Map size={50} />}
      photoset={album?.grouped_photos ?? []}
      idx2hash={album?.grouped_photos.flatMap(el => el.items) ?? []}
      selectable
    />
  );
}

Route.update({ component: AlbumPlaceGallery });
