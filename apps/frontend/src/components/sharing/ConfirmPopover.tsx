import { Button, Group, Popover, Stack, Text, Tooltip } from "@mantine/core";
import React, { cloneElement, useState } from "react";
import type { MouseEvent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

type TriggerProps = {
  onClick?: (event: MouseEvent) => void;
  "aria-haspopup"?: "dialog";
  "aria-expanded"?: boolean;
};

type Props = Readonly<{
  /** What happens, in a sentence; shown above the buttons. */
  message: string;
  confirmLabel: string;
  color?: string;
  /** A tooltip for an icon-only control. */
  tooltip?: string;
  onConfirm: () => void;
  /** The control that asks; its own onClick is replaced by opening the popover. */
  children: ReactElement<TriggerProps>;
}>;

/**
 * Ask once before an action that cannot be undone, such as replacing or
 * revoking a share link someone may already have. A popover rather than a
 * modal, so it also works inside the share dialog without stacking dialogs.
 */
export function ConfirmPopover({ message, confirmLabel, color, tooltip, onConfirm, children }: Props) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  // The roles are set here rather than by Popover (withRoles): Popover.Target
  // hands them to its direct child, which is the Tooltip when there is one, and
  // the Tooltip would pass them on to its own bubble instead of the control.
  const trigger = cloneElement(children, {
    onClick: () => setOpened(o => !o),
    "aria-haspopup": "dialog",
    "aria-expanded": opened,
  });

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      withRoles={false}
      withArrow
      trapFocus
      // Back to the control that asked, not <body>, when the popover closes.
      returnFocus
      position="bottom-end"
      shadow="md"
    >
      <Popover.Target>
        {tooltip ? (
          <Tooltip label={tooltip} withArrow disabled={opened}>
            {trigger}
          </Tooltip>
        ) : (
          trigger
        )}
      </Popover.Target>
      <Popover.Dropdown role="dialog" aria-label={confirmLabel}>
        <Stack gap="xs" maw={260}>
          <Text size="sm">{message}</Text>
          {/* Focus is trapped on these buttons. Inside a Modal, Escape is heard
              on window first and closes the whole dialog unless the focused
              element opts out; it should only close this popover. */}
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setOpened(false)} data-mantine-stop-propagation>
              {t("cancel")}
            </Button>
            <Button
              size="xs"
              color={color}
              data-mantine-stop-propagation
              onClick={() => {
                setOpened(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
