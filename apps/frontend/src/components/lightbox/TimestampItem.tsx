import React, { useState, useEffect } from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import { Input, Item, Icon } from "semantic-ui-react";

import { editPhoto } from "../../actions/photosActions";
import * as moment from "moment";

import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";

type Props = {
  photoDetail: any;
  dispatch: any;
};

export const TimestampItem = (props: Props) => {
  const [timestamp, setTimestamp] = useState("");
  const [editMode, setEditMode] = useState(false);

  const { t } = useTranslation();

  useEffect(() => {
    setTimestamp(DateTime.fromISO(props.photoDetail.exif_timestamp).toISODate());
  }, []);

  const onChange = (e: any, data: any) => {
    var value = data.value;
    setTimestamp(DateTime.fromISO(value).toISODate());
  };

  const onSubmit = (e: any) => {
    // To-Do: Use the user defined timezone
    var photoDetail = props.photoDetail;
    console.log(DateTime.fromISO(timestamp).toISO());
    photoDetail.exif_timestamp = DateTime.fromISO(timestamp, { zone: "utc" }).toISO();
    var differentJson = { exif_timestamp: photoDetail.exif_timestamp };
    props.dispatch(editPhoto(props.photoDetail.image_hash, differentJson));
    setEditMode(false);
  };

  return (
    <Item>
      <Item.Content verticalAlign="middle">
        <Item.Header>
          <Icon name="calendar" /> {t("lightbox.sidebar.timetaken")}
        </Item.Header>
        {/* To-Do: Handle click on calender */}
        {editMode && (
          <div>
            <Input type="date" value={timestamp} onChange={onChange}></Input>
            <Icon style={{ margin: 5 }} name="save" circular link onClick={onSubmit} />
            <Icon
              style={{ margin: 5 }}
              name="cancel"
              color="red"
              circular
              link
              onClick={() => setEditMode(!editMode)}
            />
          </div>
        )}
        {!editMode && (
          <Item.Description>
            {moment.utc(props.photoDetail.exif_timestamp).format("dddd, MMMM Do YYYY, h:mm a")}{" "}
            <Icon style={{ margin: 5 }} name="edit" circular link onClick={() => setEditMode(!editMode)} />{" "}
          </Item.Description>
        )}
      </Item.Content>
    </Item>
  );
};
