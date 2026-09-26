import type React from "react";

/**
 * Props that turn a non-interactive element (a Mantine Group, a Card section)
 * into something keyboard and screen reader users can operate like a button:
 * it is announced as a button, sits in the tab order, and Enter or Space
 * activate it just as a click does.
 *
 * Prefer a real <button> (UnstyledButton, Anchor component="button") where the
 * markup allows it; this is for wrappers whose layout component cannot be one.
 */
export function buttonRoleProps(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      // Only the element itself: keys pressed on something focusable inside it
      // belong to that control.
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        // Space would otherwise scroll the page.
        event.preventDefault();
        onActivate();
      }
    },
  };
}
