import { ActionIcon, Avatar, Button, Flex, Group, Image, Menu, Modal, Stack, Text, TextInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDotsVertical as DotsVertical,
  IconEdit as Edit,
  IconFaceId as FaceId,
  IconTrash as Trash,
  IconUsers as Users,
} from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeletePersonAlbumMutation,
  useFetchPeopleAlbumsQuery,
  useRenamePersonAlbumMutation,
} from "../../../api_client/albums/hooks";
import type { Person } from "../../../api_client/albums/hooks";
import { serverAddress } from "../../../api_client/apiClient";
import { EmptyState } from "../../../components/common/EmptyState";
import { HeaderComponent } from "../../../components/HeaderComponent";
import { Tile } from "../../../components/Tile";
import { VirtualGrid } from "../../../components/virtual/VirtualGrid";
import type { GridCellProps } from "../../../components/virtual/VirtualGrid";
import { ALBUM_GRID_GUTTER, useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";

export const Route = createFileRoute("/_protected/album/persons/")({
  component: AlbumPeople,
});

function AlbumPeople() {
  const navigate = useNavigate();
  const [deleteDialogVisible, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const [renameDialogVisible, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Person>({
    id: "",
    name: "",
    video: false,
    face_count: 0,
    face_photo_url: "",
    face_url: "",
  });
  const [newPersonName, setNewPersonName] = useState("");
  // The ⋮ button the dialogs were opened from. Their menu items are gone when they close,
  // so the Modal's own focus return dropped focus on the page body: it goes back here instead
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const { t } = useTranslation();
  const { data: albums, isFetching } = useFetchPeopleAlbumsQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(albums || []);
  const renamePersonMutation = useRenamePersonAlbumMutation();
  const deletePersonMutation = useDeletePersonAlbumMutation();
  const hasAlbums = albums && albums.length > 0;
  const trimmedPersonName = newPersonName.trim();
  const personNameTaken = !!albums?.some(el => el.name.toLowerCase().trim() === trimmedPersonName.toLowerCase());

  function openDeleteDialog(album: Person) {
    setSelectedAlbum(album);
    showDeleteDialog();
  }

  function openRenameDialog(album: Person) {
    setSelectedAlbum(album);
    setNewPersonName("");
    showRenameDialog();
  }

  function closeRenameDialog() {
    hideRenameDialog();
    menuTrigger.current?.focus();
  }

  function closeDeleteDialog() {
    hideDeleteDialog();
    menuTrigger.current?.focus();
  }

  function getPersonIcon(album: Person) {
    if (album.face_count === 0) {
      return <Image height={entrySquareSize - 10} width={entrySquareSize - 10} src="/unknown_user.jpg" />;
    }
    if (album.name === "unknown") {
      // if (album.text === "unknown") {
      return (
        <Link to="/album/persons/$id" params={{ id: album.id }}>
          <Image height={entrySquareSize - 10} width={entrySquareSize - 10} src="/unknown_user.jpg" />
        </Link>
      );
    }
    return (
      <Link to="/album/persons/$id" params={{ id: album.id }}>
        <Tile
          video={album.video}
          height={entrySquareSize - 10}
          width={entrySquareSize - 10}
          image_hash={album.face_photo_url}
        />
      </Link>
    );
  }

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
          {getPersonIcon(album)}
          <div style={{ position: "absolute", top: 10, right: 10 }}>
            {/* Its items open dialogs: handing focus back to the trigger took it from the
                dialog's input. Escape still returns it, and the dialogs do when they close. */}
            <Menu position="bottom-end" returnFocus={false}>
              <Menu.Target>
                {/* A solid chip: a bare icon vanished on light faces */}
                <ActionIcon
                  variant="default"
                  radius="xl"
                  size="sm"
                  aria-label={t("moreactions")}
                  onClick={e => {
                    menuTrigger.current = e.currentTarget;
                  }}
                >
                  <DotsVertical size={16} />
                </ActionIcon>
              </Menu.Target>

              <Menu.Dropdown>
                <Menu.Item leftSection={<Edit size={14} />} onClick={() => openRenameDialog(album)}>
                  {t("rename")}
                </Menu.Item>
                <Menu.Item leftSection={<Trash size={14} />} onClick={() => openDeleteDialog(album)}>
                  {t("delete")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </div>
        <Group justify="space-between">
          <Flex gap={0} justify="flex-start" direction="column" px={8}>
            <Text size="sm" fw={500} lineClamp={1} title={album.name}>
              {album.name}
            </Text>
            {/* face_count counts faces, not photos */}
            <Text size="xs">
              {t("facesdashboard.numberoffaces", { count: album.face_count, number: album.face_count })}
            </Text>
          </Flex>
        </Group>
      </div>
    );
  }

  return (
    <>
      <Group justify="space-between" align="flex-start" pr="md">
        <HeaderComponent
          icon={<Users size={50} />}
          title={t("people")}
          fetching={isFetching}
          subtitle={t("personalbum.numberofpeople", {
            count: albums?.length ?? 0,
            peoplelength: albums?.length ?? 0,
          })}
        />
        {/* Level with the title row: below the header's 10px padding, the 36px button is about as
            tall as the 35px h2 line. The header centres its icon on title + subtitle, not on this row. */}
        <Button
          mt={10}
          leftSection={<FaceId size={18} />}
          variant="light"
          color="orange"
          onClick={() => navigate({ to: "/faces" })}
        >
          {t("personalbum.managefaces")}
        </Button>
      </Group>
      {!isFetching && !hasAlbums ? (
        <EmptyState
          icon={<Users size={40} />}
          title={t("emptystate.people.title")}
          description={t("emptystate.people.description")}
          actionLabel={t("emptystate.goToFaces")}
          actionLink="/faces"
        />
      ) : (
        <VirtualGrid
          // The gutter the column width leaves room for, as on the other album grids
          style={{ outline: "none", paddingLeft: ALBUM_GRID_GUTTER }}
          cellRenderer={renderCell}
          columnWidth={entrySquareSize}
          columnCount={entriesPerRow}
          height={gridHeight}
          rowHeight={entrySquareSize + 60}
          rowCount={numberOfRows}
        />
      )}

      <Modal
        title={t("personalbum.renamepersonheader", { name: selectedAlbum.name })}
        onClose={closeRenameDialog}
        opened={renameDialogVisible}
        returnFocus={false}
      >
        {/* A form, so Enter renames too */}
        <form
          onSubmit={e => {
            e.preventDefault();
            // The backend rejects a blank name, and nothing would report that
            if (!trimmedPersonName || personNameTaken) return;
            closeRenameDialog();
            renamePersonMutation.mutate({
              id: selectedAlbum.id,
              personName: selectedAlbum.name,
              newPersonName: trimmedPersonName,
            });
          }}
        >
          <Stack>
            <TextInput
              data-autofocus
              label={t("personalbum.nameplaceholder")}
              leftSection={
                <Avatar
                  src={selectedAlbum.face_url ? `${serverAddress}${selectedAlbum.face_url}` : undefined}
                  alt={selectedAlbum.name}
                  radius="xl"
                  size={24}
                />
              }
              error={personNameTaken ? t("personalbum.personalreadyexists", { name: trimmedPersonName }) : false}
              onChange={e => {
                setNewPersonName(e.currentTarget.value);
              }}
              placeholder={selectedAlbum.name}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeRenameDialog}>
                {t("cancel")}
              </Button>
              <Button disabled={!trimmedPersonName || personNameTaken} type="submit">
                {t("rename")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
      <Modal
        opened={deleteDialogVisible}
        title={t("personalbum.deleteperson")}
        onClose={closeDeleteDialog}
        returnFocus={false}
      >
        <Stack>
          <Text size="sm">{t("personalbum.deletepersondescription")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDeleteDialog}>
              {t("cancel")}
            </Button>
            <Button
              color="red"
              onClick={() => {
                deletePersonMutation.mutate(selectedAlbum.id);
                closeDeleteDialog();
              }}
            >
              {t("delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
