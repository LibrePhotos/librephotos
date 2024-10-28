import { ActionIcon, Avatar, Button, Group, Image, Menu, Modal, Text, TextInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDotsVertical as DotsVertical,
  IconEdit as Edit,
  IconTrash as Trash,
  IconUsers as Users,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AutoSizer, Grid } from "react-virtualized";

import {
  Person,
  useDeletePersonAlbumMutation,
  useFetchPeopleAlbumsQuery,
  useRenamePersonAlbumMutation,
} from "../../api_client/albums/people";
import { Tile } from "../../components/Tile";
import { useAlbumListGridConfig } from "../../hooks/useAlbumListGridConfig";
import { HeaderComponent } from "./HeaderComponent";

export function AlbumPeople() {
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
  const [renamePerson] = useRenamePersonAlbumMutation();
  const [deletePerson] = useDeletePersonAlbumMutation();

  function openDeleteDialog(album: Person) {
    setSelectedAlbum(album);
    showDeleteDialog();
  }

  function openRenameDialog(album: Person) {
    setSelectedAlbum(album);
    setNewPersonName("");
    showRenameDialog();
  }

  function getPersonIcon(album) {
    if (album.face_count === 0) {
      return <Image height={entrySquareSize - 10} width={entrySquareSize - 10} src="/unknown_user.jpg" />;
    }
    if (album.text === "unknown") {
      return (
        <Link to={`/person/${album.id}`}>
          <Image height={entrySquareSize - 10} width={entrySquareSize - 10} src="/unknown_user.jpg" />
        </Link>
      );
    }
    return (
      <Link to={`/person/${album.id}`}>
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
                <ActionIcon>
                  <DotsVertical />
                </ActionIcon>
              </Menu.Target>

              <Menu.Dropdown>
                <Menu.Item icon={<Edit />} onClick={() => openRenameDialog(album)}>
                  {t("rename")}
                </Menu.Item>
                <Menu.Item icon={<Trash />} onClick={() => openDeleteDialog(album)}>
                  {t("delete")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </div>
        <div style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}>
          <Group position="apart">
            <div>
              <b>{album.name}</b> <br />
              {t("numberofphotos", {
                number: album.face_count,
              })}
            </div>
          </Group>
        </div>
      </div>
    );
  }

  return (
    <div>
      <HeaderComponent
        icon={<Users size={50} />}
        title={t("people")}
        fetching={isFetching}
        subtitle={t("personalbum.numberofpeople", {
          peoplelength: (albums && albums.length) || 0,
        })}
      />
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
              renamePerson({
                id: selectedAlbum.id,
                personName: selectedAlbum.name,
                newPersonName: newPersonName,
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
              deletePerson(selectedAlbum.id);
              hideDeleteDialog();
            }}
          >
            {t("delete")}
          </Button>
        </Group>
      </Modal>

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
    </div>
  );
}
