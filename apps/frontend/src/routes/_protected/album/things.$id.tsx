import { createFileRoute } from '@tanstack/react-router'


import { IconTags as Tags } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { useFetchThingsAlbumQuery } from "../../../api_client/albums/hooks";
import { PhotoListView } from "../../../components/photolist/PhotoListView";

export const Route = createFileRoute('/_protected/album/things/$id')({
  component: AlbumThingGallery,
})

export function AlbumThingGallery() {
  const { t } = useTranslation();
  const { id: albumID } = Route.useParams();
  const { data: groupedPhotos, isLoading: fetchingAlbumsThing } = useFetchThingsAlbumQuery(albumID || '');

  return (
    <PhotoListView
      title={groupedPhotos ? groupedPhotos.title : t("loading")}
      loading={fetchingAlbumsThing}
      icon={<Tags size={50} />}
      photoset={groupedPhotos ? groupedPhotos.grouped_photos : []}
      idx2hash={groupedPhotos ? groupedPhotos.grouped_photos.flatMap(el => el.items) : []}
      selectable
    />
  );
}
