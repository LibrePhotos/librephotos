import type { SiteSettings, User } from "@librephotos/api-client";

/**
 * Whether to ask this user about error reporting (#2938): an admin, on an instance where nobody
 * answered yet (the first-time setup's step, an earlier answer and Not now all set
 * `error_reporting_asked`, which only admins receive). The support thank-you dialog goes first, but
 * only while it really shows (`useThankYouDue`): a library that never finishes processing keeps it
 * pending for good, and must not keep this question away too.
 */
export function errorReportingPromptPending(
  user: Pick<User, "is_superuser"> | undefined,
  settings: Pick<SiteSettings, "error_reporting_asked"> | undefined,
  thankYouShows: boolean
): boolean {
  return user?.is_superuser === true && settings?.error_reporting_asked === false && !thankYouShows;
}
