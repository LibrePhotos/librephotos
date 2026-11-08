import type { PhotoCategory } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import {
  IconCalendarTime as CalendarTime,
  IconCopyright as Copyright,
  IconFileText as FileText,
  IconFolderSymlink as FolderMove,
  IconMapPin as MapPin,
  IconPencil as Pencil,
  IconPhoto as Photo,
  IconCursorText as Rename,
  IconScreenshot as Screenshot,
  IconTags as Tags,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { MenuSubmenu } from "../common/MenuSubmenu";

type Props = Readonly<{
  /** Why the items are off (nothing selected), or false while they work. */
  disabledReason: string | false;
  onSetLocation: () => void;
  onChangeDateTime: () => void;
  onMoveToFolder: () => void;
  onRenameFiles: () => void;
  onSetRights: () => void;
}>;

/**
 * "Edit info ▸": the photo actions that open a dialog to edit the selection: its location (#2279),
 * its date (#2278), its file names (#2773), its rights (#425) and its folder (#352). One submenu, as
 * Apple's "Image ▸", so the selection menu fits the window.
 */
export function SelectionEditItems({
  disabledReason,
  onSetLocation,
  onChangeDateTime,
  onMoveToFolder,
  onRenameFiles,
  onSetRights,
}: Props) {
  const { t } = useTranslation();
  return (
    <MenuSubmenu label={t("selectionactions.editinfo")} icon={<Pencil size={ICON_SIZE.menu} />} reason={disabledReason}>
      <Menu.Item leftSection={<MapPin size={ICON_SIZE.menu} />} onClick={onSetLocation}>
        {t("selectionactions.setlocation")}
      </Menu.Item>
      <Menu.Item leftSection={<CalendarTime size={ICON_SIZE.menu} />} onClick={onChangeDateTime}>
        {t("selectionactions.changedatetime")}
      </Menu.Item>
      <Menu.Item leftSection={<Rename size={ICON_SIZE.menu} />} onClick={onRenameFiles}>
        {t("selectionactions.renamefiles")}
      </Menu.Item>
      <Menu.Item leftSection={<Copyright size={ICON_SIZE.menu} />} onClick={onSetRights}>
        {t("selectionactions.setrights")}
      </Menu.Item>
      <Menu.Item leftSection={<FolderMove size={ICON_SIZE.menu} />} onClick={onMoveToFolder}>
        {t("selectionactions.movetofolder")}
      </Menu.Item>
    </MenuSubmenu>
  );
}

type MarkAsProps = Readonly<{
  disabledReason: string | false;
  /** Pins the selection's media category, so rescans and Classify Media keep it. */
  onMarkAs: (category: PhotoCategory) => void;
}>;

/** "Mark as ▸" Photo, Screenshot or Document: the selection's media category. */
export function SelectionMarkAsItems({ disabledReason, onMarkAs }: MarkAsProps) {
  const { t } = useTranslation();
  return (
    <MenuSubmenu label={t("selectionactions.markas")} icon={<Tags size={ICON_SIZE.menu} />} reason={disabledReason}>
      <Menu.Item leftSection={<Photo size={ICON_SIZE.menu} />} onClick={() => onMarkAs("photo")}>
        {t("selectionactions.markasphoto")}
      </Menu.Item>
      <Menu.Item leftSection={<Screenshot size={ICON_SIZE.menu} />} onClick={() => onMarkAs("screenshot")}>
        {t("selectionactions.markasscreenshot")}
      </Menu.Item>
      <Menu.Item leftSection={<FileText size={ICON_SIZE.menu} />} onClick={() => onMarkAs("document")}>
        {t("selectionactions.markasdocument")}
      </Menu.Item>
    </MenuSubmenu>
  );
}
