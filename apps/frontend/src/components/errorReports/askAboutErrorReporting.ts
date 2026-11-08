import type { SiteSettings, User } from "@librephotos/api-client";
import { thankYouPending } from "../support/supportPrompts";

/**
 * Whether to ask this user about error reporting (#2938): an admin, on an instance where nobody
 * answered yet (the first-time setup's step, an earlier answer and Not now all set
 * `error_reporting_asked`, which only admins receive). The support thank-you dialog goes first.
 */
export function errorReportingPromptPending(
  user: Pick<User, "is_superuser" | "support_prompt_seen"> | undefined,
  settings: Pick<SiteSettings, "error_reporting_asked" | "support_prompts_enabled"> | undefined
): boolean {
  return user?.is_superuser === true && settings?.error_reporting_asked === false && !thankYouPending(user, settings);
}
