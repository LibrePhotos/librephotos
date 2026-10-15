import type { FileVariant, Photo as PhotoType } from "@librephotos/api-client";
import { Anchor, Badge, Collapse, Divider, Group, Stack, Text } from "@mantine/core";
import { IconMovie as Movie, IconPhoto as Photo } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { AllMetadataButton } from "../allmetadata/AllMetadataButton";
import { BreadcrumbPath } from "../common/BreadcrumbPath";
import { fileNameOf, folderOf } from "../photopage/photoPageText";
import { CameraInfoSection } from "./CameraInfoSection";
import { DetailsList } from "./DetailsList";
import { cameraDetails, fileFacts } from "./photoDetails";

// Where the text next to a 24px row icon starts (icon plus the Group's default
// md gap), so the toggles and expanded details line up with the rows above.
const TEXT_COLUMN = "calc(24px + var(--mantine-spacing-md))";

/** The badge colour and label of a file variant's type (JPG, RAW, VIDEO, META). */
export function getVariantBadgeProps(variant: FileVariant): { color: string; label: string } {
  const unknownBadge = { color: "gray", label: "FILE" };
  const typeMap: Record<string, { color: string; label: string }> = {
    image: { color: "blue", label: "JPG" },
    raw: { color: "gray", label: "RAW" },
    video: { color: "grape", label: "VIDEO" },
    metadata: { color: "gray", label: "META" },
    unknown: unknownBadge,
  };
  return typeMap[variant.type] || unknownBadge;
}

/**
 * Basic photo information (filename, dimensions, file size)
 * Includes file variants with a dedicated toggle
 */
function PhotoInfoSection({
  photoDetail,
  isPublic,
  category,
  t,
}: {
  photoDetail: PhotoType;
  isPublic: boolean;
  category: React.ReactNode;
  t: TFunction;
}) {
  const [showVariants, setShowVariants] = useState(false);
  const locale = useFormatLocale();
  const fileVariants = photoDetail.file_variants || [];
  const nonMainVariants = fileVariants.filter(v => !v.is_main);
  const hasVariants = nonMainVariants.length > 0;
  const firstImagePath = photoDetail.image_path?.[0];

  return (
    // Full width, so the category badge lines up with the edit icons of the
    // rows around it.
    <Stack gap="xs" w="100%">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group justify="flex-start" wrap="nowrap">
          {photoDetail.video ? <Movie /> : <Photo />}
          <div>
            <Anchor href={mediaUrl.photo(photoDetail.image_hash)} target="_blank">
              <Text fw={800} lineClamp={1} style={{ maxWidth: 225 }}>
                {firstImagePath !== undefined ? fileNameOf(firstImagePath) : t("exif.unknownFilename")}
              </Text>
            </Anchor>
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                {fileFacts(photoDetail, locale).join(" · ")}
              </Text>
              {hasVariants && (
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  c="blue"
                  onClick={() => setShowVariants(!showVariants)}
                  style={{ cursor: "pointer" }}
                >
                  {showVariants ? t("exif.hideFormats") : t("exif.showFormats", { count: nonMainVariants.length })}
                </Anchor>
              )}
              {/* The owner's only, as the editors are (#2277). */}
              {!isPublic && <AllMetadataButton photo={photoDetail} variant="link" />}
            </Group>
          </div>
        </Group>
        {category}
      </Group>

      {/* File variants shown when toggled */}
      {hasVariants && (
        <Collapse expanded={showVariants}>
          <Stack gap={4} ml={TEXT_COLUMN} mt="xs">
            {nonMainVariants.map(variant => {
              const { color, label } = getVariantBadgeProps(variant);
              return (
                <Group key={variant.hash} gap="xs">
                  <Badge size="xs" color={color} variant="filled">
                    {label}
                  </Badge>
                  <Anchor href={mediaUrl.photo(variant.hash)} target="_blank" size="xs" c="dimmed">
                    {variant.filename || fileNameOf(variant.path)}
                  </Anchor>
                </Group>
              );
            })}
          </Stack>
        </Collapse>
      )}
    </Stack>
  );
}

/**
 * The folder (the owner's only) and the labelled rest of the camera's settings,
 * shown under "Show more".
 */
function AdditionalInfoSection({
  folder,
  rows,
  t,
}: {
  folder: string | null;
  rows: React.ComponentProps<typeof DetailsList>["rows"];
  t: TFunction;
}) {
  return (
    <Stack gap="xs">
      <DetailsList rows={rows} />
      {folder !== null && (
        <Group>
          <Text size="xs" c="dimmed">
            {t("exif.filepath")}
          </Text>
          <BreadcrumbPath fullPath={folder} />
        </Group>
      )}
    </Stack>
  );
}

/**
 * Displays duplicate files (multiple files attached to same photo)
 * Note: Duplicate management is now handled through the Duplicates page
 */
function DuplicatesSection({ duplicates, t }: { duplicates: string[]; t: TFunction }) {
  if (duplicates.length === 0) return null;

  return (
    <>
      <Text fw={800}>{t("exif.duplicates")}</Text>
      <Text size="sm" c="dimmed" mb="xs">
        {t("exif.duplicatesManaged")}
      </Text>
      {duplicates.map(element => (
        <Stack key={element}>
          <Group>
            <Text size="xs" c="dimmed">
              {t("exif.filepath")}
            </Text>
            <BreadcrumbPath fullPath={folderOf(element)} />
          </Group>
          <Divider my="sm" />
        </Stack>
      ))}
    </>
  );
}

export function VersionComponent(
  props: Readonly<{
    photoDetail: PhotoType;
    isPublic: boolean;
    /** Shown at the end of the file name row: the owner's category badge. */
    category?: React.ReactNode;
  }>
) {
  const { photoDetail, isPublic, category } = props;

  const [showMore, setShowMore] = useState(false);
  const { t } = useTranslation();

  // File variants are the same capture in another format; any other extra path
  // is a copy of the file.
  const fileVariantPaths = new Set((photoDetail.file_variants || []).map(v => v.path));
  const duplicates = photoDetail.image_path.slice(1).filter(path => !fileVariantPaths.has(path));
  const firstImagePath = photoDetail.image_path[0];
  const folder = !isPublic && firstImagePath !== undefined ? folderOf(firstImagePath) : null;
  const locale = useFormatLocale();
  const moreRows = cameraDetails(photoDetail, t, locale).more;
  // No toggle that would open on nothing.
  const hasMore = folder !== null || moreRows.length > 0 || duplicates.length > 0;

  return (
    <div>
      <Stack align="flex-start">
        <PhotoInfoSection photoDetail={photoDetail} isPublic={isPublic} category={category} t={t} />
        <CameraInfoSection photoDetail={photoDetail} />
        {hasMore && (
          <>
            <Collapse expanded={showMore}>
              <Stack ml={TEXT_COLUMN}>
                <AdditionalInfoSection folder={folder} rows={moreRows} t={t} />
                {duplicates.length > 0 && <DuplicatesSection duplicates={duplicates} t={t} />}
              </Stack>
            </Collapse>
            <Anchor
              component="button"
              type="button"
              size="xs"
              ml={TEXT_COLUMN}
              aria-expanded={showMore}
              onClick={() => setShowMore(!showMore)}
            >
              {showMore ? t("exif.showless") : t("exif.showmore")}
            </Anchor>
          </>
        )}
      </Stack>
    </div>
  );
}
