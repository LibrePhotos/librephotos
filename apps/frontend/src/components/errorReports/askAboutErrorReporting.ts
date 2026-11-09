import type { SiteSettings, User } from "@librephotos/api-client";

/**
 * Whether to ask this user about error reporting (#2938): an admin, on an instance where nobody
 * answered yet (the first-time setup's step, an earlier answer and Not now all set
 * `error_reporting_asked`, which only admins receive). The prompt queue decides when it shows.
 */
export function errorReportingPromptPending(
  user: Pick<User, "is_superuser"> | undefined,
  settings: Pick<SiteSettings, "error_reporting_asked"> | undefined
): boolean {
  return user?.is_superuser === true && settings?.error_reporting_asked === false;
}
