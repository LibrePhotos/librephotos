import React from "react";
import type { ReactNode } from "react";
import { UnsavedDraftsContext } from "../lightbox/unsavedDrafts";
import { useDraftsLeaveGuard, useUnsavedDrafts } from "../lightbox/useUnsavedDraftsGuard";
import { LeaveWithoutSavingModal } from "../settings/LeaveWithoutSavingModal";

/**
 * The photo page's cards edit like the lightbox's panel (#2284): while one holds an unsaved edit,
 * Back or a link (a similar photo, a tag) asks "Leave without saving?", as the settings pages do,
 * and a reload asks through the browser.
 */
export function PhotoPageDraftsGuard({ children }: Readonly<{ children: ReactNode }>) {
  const drafts = useUnsavedDrafts();
  const { blocker } = useDraftsLeaveGuard(drafts);
  return (
    <UnsavedDraftsContext.Provider value={drafts}>
      {children}
      <LeaveWithoutSavingModal
        opened={blocker.status === "blocked"}
        onClose={() => blocker.reset?.()}
        onLeave={() => blocker.proceed?.()}
      />
    </UnsavedDraftsContext.Provider>
  );
}
