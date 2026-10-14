import type { AutoAlbumInfo } from "@librephotos/api-client";
import { ActionIcon, Flex, Group, Menu, Text } from "@mantine/core";
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
import { useGenerateAutoAlbumsMutation } from "../../../api_client/jobs/hooks";
import gridClasses from "../../../components/album/AlbumGridCell.module.css";
import { AutoAlbumDeleteModal } from "../../../components/album/AutoAlbumDeleteModal";
import { eventStartDate } from "../../../components/album/eventDate";
import { EmptyState } from "../../../components/common/EmptyState";
import { ErrorState } from "../../../components/common/ErrorState";
import { useListFailure } from "../../../components/common/useListFailure";
import { PageHeader } from "../../../components/PageHeader";
import { Tile } from "../../../components/Tile";
import { TileGrid } from "../../../components/virtual/TileGrid";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";
import { useEventTitle } from "../../../hooks/useEventTitle";

export const Route = createFileRoute("/_protected/album/events/")({
  component: AlbumAuto,
});

function AlbumAuto() {
  const [autoAlbumID, setAutoAlbumID] = useState("");
  const [autoAlbumTitle, setAutoAlbumTitle] = useState("");
  const [deleteDialogVisible, { open: showDeleteDialog, close: closeDeleteDialog }] = useDisclosure(false);
  const albumsQuery = useFetchAutoAlbumsQuery();
  const { data: albums, isFetching } = albumsQuery;
  const listFailure = useListFailure(albumsQuery);
  const sizing = useAlbumListGridConfig();
  const { mutate: deleteAutoAlbum } = useDeleteAutoAlbumMutation();
  const { mutate: generateAutoAlbums } = useGenerateAutoAlbumsMutation();
  const { t } = useTranslation();
  const eventTitle = useEventTitle();
  const hasAlbums = albums && albums.length > 0;

  function deleteAlbum(album: AutoAlbumInfo) {
    setAutoAlbumID(String(album.id));
    setAutoAlbumTitle(eventTitle(album));
    showDeleteDialog();
  }

  function renderCover(album: AutoAlbumInfo, size: number) {
    return (
      <>
        <Link key={album.id} to="/album/events/$id" params={{ id: String(album.id) }} aria-label={album.title}>
          <Tile
            className={gridClasses.cover}
            video={album.photos.video === true}
            height={size}
            width={size}
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
      </>
    );
  }

  function renderCaption(album: AutoAlbumInfo) {
    const start = eventStartDate(album);
    const dateTimeLabel = start.isValid ? start.toLocaleString(DateTime.DATE_MED) : null;
    const title = eventTitle(album);
    return (
      <Group justify="space-between">
        <Flex gap={0} justify="flex-start" direction="column" px={8}>
          <Text size="sm" fw={500} lineClamp={1} title={title}>
            {title}
          </Text>
          <Text size="xs">
            {dateTimeLabel ? `${dateTimeLabel} - ` : ""}
            {t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
          </Text>
        </Flex>
      </Group>
    );
  }

  return (
    <div>
      <PageHeader
        icon={SettingsAutomation}
        title={t("events")}
        loading={isFetching}
        subtitle={t("autoalbum.subtitle", {
          count: albums?.length ?? 0,
          autoalbumlength: albums?.length ?? 0,
        })}
      />

      {listFailure ? (
        <ErrorState failure={listFailure} />
      ) : !isFetching && !hasAlbums ? (
        <EmptyState
          icon={<SettingsAutomation size={40} />}
          title={t("emptystate.events.title")}
          description={t("emptystate.events.description")}
          actionLabel={t("emptystate.generateEvents")}
          onAction={() => generateAutoAlbums()}
        />
      ) : (
        <TileGrid
          items={albums ?? []}
          getKey={album => album.id}
          sizing={sizing}
          renderItem={renderCover}
          renderCaption={renderCaption}
        />
      )}

      <AutoAlbumDeleteModal
        opened={deleteDialogVisible}
        onClose={closeDeleteDialog}
        title={autoAlbumTitle}
        onConfirm={() => {
          deleteAutoAlbum({ id: autoAlbumID, albumTitle: autoAlbumTitle });
        }}
      />
    </div>
  );
}
