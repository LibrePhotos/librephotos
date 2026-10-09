import { useDisclosure } from "@mantine/hooks";
import { IconBookmark as Bookmark } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumsQuery, useToggleUserAlbumLockedMutation } from "../../../api_client/albums/hooks";
import { UserAlbumCard } from "../../../components/album/UserAlbumCard";
import { DeleteUserAlbumModal, RenameUserAlbumModal } from "../../../components/album/UserAlbumModals";
import { EmptyState } from "../../../components/common/EmptyState";
import { HeaderComponent } from "../../../components/HeaderComponent";
import { ModalAlbumShare } from "../../../components/sharing/ModalAlbumShare";
import { VirtualGrid } from "../../../components/virtual/VirtualGrid";
import type { GridCellProps } from "../../../components/virtual/VirtualGrid";
import { ALBUM_GRID_GUTTER, useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";

export const Route = createFileRoute("/_protected/album/user/")({
  component: AlbumUser,
});

function AlbumUser() {
  const [albumID, setAlbumID] = useState("");
  const [albumOwner, setAlbumOwner] = useState("");
  const [albumTitle, setAlbumTitle] = useState("");
  const [isDeleteDialogOpen, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const [isRenameDialogOpen, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [isShareDialogOpen, { open: showShareDialog, close: hideShareDialog }] = useDisclosure(false);
  const { t } = useTranslation();
  const { data: albums, isFetching, isLoading } = useFetchUserAlbumsQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(albums ?? []);
  const hasAlbums = (albums?.length ?? 0) > 0;
  const toggleUserAlbumLocked = useToggleUserAlbumLockedMutation();

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
    const album = albums?.find(a => `${a.id}` === id);
    if (album) setAlbumOwner(album.owner.username);
  };

  function renderCell({ columnIndex, key, rowIndex, style }: GridCellProps) {
    if (!albums || albums.length === 0) {
      return null;
    }
    const index = rowIndex * entriesPerRow + columnIndex;
    if (index >= albums.length) {
      return <div key={key} style={style} />;
    }
    const album = albums[index];
    return (
      <div key={key} style={style}>
        <div style={{ padding: 5 }}>
          <UserAlbumCard
            album={album}
            size={entrySquareSize - 10}
            showActions
            onRename={openRenameDialog}
            onShare={openShareDialog}
            onDelete={openDeleteDialog}
            onToggleLocked={(id, locked) => toggleUserAlbumLocked.mutate({ id, locked })}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <HeaderComponent
        icon={<Bookmark size={50} />}
        title={t("myalbums")}
        fetching={isFetching}
        subtitle={t("useralbum.numberof", {
          count: albums?.length ?? 0,
          number: albums?.length ?? 0,
        })}
      />
      <RenameUserAlbumModal
        opened={isRenameDialogOpen}
        onClose={hideRenameDialog}
        albumId={albumID}
        albumTitle={albumTitle}
        existingTitles={albums?.map(album => album.title) ?? []}
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
      {!isLoading && !hasAlbums ? (
        <EmptyState
          icon={<Bookmark size={40} />}
          title={t("emptystate.useralbums.title")}
          description={t("emptystate.useralbums.description")}
          actionLabel={t("emptystate.useralbums.action")}
          actionLink="/"
          secondaryActionLabel={t("sidemenu.sharedwithyou")}
          secondaryActionLink="/sharing/withme/albums"
        />
      ) : (
        <VirtualGrid
          style={{ outline: "none", paddingLeft: ALBUM_GRID_GUTTER }}
          cellRenderer={renderCell}
          columnWidth={entrySquareSize}
          columnCount={entriesPerRow}
          height={gridHeight}
          rowHeight={entrySquareSize + 60}
          rowCount={numberOfRows}
        />
      )}
    </div>
  );
}
