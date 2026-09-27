import { Anchor, Loader, Stack, Text } from "@mantine/core";
import { useElementSize, useViewportSize } from "@mantine/hooks";
import { IconPolaroid as Polaroid, IconUser as User } from "@tabler/icons-react";
import React, { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsWithMeQuery } from "../../api_client/albums/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { calculateGridCellSize, calculateSharedAlbumGridCells } from "../../util/gridUtils";
import { Tile } from "../Tile";
import { VirtualGrid } from "../virtual/VirtualGrid";
import type { GridCellProps } from "../virtual/VirtualGrid";

const DAY_HEADER_HEIGHT = 70;

export function AlbumsSharedWithMe() {
  const { t } = useTranslation();
  const [albumGridContents, setAlbumGridContents] = React.useState<any[]>([]);
  // Size the columns from the width the grid actually gets, less room for its scrollbar, so they
  // fit it and follow a resize. The viewport size reads 0 until its first effect.
  const { ref: containerRef, width } = useElementSize();
  const height = useViewportSize().height || window.innerHeight;
  const { entrySquareSize, numEntrySquaresPerRow } = calculateGridCellSize((width || window.innerWidth) - 20);
  const { data: albumsSharedToMe, isFetching, isSuccess } = useFetchSharedAlbumsWithMeQuery();
  const { data: users } = useFetchUserListQuery();

  useEffect(() => {
    if (!isSuccess) {
      return;
    }
    const contents = calculateSharedAlbumGridCells(albumsSharedToMe, numEntrySquaresPerRow).cellContents;
    setAlbumGridContents(contents);
    // Recomputed on a column count change, or the cells keep the old row layout while the grid
    // draws the new one.
  }, [albumsSharedToMe, isSuccess, numEntrySquaresPerRow]);

  const rowHeight = useCallback(
    ({ index }: { index: number }) =>
      // a sharer header row, or a row of album covers with their title and count
      albumGridContents[index][0].user_id ? DAY_HEADER_HEIGHT : entrySquareSize + 40,
    [albumGridContents, entrySquareSize]
  );

  const cellRenderer = ({ columnIndex, key, rowIndex, style }: GridCellProps) => {
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
                  {t("sharing.sharedAlbumsWithYou", { count: cell.albums.length })}
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
    <div ref={containerRef}>
      {isFetching && !isSuccess && (
        <Stack align="center">
          <Loader />
          {t("sharing.loadingAlbumsSharedWithYou")}
        </Stack>
      )}

      {albumGridContents.length === 0 && isSuccess && <div>{t("sharing.noAlbumsSharedWithYou")}</div>}

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
