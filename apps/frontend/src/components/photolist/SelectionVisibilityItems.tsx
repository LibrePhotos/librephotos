import { Menu, Text } from "@mantine/core";
import {
  IconArchive as Archive,
  IconArchiveOff as ArchiveOff,
  IconEye as Eye,
  IconEyeOff as EyeOff,
} from "@tabler/icons-react";
import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { useSetPhotosArchivedMutation, useSetPhotosHiddenMutation } from "../../api_client/photos/hooks";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";

type Props = Readonly<{
  /** Why the items are off (nothing selected), or false while they work. */
  disabledReason: string | false;
  /** The selected photos, read when an item is clicked. */
  selection: () => PhotoSelection;
  /** Called after a request was sent, to end the selection. */
  onDone: () => void;
}>;

type ItemProps = Readonly<{
  disabledReason: string | false;
  icon: React.ReactNode;
  label: string;
  /** A line under the label: where the photos still show. Read out as the item's description. */
  note?: string;
  onClick: () => void;
}>;

function VisibilityItem({ disabledReason, icon, label, note, onClick }: ItemProps) {
  const noteId = useId();
  return (
    <DisabledReason reason={disabledReason} position="left">
      <Menu.Item
        leftSection={icon}
        onClick={onClick}
        aria-label={note ? label : undefined}
        aria-describedby={note ? noteId : undefined}
      >
        {label}
        {note && (
          <Text id={noteId} size="xs" c="dimmed" aria-hidden>
            {note}
          </Text>
        )}
      </Menu.Item>
    </DisabledReason>
  );
}

/**
 * Hide / Unhide and Archive / Unarchive for the selection (#545). The two look alike, so the first
 * of each pair says where the photos still show: hidden ones only on the Hidden page, archived ones
 * everywhere but the timeline and Memories.
 */
export function SelectionVisibilityItems({ disabledReason, selection, onDone }: Props) {
  const { t } = useTranslation();
  const setPhotosHidden = useSetPhotosHiddenMutation();
  const setPhotosArchived = useSetPhotosArchivedMutation();
  const setHidden = (hidden: boolean) => {
    setPhotosHidden.mutate({ ...selection(), hidden });
    onDone();
  };
  const setArchived = (archived: boolean) => {
    setPhotosArchived.mutate({ ...selection(), archived });
    onDone();
  };
  return (
    <>
      <VisibilityItem
        disabledReason={disabledReason}
        icon={<EyeOff size={ICON_SIZE.menu} />}
        label={t("selectionactions.hide")}
        note={t("selectionactions.hidenote")}
        onClick={() => setHidden(true)}
      />
      <VisibilityItem
        disabledReason={disabledReason}
        icon={<Eye size={ICON_SIZE.menu} />}
        label={t("selectionactions.unhide")}
        onClick={() => setHidden(false)}
      />
      <VisibilityItem
        disabledReason={disabledReason}
        icon={<Archive size={ICON_SIZE.menu} />}
        label={t("selectionactions.archive")}
        note={t("selectionactions.archivenote")}
        onClick={() => setArchived(true)}
      />
      <VisibilityItem
        disabledReason={disabledReason}
        icon={<ArchiveOff size={ICON_SIZE.menu} />}
        label={t("selectionactions.unarchive")}
        onClick={() => setArchived(false)}
      />
    </>
  );
}
