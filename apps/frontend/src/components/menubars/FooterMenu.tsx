import { ActionIcon, Divider, Flex, Menu } from "@mantine/core";
import { IconHeart as Heart } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../hooks/useAuth";
import { SUPPORT_LINK } from "../../ui-constants";
import { getNavigationItems } from "./navigation";

export function FooterMenu(): JSX.Element {
  const { isAuthenticated, userId } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const navigationItems = getNavigationItems(t, isAuthenticated, !!userId);

  navigationItems.push({ label: t("supportus"), link: SUPPORT_LINK, icon: Heart, color: "pink" });

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
                <Menu.Item key={subkey} leftSection={submenuIcon} onClick={() => navigate(subitem.link!)}>
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
    </Flex>
  );
}
