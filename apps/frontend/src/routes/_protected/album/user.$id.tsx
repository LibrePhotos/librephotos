import { Text } from "@mantine/core";
import { IconBookmark as Bookmark } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumQuery } from "../../../api_client/albums/hooks";
import type { DatePhotosGroup, PigPhoto } from "../../../api_client/photos/types";
import { useCurrentUserSelfDetailsQuery } from "../../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { albumNotFoundState } from "../../../components/album/albumNotFound";
import { validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";

export const Route = createFileRoute("/_protected/album/user/$id")({
  component: AlbumUserGallery,
  validateSearch: validateMediaSearch,
});

function AlbumUserGallery() {
  const [flatPhotos, setFlatPhotos] = useState<PigPhoto[]>([]);
  const [groupedPhotos, setGroupedPhotos] = useState<DatePhotosGroup[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const { id: albumID } = Route.useParams();
  const mediaType = useMediaTypeFilter();

  // isLoading, not isFetching: a refetch (window focus, removing photos) must not
  // unmount the grid and drop the scroll position.
  const { data: album, isLoading, isError } = useFetchUserAlbumQuery(albumID ?? "", { mediaType });
  // A failed background refetch also sets isError, with the album still on screen
  const notFound = isError && !album;
  const { t } = useTranslation();

  useEffect(() => {
    if (!album) {
      return;
    }
    setIsPublic(album.owner && album.owner.id !== currentUser?.id);
    setGroupedPhotos(album.grouped_photos);
    setFlatPhotos(getPhotosFlatFromGroupedByDate(album.grouped_photos));
  }, [album, currentUser]);

  // Only for an album someone shared with you; it sits on its own line under the photo count.
  function getSubheader(showHeader: boolean) {
    if (showHeader && album) {
      return <Text c="dimmed">{t("useralbum.ownedby", { name: album.owner.first_name || album.owner.username })}</Text>;
    }
    return null;
  }

  return (
    <PhotoListView
      title={album ? album.title : notFound ? t("myalbums") : t("loading")}
      additionalSubHeader={getSubheader(isPublic)}
      loading={isLoading}
      emptyStateConfig={notFound ? albumNotFoundState(t, <Bookmark size={40} />, "/album/user") : undefined}
      icon={<Bookmark size={50} />}
      photoset={groupedPhotos}
      idx2hash={flatPhotos}
      isPublic={isPublic}
      isAlbumPubliclyShared={album?.public ?? false}
      albumID={albumID}
      ownerUsername={album?.owner.username}
      // No photo filter for an album that is not there
      mediaType={notFound ? undefined : mediaType}
      selectable
    />
  );
}
