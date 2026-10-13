import { Menu } from "@mantine/core";
import { IconPhoto, IconShare, IconUserMinus } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { RemoveFromAlbumMenuItem } from "./RemoveFromAlbumMenuItem";

/** The album pages whose own actions the selection menu offers. */
export type AlbumPageKind = "person" | "useralbum";

/** The album page `pathname` is, if it is one. */
export function albumPageKind(pathname: string): AlbumPageKind | undefined {
  if (pathname.startsWith("/album/persons/")) return "person";
  if (pathname.startsWith("/album/user/")) return "useralbum";
  return undefined;
}

type Props = Readonly<{
  kind: AlbumPageKind;
  selectedCount: number;
  selectAllMode: boolean;
  albumLocked: boolean;
  onSetCover: () => void;
  onShareAlbum: () => void;
  onRemoveFromAlbum: () => void;
  onRemoveFromPerson: () => void;
}>;

/**
 * The "Album Actions" section of the selection menu: the cover, and for a user album its
 * sharing and "Remove photos", for a person "Remove from this person". Removing works on an
 * explicit selection only; "Select all" is a server-side query these endpoints do not take.
 */
export function AlbumSelectionActions(props: Props) {
  const { t } = useTranslation();
  const { kind, selectedCount, selectAllMode, albumLocked } = props;
  const hasSelection = selectAllMode || selectedCount > 0;
  // Takes a list of photo ids; the select-all query is not supported.
  let removeFromPersonReason: string | undefined;
  if (selectAllMode) removeFromPersonReason = t("selectionactions.removefrompersonselectall");
  else if (selectedCount === 0) removeFromPersonReason = t("selectionactions.selectphotosfirst");

  return (
    <>
      <Menu.Divider />

      <Menu.Label>{t("selectionactions.albumactions")}</Menu.Label>

      <DisabledReason
        reason={(selectedCount > 1 || selectAllMode) && t("selectionactions.albumcovermultiselect")}
        position="left"
      >
        <Menu.Item leftSection={<IconPhoto size={ICON_SIZE.menu} />} onClick={props.onSetCover}>
          {t("selectionactions.albumcover")}
        </Menu.Item>
      </DisabledReason>

      {kind === "useralbum" && (
        <>
          <Menu.Item leftSection={<IconShare size={ICON_SIZE.menu} />} onClick={props.onShareAlbum}>
            {t("selectionactions.sharing")}
          </Menu.Item>

          <RemoveFromAlbumMenuItem
            hasSelection={hasSelection}
            selectAllMode={selectAllMode}
            albumLocked={albumLocked}
            onRemove={props.onRemoveFromAlbum}
          />
        </>
      )}

      {kind === "person" && (
        <DisabledReason reason={removeFromPersonReason} position="left">
          <Menu.Item
            color="red"
            leftSection={<IconUserMinus size={ICON_SIZE.menu} />}
            onClick={props.onRemoveFromPerson}
          >
            {t("selectionactions.removefromperson")}
          </Menu.Item>
        </DisabledReason>
      )}
    </>
  );
}
