import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Bookmark } from "tabler-icons-react";

import { fetchUserAlbum } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function AlbumUserGallery() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const { albumID, ...params } = useParams();

  const photosGroupedByDate = useAppSelector(store => store.photos.photosGroupedByDate);
  const photosFlat = useAppSelector(store => store.photos.photosFlat);
  const fetchedPhotosetType = useAppSelector(store => store.photos.fetchedPhotosetType);
  const albumDetails = useAppSelector(store => store.albums.albumDetails);
  const auth = useAppSelector(store => store.auth);

  const isLoaded = () => {
    return fetchedPhotosetType === PhotosetType.USER_ALBUM && albumDetails.id === albumID && params;
  };

  useEffect(() => {
    if (!isLoaded()) {
      //@ts-ignore
      dispatch(fetchUserAlbum(albumID));
    }
  }, [albumID, dispatch, fetchedPhotosetType, albumDetails]);

  const isPublic = albumDetails.owner && albumDetails.owner.id !== auth.access.user_id;
  let additionalSubHeader = <div></div>;
  if (isPublic) {
    additionalSubHeader = (
      <span>
        {", "}owned by {albumDetails.owner.id === auth.access.user_id ? "you" : albumDetails.owner.username}
      </span>
    );
  }
  return (
    <PhotoListView
      title={albumDetails ? albumDetails.title : t("loading")}
      additionalSubHeader={additionalSubHeader}
      loading={!isLoaded()}
      icon={<Bookmark size={50} />}
      isDateView
      photoset={photosGroupedByDate}
      idx2hash={photosFlat}
      isPublic={isPublic}
      selectable
    />
  );
}
