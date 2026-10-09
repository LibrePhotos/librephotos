import { Anchor, Avatar, Loader, Stack, Text } from "@mantine/core";
import { useDisclosure, useElementSize, useViewportSize } from "@mantine/hooks";
import { IconShare, IconPolaroid as Polaroid } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsByMeQuery } from "../../api_client/albums/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { calculateGridCellSize, calculateSharedAlbumGridCells } from "../../util/gridUtils";
import { Tile } from "../Tile";
import { VirtualGrid } from "../virtual/VirtualGrid";
import type { GridCellProps } from "../virtual/VirtualGrid";
import { AlbumShareButton } from "./AlbumShareButton";
import { avatarSrc } from "./avatarSrc";
import { ModalAlbumShare } from "./ModalAlbumShare";

const DAY_HEADER_HEIGHT = 70;
// Below the cover: a one-line title (md, 24.8px) and the photo count (sm, 20.3px).
const CAPTION_HEIGHT = 52;

export function AlbumsSharedByMe() {
  const { t } = useTranslation();
  const [albumGridContents, setAlbumGridContents] = React.useState<any[]>([]);
  // Size the columns from the width the grid actually gets, less room for its scrollbar, so they
  // fit it and follow a resize. The viewport size reads 0 until its first effect.
  const { ref: containerRef, width } = useElementSize();
  const height = useViewportSize().height || window.innerHeight;
  const { entrySquareSize, numEntrySquaresPerRow } = calculateGridCellSize((width || window.innerWidth) - 20);
  const { data: albums, isFetching, isSuccess } = useFetchSharedAlbumsByMeQuery();
  const { data: users } = useFetchUserListQuery();
  // Stop or change a share from here instead of opening each album.
  const [shareAlbumId, setShareAlbumId] = useState("");
  const [isShareDialogOpen, { open: openShareDialog, close: closeShareDialog }] = useDisclosure(false);

  useEffect(() => {
    if (!isSuccess) {
      return;
    }
    const contents = calculateSharedAlbumGridCells(albums, numEntrySquaresPerRow).cellContents;
    setAlbumGridContents(contents);
    // Recomputed on a column count change, or the cells keep the old row layout while the grid
    // draws the new one.
  }, [albums, isSuccess, numEntrySquaresPerRow]);

  const rowHeight = useCallback(
    ({ index }: { index: number }) =>
      // a sharer header row, or a row of album covers with their title and count
      albumGridContents[index][0].user_id ? DAY_HEADER_HEIGHT : entrySquareSize + CAPTION_HEIGHT,
    [albumGridContents, entrySquareSize]
  );

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
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar size={36} radius="xl" src={avatarSrc(owner)} />
              <div>
                <Text size="md" fw="bold">
                  {displayName}
                </Text>
                <Text size="xs" c="dimmed" style={{ display: "flex", alignItems: "center" }}>
                  <Polaroid size={16} style={{ marginRight: 5 }} />
                  {t("sharing.youSharedAlbumsWithThem", { count: cell.albums.length })}
                </Text>
              </div>
            </div>
          </div>
        );
      }
      // album cell
      return (
        <div key={key} style={{ ...style, padding: 1 }}>
          <Anchor
            renderRoot={rootProps => <Link {...rootProps} to="/album/user/$id" params={{ id: String(cell.id) }} />}
          >
            {cell.cover_photo ? (
              <Tile
                style={{ objectFit: "cover" }}
                width={entrySquareSize - 2}
                height={entrySquareSize - 2}
                image_hash={cell.cover_photo.image_hash}
                video={cell.cover_photo.video}
              />
            ) : (
              <div
                style={{
                  width: entrySquareSize - 2,
                  height: entrySquareSize - 2,
                  backgroundColor: "light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))",
                }}
              />
            )}
          </Anchor>
          <AlbumShareButton
            label={t("sidemenu.sharing")}
            icon={<IconShare size={16} color="white" />}
            onClick={() => {
              setShareAlbumId(`${cell.id}`);
              openShareDialog();
            }}
          />
          <Text fw={700} mt={4} lineClamp={1} title={cell.title}>
            {cell.title}
          </Text>
          <Text size="sm" c="dimmed">
            {t("numberofphotos", { count: cell.photo_count, number: cell.photo_count })}
          </Text>
        </div>
      );
    }
    // empty cell
    return <div key={key} style={style} />;
  };

  return (
    <div ref={containerRef}>
      {/* Only before the first answer: a background refetch kept stacking a
          loader above the grid. */}
      {isFetching && !isSuccess && (
        <Stack align="center" mt="xl">
          <Loader />
          {t("sharing.loadingAlbumsSharedByYou")}
        </Stack>
      )}

      {albumGridContents.length === 0 && isSuccess && (
        <Stack align="center" mt="xl">
          <Text c="dimmed">{t("sharing.noAlbumsSharedByYou")}</Text>
        </Stack>
      )}

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

      <ModalAlbumShare isOpen={isShareDialogOpen} onRequestClose={closeShareDialog} albumID={shareAlbumId} />
    </div>
  );
}
