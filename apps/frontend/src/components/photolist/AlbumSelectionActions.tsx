import { Menu } from "@mantine/core";
import { IconPhoto, IconShare, IconUserMinus } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { RemoveFromAlbumMenuItem } from "./RemoveFromAlbumMenuItem";

/** The album pages whose own actions the selection menu offers. */
export type AlbumPageKind = "person" | "useralbum" | "event";

/** The album page `pathname` is, if it is one. */
export function albumPageKind(pathname: string): AlbumPageKind | undefined {
  if (pathname.startsWith("/album/persons/")) return "person";
  if (pathname.startsWith("/album/user/")) return "useralbum";
  if (pathname.startsWith("/album/events/")) return "event";
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
 * The "Album Actions" section of the selection menu: the selected photo as cover (a person, a user
 * album or an event, #429), and for a user album its
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
  // The selected photo becomes the cover; the picker for any photo is in the page's "⋮" (#2240).
  let coverReason: string | undefined;
  if (selectedCount > 1 || selectAllMode) coverReason = t("selectionactions.albumcovermultiselect");
  else if (selectedCount === 0) coverReason = t("selectionactions.albumcoverpickinmenu");

  return (
    <>
      <Menu.Divider />

      <Menu.Label>{t("selectionactions.albumactions")}</Menu.Label>

      <DisabledReason reason={coverReason} position="left">
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
