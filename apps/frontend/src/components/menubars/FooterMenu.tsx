import { Divider, Flex, Menu, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useLogoutMutation } from "../../api_client/auth";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useAuth } from "../../hooks/useAuth";
import { UserAvatar } from "../common/UserAvatar";
import { LogoutWhileUploadingModal, useLogoutGuard, useOptionalUploadProcessing } from "../upload";
import { AccountSheet } from "./AccountSheet";
import classes from "./FooterMenu.module.css";
import { getNavigationItems, isNavItemActive, TRASH_LINK } from "./navigation";

export function FooterMenu(): React.JSX.Element {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  // Uploads still being imported (#2739), as at the top of the desktop account menu.
  const openImports = useOptionalUploadProcessing()?.openImports ?? [];
  const { mutate: logout } = useLogoutMutation();
  const { requestLogout, modalProps } = useLogoutGuard(() => logout());
  const [sheetOpened, { open: openSheet, close: closeSheet }] = useDisclosure(false);

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
      <UnstyledButton className={classes.tab} aria-label={t("topmenu.accountmenu")} onClick={openSheet}>
        <span className={classes.pill} aria-hidden>
          <UserAvatar user={user} size={26} />
        </span>
        <span className={classes.label} aria-hidden>
          {user ? user.username : ""}
        </span>
      </UnstyledButton>
      <AccountSheet
        opened={sheetOpened}
        onClose={closeSheet}
        user={user}
        imports={openImports}
        onLogout={requestLogout}
      />
      <LogoutWhileUploadingModal {...modalProps} />
    </Flex>
  );
}
