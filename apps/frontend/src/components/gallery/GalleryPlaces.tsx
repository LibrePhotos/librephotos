import type { GalleryPhotographer, GalleryPlace } from "@librephotos/api-client";
import { Avatar, Flex, Group, Stack, Text } from "@mantine/core";
import { IconMap2 } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGalleryPlacesQuery } from "../../api_client/gallery/hooks";
import { calculateGridCellSize } from "../../util/gridUtils";
import gridClasses from "../album/AlbumGridCell.module.css";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { sharerName } from "../sharing/sharerGroups";
import { Tile } from "../Tile";
import { TileGrid } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";
import { GALLERY_RESERVED_HEIGHT } from "./galleryLayout";

// Below the cover: the town (sm), then the count and who took them (xs).
const CAPTION_HEIGHT = 56;
// Owner marks under a town: more are summed up as "+n".
const OWNERS_SHOWN = 3;

const columnsFor = (width: number) => calculateGridCellSize(width).numEntrySquaresPerRow;

type Props = Readonly<{ owner: number | undefined; photographers: ReadonlyMap<number, GalleryPhotographer> }>;

/** A town's photos on the gallery's timeline: the link keeps the photographer filter. */
function PlaceLink({ place, label, children }: { place: string; label?: string; children: React.ReactNode }) {
  return (
    <Link
      to="/public"
      search={previous => ({ owner: previous.owner, place })}
      aria-label={label}
      className={label ? undefined : gridClasses.titleLink}
    >
      {children}
    </Link>
  );
}

function OwnerMarks({ place, photographers }: { place: GalleryPlace; photographers: Props["photographers"] }) {
  const owners = place.owner_ids.flatMap(id => {
    const owner = photographers.get(id);
    return owner ? [{ id, name: sharerName(owner, owner.username) }] : [];
  });
  return (
    <Avatar.Group spacing={6}>
      {owners.slice(0, OWNERS_SHOWN).map(({ id, name }) => (
        <Avatar key={id} size={18} radius="xl" name={name} color="initials" title={name} aria-label={name} />
      ))}
      {owners.length > OWNERS_SHOWN && (
        <Avatar size={18} radius="xl">
          +{owners.length - OWNERS_SHOWN}
        </Avatar>
      )}
    </Avatar.Group>
  );
}

/**
 * The gallery's places: the towns of the photos whose photographers share where they took them,
 * photographers merged. Only town names, never a spot on a map. A town opens its photos on the
 * timeline.
 */
export function GalleryPlaces({ owner, photographers }: Props) {
  const { t } = useTranslation();
  const { ref, sizing } = useMeasuredTileSizing({
    columnsFor,
    cellPadding: 1,
    captionHeight: CAPTION_HEIGHT,
    reservedHeight: GALLERY_RESERVED_HEIGHT,
  });
  const query = useGalleryPlacesQuery(owner);
  const failure = useListFailure(query);
  const { data: places, isLoading } = query;

  if (failure) return <ErrorState failure={failure} />;
  if (isLoading) return <PageLoader label={t("gallery.loadingPlaces")} />;
  if (!places || places.length === 0) {
    return (
      <Stack align="center" mt="xl">
        <Text c="dimmed" ta="center" maw={420}>
          {t("gallery.noPlaces")}
        </Text>
      </Stack>
    );
  }
  return (
    <div ref={ref}>
      <TileGrid
        scrollRestorationId={`gallery-places-${owner ?? "all"}`}
        items={places}
        getKey={place => place.name}
        sizing={sizing}
        renderItem={(place, size) => {
          const cover = place.cover_photos[0];
          return (
            <PlaceLink place={place.name} label={place.name}>
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
                  <IconMap2 size={40} stroke={1.5} color="var(--mantine-color-gray-5)" />
                </Flex>
              )}
            </PlaceLink>
          );
        }}
        renderCaption={place => (
          <Stack gap={2} px={4}>
            <PlaceLink place={place.name}>
              <Text size="sm" fw={500} lineClamp={1} title={place.name}>
                {place.name}
              </Text>
            </PlaceLink>
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">
                {t("numberofphotos", { count: place.photo_count, number: place.photo_count })}
              </Text>
              <OwnerMarks place={place} photographers={photographers} />
            </Group>
          </Stack>
        )}
      />
    </div>
  );
}
