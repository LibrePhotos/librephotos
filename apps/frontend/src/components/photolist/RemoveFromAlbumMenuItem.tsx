import { Menu } from "@mantine/core";
import { IconFileMinus as FileMinus } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";

type RemoveFromAlbumMenuItemProps = Readonly<{
  hasSelection: boolean;
  selectAllMode: boolean;
  albumLocked: boolean;
  onRemove: () => void;
}>;

/** "Remove photos" in a user album's selection menu, saying why it is off when it is (#2237). */
export function RemoveFromAlbumMenuItem({
  hasSelection,
  selectAllMode,
  albumLocked,
  onRemove,
}: RemoveFromAlbumMenuItemProps) {
  const { t } = useTranslation();
  let reason: string | undefined;
  // Removing from an album takes a list of photos; the select-all query is not supported.
  if (selectAllMode) reason = t("selectionactions.removephotosselectall");
  else if (albumLocked) reason = t("useralbum.lockedCannotRemove");
  else if (!hasSelection) reason = t("selectionactions.selectphotosfirst");

  return (
    <DisabledReason reason={reason} position="left">
      <Menu.Item leftSection={<FileMinus size={ICON_SIZE.menu} />} onClick={onRemove}>
        {t("selectionactions.removephotos")}
      </Menu.Item>
    </DisabledReason>
  );
}
