import { FaceAnalysisMethod, FaceOrderBy, type PersonGroup } from "@librephotos/api-client";
import { ActionIcon, Button, Divider, Group, NumberInput, Select, Stack, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBarbell as Barbell,
  IconCheck as Check,
  IconChevronsDown as ChevronsDown,
  IconChevronsUp as ChevronsUp,
  IconFilter as Filter,
  IconWand,
  IconPlus as Plus,
  IconRestore as Restore,
  IconSortDescending as SortDescending,
  IconTrash as Trash,
  IconUserOff as UserOff,
} from "@tabler/icons-react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useTrainFacesMutation } from "../../api_client/faces";
import { PAGE_GUTTER } from "../../uiConstants";
import { PersonGroupFilter } from "../album/PersonGroupFilter";
import { DisabledReason } from "../common/DisabledReason";
import { ConfirmModal } from "../modals/ConfirmModal";
import type { FaceSelection } from "./hooks/useVirtualizedGrid";
import { PersonOrderControl } from "./PersonOrderControl";

type Props = Readonly<{
  selectMode: boolean;
  selectedFaces: readonly FaceSelection[];
  changeSelectMode: () => void;
  addFaces: () => void;
  deleteFaces: () => void;
  notThisPerson: () => void;
  /** The Deleted tab's action on the selection (#127). */
  restoreFaces: () => void;
  allCollapsed: boolean;
  toggleAllCollapsed: () => void;
  canCollapse: boolean;
  /** The user's groups of people, and the one the people are narrowed to (#1126). */
  personGroups: readonly PersonGroup[];
  groupId: number | undefined;
}>;

const routeApi = getRouteApi("/_protected/faces");

