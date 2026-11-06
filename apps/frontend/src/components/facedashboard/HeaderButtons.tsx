import type { PersonGroup } from "@librephotos/api-client";
import { ActionIcon, Button, Group, Menu, Tooltip, useMantineTheme } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import {
  IconChevronsDown as ChevronsDown,
  IconChevronsUp as ChevronsUp,
  IconDots as Dots,
  IconFaceId as FaceId,
  IconRestore as Restore,
  IconTag as Tag,
  IconTrash as Trash,
  IconUserOff as UserOff,
  IconX as X,
} from "@tabler/icons-react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useTrainFacesMutation } from "../../api_client/faces";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { toolbarLook } from "../common/toolbarLook";
import { ConfirmModal } from "../modals/ConfirmModal";
import { ConfidenceLegend } from "./ConfidenceLegend";
import { FacesFilterPopover } from "./FacesFilterPopover";
import { FacesSortMenu } from "./FacesSortMenu";
import classes from "./FacesToolbar.module.css";
import type { FaceSelection } from "./hooks/useVirtualizedGrid";

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

/** One icon action of the toolbar, named by its tooltip text. */
function ToolbarAction({
  label,
  onClick,
  children,
  color,
}: Readonly<{ label: string; onClick: () => void; children: React.ReactNode; color?: string }>) {
  return (
    <Tooltip label={label}>
      <ActionIcon
        {...toolbarLook()}
        color={color ?? "gray"}
        size={TOOLBAR_ACTION_SIZE}
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  );
}

/**
 * The right side of the faces toolbar. Nothing selected: Sort, Filter, Train faces and a ⋯ menu
 * with fold all and the dots' legend. Faces selected: the count (a click clears it) and what can be done with them (#2237),
 * so the selection's actions only show when they can be used.
 */
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
  const theme = useMantineTheme();
  const compact = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`, undefined, { getInitialValueInEffect: false });
  const search = routeApi.useSearch();
  const { tab: activeTab, method: analysisMethod, orderBy, minConfidence, personOrder } = search;
  const collapseLabel = allCollapsed ? t("facesdashboard.expandall") : t("facesdashboard.collapseall");
  const count = selectedFaces.length;

  const selection = (
    <Group gap={4} wrap="nowrap">
      <Button
        {...toolbarLook(true)}
        h={TOOLBAR_CONTROL_HEIGHT}
        leftSection={<X size={ICON_SIZE.inline} />}
        onClick={changeSelectMode}
        className={classes.count}
      >
        {t("selectionbar.count", { count })}
      </Button>
      {activeTab === "deleted" ? (
        // Labelled, not an icon: the one thing to do with a deleted face is to bring it back
        <Tooltip label={t("facesdashboard.restoreexplanation")}>
          <Button
            {...toolbarLook()}
            h={TOOLBAR_CONTROL_HEIGHT}
            leftSection={<Restore size={ICON_SIZE.toolbar} />}
            onClick={restoreFaces}
          >
            {t("facesdashboard.restoreselected", { count })}
          </Button>
        </Tooltip>
      ) : (
        <>
          <ToolbarAction label={t("facesdashboard.explanationadding")} onClick={addFaces}>
            <Tag size={ICON_SIZE.toolbar} />
          </ToolbarAction>
          <ToolbarAction label={t("facesdashboard.notthisperson")} onClick={notThisPerson}>
            <UserOff size={ICON_SIZE.toolbar} />
          </ToolbarAction>
          <ToolbarAction label={t("facesdashboard.explanationdeleting")} onClick={openDeleteDialog} color="red">
            <Trash size={ICON_SIZE.toolbar} />
          </ToolbarAction>
        </>
      )}
    </Group>
  );

  const tools = (
    <Group gap={4} wrap="nowrap">
      <FacesSortMenu
        orderBy={orderBy}
        personOrder={personOrder}
        onOrderBy={order => void navigate({ to: "/faces", search: { ...search, orderBy: order } })}
        onPersonOrder={order => void navigate({ to: "/faces", search: { ...search, personOrder: order } })}
        compact={compact}
      />
      <FacesFilterPopover
        tab={activeTab}
        method={analysisMethod}
        minConfidence={minConfidence}
        onMethod={method => void navigate({ to: "/faces", search: { ...search, method } })}
        onMinConfidence={value => void navigate({ to: "/faces", search: { ...search, minConfidence: value } })}
        personGroups={personGroups}
        groupId={groupId}
        onGroup={group => void navigate({ to: "/faces", search: { ...search, group } })}
        compact={compact}
      />
      {/* The page's one action: tonal, labelled where there is room */}
      <Tooltip label={t("facesdashboard.explanationtraining")}>
        {compact ? (
          <ActionIcon
            variant="light"
            radius="xl"
            size={TOOLBAR_ACTION_SIZE}
            loading={trainFacesMutation.isPending}
            aria-label={t("facesdashboard.train")}
            onClick={() => trainFacesMutation.mutate()}
          >
            <FaceId size={ICON_SIZE.toolbar} />
          </ActionIcon>
        ) : (
          <Button
            variant="light"
            radius="xl"
            h={TOOLBAR_CONTROL_HEIGHT}
            leftSection={<FaceId size={ICON_SIZE.toolbar} />}
            loading={trainFacesMutation.isPending}
            onClick={() => trainFacesMutation.mutate()}
          >
            {t("facesdashboard.train")}
          </Button>
        )}
      </Tooltip>
      {/* The rarely used tools: fold every group, and what the dots on a suggestion mean */}
      <Menu position="bottom-end" width={260}>
        <Menu.Target>
          <ActionIcon {...toolbarLook()} size={TOOLBAR_ACTION_SIZE} aria-label={t("moreactions")}>
            <Dots size={ICON_SIZE.toolbar} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <DisabledReason reason={!canCollapse && t("facesdashboard.nogroups")} position="left">
            <Menu.Item
              leftSection={allCollapsed ? <ChevronsDown size={ICON_SIZE.menu} /> : <ChevronsUp size={ICON_SIZE.menu} />}
              onClick={toggleAllCollapsed}
            >
              {collapseLabel}
            </Menu.Item>
          </DisabledReason>
          {/* The dots only mark suggestions */}
          {(activeTab === "inferred" || activeTab === "unknown") && (
            <>
              <Menu.Divider />
              <ConfidenceLegend />
            </>
          )}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );

  return (
    <>
      {selectMode ? selection : tools}
      <ConfirmModal
        opened={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={() => {
          deleteFaces();
          closeDeleteDialog();
        }}
        title={t("confirmdialog.deletefaces.title", { count })}
        // Deleted faces can be restored from the Deleted tab (#127)
        message={`${t("confirmdialog.deletefaces.message", { count })} ${t("confirmdialog.deletefaces.restorable", {
          count,
        })}`}
        confirmLabel={t("confirmdialog.deletefaces.confirm", { count })}
      />
    </>
  );
}
