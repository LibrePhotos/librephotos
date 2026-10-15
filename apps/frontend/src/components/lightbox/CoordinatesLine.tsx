import type { MantineSize } from "@mantine/core";
import { ActionIcon, CopyButton, Group, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { coordinatesForClipboard, formatAltitude, formatCoordinates } from "../../util/exifFormat";

type Props = Readonly<{
  lat: number;
  lon: number;
  /** Metres above sea level; absent when the photo has none (or the viewer may not see it). */
  altitude?: number | null;
  /** The coordinates' text size: xs under a place name, larger where they are the label. */
  size?: MantineSize;
}>;

/**
 * The coordinates in the UI language with a button that copies them (always as
 * `37.08990, -8.41280`, which maps and search boxes take), then the altitude.
 * The owner's only: shared and public views never render it (#2276).
 */
export function CoordinatesLine({ lat, lon, altitude, size = "xs" }: Props) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const height = formatAltitude(altitude, locale);
  // No clipboard on plain HTTP: no button that cannot work.
  const canCopy = typeof navigator !== "undefined" && navigator.clipboard !== undefined;
  return (
    <Group gap={4} wrap="wrap" align="center">
      <Text size={size} c="dimmed">
        {formatCoordinates(lat, lon, locale)}
      </Text>
      {canCopy && (
        <CopyButton value={coordinatesForClipboard(lat, lon)}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? t("exif.coordinatescopied") : t("exif.copycoordinates")}>
              <ActionIcon
                variant="subtle"
                color={copied ? "teal" : "gray"}
                size="sm"
                aria-label={t("exif.copycoordinates")}
                onClick={copy}
              >
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      )}
      {height && (
        <Text size="xs" c="dimmed">
          {"· "}
          {t(height.belowSeaLevel ? "exif.belowsealevel" : "exif.abovesealevel", { distance: height.distance })}
        </Text>
      )}
    </Group>
  );
}
