import type { GalleryPhotographer } from "@librephotos/api-client";
import { Avatar, Flex, Group, Stack, Text } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { calculateGridCellSize } from "../../util/gridUtils";
import gridClasses from "../album/AlbumGridCell.module.css";
import { sharerName } from "../sharing/sharerGroups";
import { Tile } from "../Tile";
import { TileGrid } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";
import { GALLERY_RESERVED_HEIGHT } from "./galleryLayout";

// Below the cover: the avatar and name (sm), then the count (xs).
const CAPTION_HEIGHT = 56;

const columnsFor = (width: number) => calculateGridCellSize(width).numEntrySquaresPerRow;

/**
 * A photographer's photos on the gallery's timeline. Not their public profile (/public/<username>),
 * which is a page of its own that they may keep off.
 */
function PhotographerLink({
  photographer,
  children,
}: {
  photographer: GalleryPhotographer;
  children: React.ReactNode;
}) {
  return (
    <Link to="/public" search={{ owner: photographer.id }} aria-label={sharerName(photographer, photographer.username)}>
      {children}
    </Link>
  );
}

/**
 * The gallery's photographers: the users who take part, most photos first. A card opens their
 * photos on the timeline.
 */
export function GalleryPhotographers({ photographers }: Readonly<{ photographers: GalleryPhotographer[] }>) {
  const { t } = useTranslation();
  const { ref, sizing } = useMeasuredTileSizing({
    columnsFor,
    cellPadding: 1,
    captionHeight: CAPTION_HEIGHT,
    reservedHeight: GALLERY_RESERVED_HEIGHT,
  });
  return (
    <div ref={ref}>
      <TileGrid
        scrollRestorationId="gallery-photographers"
        items={photographers}
        getKey={photographer => photographer.id}
        sizing={sizing}
        renderItem={(photographer, size) => {
          const cover = photographer.cover_photos[0];
          return (
            <PhotographerLink photographer={photographer}>
              {cover ? (
                <Tile
                  className={gridClasses.cover}
                  video={cover.video}
                  height={size}
                  width={size}
                  image_hash={cover.image_hash}
                />
              ) : (
                <Flex className={gridClasses.cover} align="center" justify="center" h={size} w={size}>
                  <IconUser size={40} stroke={1.5} color="var(--mantine-color-gray-5)" />
                </Flex>
              )}
            </PhotographerLink>
          );
        }}
        renderCaption={photographer => {
          const name = sharerName(photographer, photographer.username);
          return (
            <Stack gap={2} px={4}>
              <Group gap={6} wrap="nowrap">
                <Avatar size={20} radius="xl" name={name} color="initials" alt="" />
                <Text size="sm" fw={500} lineClamp={1} title={name}>
                  {name}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {t("numberofphotos", { count: photographer.photo_count, number: photographer.photo_count })}
              </Text>
            </Stack>
          );
        }}
      />
    </div>
  );
}
