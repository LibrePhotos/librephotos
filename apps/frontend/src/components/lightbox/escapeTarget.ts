/**
 * Whether an Escape keypress is a full-screen view's to handle (the lightbox, the photo editor). A
 * dialog opened on top of it (naming a face, picking a location, the share link, a question)
 * portals its own `role="dialog"` and closes itself on Escape, and Mantine marks an open menu or
 * combobox the same way it does for its own modals; the view must not close with them.
 */
export function escapeTargetsDialog(target: EventTarget | null, viewDialog: Element | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.getAttribute("data-mantine-stop-propagation") === "true") return false;
  const dialog = target.closest('[role="dialog"]');
  return !dialog || dialog === viewDialog;
}
