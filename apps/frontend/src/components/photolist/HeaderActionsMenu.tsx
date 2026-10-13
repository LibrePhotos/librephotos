import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDotsVertical } from "@tabler/icons-react";
import React from "react";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE } from "../../uiConstants";

type Props = Readonly<{
  /** What the actions act on ("Person actions"): the button's label and tooltip. */
  label: string;
  /** The `Menu.Item`s; the destructive one last, after a `Menu.Divider`. */
  children: React.ReactNode;
  /** The button, for a dialog opened from an item to hand focus back to when it closes. */
  triggerRef?: React.Ref<HTMLButtonElement>;
}>;

/**
 * The "⋮" for page-level actions in a photo list's header toolbar (`PhotoListView`'s
 * `headerActions`): a person, an album. It looks like the display-settings button next to it.
 *
 * Mantine unmounts the dropdown when an item is clicked, so a dialog an item opens is rendered
 * next to this menu, not inside it.
 */
export function HeaderActionsMenu({ label, children, triggerRef }: Props) {
  const [opened, { open, close }] = useDisclosure(false);
  return (
    // An item that opens a dialog would lose the dialog's focus to the returning trigger
    <Menu position="bottom-end" returnFocus={false} opened={opened} onChange={next => (next ? open() : close())}>
      <Menu.Target>
        {/* Hidden while the menu is open: it would sit over the first item. */}
        <Tooltip label={label} position="bottom" disabled={opened}>
          <ActionIcon ref={triggerRef} variant="default" size={TOOLBAR_ACTION_SIZE} aria-label={label}>
            <IconDotsVertical size={ICON_SIZE.toolbar} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>{children}</Menu.Dropdown>
    </Menu>
  );
}
