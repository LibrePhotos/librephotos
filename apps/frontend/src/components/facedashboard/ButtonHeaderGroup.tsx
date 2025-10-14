import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Tooltip,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import {
  IconBarbell as Barbell,
  IconCheck as Check,
  IconFilter as Filter,
  IconWand,
  IconPlus as Plus,
  IconSortDescending as SortDescending,
  IconTrash as Trash,
  IconUserOff as UserOff,
} from "@tabler/icons-react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTrainFacesMutation } from "../../api_client/faces";
import { FaceAnalysisMethod, FacesOrderOption } from "../../api_client/faces/types";
import { notification } from "../../service/notifications";

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

  const { tab: activeTab, method: analysisMethod, orderBy, minConfidence } = routeApi.useSearch();
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
        padding: 8,
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
        align="flex-start"
      >
        <Group gap="md" align="flex-start">
          <Button
            variant="light"
            size="sm"
            leftSection={<Check color={selectMode ? "green" : "gray"} />}
            color={selectMode ? "blue" : "gray"}
            onClick={changeSelectMode}
            style={{ height: 36 }}
          >
            {`${selectedFaces.length} ${t("selectionbar.selected")}`}
          </Button>
          <Divider orientation="vertical" style={{ height: 36 }} />
          <Stack gap={0} align="start" style={{ minWidth: 150 }}>
            <Select
              size="sm"
              style={{ width: 150 }}
              value={orderBy}
              onChange={value => {
                navigate({
                  to: "/faces",
                  search: prev => ({
                    ...prev,
                    orderBy: value as FacesOrderOption,
                  }),
                });
              }}
              leftSection={<SortDescending size={16} />}
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
          </Stack>
          {(activeTab === "inferred" || activeTab === "unknown") && (
            <>
              <Divider orientation="vertical" style={{ height: 36 }} />
              <Stack gap={0} align="start" style={{ minWidth: 150 }}>
                <Select
                  size="sm"
                  style={{ width: 150 }}
                  value={analysisMethod}
                  onChange={value => {
                    navigate({
                      to: "/faces",
                      search: prev => ({
                        ...prev,
                        method: value as FaceAnalysisMethod,
                      }),
                    });
                  }}
                  leftSection={<Filter size={16} />}
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
              </Stack>
              <Divider orientation="vertical" style={{ height: 36 }} />
              <Stack gap={0} align="start" style={{ minWidth: 200 }}>
                <NumberInput
                  size="sm"
                  style={{ width: 200 }}
                  value={minConfidence * 100}
                  onChange={value => {
                    if (typeof value === "number") {
                      navigate({
                        to: "/faces",
                        search: prev => ({
                          tab: prev.tab || "inferred",
                          method: prev.method || "clustering",
                          orderBy: prev.orderBy || FacesOrderOption.enum.confidence,
                          minConfidence: value / 100,
                        }),
                      });
                    }
                  }}
                  min={0}
                  max={100}
                  step={5}
                  decimalScale={0}
                  leftSection={<IconWand size={16} />}
                  suffix="% confident"
                />
              </Stack>
            </>
          )}
        </Group>
        <Group gap="xs" style={{ height: 36 }}>
          <Tooltip label={t("facesdashboard.explanationadding")}>
            <ActionIcon
              variant="light"
              color="green"
              disabled={selectedFaces.length === 0}
              onClick={addFaces}
              size="lg"
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
              size="lg"
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
              size="lg"
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
              size="lg"
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
