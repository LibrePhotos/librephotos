import React from "react";
import classes from "./menuShortcut.module.css";

/** Whether this is a Mac or an iPhone or iPad, where the shortcuts take ⌘ instead of Ctrl. */
function isApple() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/**
 * A menu item's keyboard shortcut, as Apple and Google menus show one: dimmed at the end of the row,
 * not in the label. `key` is the key the item's shortcut handler listens for ("Z"), with `mod` for
 * Ctrl, or ⌘ on Apple devices ("mod+C"). Spread the result on a `Menu.Item`: it sets the hint as the
 * item's right section and the shortcut as its `aria-keyshortcuts`, so the hint stays out of the
 * item's name. Hidden on touch screens and in a phone's sheet (menuTheme.module.css).
 */
export function menuShortcut(key: string) {
  const modifier = key.startsWith("mod+");
  const rest = modifier ? key.slice("mod+".length) : key;
  // A letter as the key cap shows it ("mod+c" is ⌘C)
  const base = rest.length === 1 ? rest.toUpperCase() : rest;
  let label = base;
  if (modifier) label = isApple() ? `⌘${base}` : `Ctrl+${base}`;
  const aria = modifier ? `${isApple() ? "Meta" : "Control"}+${base}` : base;
  return {
    // Drawn by CSS from `data-keys`, so it stays out of the item's text as well as its name.
    rightSection: <kbd className={classes.shortcut} data-menu-shortcut data-keys={label} aria-hidden />,
    "aria-keyshortcuts": aria,
  };
}
