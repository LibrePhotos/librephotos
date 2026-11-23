import type { DatedPhoto, DateSummary } from "@librephotos/api-client";
import { Box, Group, Table, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { formatPhotoDateTime, formatPhotoDateTimeToMinute } from "../../util/dateUtils";
import { MediaThumbnail } from "../common/MediaThumbnail";

type Props = Readonly<{
  summary: DateSummary;
  after: (photo: DatedPhoto) => string | null;
  pending?: string;
  withSeconds?: boolean;
}>;

type RowProps = Readonly<{
  label: string;
  photo: DatedPhoto;
  after: string | null;
  pending: string;
  format: (timestamp: string) => string;
}>;

function PreviewRow({ label, photo, after, pending, format }: RowProps) {
  const unchanged = after === null || formatPhotoDateTime(after) === formatPhotoDateTime(photo.exif_timestamp);
  return (
    <Table.Tr>
      <Table.Th scope="row">
        <Group gap="xs" wrap="nowrap">
          <Box visibleFrom="xs">
            <MediaThumbnail imageHash={photo.image_hash} size={28} radius="sm" />
          </Box>
          <Text size="sm">{label}</Text>
        </Group>
      </Table.Th>
      <Table.Td>{format(photo.exif_timestamp)}</Table.Td>
      <Table.Td c={unchanged ? "dimmed" : undefined} fw={unchanged ? undefined : 600}>
        {after === null ? pending : format(after)}
      </Table.Td>
    </Table.Tr>
  );
}

export function DateTimePreviewTable({ summary, after, pending = "", withSeconds = true }: Props) {
  const { t } = useTranslation();
  const { oldest, newest } = summary;
  if (!oldest) return null;
  const format = withSeconds ? formatPhotoDateTime : formatPhotoDateTimeToMinute;
  return (
    <Table withRowBorders={false} verticalSpacing={4} fz="sm" aria-label={t("changedatetime.previewcaption")}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th />
          <Table.Th>{t("changedatetime.now")}</Table.Th>
          <Table.Th>{t("changedatetime.after")}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        <PreviewRow
          label={t("changedatetime.oldest")}
          photo={oldest}
          after={after(oldest)}
          pending={pending}
          format={format}
        />
        {newest && newest.image_hash !== oldest.image_hash && (
          <PreviewRow
            label={t("changedatetime.newest")}
            photo={newest}
            after={after(newest)}
            pending={pending}
            format={format}
          />
        )}
      </Table.Tbody>
    </Table>
  );
}
