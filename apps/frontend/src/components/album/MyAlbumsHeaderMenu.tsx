import { Menu } from "@mantine/core";
import { IconPlus, IconSettings } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { HeaderActionsMenu } from "../photolist/HeaderActionsMenu";

type Props = Readonly<{
  /** Whether the user has collections yet: the first is made, the others managed (#1009). */
  hasCollections: boolean;
  /** Opens Manage collections, which also names a new one. */
  onManage: () => void;
}>;

/** My Albums' ⋯, after New album: New collection, or Manage collections once there are some. */
export function MyAlbumsHeaderMenu({ hasCollections, onManage }: Props) {
  const { t } = useTranslation();
  return (
    <HeaderActionsMenu label={t("albumcollections.actions")}>
      {hasCollections ? (
        <Menu.Item leftSection={<IconSettings size={ICON_SIZE.menu} />} onClick={onManage}>
          {t("albumcollections.manage")}
        </Menu.Item>
      ) : (
        <Menu.Item leftSection={<IconPlus size={ICON_SIZE.menu} />} onClick={onManage}>
          {t("albumcollections.new")}
        </Menu.Item>
      )}
    </HeaderActionsMenu>
  );
}
