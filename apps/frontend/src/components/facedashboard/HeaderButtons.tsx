import { ActionIcon, Button, Divider, Group, Modal, NumberInput, Select, Stack, Tooltip } from "@mantine/core";
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
import { FaceAnalysisMethod, FacesOrderOption, useTrainFacesMutation } from "../../api_client/faces";
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

export function HeaderButtons({
  selectMode,
  selectedFaces,
  changeSelectMode,
  addFaces,
  deleteFaces,
  notThisPerson,
}: Props) {
  const [jobType, setJobType] = useState("");
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [queueCanAcceptJob, setQueueCanAcceptJob] = useState(false);
  const navigate = useNavigate();
  const trainFacesMutation = useTrainFacesMutation();
  const { t } = useTranslation();
  const { tab: activeTab, method: analysisMethod, orderBy, minConfidence } = routeApi.useSearch();

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
    <>
      <Group px="md" justify="space-between" align="flex-start">
        <Group align="flex-start">
          <Button
            variant="light"
            leftSection={<Check color={selectMode ? "green" : "gray"} />}
            color={selectMode ? "blue" : "gray"}
            onClick={changeSelectMode}
          >
            {`${selectedFaces.length} ${t("selectionbar.selected")}`}
          </Button>
          <Divider orientation="vertical" />
          <Stack align="start">
            <Select
              w={150}
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
              <Divider orientation="vertical" />
              <Stack align="start">
                <Select
                  w={150}
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
              <Divider orientation="vertical" />
              <Stack align="start">
                <NumberInput
                  w={200}
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
        <Group h={36}>
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
    </>
  );
}
