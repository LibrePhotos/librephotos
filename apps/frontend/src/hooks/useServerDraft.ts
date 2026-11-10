import { useReducer, useRef } from "react";

/**
 * An edit of a value the server stores, as one state machine instead of a local copy that an
 * effect overwrites on every fetch:
 *
 * - `clean`: nothing edited, the server's value shows and follows every fetch;
 * - `editing`: a draft shows, and a fetch (window focus, another save) leaves it alone;
 * - `saving`: the draft is on its way. Only the newest save settles it: an older one finishing
 *   late changes nothing.
 */
export type DraftState<T> =
  { status: "clean" } | { status: "editing"; draft: T } | { status: "saving"; draft: T; seq: number };

/** What a settled save leaves: the server's value, or the draft to fix and save again. */
type Outcome = "saved" | "reverted" | "kept";

export type DraftAction<T> =
  | { type: "edit"; draft: T }
  | { type: "update"; update: (current: T) => T; server: T }
  | { type: "save"; draft: T; seq: number }
  | { type: "settled"; seq: number; outcome: Outcome }
  | { type: "discard" };

const CLEAN = { status: "clean" } as const;

export function draftReducer<T>(state: DraftState<T>, action: DraftAction<T>): DraftState<T> {
  switch (action.type) {
    case "edit":
      return { status: "editing", draft: action.draft };
    case "update":
      return { status: "editing", draft: action.update(state.status === "clean" ? action.server : state.draft) };
    case "save":
      return { status: "saving", draft: action.draft, seq: action.seq };
    case "settled":
      if (state.status !== "saving" || state.seq !== action.seq) return state;
      return action.outcome === "kept" ? { status: "editing", draft: state.draft } : CLEAN;
    case "discard":
      return CLEAN;
  }
}

type Options<T> = Readonly<{
  /** Stores the value; resolves whether the server took it, and never rejects. */
  save: (value: T) => Promise<boolean>;
  isEqual?: (a: T, b: T) => boolean;
  /** A refused save keeps the draft to fix (a form with a Save button) instead of showing the server's value. */
  keepOnFailure?: boolean;
}>;

/**
 * Edits `server` through `draftReducer`. `commit` saves the draft (or the value given), and skips
 * the request when nothing changed; it resolves whether the value is stored.
 */
export function useServerDraft<T>(server: T, { save, isEqual = Object.is, keepOnFailure = false }: Options<T>) {
  const [state, dispatch] = useReducer(draftReducer<T>, CLEAN);
  const lastSeq = useRef(0);
  // Saves not settled yet, also ones an edit has since taken the draft from.
  const inFlight = useRef(0);
  const value = state.status === "clean" ? server : state.draft;

  const commit = async (next: T = value): Promise<boolean> => {
    // While a save runs the server may not hold `next` yet, so even an unchanged value is sent.
    if (inFlight.current === 0 && isEqual(next, server)) {
      dispatch({ type: "discard" });
      return true;
    }
    const seq = ++lastSeq.current;
    dispatch({ type: "save", draft: next, seq });
    inFlight.current += 1;
    const saved = await save(next);
    inFlight.current -= 1;
    dispatch({ type: "settled", seq, outcome: saved ? "saved" : keepOnFailure ? "kept" : "reverted" });
    return saved;
  };

  return {
    value,
    status: state.status,
    /** The value shown differs from the server's. */
    dirty: state.status !== "clean" && !isEqual(value, server),
    edit: (draft: T) => dispatch({ type: "edit", draft }),
    /** An edit built on the draft as it is when React applies it, so two edits in one event both count. */
    update: (update: (current: T) => T) => dispatch({ type: "update", update, server }),
    commit,
    discard: () => dispatch({ type: "discard" }),
  };
}
