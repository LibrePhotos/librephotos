import { createContext, useContext } from "react";

export type Support = {
  /** Open the user's Rewind for `year` (the account menu, during the season). */
  openRewind: (year: number) => void;
};

// Outside the app shell (a component rendered on its own in a test) there is nothing to open.
const NO_SUPPORT: Support = { openRewind: () => {} };

export const SupportContext = createContext<Support>(NO_SUPPORT);

export function useSupport(): Support {
  return useContext(SupportContext);
}
