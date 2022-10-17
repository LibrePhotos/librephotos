import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Map } from "tabler-icons-react";

import { fetchPlaceAlbum } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function AlbumPlaceGallery() {
  const { t } = useTranslation();
  const { albumID } = useParams();
  const dispatch = useAppDispatch();

  const albumsPlace = useAppSelector(store => store.albums.albumsPlace);
  const fetchingAlbumsPlace = useAppSelector(store => store.albums.fetchingAlbumsPlace);

  const groupedPhotos = albumID ? albumsPlace[albumID] : undefined;

  useEffect(() => {
    if (albumID) {
      dispatch(fetchPlaceAlbum(albumID));
    }
  }, [albumID, dispatch]);

  return (
    <PhotoListView
      title={groupedPhotos ? groupedPhotos.title : t("loading")}
      loading={fetchingAlbumsPlace}
      icon={<Map size={50} />}
      isDateView
      photoset={groupedPhotos ? groupedPhotos.grouped_photos : []}
      idx2hash={groupedPhotos ? groupedPhotos.grouped_photos.flatMap(el => el.items) : []}
      selectable
    />
  );
}
