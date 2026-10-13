import type { TooltipProps } from "@mantine/core";
import { Menu, Portal, Text, Tooltip, VisuallyHidden } from "@mantine/core";
import clsx from "clsx";
import React, { cloneElement, useId } from "react";
import classes from "./DisabledReason.module.css";

/** The props DisabledReason sets on its control: any Mantine Button, ActionIcon or Menu.Item takes them. */
type ControlProps = {
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  className?: string;
  "aria-disabled"?: boolean;
  "aria-describedby"?: string;
  "data-disabled"?: boolean;
  /** Menu.Item only. */
  closeMenuOnClick?: boolean;
};

type DisabledReasonProps = Readonly<{
  /** Why the control cannot be used right now. Empty (`undefined`, `null`, `false`, "") means it can. */
  reason?: string | false | null;
  /** The control's own tooltip (what it does), shown whether or not it is disabled. */
  label?: string;
  position?: TooltipProps["position"];
  /** Holds the enabled control's tooltip open, e.g. to confirm a copy. */
  opened?: boolean;
  /**
   * One control, without a `disabled` prop: DisabledReason disables it. A menu's button goes in with
   * its Menu.Target around it, so the reason's click handler replaces the one that opens the menu.
   */
  children: React.ReactElement<ControlProps>;
}>;

const REASON_EVENTS = { hover: true, focus: true, touch: true };

/**
 * A control that says why it is disabled (#2237).
 *
 * A `disabled` button fires no mouse or focus events, so a Tooltip around it never opens and the
 * explanation it holds is lost. With a reason, the control is marked `data-disabled` (Mantine's
 * disabled look) and `aria-disabled` instead, stays focusable, ignores clicks, and shows the reason
 * on hover, keyboard focus and touch; screen readers get it through `aria-describedby`.
 * A Menu.Item gets no `data-disabled`, which Mantine's arrow keys skip (#2592): it keeps its place in
 * the keyboard order, takes the disabled look from DisabledReason.module.css and leaves the menu open.
 * Lint bans a Tooltip around a `disabled` control (`ban/tooltip-disabled-control`), a `disabled`
 * Menu.Item (`ban/menu-item-disabled`) and a `disabled` menu button (`ban/menu-target-disabled`, #2621).
 */
export function DisabledReason({ reason, label, position, opened, children }: DisabledReasonProps) {
  const reasonId = useId();

  if (!reason) {
    return label ? (
      <Tooltip label={label} position={position} opened={opened}>
        {children}
      </Tooltip>
    ) : (
      children
    );
  }

  const isMenuItem = children.type === Menu.Item;
  const control = cloneElement(children, {
    ...(isMenuItem
      ? { className: clsx(children.props.className, classes.menuItem), closeMenuOnClick: false }
      : { "data-disabled": true }),
    "aria-disabled": true,
    "aria-describedby": reasonId,
    // What a disabled button does: nothing, and the click does not reach a form or a parent either.
    onClick: event => {
      event.preventDefault();
      event.stopPropagation();
    },
  });

  return (
    <>
      <Tooltip
        position={position}
        events={REASON_EVENTS}
        multiline
        maw={280}
        label={
          label ? (
            <>
              <Text size="sm">{label}</Text>
              <Text size="xs" opacity={0.8}>
                {reason}
              </Text>
            </>
          ) : (
            reason
          )
        }
      >
        {control}
      </Tooltip>
      {/* Outside the control's parent, so it does not become a sibling in a ButtonGroup or flex row. */}
      <Portal>
        <VisuallyHidden id={reasonId}>{reason}</VisuallyHidden>
      </Portal>
    </>
  );
}
