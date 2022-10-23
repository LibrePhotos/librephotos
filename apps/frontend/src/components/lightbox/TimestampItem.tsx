import { ActionIcon, Button, Group, Stack, Text } from "@mantine/core";
import { DatePicker, TimeInput } from "@mantine/dates";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import "react-virtualized/styles.css";
// only needs to be imported once
import { Calendar, Check, Edit, X } from "tabler-icons-react";
import { useAppDispatch } from "../../store/store";
import i18n from "../../i18n";

import { editPhoto } from "../../actions/photosActions";

type Props = {
  photoDetail: any;
};

export function TimestampItem({photoDetail}: Props) {
  const [timestamp, setTimestamp] = useState(new Date(photoDetail.exif_timestamp));
  const [editMode, setEditMode] = useState(false);

  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const onChangeDate = (date: Date) => {
    date.setHours(timestamp.getHours());
    date.setMinutes(timestamp.getMinutes());
    date.setSeconds(timestamp.getSeconds());
    setTimestamp(date);
  };

  const onChangeTime = (date: Date) => {
    date.setDate(timestamp.getDate());
    date.setMonth(timestamp.getMonth());
    date.setFullYear(timestamp.getFullYear());
    setTimestamp(date);
  };


  const onSaveDateTime = (e: any) => {
    // To-Do: Use the user defined timezone
    photoDetail.exif_timestamp = timestamp.toISOString();
    const differentJson = { exif_timestamp: photoDetail.exif_timestamp };
    dispatch(editPhoto(photoDetail.image_hash, differentJson));
    setEditMode(false);
  };

  const onCancelDateTime = (e: any) => {
    setTimestamp(new Date(photoDetail.exif_timestamp));
    setEditMode(false);
  }

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
            <DatePicker locale={i18n.resolvedLanguage.replace("_", "-")} value={timestamp} onChange={onChangeDate}/>
            <TimeInput withSeconds value={timestamp} onChange={onChangeTime}/>
            <Group>
              <ActionIcon variant="light" color="green" onClick={onSaveDateTime}>
                <Check />
              </ActionIcon>
              <ActionIcon variant="light" onClick={onCancelDateTime} color="red">
                <X />
              </ActionIcon>
            </Group>
          </Stack>
        </Stack>
      )}
      {!editMode && (
        <Group>
          <Calendar />
          <Button color="dark" variant="subtle" onClick={() => setEditMode(!editMode)} rightIcon={<Edit />}>
            <div>
              {DateTime.fromISO(photoDetail.exif_timestamp).isValid
                ? DateTime.fromISO(photoDetail.exif_timestamp).setLocale(i18n.resolvedLanguage.replace("_", "-")).toLocaleString(DateTime.DATE_MED)
                : null}
              <Text size="xs" color="dimmed">
              {DateTime.fromISO(photoDetail.exif_timestamp).isValid
                  ? DateTime.fromISO(photoDetail.exif_timestamp).setLocale(i18n.resolvedLanguage.replace("_", "-")).toFormat('cccc, ')
                  : null} 
              {DateTime.fromISO(photoDetail.exif_timestamp).isValid
                  ? DateTime.fromISO(photoDetail.exif_timestamp).setLocale(i18n.resolvedLanguage.replace("_", "-")).toLocaleString(DateTime.TIME_SIMPLE)
                  : null}
              </Text>
            </div>
          </Button>
        </Group>
      )}
      {
        // To-Do: Show timezone of image
      }
    </Group>
  );
}
