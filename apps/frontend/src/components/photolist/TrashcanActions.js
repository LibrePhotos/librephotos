import React, { Component } from "react";
import { withTranslation } from "react-i18next";
import { connect } from "react-redux";
import "react-virtualized/styles.css";
import { compose } from "redux";
// only needs to be imported once
import { Button, Confirm, Icon } from "semantic-ui-react";

import { finalPhotosDeleted, setPhotosDeleted } from "../../actions/photosActions";

export class TrashcanActions extends Component {
  state = {
    openDeleteDialog: false,
  };

  closeDeleteDialog = () => {
    this.setState({ openDeleteDialog: false });
  };

  render() {
    return (
      <div>
        {this.props.route.location.pathname.startsWith("/deleted") && (
          <Button
            disabled={this.props.selectedItems.length === 0}
            floated="right"
            onClick={() => {
              this.setState({ openDeleteDialog: true });
            }}
          >
            <Icon name="trash" color="red" />
          </Button>
        )}

        {this.props.route.location.pathname.startsWith("/deleted") && (
          <Button
            disabled={this.props.selectedItems.length === 0}
            floated="right"
            onClick={() => {
              this.props.dispatch(
                setPhotosDeleted(
                  this.props.selectedItems.map(i => i.id),
                  false
                )
              );

              this.props.updateSelectionState({
                selectMode: false,
                selectedItems: [],
              });
            }}
          >
            <Icon name="undo" />
          </Button>
        )}
        <Confirm
          open={this.state.openDeleteDialog}
          onCancel={this.closeDeleteDialog}
          onConfirm={() => {
            console.log("delete");

            this.props.dispatch(finalPhotosDeleted(this.props.selectedItems.map(i => i.id)));

            this.props.updateSelectionState({
              selectMode: false,
              selectedItems: [],
            });
            this.setState({ openDeleteDialog: false });
          }}
        />
      </div>
    );
  }
}

TrashcanActions = compose(
  connect(store => ({
    route: store.router,
  })),
  withTranslation()
)(TrashcanActions);
