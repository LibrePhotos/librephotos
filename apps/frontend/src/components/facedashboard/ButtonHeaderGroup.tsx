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
  useComputedColorScheme,
  useMantineTheme,
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

import { notification } from "../../service/notifications";
import { useTrainFacesMutation } from "../../api_client/faces";
import { FaceAnalysisMethod, FacesOrderOption } from "../../api_client/faces/types";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
type Props = Readonly<{
  selectMode: boolean;
  selectedFaces: any;
  changeSelectMode: () => void;
  addFaces: () => void;
  deleteFaces: () => void;
  notThisPerson: () => void;
}>;

const routeApi = getRouteApi("/_protected/faces");

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
  const trainFacesMutation = useTrainFacesMutation();

  const { t } = useTranslation();
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();

  const { tab: activeTab, method: analysisMethod, orderBy, minConfidence } = routeApi.useSearch()
  const navigate = useNavigate();

  useEffect(() => {
    if (trainFacesMutation.isPending) {
      setQueueCanAcceptJob(false);
      setJobType("Train Faces");
    } else {
      setQueueCanAcceptJob(true);
      setJobType("");
    }
  }, [trainFacesMutation.isPending]);

  return (
    <Box
      style={{
        padding: 4,
        backgroundColor: colorScheme === "dark" ? theme.colors.dark[7] : theme.colors.gray[2],
        textAlign: "center",
        cursor: "pointer",
        borderRadius: 10,
      }}
    >
      <Group
        style={{
          paddingLeft: 10,
          paddingRight: 10,
        }}
        justify="space-between"
      >
        <Group gap="xs">
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
            onChange={(value) => {
              navigate({
                to: "/faces",
                search: (prev) => ({
                  ...prev,
                  orderBy: value as FacesOrderOption,
                })
              })
            }}
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
          {(activeTab === "inferred" || activeTab === "unknown") && (
            <div style={{ display: "contents" }}>
              <Divider orientation="vertical" style={{ height: "20px", marginTop: "10px" }} />
              <Text size="sm" fw={500} mb={3}>
                {t("facesdashboard.show")}
              </Text>
              <SegmentedControl
                size="sm"
                value={analysisMethod}
                onChange={(value) => {
                  navigate({
                    to: "/faces",
                    search: (prev) => ({
                      ...prev,
                      method: value as FaceAnalysisMethod,
                    })
                  })
                }}
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
              <Text size="sm" fw={500} mb={3}>
                {t("facesdashboard.minconfidence")}
              </Text>
              <Box
                style={{
                  width: 150,
                  paddingTop: 10,
                  paddingBottom: 10,
                  paddingRight: 5,
                  paddingLeft: 5,
                  backgroundColor: colorScheme === "dark" ? theme.colors.dark[7] : theme.colors.gray[1],
                  textAlign: "center",
                  cursor: "pointer",
                  borderRadius: 4,
                }}
              >
                <Slider
                  value={minConfidence}
                  onChange={(value) => {
                    navigate({
                      to: "/faces",
                      search: (prev) => ({
                        ...prev,
                        minConfidence: value,
                      })
                    })
                  }}
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
                trainFacesMutation.mutate();
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
