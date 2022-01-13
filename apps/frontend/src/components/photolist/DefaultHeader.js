import React, { Component } from "react";
import {
  Button,
  Grid,
  GridColumn,
  GridRow,
  Header,
  Icon,
  Loader,
} from "semantic-ui-react";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { withTranslation } from "react-i18next";
import { connect } from "react-redux";
import { compose } from "redux";
import { ModalScanDirectoryEdit } from "../modals/ModalScanDirectoryEdit";

export class DefaultHeader extends Component {
  state = { modalOpen: false };

  render() {
    if (this.props.loading || this.props.numPhotosetItems < 1) {
      return (
        <div>
          <div style={{ height: 60, paddingTop: 10 }}>
            <Header as="h4">
              <Header.Content>
                {!this.props.loading &&
                this.props.auth.access &&
                this.props.auth.access.is_admin &&
                !this.props.user.scan_directory &&
                this.props.numPhotosetItems < 1 ? (
                  <div>
                    <p>{this.props.t("defaultheader.setup")}</p>
                    <Button
                      color="green"
                      onClick={() => {
                        this.setState({
                          userToEdit: this.props.user,
                          modalOpen: true,
                        });
                      }}
                    >
                      {this.props.t("defaultheader.gettingstarted")}
                    </Button>
                  </div>
                ) : this.props.loading ? (
                  this.props.t("defaultheader.loading")
                ) : (
                  this.props.t("defaultheader.noimages")
                )}
                <Loader inline active={this.props.loading} size="mini" />
              </Header.Content>
            </Header>
          </div>

          {this.props.numPhotosetItems < 1 ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: window.innerHeight - TOP_MENU_HEIGHT - 60,
              }}
            >
              <Header>{this.props.noResultsMessage}</Header>
            </div>
          ) : (
            <div></div>
          )}
          <ModalScanDirectoryEdit
            onRequestClose={() => {
              this.setState({ modalOpen: false });
            }}
            userToEdit={this.state.userToEdit}
            isOpen={this.state.modalOpen}
            updateAndScan={true}
          />
        </div>
      );
    }

    return (
      <Grid columns={2}>
        <GridRow>
          <GridColumn>
            <Header as="h2" style={{ paddingRight: 10 }}>
              <Icon name={this.props.titleIconName} />
              <Header.Content>
                {this.props.title}{" "}
                <Header.Subheader>
                  {this.props.numPhotosetItems != this.props.numPhotos
                    ? this.props.numPhotosetItems +
                      " " +
                      this.props.t("defaultheader.days") +
                      ", "
                    : ""}
                  {this.props.numPhotos} {this.props.t("defaultheader.photos")}
                  {this.props.additionalSubHeader}
                </Header.Subheader>
              </Header.Content>
            </Header>
          </GridColumn>
          <GridColumn>
            <div
              style={{
                textAlign: "right",
                margin: "0 auto",
                padding: 20,
              }}
            >
              <span style={{ paddingLeft: 5, fontSize: 18 }}>
                <b>
                  {this.props.dayHeaderPrefix
                    ? this.props.dayHeaderPrefix + this.props.date
                    : this.props.date}
                </b>
              </span>
            </div>
          </GridColumn>
        </GridRow>
      </Grid>
    );
  }
}

DefaultHeader = compose(
  connect((store) => {
    return {
      auth: store.auth,
      user: store.user.userSelfDetails,
    };
  }),
  withTranslation()
)(DefaultHeader);
