import { ActionIcon, Avatar, Button, Flex, Group, Image, Menu, Modal, Text, TextInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDotsVertical as DotsVertical,
  IconEdit as Edit,
  IconFaceId as FaceId,
  IconTrash as Trash,
  IconUsers as Users,
} from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { AutoSizer, Grid } from "react-virtualized";
import {
  useDeletePersonAlbumMutation,
  useFetchPeopleAlbumsQuery,
  useRenamePersonAlbumMutation,
} from "../../../api_client/albums/hooks";
import type { Person } from "../../../api_client/albums/hooks";
import { EmptyState } from "../../../components/common/EmptyState";
import { HeaderComponent } from "../../../components/HeaderComponent";
import { Tile } from "../../../components/Tile";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";

export const Route = createFileRoute("/_protected/album/persons/")();

export function AlbumPeople() {
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
  const { t } = useTranslation();
  const { data: albums, isFetching } = useFetchPeopleAlbumsQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(albums || []);
  const renamePersonMutation = useRenamePersonAlbumMutation();
  const deletePersonMutation = useDeletePersonAlbumMutation();
  const hasAlbums = albums && albums.length > 0;

  function openDeleteDialog(album: Person) {
    setSelectedAlbum(album);
    showDeleteDialog();
  }

  function openRenameDialog(album: Person) {
    setSelectedAlbum(album);
    setNewPersonName("");
    showRenameDialog();
  }

  function getPersonIcon(album: Person) {
    if (album.face_count === 0) {
      return <Image height={entrySquareSize - 10} width={entrySquareSize - 10} src="/unknown_user.jpg" />;
    }
    if (album.name === "unknown") {
      // if (album.text === "unknown") {
      return (
        <Link to={`/album/persons/${album.id}`} pathParams={{ id: album.id }}>
          <Image height={entrySquareSize - 10} width={entrySquareSize - 10} src="/unknown_user.jpg" />
        </Link>
      );
    }
    return (
      <Link to={`/album/persons/${album.id}`} pathParams={{ id: album.id }}>
        <Tile
          video={album.video}
          height={entrySquareSize - 10}
          width={entrySquareSize - 10}
          image_hash={album.face_photo_url}
        />
      </Link>
    );
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
        <div style={{ padding: 5 }}>
          {getPersonIcon(album)}
          <div style={{ position: "absolute", top: 10, right: 10 }}>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray">
                  <DotsVertical />
                </ActionIcon>
              </Menu.Target>

              <Menu.Dropdown>
                <Menu.Item leftSection={<Edit />} onClick={() => openRenameDialog(album)}>
                  {t("rename")}
                </Menu.Item>
                <Menu.Item leftSection={<Trash />} onClick={() => openDeleteDialog(album)}>
                  {t("delete")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </div>
        <Group justify="apart">
          <Flex gap={0} justify="left" direction="column" px={8}>
            <Text size="sm" fw={500} lineClamp={1} title={album.name}>
              {album.name}
            </Text>
            <Text size="xs">{t("numberofphotos", { number: album.face_count })}</Text>
          </Flex>
        </Group>
      </div>
    );
  }

  return (
    <>
      <Group justify="space-between" align="center" pr="md">
        <HeaderComponent
          icon={<Users size={50} />}
          title={t("people")}
          fetching={isFetching}
          subtitle={t("personalbum.numberofpeople", {
            peoplelength: (albums && albums.length) || 0,
          })}
        />
        <Button
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
        <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
          {({ width }) => (
            <Grid
              style={{ outline: "none" }}
              headerHeight={100}
              disableHeader={false}
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
      )}

      <Modal
        title={t("personalbum.renamepersonheader", { name: selectedAlbum.name })}
        onClose={hideRenameDialog}
        opened={renameDialogVisible}
      >
        <Group>
          {selectedAlbum && <Avatar src={selectedAlbum.face_url} alt={selectedAlbum.name} radius="xl" />}
          <TextInput
            error={
              albums && albums.map(el => el.name.toLowerCase().trim()).includes(newPersonName.toLowerCase().trim())
                ? t("personalbum.personalreadyexists", {
                    name: newPersonName.trim(),
                  })
                : false
            }
            onChange={e => {
              setNewPersonName(e.currentTarget.value);
            }}
            placeholder={selectedAlbum.name}
          />
          <Button
            onClick={() => {
              hideRenameDialog();
              renamePersonMutation.mutate({
                id: selectedAlbum.id,
                personName: selectedAlbum.name,
                newPersonName,
              });
            }}
            disabled={
              albums && albums.map(el => el.name.toLowerCase().trim()).includes(newPersonName.toLowerCase().trim())
            }
            type="submit"
          >
            {t("rename")}
          </Button>
        </Group>
      </Modal>
      <Modal opened={deleteDialogVisible} title={t("personalbum.deleteperson")} onClose={hideDeleteDialog}>
        <Text size="sm">{t("personalbum.deletepersondescription")}</Text>
        <Group>
          <Button onClick={hideDeleteDialog}>{t("cancel")}</Button>
          <Button
            color="red"
            onClick={() => {
              deletePersonMutation.mutate(selectedAlbum.id);
              hideDeleteDialog();
            }}
          >
            {t("delete")}
          </Button>
        </Group>
      </Modal>
    </>
  );
}

Route.update({ component: AlbumPeople });
