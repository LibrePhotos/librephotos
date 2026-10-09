import { ActionIcon, Button, Divider, Group, Modal, NumberInput, Select, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconBarbell as Barbell,
  IconCheck as Check,
  IconChevronsDown as ChevronsDown,
  IconChevronsUp as ChevronsUp,
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

type Props = Readonly<{
  selectMode: boolean;
  selectedFaces: any;
  changeSelectMode: () => void;
  addFaces: () => void;
  deleteFaces: () => void;
  notThisPerson: () => void;
  allCollapsed: boolean;
  toggleAllCollapsed: () => void;
  canCollapse: boolean;
}>;

const routeApi = getRouteApi("/_protected/faces");

export function HeaderButtons({
  selectMode,
  selectedFaces,
  changeSelectMode,
  addFaces,
  deleteFaces,
  notThisPerson,
  allCollapsed,
  toggleAllCollapsed,
  canCollapse,
}: Props) {
  const [jobType, setJobType] = useState("");
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [queueCanAcceptJob, setQueueCanAcceptJob] = useState(false);
  const navigate = useNavigate();
  const trainFacesMutation = useTrainFacesMutation();
  const { t } = useTranslation();
  const search = routeApi.useSearch();
  const { tab: activeTab, method: analysisMethod, orderBy, minConfidence } = search;

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
          {/* Dividers only where the controls fit on one row: when the row wraps they end up dangling at line ends */}
          <Divider orientation="vertical" visibleFrom="md" />
          <Stack align="start">
            <Select
              w={150}
              value={orderBy}
              onChange={value => {
                navigate({ to: "/faces", search: { ...search, orderBy: value as FacesOrderOption } });
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
              <Divider orientation="vertical" visibleFrom="md" />
              <Stack align="start">
                <Select
                  w={150}
                  value={analysisMethod}
                  onChange={value => {
                    navigate({ to: "/faces", search: { ...search, method: value as FaceAnalysisMethod } });
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
              <Divider orientation="vertical" visibleFrom="md" />
              <Stack align="start">
                <NumberInput
                  w={200}
                  value={minConfidence * 100}
                  onChange={value => {
                    if (typeof value === "number") {
                      navigate({ to: "/faces", search: { ...search, minConfidence: value / 100 } });
                    }
                  }}
                  min={0}
                  max={100}
                  step={5}
                  decimalScale={0}
                  leftSection={<IconWand size={16} />}
                  suffix={t("facesdashboard.confidentsuffix", "% confident")}
                />
              </Stack>
            </>
          )}
        </Group>
        <Group h={36} wrap="nowrap">
          <Tooltip label={allCollapsed ? t("facesdashboard.expandall") : t("facesdashboard.collapseall")}>
            <ActionIcon
              variant="light"
              color="gray"
              disabled={!canCollapse}
              aria-label={allCollapsed ? t("facesdashboard.expandall") : t("facesdashboard.collapseall")}
              onClick={toggleAllCollapsed}
            >
              {allCollapsed ? <ChevronsDown /> : <ChevronsUp />}
            </ActionIcon>
          </Tooltip>
          <Divider orientation="vertical" />
          <Tooltip label={t("facesdashboard.explanationadding")}>
            <ActionIcon
              variant="light"
              color="green"
              disabled={selectedFaces.length === 0}
              aria-label={t("facesdashboard.explanationadding")}
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
              aria-label={t("facesdashboard.notthisperson")}
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
              aria-label={t("facesdashboard.explanationdeleting")}
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
              aria-label={t("facesdashboard.explanationtraining")}
              onClick={() => trainFacesMutation.mutate()}
            >
              <Barbell />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Modal opened={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)} title={t("deleteface")}>
        <Stack>
          <Text size="sm">{t("deletefaceexplanation")}</Text>
          <Group justify="flex-end">
            <Button
              variant="default"
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
