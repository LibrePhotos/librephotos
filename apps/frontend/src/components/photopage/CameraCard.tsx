import { Anchor, Collapse, SimpleGrid, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCamera } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { DetailsList } from "../lightbox/DetailsList";
import type { CameraDetails, CameraPhoto } from "../lightbox/photoDetails";
import { cameraDetails } from "../lightbox/photoDetails";
import { PhotoCard } from "./PhotoCard";
import classes from "./PhotoPage.module.css";

type Cell = { key: string; value: string; label: string; note?: string };

/** The exposure values the photo has, in the order a camera shows them. */
function exposureCells(details: CameraDetails, iso: number | null | undefined, t: TFunction): Cell[] {
  const cells: Cell[] = [];
  if (details.aperture) cells.push({ key: "aperture", value: details.aperture, label: t("photopage.camera.aperture") });
  if (details.shutter) cells.push({ key: "shutter", value: details.shutter, label: t("photopage.camera.shutter") });
  if (details.focalLength) {
    const equivalent = details.focal35 && details.focal35 !== details.focalLength ? details.focal35 : null;
    cells.push({
      key: "focal",
      value: details.focalLength,
      label: t("photopage.camera.focallength"),
      note: equivalent ? t("exif.equivalent", { value: equivalent }) : undefined,
    });
  }
  // The cell's label says ISO; the value is the number alone.
  if (details.iso && iso) cells.push({ key: "iso", value: String(Math.round(iso)), label: t("photopage.camera.iso") });
  return cells;
}

/**
 * The camera and lens, then the exposure as a row of labelled values, the
 * exposure bias, and the rest behind "Show more": the same values, in the same
 * order, as the lightbox's Details panel. No card when the photo says nothing
 * about the camera.
 */
export function CameraCard({ photo }: Readonly<{ photo: CameraPhoto }>) {
  const { t } = useTranslation();
  const [showMore, { toggle }] = useDisclosure(false);
  const locale = useFormatLocale();
  const details = cameraDetails(photo, t, locale);
  const cells = exposureCells(details, photo.iso, t);
  if (!details.camera && !details.lens && cells.length === 0 && !details.bias && details.more.length === 0) {
    return null;
  }
  return (
    <PhotoCard icon={IconCamera} color="gray" title={t("photopage.camera.title")}>
      <Stack gap="sm">
        {(details.camera || details.lens) && (
          <div>
            {details.camera && (
              <Text size="sm" fw={600}>
                {details.camera}
              </Text>
            )}
            {details.lens && (
              <Text size="xs" c="dimmed">
                {details.lens}
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
                </Text>
                {cell.note && (
                  <Text size="xs" c="dimmed">
                    {cell.note}
                  </Text>
                )}
              </div>
            ))}
          </SimpleGrid>
        )}
        {details.bias && (
          <Text size="xs" c="dimmed">
            {t("exif.exposurebias", { value: details.bias })}
          </Text>
        )}
        {details.more.length > 0 && (
          <div>
            <Collapse expanded={showMore}>
              <DetailsList rows={details.more} />
            </Collapse>
            <Anchor component="button" type="button" size="xs" aria-expanded={showMore} onClick={toggle}>
              {showMore ? t("exif.showless") : t("exif.showmore")}
            </Anchor>
          </div>
        )}
      </Stack>
    </PhotoCard>
  );
}
