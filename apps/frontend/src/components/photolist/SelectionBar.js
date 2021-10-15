import React, { Component } from "react";
import { Button, Dropdown, Icon, Popup } from "semantic-ui-react";

export class SelectionBar extends Component {
  render() {
    return (
      <div>
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
                active={this.props.selectMode}
                color={this.props.selectMode ? "blue" : "null"}
                onClick={() => {
                  this.props.updateSelectionState({
                    selectMode: !this.props.selectMode,
                  });
                  if (this.props.selectMode) {
                    this.props.updateSelectionState({ selectedItems: [] });
                  }
                }}
                label={{
                  as: "a",
                  basic: true,
                  content: `${this.props.selectedItems.length} selected`,
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
                  this.props.selectedItems.length !== this.props.idx2hash.length
                }
                negative={
                  this.props.selectedItems.length === this.props.idx2hash.length
                }
                onClick={() => {
                  if (
                    this.props.selectedItems.length ===
                    this.props.idx2hash.length
                  ) {
                    this.props.updateSelectionState({
                      selectMode: false,
                      selectedItems: [],
                    });
                  } else {
                    this.props.updateSelectionState({
                      selectMode: true,
                      selectedItems: this.props.idx2hash,
                    });
                  }
                }}
              >
                <Icon
                  name={
                    this.props.selectedItems.length ===
                    this.props.idx2hash.length
                      ? "check circle outline"
                      : "check circle"
                  }
                />
              </Button>
            }
            content={
              this.props.selectedItems.length === this.props.idx2hash.length
                ? "Deselect all"
                : "Select All"
            }
          />
        </Button.Group>
      </div>
    );
  }
}
