import { Flex, Text } from "@mantine/core";
import { IconFolder as Folder } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAllFolderSubfolders } from "../../../api_client/albums/hooks";
import { FOLDER_SORT } from "../../../components/album/albumSortConfigs";
import { AlbumSortMenu } from "../../../components/album/AlbumSortMenu";
import { FolderCoverTile } from "../../../components/album/FolderCoverTile";
import { useAlbumSort } from "../../../components/album/useAlbumSort";
import { EmptyState } from "../../../components/common/EmptyState";
import { ErrorState } from "../../../components/common/ErrorState";
import { useListFailure } from "../../../components/common/useListFailure";
import { PageHeader } from "../../../components/PageHeader";
import { TileGrid } from "../../../components/virtual/TileGrid";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";

export const Route = createFileRoute("/_protected/album/folder/")({
  component: AlbumFolder,
});

function AlbumFolder() {
  const { t } = useTranslation();
  const { subfolders, isLoading, isFetching, query } = useAllFolderSubfolders();
  const listFailure = useListFailure(query);
  const sizing = useAlbumListGridConfig();
  const folderSort = useAlbumSort(FOLDER_SORT, subfolders);

  return (
    <div>
      <PageHeader
        icon={Folder}
        title={t("folders")}
        loading={isFetching}
        subtitle={t("folders_count", { count: subfolders.length })}
        actions={subfolders.length > 0 ? <AlbumSortMenu {...folderSort.menu} /> : null}
      />

      {/* Outside the grid: with no folders it renders no cells to put a message in */}
      {listFailure ? (
        <ErrorState failure={listFailure} />
      ) : !isLoading && subfolders.length === 0 ? (
        <EmptyState
          icon={<Folder size={40} />}
          title={t("emptystate.folders.title")}
          description={t("emptystate.folders.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      ) : (
        <TileGrid
          scrollRestorationId="album-folder"
          items={folderSort.sorted}
          orderKey={folderSort.orderKey}
          getKey={subfolder => subfolder.path}
          sizing={sizing}
          renderItem={(subfolder, size) => (
            <Link
              to="/album/folder/$id"
              params={{ id: encodeURIComponent(subfolder.path) }}
              aria-label={subfolder.name}
            >
              <FolderCoverTile folder={subfolder} size={size} />
            </Link>
          )}
          renderCaption={subfolder => (
            <Flex gap={0} justify="flex-start" direction="column" px={8}>
              <Text size="sm" fw={500} lineClamp={1} title={subfolder.path}>
                {subfolder.name}
              </Text>
              <Text size="xs">
                {t("numberofphotos", { count: subfolder.photo_count, number: subfolder.photo_count })}
              </Text>
            </Flex>
          )}
        />
      )}
    </div>
  );
}
