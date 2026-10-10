import { ActionIcon, Avatar, Box, Menu } from "@mantine/core";
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
import { useWorkerStatus } from "../../hooks/useWorkerStatus";
import { jobPercent, WorkerJobMenuSection } from "./WorkerJobMenuSection";
import { WorkerProgressRing } from "./WorkerProgressRing";

export function ProfileButton(): React.ReactNode {
  const { t } = useTranslation();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { mutate: logout } = useLogoutMutation();
  const navigate = useNavigate();
  const { workerRunningJob, currentData } = useWorkerStatus();
  // Busy only once the worker has answered; no ring while the first poll is in flight.
  const workerBusy = currentData !== undefined && !currentData.queue_can_accept_job;

  return (
    <Menu width={240} position="bottom-end">
      {/* While the worker is busy a progress ring wraps the avatar, and the running
          job heads the menu. When idle there is nothing extra in the header. */}
      <Box pos="relative" display="flex">
        <Menu.Target>
          <ActionIcon
            variant="transparent"
            size={30}
            aria-label={
              workerBusy ? `${t("topmenu.accountmenu")}, ${t("topmenu.workerstatusbusy")}` : t("topmenu.accountmenu")
            }
          >
            <Avatar
              src={user && user.avatar_url ? serverAddress + user.avatar_url : "/unknown_user.jpg"}
              size={28}
              alt=""
              radius="xl"
            />
          </ActionIcon>
        </Menu.Target>
        {workerBusy && <WorkerProgressRing percent={jobPercent(workerRunningJob)} />}
      </Box>

      <Menu.Dropdown>
        {workerBusy && <WorkerJobMenuSection job={workerRunningJob} />}

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
