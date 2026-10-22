import type { UserPlacePreview } from "@librephotos/api-client";
import { Alert, Group, Loader, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { MediaThumbnail } from "../common/MediaThumbnail";

type Props = Readonly<{
  query: Readonly<{ data?: UserPlacePreview; isFetching: boolean; isError: boolean }>;
}>;

const THUMBNAIL_SIZE = 44;

/**
 * What the circle being drawn holds (#1365): how many photos were taken inside it, the newest few,
 * and the user's other places that share some of them (the smaller place shows them).
 */
export function PlacePreview({ query }: Props) {
  const { t } = useTranslation();
  const { data, isFetching, isError } = query;
  return (
    <Stack gap={6}>
      <Group gap="xs" wrap="nowrap" aria-live="polite">
        <Text size="sm" fw={500}>
          {isError && !data
            ? t("yourplaces.preview.failed")
            : data
              ? t("yourplaces.preview.count", { count: data.photo_count })
              : t("yourplaces.preview.counting")}
        </Text>
        {isFetching && <Loader size="xs" />}
      </Group>
      {data && data.cover_photos.length > 0 && (
        <Group gap={4}>
          {data.cover_photos.map(photo => (
            <MediaThumbnail
              key={photo.image_hash}
              imageHash={photo.image_hash}
              video={photo.video}
              size={THUMBNAIL_SIZE}
            />
          ))}
        </Group>
      )}
      {data?.overlaps.map(overlap => (
        <Alert key={overlap.id} color="yellow" variant="light" p="xs" icon={<IconAlertTriangle size={16} />}>
          <Text size="xs">
            {t(overlap.smaller ? "yourplaces.preview.overlapSmaller" : "yourplaces.preview.overlapLarger", {
              count: overlap.photo_count,
              name: overlap.name,
            })}
          </Text>
        </Alert>
      ))}
    </Stack>
  );
}
