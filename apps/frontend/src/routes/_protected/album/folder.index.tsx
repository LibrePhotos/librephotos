import { Flex, Text } from "@mantine/core";
import { IconFolder as Folder } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAllFolderSubfolders } from "../../../api_client/albums/hooks";
import { EmptyState } from "../../../components/common/EmptyState";
import { ErrorState } from "../../../components/common/ErrorState";
import { useListFailure } from "../../../components/common/useListFailure";
import { PageHeader } from "../../../components/PageHeader";
import { TileGrid } from "../../../components/virtual/TileGrid";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";
import classes from "./folder.module.css";

export const Route = createFileRoute("/_protected/album/folder/")({
  component: AlbumFolder,
});

function AlbumFolder() {
  const { t } = useTranslation();
  const { subfolders, isLoading, isFetching, query } = useAllFolderSubfolders();
  const listFailure = useListFailure(query);
  const sizing = useAlbumListGridConfig();

  return (
    <div>
      <PageHeader
        icon={Folder}
        title={t("folders")}
        loading={isFetching}
        subtitle={t("folders_count", { count: subfolders.length })}
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
          items={subfolders}
          getKey={subfolder => subfolder.path}
          sizing={sizing}
          renderItem={(subfolder, size) => (
            <Link to="/album/folder/$id" params={{ id: encodeURIComponent(subfolder.path) }}>
              <div className={classes.folderTile} style={{ width: size, height: size }}>
                <Folder size={40} stroke={1.5} />
              </div>
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
