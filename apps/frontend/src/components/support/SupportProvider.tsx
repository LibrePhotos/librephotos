import type { User } from "@librephotos/api-client";
import React, { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useRewindQuery } from "../../api_client/stats/hooks/useRewindQuery";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useSaveSupportPromptStateMutation } from "../../api_client/user/hooks/useSaveSupportPromptStateMutation";
import { usePromptTurn } from "../prompts/promptQueue";
import { SupportContext, type Support } from "./supportContext";
import { rewindToOpen, rewindWorthShowing } from "./supportPrompts";
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
  const save = useSaveSupportPromptStateMutation({ reportsErrors: true });
  return (
    <RewindModal year={year} onClose={() => save.mutate({ userId: user.id, state: { rewind_seen_year: year } })} />
  );
}

/**
 * The support prompts, for the signed-in app shell: once, for an admin, a thank-you dialog when
 * their library is processed; around Christmas, each user's Rewind (their year in photos) once.
 * The prompt queue (`usePromptTurn`) shows one dialog at a time, the thank-you dialog before
 * Rewind, and none while files upload. `useSupport().openRewind()` opens Rewind from the account
 * menu during the season.
 */
export function SupportProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { data: settings } = useGetSettingsQuery();
  const save = useSaveSupportPromptStateMutation({ reportsErrors: true });
  // The year the account menu opened; null while it is closed.
  const [openedYear, setOpenedYear] = useState<number | null>(null);
  const value = useMemo<Support>(() => ({ openRewind: setOpenedYear }), []);

  const thankYouDue = useThankYouDue(user, settings);
  const autoYear = rewindToOpen(user, settings, new Date());
  const { data: rewind } = useRewindQuery(autoYear);
  const showThankYou = usePromptTurn("thankYou", user !== undefined && thankYouDue);
  const rewindDue = user !== undefined && openedYear === null && rewindWorthShowing(rewind);
  const showRewind = usePromptTurn("rewind", rewindDue);
  usePromptTurn("rewindOpened", openedYear !== null);

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
        {user && showThankYou ? <ThankYouGate user={user} /> : null}
        {user && showRewind && autoYear !== null ? <RewindGate user={user} year={autoYear} /> : null}
        {openedYear === null ? null : <RewindModal year={openedYear} onClose={closeOpened} />}
      </Suspense>
    </SupportContext.Provider>
  );
}
