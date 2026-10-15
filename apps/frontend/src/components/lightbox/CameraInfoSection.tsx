import { Group, Text } from "@mantine/core";
import { IconAperture as Aperture, IconCamera as Camera } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import type { CameraPhoto } from "./photoDetails";
import { cameraDetails, cameraRows } from "./photoDetails";

/** One row of the panel: an icon, a bold title and its values on one dimmed line. */
function InfoRow({ icon, title, values }: Readonly<{ icon: React.ReactNode; title: string; values: string[] }>) {
  return (
    <Group justify="flex-start" wrap="nowrap" align="flex-start">
      {icon}
      <div>
        <Text fw={800}>{title}</Text>
        {values.length > 0 && (
          <Text size="xs" c="dimmed">
            {values.join(" · ")}
          </Text>
        )}
      </div>
    </Group>
  );
}

/**
 * The camera row (camera; shutter, ISO, exposure bias) and the lens row (lens;
 * aperture, focal length with its 35 mm equivalent). A row the photo has nothing
 * for is left out. Public albums render it too, with only what the album shares:
 * nothing location-derived belongs here.
 */
export function CameraInfoSection({ photoDetail }: Readonly<{ photoDetail: CameraPhoto }>) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const details = cameraDetails(photoDetail, t, locale);
  const rows = cameraRows(details, t);
  return (
    <>
      {(details.camera || rows.camera.length > 0) && (
        <InfoRow icon={<Camera />} title={details.camera ?? t("photopage.camera.title")} values={rows.camera} />
      )}
      {details.lens && <InfoRow icon={<Aperture />} title={details.lens} values={rows.lens} />}
    </>
  );
}
