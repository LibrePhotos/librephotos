import { Photoset } from "@librephotos/api-client";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery, usePublicAlbumQuery } from "../../api_client/albums/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { validatePhotoSearch } from "../../components/photolist/photoSearch";
import { useGroupedPhotos } from "../../components/photolist/useGroupedPhotos";
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

  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery(
    {
      photosetType: Photoset.PUBLIC,
      username: users,
    }
    // Disable this query when a specific album is requested
  );

  const { groups, photosFlat } = useGroupedPhotos(photosGroupedByDate);

  // Pig reports the day groups on screen; their placeholders name the pages still to load.
  const getAlbums = useDateAlbumDayPages({ photosetType: Photoset.PUBLIC, username: users });

  // ?album= names one of the user's public albums by its link slug: show it instead. The
  // album's id alone opens nothing for a visitor.
  const params = new URLSearchParams(window.location.search);
  const albumSlug = params.get("album") ?? "";
  const { data: publicAlbum } = usePublicAlbumQuery(albumSlug);
  const userAlbum = publicAlbum && publicAlbum.owner.username === users ? publicAlbum : undefined;

  const pageTitle =
    currentUser?.username === users ? t("sidemenu.mypublicphotos") : t("sharing.publicPhotosOf", { name: users });
  usePublicPageTitle(albumSlug && userAlbum ? userAlbum.title : pageTitle);

  // If a specific album is requested and loaded, render it directly
  if (albumSlug && userAlbum) {
    const albumPhotos = getPhotosFlatFromGroupedByDate(userAlbum.grouped_photos);
    return (
      <PhotoListView
        title={userAlbum.title}
        loading={false}
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
      photoset={groups}
      idx2hash={photosFlat}
      isPublic={currentUser?.username !== users}
      updateGroups={getAlbums}
      selectable
    />
  );
}
