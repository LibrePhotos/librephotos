import { createFileRoute } from '@tanstack/react-router'

import { IconBookmark as Bookmark } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { DatePhotosGroup, PigPhoto } from "../../../api_client/photos/types";
import { useFetchUserAlbumQuery } from "../../../api_client/albums/hooks";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { useCurrentUserSelfDetailsQuery } from "../../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";

export const Route = createFileRoute('/_protected/album/user/$id')({
  component: AlbumUserGallery,
})

export function AlbumUserGallery() {
  const [flatPhotos, setFlatPhotos] = useState<PigPhoto[]>([]);
  const [groupedPhotos, setGroupedPhotos] = useState<DatePhotosGroup[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const { id: albumID } = Route.useParams();

  const { data: album, isFetching } = useFetchUserAlbumQuery(albumID ?? '');
  const { t } = useTranslation();

  useEffect(() => {
    if (!album) {
      return;
    }
    setIsPublic(album.owner && album.owner.id !== currentUser?.id);
    setGroupedPhotos(album.grouped_photos);
    setFlatPhotos(getPhotosFlatFromGroupedByDate(album.grouped_photos));
  }, [album, currentUser]);

  function getSubheader(showHeader: boolean) {
    if (showHeader && album) {
      return (
        <span>
          {", "}owned by {album.owner.id === currentUser?.id ? "you" : album.owner.username}
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
      albumID={albumID}
      ownerUsername={album?.owner.username}
      selectable
    />
  );
}
