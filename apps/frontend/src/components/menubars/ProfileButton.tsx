import type { JobDetail } from "@librephotos/api-client";
import { ActionIcon, Avatar, Box, Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAdjustments as Adjustments,
  IconBook as Book,
  IconListDetails as ListDetails,
  IconLogout as Logout,
  IconSettings as Settings,
  IconUser as User,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLogoutMutation } from "../../api_client/auth";
import { serverAddress } from "../../api_client/urls";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useWorkerStatus } from "../../hooks/useWorkerStatus";
import { CancelJobModal } from "../job/CancelJobModal";
import { LogoutWhileUploadingModal, useLogoutGuard } from "../upload";
import { jobPercent, WorkerJobMenuSection } from "./WorkerJobMenuSection";
import { WorkerProgressRing } from "./WorkerProgressRing";

export function ProfileButton(): React.ReactNode {
  const { t } = useTranslation();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { mutate: logout } = useLogoutMutation();
  const { requestLogout, modalProps } = useLogoutGuard(() => logout());
  const navigate = useNavigate();
  const { workerRunningJob, currentData } = useWorkerStatus();
  // Busy only once the worker has answered; no ring while the first poll is in flight.
  const workerBusy = currentData !== undefined && !currentData.queue_can_accept_job;
  const [menuOpened, menu] = useDisclosure(false);
  const [cancelOpened, cancelDialog] = useDisclosure(false);
  // The job the user asked to cancel, kept as it was: if it ends and another starts while
  // the dialog is open, confirming must not cancel the new one.
  const [jobToCancel, setJobToCancel] = useState<JobDetail | null>(null);

  const askToCancel = (job: JobDetail) => {
    setJobToCancel(job);
    menu.close();
    cancelDialog.open();
  };

  return (
    <>
      <Menu width={240} position="bottom-end" opened={menuOpened} onChange={menu.set}>
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
          {workerBusy && <WorkerJobMenuSection job={workerRunningJob} onCancel={askToCancel} />}

          <Menu.Label>
            <Trans i18nKey="topmenu.loggedin" /> {user ? user.username : ""}
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

          <Menu.Item leftSection={<Logout size={14} />} onClick={requestLogout}>
            {t("topmenu.logout")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <LogoutWhileUploadingModal {...modalProps} />
      {jobToCancel && <CancelJobModal opened={cancelOpened} onClose={cancelDialog.close} job={jobToCancel} />}
    </>
  );
}
