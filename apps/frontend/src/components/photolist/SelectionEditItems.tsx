import { Menu } from "@mantine/core";
import {
  IconCalendarTime as CalendarTime,
  IconFolderSymlink as FolderMove,
  IconMapPin as MapPin,
  IconCursorText as Rename,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";

type Props = Readonly<{
  /** Why the items are off (nothing selected), or false while they work. */
  disabledReason: string | false;
  onSetLocation: () => void;
  onChangeDateTime: () => void;
  onMoveToFolder: () => void;
  onRenameFiles: () => void;
}>;

/**
 * The photo actions that open a dialog to edit the selection: its location (#2279), its date (#2278),
 * its folder (#352) and its file names (#2773).
 */
export function SelectionEditItems({
  disabledReason,
  onSetLocation,
  onChangeDateTime,
  onMoveToFolder,
  onRenameFiles,
}: Props) {
  const { t } = useTranslation();
  return (
    <>
      <DisabledReason reason={disabledReason} position="left">
        <Menu.Item leftSection={<MapPin size={ICON_SIZE.menu} />} onClick={onSetLocation}>
          {t("selectionactions.setlocation")}
        </Menu.Item>
      </DisabledReason>
      <DisabledReason reason={disabledReason} position="left">
        <Menu.Item leftSection={<CalendarTime size={ICON_SIZE.menu} />} onClick={onChangeDateTime}>
          {t("selectionactions.changedatetime")}
        </Menu.Item>
      </DisabledReason>
      <DisabledReason reason={disabledReason} position="left">
        <Menu.Item leftSection={<FolderMove size={ICON_SIZE.menu} />} onClick={onMoveToFolder}>
          {t("selectionactions.movetofolder")}
        </Menu.Item>
      </DisabledReason>
      <DisabledReason reason={disabledReason} position="left">
        <Menu.Item leftSection={<Rename size={ICON_SIZE.menu} />} onClick={onRenameFiles}>
          {t("selectionactions.renamefiles")}
        </Menu.Item>
      </DisabledReason>
    </>
  );
}
