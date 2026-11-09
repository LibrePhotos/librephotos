import type { UserAlbumInfo } from "@librephotos/api-client";
import { useDisclosure } from "@mantine/hooks";
import { IconBookmark as Bookmark } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumsQuery, useToggleUserAlbumLockedMutation } from "../../../api_client/albums/hooks";
import { AlbumCollectionFilter } from "../../../components/album/AlbumCollectionFilter";
import { AlbumCollectionsModal } from "../../../components/album/AlbumCollectionsModal";
import { USER_ALBUM_SORT } from "../../../components/album/albumSortConfigs";
import { AlbumSortMenu } from "../../../components/album/AlbumSortMenu";
import { validateCollectionSearch } from "../../../components/album/collectionFilter";
import { ManageAlbumCollectionsModal } from "../../../components/album/ManageAlbumCollectionsModal";
import { MyAlbumsHeaderMenu } from "../../../components/album/MyAlbumsHeaderMenu";
import { NewAlbumButton } from "../../../components/album/NewAlbumButton";
import { useAlbumCollectionFilter } from "../../../components/album/useAlbumCollectionFilter";
import { useAlbumSort } from "../../../components/album/useAlbumSort";
import { UserAlbumCard } from "../../../components/album/UserAlbumCard";
import { DeleteUserAlbumModal, RenameUserAlbumModal } from "../../../components/album/UserAlbumModals";
import { useUserAlbumDialogs } from "../../../components/album/useUserAlbumDialogs";
import { EmptyState } from "../../../components/common/EmptyState";
import { ErrorState } from "../../../components/common/ErrorState";
import { useListFailure } from "../../../components/common/useListFailure";
import { PageHeader } from "../../../components/PageHeader";
import { ModalAlbumShare } from "../../../components/sharing/ModalAlbumShare";
import { TileGrid } from "../../../components/virtual/TileGrid";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";

export const Route = createFileRoute("/_protected/album/user/")({
  component: AlbumUser,
  // The chosen collection (#1009) stays in the URL, so Back from an album returns to it
  validateSearch: validateCollectionSearch,
});

// One empty list while loading, so the sorted list is not recomputed on every render
const NO_ALBUMS: UserAlbumInfo[] = [];

function AlbumUser() {
  const albumDialogs = useUserAlbumDialogs();
  const { album: dialogAlbum } = albumDialogs;
  const [isManageDialogOpen, manageDialog] = useDisclosure(false);
  const { t } = useTranslation();
  const navigate = Route.useNavigate();
  const albumsQuery = useFetchUserAlbumsQuery();
  const { data, isFetching, isLoading } = albumsQuery;
  const albums = data ?? NO_ALBUMS;
  const titles = albums.map(album => album.title);
  const listFailure = useListFailure(albumsQuery);
  const sizing = useAlbumListGridConfig();
  const hasAlbums = albums.length > 0;
  const toggleUserAlbumLocked = useToggleUserAlbumLockedMutation();
  // Sorted before the collection filter, which keeps the order (#620)
  const albumSort = useAlbumSort(USER_ALBUM_SORT, albums);
  const { collections, filter, collection, shown, counts } = useAlbumCollectionFilter(
    albumSort.sorted,
    Route.useSearch().collection
  );

  const subtitle = () => {
    if (filter === undefined) return t("useralbum.numberof", { count: albums.length, number: albums.length });
    if (collection) return t("albumcollections.numberin", { count: shown.length, name: collection.name });
    return t("albumcollections.numbernotin", { count: shown.length });
  };

  return (
    <div>
      <PageHeader
        title={t("myalbums")}
        loading={isFetching}
        subtitle={subtitle()}
        // With a collection chosen, the new album goes into it (#612)
        actions={
          <>
            {hasAlbums ? <AlbumSortMenu {...albumSort.menu} /> : null}
            <NewAlbumButton existingTitles={titles} collection={collection} />
            {hasAlbums ? (
              <MyAlbumsHeaderMenu hasCollections={collections.length > 0} onManage={manageDialog.open} />
            ) : null}
          </>
        }
      />
      {hasAlbums && (
        <AlbumCollectionFilter
          collections={collections}
          counts={counts}
          value={filter}
          onChange={next => void navigate({ search: next === undefined ? {} : { collection: next } })}
        />
      )}
      <AlbumCollectionsModal
        opened={albumDialogs.collections.opened}
        onClose={albumDialogs.collections.close}
        albumId={dialogAlbum.id}
        albumTitle={dialogAlbum.title}
        collectionIds={albums.find(album => `${album.id}` === dialogAlbum.id)?.collection_ids ?? []}
      />
      <ManageAlbumCollectionsModal
        opened={isManageDialogOpen}
        onClose={manageDialog.close}
        counts={counts.byCollection}
      />
      <RenameUserAlbumModal
        opened={albumDialogs.rename.opened}
        onClose={albumDialogs.rename.close}
        albumId={dialogAlbum.id}
        albumTitle={dialogAlbum.title}
        existingTitles={titles}
      />
      <ModalAlbumShare
        isOpen={albumDialogs.share.opened}
        onRequestClose={albumDialogs.share.close}
        albumID={dialogAlbum.id}
      />
      <DeleteUserAlbumModal
        opened={albumDialogs.remove.opened}
        onClose={albumDialogs.remove.close}
        albumId={dialogAlbum.id}
        albumTitle={dialogAlbum.title}
      />
      {listFailure ? (
        <ErrorState failure={listFailure} />
      ) : !isLoading && !hasAlbums ? (
        <EmptyState
          icon={<Bookmark size={40} />}
          title={t("emptystate.useralbums.title")}
          description={t("emptystate.useralbums.description")}
          actionLabel={t("emptystate.useralbums.action")}
          actionLink="/"
          secondaryActionLabel={t("sidemenu.sharedwithyou")}
          secondaryActionLink="/sharing/withme/albums"
        />
      ) : hasAlbums && shown.length === 0 ? (
        <EmptyState
          icon={<Bookmark size={40} />}
          title={t("albumcollections.emptytitle")}
          description={t("albumcollections.emptydescription")}
        />
      ) : (
        <TileGrid
          scrollRestorationId="album-user"
          items={shown}
          orderKey={albumSort.orderKey}
          getKey={album => album.id}
          sizing={sizing}
          // The card draws its own caption, inside the padded cell
          renderItem={(album, size) => (
            <UserAlbumCard
              album={album}
              size={size}
              showActions
              onRename={albumDialogs.rename.open}
              onShare={albumDialogs.share.open}
              onCollections={albumDialogs.collections.open}
              onDelete={albumDialogs.remove.open}
              onToggleLocked={(id, locked) => toggleUserAlbumLocked.mutate({ id, locked })}
            />
          )}
        />
      )}
    </div>
  );
}
