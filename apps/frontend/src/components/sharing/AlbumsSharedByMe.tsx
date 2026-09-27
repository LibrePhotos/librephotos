import { Anchor, Loader, Stack, Text } from "@mantine/core";
import { useResizeObserver } from "@mantine/hooks";
import { IconPolaroid as Polaroid, IconUser as User } from "@tabler/icons-react";
import React, { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsByMeQuery } from "../../api_client/albums/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { LEFT_MENU_WIDTH } from "../../ui-constants";
import { calculateGridCellSize, calculateSharedAlbumGridCells } from "../../util/gridUtils";
import { Tile } from "../Tile";
import { VirtualGrid } from "../virtual/VirtualGrid";
import type { GridCellProps } from "../virtual/VirtualGrid";

const DAY_HEADER_HEIGHT = 70;
const SIDEBAR_WIDTH = LEFT_MENU_WIDTH;

export function AlbumsSharedByMe({ showSidebar }: any) {
  const { t } = useTranslation();
  const [albumGridContents, setAlbumGridContents] = React.useState<any[]>([]);
  const [entrySquareSize, setEntrySquareSize] = React.useState(200);
  const [height, setHeight] = React.useState(window.innerHeight);
  const [numEntrySquaresPerRow, setNumEntrySquaresPerRow] = React.useState(10);
  const [width, setWidth] = React.useState(window.innerWidth);
  const rect = useResizeObserver()[1];
  const { data: albums, isFetching, isSuccess } = useFetchSharedAlbumsByMeQuery();
  const { data: users } = useFetchUserListQuery();

  useEffect(() => {
    if (!isSuccess) {
      return;
    }
    const contents = calculateSharedAlbumGridCells(albums, numEntrySquaresPerRow).cellContents;
    setAlbumGridContents(contents);
    // numEntrySquaresPerRow was missing, so resizing the window kept the old
    // column count in the cells while the Grid used the new one.
  }, [albums, isSuccess, numEntrySquaresPerRow]);

  const rowHeight = useCallback(
    ({ index }: { index: number }) =>
      // a sharer header row, or a row of album covers with their title and count
      albumGridContents[index][0].user_id ? DAY_HEADER_HEIGHT : entrySquareSize + 40,
    [albumGridContents, entrySquareSize]
  );

  useEffect(() => {
    const columnWidth = window.innerWidth - 20 - (showSidebar ? SIDEBAR_WIDTH : 0);
    const { entrySquareSize: squareSize, numEntrySquaresPerRow: squaresPerRow } = calculateGridCellSize(columnWidth);
    setHeight(window.innerHeight);
    setWidth(window.innerWidth);
    setEntrySquareSize(squareSize);
    setNumEntrySquaresPerRow(squaresPerRow);
  }, [rect, showSidebar]);

  const cellRenderer = ({ columnIndex, key, rowIndex, style }: GridCellProps) => {
    if (albumGridContents[rowIndex][columnIndex]) {
      const cell = albumGridContents[rowIndex][columnIndex];
      if (cell.user_id) {
        // sharer info header
        const owner = users?.filter(e => e.id === cell.user_id)[0];
        let displayName = cell.user_id;
        if (owner && owner.last_name.length + owner.first_name.length > 0) {
          displayName = `${owner.first_name} ${owner.last_name}`;
        } else if (owner) {
          displayName = owner.username;
        }
        return (
          <div
            key={key}
            style={{
              ...style,
              width,
              height: DAY_HEADER_HEIGHT,
              paddingTop: 15,
              paddingLeft: 5,
            }}
          >
            <div style={{ display: "flex" }}>
              <User size={36} style={{ margin: 5 }} />
              <div>
                <Text size="md" fw="bold">
                  {displayName}
                </Text>
                <Text size="xs" style={{ display: "flex", alignItems: "center" }}>
                  <Polaroid size={16} style={{ marginRight: 5 }} />
                  {t("sharing.youSharedAlbumsWithThem", { count: cell.albums.length })}
                </Text>
              </div>
            </div>
          </div>
        );
      }
      // photo cell
      return (
        <div key={key} style={{ ...style, padding: 1 }}>
          <Anchor href={`/album/user/${cell.id}`}>
            {cell.cover_photo && (
              <Tile
                style={{ objectFit: "cover" }}
                width={entrySquareSize - 2}
                height={entrySquareSize - 2}
                image_hash={cell.cover_photo.image_hash}
                video={cell.cover_photo.video}
              />
            )}
          </Anchor>
          <Text fw={700}>{cell.title}</Text>
          <Text size="sm" c="dimmed">
            {t("sharing.photoCount", { count: cell.photo_count })}
          </Text>
        </div>
      );
    }
    // empty cell
    return <div key={key} style={style} />;
  };

  return (
    <div>
      {isFetching && (
        <Stack align="center">
          <Loader />
          {t("sharing.loadingAlbumsSharedByYou")}
        </Stack>
      )}

      {albumGridContents.length === 0 && isSuccess && <div>{t("sharing.noAlbumsSharedByYou")}</div>}

      {albumGridContents.length > 0 && (
        <div>
          <VirtualGrid
            style={{ outline: "none" }}
            cellRenderer={cellRenderer}
            columnWidth={entrySquareSize}
            columnCount={numEntrySquaresPerRow}
            height={height - 45 - 60 - 40}
            rowCount={albumGridContents.length}
            rowHeight={rowHeight}
          />
        </div>
      )}
    </div>
  );
}
