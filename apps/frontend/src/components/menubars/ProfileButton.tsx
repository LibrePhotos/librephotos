import type { JobDetail } from "@librephotos/api-client";
import { ActionIcon, Badge, Box, Group, Indicator, Menu, Stack, Text, VisuallyHidden } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAdjustments as Adjustments,
  IconBook as Book,
  IconConfetti as Confetti,
  IconListDetails as ListDetails,
  IconLogout as Logout,
  IconSettings as Settings,
  IconSparkles as Sparkles,
  IconUser as User,
} from "@tabler/icons-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLogoutMutation } from "../../api_client/auth";
import { useOpenUpgradeTaskCount } from "../../api_client/jobs/hooks/useUpgradeTasks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useJobQueue } from "../../hooks/useJobQueue";
import { UserAvatar, userDisplayName } from "../common/UserAvatar";
import { CancelJobModal } from "../job/CancelJobModal";
import { ShortcutHint } from "../shortcuts/ShortcutHint";
import { ShortcutsMenuItem } from "../shortcuts/ShortcutsMenuItem";
import { useSupport } from "../support/supportContext";
import { rewindSeasonYear } from "../support/supportPrompts";
import { LogoutWhileUploadingModal, useLogoutGuard, useOptionalUploadProcessing } from "../upload";
import { useWhatsNew } from "../whatsnew/whatsNewContext";
import { ImportJobMenuSection, importPercent } from "./ImportJobMenuSection";
import classes from "./TopMenu.module.css";
import { jobPercent, WorkerJobMenuSection } from "./WorkerJobMenuSection";
import { WorkerProgressRing } from "./WorkerProgressRing";

// The pages the account menu opens; none has a row in the sidebar.
const ACCOUNT_PAGES = ["/settings", "/profile", "/library", "/jobs", "/admin"];

export function ProfileButton(): React.ReactNode {
  const { t } = useTranslation();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { mutate: logout } = useLogoutMutation();
  const { requestLogout, modalProps } = useLogoutGuard(() => logout());
  const navigate = useNavigate();
  const onAccountPage = useRouterState({
    select: state => ACCOUNT_PAGES.some(page => state.location.pathname.startsWith(page)),
  });
  const whatsNew = useWhatsNew();
  const support = useSupport();
  // Rewind, the user's year in photos, around Christmas only.
  const rewindYear = rewindSeasonYear(new Date());
  // Not busy until the worker has answered: no ring while the first poll is in flight.
  const { busy: workerBusy, job: workerRunningJob } = useJobQueue();
  // Uploads the server is still importing (#2739), from this browser or a phone. They never make
  // the worker busy, so they get their own menu section; the ring shows them when nothing else runs.
  const openImports = useOptionalUploadProcessing()?.openImports ?? [];
  const importing = openImports.length > 0;
  // What an update left for an admin to do (#2322): a dot on the avatar, a count on Admin Area.
  const upgradeTasksLeft = useOpenUpgradeTaskCount(user?.is_superuser === true);
  const upgradeTasksLabel = upgradeTasksLeft ? t("topmenu.upgradetasks", { count: upgradeTasksLeft }) : null;
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
          {/* display: flex, like the upload button's Indicator: a block Indicator gives the
              avatar a text line box that lifts it ~3px above the tiles beside it. */}
          <Indicator
            color="orange"
            size={9}
            offset={3}
            withBorder
            disabled={!upgradeTasksLeft}
            zIndex={2}
            display="flex"
          >
            <Menu.Target>
              <ActionIcon
                variant="transparent"
                size={30}
                radius="xl"
                // On the account pages (Settings, Profile…), which have no sidebar row, the avatar
                // that opens them is marked instead.
                className={classes.avatarButton}
                data-account-page={onAccountPage}
                aria-label={[
                  t("topmenu.accountmenu"),
                  workerBusy ? t("topmenu.workerstatusbusy") : null,
                  importing ? t("topmenu.workerstatusimporting") : null,
                  upgradeTasksLabel,
                ]
                  .filter(Boolean)
                  .join(", ")}
              >
                <UserAvatar user={user} size={28} />
              </ActionIcon>
            </Menu.Target>
          </Indicator>
          {(workerBusy || importing) && (
            <WorkerProgressRing percent={workerBusy ? jobPercent(workerRunningJob) : importPercent(openImports)} />
          )}
        </Box>

        <Menu.Dropdown>
          {workerBusy && <WorkerJobMenuSection job={workerRunningJob} onCancel={askToCancel} />}
          {importing && <ImportJobMenuSection imports={openImports} />}

          {/* Who is signed in, as Google Photos and Immich open their account menus. */}
          {user && (
            <Group gap="sm" wrap="nowrap" px="sm" py="xs">
              <UserAvatar user={user} size={36} />
              <Stack gap={0} miw={0}>
                <Text size="sm" fw={600} truncate>
                  {userDisplayName(user)}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  <Trans i18nKey="topmenu.loggedin" /> {user.username}
                </Text>
              </Stack>
            </Group>
          )}
          <Menu.Divider />

          <Menu.Item
            leftSection={<Book size={18} stroke={1.75} />}
            rightSection={<ShortcutHint to="/library" />}
            onClick={() => navigate({ to: "/library" })}
          >
            {t("topmenu.library")}
          </Menu.Item>

          <Menu.Item leftSection={<User size={18} stroke={1.75} />} onClick={() => navigate({ to: "/profile" })}>
            {t("topmenu.profile")}
          </Menu.Item>

          <Menu.Item
            leftSection={<Settings size={18} stroke={1.75} />}
            rightSection={<ShortcutHint to="/settings" />}
            onClick={() => navigate({ to: "/settings" })}
          >
            {t("topmenu.settings")}
          </Menu.Item>

          <Menu.Item
            leftSection={<ListDetails size={18} stroke={1.75} />}
            rightSection={<ShortcutHint to="/jobs" />}
            onClick={() => navigate({ to: "/jobs" })}
          >
            {t("topmenu.jobs")}
          </Menu.Item>

          {rewindYear === null ? null : (
            <Menu.Item
              leftSection={<Confetti size={18} stroke={1.75} />}
              onClick={() => support.openRewind(rewindYear)}
            >
              {t("rewind.menu", { year: rewindYear })}
            </Menu.Item>
          )}

          {/* The highlights of this release, also after the What's new card was closed (#2305). */}
          <Menu.Item leftSection={<Sparkles size={18} stroke={1.75} />} onClick={() => whatsNew.open()}>
            {t("whatsnew.menu")}
          </Menu.Item>

          {user && user.is_superuser && <Menu.Divider />}

          {user && user.is_superuser && (
            <Menu.Item
              leftSection={<Adjustments size={18} stroke={1.75} />}
              rightSection={
                upgradeTasksLabel ? (
                  <Badge size="sm" color="orange" circle>
                    <span aria-hidden>{upgradeTasksLeft}</span>
                    <VisuallyHidden>{upgradeTasksLabel}</VisuallyHidden>
                  </Badge>
                ) : (
                  <ShortcutHint to="/admin" />
                )
              }
              onClick={() => navigate({ to: "/admin" })}
            >
              {t("topmenu.adminarea")}
            </Menu.Item>
          )}

          <ShortcutsMenuItem />

          <Menu.Item leftSection={<Logout size={18} stroke={1.75} />} onClick={requestLogout}>
            {t("topmenu.logout")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <LogoutWhileUploadingModal {...modalProps} />
      {jobToCancel && <CancelJobModal opened={cancelOpened} onClose={cancelDialog.close} job={jobToCancel} />}
    </>
  );
}
