import { ActionIcon, Button, Group, Modal, Space, Stack, Switch, Tooltip } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Barbell, Plus, Trash, UserOff } from "tabler-icons-react";

import { trainFaces } from "../../actions/facesActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = {
  selectMode: boolean;
  selectedFaces: any;
  changeSelectMode: () => void;
  addFaces: () => void;
  deleteFaces: () => void;
  notThisPerson: () => void;
};

export function ButtonHeaderGroup(props: Props) {
  const queue_can_accept_job = useAppSelector(store => store.worker.queue_can_accept_job);
  const job_detail = useAppSelector(store => store.worker.job_detail);
  const { t } = useTranslation();

  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);

  const dispatch = useAppDispatch();
  return (
    <div>
      <Group position="apart">
        <Switch
          label={t("facesdashboard.selectedfaces", {
            number: props.selectedFaces.length,
          })}
          checked={props.selectMode}
          onClick={props.changeSelectMode}
        />

        <Group>
          <Tooltip label={t("facesdashboard.explanationadding")}>
            <ActionIcon
              variant="light"
              color="green"
              disabled={props.selectedFaces.length === 0}
              onClick={props.addFaces}
            >
              <Plus></Plus>
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("facesdashboard.notthisperson")}>
            <ActionIcon
              variant="light"
              color="orange"
              disabled={props.selectedFaces.length === 0}
              onClick={() => props.notThisPerson()}
            >
              <UserOff></UserOff>
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("facesdashboard.explanationdeleting")}>
            <ActionIcon
              variant="light"
              color="red"
              disabled={props.selectedFaces.length === 0}
              onClick={() => setOpenDeleteDialog(true)}
            >
              <Trash></Trash>
            </ActionIcon>
          </Tooltip>

          <Tooltip label={t("facesdashboard.explanationtraining")}>
            <ActionIcon
              disabled={!queue_can_accept_job}
              loading={job_detail && job_detail.job_type_str === "Train Faces"}
              color="blue"
              variant="light"
              onClick={() => {
                dispatch(trainFaces());
              }}
            >
              <Barbell></Barbell>
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
                props.deleteFaces();
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
