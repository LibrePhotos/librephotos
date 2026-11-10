import { IconBookmark as Bookmark, IconCloudUpload } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumQuery } from "../../../api_client/albums/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { albumNotFoundState } from "../../../components/album/albumNotFound";
import { EditableAlbumTitle } from "../../../components/album/EditableAlbumTitle";
import { emptyAlbumState } from "../../../components/album/emptyAlbumState";
import { LockedAlbumBadge } from "../../../components/album/LockedAlbumBadge";
import { SharedAlbumHeaderMenu } from "../../../components/album/SharedAlbumHeaderMenu";
import { UserAlbumHeaderMenu } from "../../../components/album/UserAlbumHeaderMenu";
import { UserAlbumIdentity } from "../../../components/album/UserAlbumIdentity";
import { DEFAULT_MEDIA_TYPE, validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView, type EmptyStateConfig } from "../../../components/photolist/PhotoListView";
import { useGroupedPhotos } from "../../../components/photolist/useGroupedPhotos";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";
import { useAlbumUpload } from "../../../components/upload/useAlbumUpload";
import { formatPhotoDaySpan } from "../../../util/dateUtils";

export const Route = createFileRoute("/_protected/album/user/$id")({
  component: AlbumUserGallery,
  validateSearch: validateMediaSearch,
});

function AlbumUserGallery() {
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const { id: albumID } = Route.useParams();
  const mediaType = useMediaTypeFilter();

  // isLoading, not isFetching: a refetch (window focus, removing photos) must not
  // unmount the grid and drop the scroll position.
  const { data: album, isLoading, isError } = useFetchUserAlbumQuery(albumID ?? "", { mediaType });
  // A failed background refetch also sets isError, with the album still on screen
  const notFound = isError && !album;
  const { t } = useTranslation();

  const { groups: groupedPhotos, photosFlat: flatPhotos } = useGroupedPhotos(album?.grouped_photos);

  // Known once both the album and who is looking are: an owner never sees "Leave album" first.
  const ownAlbum = album && currentUser ? album.owner.id === currentUser.id : undefined;
  // Read-only only once it is known to be someone else's: until then the list waits for the user.
  const isPublic = ownAlbum === false;
  // The owner uploads into the album from its "⋮", its empty state, or by dropping files (#612)
  const upload = useAlbumUpload(album && ownAlbum ? { id: album.id, title: album.title, locked: album.locked } : null);
  let headerMenu: React.ReactNode;
  if (album && ownAlbum === true)
    headerMenu = <UserAlbumHeaderMenu album={album} upload={upload} photos={flatPhotos} />;
  else if (album && ownAlbum === false) headerMenu = <SharedAlbumHeaderMenu album={album} />;

  // Under the title: its people (the owner's for a recipient, the recipients' for the owner), then
  // the owner's Share and Add photos. The meta line says the days its photos span (not `location`,
  // one photo's full address) and their count.
  const subHeader =
    album && ownAlbum !== undefined ? <UserAlbumIdentity album={album} own={ownAlbum} upload={upload} /> : null;

  // A stable object: the list is memoised
  const albumKey = album ? `${album.id}` : "";
  const albumTitle = album?.title ?? "";
  const collection = useMemo(
    () => ({
      dateSpan: formatPhotoDaySpan(groupedPhotos.map(group => group.date)),
      // The owner renames the album by clicking its title
      title: albumKey && ownAlbum ? <EditableAlbumTitle albumId={albumKey} title={albumTitle} /> : undefined,
    }),
    [groupedPhotos, albumKey, albumTitle, ownAlbum]
  );

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
        additionalSubHeader={subHeader}
        collection={collection}
        loading={isLoading}
        emptyStateConfig={emptyStateConfig}
        titleBadge={ownAlbum && album?.locked ? <LockedAlbumBadge /> : undefined}
        // Outside isPublic's read-only header: a recipient gets "Leave album" there too
        headerMenu={headerMenu}
        photoset={groupedPhotos}
        idx2hash={flatPhotos}
        isPublic={isPublic}
        albumID={albumID}
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
