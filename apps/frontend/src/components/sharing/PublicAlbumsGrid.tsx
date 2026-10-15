import type { UserAlbumInfo } from "@librephotos/api-client";
import { Anchor, Box, Text } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { albumColumnsFor } from "../../hooks/useAlbumListGridConfig";
import gridClasses from "../album/AlbumGridCell.module.css";
import { Tile } from "../Tile";
import { TileGrid } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";
import { AlbumShareButton } from "./AlbumShareButton";

type PublicAlbumsGridProps = {
  albums: UserAlbumInfo[];
  onShare?: (albumId: string, albumTitle: string, ownerUsername: string) => void;
};

// Below the cover, inside the cell: a one-line title (md, 24.8px) and the photo count (sm, 20.3px).
const CAPTION_HEIGHT = 56;

/**
 * Every album made public via link. Virtualized: the list grows with the library. Columns as on
 * the album pages (two on a phone, up to six), sized from the width of the tab.
 */
export function PublicAlbumsGrid({ albums, onShare }: PublicAlbumsGridProps) {
  const { t } = useTranslation();
  // The page header, the tabs and the padding around them
  const { ref, sizing } = useMeasuredTileSizing({
    columnsFor: albumColumnsFor,
    cellPadding: 8,
    captionHeight: CAPTION_HEIGHT,
    reservedHeight: 45 + 60 + 40,
  });

  return (
    <Box ref={ref} mt="md">
      <TileGrid
        scrollRestorationId="sharing-public-albums"
        items={albums}
        getKey={album => album.id}
        sizing={sizing}
        renderItem={(album, size) => (
          // The share button's corner is the cover's
          <div style={{ position: "relative" }}>
            <Anchor
              aria-label={album.title}
              renderRoot={rootProps => <Link {...rootProps} to="/album/user/$id" params={{ id: String(album.id) }} />}
              underline="never"
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
                  style={{
                    width: size,
                    height: size,
                    borderRadius: "var(--mantine-radius-md)",
                    backgroundColor: "light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <IconLink size={40} color="var(--mantine-color-dimmed)" />
                </div>
              )}
              <Text fw={700} mt={4} lineClamp={1} title={album.title}>
                {album.title}
              </Text>
              <Text size="sm" c="dimmed">
                {t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
              </Text>
            </Anchor>
            {onShare && (
              <AlbumShareButton
                label={t("sidemenu.sharing")}
                onClick={() => onShare(`${album.id}`, album.title, album.owner.username)}
              />
            )}
          </div>
        )}
      />
    </Box>
  );
}
