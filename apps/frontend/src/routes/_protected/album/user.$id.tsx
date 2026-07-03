import { IconBookmark as Bookmark } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumQuery } from "../../../api_client/albums/hooks";
import type { DatePhotosGroup, PigPhoto } from "../../../api_client/photos/types";
import { useCurrentUserSelfDetailsQuery } from "../../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";

export const Route = createFileRoute("/_protected/album/user/$id")({
  validateSearch: validateMediaSearch,
});

export function AlbumUserGallery() {
  const [flatPhotos, setFlatPhotos] = useState<PigPhoto[]>([]);
  const [groupedPhotos, setGroupedPhotos] = useState<DatePhotosGroup[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const { id: albumID } = Route.useParams();
  const mediaType = useMediaTypeFilter();

  const { data: album, isFetching } = useFetchUserAlbumQuery(albumID ?? "", { mediaType });
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
      isAlbumPubliclyShared={album?.public ?? false}
      albumID={albumID}
      ownerUsername={album?.owner.username}
      mediaType={mediaType}
      selectable
    />
  );
}

Route.update({ component: AlbumUserGallery });
