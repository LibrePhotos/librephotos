import type { AutoAlbumInfo } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconSettingsAutomation as SettingsAutomation, IconTrash as Trash } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DateTime } from "luxon";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteAutoAlbumMutation, useFetchAutoAlbumsQuery } from "../../../api_client/albums/hooks";
import { useGenerateAutoAlbumsMutation } from "../../../api_client/jobs/hooks";
import { eventSortConfig } from "../../../components/album/albumSortConfigs";
import { AlbumSortMenu } from "../../../components/album/AlbumSortMenu";
import { AutoAlbumDeleteModal } from "../../../components/album/AutoAlbumDeleteModal";
import { eventStartDate } from "../../../components/album/eventDate";
import { useAlbumSort } from "../../../components/album/useAlbumSort";
import { CollectionCard } from "../../../components/common/CollectionCard";
import { EmptyState } from "../../../components/common/EmptyState";
import { ErrorState } from "../../../components/common/ErrorState";
import { useListFailure } from "../../../components/common/useListFailure";
import { PageHeader } from "../../../components/PageHeader";
import { TileGrid } from "../../../components/virtual/TileGrid";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";
import { useEventTitle } from "../../../hooks/useEventTitle";

export const Route = createFileRoute("/_protected/album/events/")({
  component: AlbumAuto,
});

// One empty list while loading, so the sorted list is not recomputed on every render
const NO_EVENTS: AutoAlbumInfo[] = [];

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
  const sortConfig = useMemo(() => eventSortConfig(eventTitle), [eventTitle]);
  const eventSort = useAlbumSort(sortConfig, albums ?? NO_EVENTS);

  function deleteAlbum(album: AutoAlbumInfo) {
    setAutoAlbumID(String(album.id));
    setAutoAlbumTitle(eventTitle(album));
    showDeleteDialog();
  }

  function renderCover(album: AutoAlbumInfo, size: number) {
    const start = eventStartDate(album);
    const dateTimeLabel = start.isValid ? start.toLocaleString(DateTime.DATE_MED) : null;
    const count = t("numberofphotos", { count: album.photo_count, number: album.photo_count });
    return (
      <CollectionCard
        size={size}
        title={eventTitle(album)}
        meta={dateTimeLabel ? `${dateTimeLabel} · ${count}` : count}
        covers={[album.photos]}
        renderLink={props => <Link {...props} to="/album/events/$id" params={{ id: String(album.id) }} />}
        menuLabel={t("moreactions")}
        menuItems={
          <Menu.Item leftSection={<Trash size={14} />} onClick={() => deleteAlbum(album)}>
            {t("delete")}
          </Menu.Item>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={t("events")}
        loading={isFetching}
        subtitle={t("autoalbum.subtitle", {
          count: albums?.length ?? 0,
          autoalbumlength: albums?.length ?? 0,
        })}
        actions={hasAlbums ? <AlbumSortMenu {...eventSort.menu} /> : null}
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
          scrollRestorationId="album-events"
          items={eventSort.sorted}
          orderKey={eventSort.orderKey}
          getKey={album => album.id}
          sizing={sizing}
          renderItem={renderCover}
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
