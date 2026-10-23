import type { PigPhoto } from "@librephotos/api-client";
import { Photoset } from "@librephotos/api-client";
import { IconGlobe as Globe } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery, usePublicAlbumQuery } from "../../api_client/albums/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import type { PhotoGroup } from "../../components/photolist/photoGroup";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PigVisibleGroup } from "../../components/photolist/PhotoListView";
import { validatePhotoSearch } from "../../components/photolist/photoSearch";
import { isUndatedShare } from "../../components/sharing/publicAlbum";
import { usePublicPageTitle } from "../../components/sharing/usePublicPageTitle";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export const Route = createFileRoute("/public/$users")({
  component: UserPublicPage,
  // ?photo= is the photo open in the lightbox; ?album= (read below) passes through untouched.
  validateSearch: validatePhotoSearch,
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
  const [group, setGroup] = useState<PhotoGroup>({ id: 0, page: 0 });
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.PUBLIC, username: users },
    { skip: !group.id }
  );

  // ?album= names one of the user's public albums by its link slug: show it instead. The
  // album's id alone opens nothing for a visitor.
  const params = new URLSearchParams(window.location.search);
  const albumSlug = params.get("album") ?? "";
  const { data: publicAlbum } = usePublicAlbumQuery(albumSlug);
  const userAlbum = publicAlbum && publicAlbum.owner.username === users ? publicAlbum : undefined;

  const pageTitle =
    currentUser?.username === users ? t("sidemenu.mypublicphotos") : t("sharing.publicPhotosOf", { name: users });
  usePublicPageTitle(albumSlug && userAlbum ? userAlbum.title : pageTitle);

  const getAlbums = (visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
    visibleGroups.reverse().forEach(photoGroup => {
      const visibleImages = photoGroup.items;
      const firstTempObject = visibleImages.find(i => i.isTemp);
      if (firstTempObject) {
        const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);

        setGroup({ id: photoGroup.id, page });
      }
    });
  };

  // If a specific album is requested and loaded, render it directly
  if (albumSlug && userAlbum) {
    const albumPhotos = getPhotosFlatFromGroupedByDate(userAlbum.grouped_photos);
    return (
      <PhotoListView
        title={userAlbum.title}
        loading={false}
        icon={Globe}
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
      icon={Globe}
      photoset={photosGroupedByDate ?? []}
      idx2hash={photosFlat}
      isPublic={currentUser?.username !== users}
      updateGroups={getAlbums}
      selectable
    />
  );
}
