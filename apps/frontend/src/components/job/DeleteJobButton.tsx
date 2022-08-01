import { Button, Popover } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { deleteJob } from "../../actions/utilActions";
import { useAppDispatch } from "../../store/store";


export function DeleteJobButton(job) {
  const [opened, setOpened] = useState(false);
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const { id } = job.job;
  const page = job.activePage;
  const { pageSize } = job;

  return (
    <Popover
      opened={opened}
      position="top"
      placement="center"
      withArrow
      width={260}
      onClose={() => setOpened(false)}
      target={
        <Button
          onMouseEnter={() => setOpened(true)}
          onMouseLeave={() => setOpened(false)}
          onClick={() => {
            dispatch(deleteJob(id, page, pageSize));
          }}
          color="red"
        >
          {t("adminarea.remove")}
        </Button>
      }
    >
      <div style={{ display: "flex" }}>{t("joblist.removeexplanation")}</div>
    </Popover>
  );
}