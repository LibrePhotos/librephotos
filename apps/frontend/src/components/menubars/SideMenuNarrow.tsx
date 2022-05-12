import { Navbar } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Dropdown, Icon } from "semantic-ui-react";
import { Album, ChartLine, FaceId, Photo, Trash, Users } from "tabler-icons-react";

import { selectAuthAccess, selectIsAuthenticated } from "../../store/auth/authSelectors";
import { useAppSelector } from "../../store/store";
import { MainLink } from "./MenuLink";

export function SideMenuNarrow(): JSX.Element {
  const isAuth = useAppSelector(selectIsAuthenticated);
  const access = useAppSelector(selectAuthAccess);

  const { t } = useTranslation();

  return (
    <Navbar p="sm" hidden={false} width={{ base: 100 }}>
      <Navbar.Section>
        <MainLink icon={<Photo size={33}></Photo>} color="green" label={t("sidemenu.photos")} to="/" />
      </Navbar.Section>
      <Navbar.Section>
        <Dropdown
          pointing="left"
          item
          icon={<MainLink icon={<Album size={33}></Album>} color="blue" label={t("sidemenu.albums")} />}
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
      </Navbar.Section>
      <Navbar.Section>
        <Dropdown
          pointing="left"
          item
          icon={<MainLink icon={<ChartLine size={33}></ChartLine>} color="yellow" label={t("sidemenu.datavizsmall")} />}
        >
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
      </Navbar.Section>
      <Navbar.Section>
        <MainLink icon={<FaceId size={33}></FaceId>} color="orange" label={t("sidemenu.facerecognition")} to="/faces" />
      </Navbar.Section>
      {isAuth && (
        <Navbar.Section>
          <Dropdown
            pointing="left"
            item
            icon={<MainLink icon={<Users size={33}></Users>} color="red" label={t("sidemenu.sharing")} />}
          >
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
        </Navbar.Section>
      )}
      <Navbar.Section>
        <MainLink icon={<Trash size={33}></Trash>} color="black" label={t("photos.deleted")} to="/deleted" />
      </Navbar.Section>
    </Navbar>
  );
}
