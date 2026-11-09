import type { Job } from "@librephotos/api-client";
import { ActionIcon, Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDotsVertical as DotsVertical, IconTrash as Trash } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { RemoveJobModal } from "./RemoveJobModal";

/**
 * A job row's ⋮ menu in the job list: Remove entry, whose dialog says what removing it does (it
 * never stops the job). The scan the next incremental scan starts from cannot be removed, and the
 * item says why (#2223).
 */
export function JobActionsMenu({ job }: Readonly<{ job: Job }>) {
  const { t } = useTranslation();
  const [confirmOpened, { open, close }] = useDisclosure(false);
  const name = t("joblist.actions");

  return (
    <>
      <Menu position="bottom-end" shadow="md">
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" aria-label={name} title={name}>
            <DotsVertical size={ICON_SIZE.inline} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <DisabledReason reason={job.is_scan_baseline === true && t("joblist.scanbaseline")}>
            <Menu.Item leftSection={<Trash size={ICON_SIZE.menu} />} onClick={open}>
              {t("joblist.removeentry")}
            </Menu.Item>
          </DisabledReason>
        </Menu.Dropdown>
      </Menu>
      <RemoveJobModal job={job} opened={confirmOpened} onClose={close} />
    </>
  );
}
