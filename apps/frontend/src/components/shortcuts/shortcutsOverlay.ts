import { createContext, useContext } from "react";

/**
 * Opens the list of keyboard shortcuts (#2037). `null` outside the signed-in app shell (the public
 * pages share the account menu), where there are no shortcuts to list.
 */
export const ShortcutsOverlayContext = createContext<(() => void) | null>(null);

export function useOpenShortcuts(): (() => void) | null {
  return useContext(ShortcutsOverlayContext);
}
