import type { UserAlbumInfo } from "@librephotos/api-client";
import { Box, Menu } from "@mantine/core";
import { IconLink, IconShare } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { albumColumnsFor } from "../../hooks/useAlbumListGridConfig";
import { ICON_SIZE } from "../../uiConstants";
import { CollectionCard } from "../common/CollectionCard";
import { TileGrid } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";

type PublicAlbumsGridProps = {
  albums: UserAlbumInfo[];
  onShare?: (albumId: string, albumTitle: string, ownerUsername: string) => void;
};

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
    // The title sits on the cover
    captionHeight: 0,
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
          <CollectionCard
            size={size}
            title={album.title}
            meta={t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
            covers={album.cover_photo ? [album.cover_photo] : []}
            placeholder={<IconLink />}
            renderLink={props => <Link {...props} to="/album/user/$id" params={{ id: String(album.id) }} />}
            menuLabel={`${t("useralbum.albumActions")}: ${album.title}`}
            menuItems={
              onShare ? (
                <Menu.Item
                  leftSection={<IconShare size={ICON_SIZE.menu} />}
                  onClick={() => onShare(`${album.id}`, album.title, album.owner.username)}
                >
                  {t("sidemenu.sharing")}
                </Menu.Item>
              ) : null
            }
          />
        )}
      />
    </Box>
  );
}
