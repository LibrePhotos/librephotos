import { Button, Popover } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";

import { deleteJob } from "../../actions/utilActions";
import { useAppDispatch } from "../../store/store";

export function DeleteJobButton(job) {
  const [opened, { open, close }] = useDisclosure(false);
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const { id } = job.job;
  const page = job.activePage;
  const { pageSize } = job;

  return (
    <Popover opened={opened} position="top" withArrow width={260}>
      <Popover.Target>
        <Button
          onMouseEnter={open}
          onMouseLeave={close}
          onClick={() => {
            dispatch(deleteJob(id, page, pageSize));
          }}
          color="red"
        >
          {t("adminarea.remove")}
        </Button>
      </Popover.Target>

      <Popover.Dropdown>
        <div style={{ display: "flex" }}>{t("joblist.removeexplanation")}</div>
      </Popover.Dropdown>
    </Popover>
  );
}
