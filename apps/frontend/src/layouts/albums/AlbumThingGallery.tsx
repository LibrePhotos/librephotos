import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Tags } from "tabler-icons-react";

import { useLazyFetchThingsAlbumQuery } from "../../api_client/albums/things";
import { PhotoListView } from "../../components/photolist/PhotoListView";

export function AlbumThingGallery() {
  const { t } = useTranslation();
  const { albumID } = useParams();
  const [fetchAlbum, { data: groupedPhotos, isLoading: fetchingAlbumsThing }] = useLazyFetchThingsAlbumQuery();

  useEffect(() => {
    if (albumID) {
      fetchAlbum(albumID);
    }
  }, [albumID, fetchAlbum]);

  return (
    <PhotoListView
      title={groupedPhotos ? groupedPhotos.title : t("loading")}
      loading={fetchingAlbumsThing}
      icon={<Tags size={50} />}
      isDateView
      photoset={groupedPhotos ? groupedPhotos.grouped_photos : []}
      idx2hash={groupedPhotos ? groupedPhotos.grouped_photos.flatMap(el => el.items) : []}
      selectable
    />
  );
}
