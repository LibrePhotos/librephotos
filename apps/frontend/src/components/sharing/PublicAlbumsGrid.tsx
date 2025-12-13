import { Anchor, SimpleGrid, Text } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { UserAlbumInfo } from "../../api_client/albums/types";
import { Tile } from "../Tile";

type PublicAlbumsGridProps = {
  albums: UserAlbumInfo[];
};

export function PublicAlbumsGrid({ albums }: PublicAlbumsGridProps) {
  const { t } = useTranslation();

  return (
    <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5, xl: 6 }} spacing="md" mt="md">
      {albums.map((album) => (
        <Anchor key={album.id} href={`/album/user/${album.id}`} underline="never">
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
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                backgroundColor: "var(--mantine-color-violet-6)",
                borderRadius: 4,
                padding: "2px 6px",
              }}
            >
              <IconLink size={14} color="white" />
            </div>
          </div>
          <Text fw={700} mt={4} lineClamp={1}>
            {album.title}
          </Text>
          <Text size="sm" c="dimmed">
            {t("numberofphotos", { number: album.photo_count })}
          </Text>
        </Anchor>
      ))}
    </SimpleGrid>
  );
}