export function HeaderButtons({
  selectMode,
  selectedFaces,
  changeSelectMode,
  addFaces,
  deleteFaces,
  notThisPerson,
  restoreFaces,
  allCollapsed,
  toggleAllCollapsed,
  canCollapse,
  personGroups,
  groupId,
}: Props) {
  const [deleteDialogOpen, { open: openDeleteDialog, close: closeDeleteDialog }] = useDisclosure(false);
  const navigate = useNavigate();
  const trainFacesMutation = useTrainFacesMutation();
  const { t } = useTranslation();
  const search = routeApi.useSearch();
  const { tab: activeTab, method: analysisMethod, orderBy, minConfidence, personOrder } = search;
  const collapseLabel = allCollapsed ? t("facesdashboard.expandall") : t("facesdashboard.collapseall");
  // The toolbar's face actions work on the selection; their tooltips say what they do and, until a
  // face is selected, why they cannot (#2237).
  const noSelection = selectedFaces.length === 0 && t("facesdashboard.selectfacesfirst");

  return (
    <>
      <Group px={PAGE_GUTTER} justify="space-between" align="flex-start">
        <Group align="flex-start">
          <Button
            variant="light"
            leftSection={<Check color={selectMode ? "green" : "gray"} />}
            color={selectMode ? "blue" : "gray"}
            onClick={changeSelectMode}
          >
            {t("selectionbar.count", { count: selectedFaces.length })}
          </Button>
          {/* Dividers only where the controls fit on one row: when the row wraps they end up dangling at line ends */}
          <Divider orientation="vertical" visibleFrom="md" />
          {/* The order of the faces, then of the people (#764): close together, as one control */}
          <Group gap="xs" wrap="nowrap">
            <Select
              w={150}
              value={orderBy}
              onChange={value => {
                // Picking the selected option again clears it (null): the route then falls back to its default
                void navigate({ to: "/faces", search: { ...search, orderBy: FaceOrderBy.safeParse(value).data } });
              }}
              leftSection={<SortDescending size={16} />}
              data={[
                {
                  label: t("facesdashboard.sortbyconfidence"),
                  value: FaceOrderBy.enum.confidence,
                },
                {
                  label: t("facesdashboard.sortbydate"),
                  value: FaceOrderBy.enum.date,
                },
              ]}
            />
            <PersonOrderControl
              value={personOrder}
              onChange={order => void navigate({ to: "/faces", search: { ...search, personOrder: order } })}
            />
            {/* The Unknown tab holds no people, so it has nothing to narrow */}
            {activeTab !== "unknown" && (
              <PersonGroupFilter
                groups={personGroups}
                value={groupId}
                onChange={group => void navigate({ to: "/faces", search: { ...search, group } })}
              />
            )}
          </Group>
          {(activeTab === "inferred" || activeTab === "unknown") && (
            <>
              <Divider orientation="vertical" visibleFrom="md" />
              <Stack align="start">
                <Select
                  w={150}
                  value={analysisMethod}
                  onChange={value => {
                    void navigate({
                      to: "/faces",
                      search: { ...search, method: FaceAnalysisMethod.safeParse(value).data },
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
              <Divider orientation="vertical" visibleFrom="md" />
              <Stack align="start">
                <NumberInput
                  w={200}
                  value={minConfidence * 100}
                  onChange={value => {
                    if (typeof value === "number") {
                      void navigate({ to: "/faces", search: { ...search, minConfidence: value / 100 } });
                    }
                  }}
                  min={0}
                  max={100}
                  step={5}
                  decimalScale={0}
                  leftSection={<IconWand size={16} />}
                  suffix={t("facesdashboard.confidentsuffix")}
                />
              </Stack>
            </>
          )}
        </Group>
        <Group h={36} wrap="nowrap">
          <DisabledReason label={collapseLabel} reason={!canCollapse && t("facesdashboard.nogroups")}>
            <ActionIcon variant="light" color="gray" aria-label={collapseLabel} onClick={toggleAllCollapsed}>
              {allCollapsed ? <ChevronsDown /> : <ChevronsUp />}
            </ActionIcon>
          </DisabledReason>
          <Divider orientation="vertical" />
          {activeTab === "deleted" ? (
            // Labelled, not an icon: the one thing to do with a deleted face is to bring it back
            <DisabledReason label={t("facesdashboard.restoreexplanation")} reason={noSelection}>
              <Button variant="light" color="green" leftSection={<Restore size={18} />} onClick={restoreFaces}>
                {selectedFaces.length > 0
                  ? t("facesdashboard.restoreselected", { count: selectedFaces.length })
                  : t("facesdashboard.restore")}
              </Button>
            </DisabledReason>
          ) : (
            <>
              <DisabledReason label={t("facesdashboard.explanationadding")} reason={noSelection}>
                <ActionIcon
                  variant="light"
                  color="green"
                  aria-label={t("facesdashboard.explanationadding")}
                  onClick={addFaces}
                >
                  <Plus />
                </ActionIcon>
              </DisabledReason>
              <DisabledReason label={t("facesdashboard.notthisperson")} reason={noSelection}>
                <ActionIcon
                  variant="light"
                  color="orange"
                  aria-label={t("facesdashboard.notthisperson")}
                  onClick={() => notThisPerson()}
                >
                  <UserOff />
                </ActionIcon>
              </DisabledReason>
              <DisabledReason label={t("facesdashboard.explanationdeleting")} reason={noSelection}>
                <ActionIcon
                  variant="light"
                  color="red"
                  aria-label={t("facesdashboard.explanationdeleting")}
                  onClick={() => openDeleteDialog()}
                >
                  <Trash />
                </ActionIcon>
              </DisabledReason>
            </>
          )}
          <Tooltip label={t("facesdashboard.explanationtraining")}>
            <ActionIcon
              loading={trainFacesMutation.isPending}
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
      <ConfirmModal
        opened={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={() => {
          deleteFaces();
          closeDeleteDialog();
        }}
        title={t("confirmdialog.deletefaces.title", { count: selectedFaces.length })}
        // Deleted faces can be restored from the Deleted tab (#127)
        message={`${t("confirmdialog.deletefaces.message", { count: selectedFaces.length })} ${t(
          "confirmdialog.deletefaces.restorable",
          { count: selectedFaces.length }
        )}`}
        confirmLabel={t("confirmdialog.deletefaces.confirm", { count: selectedFaces.length })}
      />
    </>
  );
}
