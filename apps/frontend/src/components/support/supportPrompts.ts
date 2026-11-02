import type { ProcessingStatus, Rewind, SiteSettings, User } from "@librephotos/api-client";

/** The site settings the prompts read. */
type Switches = Pick<SiteSettings, "support_prompts_enabled" | "rewind_enabled">;

/**
 * Whether the library is processed: it has photos, no stage's job is queued or running, and every
 * stage either has nothing left or ran at least once. A stage whose run left a few photos it could
 * not process still counts as done; one that never ran yet (a follow-up still to start) does not.
 */
export function libraryReady(status: ProcessingStatus | undefined): boolean {
  if (!status || status.photo_count === 0) return false;
  return status.stages.every(stage => stage.running_job === null && (stage.remaining === 0 || stage.last_run !== null));
}

/** Whether this user is asked for support at all: admins, while the server allows it. */
export function asksForSupport(user: User | undefined, settings: Switches | undefined): boolean {
  return user?.is_superuser === true && settings?.support_prompts_enabled === true;
}

/**
 * Whether the one-time thank-you dialog may still show: an admin who has not seen it, on a server
 * that sends the switch and can remember that it was closed.
 */
export function thankYouPending(user: User | undefined, settings: Switches | undefined): boolean {
  return asksForSupport(user, settings) && user?.support_prompt_seen === false;
}

/**
 * The year Rewind looks back on when `today` is in its season, 20 December to 6 January (the
 * January days look back on the year before); null outside it. In the browser's own calendar.
 */
export function rewindSeasonYear(today: Date): number | null {
  const month = today.getMonth() + 1;
  const day = today.getDate();
  if (month === 12 && day >= 20) return today.getFullYear();
  if (month === 1 && day <= 6) return today.getFullYear() - 1;
  return null;
}

/** The year whose Rewind opens by itself, once: in season, while the server allows it; else null. */
export function rewindToOpen(user: User | undefined, settings: Switches | undefined, today: Date): number | null {
  const year = rewindSeasonYear(today);
  if (year === null || settings?.rewind_enabled !== true) return null;
  const seen = user?.rewind_seen_year;
  return seen !== undefined && seen < year ? year : null;
}

/** Fewer photos than this make a thin Rewind: it does not open by itself. */
const REWIND_MIN_ITEMS = 10;

export function rewindWorthShowing(rewind: Pick<Rewind, "photo_count" | "video_count"> | undefined): boolean {
  return rewind !== undefined && rewind.photo_count + rewind.video_count >= REWIND_MIN_ITEMS;
}
