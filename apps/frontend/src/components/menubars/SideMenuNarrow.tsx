import { Box, Group, Navbar, Stack, Text, ThemeIcon } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button, Dropdown, Icon } from "semantic-ui-react";
import { Photo } from "tabler-icons-react";

import { selectAuthAccess, selectIsAuthenticated } from "../../store/auth/authSelectors";
import { useAppSelector } from "../../store/store";

export function SideMenuNarrow(): JSX.Element {
  const isAuth = useAppSelector(selectIsAuthenticated);
  const access = useAppSelector(selectAuthAccess);

  const { t } = useTranslation();

  return (
    <Navbar p="md" hiddenBreakpoint="sm" hidden={false} width={{ sm: 100, lg: 100 }}>
      <Navbar.Section>
        <Box
          sx={theme => ({
            paddingLeft: theme.spacing.xs,
            paddingRight: theme.spacing.xs,
            paddingBottom: theme.spacing.lg,
            borderBottom: `1px solid ${theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[2]}`,
          })}
        >
          <Stack>
            <Link to="/">
              <Photo size={33}></Photo>
              <Text size="sm">{t("sidemenu.photos")}</Text>
            </Link>
          </Stack>
        </Box>
      </Navbar.Section>
      <Navbar.Section>
        <Box
          sx={theme => ({
            paddingLeft: theme.spacing.xs,
            paddingRight: theme.spacing.xs,
            paddingBottom: theme.spacing.lg,
            borderBottom: `1px solid ${theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[2]}`,
          })}
        >
          <Group position="apart">
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
          </Group>
        </Box>
      </Navbar.Section>
      <Navbar.Section>
        <Box
          sx={theme => ({
            paddingLeft: theme.spacing.xs,
            paddingRight: theme.spacing.xs,
            paddingBottom: theme.spacing.lg,
            borderBottom: `1px solid ${theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[2]}`,
          })}
        >
          <Group position="apart">
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
          </Group>
        </Box>
      </Navbar.Section>
      <Navbar.Section>
        <Box
          sx={theme => ({
            paddingLeft: theme.spacing.xs,
            paddingRight: theme.spacing.xs,
            paddingBottom: theme.spacing.lg,
            borderBottom: `1px solid ${theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[2]}`,
          })}
        >
          <Group position="apart">
            <Link to="/faces">
              <Icon size="big" name="user circle outline" />
              <small>{t("sidemenu.facerecognition")}</small>
            </Link>
          </Group>
        </Box>
      </Navbar.Section>
      {isAuth && (
        <Navbar.Section>
          <Box
            sx={theme => ({
              paddingLeft: theme.spacing.xs,
              paddingRight: theme.spacing.xs,
              paddingBottom: theme.spacing.lg,
              borderBottom: `1px solid ${theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[2]}`,
            })}
          >
            <Group position="apart">
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
            </Group>
          </Box>
        </Navbar.Section>
      )}
      <Navbar.Section>
        <Box
          sx={theme => ({
            paddingLeft: theme.spacing.xs,
            paddingRight: theme.spacing.xs,
            paddingBottom: theme.spacing.lg,
            borderBottom: `1px solid ${theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[2]}`,
          })}
        >
          <Group position="apart">
            <Link to="/deleted">
              <Icon size="big" name="trash" />
              <small>{t("photos.deleted")}</small>
            </Link>
          </Group>
        </Box>
      </Navbar.Section>
    </Navbar>
  );
}
