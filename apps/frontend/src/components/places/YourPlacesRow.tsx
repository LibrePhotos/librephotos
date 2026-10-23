import type { UserPlace } from "@librephotos/api-client";
import { Button, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { IconMapPinPlus } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";
import { MediaThumbnail } from "../common/MediaThumbnail";
import { PLACE_ICONS } from "./placeIcons";
import classes from "./YourPlacesRow.module.css";

type Props = Readonly<{
  places: readonly UserPlace[];
  /** Why a place cannot be added now (maps off, one being drawn), or nothing. */
  addDisabledReason: string | null;
  onAdd: () => void;
}>;

const COVER_SIZE = 132;

/**
 * Your places (#1365) above the places the map shows: always all of them, whatever the map's
 * view, and a tile to add one. At most 100 (the server's limit), so a plain row.
 */
export function YourPlacesRow({ places, addDisabledReason, onAdd }: Props) {
  const { t } = useTranslation();
  return (
    <Stack gap={6} className={classes.row}>
      <Text size="sm" fw={600}>
        {t("yourplaces.title")}
      </Text>
      <ScrollArea type="auto" offsetScrollbars>
        <Group gap="sm" wrap="nowrap" align="flex-start">
          {places.map(place => {
            const Icon = PLACE_ICONS[place.icon];
            const cover = place.cover_photos[0];
            return (
              <Link
                key={place.id}
                to="/album/places/mine/$id"
                params={{ id: String(place.id) }}
                className={classes.tile}
              >
                <div className={classes.cover}>
                  {cover ? (
                    <MediaThumbnail
                      imageHash={cover.image_hash}
                      video={cover.video}
                      size={COVER_SIZE}
                      kind="square_thumbnails"
                    />
                  ) : (
                    <Icon size={40} stroke={1.5} color="var(--mantine-color-gray-5)" aria-hidden />
                  )}
                </div>
                <Group gap={4} mt={6} wrap="nowrap">
                  <Icon size={14} color="var(--mantine-color-blue-filled)" aria-hidden />
                  <Text size="sm" fw={500} lineClamp={1} className={classes.name} title={place.name}>
                    {place.name}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {t("yourplaces.tileCaption", { count: place.photo_count, radius: place.radius_m })}
                </Text>
              </Link>
            );
          })}
          <DisabledReason reason={addDisabledReason}>
            <Button variant="subtle" className={classes.add} onClick={onAdd} leftSection={<IconMapPinPlus size={18} />}>
              {t("yourplaces.add")}
            </Button>
          </DisabledReason>
        </Group>
      </ScrollArea>
    </Stack>
  );
}
