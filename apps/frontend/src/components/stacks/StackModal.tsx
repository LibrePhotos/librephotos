/**
 * Stack Modal Component - Displays details of a photo stack
 */
import type { PhotoStack } from "@librephotos/api-client";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Image,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBolt, IconLayersSubtract, IconMaximize, IconPhoto, IconStack2, IconSun } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetCoverPhotoMutation, useStackQuery } from "../../api_client/stacks";
import { serverAddress } from "../../api_client/urls";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { parsePhotoTimestamp } from "../../util/dateUtils";
import { formatFileSize } from "../../util/fileSize";
import { PLACEHOLDER_IMAGE } from "../../util/placeholderImage";
import { PageLoader } from "../common/PageLoader";
import { StackLightbox } from "./StackLightbox";
import classes from "./StackModal.module.css";

// File variant type
type FileVariant = {
  hash: string;
  path: string;
  type: string;
  is_main: boolean;
  filename: string | null;
};

// Photo type for stack photos
type StackPhoto = {
  id: string;
  image_hash: string;
  thumbnail_url: string | null;
  thumbnail_big_url: string | null;
  is_primary: boolean;
  width: number | null;
  height: number | null;
  size: number;
  file_type: string | null;
  file_path: string | null;
  camera: string | null;
  exif_timestamp: string | null;
  file_variants?: FileVariant[] | null;
};

function formatResolution(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  return `${width} × ${height}`;
}

// Get file extension from path
function getFileExtension(filePath: string | null): string | null {
  if (!filePath) return null;
  const parts = filePath.split(".");
  if (parts.length > 1) {
    return parts[parts.length - 1]?.toUpperCase() ?? null;
  }
  return null;
}

// Map file_type to user-friendly labels (format names stay untranslated)
function getFileTypeLabel(fileType: string, t: TFunction): string | undefined {
  switch (fileType) {
    case "image":
      return "JPEG";
    case "raw":
      return "RAW";
    case "video":
      return t("stacks.filetype.video");
    case "metadata":
      return t("stacks.filetype.metadata");
    case "unknown":
      return t("stacks.filetype.file");
    default:
      return undefined;
  }
}

// Get display label for file type
function getFileTypeDisplay(fileType: string | null, filePath: string | null, t: TFunction): string {
  // First try to get actual extension from file path
  const extension = getFileExtension(filePath);
  if (extension) {
    return extension;
  }
  // Fall back to mapped label, then to file_type itself
  return (fileType && getFileTypeLabel(fileType, t)) || fileType || t("stacks.filetype.file");
}

// Get badge color based on file type
function getFileTypeColor(fileType: string | null, filePath: string | null): string {
  const extension = getFileExtension(filePath)?.toLowerCase();
  // RAW formats
  if (extension && ["cr2", "cr3", "nef", "arw", "orf", "rw2", "dng", "raf", "raw"].includes(extension)) {
    return "orange";
  }
  if (fileType === "raw") return "orange";
  if (fileType === "video") return "green";
  return "gray";
}

function getStackTypeIcon(type: PhotoStack["stack_type"], size = 14) {
  switch (type) {
    case "burst":
      return <IconBolt size={size} />;
    case "bracket":
      return <IconSun size={size} />;
    case "manual":
      return <IconStack2 size={size} />;
    // The legacy RAW + JPEG and Live Photo stacks a photo can still open
    case "live_photo":
    case "raw_jpeg":
      return <IconLayersSubtract size={size} />;
  }
}

