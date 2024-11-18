import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  Tooltip,
  rem,
} from "@mantine/core";
import {
  IconBarbell as Barbell,
  IconCheck as Check,
  IconPlus as Plus,
  IconTrash as Trash,
  IconUserOff as UserOff,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, useWorkerQuery } from "../../api_client/api";
import { notification } from "../../service/notifications";
import { faceActions } from "../../store/faces/faceSlice";
import { FaceAnalysisMethod, FacesOrderOption } from "../../store/faces/facesActions.types";
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
  const { orderBy, analysisMethod, activeTab, minConfidence } = useAppSelector(store => store.face);
  const { t } = useTranslation();
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const dispatch = useAppDispatch();

  const setOrderBy = (value: string) => {
    dispatch(faceActions.changeFacesOrderBy(value as FacesOrderOption));
  };

  const changeShowType = (value: string) => {
    dispatch(faceActions.changeAnalysisMethod(value as FaceAnalysisMethod));
  };

  useEffect(() => {
    if (worker) {
      setQueueCanAcceptJob(worker.queue_can_accept_job);
      setJobType(worker.job_detail?.job_type_str || "");
    }
  }, [worker]);

  return (
    <Box
      sx={theme => ({
        backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[7] : theme.colors.gray[2],
        textAlign: "center",
        cursor: "pointer",
        borderRadius: 10,
      })}
      style={{
        padding: 4,
      }}
    >
      <Group position="apart">
        <Group spacing="xs">
          <Button
            variant="light"
            size="xs"
            leftSection={<Check color={selectMode ? "green" : "gray"} />}
            color={selectMode ? "blue" : "gray"}
            onClick={changeSelectMode}
          >
            {`${selectedFaces.length} ${t("selectionbar.selected")}`}
          </Button>
          <Divider orientation="vertical" style={{ height: "20px", marginTop: "10px" }} />
          <Text size="sm" fw={500} mb={3}>
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
          {(activeTab == "inferred" || activeTab == "unknown") && (
            <div style={{ display: "contents" }}>
              <Divider orientation="vertical" style={{ height: "20px", marginTop: "10px" }} />
              <Text size="sm" weight={500} mb={3}>
                {t("facesdashboard.show")}
              </Text>
              <SegmentedControl
                size="sm"
                value={analysisMethod}
                onChange={changeShowType}
                data={[
                  {
                    label: t("facesdashboard.clusters"),
                    value: FaceAnalysisMethod.enum.clustering,
                  },
                  {
                    label: t("facesdashboard.classifications"),
                    value: FaceAnalysisMethod.enum.classification,
                  },
                ]}
              />
              <Divider orientation="vertical" style={{ height: "20px", marginTop: "10px" }} />
              <Text size="sm" weight={500} mb={3}>
                {t("facesdashboard.minconfidence")}
              </Text>
              <Box
                style={{ width: 150, paddingTop: 10, paddingBottom: 10, paddingRight: 5, paddingLeft: 5 }}
                sx={theme => ({
                  backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[7] : theme.colors.gray[1],
                  textAlign: "center",
                  cursor: "pointer",
                  borderRadius: 4,
                })}
              >
                <Slider
                  value={minConfidence}
                  onChange={value => dispatch(faceActions.changeMinConfidence(value))}
                  label={minConfidence}
                  size={5}
                  step={0.05}
                  min={0}
                  max={1}
                  defaultValue={0.5}
                />
              </Box>
            </div>
          )}
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
          <Group justify="center">
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
    </Box>
  );
}
