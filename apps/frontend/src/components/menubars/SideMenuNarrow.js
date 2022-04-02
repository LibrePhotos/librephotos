import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { Divider, Icon, Menu, Dropdown, Item } from "semantic-ui-react";

import { logout } from "../../actions/authActions";
import { compose } from "redux";
import { withTranslation, Trans } from "react-i18next";
import { LEFT_MENU_WIDTH } from "../../ui-constants";
export class SideMenuNarrow extends Component {
  state = { activeItem: "all photos" };

  handleItemClick = (e, { name }) => this.setState({ activeItem: name });
  handleLogout = (e, { name }) => this.props.dispatch(logout());

  render() {
    return (
      <Menu
        style={{
          width: LEFT_MENU_WIDTH,
          overflowWrap: "break-word",
          wordWrap: "break-word",
          wordBreak: "break-word",
        }}
        borderless
        icon="labeled"
        vertical
        fixed="left"
        floated
        pointing
        width="thin"
      >
        <Divider hidden />
        <Divider hidden />
        <Divider hidden />
        <Divider hidden />

        {false && (
          <Menu.Item name="logo">
            <img height={40} alt="Logo of LibrePhotos" src="/logo.png" />
            <p>
              <small>
                <Trans i18nKey="sidemenu.name">LibrePhotos</Trans>
              </small>
            </p>
          </Menu.Item>
        )}

        <Menu.Item name="photos" as={Link} to="/">
          <Icon size="big" name="image outline"></Icon>
          <small>{this.props.t("sidemenu.photos")}</small>
        </Menu.Item>
        {
          //To-DO figure out how to align menu items with dropdowns properly
        }
        <Divider hidden />

        <Dropdown
          pointing="left"
          item
          icon={
            <div>
              <Icon.Group size="big">
                <Icon name="images outline" />
                <Icon name="bookmark" corner />
              </Icon.Group>
            </div>
          }
        >
          <Dropdown.Menu>
            <Dropdown.Header>{this.props.t("sidemenu.albums")}</Dropdown.Header>
            <Dropdown.Item as={Link} to="/people">
              <Icon name="users" />
              {"  " + this.props.t("sidemenu.people")}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/places">
              <Icon name="map" />
              {"  " + this.props.t("sidemenu.places")}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/things">
              <Icon name="tags" />
              {"  " + this.props.t("sidemenu.things")}
            </Dropdown.Item>
            <Dropdown.Divider />
            <Dropdown.Item as={Link} to="/useralbums">
              <Icon name="bookmark" />
              {"  " + this.props.t("sidemenu.myalbums")}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/events">
              <Icon name="wizard" />
              {"  " + this.props.t("sidemenu.autoalbums")}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>{this.props.t("sidemenu.albums")}</small>
        </div>

        <Divider hidden />
        <Dropdown pointing="left" item icon={<Icon size="big" name="bar chart" />}>
          <Dropdown.Menu>
            <Dropdown.Header>
              <div style={{ overflow: "visible" }}>{this.props.t("sidemenu.dataviz")}</div>
            </Dropdown.Header>
            <Dropdown.Item as={Link} to="/placetree">
              <Icon name="sitemap" />
              {"  " + this.props.t("sidemenu.placetree")}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/wordclouds">
              <Icon name="cloud" />
              {"  " + this.props.t("sidemenu.wordclouds")}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/timeline">
              <Icon name="bar chart" />
              {"  " + this.props.t("sidemenu.timeline")}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/socialgraph">
              <Icon name="share alternate" />
              {"  " + this.props.t("sidemenu.socialgraph")}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/facescatter">
              <Icon name="user circle" />
              {"  " + this.props.t("sidemenu.facecluster")}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>{this.props.t("sidemenu.datavizsmall")}</small>
        </div>

        <Divider hidden />

        <Menu.Item name="faces" as={Link} to="/faces">
          <Icon size="big" name="user circle outline"></Icon>
          <small>{this.props.t("sidemenu.facerecognition")}</small>
        </Menu.Item>
        {this.props.auth && (
          <div>
            <Divider hidden />
            <Dropdown pointing="left" item icon={<Icon size="big" name="users" />}>
              <Dropdown.Menu>
                <Dropdown.Header>{this.props.t("sidemenu.sharing")}</Dropdown.Header>

                <Dropdown.Item disabled={!this.props.auth.access} as={Link} to={`/users/`}>
                  <Icon name="globe" />
                  {"  " + this.props.t("sidemenu.publicphotos")}
                </Dropdown.Item>

                <Dropdown.Item as={Link} to="/shared/fromme/photos/">
                  <Icon name="share" color="red" />
                  {"  " + this.props.t("sidemenu.youshared")}
                </Dropdown.Item>

                <Dropdown.Item as={Link} to="/shared/tome/photos/">
                  <Icon name="share" color="green" />
                  {"  " + this.props.t("sidemenu.sharedwithyou")}
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
            <div style={{ marginTop: -17 }}>
              <small>{this.props.t("sidemenu.sharing")}</small>
            </div>
          </div>
        )}

        <Divider hidden />
        <Menu.Item name="trash" as={Link} to="/deleted">
          <Icon size="big" name="trash"></Icon>
          <small>{this.props.t("photos.deleted")}</small>
        </Menu.Item>
      </Menu>
    );
  }
}

SideMenuNarrow = compose(
  connect((store) => {
    return {
      auth: store.auth,
      jwtToken: store.auth.jwtToken,
      location: store.router.location,
    };
  }),
  withTranslation()
)(SideMenuNarrow);
