import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Divider, Dropdown, Icon, Menu } from "semantic-ui-react";

import { selectAuthAccess, selectIsAuthenticated } from "../../store/auth/authSelectors";
import { useAppSelector } from "../../store/store";
import { LEFT_MENU_WIDTH } from "../../ui-constants";

export function SideMenuNarrow(): JSX.Element {
  const isAuth = useAppSelector(selectIsAuthenticated);
  const access = useAppSelector(selectAuthAccess);

  const { t } = useTranslation();

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
        <Icon size="big" name="image outline" />
        <small>{t("sidemenu.photos")}</small>
      </Menu.Item>
      {
        // To-DO figure out how to align menu items with dropdowns properly
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
          <Dropdown.Header>{t("sidemenu.albums")}</Dropdown.Header>
          <Dropdown.Item as={Link} to="/people">
            <Icon name="users" />
            {`  ${t("sidemenu.people")}`}
          </Dropdown.Item>
          <Dropdown.Item as={Link} to="/places">
            <Icon name="map" />
            {`  ${t("sidemenu.places")}`}
          </Dropdown.Item>
          <Dropdown.Item as={Link} to="/things">
            <Icon name="tags" />
            {`  ${t("sidemenu.things")}`}
          </Dropdown.Item>
          <Dropdown.Divider />
          <Dropdown.Item as={Link} to="/useralbums">
            <Icon name="bookmark" />
            {`  ${t("sidemenu.myalbums")}`}
          </Dropdown.Item>
          <Dropdown.Item as={Link} to="/events">
            <Icon name="wizard" />
            {`  ${t("sidemenu.autoalbums")}`}
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
      <div style={{ marginTop: -17 }}>
        <small>{t("sidemenu.albums")}</small>
      </div>

      <Divider hidden />
      <Dropdown pointing="left" item icon={<Icon size="big" name="chart bar" />}>
        <Dropdown.Menu>
          <Dropdown.Header>
            <div style={{ overflow: "visible" }}>{t("sidemenu.dataviz")}</div>
          </Dropdown.Header>
          <Dropdown.Item as={Link} to="/placetree">
            <Icon name="sitemap" />
            {`  ${t("sidemenu.placetree")}`}
          </Dropdown.Item>

          <Dropdown.Item as={Link} to="/wordclouds">
            <Icon name="cloud" />
            {`  ${t("sidemenu.wordclouds")}`}
          </Dropdown.Item>

          <Dropdown.Item as={Link} to="/timeline">
            <Icon name="chart bar" />
            {`  ${t("sidemenu.timeline")}`}
          </Dropdown.Item>

          <Dropdown.Item as={Link} to="/socialgraph">
            <Icon name="share alternate" />
            {`  ${t("sidemenu.socialgraph")}`}
          </Dropdown.Item>

          <Dropdown.Item as={Link} to="/facescatter">
            <Icon name="user circle" />
            {`  ${t("sidemenu.facecluster")}`}
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
      <div style={{ marginTop: -17 }}>
        <small>{t("sidemenu.datavizsmall")}</small>
      </div>

      <Divider hidden />

      <Menu.Item name="faces" as={Link} to="/faces">
        <Icon size="big" name="user circle outline" />
        <small>{t("sidemenu.facerecognition")}</small>
      </Menu.Item>
      {isAuth && (
        <div>
          <Divider hidden />
          <Dropdown pointing="left" item icon={<Icon size="big" name="users" />}>
            <Dropdown.Menu>
              <Dropdown.Header>{t("sidemenu.sharing")}</Dropdown.Header>

              <Dropdown.Item disabled={!access} as={Link} to="/users/">
                <Icon name="globe" />
                {`  ${t("sidemenu.publicphotos")}`}
              </Dropdown.Item>

              <Dropdown.Item as={Link} to="/shared/fromme/photos/">
                <Icon name="share" color="red" />
                {`  ${t("sidemenu.youshared")}`}
              </Dropdown.Item>

              <Dropdown.Item as={Link} to="/shared/tome/photos/">
                <Icon name="share" color="green" />
                {`  ${t("sidemenu.sharedwithyou")}`}
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
          <div style={{ marginTop: -17 }}>
            <small>{t("sidemenu.sharing")}</small>
          </div>
        </div>
      )}

      <Divider hidden />
      <Menu.Item name="trash" as={Link} to="/deleted">
        <Icon size="big" name="trash" />
        <small>{t("photos.deleted")}</small>
      </Menu.Item>
    </Menu>
  );
}
