import { ActionIcon, Footer, Group } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Dropdown, Icon } from "semantic-ui-react";
import { Album, ChartLine, FaceId, Photo, Trash, Users } from "tabler-icons-react";

import { selectAuthAccess, selectIsAuthenticated } from "../../store/auth/authSelectors";
import { useAppSelector } from "../../store/store";

export function FooterMenu(): JSX.Element {
  const isAuth = useAppSelector(selectIsAuthenticated);
  const access = useAppSelector(selectAuthAccess);

  const matches = useMediaQuery("(min-width: 700px)");
  const { t } = useTranslation();

  if (matches) {
    return <div></div>;
  }

  return (
    <Footer height={50} p="xs">
      <Group position="apart">
        <ActionIcon color="green" variant="light" component={Link} to="/">
          <Photo size={33}></Photo>
        </ActionIcon>

        <Dropdown
          pointing="top"
          item
          icon={
            <ActionIcon color="blue" variant="light">
              <Album size={33} />
            </ActionIcon>
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
        <Dropdown
          pointing="top"
          item
          icon={
            <ActionIcon color="yellow" variant="light">
              <ChartLine size={33} />
            </ActionIcon>
          }
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

        <ActionIcon color="orange" variant="light" component={Link} to="/faces">
          <FaceId size={33} />
        </ActionIcon>
        {isAuth && (
          <Dropdown
            pointing="top"
            item
            icon={
              <ActionIcon color="red" variant="light">
                <Users size={33} />
              </ActionIcon>
            }
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
        )}
        <ActionIcon color="black" variant="light" component={Link} to="/deleted">
          <Trash size={33} />
        </ActionIcon>
      </Group>
    </Footer>
  );
}
