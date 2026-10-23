import { Kbd } from "@mantine/core";
import React from "react";
import { CHORD_KEY, HELP_KEY, shortcutFor, type GoToPath } from "./goToShortcuts";
import classes from "./ShortcutHint.module.css";

/** The chord that goes to `to`, next to a menu item (#2037); nothing without a keyboard. */
export function ShortcutHint({ to }: Readonly<{ to: GoToPath }>) {
  const shortcut = shortcutFor(to);
  if (!shortcut) {
    return null;
  }
  return (
    <span className={classes.hint} aria-hidden>
      <Kbd size="xs">{CHORD_KEY}</Kbd> <Kbd size="xs">{shortcut.key}</Kbd>
    </span>
  );
}

/** The key that opens the list of shortcuts, next to its menu item. */
export function HelpKeyHint() {
  return (
    <span className={classes.hint} aria-hidden>
      <Kbd size="xs">{HELP_KEY}</Kbd>
    </span>
  );
}
