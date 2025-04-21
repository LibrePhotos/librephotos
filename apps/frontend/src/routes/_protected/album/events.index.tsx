import { createFileRoute } from '@tanstack/react-router'

import { ActionIcon, Button, Flex, Group, Menu, Modal, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDotsVertical as DotsVertical,
  IconSettingsAutomation as SettingsAutomation,
  IconTrash as Trash,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { AutoSizer, Grid } from "react-virtualized";

import { useDeleteAutoAlbumMutation, useFetchAutoAlbumsQuery } from "../../../api_client/albums/hooks";
import { Tile } from "../../../components/Tile";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";
import { i18nResolvedLanguage } from "../../../i18n";
import { HeaderComponent } from "../../../components/HeaderComponent"; 

export const Route = createFileRoute('/_protected/album/events/')({
  component: AlbumAuto,
})


export function AlbumAuto() {
  const [autoAlbumID, setAutoAlbumID] = useState("");
  const [autoAlbumTitle, setAutoAlbumTitle] = useState("");
  const [deleteDialogVisible, { open: showDeleteDialog, close: closeDeleteDialog }] = useDisclosure(false);
  const { data: albums, isFetching } = useFetchAutoAlbumsQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(albums || []);
  const { mutate: deleteAutoAlbum } = useDeleteAutoAlbumMutation();
  const { t } = useTranslation();

  function deleteAlbum(album) {
    setAutoAlbumID(album.id);
    setAutoAlbumTitle(album.title);
    showDeleteDialog();
  }

  function cellRenderer({ columnIndex, key, rowIndex, style }) {
    if (!albums || albums.length === 0) {
      return null;
    }
    const index = rowIndex * entriesPerRow + columnIndex;
    if (index >= albums.length) {
      return <div key={key} style={style} />;
    }
    const album = albums[index];
    const dateTimeLabel = DateTime.fromISO(album.timestamp).isValid
      ? DateTime.fromISO(album.timestamp).setLocale(i18nResolvedLanguage()).toLocaleString(DateTime.DATE_MED)
      : null;

    return (
      <div key={key} style={style}>
        <div style={{ padding: 5 }}>
          <Link key={album.id} to={`/album/events/${album.id}/`}>
            <Tile
              video={album.photos.video === true}
              height={entrySquareSize - 10}
              width={entrySquareSize - 10}
              image_hash={album.photos.image_hash}
            />
          </Link>
          <div style={{ position: "absolute", top: 10, right: 10 }}>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray">
                  <DotsVertical />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<Trash />} onClick={() => deleteAlbum(album)}>
                  {t("delete")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </div>
        <Group justify="apart">
          <Flex gap={0} justify="left" direction="column" px={8}>
            <Text size="sm" fw={500} lineClamp={1} title={album.title}>
              {album.title}
            </Text>
            <Text size="xs">
              {dateTimeLabel ? `${dateTimeLabel} - ` : ""}
              {t("numberofphotos", { number: album.photo_count })}
            </Text>
          </Flex>
        </Group>
      </div>
    );
  }

  return (
    <div>
      <HeaderComponent
        icon={<SettingsAutomation size={50} />}
        title={t("events")}
        fetching={isFetching}
        subtitle={t("autoalbum.subtitle", {
          autoalbumlength: (albums && albums.length) || 0,
        })}
      />

      <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
        {({ width: containerWidth }) => (
          <Grid
            style={{ outline: "none" }}
            disableHeader={false}
            cellRenderer={props => cellRenderer(props)}
            columnWidth={entrySquareSize}
            columnCount={entriesPerRow}
            height={gridHeight}
            rowHeight={entrySquareSize + 60}
            rowCount={numberOfRows}
            width={containerWidth}
          />
        )}
      </AutoSizer>

      <Modal opened={deleteDialogVisible} title={t("autoalbum.delete")} onClose={closeDeleteDialog}>
        <Text size="lg">{autoAlbumTitle}</Text>
        <Text size="sm">{t("autoalbum.deleteexplanation")}</Text>
        <Group>
          <Button onClick={closeDeleteDialog}>{t("cancel")}</Button>
          <Button
            color="red"
            onClick={() => {
              deleteAutoAlbum({ id: autoAlbumID, albumTitle: autoAlbumTitle });
              closeDeleteDialog();
            }}
          >
            {t("delete")}
          </Button>
        </Group>
      </Modal>
    </div>
  );
}
