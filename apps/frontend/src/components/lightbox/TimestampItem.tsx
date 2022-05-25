import { ActionIcon, Button, Group, Stack, Title } from "@mantine/core";
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
    console.log(timestamp.toISOString());
    photoDetail.exif_timestamp = timestamp.toISOString();
    const differentJson = { exif_timestamp: photoDetail.exif_timestamp };
    props.dispatch(editPhoto(props.photoDetail.image_hash, differentJson));
    setEditMode(false);
  };

  return (
    <Stack>
      <Group>
        <Calendar />
        <Title order={4}>{t("lightbox.sidebar.timetaken")}</Title>
      </Group>
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
        <Button
          compact
          color="dark"
          variant="subtle"
          onClick={() => setEditMode(!editMode)}
          rightIcon={<Edit />}
          size="sm"
        >
          {moment.utc(props.photoDetail.exif_timestamp).format("dddd, MMMM Do YYYY, h:mm a")}
        </Button>
      )}
    </Stack>
  );
}
