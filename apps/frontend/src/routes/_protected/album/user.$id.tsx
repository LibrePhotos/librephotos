import type { DatePhotosGroup, PigPhoto } from "@librephotos/api-client";
import { Text } from "@mantine/core";
import { IconBookmark as Bookmark, IconCloudUpload } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumQuery } from "../../../api_client/albums/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { albumNotFoundState } from "../../../components/album/albumNotFound";
import { emptyAlbumState } from "../../../components/album/emptyAlbumState";
import { LockedAlbumBadge } from "../../../components/album/LockedAlbumBadge";
import { SharedAlbumHeaderMenu } from "../../../components/album/SharedAlbumHeaderMenu";
import { UserAlbumHeaderMenu } from "../../../components/album/UserAlbumHeaderMenu";
import { DEFAULT_MEDIA_TYPE, validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView, type EmptyStateConfig } from "../../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";
import { useAlbumUpload } from "../../../components/upload/useAlbumUpload";
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

  // Known once both the album and who is looking are: an owner never sees "Leave album" first.
  const ownAlbum = album && currentUser ? album.owner.id === currentUser.id : undefined;
  // The owner uploads into the album from its "⋮", its empty state, or by dropping files (#612)
  const upload = useAlbumUpload(album && ownAlbum ? { id: album.id, title: album.title, locked: album.locked } : null);
  let headerActions: React.ReactNode;
  if (album && ownAlbum === true)
    headerActions = <UserAlbumHeaderMenu album={album} upload={upload} photos={flatPhotos} />;
  else if (album && ownAlbum === false) headerActions = <SharedAlbumHeaderMenu album={album} />;

  // Only for an album someone shared with you; it sits on its own line under the photo count.
  function getSubheader(showHeader: boolean) {
    if (showHeader && album) {
      const owner = t("useralbum.ownedby", { name: album.owner.first_name || album.owner.username });
      // A contributor (#464) adds from the timeline's "Add to album".
      const canAdd = album.my_role === "contributor" ? ` · ${t("collab.youCanAdd")}` : "";
      return <Text c="dimmed">{`${owner}${canAdd}`}</Text>;
    }
    return null;
  }

  let emptyStateConfig: EmptyStateConfig | undefined;
  if (notFound) emptyStateConfig = albumNotFoundState(t, <Bookmark size={40} />, "/album/user");
  // A media filter that matches nothing is not an empty album
  else if (ownAlbum && mediaType === DEFAULT_MEDIA_TYPE)
    emptyStateConfig = emptyAlbumState(t, <IconCloudUpload size={40} />, upload);

  return (
    <>
      {upload && <input {...upload.inputProps} data-testid="album-upload-input" />}
      <PhotoListView
        title={album ? album.title : notFound ? t("myalbums") : t("loading")}
        additionalSubHeader={getSubheader(isPublic)}
        loading={isLoading}
        emptyStateConfig={emptyStateConfig}
        icon={Bookmark}
        titleBadge={ownAlbum && album?.locked ? <LockedAlbumBadge /> : undefined}
        // Outside isPublic's read-only header: a recipient gets "Leave album" there too
        headerActions={headerActions}
        photoset={groupedPhotos}
        idx2hash={flatPhotos}
        isPublic={isPublic}
        isAlbumPubliclyShared={album?.public ?? false}
        albumID={albumID}
        ownerUsername={album?.owner.username}
        albumLocked={album?.locked ?? false}
        // A contributor selects to take out the photos they added (#464)
        contributor={album?.my_role === "contributor"}
        // No photo filter for an album that is not there
        mediaType={notFound ? undefined : mediaType}
        selectable
      />
    </>
  );
}
