import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconCamera,
  IconDownload,
  IconFile,
  IconFileCheck,
  IconVideo,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import type { FileVariant, FileVariantTypeEnum, Photo } from "../../api_client/photos/types";

interface FileVariantsSectionProps {
  photoDetail: Photo;
}

const fileTypeIcons: Record<FileVariantTypeEnum, React.ReactNode> = {
  image: <IconCamera size={16} />,
  video: <IconVideo size={16} />,
  raw: <IconFile size={16} />,
  metadata: <IconFileCheck size={16} />,
  unknown: <IconFile size={16} />,
};

const fileTypeColors: Record<FileVariantTypeEnum, string> = {
  image: "blue",
  video: "green",
  raw: "orange",
  metadata: "gray",
  unknown: "gray",
};

const fileTypeLabels: Record<FileVariantTypeEnum, string> = {
  image: "JPEG",
  video: "Video",
  raw: "RAW",
  metadata: "Metadata",
  unknown: "File",
};

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function getFileExtension(filename: string | null): string {
  if (!filename) return "";
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "";
}

interface FileVariantCardProps {
  variant: FileVariant;
  imageHash: string;
}

function FileVariantCard({ variant, imageHash }: FileVariantCardProps) {
  const { t } = useTranslation();
  const icon = fileTypeIcons[variant.type];
  const color = fileTypeColors[variant.type];
  const extension = getFileExtension(variant.filename);
  
  const handleDownload = () => {
    // Open download URL in new tab
    window.open(
      `${serverAddress}/api/photos/${imageHash}/file/${variant.hash}`,
      "_blank"
    );
  };

  return (
    <Card withBorder p="xs">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ overflow: "hidden" }}>
          {icon}
          <Stack gap={2} style={{ overflow: "hidden" }}>
            <Group gap="xs">
              <Badge size="xs" color={color} variant="filled">
                {extension || fileTypeLabels[variant.type]}
              </Badge>
              {variant.is_main && (
                <Badge size="xs" color="blue" variant="light">
                  {t("fileVariants.main", "Main")}
                </Badge>
              )}
            </Group>
            <Tooltip label={variant.filename || variant.path}>
              <Text size="xs" c="dimmed" truncate style={{ maxWidth: 200 }}>
                {variant.filename || variant.path.split("/").pop()}
              </Text>
            </Tooltip>
          </Stack>
        </Group>
        
        <Tooltip label={t("fileVariants.download", "Download this variant")}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={handleDownload}
          >
            <IconDownload size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Card>
  );
}

export function FileVariantsSection({ photoDetail }: FileVariantsSectionProps) {
  const { t } = useTranslation();
  const variants = photoDetail.file_variants as FileVariant[] | null | undefined;

  // Check if photo has RAW in stacks (legacy behavior) 
  const hasRawInStack = photoDetail.stacks?.some(
    (stack: { type: string }) => stack.type === "raw_jpeg"
  );

  // If no variants and no RAW in stacks, don't show section
  if ((!variants || variants.length === 0) && !hasRawInStack) {
    return null;
  }

  // Check for RAW files in variants
  const hasRaw = variants?.some(v => v.type === "raw") ?? false;
  const hasVideo = variants?.some(v => v.type === "video") ?? false;

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Title order={5}>{t("fileVariants.title", "File Variants")}</Title>
        {hasRaw && (
          <Badge size="sm" color="orange" variant="light">
            {t("fileVariants.rawAvailable", "RAW")}
          </Badge>
        )}
        {hasVideo && (
          <Badge size="sm" color="green" variant="light">
            {t("fileVariants.livePhoto", "Live Photo")}
          </Badge>
        )}
      </Group>

      {variants && variants.length > 0 ? (
        <>
          <Text size="xs" c="dimmed">
            {t(
              "fileVariants.description",
              "This photo has {{count}} file variants (same capture, different formats)",
              { count: variants.length }
            )}
          </Text>

          <Stack gap="xs">
            {variants.map(variant => (
              <FileVariantCard
                key={variant.hash}
                variant={variant}
                imageHash={photoDetail.image_hash}
              />
            ))}
          </Stack>
        </>
      ) : hasRawInStack ? (
        <Text size="xs" c="dimmed">
          {t(
            "fileVariants.rawInStack",
            "RAW file is in a separate stack. Re-scan your library to merge RAW+JPEG as file variants."
          )}
        </Text>
      ) : null}
    </Stack>
  );
}
