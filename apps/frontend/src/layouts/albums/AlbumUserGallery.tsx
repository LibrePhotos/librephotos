import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Bookmark } from "tabler-icons-react";

import type { DatePhotosGroup, PigPhoto } from "../../actions/photosActions.types";
import { useLazyFetchUserAlbumQuery } from "../../api_client/albums/user";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { useAppSelector } from "../../store/store";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export function AlbumUserGallery() {
  const [fetchAlbum, { data: album, isFetching }] = useLazyFetchUserAlbumQuery();
  const [flatPhotos, setFlatPhotos] = useState<PigPhoto[]>([]);
  const [groupedPhotos, setGroupedPhotos] = useState<DatePhotosGroup[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const auth = useAppSelector(store => store.auth);
  const { albumID } = useParams();
  const { t } = useTranslation();

  useEffect(() => {
    if (!albumID) {
      return;
    }
    fetchAlbum(albumID);
  }, [albumID, fetchAlbum]);

  useEffect(() => {
    if (!album) {
      return;
    }
    setIsPublic(album.owner && album.owner.id !== auth.access.user_id);
    setGroupedPhotos(album.grouped_photos);
    setFlatPhotos(getPhotosFlatFromGroupedByDate(album.grouped_photos));
  }, [album, auth]);

  function getSubheader(showHeader: boolean) {
    if (showHeader && album) {
      return (
        <span>
          {", "}owned by {album.owner.id === auth.access.user_id ? "you" : album.owner.username}
        </span>
      );
    }
    return <div />;
  }

  return (
    <PhotoListView
      title={album ? album.title : t("loading")}
      additionalSubHeader={getSubheader(isPublic)}
      loading={isFetching}
      icon={<Bookmark size={50} />}
      photoset={groupedPhotos}
      idx2hash={flatPhotos}
      isPublic={isPublic}
      selectable
    />
  );
}
