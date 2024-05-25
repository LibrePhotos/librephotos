import { Anchor, Loader, Stack, Text } from "@mantine/core";
import { useResizeObserver } from "@mantine/hooks";
import { IconPolaroid as Polaroid, IconUser as User } from "@tabler/icons-react";
import debounce from "lodash/debounce";
import React, { useCallback, useEffect } from "react";
import { AutoSizer, Grid } from "react-virtualized";

import { useFetchSharedAlbumsWithMeQuery } from "../../api_client/albums/sharing";
import { useFetchUserListQuery } from "../../api_client/api";
import { LEFT_MENU_WIDTH } from "../../ui-constants";
import { calculateGridCellSize, calculateSharedAlbumGridCells } from "../../util/gridUtils";
import { SCROLL_DEBOUNCE_DURATION, ScrollSpeed } from "../../util/scrollUtils";
import { Tile } from "../Tile";

const DAY_HEADER_HEIGHT = 70;
const SPEED_THRESHOLD = 300;
const SIDEBAR_WIDTH = LEFT_MENU_WIDTH;

export function AlbumsSharedWithMe({ showSidebar }: any) {
  const [albumGridContents, setAlbumGridContents] = React.useState<any[]>([]);
  const [entrySquareSize, setEntrySquareSize] = React.useState(200);
  const [height, setHeight] = React.useState(window.innerHeight);
  const [isScrollingFast, setIsScrollingFast] = React.useState(false);
  const [numEntrySquaresPerRow, setNumEntrySquaresPerRow] = React.useState(10);
  const [totalListHeight, setTotalListHeight] = React.useState(0);
  const [width, setWidth] = React.useState(window.innerWidth);
  const photoGridRef = React.createRef<Grid>();
  const rect = useResizeObserver()[1];
  const scrollSpeedHandler = new ScrollSpeed();
  const { data: albumsSharedToMe, isFetching, isSuccess } = useFetchSharedAlbumsWithMeQuery();
  const { data: users } = useFetchUserListQuery();

  useEffect(() => {
    if (!isSuccess) {
      return;
    }
    const contents = calculateSharedAlbumGridCells(albumsSharedToMe, numEntrySquaresPerRow).cellContents;
    setAlbumGridContents(contents);
  }, [albumsSharedToMe]);

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
  }, [albumGridContents]);

  const handleScroll = useCallback(
    ({ scrollTop: value }) => {
      // scrollSpeed represents the number of pixels scrolled since the last scroll event was fired
      const scrollSpeed = Math.abs(scrollSpeedHandler.getScrollSpeed(value) ?? 0);

      if (scrollSpeed >= SPEED_THRESHOLD) {
        setIsScrollingFast(true);
      }
    },
    [scrollSpeedHandler]
  );

  useEffect(
    debounce(() => {
      if (isScrollingFast) {
        setIsScrollingFast(false);
      }
    }, SCROLL_DEBOUNCE_DURATION),
    []
  );

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
  }, [rect]);

  const cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    if (albumGridContents[rowIndex][columnIndex]) {
      const cell = albumGridContents[rowIndex][columnIndex];
      if (cell.user_id) {
        // sharer info header
        const owner = users?.filter(e => e.id === cell.user_id)[0];
        let displayName = `user(${cell.user_id})`;
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
                <Text size="xs" c="dimmed" style={{ display: "flex", alignItems: "center" }}>
                  <Polaroid size={16} style={{ marginRight: 5 }} />
                  shared {cell.albums.length} albums with you
                </Text>
              </div>
            </div>
          </div>
        );
      }
      // photo cell
      return (
        <div key={key} style={{ ...style, padding: 1 }}>
          <Anchor href={`/useralbum/${cell.id}/`}>
            <Tile
              style={{ objectFit: "cover" }}
              width={entrySquareSize - 2}
              height={entrySquareSize - 2}
              image_hash={cell.cover_photo.image_hash}
              video={cell.cover_photo.video}
            />
          </Anchor>
          <Text fw={700}>{cell.title}</Text>
          <Text size="sm" c="dimmed">
            {cell.photo_count} photo(s)
          </Text>
        </div>
      );
    }
    // empty cell
    return <div key={key} style={style} />;
  };

  return (
    <div>
      {isFetching && !isSuccess && (
        <Stack align="center">
          <Loader />
          Loading albums shared with you...
        </Stack>
      )}

      {albumGridContents.length === 0 && isSuccess && <div>No one has shared any albums with you yet.</div>}

      {albumGridContents.length > 0 && (
        <div>
          <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
            {({ width: gridWidth }) => (
              <Grid
                ref={photoGridRef}
                style={{ outline: "none" }}
                disableHeader={false}
                onScroll={handleScroll}
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
