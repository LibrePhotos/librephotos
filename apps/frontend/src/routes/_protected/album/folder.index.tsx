import { Flex, Text } from "@mantine/core";
import { IconFolder as Folder } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAllFolderSubfolders } from "../../../api_client/albums/hooks";
import { EmptyState } from "../../../components/common/EmptyState";
import { HeaderComponent } from "../../../components/HeaderComponent";
import { VirtualGrid } from "../../../components/virtual/VirtualGrid";
import type { GridCellProps } from "../../../components/virtual/VirtualGrid";
import { ALBUM_GRID_GUTTER, useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";
import classes from "./folder.module.css";

export const Route = createFileRoute("/_protected/album/folder/")({
  component: AlbumFolder,
});

function AlbumFolder() {
  const { t } = useTranslation();
  const { subfolders, isLoading, isFetching } = useAllFolderSubfolders();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(subfolders);

  function renderCell({ columnIndex, key, rowIndex, style }: GridCellProps) {
    const index = rowIndex * entriesPerRow + columnIndex;
    if (index >= subfolders.length) {
      return <div key={key} style={style} />;
    }

    const subfolder = subfolders[index];
    return (
      <div key={key} style={style}>
        <div style={{ padding: 5 }}>
          <Link to="/album/folder/$id" params={{ id: encodeURIComponent(subfolder.path) }}>
            <div className={classes.folderTile} style={{ width: entrySquareSize - 10, height: entrySquareSize - 10 }}>
              <Folder size={40} stroke={1.5} />
            </div>
          </Link>
        </div>
        <Flex gap={0} justify="flex-start" direction="column" px={8}>
          <Text size="sm" fw={500} lineClamp={1} title={subfolder.path}>
            {subfolder.name}
          </Text>
          <Text size="xs">{t("numberofphotos", { count: subfolder.photo_count, number: subfolder.photo_count })}</Text>
        </Flex>
      </div>
    );
  }

  return (
    <div>
      <HeaderComponent
        icon={<Folder size={50} />}
        title={t("folders")}
        fetching={isFetching}
        subtitle={t("folders_count", { count: subfolders.length })}
      />

      {/* Outside the grid: with no folders it renders no cells to put a message in */}
      {!isLoading && subfolders.length === 0 ? (
        <EmptyState
          icon={<Folder size={40} />}
          title={t("emptystate.folders.title")}
          description={t("emptystate.folders.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      ) : (
        <VirtualGrid
          style={{ outline: "none", paddingLeft: ALBUM_GRID_GUTTER }}
          cellRenderer={renderCell}
          columnWidth={entrySquareSize}
          columnCount={entriesPerRow}
          height={gridHeight}
          rowHeight={entrySquareSize + 60}
          rowCount={numberOfRows}
        />
      )}
    </div>
  );
}
