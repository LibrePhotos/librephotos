import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

/**
 * The prompts the app shows by itself, plus the dialogs the user opens that they must not land on:
 * the support thank-you, the error reporting question, this season's Rewind, What's new's card, and
 * Rewind or What's new opened from the account menu.
 */
export type PromptId = "thankYou" | "errorReporting" | "rewind" | "whatsNewCard" | "rewindOpened" | "whatsNewDialog";

/** The dialogs, first come first: of those waiting at once, the earliest here opens. */
const DIALOG_ORDER: readonly PromptId[] = ["rewindOpened", "whatsNewDialog", "thankYou", "errorReporting", "rewind"];

/** Opened by a click: they open at once, uploads or not. */
const OPENED_BY_USER: ReadonlySet<PromptId> = new Set(["rewindOpened", "whatsNewDialog"]);

/**
 * The dialog that shows next. One that shows stays until it no longer waits (it was answered or
 * closed): a dialog that became due meanwhile, or an upload that started, never takes its place.
 * Otherwise a dialog the user opened goes first; the others wait while files upload (`quiet` false).
 */
export function nextDialog(showing: PromptId | null, waiting: ReadonlySet<PromptId>, quiet: boolean): PromptId | null {
  if (showing !== null && waiting.has(showing)) return showing;
  const opened = DIALOG_ORDER.find(id => OPENED_BY_USER.has(id) && waiting.has(id));
  if (opened) return opened;
  if (!quiet) return null;
  return DIALOG_ORDER.find(id => waiting.has(id)) ?? null;
}

export type PromptQueue = {
  /** Whether `id` waits to show; a prompt that unmounts stops waiting. */
  want: (id: PromptId, wants: boolean) => void;
  /** Whether no files upload. */
  setQuiet: (quiet: boolean) => void;
  /** Whether `id` may show now. What's new's card never blocks the page: it shows when no dialog does. */
  turn: (id: PromptId) => boolean;
  subscribe: (listener: () => void) => () => void;
};

export function createPromptQueue(initiallyQuiet: boolean): PromptQueue {
  const waiting = new Set<PromptId>();
  let showing: PromptId | null = null;
  let quiet = initiallyQuiet;
  const listeners = new Set<() => void>();
  let settling = false;
  // After the commit's effects, so prompts that become due in the same render are ranked together
  // instead of the first one to register taking the screen.
  const settle = () => {
    if (settling) return;
    settling = true;
    queueMicrotask(() => {
      settling = false;
      showing = nextDialog(showing, waiting, quiet);
      listeners.forEach(listener => listener());
    });
  };
  return {
    want: (id, wants) => {
      if (wants === waiting.has(id)) return;
      if (wants) waiting.add(id);
      else waiting.delete(id);
      settle();
    },
    setQuiet: value => {
      if (value === quiet) return;
      quiet = value;
      settle();
    },
    turn: id => (id === "whatsNewCard" ? quiet && showing === null && waiting.has(id) : showing === id),
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// Outside the app shell (a component rendered on its own in a test) a prompt shows when it wants to.
export const PromptQueueContext = createContext<PromptQueue | null>(null);

const noSubscribe = () => () => {};

/**
 * Whether the prompt `id`, which `wants` to show, may show now: the app shell's queue
 * (PromptQueueProvider) lets one dialog show at a time.
 */
export function usePromptTurn(id: PromptId, wants: boolean): boolean {
  const queue = useContext(PromptQueueContext);
  useEffect(() => {
    if (!queue) return undefined;
    queue.want(id, wants);
    return () => queue.want(id, false);
  }, [queue, id, wants]);
  const turn = useSyncExternalStore(queue?.subscribe ?? noSubscribe, () => (queue ? queue.turn(id) : true));
  return wants && turn;
}
