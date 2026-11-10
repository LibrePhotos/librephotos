import type { SiteSettings, User } from "@librephotos/api-client";
import { useProcessingStatusUntil } from "../../api_client/jobs/hooks/useProcessingStatus";
import { libraryReady, thankYouPending } from "./supportPrompts";

/**
 * Whether the one-time thank-you dialog is due: it is pending for this admin and their library is
 * processed. Reads the processing status only while the dialog is pending, once a minute until the
 * library is ready.
 */
export function useThankYouDue(
  user: Pick<User, "is_superuser" | "support_prompt_seen"> | undefined,
  settings: Pick<SiteSettings, "support_prompts_enabled"> | undefined
): boolean {
  const pending = thankYouPending(user, settings);
  const { data: status } = useProcessingStatusUntil(pending, libraryReady);
  return pending && libraryReady(status);
}
