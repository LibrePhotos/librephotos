import type { SharedGroup, SharedGroupKind } from "@librephotos/api-client";
import { Flex, Stack, Text } from "@mantine/core";
import { IconMap2 as Map2, IconTags as Tags } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedGroupsWithMeQuery } from "../../api_client/photos/hooks";
import { useThingLabel } from "../../hooks/useThingLabel";
import { calculateGridCellSize } from "../../util/gridUtils";
import gridClasses from "../album/AlbumGridCell.module.css";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { Tile } from "../Tile";
import { TileGrid } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";
import { SHARED_TAB_RESERVED_HEIGHT } from "./sharedWithMeLayout";

// Below the cover: a one-line title (sm) and the photo count (xs).
const CAPTION_HEIGHT = 52;

const columnsFor = (width: number) => calculateGridCellSize(width).numEntrySquaresPerRow;

type Props = Readonly<{ kind: SharedGroupKind }>;

/** The link to the photos shared with you under one place or thing. */
function GroupLink({
  kind,
  title,
  children,
  label,
}: Props & { title: string; label?: string; children: React.ReactNode }) {
  const linkProps =
    kind === "places"
      ? ({ to: "/sharing/withme/places/$title", params: { title } } as const)
      : ({ to: "/sharing/withme/things/$title", params: { title } } as const);
  return (
    <Link {...linkProps} aria-label={label} className={label ? undefined : gridClasses.titleLink}>
      {children}
    </Link>
  );
}

/**
 * Sharing > Shared with you > Places or Things (#2721): the photos others shared with you, grouped
 * by the owners' places or things. A place of two owners is one tile; its count and covers are the
 * shared photos only.
 */
export function SharedGroupsWithMe({ kind }: Props) {
  const { t } = useTranslation();
  const thingLabel = useThingLabel();
  const { ref, sizing } = useMeasuredTileSizing({
    columnsFor,
    cellPadding: 1,
    captionHeight: CAPTION_HEIGHT,
    reservedHeight: SHARED_TAB_RESERVED_HEIGHT,
  });
  const query = useFetchSharedGroupsWithMeQuery(kind);
  const listFailure = useListFailure(query);
  const { data: groups, isLoading } = query;
  const Icon = kind === "places" ? Map2 : Tags;
  const labelOf = (group: SharedGroup) => (kind === "things" ? thingLabel(group.title) : group.title);

  if (listFailure) return <ErrorState failure={listFailure} />;
  if (isLoading) {
    return <PageLoader label={t(kind === "places" ? "sharing.loadingPlaces" : "sharing.loadingThings")} />;
  }
  if (!groups || groups.length === 0) {
    return (
      <Stack align="center" mt="xl">
        <Text c="dimmed" ta="center" maw={420}>
          {t(kind === "places" ? "sharing.noPlacesSharedWithYou" : "sharing.noThingsSharedWithYou")}
        </Text>
      </Stack>
    );
  }

  return (
    <div ref={ref}>
      <TileGrid
        scrollRestorationId={`sharing-${kind}-with-me`}
        items={groups}
        getKey={group => group.title}
        sizing={sizing}
        renderItem={(group, size) => {
          const cover = group.cover_photos[0];
          return (
            <GroupLink kind={kind} title={group.title} label={labelOf(group)}>
              {cover ? (
                <Tile
                  className={gridClasses.cover}
                  video={cover.video}
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
                  <Icon size={40} stroke={1.5} color="var(--mantine-color-gray-5)" />
                </Flex>
              )}
            </GroupLink>
          );
        }}
        renderCaption={group => (
          <Flex gap={0} direction="column" px={4}>
            <GroupLink kind={kind} title={group.title}>
              <Text size="sm" fw={500} lineClamp={1} title={labelOf(group)}>
                {labelOf(group)}
              </Text>
            </GroupLink>
            <Text size="xs" c="dimmed">
              {t("numberofphotos", { count: group.photo_count, number: group.photo_count })}
            </Text>
          </Flex>
        )}
      />
    </div>
  );
}
