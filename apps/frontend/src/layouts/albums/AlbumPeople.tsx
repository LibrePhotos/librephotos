import { ActionIcon, Button, Group, Image, Menu, Modal, Text, TextInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AutoSizer, Grid } from "react-virtualized";
import { DotsVertical, Edit, Trash, Users } from "tabler-icons-react";

import { deletePerson, renamePerson } from "../../actions/peopleActions";
import { useFetchPeopleAlbumsQuery } from "../../api_client/albums/people";
import { Tile } from "../../components/Tile";
import { useAlbumListGridConfig } from "../../hooks/useAlbumListGridConfig";
import { useAppDispatch } from "../../store/store";
import { HeaderComponent } from "./HeaderComponent";

export function AlbumPeople() {
  const [deleteDialogVisible, { open: showDeleteDialog, close: hideDeleteDialog }] = useDisclosure(false);
  const [renameDialogVisible, { open: showRenameDialog, close: hideRenameDialog }] = useDisclosure(false);
  const [personID, setPersonID] = useState("");
  const [personName, setPersonName] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { data: albums, isFetching } = useFetchPeopleAlbumsQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(albums || []);

  const openDeleteDialog = (id: string, name: string) => {
    showDeleteDialog();
    setPersonID(id);
    setPersonName(name);
  };

  const openRenameDialog = (id: string, name: string) => {
    showRenameDialog();
    setPersonID(id);
    setPersonName(name);
  };

  function getPersonIcon(album) {
    if (album.face_count === 0) {
      return <Image height={entrySquareSize - 10} width={entrySquareSize - 10} src="/unknown_user.jpg" />;
    }
    if (album.text === "unknown") {
      return (
        <Link to={`/person/${album.key}`}>
          <Image height={entrySquareSize - 10} width={entrySquareSize - 10} src="/unknown_user.jpg" />
        </Link>
      );
    }
    return (
      <Link to={`/person/${album.key}`}>
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
                <Menu.Item icon={<Edit />} onClick={() => openRenameDialog(album.key, album.text)}>
                  {t("rename")}
                </Menu.Item>
                <Menu.Item icon={<Trash />} onClick={() => openDeleteDialog(album.key, album.text)}>
                  {t("delete")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </div>
        <div style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}>
          <Group position="apart">
            <div>
              <b>{album.text}</b> <br />
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
      <Modal title={t("personalbum.renameperson")} onClose={hideRenameDialog} opened={renameDialogVisible}>
        <Group>
          <TextInput
            error={
              albums && albums.map(el => el.text.toLowerCase().trim()).includes(newPersonName.toLowerCase().trim())
                ? t("personalbum.personalreadyexists", {
                    name: newPersonName.trim(),
                  })
                : false
            }
            onChange={e => {
              setNewPersonName(e.currentTarget.value);
            }}
            placeholder={t("personalbum.nameplaceholder")}
          />
          <Button
            onClick={() => {
              dispatch(renamePerson(personID, personName, newPersonName));
              hideRenameDialog();
            }}
            disabled={
              albums && albums.map(el => el.text.toLowerCase().trim()).includes(newPersonName.toLowerCase().trim())
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
              dispatch(deletePerson(personID));
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
