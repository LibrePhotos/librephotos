import { ActionIcon, Avatar, Menu } from "@mantine/core";
import {
  IconAdjustments as Adjustments,
  IconBook as Book,
  IconListDetails as ListDetails,
  IconLogout as Logout,
  IconSettings as Settings,
  IconUser as User,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import { useLogoutMutation } from "../../api_client/auth";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";

export function ProfileButton(): React.ReactNode {
  const { t } = useTranslation();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { mutate: logout } = useLogoutMutation();
  const navigate = useNavigate();

  return (
    <Menu width={200} position="bottom-end">
      <Menu.Target>
        <ActionIcon variant="transparent" size={30} aria-label={t("topmenu.accountmenu")}>
          <Avatar
            src={user && user.avatar_url ? serverAddress + user.avatar_url : "/unknown_user.jpg"}
            size={28}
            alt=""
            radius="xl"
          />
        </ActionIcon>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>
          <Trans i18nKey="topmenu.loggedin">Logged in as</Trans> {user ? user.username : ""}
        </Menu.Label>

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
  );
}
