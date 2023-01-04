import { Button, Popover } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";

import type { Job } from "../../api_client/admin-jobs";
import { useDeleteJobMutation } from "../../api_client/admin-jobs";

export function DeleteJobButton({ job }: { job: Job }) {
  const [opened, { open, close }] = useDisclosure(false);
  const { t } = useTranslation();
  const [deleteJob] = useDeleteJobMutation();

  return (
    <Popover opened={opened} position="top" withArrow width={260}>
      <Popover.Target>
        <Button onMouseEnter={open} onMouseLeave={close} onClick={() => deleteJob(job.id)} color="red">
          {t("adminarea.remove")}
        </Button>
      </Popover.Target>

      <Popover.Dropdown>
        <div style={{ display: "flex" }}>{t("joblist.removeexplanation")}</div>
      </Popover.Dropdown>
    </Popover>
  );
}
