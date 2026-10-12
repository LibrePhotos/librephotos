import { Anchor, Avatar, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconShare, IconPolaroid as Polaroid } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsByMeQuery } from "../../api_client/albums/hooks";
import type { UserAlbumInfo } from "../../api_client/albums/types";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { calculateGridCellSize } from "../../util/gridUtils";
import gridClasses from "../album/AlbumGridCell.module.css";
import { PageLoader } from "../common/PageLoader";
import { Tile } from "../Tile";
import { TileGrid } from "../virtual/TileGrid";
import type { TileGroup } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";
import { AlbumShareButton } from "./AlbumShareButton";
import { avatarSrc } from "./avatarSrc";
import { ModalAlbumShare } from "./ModalAlbumShare";
import { sharerName } from "./sharerGroups";

const DAY_HEADER_HEIGHT = 70;
// Below the cover: a one-line title (md, 24.8px) and the photo count (sm, 20.3px).
const CAPTION_HEIGHT = 52;

const columnsFor = (width: number) => calculateGridCellSize(width).numEntrySquaresPerRow;

export function AlbumsSharedByMe() {
  const { t } = useTranslation();
  // Sized from the width the grid actually gets, less room for its scrollbar, so the columns fit
  // it and follow a resize.
  const { ref: containerRef, sizing } = useMeasuredTileSizing({
    columnsFor,
    cellPadding: 1,
    captionHeight: CAPTION_HEIGHT,
    reservedHeight: 45 + 60 + 40,
  });
  const { data: albums, isFetching, isSuccess } = useFetchSharedAlbumsByMeQuery();
  const { data: users } = useFetchUserListQuery();
  // Stop or change a share from here instead of opening each album.
  const [shareAlbumId, setShareAlbumId] = useState("");
  const [isShareDialogOpen, { open: openShareDialog, close: closeShareDialog }] = useDisclosure(false);

  // One group per user the albums are shared with, under a header with who it is
  const groups = useMemo((): TileGroup<UserAlbumInfo>[] => {
    if (!isSuccess) return [];
    return albums.map(group => {
      const owner = users?.filter(e => e.id === group.user_id)[0];
      const displayName = sharerName(owner, `${group.user_id}`);
      return {
        key: group.user_id,
        items: group.albums,
        header: (
          <div style={{ height: DAY_HEADER_HEIGHT, paddingTop: 15, paddingLeft: 5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar size={36} radius="xl" src={avatarSrc(owner)} />
              <div>
                <Text size="md" fw="bold">
                  {displayName}
                </Text>
                <Text size="xs" c="dimmed" style={{ display: "flex", alignItems: "center" }}>
                  <Polaroid size={16} style={{ marginRight: 5 }} />
                  {t("sharing.youSharedAlbumsWithThem", { count: group.albums.length })}
                </Text>
              </div>
            </div>
          </div>
        ),
      };
    });
  }, [albums, isSuccess, users, t]);

  return (
    <div ref={containerRef}>
      {/* Only before the first answer: a background refetch kept stacking a
          loader above the grid. */}
      {isFetching && !isSuccess && <PageLoader label={t("sharing.loadingAlbumsSharedByYou")} />}

      {groups.length === 0 && isSuccess && (
        <Stack align="center" mt="xl">
          <Text c="dimmed">{t("sharing.noAlbumsSharedByYou")}</Text>
        </Stack>
      )}

      {groups.length > 0 && (
        <div>
          <TileGrid
            groups={groups}
            headerHeight={DAY_HEADER_HEIGHT}
            getKey={album => album.id}
            sizing={sizing}
            renderItem={(album, size) => (
              <>
                <Anchor
                  renderRoot={rootProps => (
                    <Link {...rootProps} to="/album/user/$id" params={{ id: String(album.id) }} />
                  )}
                >
                  {album.cover_photo ? (
                    <Tile
                      className={gridClasses.cover}
                      style={{ objectFit: "cover" }}
                      width={size}
                      height={size}
                      image_hash={album.cover_photo.image_hash}
                      video={album.cover_photo.video}
                    />
                  ) : (
                    <div
                      className={gridClasses.cover}
                      style={{
                        width: size,
                        height: size,
                        backgroundColor: "light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))",
                      }}
                    />
                  )}
                </Anchor>
                <AlbumShareButton
                  label={t("sidemenu.sharing")}
                  icon={<IconShare size={16} color="white" />}
                  onClick={() => {
                    setShareAlbumId(`${album.id}`);
                    openShareDialog();
                  }}
                />
                <Text fw={700} mt={4} lineClamp={1} title={album.title}>
                  {album.title}
                </Text>
                <Text size="sm" c="dimmed">
                  {t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
                </Text>
              </>
            )}
          />
        </div>
      )}

      <ModalAlbumShare isOpen={isShareDialogOpen} onRequestClose={closeShareDialog} albumID={shareAlbumId} />
    </div>
  );
}
