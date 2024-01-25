import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconBarbell as Barbell,
  IconPlus as Plus,
  IconTrash as Trash,
  IconUserOff as UserOff,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, useWorkerQuery } from "../../api_client/api";
import { notification } from "../../service/notifications";
import { faceActions } from "../../store/faces/faceSlice";
import { FacesOrderOption } from "../../store/faces/facesActions.types";
import type { IFacesOrderOption } from "../../store/faces/facesActions.types";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = Readonly<{
  selectMode: boolean;
  selectedFaces: any;
  changeSelectMode: () => void;
  addFaces: () => void;
  deleteFaces: () => void;
  notThisPerson: () => void;
}>;

export function ButtonHeaderGroup({
  selectMode,
  selectedFaces,
  changeSelectMode,
  addFaces,
  deleteFaces,
  notThisPerson,
}: Props) {
  const [queueCanAcceptJob, setQueueCanAcceptJob] = useState(false);
  const [jobType, setJobType] = useState("");
  const { data: worker } = useWorkerQuery();
  const { orderBy } = useAppSelector(store => store.face);
  const { t } = useTranslation();
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const dispatch = useAppDispatch();

  const setOrderBy = (value: string) => {
    dispatch(faceActions.changeFacesOrderBy(value as IFacesOrderOption));
  };

  useEffect(() => {
    if (worker) {
      setQueueCanAcceptJob(worker.queue_can_accept_job);
      setJobType(worker.job_detail?.job_type_str || "");
    }
  }, [worker]);

  return (
    <div>
      <Group position="apart">
        <Group spacing="xs">
          <Switch
            label={t("facesdashboard.selectedfaces", {
              number: selectedFaces.length,
            })}
            checked={selectMode}
            onChange={changeSelectMode}
          />
          <Divider orientation="vertical" style={{ height: "20px", marginTop: "10px" }} />
          <Text size="sm" weight={500} mb={3}>
            {t("facesdashboard.sortby")}
          </Text>
          <SegmentedControl
            size="sm"
            value={orderBy}
            onChange={setOrderBy}
            data={[
              {
                label: t("facesdashboard.sortbyconfidence"),
                value: FacesOrderOption.enum.confidence,
              },
              {
                label: t("facesdashboard.sortbydate"),
                value: FacesOrderOption.enum.date,
              },
            ]}
          />
        </Group>
        <Group>
          <Tooltip label={t("facesdashboard.explanationadding")}>
            <ActionIcon variant="light" color="green" disabled={selectedFaces.length === 0} onClick={addFaces}>
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
              loading={jobType === "Train Faces"}
              color="blue"
              variant="light"
              onClick={() => {
                dispatch(api.endpoints.trainFaces.initiate());
                notification.trainFaces();
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
