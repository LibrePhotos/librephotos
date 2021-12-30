import React from "react";
import { Header } from "semantic-ui-react";
import Modal from "react-modal";
import { SortableItem } from "../settings/SortableItem";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../../hooks";

type Props = {
  isOpen: boolean;
  onRequestClose: () => void;
  addItemFunction: (item: any) => void;
};

export const ModalConfigDatetime = (props: Props) => {
  const user: any = useAppSelector((state) => state.user);
  const auth: any = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();

  //To-Do: use translation
  const { t } = useTranslation();
  const inputRef = React.useRef<HTMLInputElement>();

  //To-Do: Implement getting items from the backend
  const items = [
    {
      id: "4",
      name: "DateTimeOriginal",
      rule_type: "exif",
      exif_tag: "EXIF:DateTimeOriginal",
      transform_tz: 1,
      source_tz: "utc",
      report_tz: "gps_timezonefinder",
    },
    {
      id: "5",
      name: "QuickTime:CreateDate",
      rule_type: "exif",
      exif_tag: "QuickTime:CreateDate",
      transform_tz: 1,
      source_tz: "utc",
      report_tz: "name:Europe/Moscow",
    },
    {
      id: "6",
      name: "Guess Filename",
      rule_type: "filesystem",
      file_property: "mtime",
      transform_tz: 1,
      source_tz: "utc",
      report_tz: "gps_timezonefinder",
    },
  ];

  return (
    <Modal
      ariaHideApp={false}
      isOpen={props.isOpen}
      onRequestClose={() => {
        props.onRequestClose();
      }}
      style={{
        content: {
          top: "12vh",
          left: "8vh",
          right: "8vh",
          height: "65vh",
          display: "flex",
          flexFlow: "column",
          overflow: "hidden",
          padding: 0,
          backgroundColor: "white",
        },
        overlay: {
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          position: "fixed",
          borderRadius: 0,
          border: 0,
          zIndex: 102,
          backgroundColor: "rgba(200,200,200,0.8)",
        },
      }}
    >
      <div style={{ padding: 10 }}>
        <Header>
          <Header.Content>
            Choose a new rule to add
            <Header.Subheader>
              Choose a rule, that will parse the date from a certain field or
              attribute.
            </Header.Subheader>
          </Header.Content>
        </Header>
      </div>
      <div style={{ padding: 10 }}>
        <Header as="h5">Rules:</Header>
      </div>
      <div style={{ padding: 10, overflowY: "auto", height: "100%" }}>
        {items.map((item) => (
          <SortableItem
            key={item.id}
            id={item.id}
            item={item}
            addItem={true}
            addItemFunction={props.addItemFunction}
          ></SortableItem>
        ))}
      </div>
    </Modal>
  );
};

// Complains that position is a string and not a position, but I can't import the position interface. Copy and pasting fixed it
const modalStyles = {
  content: {
    top: "12vh",
    left: "8vh",
    right: "8vh",
    height: "65vh",
    display: "flex",
    flexFlow: "column",
    overflow: "hidden",
    padding: 0,
    backgroundColor: "white",
  },
  overlay: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    position: "fixed",
    borderRadius: 0,
    border: 0,
    zIndex: 102,
    backgroundColor: "rgba(200,200,200,0.8)",
  },
};
