import { ActionIcon, Avatar, Divider, Flex, Menu, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import {
  IconAdjustments as Adjustments,
  IconBook as Book,
  IconListDetails as ListDetails,
  IconLogout as Logout,
  IconMoon as Moon,
  IconSettings as Settings,
  IconSun as Sun,
  IconUser as User,
} from "@tabler/icons-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import { useLogoutMutation } from "../../api_client/auth";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useAuth } from "../../hooks/useAuth";
import { getNavigationItems, isNavItemActive } from "./navigation";

export function FooterMenu(): JSX.Element {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { toggleColorScheme } = useMantineColorScheme();
  // The raw scheme is "auto" until the user picks one; show the one in effect.
  const colorScheme = useComputedColorScheme("light", { getInitialValueInEffect: false });
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { mutate: logout } = useLogoutMutation();

  const navigationItems = getNavigationItems(t, isAuthenticated);

  const links = navigationItems.map(item => {
    const key = item.label;

    if (item.display === false) {
      return null;
    }

    // Icon-only tiles: the label names them, and a filled tile marks the
    // current section, as the highlighted row does in the desktop side menu
    // (autoContrast keeps the icon readable on the filled yellow one).
    const active = isNavItemActive(item, pathname);
    const variant = active ? "filled" : "light";
    const icon = <item.icon size={24} />;
    const link = item.submenu ? (
      <ActionIcon variant={variant} color={item.color} autoContrast key={key} size="lg" aria-label={item.label}>
        {icon}
      </ActionIcon>
    ) : (
      <ActionIcon
        variant={variant}
        color={item.color}
        autoContrast
        key={key}
        component={Link}
        to={item.link}
        // Fuzzy matching would mark "/" as the current page everywhere.
        activeOptions={{ exact: true }}
        aria-current={active ? "page" : undefined}
        size="lg"
        aria-label={item.label}
      >
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
              const submenuIcon = <subitem.icon size={14} color={subitem.color} />;
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
          <ActionIcon variant="light" size="lg" aria-label={t("topmenu.accountmenu")}>
            <Avatar
              src={user && user.avatar_url ? serverAddress + user.avatar_url : "/unknown_user.jpg"}
              size={24}
              alt=""
              radius="xl"
            />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>
            <Trans i18nKey="topmenu.loggedin">Logged in as</Trans> {user ? user.username : ""}
          </Menu.Label>

          <Menu.Item
            leftSection={colorScheme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
            onClick={() => toggleColorScheme()}
          >
            {colorScheme === "dark" ? t("settings.colorscheme.dark") : t("settings.colorscheme.light")}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item leftSection={<Book size={14} />} onClick={() => navigate({ to: "/library" })}>
            {t("topmenu.library")}
          </Menu.Item>

          <Menu.Item leftSection={<User size={14} />} onClick={() => navigate({ to: "/profile" })}>
            {t("topmenu.profile")}
          </Menu.Item>

          <Menu.Item leftSection={<Settings size={14} />} onClick={() => navigate({ to: "/settings" })}>
            {t("topmenu.settings")}
          </Menu.Item>

          <Menu.Item leftSection={<ListDetails size={14} />} onClick={() => navigate({ to: "/jobs" })}>
            {t("topmenu.jobs")}
          </Menu.Item>

          {user && user.is_superuser && <Menu.Divider />}

          {user && user.is_superuser && (
            <Menu.Item leftSection={<Adjustments size={14} />} onClick={() => navigate({ to: "/admin" })}>
              {t("topmenu.adminarea")}
            </Menu.Item>
          )}

          <Menu.Item leftSection={<Logout size={14} />} onClick={() => logout()}>
            {t("topmenu.logout")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Flex>
  );
}
