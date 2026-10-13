import type { Photo } from "@librephotos/api-client";
import { SimpleGrid, Stack, Text } from "@mantine/core";
import { IconCamera } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { formatShutterSpeed } from "../../util/shutterSpeed";
import { PhotoCard } from "./PhotoCard";
import classes from "./PhotoPage.module.css";

type CameraPhoto = Pick<
  Photo,
  "camera" | "lens" | "fstop" | "shutter_speed" | "focal_length" | "focalLength35Equivalent" | "iso" | "subjectDistance"
>;

type Cell = { key: string; value: string; label: string; note?: string };

/** The exposure values the photo has, in the order a camera shows them. */
function exposureCells(photo: CameraPhoto, t: TFunction): Cell[] {
  const cells: Cell[] = [];
  if (photo.fstop) cells.push({ key: "aperture", value: `ƒ/${photo.fstop}`, label: t("photopage.camera.aperture") });
  const shutter = formatShutterSpeed(photo.shutter_speed);
  if (shutter) cells.push({ key: "shutter", value: shutter, label: t("photopage.camera.shutter") });
  if (photo.focal_length) {
    cells.push({
      key: "focal",
      value: `${Math.round(photo.focal_length)} mm`,
      label: t("photopage.camera.focallength"),
      note: photo.focalLength35Equivalent
        ? t("photopage.camera.equivalent", { value: Math.round(photo.focalLength35Equivalent) })
        : undefined,
    });
  }
  if (photo.iso) cells.push({ key: "iso", value: String(photo.iso), label: t("photopage.camera.iso") });
  return cells;
}

/** Whether the photo says anything about the camera: no card otherwise. */
export function hasCameraInfo(photo: CameraPhoto): boolean {
  return (
    !!photo.camera || !!photo.fstop || !!formatShutterSpeed(photo.shutter_speed) || !!photo.focal_length || !!photo.iso
  );
}

/** The camera and lens, then the exposure as a row of labelled values. */
export function CameraCard({ photo }: Readonly<{ photo: CameraPhoto }>) {
  const { t } = useTranslation();
  const cells = exposureCells(photo, t);
  return (
    <PhotoCard icon={IconCamera} color="gray" title={t("photopage.camera.title")}>
      <Stack gap="sm">
        {(photo.camera || photo.lens) && (
          <div>
            {photo.camera && (
              <Text size="sm" fw={600}>
                {photo.camera}
              </Text>
            )}
            {photo.lens && (
              <Text size="xs" c="dimmed">
                {photo.lens}
              </Text>
            )}
          </div>
        )}
        {cells.length > 0 && (
          <SimpleGrid cols={{ base: 2, xs: 4 }} spacing="xs">
            {cells.map(cell => (
              <div key={cell.key} className={classes.exposureCell}>
                <Text size="sm" fw={600}>
                  {cell.value}
                </Text>
                <Text size="xs" c="dimmed">
                  {cell.label}
                  {cell.note ? ` · ${cell.note}` : ""}
                </Text>
              </div>
            ))}
          </SimpleGrid>
        )}
        {!!photo.subjectDistance && (
          <Text size="xs" c="dimmed">
            {t("photopage.camera.distance", { value: photo.subjectDistance })}
          </Text>
        )}
      </Stack>
    </PhotoCard>
  );
}
