import type { User } from "@librephotos/api-client";
import { createContext, useContext } from "react";

export type WhatsNew = {
  /**
   * Open the What's new dialog: on the given releases (by tag, the card's unseen ones), or without
   * them on the running release and the ones before it (the account menu and the version line).
   */
  open: (releases?: readonly string[]) => void;
};

// Outside the app shell (a component rendered on its own in a test) there is nothing to open.
const NO_WHATS_NEW: WhatsNew = { open: () => {} };

export const WhatsNewContext = createContext<WhatsNew>(NO_WHATS_NEW);

export function useWhatsNew(): WhatsNew {
  return useContext(WhatsNewContext);
}

/**
 * Whether the What's new card may have something to say, from what the app has loaded anyway; the
 * card itself then reads the bundled releases. Never for a development build, a user or a server
 * that turned it off, or a server too old to remember that the card was closed.
 */
export function cardMayShow(user: User | undefined, runningTag: string | undefined, enabled: boolean | undefined) {
  if (!user || !runningTag || runningTag === "dev" || enabled !== true) return false;
  return user.show_whats_new === true && user.last_seen_release !== undefined && user.last_seen_release !== runningTag;
}
