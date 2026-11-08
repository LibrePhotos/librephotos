import React, { lazy, Suspense } from "react";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useThankYouDue } from "../support/useThankYouDue";
import { useUpload } from "../upload";
import { errorReportingPromptPending } from "./askAboutErrorReporting";

// Loads on first use, so the app's first chunk does not carry it.
const ErrorReportingPromptModal = lazy(async () => ({
  default: (await import("./ErrorReportingPromptModal")).ErrorReportingPromptModal,
}));

/**
 * Asks an admin once about error reporting on an instance from before it (#2938), for the signed-in
 * app shell. Not while files upload. The answer is kept on the server, so it never shows again,
 * on any device; a new instance answered in its first-time setup and never sees it. Waits while the
 * support thank-you dialog shows, so the two never open at once.
 */
export function ErrorReportingPrompt() {
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { data: settings } = useGetSettingsQuery();
  const { items: uploads } = useUpload();
  const thankYouShows = useThankYouDue(user, settings);
  if (!settings || uploads.length > 0 || !errorReportingPromptPending(user, settings, thankYouShows)) return null;
  return (
    <Suspense fallback={null}>
      <ErrorReportingPromptModal settings={settings} />
    </Suspense>
  );
}
