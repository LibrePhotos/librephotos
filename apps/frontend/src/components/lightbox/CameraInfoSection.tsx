import { Group, Text } from "@mantine/core";
import { IconCamera as Camera } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import classes from "./CameraInfoSection.module.css";
import type { CameraPhoto } from "./photoDetails";
import { cameraDetails, exposureChips } from "./photoDetails";
import { ROW_ICON } from "./SectionTitle";

/**
 * The camera row: the camera, the lens under it, and the exposure as a strip of chips (ISO | mm |
 * EV | ƒ | s), as Apple Photos' info shows it. Left out when the photo has none of it. Public albums
 * render it too, with only what the album shares: nothing location-derived belongs here.
 */
export function CameraInfoSection({ photoDetail }: Readonly<{ photoDetail: CameraPhoto }>) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const details = cameraDetails(photoDetail, t, locale);
  const chips = exposureChips(details, t);
  if (!details.camera && !details.lens && chips.length === 0) return null;
  return (
    <Group justify="flex-start" wrap="nowrap" align="flex-start">
      <Camera {...ROW_ICON} />
      <div className={classes.text}>
        <Text size="sm" fw={500}>
          {details.camera ?? t("photopage.camera.title")}
        </Text>
        {details.lens && (
          <Text size="xs" c="dimmed">
            {details.lens}
          </Text>
        )}
        {chips.length > 0 && (
          <ul className={classes.chips}>
            {chips.map(chip => (
              <li key={chip.key} className={classes.chip} title={chip.title}>
                {chip.value}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Group>
  );
}
