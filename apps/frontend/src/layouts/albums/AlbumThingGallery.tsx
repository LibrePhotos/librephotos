import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Tags } from "tabler-icons-react";

import { fetchThingAlbum } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function AlbumThingGallery() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { albumID } = useParams();

  const albumsThing = useAppSelector(store => store.albums.albumsThing);
  const fetchingAlbumsThing = useAppSelector(store => store.albums.fetchingAlbumsThing);

  const groupedPhotos = albumID ? albumsThing[albumID] : undefined;

  useEffect(() => {
    if (albumID) {
      dispatch(fetchThingAlbum(albumID));
    }
  }, [albumID, dispatch]);
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
