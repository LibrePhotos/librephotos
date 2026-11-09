import { useDisclosure } from "@mantine/hooks";
import React, { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useFetchImageTagQuery } from "../../api_client/server";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { usePromptTurn } from "../prompts/promptQueue";
import { cardMayShow, WhatsNewContext, type WhatsNew } from "./whatsNewContext";

// Both load on first use with the bundled release list, so the app's first chunk does not carry them.
const WhatsNewCard = lazy(async () => ({ default: (await import("./WhatsNewCard")).WhatsNewCard }));
const WhatsNewModal = lazy(async () => ({ default: (await import("./WhatsNewModal")).WhatsNewModal }));

/**
 * The What's new card and dialog (#2305), for the signed-in app shell. After an update, each user
 * sees a small card once (it never blocks the page, and waits while a dialog or the upload card is open);
 * `useWhatsNew().open()` opens the dialog from the account menu and the sidebar's version line.
 */
export function WhatsNewProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [opened, dialog] = useDisclosure(false);
  // The releases the dialog shows; null for the running release and the ones before it.
  const [releases, setReleases] = useState<readonly string[] | null>(null);
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { data: imageInfos } = useFetchImageTagQuery();
  const { data: settings } = useGetSettingsQuery();
  const runningTag = imageInfos?.image_tag ?? "";

  const value = useMemo<WhatsNew>(
    () => ({
      open: tags => {
        setReleases(tags ?? null);
        dialog.open();
      },
    }),
    [dialog]
  );
  // The card waits for any dialog and for the upload card (the prompt queue); the dialog holds the others back.
  const showCard = usePromptTurn("whatsNewCard", cardMayShow(user, runningTag, settings?.whats_new_enabled) && !opened);
  usePromptTurn("whatsNewDialog", opened);

  return (
    <WhatsNewContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        {showCard && user ? <WhatsNewCard user={user} runningTag={runningTag} onSeeWhatsNew={value.open} /> : null}
        {opened ? <WhatsNewModal opened onClose={dialog.close} releases={releases} /> : null}
      </Suspense>
    </WhatsNewContext.Provider>
  );
}
