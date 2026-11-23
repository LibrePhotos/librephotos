import { ActionIcon } from "@mantine/core";
import { IconLayoutBottombarCollapse, IconLayoutBottombarExpand } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../../uiConstants";

type Props = Readonly<{ collapsed: boolean; onToggle: () => void }>;

/** On a phone: folds the panel down to its header, so the picture gets the screen, and back. */
export function PanelToggle({ collapsed, onToggle }: Props) {
  const { t } = useTranslation();
  const label = collapsed ? t("editor.panelToggle.expand") : t("editor.panelToggle.collapse");
  return (
    <ActionIcon variant="subtle" color="gray" aria-label={label} aria-expanded={!collapsed} onClick={onToggle}>
      {collapsed ? (
        <IconLayoutBottombarExpand size={ICON_SIZE.inline} />
      ) : (
        <IconLayoutBottombarCollapse size={ICON_SIZE.inline} />
      )}
    </ActionIcon>
  );
}
