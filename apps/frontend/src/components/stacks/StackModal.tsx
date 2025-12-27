/**
 * Stack Modal Component - Displays details of a photo stack
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Image,
  Loader,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBolt,
  IconCamera,
  IconLayersSubtract,
  IconMaximize,
  IconPhoto,
  IconStack2,
  IconSun,
  IconVideo,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import { useSetCoverPhotoMutation, useStackQuery } from "../../api_client/stacks";
import type { StackType } from "../../api_client/stacks/types";
import { Lightbox } from "../lightbox";

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
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

function formatResolution(width: number | null, height: number | null): string {
  if (!width || !height) return "Unknown";
  return `${width} × ${height}`;
}

function getStackTypeIcon(type: StackType) {
  switch (type) {
    case "raw_jpeg":
      return <IconCamera size={14} />;
    case "burst":
      return <IconBolt size={14} />;
    case "bracket":
      return <IconSun size={14} />;
    case "live_photo":
      return <IconVideo size={14} />;
    case "manual":
      return <IconStack2 size={14} />;
    default:
      return <IconLayersSubtract size={14} />;
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
      style={{
        borderColor: isCover ? "var(--mantine-color-blue-5)" : undefined,
        borderWidth: isCover ? 2 : 1,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Card.Section style={{ position: "relative", flexShrink: 0 }}>
        <Box
          style={{
            position: "relative",
            width: "100%",
            height: 200,
            overflow: "hidden",
            backgroundColor: "var(--mantine-color-dark-6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image
            src={thumbnailUrl}
            alt="Stack photo"
            fallbackSrc="https://placehold.co/200x200?text=No+Preview"
            fit="contain"
            h={200}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
            }}
          />
          {isCover && (
            <Badge size="xs" color="blue" style={{ position: "absolute", top: 4, left: 4 }}>
              Cover
            </Badge>
          )}
        </Box>
        <ActionIcon
          variant="filled"
          color="dark"
          size="sm"
          style={{ position: "absolute", top: 8, right: 8, opacity: 0.8 }}
          onClick={e => {
            e.stopPropagation();
            onViewFull();
          }}
        >
          <IconMaximize size={14} />
        </ActionIcon>
      </Card.Section>

      <Stack gap="xs" mt="sm" style={{ flex: 1 }}>
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            {formatResolution(photo.width, photo.height)}
          </Text>
          <Badge color={photo.size > 1024 * 1024 ? "blue" : "gray"} variant="light">
            {formatFileSize(photo.size)}
          </Badge>
        </Group>

        {photo.camera && (
          <Text size="xs" c="dimmed">
            📷 {photo.camera}
          </Text>
        )}

        {photo.exif_timestamp && (
          <Text size="xs" c="dimmed">
            📅 {new Date(photo.exif_timestamp).toLocaleDateString()}
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
            {t("stacks.setCover", "Set as Cover")}
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

  // Create idx2hash array for the Lightbox component
  const idx2hash = React.useMemo(() => {
    if (!stack?.photos || stack.photos.length === 0) return [];
    return stack.photos.map((p: StackPhoto) => ({ id: p.id, image_hash: p.image_hash }));
  }, [stack?.photos]);

  const handleViewFull = (photo: StackPhoto) => {
    setLightboxImageHash(photo.image_hash);
    openLightbox();
  };

  const handleSetCover = (photoHash: string) => {
    setCoverPhoto({ stackId, photoHash });
  };

  const getStackDescription = () => {
    if (!stack) return "";
    switch (stack.stack_type) {
      case "raw_jpeg":
        return t("stacks.desc.raw_jpeg", "RAW and JPEG versions of the same shot. Both are preserved.");
      case "burst":
        return t("stacks.desc.burst", "Photos taken in rapid succession (burst mode).");
      case "bracket":
        return t("stacks.desc.bracket", "Exposure bracketed shots for HDR.");
      case "live_photo":
        return t("stacks.desc.live_photo", "Live Photo with embedded video.");
      case "manual":
        return t("stacks.desc.manual", "Photos you grouped manually.");
      default:
        return "";
    }
  };

  return (
    <>
      {lightboxOpened && lightboxImageHash && (
        <Lightbox
          isPublic={false}
          idx2hash={idx2hash}
          selectedImage={lightboxImageHash}
          onCloseRequest={closeLightbox}
          onChangedIndex={() => {}}
        />
      )}
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          <Group>
            {stack && getStackTypeIcon(stack.stack_type)}
            <Title order={4}>{stack?.stack_type_display || t("stacks.view", "View Stack")}</Title>
          </Group>
        }
        size="90%"
        centered
        scrollAreaComponent={ScrollArea.Autosize}
      >
        {isLoading ? (
          <Stack align="center" p="xl">
            <Loader size="lg" />
            <Text>{t("stacks.loading", "Loading stack...")}</Text>
          </Stack>
        ) : stack ? (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {getStackDescription()}
            </Text>

            <Text size="sm" c="dimmed">
              {t(
                "stacks.coverInfo",
                "The cover photo represents this stack in the gallery. Click 'Set as Cover' to change it."
              )}
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
                {t("close", "Close")}
              </Button>
            </Group>
          </Stack>
        ) : (
          <Text c="red">{t("stacks.error", "Failed to load stack")}</Text>
        )}
      </Modal>
    </>
  );
}
