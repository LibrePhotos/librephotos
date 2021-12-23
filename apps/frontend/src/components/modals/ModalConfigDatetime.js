import React, { Component } from "react";
import { compose } from "redux";
import { Header, Input, Button } from "semantic-ui-react";
import { connect } from "react-redux";
import Modal from "react-modal";
import { SortableItem } from "../settings/SortableItem";
import { withTranslation } from "react-i18next";

export class ModalConfigDatetime extends Component {
  constructor(props) {
    super(props);
    this.state = {
      rules: [],
    };
    this.nodeClicked = this.nodeClicked.bind(this);
    this.inputRef = React.createRef();
  }

  items = [
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

  componentDidMount() {}

  nodeClicked(event, rowInfo) {
    console.log(rowInfo);
    this.inputRef.current.value = rowInfo.node.absolute_path;
    this.setState({ newScanDirectory: rowInfo.node.absolute_path });
  }

  render() {
    return (
      <Modal
        ariaHideApp={false}
        isOpen={this.props.isOpen}
        onRequestClose={() => {
          this.props.onRequestClose();
          this.setState({ newScanDirectory: "", newConfidence: "" });
        }}
        style={modalStyles}
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
          {this.items.map((item) => (
            <SortableItem
              key={item.id}
              id={item.id}
              item={item}
              addItem={true}
              addItemFunction={this.props.addItemFunction}
            ></SortableItem>
          ))}
        </div>
      </Modal>
    );
  }
}

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

ModalConfigDatetime = compose(
  connect((store) => {
    return {
      auth: store.auth,
      user: store.user.userSelfDetails,
    };
  }),
  withTranslation()
)(ModalConfigDatetime);
