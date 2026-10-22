import type { ParseKeys } from "i18next";

/**
 * Why a video did not play, and the seek shortcuts' steps: the parts of the player that are plain
 * data and functions, kept apart from the component so they are tested on their own.
 */

/** How far one press of a seek shortcut moves the playhead, in seconds. */
export const SEEK_STEP_SECONDS = 10;

/** The same, for the long jump on Ctrl -- VLC's split between the two. */
export const SEEK_LONG_STEP_SECONDS = 60;

/** "+10s", "-1m": whole minutes read better than "+60s" once past a minute. */
export function formatSeekDistance(seconds: number): string {
  const sign = seconds > 0 ? "+" : "-";
  const size = Math.abs(seconds);
  return size >= 60 && size % 60 === 0 ? `${sign}${size / 60}m` : `${sign}${size}s`;
}

/**
 * What actually went wrong. A `<video>` element only ever reports *that* it
 * failed -- `error.code` distinguishes a network problem from an undecodable
 * stream and nothing more -- so these are recovered by re-requesting the same
 * URL and reading the HTTP status, which is the only place the difference lives.
 */
export type VideoErrorKind = "permission" | "missing" | "format" | "server" | "session" | "unknown";

/**
 * Turn the probe's HTTP response into a cause.
 *
 * A 200 here is the interesting one: the file was delivered whole and the
 * browser still refused it, which is the *only* circumstance in which blaming
 * the format is honest. The player used to say that about every failure.
 *
 * 403 is ambiguous by nature -- an expired session and a file the web server
 * cannot open both produce one -- so the backend marks its own refusals with
 * `X-Media-Error`. Without the header the far likelier cause is the file, and
 * that is what an unmarked 403 is read as.
 */
export function classifyVideoFailure(status: number, mediaError: string | null): VideoErrorKind {
  if (status >= 200 && status < 300) return "format";
  if (status === 401) return "session";
  if (status === 403) return mediaError === "authentication" ? "session" : "permission";
  if (status === 404) return "missing";
  return "server";
}

/**
 * One line of the diagnosis. Kept as data rather than JSX because the same line
 * has to be both rendered and copied to the clipboard, and building those
 * separately is how the copied report silently stops matching the panel.
 */
export type DiagnosticFact = { label: string; code?: string; suffix?: string };

export function factToText({ label, code, suffix }: DiagnosticFact): string {
  return [label, code, suffix ? `- ${suffix}` : undefined].filter(Boolean).join(" ");
}

export const REMEDY_KEYS: Partial<Record<string, ParseKeys>> = {
  chmod: "lightbox.videoerror.remedychmod",
  mount_options: "lightbox.videoerror.remedymountoptions",
  mount_deeper: "lightbox.videoerror.remedymountdeeper",
  read_only: "lightbox.videoerror.remedyreadonly",
  network_fs: "lightbox.videoerror.remedynetworkfs",
  labels: "lightbox.videoerror.remedylabels",
};
