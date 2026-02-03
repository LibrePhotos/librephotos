import { Anchor, SimpleGrid, Text, Tooltip } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { UserAlbumInfo } from "../../api_client/albums/types";
import { Tile } from "../Tile";

type PublicAlbumsGridProps = {
  albums: UserAlbumInfo[];
  onShare?: (albumId: string, albumTitle: string, ownerUsername: string) => void;
};

export function PublicAlbumsGrid({ albums, onShare }: PublicAlbumsGridProps) {
  const { t } = useTranslation();

  return (
    <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5, xl: 6 }} spacing="md" mt="md">
      {albums.map(album => (
        <div key={album.id} style={{ position: "relative" }}>
          <Anchor href={`/album/user/${album.id}`} underline="never">
            <div style={{ position: "relative" }}>
              {album.cover_photo ? (
                <Tile
                  style={{ objectFit: "cover", borderRadius: 8 }}
                  width={200}
                  height={200}
                  image_hash={album.cover_photo.image_hash}
                  video={album.cover_photo.video}
                />
              ) : (
                <div
                  style={{
                    width: 200,
                    height: 200,
                    backgroundColor: "var(--mantine-color-gray-2)",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <IconLink size={40} color="var(--mantine-color-gray-5)" />
                </div>
              )}
            </div>
            <Text fw={700} mt={4} lineClamp={1}>
              {album.title}
            </Text>
            <Text size="sm" c="dimmed">
              {t("numberofphotos", { number: album.photo_count })}
            </Text>
          </Anchor>
          <Tooltip label={t("sidemenu.sharing")}>
            <div
              role="button"
              tabIndex={0}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                borderRadius: 4,
                padding: "4px 6px",
                cursor: onShare ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onClick={e => {
                if (onShare) {
                  e.preventDefault();
                  e.stopPropagation();
                  onShare(`${album.id}`, album.title, album.owner.username);
                }
              }}
              onKeyDown={e => {
                if (onShare && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onShare(`${album.id}`, album.title, album.owner.username);
                }
              }}
            >
              <IconLink size={16} color="white" />
            </div>
          </Tooltip>
        </div>
      ))}
    </SimpleGrid>
  );
}
