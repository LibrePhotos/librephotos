import { ActionIcon, Avatar, Divider, Flex, Menu, useMantineColorScheme } from "@mantine/core";
import {
  IconAdjustments as Adjustments,
  IconBook as Book,
  IconLogout as Logout,
  IconMoon as Moon,
  IconSettings as Settings,
  IconSun as Sun,
  IconUser as User,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import { useLogoutMutation } from "../../api_client/auth";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useAuth } from "../../hooks/useAuth";
import { getNavigationItems } from "./navigation";

export function FooterMenu(): JSX.Element {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { mutate: logout } = useLogoutMutation();
  const queryClient = useQueryClient();

  const navigationItems = getNavigationItems(t, isAuthenticated);

  const links = navigationItems.map(item => {
    const key = item.label;

    if (item.display === false) {
      return null;
    }

    const icon = <item.icon size={24} />;
    const link = item.submenu ? (
      <ActionIcon variant="light" color={item.color} key={key} size="lg">
        {icon}
      </ActionIcon>
    ) : (
      <ActionIcon variant="light" color={item.color} key={key} component={Link} to={item.link} size="lg">
        {icon}
      </ActionIcon>
    );

    if (item.submenu) {
      return (
        <Menu withArrow position="top" width={200} key={key}>
          <Menu.Target>{link}</Menu.Target>

          <Menu.Dropdown>
            {item.submenu.map(subitem => {
              const subkey = `sub-${subitem.label}`;
              if (subitem.header) {
                return <Menu.Label key={subkey}>{subitem.header}</Menu.Label>;
              }
              if (subitem.separator) {
                return <Divider key={subkey} />;
              }
              const submenuIcon = <subitem.icon color={subitem.color} />;
              return (
                <Menu.Item key={subkey} leftSection={submenuIcon} onClick={() => navigate({ to: subitem.link! })}>
                  {subitem.label}
                </Menu.Item>
              );
            })}
          </Menu.Dropdown>
        </Menu>
      );
    }

    return link;
  });

  return (
    <Flex p="xs" justify="space-between">
      {links}
      <Menu width={200} position="top-end">
        <Menu.Target>
          <ActionIcon variant="light" size="lg">
            <Avatar
              src={user && user.avatar_url ? serverAddress + user.avatar_url : "/unknown_user.jpg"}
              size={24}
              alt="profile"
              radius="xl"
            />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>
            <Trans i18nKey="topmenu.loggedin">Logged in as</Trans> {user ? user.username : ""}
          </Menu.Label>

          <Menu.Item leftSection={colorScheme === "dark" ? <Moon /> : <Sun />} onClick={() => toggleColorScheme()}>
            {colorScheme === "dark" ? t("settings.colorscheme.dark") : t("settings.colorscheme.light")}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item leftSection={<Book />} onClick={() => navigate({ to: "/library" })}>
            {t("topmenu.library")}
          </Menu.Item>

          <Menu.Item leftSection={<User />} onClick={() => navigate({ to: "/profile" })}>
            {t("topmenu.profile")}
          </Menu.Item>

          <Menu.Item leftSection={<Settings />} onClick={() => navigate({ to: "/settings" })}>
            {t("topmenu.settings")}
          </Menu.Item>

          {user && user.is_superuser && <Menu.Divider />}

          {user && user.is_superuser && (
            <Menu.Item leftSection={<Adjustments />} onClick={() => navigate({ to: "/admin" })}>
              {t("topmenu.adminarea")}
            </Menu.Item>
          )}

          <Menu.Item
            leftSection={<Logout />}
            onClick={() => {
              queryClient.invalidateQueries();
              logout();
            }}
          >
            {t("topmenu.logout")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Flex>
  );
}
