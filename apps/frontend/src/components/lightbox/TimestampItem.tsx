import { ActionIcon, Button, Group, Text } from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import * as moment from "moment";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "react-virtualized/styles.css";
// only needs to be imported once
import { Calendar, Check, Edit, X } from "tabler-icons-react";

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
              {moment.utc(props.photoDetail.exif_timestamp).format("MMMM Do YYYY")}
              <Text size="xs" color="dimmed">
                {moment.utc(props.photoDetail.exif_timestamp).format("dddd, h:mm a")}
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
