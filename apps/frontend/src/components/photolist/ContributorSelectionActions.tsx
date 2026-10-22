import type { PigPhoto } from "@librephotos/api-client";
import { Button } from "@mantine/core";
import { IconFileMinus } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useRemovePhotosFromSharedAlbumMutation } from "../../api_client/albums/hooks";
import type { SelectionState } from "../../api_client/photos/types";
import { useAuth } from "../../hooks/useAuth";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";

type Props = Readonly<{
  selectedItems: PigPhoto[];
  selectAllMode: boolean;
  albumID: string;
  albumLocked: boolean;
  title: string;
  updateSelectionState: (state: Partial<SelectionState>) => void;
}>;

/** Why a contributor cannot take the selection out of the album, or nothing when they can. */
export function contributorRemoveReason(
  t: TFunction,
  selection: Pick<Props, "selectedItems" | "selectAllMode" | "albumLocked">,
  myId: number | null
): string | undefined {
  if (selection.selectAllMode) return t("collab.selectAllRemove");
  if (selection.albumLocked) return t("useralbum.lockedCannotRemove");
  if (selection.selectedItems.length === 0) return t("selectionactions.selectphotosfirst");
  if (selection.selectedItems.some(item => item.owner?.id !== myId)) return t("collab.onlyYourOwn");
  return undefined;
}

/**
 * The selection action of a contributor in an album shared with them (#464): take the photos they
 * added out again. Photos others added say why they cannot go; nothing leaves anyone's library.
 */
export function ContributorSelectionActions(props: Props) {
  const { t } = useTranslation();
  const { userId } = useAuth();
  const remove = useRemovePhotosFromSharedAlbumMutation();
  const { selectedItems, albumID, title, updateSelectionState } = props;
  return (
    <DisabledReason reason={contributorRemoveReason(t, props, userId)} position="bottom">
      <Button
        variant="light"
        color="red"
        size="xs"
        loading={remove.isPending}
        leftSection={<IconFileMinus size={ICON_SIZE.menu} />}
        onClick={() =>
          remove.mutate(
            { albumId: albumID, title, photoIds: selectedItems.map(item => item.id) },
            { onSuccess: () => updateSelectionState({ selectMode: false, selectedItems: [] }) }
          )
        }
      >
        {t("collab.removeMine")}
      </Button>
    </DisabledReason>
  );
}
