import { Menu } from "@mantine/core";
import {
  IconArchive as Archive,
  IconArchiveOff as ArchiveOff,
  IconEye as Eye,
  IconEyeOff as EyeOff,
} from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { menuShortcut } from "../common/menuShortcut";
import type { PhotoActions } from "./usePhotoActions";

type Props = Readonly<{ actions: PhotoActions }>;

type VisibilityAction = { key: string; shortcut: string; label: string; icon: React.ReactNode; onClick: () => void };

/**
 * Hide (H) and Archive (A, #545), each a toggle whose label and icon say what a press does, with
 * the selection menu's icons: Hide an eye struck through, Unhide an open eye.
 */
function visibilityActions(actions: PhotoActions, t: TFunction): VisibilityAction[] {
  return [
    {
      key: "hide",
      shortcut: "H",
      label: actions.isHidden ? t("lightbox.toolbar.showPhoto") : t("lightbox.toolbar.hidePhoto"),
      icon: actions.isHidden ? <Eye size={ICON_SIZE.menu} /> : <EyeOff size={ICON_SIZE.menu} />,
      onClick: actions.toggleHidden,
    },
    {
      key: "archive",
      shortcut: "A",
      label: actions.isArchived ? t("lightbox.toolbar.unarchivePhoto") : t("lightbox.toolbar.archivePhoto"),
      icon: actions.isArchived ? <ArchiveOff size={ICON_SIZE.menu} /> : <Archive size={ICON_SIZE.menu} />,
      onClick: actions.toggleArchived,
    },
  ];
}

/** The two toggles as items of the toolbar's ⋮ menu. */
export function VisibilityMenuItems({ actions }: Props) {
  const { t } = useTranslation();
  return visibilityActions(actions, t).map(({ key, shortcut, label, icon, onClick }) => (
    <Menu.Item key={key} leftSection={icon} {...menuShortcut(shortcut)} onClick={onClick}>
      {label}
    </Menu.Item>
  ));
}
