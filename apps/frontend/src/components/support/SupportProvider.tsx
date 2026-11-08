import type { User } from "@librephotos/api-client";
import React, { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useRewindQuery } from "../../api_client/stats/hooks/useRewindQuery";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useSaveSupportPromptStateMutation } from "../../api_client/user/hooks/useSaveSupportPromptStateMutation";
import { useUpload } from "../upload";
import { SupportContext, type Support } from "./supportContext";
import { rewindToOpen, rewindWorthShowing, thankYouPending } from "./supportPrompts";
import { useThankYouDue } from "./useThankYouDue";

// Both load on first use, so the app's first chunk does not carry them.
const ThankYouModal = lazy(async () => ({ default: (await import("./ThankYouModal")).ThankYouModal }));
const RewindModal = lazy(async () => ({ default: (await import("./rewind/RewindModal")).RewindModal }));

/** The thank-you dialog, mounted once it is due (`useThankYouDue`). */
function ThankYouGate({ user }: Readonly<{ user: User }>) {
  const save = useSaveSupportPromptStateMutation({ reportsErrors: true });
  return <ThankYouModal onClose={() => save.mutate({ userId: user.id, state: { support_prompt_seen: true } })} />;
}

/** This season's Rewind, opened by itself once, when the year has enough photos. */
function RewindGate({ user, year }: Readonly<{ user: User; year: number }>) {
  const { data: rewind } = useRewindQuery(year);
  const save = useSaveSupportPromptStateMutation({ reportsErrors: true });
  if (!rewindWorthShowing(rewind)) return null;
  return (
    <RewindModal year={year} onClose={() => save.mutate({ userId: user.id, state: { rewind_seen_year: year } })} />
  );
}

/**
 * The support prompts, for the signed-in app shell: once, for an admin, a thank-you dialog when
 * their library is processed; around Christmas, each user's Rewind (their year in photos) once.
 * Neither shows while files upload, and Rewind waits for the thank-you dialog.
 * `useSupport().openRewind()` opens Rewind from the account menu during the season.
 */
export function SupportProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { data: settings } = useGetSettingsQuery();
  const { items: uploads } = useUpload();
  const save = useSaveSupportPromptStateMutation({ reportsErrors: true });
  // The year the account menu opened; null while it is closed.
  const [openedYear, setOpenedYear] = useState<number | null>(null);
  const value = useMemo<Support>(() => ({ openRewind: setOpenedYear }), []);

  const quiet = uploads.length === 0;
  // Pending and the library processed: the error reporting question asks the same hook.
  const thankYou = useThankYouDue(user, settings);
  const autoYear = thankYouPending(user, settings) ? null : rewindToOpen(user, settings, new Date());

  const closeOpened = () => {
    if (user && openedYear !== null && (user.rewind_seen_year ?? 0) < openedYear) {
      save.mutate({ userId: user.id, state: { rewind_seen_year: openedYear } });
    }
    setOpenedYear(null);
  };

  return (
    <SupportContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        {user && quiet && thankYou ? <ThankYouGate user={user} /> : null}
        {user && quiet && autoYear !== null && openedYear === null ? <RewindGate user={user} year={autoYear} /> : null}
        {openedYear === null ? null : <RewindModal year={openedYear} onClose={closeOpened} />}
      </Suspense>
    </SupportContext.Provider>
  );
}
