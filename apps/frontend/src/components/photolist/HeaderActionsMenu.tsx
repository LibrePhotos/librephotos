import { ActionIcon, Menu, Popover, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAdjustmentsHorizontal, IconDots } from "@tabler/icons-react";
import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE } from "../../uiConstants";
import { toolbarLook } from "../common/toolbarLook";
import classes from "./HeaderActionsMenu.module.css";
import { ViewOptionsContext } from "./viewOptionsContext";

type Props = Readonly<{
  /** What the actions act on ("Person actions"): the button's label and tooltip. */
  label: string;
  /** The `Menu.Item`s; the destructive one last, after a `Menu.Divider`. */
  children?: React.ReactNode;
  /** The button, for a dialog opened from an item to hand focus back to when it closes. */
  triggerRef?: React.Ref<HTMLButtonElement>;
}>;

/**
 * The page header's ⋯ (Immich's and Google Photos' one overflow menu), always the last control of
 * the header: the page's less frequent actions (a person, an album, Manage faces, Empty trash)
 * and, in a photo list, "View options…" (ViewOptionsContext), which opens the display options in
 * a panel under the ⋯. A photo list with no other actions has no menu of one item (a click to
 * reach a click): its button is View options itself.
 *
 * Mantine unmounts the dropdown when an item is clicked, so a dialog an item opens is rendered
 * next to this menu, not inside it.
 */
export function HeaderActionsMenu({ label, children, triggerRef }: Props) {
  const { t } = useTranslation();
  const viewOptions = useContext(ViewOptionsContext);
  const [opened, { open, close }] = useDisclosure(false);
  const [viewOpened, view] = useDisclosure(false);
  const hasItems = React.Children.toArray(children).length > 0;
  if (!hasItems && !viewOptions) return null;
  // Neutral while open, like the toolbar's other buttons; tinted only for a state that is on.
  const neutral = toolbarLook();
  const look = { ...neutral, className: `${neutral.className} ${classes.trigger}` };

  // The display options open under the button: they hold sliders and segmented controls, which a
  // menu's arrow-key navigation would fight, so from the menu they open once it has closed.
  const withViewOptions = (button: React.ReactNode) => (
    <Popover opened={viewOpened} onClose={view.close} position="bottom-end" width={260} shadow="md" trapFocus>
      <Popover.Target>
        <span className={classes.anchor}>{button}</span>
      </Popover.Target>
      <Popover.Dropdown aria-label={t("photodisplay.settings")} role="dialog">
        {viewOptions}
      </Popover.Dropdown>
    </Popover>
  );

  if (!hasItems) {
    const viewLabel = t("photodisplay.viewoptionsbutton");
    return withViewOptions(
      <Tooltip label={viewLabel} position="bottom" disabled={viewOpened}>
        <ActionIcon
          ref={triggerRef}
          {...look}
          mod={{ open: viewOpened }}
          size={TOOLBAR_ACTION_SIZE}
          aria-label={viewLabel}
          aria-expanded={viewOpened}
          onClick={view.toggle}
        >
          <IconAdjustmentsHorizontal size={ICON_SIZE.toolbar} />
        </ActionIcon>
      </Tooltip>
    );
  }

  const menu = (
    // An item that opens a dialog would lose the dialog's focus to the returning trigger
    <Menu
      position="bottom-end"
      returnFocus={false}
      opened={opened}
      onChange={next => {
        if (!next) return close();
        view.close();
        return open();
      }}
    >
      <Menu.Target>
        {/* Hidden while the menu is open: it would sit over the first item. */}
        <Tooltip label={label} position="bottom" disabled={opened || viewOpened}>
          <ActionIcon
            ref={triggerRef}
            {...look}
            mod={{ open: opened || viewOpened }}
            size={TOOLBAR_ACTION_SIZE}
            aria-label={label}
          >
            <IconDots size={ICON_SIZE.toolbar} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {viewOptions ? (
          <>
            <Menu.Item leftSection={<IconAdjustmentsHorizontal size={ICON_SIZE.menu} />} onClick={view.open}>
              {t("photodisplay.viewoptions")}
            </Menu.Item>
            <Menu.Divider />
          </>
        ) : null}
        {children}
      </Menu.Dropdown>
    </Menu>
  );
  return viewOptions ? withViewOptions(menu) : menu;
}
