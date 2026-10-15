import type { DuplicatePhoto } from "@librephotos/api-client";
import { ActionIcon, Badge, Box, Button, Card, Group, Image, Stack, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconMaximize } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/urls";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { parsePhotoTimestamp } from "../../util/dateUtils";
import { formatFileSize } from "../../util/fileSize";
import { PLACEHOLDER_IMAGE } from "../../util/placeholderImage";
import classes from "./DuplicatesPageContent.module.css";

function formatResolution(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  return `${width} × ${height}`;
}

export function DuplicatePhotoCard({
  photo,
  isSelected,
  onSelect,
  onViewFull,
  showSelectButton = true,
}: {
  photo: DuplicatePhoto;
  isSelected: boolean;
  onSelect: () => void;
  onViewFull: () => void;
  showSelectButton?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const thumbnailUrl = photo.thumbnail_big_url
    ? `${serverAddress}${photo.thumbnail_big_url}`
    : photo.thumbnail_url
      ? `${serverAddress}${photo.thumbnail_url}`
      : undefined;

  return (
    <Card
      shadow="sm"
      padding="sm"
      radius="md"
      withBorder
      className={classes.photoCard}
      data-selected={isSelected || undefined}
    >
      <Card.Section className={classes.photoSection}>
        <Box className={classes.preview}>
          <Image
            src={thumbnailUrl}
            alt={t("duplicates.photoalt")}
            fallbackSrc={PLACEHOLDER_IMAGE}
            fit="contain"
            h={200}
            maw="100%"
            mah="100%"
          />
          {photo.is_kept && (
            <Badge size="xs" color="green" pos="absolute" top="4px" left="4px">
              {t("duplicates.original")}
            </Badge>
          )}
        </Box>
        <ActionIcon
          variant="filled"
          color="dark"
          size="sm"
          pos="absolute"
          top="8px"
          right="8px"
          opacity={0.8}
          aria-label={t("viewfull")}
          onClick={e => {
            e.stopPropagation();
            onViewFull();
          }}
        >
          <IconMaximize size={14} />
        </ActionIcon>
      </Card.Section>

      <Stack gap="xs" mt="sm" flex={1}>
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            {formatResolution(photo.width, photo.height) ?? t("settings.unknown")}
          </Text>
          <Badge color={photo.size > 1024 * 1024 ? "blue" : "gray"} variant="light">
            {formatFileSize(photo.size, locale)}
          </Badge>
        </Group>

        {photo.camera && (
          <Text size="xs" c="dimmed">
            📷 {photo.camera}
          </Text>
        )}

        {photo.exif_timestamp && (
          <Text size="xs" c="dimmed">
            📅 {parsePhotoTimestamp(photo.exif_timestamp).toLocaleString(DateTime.DATE_SHORT)}
          </Text>
        )}

        {photo.file_path && (
          <Tooltip label={photo.file_path} multiline w={300}>
            <Text size="xs" c="dimmed" lineClamp={1}>
              📁 {photo.file_path.split("/").pop()}
            </Text>
          </Tooltip>
        )}

        {photo.file_type && (
          <Badge size="xs" variant="outline" color="gray">
            {photo.file_type}
          </Badge>
        )}

        {showSelectButton && (
          <Button
            variant={isSelected ? "filled" : "outline"}
            color={isSelected ? "blue" : "gray"}
            leftSection={isSelected ? <IconCheck size={16} /> : null}
            onClick={onSelect}
            fullWidth
            size="sm"
            mt="auto"
          >
            {isSelected ? t("duplicates.selected") : t("duplicates.select")}
          </Button>
        )}
      </Stack>
    </Card>
  );
}
