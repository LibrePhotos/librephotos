import { Menu, Text } from "@mantine/core";
import {
  IconArchive as Archive,
  IconArchiveOff as ArchiveOff,
  IconEye as Eye,
  IconEyeOff as EyeOff,
  IconGlobe as Globe,
  IconKey as Key,
} from "@tabler/icons-react";
import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { useSetPhotosArchivedMutation, useSetPhotosHiddenMutation } from "../../api_client/photos/hooks";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";

/**
 * Which of two opposite actions (Hide and Unhide) the menu offers: "on" while a selected photo
 * lacks the state, "off" once every one has it, "both" while that is not known (after Select all,
 * or from a server that does not send the state).
 */
export type Pair = "on" | "off" | "both";

/** The pair for the selected photos' states, one per photo; undefined is a state not known. */
export function pairFor(states: readonly (boolean | undefined)[]): Pair {
  if (states.length === 0 || states.some(state => state === undefined)) return "both";
  return states.every(Boolean) ? "off" : "on";
}

type Props = Readonly<{
  /** Why the items are off (nothing selected), or false while they work. */
  disabledReason: string | false;
  /** The selected photos, read when an item is clicked. */
  selection: () => PhotoSelection;
  /** Which of Hide and Unhide to offer, and of Archive and Unarchive. */
  hide: Pair;
  archive: Pair;
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
 * Hide / Unhide and Archive / Unarchive for the selection (#545), one of each pair when the
 * selection says which. The two look alike, so Hide and Archive say where the photos still show:
 * hidden ones only on the Hidden page, archived ones everywhere but the timeline and Memories.
 */
export function SelectionVisibilityItems({ disabledReason, selection, hide, archive, onDone }: Props) {
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
      {hide !== "off" && (
        <VisibilityItem
          disabledReason={disabledReason}
          icon={<EyeOff size={ICON_SIZE.menu} />}
          label={t("selectionactions.hide")}
          note={t("selectionactions.hidenote")}
          onClick={() => setHidden(true)}
        />
      )}
      {hide !== "on" && (
        <VisibilityItem
          disabledReason={disabledReason}
          icon={<Eye size={ICON_SIZE.menu} />}
          label={t("selectionactions.unhide")}
          onClick={() => setHidden(false)}
        />
      )}
      {archive !== "off" && (
        <VisibilityItem
          disabledReason={disabledReason}
          icon={<Archive size={ICON_SIZE.menu} />}
          label={t("selectionactions.archive")}
          note={t("selectionactions.archivenote")}
          onClick={() => setArchived(true)}
        />
      )}
      {archive !== "on" && (
        <VisibilityItem
          disabledReason={disabledReason}
          icon={<ArchiveOff size={ICON_SIZE.menu} />}
          label={t("selectionactions.unarchive")}
          onClick={() => setArchived(false)}
        />
      )}
    </>
  );
}

type PublicProps = Readonly<{
  disabledReason: string | false;
  /** Make the selection public (true) or private again (false). */
  onSetPublic: (isPublic: boolean) => void;
}>;

/** Make public (which copies the photos' links) and Make private: the server sends neither state. */
export function SelectionPublicItems({ disabledReason, onSetPublic }: PublicProps) {
  const { t } = useTranslation();
  return (
    <>
      <DisabledReason reason={disabledReason} position="left">
        <Menu.Item leftSection={<Globe size={ICON_SIZE.menu} />} onClick={() => onSetPublic(true)}>
          {t("selectionactions.makepublic")}
        </Menu.Item>
      </DisabledReason>
      <DisabledReason reason={disabledReason} position="left">
        <Menu.Item leftSection={<Key size={ICON_SIZE.menu} />} onClick={() => onSetPublic(false)}>
          {t("selectionactions.makeprivate")}
        </Menu.Item>
      </DisabledReason>
    </>
  );
}
