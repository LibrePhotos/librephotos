import { ActionIcon, Menu, Tooltip } from "@mantine/core";
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
import type { PhotoActions } from "./usePhotoActions";

type Props = Readonly<{ actions: PhotoActions }>;

type VisibilityAction = { key: string; label: string; icon: React.ReactNode; onClick: () => void };

/**
 * Hide (H) and Archive (A, #545), each a toggle whose label and icon say what a press does. A hidden
 * photo's eye is red and an archived photo's box teal, so the state shows at a glance.
 */
function visibilityActions(actions: PhotoActions, t: TFunction): VisibilityAction[] {
  return [
    {
      key: "hide",
      label: actions.isHidden ? t("lightbox.toolbar.showPhoto") : t("lightbox.toolbar.hidePhoto"),
      icon: actions.isHidden ? (
        <EyeOff size={ICON_SIZE.lightbox} color="var(--mantine-color-red-6)" />
      ) : (
        <Eye size={ICON_SIZE.lightbox} />
      ),
      onClick: actions.toggleHidden,
    },
    {
      key: "archive",
      label: actions.isArchived ? t("lightbox.toolbar.unarchivePhoto") : t("lightbox.toolbar.archivePhoto"),
      icon: actions.isArchived ? (
        <ArchiveOff size={ICON_SIZE.lightbox} color="var(--mantine-color-teal-6)" />
      ) : (
        <Archive size={ICON_SIZE.lightbox} />
      ),
      onClick: actions.toggleArchived,
    },
  ];
}

/** The two toggles as toolbar buttons. */
export function VisibilityButtons({ actions }: Props) {
  const { t } = useTranslation();
  return visibilityActions(actions, t).map(({ key, label, icon, onClick }) => (
    <Tooltip key={key} label={label} position="bottom" withArrow>
      <ActionIcon variant="subtle" color="gray" size={28} aria-label={label} onClick={onClick}>
        {icon}
      </ActionIcon>
    </Tooltip>
  ));
}

/** The two toggles as items of the phone's actions menu. */
export function VisibilityMenuItems({ actions }: Props) {
  const { t } = useTranslation();
  return visibilityActions(actions, t).map(({ key, label, icon, onClick }) => (
    <Menu.Item key={key} leftSection={icon} onClick={onClick}>
      {label}
    </Menu.Item>
  ));
}
