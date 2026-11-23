import type { DatedPhoto, DateSummary } from "@librephotos/api-client";
import { Box, Group, Table, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { formatPhotoDateTime } from "../../util/dateUtils";
import { MediaThumbnail } from "../common/MediaThumbnail";

type Props = Readonly<{
  summary: DateSummary;
  after: (photo: DatedPhoto) => string | null;
  pending?: string;
}>;

type RowProps = Readonly<{ label: string; photo: DatedPhoto; after: string | null; pending: string }>;

function PreviewRow({ label, photo, after, pending }: RowProps) {
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
      <Table.Td>{formatPhotoDateTime(photo.exif_timestamp)}</Table.Td>
      <Table.Td c={unchanged ? "dimmed" : "brand"}>{after === null ? pending : formatPhotoDateTime(after)}</Table.Td>
    </Table.Tr>
  );
}

export function DateTimePreviewTable({ summary, after, pending = "" }: Props) {
  const { t } = useTranslation();
  const { oldest, newest } = summary;
  if (!oldest) return null;
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
        <PreviewRow label={t("changedatetime.oldest")} photo={oldest} after={after(oldest)} pending={pending} />
        {newest && newest.image_hash !== oldest.image_hash && (
          <PreviewRow label={t("changedatetime.newest")} photo={newest} after={after(newest)} pending={pending} />
        )}
      </Table.Tbody>
    </Table>
  );
}
