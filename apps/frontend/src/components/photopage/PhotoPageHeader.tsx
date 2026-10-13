import type { Photo } from "@librephotos/api-client";
import { Paper } from "@mantine/core";
import { IconMovie, IconPhoto } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { TimestampEditActions, TimestampEditForm } from "../lightbox/TimestampItem";
import { useTimestampEditor } from "../lightbox/useTimestampEditor";
import { PageHeader } from "../PageHeader";
import { photoDate } from "./photoPageText";

type Props = Readonly<{
  photo: Photo;
  /** The date is the owner's to edit; another viewer sees the place by name only, never its coordinates. */
  isOwner: boolean;
}>;

/** Where the photo was taken, as the subtitle names it. */
function placeOf(photo: Photo, isOwner: boolean): string | null {
  if (photo.search_location) return photo.search_location;
  const { exif_gps_lat: lat, exif_gps_lon: lon } = photo;
  // Coordinates the geocoder could not name (#2253), as the place card shows them.
  return isOwner && lat != null && lon != null ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : null;
}

/**
 * The page's h1 is the photo's date, how people name a photo (the file name
 * is in the File card), with the time and place under it. The owner edits
 * the date from its pencil, with the lightbox's date editor.
 */
export function PhotoPageHeader({ photo, isOwner }: Props) {
  const { t } = useTranslation();
  const editor = useTimestampEditor(photo);
  const date = photoDate(photo.exif_timestamp);
  const subtitle = [
    date?.time,
    // It wins over the date rules, so say why the date ignores them (#2254).
    photo.date_set_by_user ? t("lightbox.sidebar.datesetbyuser") : null,
    placeOf(photo, isOwner),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        icon={photo.video ? IconMovie : IconPhoto}
        title={date?.date ?? t("lightbox.sidebar.withouttimestamp")}
        subtitle={subtitle || undefined}
        actions={isOwner && !editor.editMode ? <TimestampEditActions editor={editor} /> : undefined}
      />
      {isOwner && editor.editMode && (
        <Paper withBorder radius="md" p="sm">
          <TimestampEditForm editor={editor} />
        </Paper>
      )}
    </>
  );
}
