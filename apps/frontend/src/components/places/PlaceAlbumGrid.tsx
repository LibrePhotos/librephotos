import type { PlaceAlbumInfo } from "@librephotos/api-client";
import { Flex, Text } from "@mantine/core";
import { IconMap2 as Map2 } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import gridClasses from "../album/AlbumGridCell.module.css";
import { Tile } from "../Tile";
import { TileGrid, type TileGridSizing } from "../virtual/TileGrid";

type Props = Readonly<{
  places: readonly PlaceAlbumInfo[];
  orderKey: string;
  sizing: TileGridSizing;
}>;

/**
 * The place albums under the Places map, laid out like the other album grids: square cover, then
 * a one-line title and the photo count.
 */
export function PlaceAlbumGrid({ places, orderKey, sizing }: Props) {
  const { t } = useTranslation();
  return (
    <TileGrid
      scrollRestorationId="album-places"
      items={places}
      orderKey={orderKey}
      getKey={place => place.id}
      sizing={sizing}
      renderItem={(place, size) => {
        // A cover or a placeholder, so a place never depends on its cover to open (#2234)
        const cover = place.cover_photos[0];
        return (
          <Link to="/album/places/$id" params={{ id: String(place.id) }} aria-label={place.title}>
            {cover ? (
              <Tile
                className={gridClasses.cover}
                video={cover.video === true}
                height={size}
                width={size}
                image_hash={cover.image_hash}
              />
            ) : (
              <Flex
                className={gridClasses.cover}
                align="center"
                justify="center"
                h={size}
                w={size}
                bg="var(--mantine-color-default-hover)"
              >
                <Map2 size={40} stroke={1.5} color="var(--mantine-color-gray-5)" />
              </Flex>
            )}
          </Link>
        );
      }}
      renderCaption={place => (
        <Flex gap={0} justify="flex-start" direction="column" px={8}>
          <Link to="/album/places/$id" params={{ id: String(place.id) }} className={gridClasses.titleLink}>
            <Text size="sm" fw={500} lineClamp={1} title={place.title}>
              {place.title}
            </Text>
          </Link>
          <Text size="xs">{t("numberofphotos", { count: place.photo_count, number: place.photo_count })}</Text>
        </Flex>
      )}
    />
  );
}
