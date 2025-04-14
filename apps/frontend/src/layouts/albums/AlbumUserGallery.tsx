import { IconBookmark as Bookmark } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import type { DatePhotosGroup, PigPhoto } from "../../api_client/photos/types";
import { useFetchUserAlbumQuery } from "../../api_client/albums/hooks";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { useAccessToken } from "../../api_client/auth";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export function AlbumUserGallery() {
  const [flatPhotos, setFlatPhotos] = useState<PigPhoto[]>([]);
  const [groupedPhotos, setGroupedPhotos] = useState<DatePhotosGroup[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const { data: auth } = useAccessToken();
  const { albumID } = useParams();

  const { data: album, isFetching } = useFetchUserAlbumQuery(albumID ?? '');
  const { t } = useTranslation();

  useEffect(() => {
    if (!album) {
      return;
    }
    setIsPublic(album.owner && album.owner.id !== auth?.access?.user_id);
    setGroupedPhotos(album.grouped_photos);
    setFlatPhotos(getPhotosFlatFromGroupedByDate(album.grouped_photos));
  }, [album, auth]);

  function getSubheader(showHeader: boolean) {
    if (showHeader && album) {
      return (
        <span>
          {", "}owned by {album.owner.id === auth?.access?.user_id ? "you" : album.owner.username}
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
