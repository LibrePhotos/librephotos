import { Anchor, SimpleGrid, Text } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { UserAlbumInfo } from "../../api_client/albums/types";
import { Tile } from "../Tile";
import { AlbumShareButton } from "./AlbumShareButton";

type PublicAlbumsGridProps = {
  albums: UserAlbumInfo[];
  onShare?: (albumId: string, albumTitle: string, ownerUsername: string) => void;
};

// The cover fills its column: a fixed 200px overflowed the two phone columns.
const coverStyle = { width: "100%", height: "auto", aspectRatio: "1", objectFit: "cover", borderRadius: 8 } as const;

export function PublicAlbumsGrid({ albums, onShare }: PublicAlbumsGridProps) {
  const { t } = useTranslation();

  return (
    <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5, xl: 6 }} spacing="md" mt="md">
      {albums.map(album => (
        <div key={album.id} style={{ position: "relative", minWidth: 0 }}>
          <Anchor
            renderRoot={rootProps => <Link {...rootProps} to="/album/user/$id" params={{ id: String(album.id) }} />}
            underline="never"
          >
            {album.cover_photo ? (
              <Tile
                style={coverStyle}
                width={200}
                height={200}
                image_hash={album.cover_photo.image_hash}
                video={album.cover_photo.video}
              />
            ) : (
              <div
                style={{
                  ...coverStyle,
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
      ))}
    </SimpleGrid>
  );
}
