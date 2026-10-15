import { ActionIcon, Menu, Text, Tooltip } from "@mantine/core";
import { IconAlbum as Album, IconPlus as Plus, IconTag as Tag } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";

type Props = Readonly<{
  /** Why the menu is off: nothing is selected. Empty while there is a selection. */
  reason: string | false;
  /** What is selected, e.g. "5 selected" or "All 120 selected". */
  selection: string;
  onAddToAlbum: () => void;
  onAddTags: () => void;
}>;

/** The selection toolbar's "+": add the selected photos to an album or give them tags. */
export function AddToMenu({ reason, selection, onAddToAlbum, onAddTags }: Props) {
  const { t } = useTranslation();
  return (
    <Menu width={200}>
      {/* Outside Menu.Target, so its click handler replaces the one that opens the menu (#2621). */}
      <DisabledReason reason={reason}>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size={TOOLBAR_ACTION_SIZE} aria-label={t("selectionactions.addto")}>
            <Plus size={ICON_SIZE.toolbar} />
          </ActionIcon>
        </Menu.Target>
      </DisabledReason>

      <Menu.Dropdown>
        <Menu.Label>
          {t("selectionactions.labelwithselection", { label: t("selectionactions.album"), selection })}
        </Menu.Label>

        <Menu.Divider />

        <Menu.Item leftSection={<Album size={ICON_SIZE.menu} />} onClick={() => !reason && onAddToAlbum()}>
          {t("selectionactions.album")}
        </Menu.Item>

        {/* No reason here: this menu only opens with a selection (its button says why without one). */}
        <Tooltip label={t("selectionactions.tagdescription")} position="left">
          <Menu.Item
            leftSection={<Tag size={ICON_SIZE.menu} />}
            rightSection={
              <Text size="xs" c="dimmed">
                t
              </Text>
            }
            onClick={() => !reason && onAddTags()}
          >
            {t("selectionactions.tag")}
          </Menu.Item>
        </Tooltip>
      </Menu.Dropdown>
    </Menu>
  );
}
