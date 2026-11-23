import { Group, Loader, Text } from "@mantine/core";
import React from "react";
import classes from "./EditorWorkspace.module.css";

/**
 * What the editor is busy with (a save, a revert), over the workspace while it lasts. The status
 * region stays mounted, so a screen reader hears the text when it appears.
 */
export function BusyStatus({ label }: Readonly<{ label: string | null }>) {
  return (
    <div role="status" className={classes.busy} data-active={label !== null || undefined}>
      {label !== null && (
        <Group gap="xs" wrap="nowrap" className={classes.busyCard}>
          <Loader size="xs" aria-hidden />
          <Text size="sm">{label}</Text>
        </Group>
      )}
    </div>
  );
}
