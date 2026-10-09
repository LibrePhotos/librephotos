import { ActionIcon, Button, Flex, Group, Menu, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDotsVertical as DotsVertical,
  IconSettingsAutomation as SettingsAutomation,
  IconTrash as Trash,
} from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteAutoAlbumMutation, useFetchAutoAlbumsQuery } from "../../../api_client/albums/hooks";
import type { AutoAlbumInfo } from "../../../api_client/albums/types";
import { useGenerateAutoAlbumsMutation } from "../../../api_client/jobs/hooks";
import { eventStartDate } from "../../../components/album/eventDate";
import { EmptyState } from "../../../components/common/EmptyState";
import { HeaderComponent } from "../../../components/HeaderComponent";
import { Tile } from "../../../components/Tile";
import { VirtualGrid } from "../../../components/virtual/VirtualGrid";
import type { GridCellProps } from "../../../components/virtual/VirtualGrid";
import { ALBUM_GRID_GUTTER, useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";
import { i18nResolvedLanguage } from "../../../i18n";

export const Route = createFileRoute("/_protected/album/events/")({
  component: AlbumAuto,
});

function AlbumAuto() {
  const [autoAlbumID, setAutoAlbumID] = useState("");
  const [autoAlbumTitle, setAutoAlbumTitle] = useState("");
  const [deleteDialogVisible, { open: showDeleteDialog, close: closeDeleteDialog }] = useDisclosure(false);
  const { data: albums, isFetching } = useFetchAutoAlbumsQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(albums || []);
  const { mutate: deleteAutoAlbum } = useDeleteAutoAlbumMutation();
  const { mutate: generateAutoAlbums } = useGenerateAutoAlbumsMutation();
  const { t } = useTranslation();
  const hasAlbums = albums && albums.length > 0;

  function deleteAlbum(album: AutoAlbumInfo) {
    setAutoAlbumID(String(album.id));
    setAutoAlbumTitle(album.title);
    showDeleteDialog();
  }

  function cellRenderer({ columnIndex, key, rowIndex, style }: GridCellProps) {
    if (!albums || albums.length === 0) {
      return null;
    }
    const index = rowIndex * entriesPerRow + columnIndex;
    if (index >= albums.length) {
      return <div key={key} style={style} />;
    }
    const album = albums[index];
    const start = eventStartDate(album);
    const dateTimeLabel = start.isValid
      ? start.setLocale(i18nResolvedLanguage()).toLocaleString(DateTime.DATE_MED)
      : null;

    return (
      <div key={key} style={style}>
        <div style={{ padding: 5 }}>
          <Link key={album.id} to="/album/events/$id" params={{ id: String(album.id) }}>
            <Tile
              video={album.photos.video === true}
              height={entrySquareSize - 10}
              width={entrySquareSize - 10}
              image_hash={album.photos.image_hash}
            />
          </Link>
          <div style={{ position: "absolute", top: 10, right: 10 }}>
            {/* Focus stays in the delete dialog it opens instead of going back to the trigger */}
            <Menu position="bottom-end" returnFocus={false}>
              <Menu.Target>
                {/* A solid chip: a bare icon vanished on light covers */}
                <ActionIcon variant="default" radius="xl" size="sm" aria-label={t("moreactions")}>
                  <DotsVertical size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<Trash size={14} />} onClick={() => deleteAlbum(album)}>
                  {t("delete")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </div>
        <Group justify="space-between">
          <Flex gap={0} justify="flex-start" direction="column" px={8}>
            <Text size="sm" fw={500} lineClamp={1} title={album.title}>
              {album.title}
            </Text>
            <Text size="xs">
              {dateTimeLabel ? `${dateTimeLabel} - ` : ""}
              {t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
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
          count: albums?.length ?? 0,
          autoalbumlength: albums?.length ?? 0,
        })}
      />

      {!isFetching && !hasAlbums ? (
        <EmptyState
          icon={<SettingsAutomation size={40} />}
          title={t("emptystate.events.title")}
          description={t("emptystate.events.description")}
          actionLabel={t("emptystate.generateEvents")}
          onAction={() => generateAutoAlbums()}
        />
      ) : (
        <VirtualGrid
          style={{ outline: "none", paddingLeft: ALBUM_GRID_GUTTER }}
          cellRenderer={cellRenderer}
          columnWidth={entrySquareSize}
          columnCount={entriesPerRow}
          height={gridHeight}
          rowHeight={entrySquareSize + 60}
          rowCount={numberOfRows}
        />
      )}

      <Modal opened={deleteDialogVisible} title={t("autoalbum.delete")} onClose={closeDeleteDialog}>
        <Stack>
          <Text fw={500}>{autoAlbumTitle}</Text>
          <Text size="sm">{t("autoalbum.deleteexplanation")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDeleteDialog}>
              {t("cancel")}
            </Button>
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
        </Stack>
      </Modal>
    </div>
  );
}
