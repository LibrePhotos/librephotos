import { Anchor, Button, Collapse, Divider, Group, Stack, Text } from "@mantine/core";
import { IconCamera as Camera, IconPhoto as Photo } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import { Photo as PhotoType } from "../../api_client/photos/types";
import { BreadcrumbPath } from "../common/BreadcrumbPath";
import { FileInfoComponent } from "./FileInfoComponent";

/**
 * Basic photo information (filename, dimensions, file size)
 */
function PhotoInfoSection({ photoDetail }: { photoDetail: PhotoType }) {
  return (
    <Group justify="apart">
      <Group justify="left">
        <Photo />
        <div>
          <Anchor href={`${serverAddress}/media/photos/${photoDetail.image_hash}`} target="_blank">
            <Text fw={800} lineClamp={1} style={{ maxWidth: 225 }}>
              {photoDetail.image_path && photoDetail.image_path.length > 0
                ? photoDetail.image_path[0].substring(photoDetail.image_path[0].lastIndexOf("/") + 1)
                : "Unknown filename"}
            </Text>
          </Anchor>
          <Group>
            <FileInfoComponent info={`${photoDetail.height} x ${photoDetail.width}`} />
            {Math.round((photoDetail.size / 1024 / 1024) * 100) / 100 < 1 ? (
              <FileInfoComponent info={`${Math.round((photoDetail.size / 1024) * 100) / 100} kB`} />
            ) : (
              <FileInfoComponent info={`${Math.round((photoDetail.size / 1024 / 1024) * 100) / 100} MB`} />
            )}
          </Group>
        </div>
      </Group>
    </Group>
  );
}

/**
 * Camera equipment and settings information
 */
function CameraInfoSection({ photoDetail }: { photoDetail: PhotoType }) {
  if (!photoDetail.camera) return null;

  return (
    <Group justify="apart">
      <Group justify="left">
        <Camera />
        <div>
          <Text fw={800}>{photoDetail.camera?.toString()}</Text>
          <Group gap="xs">
            <FileInfoComponent info={photoDetail.lens?.toString()} />
            <FileInfoComponent info={`${photoDetail.subjectDistance} m`} />
            <FileInfoComponent info={`ƒ / ${photoDetail.fstop}`} />
            <FileInfoComponent info={`${photoDetail.shutter_speed}`} />
            <FileInfoComponent info={`${Math.round(photoDetail.focal_length!)} mm`} />
            <FileInfoComponent info={`ISO${photoDetail.iso?.toString()}`} />
          </Group>
        </div>
      </Group>
    </Group>
  );
}

/**
 * Additional photo metadata shown in expanded view
 */
function AdditionalInfoSection({
  photoDetail,
  isPublic,
  t,
}: {
  photoDetail: PhotoType;
  isPublic: boolean;
  t: (key: string) => string;
}) {
  return (
    <Stack>
      {!isPublic && photoDetail.image_path && photoDetail.image_path.length > 0 && (
        <Group>
          <Text size="xs" c="dimmed">
            {t("exif.filepath")}
          </Text>
          <BreadcrumbPath fullPath={photoDetail.image_path[0].replace(/\\/g, "/").split("/").slice(0, -1).join("/")} />
        </Group>
      )}
      <FileInfoComponent description={t("exif.subjectdistance")} info={`${photoDetail.subjectDistance} m`} />
      <FileInfoComponent description={t("exif.digitalzoomratio")} info={photoDetail.digitalZoomRatio?.toString()} />
      <FileInfoComponent
        description={t("exif.focallengthin35mmfilm")}
        info={`${photoDetail.focalLength35Equivalent} mm`}
      />
    </Stack>
  );
}

/**
 * Displays duplicate files (multiple files attached to same photo)
 * Note: Duplicate management is now handled through the Duplicates page
 */
function DuplicatesSection({ duplicates, t }: { duplicates: string[]; t: (key: string) => string }) {
  if (duplicates.length === 0) return null;

  return (
    <>
      <Text fw={800}>{t("exif.duplicates")}</Text>
      <Text size="sm" c="dimmed" mb="xs">
        {t(
          "exif.duplicates.managed_via_duplicates_page",
          "This photo has multiple file copies. Manage duplicates via the Duplicates page."
        )}
      </Text>
      {duplicates.map(element => (
        <Stack key={element}>
          <Group>
            <Text size="xs" c="dimmed">
              {t("exif.filepath")}
            </Text>
            <BreadcrumbPath fullPath={element.replace(/\\/g, "/").split("/").slice(0, -1).join("/")} />
          </Group>
          <Divider my="sm" />
        </Stack>
      ))}
    </>
  );
}

export function VersionComponent(props: Readonly<{ photoDetail: PhotoType; isPublic: boolean }>) {
  const { photoDetail, isPublic } = props;

  const [showMore, setShowMore] = useState(false);
  const [otherVersions] = useState<PhotoType[]>([]);
  const { t } = useTranslation();

  const duplicates = photoDetail.image_path ? photoDetail.image_path.slice(1) : [];

  return (
    <div>
      <Stack align="left">
        {/* Basic photo information */}
        <PhotoInfoSection photoDetail={photoDetail} />

        {/* Camera equipment and settings */}
        <CameraInfoSection photoDetail={photoDetail} />

        {/* Expanded information section */}
        <Collapse in={showMore}>
          <Stack>
            {/* Additional photo metadata */}
            <AdditionalInfoSection photoDetail={photoDetail} isPublic={isPublic} t={t} />

            {/* Other versions section (placeholder) */}
            {otherVersions.length > 0 && <Text fw={800}>{t("exif.otherversions")}</Text>}

            {/* Duplicates section */}
            <DuplicatesSection duplicates={duplicates} t={t} />
          </Stack>
        </Collapse>

        {/* Show more/less button */}
        <Button onClick={() => setShowMore(!showMore)} variant="subtle" size="compact-xs">
          {showMore ? t("exif.showless") : t("exif.showmore")}
        </Button>
      </Stack>
    </div>
  );
}
