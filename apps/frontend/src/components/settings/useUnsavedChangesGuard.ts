import { useBlocker } from "@tanstack/react-router";

type Location = Readonly<{ pathname: string }>;

/** Only leaving the page counts: picking a section changes the hash of the same page. */
const leavesThePage = ({ current, next }: Readonly<{ current: Location; next: Location }>) =>
  current.pathname !== next.pathname;

/**
 * While `dirty`, following a link to another page waits for the user (the returned blocker is
 * `blocked`: `proceed` leaves, `reset` stays) and closing or reloading the tab asks through the
 * browser's own dialog. Used by `SaveChangesDialog`, which is open exactly while a page holds
 * unsaved edits (#2224).
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  return useBlocker({
    shouldBlockFn: leavesThePage,
    enableBeforeUnload: true,
    disabled: !dirty,
    withResolver: true,
  });
}
