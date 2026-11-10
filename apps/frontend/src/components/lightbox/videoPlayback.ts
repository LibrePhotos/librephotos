import type { VideoErrorKind } from "./videoFailure";

/** Which stream the element plays: the original, or the conversion once the browser refused it. */
type VideoSource = "original" | "conversion";

type Common = Readonly<{
  source: VideoSource;
  /** Bumped by Retry, so the element is made afresh. */
  attempt: number;
}>;

/**
 * One video's way to playing. After an error the HEAD probe works out why: `quiet` while a
 * conversion is still in reserve (the spinner stays up, as the probe most likely ends in it),
 * otherwise the error panel says it is checking. Only `ready` plays.
 */
export type VideoPlayback = Common &
  (
    | Readonly<{ phase: "loading" }>
    | Readonly<{ phase: "ready" }>
    | Readonly<{ phase: "probing"; quiet: boolean }>
    | Readonly<{ phase: "failed"; kind: VideoErrorKind; status: number | null }>
  );

export type VideoPlaybackEvent =
  | Readonly<{ type: "canPlay" }>
  | Readonly<{ type: "error"; hasConversion: boolean }>
  | Readonly<{ type: "probed"; kind: VideoErrorKind; status: number | null; hasConversion: boolean }>
  | Readonly<{ type: "retry" }>;

export const initialPlayback = (): VideoPlayback => ({ phase: "loading", source: "original", attempt: 0 });

/** Whether a conversion is left to try for this error. */
function mayConvert(state: VideoPlayback, hasConversion: boolean) {
  return hasConversion && state.source === "original";
}

export function nextPlayback(state: VideoPlayback, event: VideoPlaybackEvent): VideoPlayback {
  const { source, attempt } = state;
  switch (event.type) {
    // The element fires canplay again after every seek; only the first one ends the loading.
    case "canPlay":
      return state.phase === "loading" ? { phase: "ready", source, attempt } : state;
    case "error":
      if (state.phase !== "loading" && state.phase !== "ready") return state;
      return { phase: "probing", source, attempt, quiet: mayConvert(state, event.hasConversion) };
    case "probed":
      if (state.phase !== "probing") return state;
      // The file arrived whole and the browser still refused it, which is the one failure a
      // conversion fixes: convert before saying anything.
      if (event.kind === "format" && mayConvert(state, event.hasConversion)) {
        return { phase: "loading", source: "conversion", attempt };
      }
      return { phase: "failed", source, attempt, kind: event.kind, status: event.status };
    case "retry":
      return { phase: "loading", source, attempt: attempt + 1 };
  }
}

/** The cause the panel names: while a loud probe runs, the old wording until it knows better. */
export function shownError(state: VideoPlayback): { kind: VideoErrorKind; status: number | null } | null {
  if (state.phase === "failed") return { kind: state.kind, status: state.status };
  if (state.phase === "probing" && !state.quiet) return { kind: "unknown", status: null };
  return null;
}
