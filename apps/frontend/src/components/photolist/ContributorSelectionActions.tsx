import { Button } from "@mantine/core";
import { IconFileMinus } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useRemovePhotosFromSharedAlbumMutation } from "../../api_client/albums/hooks";
import { useAuth } from "../../hooks/useAuth";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { pickedPhotos } from "./photoListSelection";
import type { Selected } from "./photoListSelection";

type Props = Readonly<{
  selected: Selected;
  albumID: string;
  albumLocked: boolean;
  title: string;
  onDone: () => void;
}>;

/** Why a contributor cannot take the selection out of the album, or nothing when they can. */
export function contributorRemoveReason(
  t: TFunction,
  { selected, albumLocked }: Pick<Props, "selected" | "albumLocked">,
  myId: number | null
): string | undefined {
  if (selected.kind === "all") return t("collab.selectAllRemove");
  if (albumLocked) return t("useralbum.lockedCannotRemove");
  if (selected.items.length === 0) return t("selectionactions.selectphotosfirst");
  if (selected.items.some(item => item.owner?.id !== myId)) return t("collab.onlyYourOwn");
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
  const { selected, albumID, title, onDone } = props;
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
            { albumId: albumID, title, photoIds: pickedPhotos(selected).map(item => item.id) },
            { onSuccess: onDone }
          )
        }
      >
        {t("collab.removeMine")}
      </Button>
    </DisabledReason>
  );
}
