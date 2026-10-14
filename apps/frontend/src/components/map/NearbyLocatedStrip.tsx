import type { LocatedPhoto } from "@librephotos/api-client";
import { Group, Image, Skeleton, Stack, Text, UnstyledButton } from "@mantine/core";
import type { TFunction } from "i18next";
import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import classes from "./NearbyLocatedStrip.module.css";
import { formatAmount, formatTaken, offsetFromSpan, type TakenSpan } from "./nearbyTime";

const TILE_SIZE = 72;

/** A geotagged photo with its position, the only kind the strip offers. */
export type PositionedPhoto = LocatedPhoto & { exif_gps_lat: number; exif_gps_lon: number };

export function hasPosition(photo: LocatedPhoto): photo is PositionedPhoto {
  return photo.exif_gps_lat !== null && photo.exif_gps_lon !== null;
}

type Props = Readonly<{
  /** The photos from `GET /photos/located-nearby-in-time/`, nearest first; undefined while loading. */
  photos: LocatedPhoto[] | undefined;
  /** When the photos the location is for were taken, for "2 hr before" under each tile. */
  span: TakenSpan;
  /** The position picked now: the tile with it is marked. */
  position: readonly [number, number] | null;
  onPick: (photo: PositionedPhoto) => void;
}>;

/**
 * "Copy from a photo taken nearby in time" (#2279): the user's geotagged photos taken within a day
 * of the photos the location is for. A tile drops the pin on that photo's location and names its
 * place without a lookup.
 */
export function NearbyLocatedStrip({ photos, span, position, onPick }: Props) {
  const { t } = useTranslation();
  const located = photos?.filter(hasPosition);
  const labelId = useId();
  return (
    <Stack gap={6}>
      <Text size="sm" fw={500} id={labelId}>
        {t("locationpicker.copy_from_nearby")}
      </Text>
      <StripContent photos={located} span={span} position={position} onPick={onPick} labelId={labelId} />
    </Stack>
  );
}

function StripContent({
  photos,
  span,
  position,
  onPick,
  labelId,
}: Readonly<Omit<Props, "photos"> & { photos: PositionedPhoto[] | undefined; labelId: string }>) {
  const { t } = useTranslation();
  if (photos === undefined) {
    return (
      <Group gap="xs" wrap="nowrap" aria-busy>
        {[0, 1, 2, 3].map(index => (
          <Skeleton key={index} w={TILE_SIZE} h={TILE_SIZE} radius="sm" />
        ))}
      </Group>
    );
  }
  if (photos.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        {t("locationpicker.copy_from_nearby_none")}
      </Text>
    );
  }
  return (
    <Group gap="xs" wrap="nowrap" role="group" aria-labelledby={labelId} className={classes.strip}>
      {photos.map(photo => (
        <NearbyTile
          key={photo.id}
          photo={photo}
          span={span}
          selected={position !== null && position[0] === photo.exif_gps_lat && position[1] === photo.exif_gps_lon}
          onPick={onPick}
        />
      ))}
    </Group>
  );
}

function NearbyTile({
  photo,
  span,
  selected,
  onPick,
}: Readonly<{ photo: PositionedPhoto; span: TakenSpan; selected: boolean; onPick: (photo: PositionedPhoto) => void }>) {
  const { t } = useTranslation();
  const coordinates = `${photo.exif_gps_lat.toFixed(4)}, ${photo.exif_gps_lon.toFixed(4)}`;
  const place = photo.place || coordinates;
  const when = photo.exif_timestamp ? timeLabel(photo.exif_timestamp, span, t) : "";
  const date = photo.exif_timestamp ? formatTaken(photo.exif_timestamp) : "";
  return (
    <UnstyledButton
      className={classes.tile}
      data-selected={selected || undefined}
      aria-pressed={selected}
      aria-label={t("locationpicker.copy_from_photo", { date, place })}
      onClick={() => onPick(photo)}
      w={TILE_SIZE + 8}
    >
      <Image
        src={mediaUrl.squareThumbnailSmall(photo.image_hash)}
        w={TILE_SIZE}
        h={TILE_SIZE}
        radius="sm"
        alt=""
        className={classes.thumbnail}
      />
      <Text size="xs" lineClamp={1} mt={4}>
        {photo.short_place || place}
      </Text>
      <Text size="xs" c="dimmed" lineClamp={1}>
        {when}
      </Text>
    </UnstyledButton>
  );
}

function timeLabel(taken: string, span: TakenSpan, t: TFunction): string {
  const offset = offsetFromSpan(taken, span);
  if (offset.side === "during") return t("locationpicker.nearby_during");
  const time = formatAmount(offset);
  return offset.side === "before"
    ? t("locationpicker.nearby_before", { time })
    : t("locationpicker.nearby_after", { time });
}
