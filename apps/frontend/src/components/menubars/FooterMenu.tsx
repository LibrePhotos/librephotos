import {
  Avatar,
  Divider,
  Flex,
  Menu,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconAdjustments as Adjustments,
  IconBook as Book,
  IconListDetails as ListDetails,
  IconLogout as Logout,
  IconMoon as Moon,
  IconSettings as Settings,
  IconSun as Sun,
  IconTrash as Trash,
  IconUser as User,
} from "@tabler/icons-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLogoutMutation } from "../../api_client/auth";
import { serverAddress } from "../../api_client/urls";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useAuth } from "../../hooks/useAuth";
import { LogoutWhileUploadingModal, useLogoutGuard, useOptionalUploadProcessing } from "../upload";
import classes from "./FooterMenu.module.css";
import { ImportJobMenuSection } from "./ImportJobMenuSection";
import { getNavigationItems, isNavItemActive, TRASH_LINK } from "./navigation";

export function FooterMenu(): React.JSX.Element {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { toggleColorScheme } = useMantineColorScheme();
  // The raw scheme is "auto" until the user picks one; show the one in effect.
  const colorScheme = useComputedColorScheme("light", { getInitialValueInEffect: false });
  const { data: user } = useCurrentUserSelfDetailsQuery();
  // Uploads still being imported (#2739), as at the top of the desktop account menu.
  const openImports = useOptionalUploadProcessing()?.openImports ?? [];
  const { mutate: logout } = useLogoutMutation();
  const { requestLogout, modalProps } = useLogoutGuard(() => logout());

  // Trash is a rare destination: on a phone it sits in the account menu, so the bar keeps the
  // three sections people switch between (as Google Photos' and Immich's phone tabs do).
  const navigationItems = getNavigationItems(t, isAuthenticated).filter(item => item.link !== TRASH_LINK);

  const links = navigationItems.map(item => {
    const key = item.label;

    if (item.display === false) {
      return null;
    }

    // A Material-style bottom bar: icon over a short label, the current
    // section marked by a tinted pill behind its icon (one accent for every tab).
    const active = isNavItemActive(item, pathname);
    const content = (
      <>
        <span className={classes.pill} aria-hidden>
          <item.icon size={22} stroke={1.75} />
        </span>
        <span className={classes.label}>{item.label}</span>
      </>
    );
    const link = item.submenu ? (
      <UnstyledButton key={key} className={classes.tab} data-active={active}>
        {content}
      </UnstyledButton>
    ) : (
      <UnstyledButton
        key={key}
        component={Link}
        to={item.link}
        // Fuzzy matching would mark "/" as the current page everywhere.
        activeOptions={{ exact: true }}
        aria-current={active ? "page" : undefined}
        className={classes.tab}
        data-active={active}
      >
        {content}
      </UnstyledButton>
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
              const { icon: SubmenuIcon, link: submenuLink } = subitem;
              const submenuIcon = SubmenuIcon ? <SubmenuIcon size={14} color={subitem.color} /> : undefined;
              return (
                <Menu.Item
                  key={subkey}
                  leftSection={submenuIcon}
                  onClick={() => {
                    if (submenuLink !== undefined) {
                      void navigate({ to: submenuLink });
                    }
                  }}
                >
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
    <Flex className={classes.bar} justify="space-around" align="center">
      {links}
      <Menu width={200} position="top-end">
        <Menu.Target>
          <UnstyledButton className={classes.tab} aria-label={t("topmenu.accountmenu")}>
            <span className={classes.pill} aria-hidden>
              <Avatar
                src={user && user.avatar_url ? serverAddress + user.avatar_url : "/unknown_user.jpg"}
                size={26}
                alt=""
                radius="xl"
              />
            </span>
            <span className={classes.label} aria-hidden>
              {user ? user.username : ""}
            </span>
          </UnstyledButton>
        </Menu.Target>

        <Menu.Dropdown>
          {openImports.length > 0 && <ImportJobMenuSection imports={openImports} />}
          <Menu.Label>
            <Trans i18nKey="topmenu.loggedin" /> {user ? user.username : ""}
          </Menu.Label>

          <Menu.Item
            leftSection={colorScheme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
            onClick={() => toggleColorScheme()}
          >
            {colorScheme === "dark" ? t("settings.colorscheme.dark") : t("settings.colorscheme.light")}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item leftSection={<Book size={14} />} onClick={() => void navigate({ to: "/library" })}>
            {t("topmenu.library")}
          </Menu.Item>

          <Menu.Item leftSection={<User size={14} />} onClick={() => void navigate({ to: "/profile" })}>
            {t("topmenu.profile")}
          </Menu.Item>

          <Menu.Item leftSection={<Settings size={14} />} onClick={() => void navigate({ to: "/settings" })}>
            {t("topmenu.settings")}
          </Menu.Item>

          <Menu.Item leftSection={<ListDetails size={14} />} onClick={() => void navigate({ to: "/jobs" })}>
            {t("topmenu.jobs")}
          </Menu.Item>

          <Menu.Item leftSection={<Trash size={14} />} onClick={() => void navigate({ to: TRASH_LINK })}>
            {t("photos.deleted")}
          </Menu.Item>

          {user && user.is_superuser && <Menu.Divider />}

          {user && user.is_superuser && (
            <Menu.Item leftSection={<Adjustments size={14} />} onClick={() => void navigate({ to: "/admin" })}>
              {t("topmenu.adminarea")}
            </Menu.Item>
          )}

          <Menu.Item leftSection={<Logout size={14} />} onClick={requestLogout}>
            {t("topmenu.logout")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <LogoutWhileUploadingModal {...modalProps} />
    </Flex>
  );
}
