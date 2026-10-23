import { ActionIcon, Box, Group, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconArrowBackUp as ArrowBackUp, IconCalendar as Calendar, IconPencil } from "@tabler/icons-react";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { formatUtcOffset, parsePhotoTimestamp } from "../../util/dateUtils";
import { TimestampForm } from "./TimestampForm";
import classes from "./TimestampItem.module.css";
import type { TimestampEditor as Editor, TimestampPhoto } from "./useTimestampEditor";
import { useTimestampEditor } from "./useTimestampEditor";

type Props = Readonly<{
  photoDetail: TimestampPhoto;
  isPublic: boolean;
  /** Under the date, in its text column: the owner's "Why this date?" (#2272). */
  extra?: React.ReactNode;
}>;

export function TimestampItem(props: Props) {
  // The edit state belongs to one photo: remount when the photo changes, or a
  // panel left open while browsing would save (or undo) this photo's date onto
  // the next one.
  return <TimestampEditor key={props.photoDetail.image_hash} {...props} />;
}

/** The date editor of `useTimestampEditor`, open while its `editMode` is. */
export function TimestampEditForm({ editor }: Readonly<{ editor: Editor }>) {
  return (
    <TimestampForm
      exifTimestamp={editor.exifTimestamp}
      canRemove={editor.canRemove}
      saving={editor.isPending}
      onSave={editor.save}
      onRemove={editor.remove}
      onCancel={editor.close}
    />
  );
}

/** Undo (after a save) and the pencil that opens the date editor. */
export function TimestampEditActions({ editor }: Readonly<{ editor: Editor }>) {
  const { t } = useTranslation();
  return (
    <Group gap="xs" wrap="nowrap">
      {editor.canUndo && (
        <Tooltip label={t("lightbox.sidebar.undotimestampmodification")}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            loading={editor.isPending}
            aria-label={t("lightbox.sidebar.undotimestampmodification")}
            onClick={editor.onUndo}
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
          onClick={editor.open}
        >
          <IconPencil size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

/**
 * " (UTC-07:00)": the zone the capture time is in, when the date rules know it (#2769). A date set
 * by hand has none.
 */
function UtcOffset({ photo }: Readonly<{ photo: TimestampPhoto }>) {
  const offset = photo.exif_timestamp_offset;
  if (typeof offset !== "number" || photo.date_set_by_user) return null;
  return <span className={classes.offset}> ({formatUtcOffset(offset)})</span>;
}

function TimestampEditor({ photoDetail, isPublic, extra }: Props) {
  const editor = useTimestampEditor(photoDetail);
  const { t } = useTranslation();
  const { exifTimestamp } = editor;

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
            <UtcOffset photo={photoDetail} />
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

  if (editor.editMode) {
    return <TimestampEditForm editor={editor} />;
  }

  return (
    // Laid out like the file and camera rows below (icon, then the text
    // column), with the edit action on the right like every other section.
    <Group justify="space-between" wrap="nowrap" w="100%">
      <Group wrap="nowrap">
        <Calendar />
        {/* Not a button on a public share: there is nothing to activate. */}
        <Stack gap={2} align="flex-start">
          {isPublic ? (
            <Box fz="sm">{getDateTimeLabel()}</Box>
          ) : (
            <UnstyledButton fz="sm" onClick={editor.open}>
              {getDateTimeLabel()}
            </UnstyledButton>
          )}
          {extra}
        </Stack>
      </Group>
      {!isPublic && <TimestampEditActions editor={editor} />}
    </Group>
  );
}
