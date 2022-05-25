import { ActionIcon, Group, Switch, Tooltip } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { Barbell, Plus, Trash } from "tabler-icons-react";

import { trainFaces } from "../../actions/facesActions";
import { useAppDispatch } from "../../store/store";

type Props = {
  selectMode: boolean;
  selectedFaces: any;
  workerAvailability: any;
  workerRunningJob: any;
  changeSelectMode: () => void;
  addFaces: () => void;
  deleteFaces: () => void;
};

export function ButtonHeaderGroup(props: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  return (
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
        <Tooltip label={t("facesdashboard.explanationdeleting")}>
          {
            // To-Do: Confirmation of delete faces
          }
          <ActionIcon
            variant="light"
            color="red"
            disabled={props.selectedFaces.length === 0}
            onClick={props.deleteFaces}
          >
            <Trash></Trash>
          </ActionIcon>
        </Tooltip>

        <Tooltip label={t("facesdashboard.explanationtraining")}>
          <ActionIcon
            disabled={!props.workerAvailability}
            loading={props.workerRunningJob && props.workerRunningJob.job_type_str === "Train Faces"}
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
  );
}
