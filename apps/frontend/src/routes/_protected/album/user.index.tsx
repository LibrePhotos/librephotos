import { Button, Group, Modal, Stack, Text, TextInput, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAlbum as Album } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { AutoSizer, Grid } from "react-virtualized";
import {
  useDeleteUserAlbumMutation,
  useFetchUserAlbumsQuery,
  useRenameUserAlbumMutation,
} from "../../../api_client/albums/hooks";
import { UserAlbumCard } from "../../../components/album/UserAlbumCard";
import { HeaderComponent } from "../../../components/HeaderComponent";
import { ModalAlbumShare } from "../../../components/sharing/ModalAlbumShare";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";

export const Route = createFileRoute("/_protected/album/user/")();

export function AlbumUser() {
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [albumID, setAlbumID] = useState("");
  const [albumOwner, setAlbumOwner] = useState("");
  const [albumTitle, setAlbumTitle] = useState("");
  const [isDeleteDialogOpen, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const [isRenameDialogOpen, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [isShareDialogOpen, { open: showShareDialog, close: hideShareDialog }] = useDisclosure(false);
  const { t } = useTranslation();
  const { data: albums, isFetching } = useFetchUserAlbumsQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(albums ?? []);
  const deleteUserAlbum = useDeleteUserAlbumMutation();
  const renameUserAlbum = useRenameUserAlbumMutation();

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

  function renderCell({ columnIndex, key, rowIndex, style }) {
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
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <HeaderComponent
        icon={<Album size={50} />}
        title={t("myalbums")}
        fetching={isFetching}
        subtitle={t("useralbum.numberof", {
          number: albums?.length ?? 0,
        })}
      />
      <Modal size="mini" onClose={hideRenameDialog} opened={isRenameDialogOpen}>
        <div style={{ padding: 20 }}>
          <Title order={4}>{t("useralbum.renamealbum")}</Title>

          <Group>
            <TextInput
              error={
                albums?.map(el => el.title.toLowerCase().trim()).includes(newAlbumTitle.toLowerCase().trim()) ? (
                  <>
                    {t("useralbum.albumalreadyexists")}, {{ name: newAlbumTitle.trim() }}
                  </>
                ) : (
                  ""
                )
              }
              onChange={v => {
                setNewAlbumTitle(v.currentTarget.value);
              }}
              placeholder={t("useralbum.albumplaceholder")}
            />

            <Button
              color="green"
              onClick={() => {
                renameUserAlbum.mutate({ id: albumID, title: albumTitle, newTitle: newAlbumTitle });
                hideRenameDialog();
              }}
              disabled={albums?.map(el => el.title.toLowerCase().trim()).includes(newAlbumTitle.toLowerCase().trim())}
              type="submit"
            >
              {t("rename")}
            </Button>
          </Group>
        </div>
      </Modal>
      <ModalAlbumShare
        isOpen={isShareDialogOpen}
        onRequestClose={hideShareDialog}
        albumID={albumID}
        ownerUsername={albumOwner}
      />
      <Modal opened={isDeleteDialogOpen} onClose={hideDeleteDialog}>
        <Stack>
          {t("deletealbumexplanation")}
          <Group justify="center">
            <Button color="blue" onClick={hideDeleteDialog}>
              {t("cancel")}
            </Button>
            <Button
              color="red"
              onClick={() => {
                deleteUserAlbum.mutate({ id: albumID, albumTitle });
                hideDeleteDialog();
              }}
            >
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
        {({ width }) => (
          <Grid
            style={{ outline: "none" }}
            disableTitle={false}
            cellRenderer={props => renderCell(props)}
            columnWidth={entrySquareSize}
            columnCount={entriesPerRow}
            height={gridHeight}
            rowHeight={entrySquareSize + 60}
            rowCount={numberOfRows}
            width={width}
          />
        )}
      </AutoSizer>
    </div>
  );
}

Route.update({ component: AlbumUser });
