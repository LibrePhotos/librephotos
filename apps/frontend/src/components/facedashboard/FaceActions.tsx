import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import {
  IconDotsVertical as DotsVertical,
  IconPhoto as Photo,
  IconRestore as Restore,
  IconTag as Tag,
  IconTrash as Trash,
  IconUserCheck as UserCheck,
  IconUserOff as UserOff,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { CompletePersonFace } from "../../api_client/faces/types";
import { canConfirmFace, wrongMatchFor } from "./faceActionRules";
import type { FaceActionHandlers } from "./faceActionRules";
import classes from "./FaceComponent.module.css";
import type { FacesTab } from "./facesTab";
import type { FaceCell } from "./hooks/useVirtualizedGrid";

type Props = Readonly<{
  face: FaceCell;
  group: CompletePersonFace;
  tab: FacesTab;
  actions: FaceActionHandlers;
  onShowPhoto: (e: React.MouseEvent, face: FaceCell) => void;
  /** While faces are selected the toolbar acts on them, so only Show photo stays. */
  selectMode: boolean;
  /** An action on this face is on its way: nothing more to do with it until it leaves the grid. */
  pending: boolean;
  menuOpened: boolean;
  onMenuChange: (opened: boolean) => void;
}>;

type MenuProps = Omit<Props, "menuOpened" | "onMenuChange" | "pending">;

function WrongMatchItem({ face, group, actions }: Pick<Props, "face" | "group" | "actions">) {
  const { t } = useTranslation();
  const wrongMatch = wrongMatchFor(group);
  if (wrongMatch === null) return null;
  return (
    <Menu.Item leftSection={<UserOff size={14} />} onClick={() => actions.rejectMatch(face)}>
      {wrongMatch === "person"
        ? t("facesdashboard.notperson", { name: group.name })
        : t("facesdashboard.movetounknown")}
    </Menu.Item>
  );
}

function FaceMenuItems({ face, group, tab, actions, onShowPhoto, selectMode }: MenuProps) {
  const { t } = useTranslation();
  const showPhoto = (
    <Menu.Item leftSection={<Photo size={14} />} onClick={e => onShowPhoto(e, face)}>
      {t("facesdashboard.showphoto")}
    </Menu.Item>
  );
  if (selectMode) return showPhoto;
  // A deleted face can only come back (#127)
  if (tab === "deleted") {
    return (
      <>
        <Menu.Item leftSection={<Restore size={14} />} onClick={() => actions.restore(face)}>
          {t("facesdashboard.restoreface")}
        </Menu.Item>
        {showPhoto}
      </>
    );
  }
  return (
    <>
      <WrongMatchItem face={face} group={group} actions={actions} />
      <Menu.Item leftSection={<Tag size={14} />} onClick={() => actions.labelAs(face)}>
        {t("facesdashboard.labelas")}
      </Menu.Item>
      {showPhoto}
      <Menu.Divider />
      <Menu.Item color="red" leftSection={<Trash size={14} />} onClick={() => actions.remove(face)}>
        {t("facesdashboard.deleteface")}
      </Menu.Item>
    </>
  );
}

/**
 * The per-face actions of the faces dashboard (#599): a one-click Confirm for an inferred face of
 * a named person, and a ⋮ menu for everything else. Delete sits in the menu, apart from Confirm,
 * so a slip on the frequent action cannot delete a face.
 */
export function FaceActions({
  face,
  group,
  tab,
  actions,
  selectMode,
  pending,
  menuOpened,
  onMenuChange,
  ...rest
}: Props) {
  const { t } = useTranslation();
  const showConfirm = !selectMode && canConfirmFace(tab, group);
  const confirmLabel = t("facesdashboard.confirmface", { name: group.name });
  // Disabled in looks only: a native disabled button drops keyboard focus onto the page, and the
  // next face moves into this cell once the list refreshes, so focus should stay right here
  const inert = { "data-disabled": pending || undefined, "aria-disabled": pending };

  return (
    <div className={classes.actions} data-menu-opened={menuOpened || undefined}>
      <Menu
        opened={menuOpened}
        onChange={opened => onMenuChange(opened && !pending)}
        position="bottom-start"
        withinPortal
      >
        <Menu.Target>
          <ActionIcon
            className={classes.menuButton}
            variant="default"
            radius="xl"
            {...inert}
            // The grid puts focus back on this control of the next face (VirtualGrid keepFocusedRowMounted)
            data-focus-key="menu"
            aria-label={t("facesdashboard.faceactions", { name: group.name })}
          >
            <DotsVertical size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <FaceMenuItems face={face} group={group} tab={tab} actions={actions} selectMode={selectMode} {...rest} />
        </Menu.Dropdown>
      </Menu>
      {showConfirm && (
        <Tooltip label={confirmLabel} withArrow>
          <ActionIcon
            className={classes.confirmButton}
            variant="filled"
            color="green"
            radius="xl"
            size="lg"
            {...inert}
            data-focus-key="confirm"
            aria-label={confirmLabel}
            onClick={() => {
              if (!pending) actions.confirm(face, group.name);
            }}
          >
            <UserCheck size={20} />
          </ActionIcon>
        </Tooltip>
      )}
    </div>
  );
}
