import { ActionIcon, Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import { DatePicker, TimeInput } from "@mantine/dates";
// only needs to be imported once
import {
  IconArrowBackUp as ArrowBackUp,
  IconCalendar as Calendar,
  IconCheck as Check,
  IconEdit as Edit,
  IconX as X,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import "react-virtualized/styles.css";

import { editPhoto } from "../../actions/photosActions";
import { i18nResolvedLanguage } from "../../i18n";
import { useAppDispatch } from "../../store/store";

type Props = Readonly<{
  photoDetail: any;
  isPublic: boolean;
}>;

export function TimestampItem({ photoDetail, isPublic }: Props) {
  const [timestamp, setTimestamp] = useState(
    photoDetail.exif_timestamp === null ? null : new Date(photoDetail.exif_timestamp)
  );

  // savedTimestamp is used to cancel timestamp modification
  const [savedTimestamp, setSavedTimestamp] = useState(timestamp);
  const [previousSavedTimestamp, setPreviousSavedTimestamp] = useState(timestamp);
  const [editMode, setEditMode] = useState(false);

  const { t } = useTranslation();
  const lang = i18nResolvedLanguage();
  import(
    /* @vite-ignore */
    `dayjs/locale/${lang}.js`
  );

  const dispatch = useAppDispatch();

  const onChangeDate = (date: Date) => {
    if (date && timestamp) {
      date.setHours(timestamp.getHours());
      date.setMinutes(timestamp.getMinutes());
      date.setSeconds(timestamp.getSeconds());
    }
    setTimestamp(date);
  };

  const onChangeTime = (date: Date) => {
    if (date && timestamp) {
      date.setDate(timestamp.getDate());
      date.setMonth(timestamp.getMonth());
      date.setFullYear(timestamp.getFullYear());
    }
    setTimestamp(date);
  };

  const onSaveDateTime = () => {
    // To-Do: Use the user defined timezone
    const differentJson = { exif_timestamp: timestamp === null ? null : timestamp.toISOString() };
    dispatch(editPhoto(photoDetail.image_hash, differentJson));
    setEditMode(false);
  };

  const onCancelDateTime = () => {
    setTimestamp(savedTimestamp);
    setSavedTimestamp(previousSavedTimestamp);
    setEditMode(false);
  };

  const getDateTimeLabel = () => {
    if (!photoDetail.exif_timestamp) return t("lightbox.sidebar.withouttimestamp");

    const photoDateTime = DateTime.fromISO(photoDetail.exif_timestamp);
    if (photoDateTime.isValid) {
      const date = DateTime.fromISO(photoDetail.exif_timestamp).setLocale(lang).toLocaleString(DateTime.DATE_MED);
      const dayOfWeek = DateTime.fromISO(photoDetail.exif_timestamp).setLocale(lang).toFormat("cccc");
      const time = DateTime.fromISO(photoDetail.exif_timestamp).setLocale(lang).toLocaleString(DateTime.TIME_SIMPLE);
      return (
        <div>
          {date}{" "}
          <Text size="xs" color="dimmed">
            {dayOfWeek}, {time}
          </Text>
        </div>
      );
    }
    return "lightbox.sidebar.invalidtimestamp";
  };

  const onActivateEditMode = () => {
    setPreviousSavedTimestamp(savedTimestamp);
    setSavedTimestamp(timestamp);
    setEditMode(true);
  };

  const onUndoChangedTimestamp = () => {
    const differentJson = { exif_timestamp: savedTimestamp === null ? null : savedTimestamp.toISOString() };
    dispatch(editPhoto(photoDetail.image_hash, differentJson));
    setTimestamp(savedTimestamp);
  };

  return (
    <Group>
      {/* To-Do: Handle click on calender */}
      {editMode && (
        <Stack>
          <Group>
            <Calendar />
            <Text>{t("lightbox.sidebar.editdatetime")}</Text>
          </Group>
          <Stack>
            <DatePicker locale={lang} value={timestamp} onChange={onChangeDate} />

            <TimeInput
              withSeconds
              value={timestamp?.toString()}
              onChange={event => onChangeTime(new Date(event.target.value))}
            />
            <Group position="center">
              <Tooltip label={t("lightbox.sidebar.cancel")}>
                <ActionIcon variant="light" onClick={onCancelDateTime} color="red">
                  <X />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("lightbox.sidebar.submit")}>
                <ActionIcon variant="light" color="green" onClick={onSaveDateTime}>
                  <Check />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Stack>
        </Stack>
      )}
      {!editMode && (
        <Group>
          <Calendar />
          <Button
            color="dark"
            variant="subtle"
            onClick={() => {
              if (isPublic) {
                return;
              }
              onActivateEditMode();
            }}
            rightIcon={!isPublic && <Edit size={17} />}
          >
            {getDateTimeLabel()}
          </Button>
          {savedTimestamp !== timestamp && (
            <Tooltip label={t("lightbox.sidebar.undotimestampmodification")}>
              <ActionIcon onClick={onUndoChangedTimestamp} color="dark">
                <ArrowBackUp size={17} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      )}
      {
        // To-Do: Show timezone of image
      }
    </Group>
  );
}
