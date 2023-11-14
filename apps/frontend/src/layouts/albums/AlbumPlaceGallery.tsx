import React from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Map } from "tabler-icons-react";

import { useFetchPlaceAlbumQuery } from "../../api_client/albums/places";
import { PhotoListView } from "../../components/photolist/PhotoListView";

export function AlbumPlaceGallery() {
  const { t } = useTranslation();
  const { albumID } = useParams();
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
