import React, { Component } from "react";
import { withTranslation } from "react-i18next";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { compose } from "redux";
import { Button, Dropdown, Grid, GridColumn, GridRow, Header, Icon, Loader } from "semantic-ui-react";

import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { ModalScanDirectoryEdit } from "../modals/ModalScanDirectoryEdit";

export class DefaultHeader extends Component {
  state = { modalOpen: false };

  // return true if it is a view with a dropdown
  isDropdownView = () =>
    this.props.route.location.pathname === "/" ||
    this.props.route.location.pathname.startsWith("/hidden") ||
    this.props.route.location.pathname.startsWith("/notimestamp") ||
    this.props.route.location.pathname.startsWith("/recent") ||
    this.props.route.location.pathname.startsWith("/user/");

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
            <div />
          )}
          <ModalScanDirectoryEdit
            onRequestClose={() => {
              this.setState({ modalOpen: false });
            }}
            userToEdit={this.state.userToEdit}
            isOpen={this.state.modalOpen}
            updateAndScan
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
                {this.props.auth.access && this.isDropdownView() ? (
                  <Dropdown
                    item
                    trigger={
                      <span>
                        <Header as="h2">
                          {this.props.title} <Icon size="small" style={{ paddingTop: 7 }} name="caret down" />
                        </Header>
                      </span>
                    }
                    icon={null}
                    simple
                  >
                    <Dropdown.Menu>
                      <Dropdown.Item as={Link} to="/">
                        <Icon color="green" name="calendar check outline" />
                        {`  ${this.props.t("sidemenu.withtimestamp")}`}
                      </Dropdown.Item>
                      <Dropdown.Item as={Link} to="/notimestamp">
                        <Icon color="red" name="calendar times outline" />
                        {`  ${this.props.t("sidemenu.withouttimestamp")}`}
                      </Dropdown.Item>
                      <Dropdown.Divider />

                      <Dropdown.Item as={Link} to="/recent">
                        <Icon name="clock" />
                        {`  ${this.props.t("sidemenu.recentlyadded")}`}
                      </Dropdown.Item>
                      <Dropdown.Divider />

                      <Dropdown.Item as={Link} to="/hidden">
                        <Icon color="red" name="hide" />
                        {`  ${this.props.t("sidemenu.hidden")}`}
                      </Dropdown.Item>
                      <Dropdown.Item as={Link} to="/favorites">
                        <Icon name="star" color="yellow" />
                        {`  ${this.props.t("sidemenu.favorites")}`}
                      </Dropdown.Item>
                      <Dropdown.Item
                        disabled={!this.props.auth.access}
                        as={Link}
                        to={this.props.auth.access ? `/user/${this.props.auth.access.name}` : "/"}
                      >
                        <Icon color="green" name="globe" />
                        {`  ${this.props.t("sidemenu.mypublicphotos")}`}
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                ) : (
                  this.props.title
                )}
                <Header.Subheader>
                  {this.props.numPhotosetItems != this.props.numPhotos
                    ? `${this.props.numPhotosetItems} ${this.props.t("defaultheader.days")}, `
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
                <b>{this.props.dayHeaderPrefix ? this.props.dayHeaderPrefix + this.props.date : this.props.date}</b>
              </span>
            </div>
          </GridColumn>
        </GridRow>
      </Grid>
    );
  }
}

DefaultHeader = compose(
  connect(store => ({
    auth: store.auth,
    user: store.user.userSelfDetails,
  })),
  withTranslation()
)(DefaultHeader);
