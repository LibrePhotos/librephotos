import { ActionIcon, Avatar, Flex, Group, Menu, Tooltip, useMantineColorScheme } from "@mantine/core";
import {
  IconAdjustments as Adjustments,
  IconBook as Book,
  IconLogout as Logout,
  IconMoon as Moon,
  IconSettings as Settings,
  IconSun as Sun,
  IconUser as User,
} from "@tabler/icons-react";
import React from "react";
import { Trans, useTranslation } from "react-i18next";

import { useLogoutMutation } from "../../api_client/auth/hooks";
import { serverAddress } from "../../api_client/apiClient";
import { ChunkedUploadButton } from "../ChunkedUploadButton";
import { SiteSearch } from "../SiteSearch";
import { TopMenuCommon } from "./TopMenuPublic";
import { WorkerIndicator } from "./WorkerIndicator";
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useNavigate } from "react-router-dom";
export function TopMenu(): React.ReactNode {
  const { t } = useTranslation();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { mutate: logout } = useLogoutMutation();
  const queryClient = useQueryClient();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const navigate = useNavigate();
  return (
    <Flex>
      <TopMenuCommon />
      <div style={{ width: "100%" }}>
        <Group justify="flex-start" grow preventGrowOverflow={false} px={15} h="100%">
          <SiteSearch />

          <Group justify="flex-end">
            <Tooltip label={colorScheme === "dark" ? t("settings.colorscheme.dark") : t("settings.colorscheme.light")}>
              <ActionIcon
                onClick={() => toggleColorScheme()}
                variant="light"
                color="gray"
                size={30}
                aria-label="Toggle color scheme"
              >
                {colorScheme === "dark" ? <Moon size="1.1rem" /> : <Sun size="1.1rem" />}
              </ActionIcon>
            </Tooltip>
            <ChunkedUploadButton />
            <WorkerIndicator />
            <Menu width={200}>
              <Menu.Target>
                <Group m="xs" style={{ cursor: "pointer" }}>
                  <Avatar
                    src={user && user.avatar_url ? serverAddress + user.avatar_url : "/unknown_user.jpg"}
                    size={25}
                    alt="it's me"
                    radius="xl"
                  />
                </Group>
              </Menu.Target>

              <Menu.Dropdown>
                <Menu.Label>
                  <Trans i18nKey="topmenu.loggedin">Logged in as</Trans> {user ? user.username : ""}
                </Menu.Label>

                <Menu.Item leftSection={<Book />} onClick={() => navigate("/library")}>
                  {t("topmenu.library")}
                </Menu.Item>

                <Menu.Item leftSection={<User />} onClick={() => navigate("/profile")}>
                  {t("topmenu.profile")}
                </Menu.Item>

                <Menu.Item leftSection={<Settings />} onClick={() => navigate("/settings")}>
                  {t("topmenu.settings")}
                </Menu.Item>

                {user && user.is_superuser && <Menu.Divider />}

                {user && user.is_superuser && (
                  <Menu.Item leftSection={<Adjustments />} onClick={() => navigate("/admin")}>
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
          </Group>
        </Group>
      </div>
    </Flex>
  );
}
