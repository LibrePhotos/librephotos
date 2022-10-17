import { ActionIcon, Button, Group, Text } from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "react-virtualized/styles.css";
// only needs to be imported once
import { Calendar, Check, Edit, X } from "tabler-icons-react";
import i18n from "../../i18n";

import { editPhoto } from "../../actions/photosActions";

type Props = {
  photoDetail: any;
  dispatch: any;
};

export function TimestampItem(props: Props) {
  const [timestamp, setTimestamp] = useState(new Date(props.photoDetail.exif_timestamp));
  const [editMode, setEditMode] = useState(false);

  const { t } = useTranslation();

  const onChange = (date: Date) => {
    setTimestamp(date);
  };

  const onSubmit = (e: any) => {
    // To-Do: Use the user defined timezone
    const { photoDetail } = props;

    photoDetail.exif_timestamp = timestamp.toISOString();
    const differentJson = { exif_timestamp: photoDetail.exif_timestamp };
    props.dispatch(editPhoto(props.photoDetail.image_hash, differentJson));
    setEditMode(false);
  };

  return (
    <Group>
      <Calendar />
      {/* To-Do: Handle click on calender */}
      {editMode && (
        <Group>
          <DatePicker value={timestamp} onChange={onChange}></DatePicker>
          <ActionIcon variant="light" color="green" onClick={onSubmit}>
            <Check></Check>
          </ActionIcon>
          <ActionIcon variant="light" onClick={() => setEditMode(!editMode)} color="red">
            <X></X>
          </ActionIcon>
        </Group>
      )}
      {!editMode && (
        <div>
          <Button color="dark" variant="subtle" onClick={() => setEditMode(!editMode)} rightIcon={<Edit />}>
            <div>
              {DateTime.fromISO(props.photoDetail.exif_timestamp).isValid
                ? DateTime.fromISO(props.photoDetail.exif_timestamp).setLocale(i18n.resolvedLanguage.replace("_", "-")).toLocaleString(DateTime.DATE_MED)
                : null}
              <Text size="xs" color="dimmed">
              {DateTime.fromISO(props.photoDetail.exif_timestamp).isValid
                  ? DateTime.fromISO(props.photoDetail.exif_timestamp).setLocale(i18n.resolvedLanguage.replace("_", "-")).toFormat('cccc, ')
                  : null} 
              {DateTime.fromISO(props.photoDetail.exif_timestamp).isValid
                  ? DateTime.fromISO(props.photoDetail.exif_timestamp).setLocale(i18n.resolvedLanguage.replace("_", "-")).toLocaleString(DateTime.TIME_SIMPLE)
                  : null}
              </Text>
            </div>
          </Button>
        </div>
      )}
      {
        // To-Do: Show timezone of image
      }
    </Group>
  );
}