function StackPhotoCard({
  photo,
  isCover,
  onSetCover,
  onViewFull,
}: {
  photo: StackPhoto;
  isCover: boolean;
  onSetCover: () => void;
  onViewFull: () => void;
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
      data-cover={isCover || undefined}
    >
      <Card.Section className={classes.photoSection}>
        <Box className={classes.preview}>
          <Image
            src={thumbnailUrl}
            alt={t("stacks.photoalt")}
            fallbackSrc={PLACEHOLDER_IMAGE}
            fit="contain"
            h={200}
            maw="100%"
            mah="100%"
          />
          {isCover && (
            <Badge size="xs" color="blue" pos="absolute" top="4px" left="4px">
              {t("stacks.cover")}
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

        {/* File variants or single file display */}
        {photo.file_variants && photo.file_variants.length > 0 ? (
          <Stack gap={4}>
            {photo.file_variants.map(variant => (
              <Tooltip key={variant.hash} label={variant.path} multiline w={300}>
                <Group gap="xs" wrap="nowrap">
                  <Badge
                    size="xs"
                    variant={variant.is_main ? "filled" : "outline"}
                    color={getFileTypeColor(variant.type, variant.path)}
                  >
                    {getFileTypeDisplay(variant.type, variant.path, t)}
                  </Badge>
                  <Text size="xs" c="dimmed" truncate flex={1}>
                    {variant.filename || variant.path.split("/").pop()}
                  </Text>
                </Group>
              </Tooltip>
            ))}
          </Stack>
        ) : photo.file_path ? (
          <Tooltip label={photo.file_path} multiline w={300}>
            <Group gap="xs" wrap="nowrap">
              <Badge size="xs" variant="outline" color={getFileTypeColor(photo.file_type, photo.file_path)}>
                {getFileTypeDisplay(photo.file_type, photo.file_path, t)}
              </Badge>
              <Text size="xs" c="dimmed" truncate flex={1}>
                {photo.file_path.split("/").pop()}
              </Text>
            </Group>
          </Tooltip>
        ) : null}

        {!isCover && (
          <Button
            variant="outline"
            color="blue"
            leftSection={<IconPhoto size={16} />}
            onClick={onSetCover}
            fullWidth
            size="sm"
            mt="auto"
          >
            {t("stacks.setprimary")}
          </Button>
        )}
      </Stack>
    </Card>
  );
}

type StackModalProps = {
  stackId: string;
  opened: boolean;
  onClose: () => void;
};

export function StackModal({ stackId, opened, onClose }: StackModalProps) {
  const { t } = useTranslation();
  const [lightboxImageHash, setLightboxImageHash] = useState<string | null>(null);
  const [lightboxOpened, { open: openLightbox, close: closeLightbox }] = useDisclosure(false);

  const { data: stack, isLoading } = useStackQuery(stackId);
  const { mutate: setCoverPhoto } = useSetCoverPhotoMutation();

  const handleViewFull = (photo: StackPhoto) => {
    setLightboxImageHash(photo.image_hash);
    openLightbox();
  };

  const handleSetCover = (photoHash: string) => {
    setCoverPhoto({ stackId, photoHash });
  };

  return (
    <>
      {lightboxOpened && lightboxImageHash && stack?.photos && (
        <StackLightbox
          photos={stack.photos}
          initialPhotoHash={lightboxImageHash}
          onClose={closeLightbox}
          isPublic={false}
        />
      )}
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          // A span, not a Group (a div): Mantine's title is an <h2>, which takes phrasing
          // content only. The 18px icon matches the theme's title text.
          <Box component="span" className={classes.title}>
            {stack && getStackTypeIcon(stack.stack_type, 18)}
            {/* Translated label rather than the server's English stack_type_display. Plain
                text, styled by the app's Modal theme. */}
            {stack ? t(`stacks.typelabel.${stack.stack_type}`) : t("stacks.view")}
          </Box>
        }
        size="90%"
        centered
        scrollAreaComponent={ScrollArea.Autosize}
      >
        {isLoading ? (
          <PageLoader label={t("stacks.loading")} />
        ) : stack ? (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t(`stacks.typedescriptions.${stack.stack_type}`)}
            </Text>

            <Text size="sm" c="dimmed">
              {t("stacks.coverInfo")}
            </Text>

            <ScrollArea.Autosize mah={600} type="auto">
              <SimpleGrid cols={{ base: 1, sm: 2, md: stack.photos.length > 2 ? 3 : 2 }} spacing="md" p="xs">
                {stack.photos.map((photo: StackPhoto) => (
                  <StackPhotoCard
                    key={photo.id}
                    photo={photo}
                    isCover={photo.is_primary}
                    onSetCover={() => handleSetCover(photo.image_hash)}
                    onViewFull={() => handleViewFull(photo)}
                  />
                ))}
              </SimpleGrid>
            </ScrollArea.Autosize>

            <Group justify="flex-end">
              <Button variant="outline" onClick={onClose}>
                {t("close")}
              </Button>
            </Group>
          </Stack>
        ) : (
          <Text c="red">{t("stacks.error")}</Text>
        )}
      </Modal>
    </>
  );
}
