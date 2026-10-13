import type { Photo } from "@librephotos/api-client";
import { ActionIcon, Box, Group, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconArrowBackUp as ArrowBackUp, IconCalendar as Calendar, IconPencil } from "@tabler/icons-react";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdatePhotoMutation } from "../../api_client/photos/hooks";
import { parsePhotoTimestamp } from "../../util/dateUtils";
import { TimestampForm } from "./TimestampForm";

type Props = Readonly<{
  /** Only the hash is always there: a viewer who is not the owner may have no date. */
  photoDetail: Pick<Photo, "image_hash"> & Partial<Pick<Photo, "exif_timestamp" | "date_set_by_user">>;
  isPublic: boolean;
}>;

/** The body that puts a photo's date back as it was before the last change. */
type DateChange = { exif_timestamp: string | null };

export function TimestampItem(props: Props) {
  // The edit state belongs to one photo: remount when the photo changes, or a
  // panel left open while browsing would save (or undo) this photo's date onto
  // the next one.
  return <TimestampEditor key={props.photoDetail.image_hash} {...props} />;
}

function TimestampEditor({ photoDetail, isPublic }: Props) {
  const [editMode, setEditMode] = useState(false);
  // Set once a change is saved: what Undo sends.
  const [undo, setUndo] = useState<DateChange | null>(null);
  const { mutate: updatePhoto, isPending } = useUpdatePhotoMutation();
  const { t } = useTranslation();
  const exifTimestamp = photoDetail.exif_timestamp ?? null;

  // The photo's date as it is now. A date read from the file is not one to put back: the user had
  // set none, so Undo removes the date set since (servers before #2280 do not say, Undo pins it).
  const currentChange = (): DateChange => ({
    exif_timestamp: photoDetail.date_set_by_user === false ? null : exifTimestamp,
  });

  // The query holds the date shown: the editor closes, and Undo appears, once the server took it.
  const save = (data: DateChange) => {
    const before = currentChange();
    updatePhoto(
      { id: photoDetail.image_hash, data },
      {
        onSuccess: () => {
          setUndo(before);
          setEditMode(false);
        },
      }
    );
  };

  const onUndo = () => {
    if (!undo) return;
    updatePhoto({ id: photoDetail.image_hash, data: undo }, { onSuccess: () => setUndo(null) });
  };

  const getDateTimeLabel = () => {
    if (!exifTimestamp) return t("lightbox.sidebar.withouttimestamp");

    const photoDateTime = parsePhotoTimestamp(exifTimestamp);
    if (photoDateTime.isValid) {
      const date = photoDateTime.toLocaleString(DateTime.DATE_MED);
      const dayOfWeek = photoDateTime.toFormat("cccc");
      const time = photoDateTime.toLocaleString(DateTime.TIME_SIMPLE);
      return (
        <div>
          <Text fw={800}>{date}</Text>
          <Text size="xs" c="dimmed">
            {dayOfWeek}, {time}
          </Text>
          {/* It wins over the date rules, so say why the date ignores them (#2254). */}
          {photoDetail.date_set_by_user && (
            <Text size="xs" c="dimmed">
              {t("lightbox.sidebar.datesetbyuser")}
            </Text>
          )}
        </div>
      );
    }
    return t("lightbox.sidebar.invalidtimestamp");
  };

  if (editMode) {
    return (
      <TimestampForm
        exifTimestamp={exifTimestamp}
        canRemove={photoDetail.date_set_by_user === true}
        saving={isPending}
        onSave={exif_timestamp => save({ exif_timestamp })}
        onRemove={() => save({ exif_timestamp: null })}
        onCancel={() => setEditMode(false)}
      />
    );
  }

  return (
    // Laid out like the file and camera rows below (icon, then the text
    // column), with the edit action on the right like every other section.
    <Group justify="space-between" wrap="nowrap" w="100%">
      <Group wrap="nowrap">
        <Calendar />
        {/* Not a button on a public share: there is nothing to activate. */}
        {isPublic ? (
          <Box fz="sm">{getDateTimeLabel()}</Box>
        ) : (
          <UnstyledButton fz="sm" onClick={() => setEditMode(true)}>
            {getDateTimeLabel()}
          </UnstyledButton>
        )}
      </Group>
      {!isPublic && (
        <Group gap="xs" wrap="nowrap">
          {undo && (
            <Tooltip label={t("lightbox.sidebar.undotimestampmodification")}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                loading={isPending}
                aria-label={t("lightbox.sidebar.undotimestampmodification")}
                onClick={onUndo}
              >
                <ArrowBackUp size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={t("lightbox.sidebar.editdatetime")}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={t("lightbox.sidebar.editdatetime")}
              onClick={() => setEditMode(true)}
            >
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      )}
    </Group>
  );
}
