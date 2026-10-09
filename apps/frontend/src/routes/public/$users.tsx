import { IconGlobe as Globe } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery, useFetchUserAlbumQuery } from "../../api_client/albums/hooks";
import { Photoset, PigPhoto } from "../../api_client/photos/types";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PigVisibleGroup } from "../../components/react-pig";
import { isUndatedShare } from "../../components/sharing/publicAlbum";
import { usePublicPageTitle } from "../../components/sharing/usePublicPageTitle";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

type PhotoGroup = { id: string; page: number };

export const Route = createFileRoute("/public/$users")({
  component: UserPublicPage,
});

function UserPublicPage() {
  const { t } = useTranslation();
  const { users } = Route.useParams();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();

  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery(
    {
      photosetType: Photoset.PUBLIC,
      username: users,
    }
    // Disable this query when a specific album is requested
  );

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  // No day group asked for yet: the query below stays disabled until one is.
  const [group, setGroup] = useState<PhotoGroup>({ id: "", page: 0 });
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.PUBLIC, username: users },
    { skip: !group.id }
  );

  // If a specific user album is requested via ?album=ID, fetch it and display instead
  const params = new URLSearchParams(window.location.search);
  const albumId = params.get("album") ?? "";
  const { data: userAlbum } = useFetchUserAlbumQuery(albumId, albumId ? { public: true, username: users } : undefined);

  const pageTitle =
    currentUser?.username === users ? t("sidemenu.mypublicphotos") : t("sharing.publicPhotosOf", { name: users });
  usePublicPageTitle(albumId && userAlbum ? userAlbum.title : pageTitle);

  const getAlbums = (visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
    visibleGroups.reverse().forEach(photoGroup => {
      const visibleImages = photoGroup.items;
      if (visibleImages.filter(i => i.isTemp).length > 0) {
        const firstTempObject = visibleImages.filter(i => i.isTemp)[0];
        const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);

        setGroup({ id: photoGroup.id, page });
      }
    });
  };

  // If a specific album is requested and loaded, render it directly
  if (albumId && userAlbum) {
    const albumPhotos = getPhotosFlatFromGroupedByDate(userAlbum.grouped_photos);
    return (
      <PhotoListView
        title={userAlbum.title}
        loading={false}
        icon={<Globe size={50} />}
        // The same array as idx2hash makes a flat grid (see s.$slug.tsx).
        photoset={isUndatedShare(userAlbum.grouped_photos) ? albumPhotos : userAlbum.grouped_photos}
        idx2hash={albumPhotos}
        isPublic={true}
        updateGroups={() => {}}
        selectable
      />
    );
  }

  return (
    <PhotoListView
      title={pageTitle}
      loading={isLoading}
      icon={<Globe size={50} />}
      photoset={photosGroupedByDate ?? []}
      idx2hash={photosFlat}
      isPublic={currentUser?.username !== users}
      updateGroups={getAlbums}
      selectable
    />
  );
}
