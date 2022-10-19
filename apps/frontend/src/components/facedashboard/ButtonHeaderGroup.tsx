import { ActionIcon, Button, Group, Modal, Stack, Switch, Tooltip } from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Barbell, Plus, Trash, UserOff } from "tabler-icons-react";

import { api } from "../../api_client/api";
import i18n from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = {
  selectMode: boolean;
  selectedFaces: any;
  changeSelectMode: () => void;
  addFaces: () => void;
  deleteFaces: () => void;
  notThisPerson: () => void;
};

export function ButtonHeaderGroup({ selectMode, selectedFaces, changeSelectMode, addFaces, deleteFaces, notThisPerson }: Props) {
  const queueCanAcceptJob = useAppSelector(store => store.worker.queue_can_accept_job);
  const jobDetail = useAppSelector(store => store.worker.job_detail);
  const { t } = useTranslation();

  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);

  const dispatch = useAppDispatch();
  return (
    <div>
      <Group position="apart">
        <Switch
          label={t("facesdashboard.selectedfaces", {
            number: selectedFaces.length,
          })}
          checked={selectMode}
          onClick={changeSelectMode}
        />

        <Group>
          <Tooltip label={t("facesdashboard.explanationadding")}>
            <ActionIcon
              variant="light"
              color="green"
              disabled={selectedFaces.length === 0}
              onClick={addFaces}
            >
              <Plus />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("facesdashboard.notthisperson")}>
            <ActionIcon
              variant="light"
              color="orange"
              disabled={selectedFaces.length === 0}
              onClick={() => notThisPerson()}
            >
              <UserOff />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("facesdashboard.explanationdeleting")}>
            <ActionIcon
              variant="light"
              color="red"
              disabled={selectedFaces.length === 0}
              onClick={() => setOpenDeleteDialog(true)}
            >
              <Trash />
            </ActionIcon>
          </Tooltip>

          <Tooltip label={t("facesdashboard.explanationtraining")}>
            <ActionIcon
              disabled={!queueCanAcceptJob}
              loading={jobDetail && jobDetail.job_type_str === "Train Faces"}
              color="blue"
              variant="light"
              onClick={() => {
                dispatch(api.endpoints.trainFaces.initiate());
                showNotification({
                  message: i18n.t<string>("toasts.trainingstarted"),
                  title: i18n.t<string>("toasts.trainingstartedtitle"),
                  color: "teal",
                });
              }}
            >
              <Barbell />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Modal opened={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)} title={<h3>{t("deleteface")}</h3>}>
        <Stack>
          {t("deletefaceexplanation")}
          <Group position="center">
            <Button
              color="blue"
              onClick={() => {
                setOpenDeleteDialog(false);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              color="red"
              onClick={() => {
                deleteFaces();
                setOpenDeleteDialog(false);
              }}
            >
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
