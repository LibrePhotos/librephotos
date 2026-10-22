import { Media, type PigPhoto } from "@librephotos/api-client";
import { Button, CloseButton, Group, Paper, Skeleton, Stack, Text, UnstyledButton } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { usePhotosInBoundsQuery } from "../../api_client/albums/hooks";
import { ErrorState } from "../common/ErrorState";
import { MediaThumbnail } from "../common/MediaThumbnail";
import { useListFailure } from "../common/useListFailure";
import type { MapSpot } from "./mapSpot";
import classes from "./SpotCard.module.css";

type Props = Readonly<{
  spot: MapSpot;
  onClose: () => void;
  /** Open the lightbox over `photos` at `photoId`. */
  onOpen: (photos: PigPhoto[], photoId: string) => void;
}>;

const PREVIEWS = 4;
const THUMBNAIL_SIZE = 56;

/**
 * What a point or a cluster of the Places map opens (#343): how many photos were taken there,
 * the newest few, and the way into the lightbox over all of them. A card in the map's corner
 * rather than a popup at the spot, which a short map would cut off; the spot is ringed instead.
 */
export function SpotCard({ spot, onClose, onOpen }: Props) {
  const { t } = useTranslation();
  const query = usePhotosInBoundsQuery(spot.bounds);
  const failure = useListFailure(query);
  const photos = query.data ?? [];
  const first = photos[0];
  const title = query.data ? t("placealbum.photosHere", { count: photos.length }) : t("loading");

  return (
    <Paper className={classes.card} withBorder shadow="md" p="sm" role="dialog" aria-label={title}>
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text size="sm" fw={600} aria-live="polite">
            {title}
          </Text>
          <CloseButton size="sm" aria-label={t("close")} onClick={onClose} />
        </Group>
        {failure ? (
          <ErrorState failure={failure} compact />
        ) : (
          <Group gap={4} wrap="nowrap">
            {query.data
              ? photos.slice(0, PREVIEWS).map(photo => (
                  <UnstyledButton
                    key={photo.id}
                    className={classes.thumbnail}
                    onClick={() => onOpen(photos, photo.id)}
                    aria-label={t("placealbum.openPhoto")}
                  >
                    <MediaThumbnail
                      imageHash={photo.image_hash}
                      size={THUMBNAIL_SIZE}
                      video={photo.type === Media.VIDEO}
                    />
                  </UnstyledButton>
                ))
              : Array.from({ length: PREVIEWS }, (_, index) => (
                  <Skeleton key={index} w={THUMBNAIL_SIZE} h={THUMBNAIL_SIZE} radius={4} />
                ))}
          </Group>
        )}
        {first && (
          <Button size="xs" onClick={() => onOpen(photos, first.id)}>
            {t("placealbum.openPhotos", { count: photos.length })}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

/** The ring around the spot the card is about. */
export function SpotRing() {
  return <div className={classes.ring} />;
}
