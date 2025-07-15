import { ActionIcon, Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import { DatePicker, TimeInput } from "@mantine/dates";
import "@mantine/dates/styles.css";
// only needs to be imported once
import {
  IconArrowBackUp as ArrowBackUp,
  IconCalendar as Calendar,
  IconCheck as Check,
  IconEdit as Edit,
  IconX as X,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import "dayjs/locale/en";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import "react-virtualized/styles.css";

import { useUpdatePhotoMutation } from "../../api_client/photos/hooks";
import { Photo } from "../../api_client/photos/types";
import { i18nResolvedLanguage } from "../../i18n";

const isValidDate = (date: Date | null): date is Date => date instanceof Date && !Number.isNaN(date.getTime());

type Props = Readonly<{
  photoDetail: Partial<Photo>;
  isPublic: boolean;
}>;

export function TimestampItem({ photoDetail, isPublic }: Props) {
  const [timestamp, setTimestamp] = useState(() => {
    if (!photoDetail.exif_timestamp) {
      return null;
    }
    const date = new Date(photoDetail.exif_timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  });

  // savedTimestamp is used to cancel timestamp modification
  const [savedTimestamp, setSavedTimestamp] = useState(timestamp);
  const [previousSavedTimestamp, setPreviousSavedTimestamp] = useState(timestamp);
  const [editMode, setEditMode] = useState(false);
  const { mutate: updatePhoto } = useUpdatePhotoMutation();

  const { t } = useTranslation();
  const lang = i18nResolvedLanguage();
  dayjs.locale(lang);

  const onChangeDate = (date: Date | string | null) => {
    if (!date) {
      setTimestamp(null);
      return;
    }

    const newDate = new Date(date);
    if (timestamp) {
      newDate.setHours(timestamp.getHours());
      newDate.setMinutes(timestamp.getMinutes());
      newDate.setSeconds(timestamp.getSeconds());
    }
    setTimestamp(Number.isNaN(newDate.getTime()) ? null : newDate);
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
    const differentJson = {
      exif_timestamp: isValidDate(timestamp) ? timestamp.toISOString() : null,
    };
    updatePhoto({ id: photoDetail.image_hash!, data: differentJson });
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
      exif_timestamp: isValidDate(savedTimestamp) ? savedTimestamp.toISOString() : null,
    };
    updatePhoto({ id: photoDetail.image_hash!, data: differentJson });
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
          <Group>
            <Calendar />
            <Text>{t("lightbox.sidebar.editdatetime")}</Text>
          </Group>
          <Stack>
            <DatePicker locale={lang} value={timestamp} onChange={onChangeDate} />
            <TimeInput
              withSeconds
              value={formatTimeForInput(timestamp)}
              onChange={onChangeTime}
              placeholder="00:00:00"
            />
            <Group justify="center">
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
            rightSection={!isPublic && <Edit size={17} />}
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
    </Group>
  );
}
