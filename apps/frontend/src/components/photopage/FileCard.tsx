import type { Photo } from "@librephotos/api-client";
import { ActionIcon, Anchor, Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconDownload, IconExternalLink, IconFile } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { formatFileSize } from "../../util/fileSize";
import { BreadcrumbPath } from "../common/BreadcrumbPath";
import { CategoryBadge } from "../lightbox/CategoryBadge";
import { StackSection } from "../lightbox/StackSection";
import { getVariantBadgeProps } from "../lightbox/VersionComponent";
import { PhotoCard } from "./PhotoCard";
import classes from "./PhotoPage.module.css";
import { fileNameOf, folderOf, megapixels } from "./photoPageText";

/** "6240 × 4160 · 26 MP · 8.4 MB", leaving out what the photo does not have. */
function fileFacts(photo: Photo): string {
  const facts: string[] = [];
  if (photo.width && photo.height) facts.push(`${photo.width} × ${photo.height}`);
  const mp = megapixels(photo.width, photo.height);
  if (mp) facts.push(`${mp} MP`);
  if (photo.size) facts.push(formatFileSize(photo.size));
  return facts.join(" · ");
}

/** A label above a group of rows in the card. */
function Label({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Text size="xs" c="dimmed" fw={500}>
      {children}
    </Text>
  );
}

/** The other files of the photo (RAW, the video of a Live Photo, a sidecar), each to open or download. */
function OtherFormats({ photo }: Readonly<{ photo: Photo }>) {
  const { t } = useTranslation();
  const variants = (photo.file_variants ?? []).filter(variant => !variant.is_main);
  if (variants.length === 0) return null;
  return (
    <Stack gap={4}>
      <Label>{t("photopage.file.formats")}</Label>
      {variants.map(variant => {
        const { color, label } = getVariantBadgeProps(variant);
        const name = variant.filename || fileNameOf(variant.path);
        return (
          <Group key={variant.hash} gap="xs" wrap="nowrap">
            <Badge size="xs" color={color} variant="light" className={classes.formatBadge}>
              {label}
            </Badge>
            <Anchor href={mediaUrl.photo(variant.hash)} target="_blank" size="sm" truncate className={classes.grow}>
              {name}
            </Anchor>
            <Tooltip label={t("photopage.file.downloadfile", { name })}>
              <ActionIcon
                component="a"
                href={mediaUrl.photo(variant.hash)}
                download={name}
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t("photopage.file.downloadfile", { name })}
              >
                <IconDownload size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        );
      })}
    </Stack>
  );
}

/**
 * The file behind the photo: its name (opens the original), size, category,
 * other formats, the folder below the library root, copies and stacks.
 */
export function FileCard({ photo }: Readonly<{ photo: Photo }>) {
  const { t } = useTranslation();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const navigate = useNavigate();
  // A photo of the stack opens on its own page (by hash: the page's address takes one).
  const openStackPhoto = (photoId: string) => {
    const member = photo.stacks?.flatMap(stack => stack.photos).find(stackPhoto => stackPhoto.id === photoId);
    if (member) void navigate({ to: "/photo/$id", params: { id: member.image_hash } });
  };
  const [mainPath, ...otherPaths] = photo.image_path;
  // Extra paths that are not file variants are copies of the same file.
  const variantPaths = new Set((photo.file_variants ?? []).map(variant => variant.path));
  const duplicates = otherPaths.filter(path => !variantPaths.has(path));

  return (
    <PhotoCard
      icon={IconFile}
      color="grape"
      title={t("photopage.file.title")}
      aside={<CategoryBadge key={photo.image_hash} photoDetail={photo} />}
    >
      <Stack gap="sm">
        <div>
          <Anchor
            href={mediaUrl.photo(photo.image_hash)}
            target="_blank"
            size="sm"
            fw={600}
            className={classes.fileName}
          >
            {mainPath !== undefined ? fileNameOf(mainPath) : t("photopage.unknownfilename")}
            <IconExternalLink size={14} aria-hidden className={classes.inlineIcon} />
          </Anchor>
          <Text size="xs" c="dimmed">
            {fileFacts(photo)}
          </Text>
        </div>
        <OtherFormats photo={photo} />
        {mainPath !== undefined && (
          <Stack gap={4}>
            <Label>{t("photopage.file.folder")}</Label>
            <BreadcrumbPath fullPath={folderOf(mainPath)} basePath={user?.scan_directory} size="sm" />
          </Stack>
        )}
        {duplicates.length > 0 && (
          <Stack gap={4}>
            <Label>{t("exif.duplicates")}</Label>
            {duplicates.map(path => (
              <BreadcrumbPath key={path} fullPath={folderOf(path)} basePath={user?.scan_directory} />
            ))}
            <Text size="xs" c="dimmed">
              {t("exif.duplicatesManaged")}
            </Text>
          </Stack>
        )}
        <StackSection photoDetail={photo} onPhotoSelect={openStackPhoto} />
      </Stack>
    </PhotoCard>
  );
}
