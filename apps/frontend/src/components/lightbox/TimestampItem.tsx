import { ActionIcon, Box, Group, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { DatePicker, TimeInput } from "@mantine/dates";
import {
  IconArrowBackUp as ArrowBackUp,
  IconCalendar as Calendar,
  IconCheck as Check,
  IconPencil,
  IconX as X,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdatePhotoMutation } from "../../api_client/photos/hooks";
import { Photo } from "../../api_client/photos/types";
import { i18nResolvedLanguage } from "../../i18n";
import {
  parsePhotoTimestamp,
  parsePickerDate,
  photoTimestampToPickerDate,
  pickerDateToPhotoTimestamp,
} from "../../util/dateUtils";

const isValidDate = (date: Date | null): date is Date => date instanceof Date && !Number.isNaN(date.getTime());

type Props = Readonly<{
  /** Only the hash is always there: a viewer who is not the owner may have no date. */
  photoDetail: Pick<Photo, "image_hash"> & Partial<Pick<Photo, "exif_timestamp">>;
  isPublic: boolean;
}>;

export function TimestampItem(props: Props) {
  // The edit state belongs to one photo: remount when the photo changes, or a
  // panel left open while browsing would save (or undo) this photo's date onto
  // the next one.
  return <TimestampEditor key={props.photoDetail.image_hash} {...props} />;
}

function TimestampEditor({ photoDetail, isPublic }: Props) {
  const [timestamp, setTimestamp] = useState(() =>
    photoDetail.exif_timestamp ? photoTimestampToPickerDate(photoDetail.exif_timestamp) : null
  );

  // savedTimestamp is used to cancel timestamp modification
  const [savedTimestamp, setSavedTimestamp] = useState(timestamp);
  const [previousSavedTimestamp, setPreviousSavedTimestamp] = useState(timestamp);
  const [editMode, setEditMode] = useState(false);
  const { mutate: updatePhoto } = useUpdatePhotoMutation();

  const { t } = useTranslation();
  const lang = i18nResolvedLanguage();

  const onChangeDate = (date: Date | string | null) => {
    if (!date) {
      setTimestamp(null);
      return;
    }

    const newDate = parsePickerDate(date);
    if (!newDate) {
      setTimestamp(null);
      return;
    }
    if (timestamp) {
      newDate.setHours(timestamp.getHours());
      newDate.setMinutes(timestamp.getMinutes());
      newDate.setSeconds(timestamp.getSeconds());
    }
    setTimestamp(newDate);
  };

  const onChangeTime = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!timestamp) return;

    const [hours, minutes, seconds] = event.target.value.split(":").map(Number);
    const newDate = new Date(timestamp);
    newDate.setHours(hours || 0);
    newDate.setMinutes(minutes || 0);
    newDate.setSeconds(seconds || 0);
    setTimestamp(newDate);
  };

  const onSaveDateTime = () => {
    // Save sits where the pencil was, so a double-click saves straight away. An
    // unchanged date is a Cancel, not a metadata write and an edit-history entry.
    if (timestamp?.getTime() === savedTimestamp?.getTime()) {
      onCancelDateTime();
      return;
    }
    const differentJson = {
      exif_timestamp: isValidDate(timestamp) ? pickerDateToPhotoTimestamp(timestamp) : null,
    };
    updatePhoto({ id: photoDetail.image_hash, data: differentJson });
    setEditMode(false);
  };

  const onCancelDateTime = () => {
    setTimestamp(savedTimestamp);
    setSavedTimestamp(previousSavedTimestamp);
    setEditMode(false);
  };

  const getDateTimeLabel = () => {
    if (!photoDetail.exif_timestamp) return t("lightbox.sidebar.withouttimestamp");

    const photoDateTime = parsePhotoTimestamp(photoDetail.exif_timestamp).setLocale(lang);
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
        </div>
      );
    }
    return t("lightbox.sidebar.invalidtimestamp");
  };

  const onActivateEditMode = () => {
    setPreviousSavedTimestamp(savedTimestamp);
    setSavedTimestamp(timestamp);
    setEditMode(true);
  };

  const onUndoChangedTimestamp = () => {
    const differentJson = {
      exif_timestamp: isValidDate(savedTimestamp) ? pickerDateToPhotoTimestamp(savedTimestamp) : null,
    };
    updatePhoto({ id: photoDetail.image_hash, data: differentJson });
    setTimestamp(savedTimestamp);
  };

  const formatTimeForInput = (date: Date | string | null) => {
    if (!date) return "";
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
  };

  return (
    <Group>
      {editMode && (
        <Stack w="100%">
          {/* Cancel and save sit where the caption, tags and keywords put them. */}
          <Group justify="space-between" wrap="nowrap">
            <Group wrap="nowrap">
              <Calendar />
              <Text>{t("lightbox.sidebar.editdatetime")}</Text>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Tooltip label={t("lightbox.sidebar.cancel")}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={t("lightbox.sidebar.cancel")}
                  onClick={onCancelDateTime}
                >
                  <X size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("lightbox.sidebar.save")}>
                <ActionIcon
                  variant="subtle"
                  color="blue"
                  size="sm"
                  aria-label={t("lightbox.sidebar.save")}
                  onClick={onSaveDateTime}
                >
                  <Check size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          <Stack>
            {/* The month shown comes only from defaultDate, never from value. */}
            <DatePicker value={timestamp} defaultDate={timestamp ?? undefined} onChange={onChangeDate} />
            <TimeInput
              withSeconds
              value={formatTimeForInput(timestamp)}
              onChange={onChangeTime}
              placeholder="00:00:00"
            />
          </Stack>
        </Stack>
      )}
      {!editMode && (
        // Laid out like the file and camera rows below (icon, then the text
        // column), with the edit action on the right like every other section.
        <Group justify="space-between" wrap="nowrap" w="100%">
          <Group wrap="nowrap">
            <Calendar />
            {/* Not a button on a public share: there is nothing to activate. */}
            {isPublic ? (
              <Box fz="sm">{getDateTimeLabel()}</Box>
            ) : (
              <UnstyledButton fz="sm" onClick={onActivateEditMode}>
                {getDateTimeLabel()}
              </UnstyledButton>
            )}
          </Group>
          {!isPublic && (
            <Group gap="xs" wrap="nowrap">
              {savedTimestamp !== timestamp && (
                <Tooltip label={t("lightbox.sidebar.undotimestampmodification")}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label={t("lightbox.sidebar.undotimestampmodification")}
                    onClick={onUndoChangedTimestamp}
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
                  onClick={onActivateEditMode}
                >
                  <IconPencil size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
        </Group>
      )}
    </Group>
  );
}
