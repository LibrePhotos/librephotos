import { Anchor, Loader, Stack, Text } from "@mantine/core";
import { useResizeObserver } from "@mantine/hooks";
import { IconPolaroid as Polaroid, IconUser as User } from "@tabler/icons-react";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AutoSizer, Grid } from "react-virtualized";
import { useFetchSharedAlbumsByMeQuery } from "../../api_client/albums/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { LEFT_MENU_WIDTH } from "../../ui-constants";
import { calculateGridCellSize, calculateSharedAlbumGridCells } from "../../util/gridUtils";
import { Tile } from "../Tile";

const DAY_HEADER_HEIGHT = 70;
const SIDEBAR_WIDTH = LEFT_MENU_WIDTH;

export function AlbumsSharedByMe({ showSidebar }: any) {
  const { t } = useTranslation();
  const [albumGridContents, setAlbumGridContents] = React.useState<any[]>([]);
  const [entrySquareSize, setEntrySquareSize] = React.useState(200);
  const [height, setHeight] = React.useState(window.innerHeight);
  const [numEntrySquaresPerRow, setNumEntrySquaresPerRow] = React.useState(10);
  const [totalListHeight, setTotalListHeight] = React.useState(0);
  const [width, setWidth] = React.useState(window.innerWidth);
  const photoGridRef = useRef<Grid>(null);
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

  useEffect(() => {
    const listHeight = albumGridContents
      .map(row => {
        if (row[0].user_id) {
          // header row
          return DAY_HEADER_HEIGHT;
        }
        // photo row
        return entrySquareSize + 40;
      })
      .reduce((a, b) => a + b, 0);
    setTotalListHeight(listHeight);
  }, [albumGridContents, entrySquareSize]);

  useEffect(() => {
    const columnWidth = window.innerWidth - 20 - (showSidebar ? SIDEBAR_WIDTH : 0);
    const { entrySquareSize: squareSize, numEntrySquaresPerRow: squaresPerRow } = calculateGridCellSize(columnWidth);
    setHeight(window.innerHeight);
    setWidth(window.innerWidth);
    setEntrySquareSize(squareSize);
    setNumEntrySquaresPerRow(squaresPerRow);
    if (photoGridRef.current) {
      photoGridRef.current.recomputeGridSize();
    }
  }, [rect, showSidebar]);

  const cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
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
          <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
            {({ width: gridWidth }) => (
              <Grid
                ref={photoGridRef}
                style={{ outline: "none" }}
                disableHeader={false}
                cellRenderer={cellRenderer}
                columnWidth={entrySquareSize}
                columnCount={numEntrySquaresPerRow}
                height={height - 45 - 60 - 40}
                rowCount={albumGridContents.length}
                rowHeight={({ index }) => {
                  if (albumGridContents[index][0].user_id) {
                    // header row
                    return DAY_HEADER_HEIGHT;
                  }
                  // photo row
                  return entrySquareSize + 40;
                }}
                estimatedRowSize={totalListHeight / +albumGridContents.length.toFixed(1)}
                width={gridWidth}
              />
            )}
          </AutoSizer>
        </div>
      )}
    </div>
  );
}
