import React, { lazy, Suspense } from "react";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { usePromptTurn } from "../prompts/promptQueue";
import { errorReportingPromptPending } from "./askAboutErrorReporting";

// Loads on first use, so the app's first chunk does not carry it.
const ErrorReportingPromptModal = lazy(async () => ({
  default: (await import("./ErrorReportingPromptModal")).ErrorReportingPromptModal,
}));

/**
 * Asks an admin once about error reporting on an instance from before it (#2938), for the signed-in
 * app shell. The answer is kept on the server, so it never shows again,
 * on any device; a new instance answered in its first-time setup and never sees it. The prompt
 * queue (`usePromptTurn`) shows it after the support thank-you dialog, never at once with another.
 */
export function ErrorReportingPrompt() {
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { data: settings } = useGetSettingsQuery();
  const show = usePromptTurn("errorReporting", errorReportingPromptPending(user, settings));
  if (!settings || !show) return null;
  return (
    <Suspense fallback={null}>
      <ErrorReportingPromptModal settings={settings} />
    </Suspense>
  );
}
