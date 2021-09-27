import React from "react";
import { Button, Dropdown, Icon, Popup } from "semantic-ui-react";

import getToolbar from "./Toolbar";

const getSelectionBar = (photoList) => (
  <div
    style={{
      marginLeft: -5,
      paddingLeft: 5,
      paddingRight: 5,
      height: 40,
      paddingTop: 4,
      backgroundColor: "#f6f6f6",
    }}
  >
    <Button.Group
      compact
      floated="left"
      style={{ paddingLeft: 2, paddingRight: 2 }}
    >
      <Popup
        trigger={
          <Button
            icon="checkmark"
            compact
            active={photoList.state.selectMode}
            color={photoList.state.selectMode ? "blue" : "null"}
            onClick={() => {
              photoList.setState({ selectMode: !photoList.state.selectMode });
              if (photoList.state.selectMode) {
                photoList.setState({ selectedItems: [] });
              }
            }}
            label={{
              as: "a",
              basic: true,
              content: `${photoList.state.selectedItems.length} selected`,
            }}
            labelPosition="right"
          />
        }
        content="Toggle select mode"
        inverted
      />
    </Button.Group>

    <Button.Group
      compact
      floated="left"
      style={{ paddingLeft: 2, paddingRight: 2 }}
    >
      <Popup
        inverted
        trigger={
          <Button
            icon
            compact
            positive={
              photoList.state.selectedItems.length !==
              photoList.props.idx2hash.length
            }
            negative={
              photoList.state.selectedItems.length ===
              photoList.props.idx2hash.length
            }
            onClick={() => {
              if (
                photoList.state.selectedItems.length ===
                photoList.props.idx2hash.length
              ) {
                photoList.setState({ selectedItems: [] });
              } else {
                photoList.setState({
                  selectMode: true,
                  selectedItems: photoList.props.idx2hash,
                });
              }
            }}
          >
            <Icon
              name={
                photoList.state.selectedItems.length ===
                photoList.props.idx2hash.length
                  ? "check circle outline"
                  : "check circle"
              }
            />
          </Button>
        }
        content={
          photoList.state.selectedItems.length ===
          photoList.props.idx2hash.length
            ? "Deselect all"
            : "Select All"
        }
      />
    </Button.Group>
    {getToolbar(photoList)}
    <Button.Group
      style={{ paddingLeft: 2, paddingRight: 2 }}
      floated="right"
      compact
      color="teal"
    >
      <Dropdown
        disabled={photoList.state.selectedItems.length === 0}
        pointing="top right"
        icon="plus"
        floating
        button
        compact
        floated="right"
        className="icon"
      >
        <Dropdown.Menu>
          <Dropdown.Header>
            Album ({photoList.state.selectedItems.length} selected)
          </Dropdown.Header>
          <Dropdown.Divider />
          <Dropdown.Item
            onClick={() => {
              if (photoList.state.selectedItems.length > 0) {
                photoList.setState({ modalAddToAlbumOpen: true });
              }
            }}
          >
            <Icon name="bookmark" color="red" />
            {" Album"}
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
    </Button.Group>
  </div>
);

export default getSelectionBar;
