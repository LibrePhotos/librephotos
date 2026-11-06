import { ActionIcon, Group } from "@mantine/core";
import { IconDownload, IconShare, IconStar, IconTrash } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useMarkPhotosDeletedMutation, useSetFavoritePhotosMutation } from "../../api_client/photos/hooks";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";

type Props = Readonly<{
  /** Why the actions are off (nothing selected), or false while they work. */
  disabledReason: string | false;
  /** The selected photos, read when an action runs. */
  selection: () => PhotoSelection;
  onDownload: () => void;
  onShare: () => void;
  /** Called after a request was sent, to end the selection. */
  onDone: () => void;
}>;

type QuickActionProps = Readonly<{
  label: string;
  disabledReason: string | false;
  onClick: () => void;
  children: React.ReactNode;
}>;

// An icon button named by its tooltip, or saying why it is off.
function QuickAction({ label, disabledReason, onClick, children }: QuickActionProps) {
  return (
    <DisabledReason reason={disabledReason} label={label} position="bottom">
      <ActionIcon variant="subtle" color="gray" size={TOOLBAR_ACTION_SIZE} aria-label={label} onClick={onClick}>
        {children}
      </ActionIcon>
    </DisabledReason>
  );
}

/**
 * The selection bar's direct actions, as Google Photos and Immich show them: favourite, share,
 * download and move to trash, each one click away. The ⋮ beside them holds these and the rest.
 */
export function SelectionQuickActions({ disabledReason, selection, onDownload, onShare, onDone }: Props) {
  const { t } = useTranslation();
  const setFavoritePhotos = useSetFavoritePhotosMutation();
  const setPhotosDeleted = useMarkPhotosDeletedMutation();
  const icon = { size: ICON_SIZE.toolbar, stroke: 1.75 };
  // On a phone the bar has no room: the ⋮ holds them there.
  return (
    <Group gap={2} wrap="nowrap" visibleFrom="sm">
      <QuickAction
        label={t("selectionactions.favorite")}
        disabledReason={disabledReason}
        onClick={() => {
          setFavoritePhotos.mutate({ ...selection(), favorite: true });
          onDone();
        }}
      >
        <IconStar {...icon} />
      </QuickAction>
      <QuickAction label={t("selectionactions.sharing")} disabledReason={disabledReason} onClick={onShare}>
        <IconShare {...icon} />
      </QuickAction>
      <QuickAction label={t("selectionactions.download")} disabledReason={disabledReason} onClick={onDownload}>
        <IconDownload {...icon} />
      </QuickAction>
      <QuickAction
        label={t("selectionactions.deleted")}
        disabledReason={disabledReason}
        onClick={() => {
          setPhotosDeleted.mutate({ ...selection(), deleted: true });
          onDone();
        }}
      >
        <IconTrash {...icon} />
      </QuickAction>
    </Group>
  );
}
