import { ActionIcon, Button, Group, Menu, Modal, Popover, Stack, Text, TextInput, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAlbum as Album,
  IconDotsVertical as DotsVertical,
  IconEdit as Edit,
  IconShare as Share,
  IconTrash as Trash,
  IconUser as User,
  IconUsers as Users,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AutoSizer, Grid } from "react-virtualized";

import { UserAlbumInfo } from "../../actions/albumActions.types";
import {
  useDeleteUserAlbumMutation,
  useFetchUserAlbumsQuery,
  useRenameUserAlbumMutation,
} from "../../api_client/albums/user";
import { Tile } from "../../components/Tile";
import { ModalAlbumShare } from "../../components/sharing/ModalAlbumShare";
import { useAlbumListGridConfig } from "../../hooks/useAlbumListGridConfig";
import { HeaderComponent } from "./HeaderComponent";

function SharedWith({ album }: Readonly<{ album: UserAlbumInfo }>) {
  const [opened, { toggle, close }] = useDisclosure(false);
  // To-Do: Figure out, why album is an array / json <- is it still the case?
  return (
    <Popover opened={opened} position="bottom" width={260} onClose={close}>
      <Popover.Target>
        <Users size={20} onClick={toggle} />
      </Popover.Target>
      <Popover.Dropdown>
        <Stack>
          <Title order={5}>Shared with:</Title>
          {album.shared_to.map(el => (
            <Group key={el.username}>
              <User />
              <b>{el.username}</b>
            </Group>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

export function AlbumUser() {
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [albumID, setAlbumID] = useState("");
  const [albumTitle, setAlbumTitle] = useState("");
  const [isDeleteDialogOpen, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const [isRenameDialogOpen, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [isShareDialogOpen, { open: showShareDialog, close: hideShareDialog }] = useDisclosure(false);
  const { t } = useTranslation();
  const { data: albums, isFetching } = useFetchUserAlbumsQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(albums ?? []);
  const [deleteUserAlbum] = useDeleteUserAlbumMutation();
  const [renameUserAlbum] = useRenameUserAlbumMutation();

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
  };

  function isShared(album: UserAlbumInfo) {
    return album.shared_to.length > 0;
  }

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
        <div style={{ padding: 5, height: entrySquareSize, width: entrySquareSize }}>
          <Link to={`/useralbum/${album.id}`}>
            <Tile
              video={albums[index].cover_photo.video === true}
              height={entrySquareSize - 10}
              width={entrySquareSize - 10}
              image_hash={albums[index].cover_photo.image_hash}
            />
          </Link>

          <div style={{ position: "absolute", top: 10, right: 10 }}>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon>
                  <DotsVertical />
                </ActionIcon>
              </Menu.Target>

              <Menu.Dropdown>
                <Menu.Item icon={<Edit />} onClick={() => openRenameDialog(`${album.id}`, album.title)}>
                  {t("rename")}
                </Menu.Item>
                <Menu.Item icon={<Share />} onClick={() => openShareDialog(`${album.id}`, album.title)}>
                  {t("sidemenu.sharing")}
                </Menu.Item>
                <Menu.Item icon={<Trash />} onClick={() => openDeleteDialog(`${album.id}`, album.title)}>
                  {t("delete")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </div>
        <div className="personCardName" style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}>
          <Group>
            {isShared(album) && <SharedWith album={album} />}
            <Text weight="bold" lineClamp={1}>
              {album.title}
            </Text>
          </Group>
          {t("numberofphotos", {
            number: album.photo_count,
          })}
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
                renameUserAlbum({ id: albumID, title: albumTitle, newTitle: newAlbumTitle });
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
      <ModalAlbumShare isOpen={isShareDialogOpen} onRequestClose={hideShareDialog} albumID={albumID} />
      <Modal opened={isDeleteDialogOpen} onClose={hideDeleteDialog}>
        <Stack>
          {t("deletealbumexplanation")}
          <Group position="center">
            <Button color="blue" onClick={hideDeleteDialog}>
              {t("cancel")}
            </Button>
            <Button
              color="red"
              onClick={() => {
                deleteUserAlbum({ id: albumID, albumTitle });
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
