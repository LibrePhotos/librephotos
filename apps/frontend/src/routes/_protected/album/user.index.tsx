import { useDisclosure } from "@mantine/hooks";
import { IconBookmark as Bookmark } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumsQuery, useToggleUserAlbumLockedMutation } from "../../../api_client/albums/hooks";
import { AlbumCollectionFilter } from "../../../components/album/AlbumCollectionFilter";
import { AlbumCollectionsModal } from "../../../components/album/AlbumCollectionsModal";
import { validateCollectionSearch } from "../../../components/album/collectionFilter";
import { ManageAlbumCollectionsModal } from "../../../components/album/ManageAlbumCollectionsModal";
import { NewAlbumButton } from "../../../components/album/NewAlbumButton";
import { useAlbumCollectionFilter } from "../../../components/album/useAlbumCollectionFilter";
import { UserAlbumCard } from "../../../components/album/UserAlbumCard";
import { DeleteUserAlbumModal, RenameUserAlbumModal } from "../../../components/album/UserAlbumModals";
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

function AlbumUser() {
  const [albumID, setAlbumID] = useState("");
  const [albumOwner, setAlbumOwner] = useState("");
  const [albumTitle, setAlbumTitle] = useState("");
  const [isDeleteDialogOpen, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const [isRenameDialogOpen, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [isShareDialogOpen, { open: showShareDialog, close: hideShareDialog }] = useDisclosure(false);
  const [isCollectionsDialogOpen, collectionsDialog] = useDisclosure(false);
  const [isManageDialogOpen, manageDialog] = useDisclosure(false);
  const { t } = useTranslation();
  const navigate = Route.useNavigate();
  const albumsQuery = useFetchUserAlbumsQuery();
  const { data, isFetching, isLoading } = albumsQuery;
  const albums = data ?? [];
  const titles = albums.map(album => album.title);
  const listFailure = useListFailure(albumsQuery);
  const sizing = useAlbumListGridConfig();
  const hasAlbums = albums.length > 0;
  const toggleUserAlbumLocked = useToggleUserAlbumLockedMutation();
  const { collections, filter, collection, shown, counts } = useAlbumCollectionFilter(
    albums,
    Route.useSearch().collection
  );

  const openDeleteDialog = (id: string, title: string) => {
    showDeleteDialog();
    setAlbumID(id);
    setAlbumTitle(title);
  };

  const openRenameDialog = (id: string, title: string) => {
    showRenameDialog();
    setAlbumID(id);
    setAlbumTitle(title);
  };

  const openShareDialog = (id: string, title: string) => {
    showShareDialog();
    setAlbumID(id);
    setAlbumTitle(title);
    const album = albums.find(a => `${a.id}` === id);
    if (album) setAlbumOwner(album.owner.username);
  };

  const openCollectionsDialog = (id: string, title: string) => {
    collectionsDialog.open();
    setAlbumID(id);
    setAlbumTitle(title);
  };

  const subtitle = () => {
    if (filter === undefined) return t("useralbum.numberof", { count: albums.length, number: albums.length });
    if (collection) return t("albumcollections.numberin", { count: shown.length, name: collection.name });
    return t("albumcollections.numbernotin", { count: shown.length });
  };

  return (
    <div>
      <PageHeader
        icon={Bookmark}
        title={t("myalbums")}
        loading={isFetching}
        subtitle={subtitle()}
        // With a collection chosen, the new album goes into it (#612)
        actions={<NewAlbumButton existingTitles={titles} collection={collection} />}
      />
      {hasAlbums && (
        <AlbumCollectionFilter
          collections={collections}
          counts={counts}
          value={filter}
          onChange={next => void navigate({ search: next === undefined ? {} : { collection: next } })}
          onManage={manageDialog.open}
        />
      )}
      <AlbumCollectionsModal
        opened={isCollectionsDialogOpen}
        onClose={collectionsDialog.close}
        albumId={albumID}
        albumTitle={albumTitle}
        collectionIds={albums.find(album => `${album.id}` === albumID)?.collection_ids ?? []}
      />
      <ManageAlbumCollectionsModal
        opened={isManageDialogOpen}
        onClose={manageDialog.close}
        counts={counts.byCollection}
      />
      <RenameUserAlbumModal
        opened={isRenameDialogOpen}
        onClose={hideRenameDialog}
        albumId={albumID}
        albumTitle={albumTitle}
        existingTitles={titles}
      />
      <ModalAlbumShare
        isOpen={isShareDialogOpen}
        onRequestClose={hideShareDialog}
        albumID={albumID}
        ownerUsername={albumOwner}
      />
      <DeleteUserAlbumModal
        opened={isDeleteDialogOpen}
        onClose={hideDeleteDialog}
        albumId={albumID}
        albumTitle={albumTitle}
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
          items={shown}
          getKey={album => album.id}
          sizing={sizing}
          // The card draws its own caption, inside the padded cell
          renderItem={(album, size) => (
            <UserAlbumCard
              album={album}
              size={size}
              showActions
              onRename={openRenameDialog}
              onShare={openShareDialog}
              onCollections={openCollectionsDialog}
              onDelete={openDeleteDialog}
              onToggleLocked={(id, locked) => toggleUserAlbumLocked.mutate({ id, locked })}
            />
          )}
        />
      )}
    </div>
  );
}
