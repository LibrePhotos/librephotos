import type { ParseKeys } from "i18next";

/** The pages a `g` chord goes to (#2037). */
export type GoToPath = "/" | "/library" | "/settings" | "/admin" | "/jobs";

export type GoToShortcut = Readonly<{
  /** The second key of the chord, lower case. */
  key: string;
  to: GoToPath;
  label: ParseKeys;
  /** Only superusers have the page, so only they get the chord. */
  adminOnly: boolean;
}>;

/** The first key of every chord. */
export const CHORD_KEY = "g";
/** The key that opens the list of shortcuts. */
export const HELP_KEY = "?";
/** How long the second key of a chord may wait. */
export const CHORD_TIMEOUT_MS = 1500;

const GO_TO_SHORTCUTS: readonly GoToShortcut[] = [
  { key: "p", to: "/", label: "sidemenu.photos", adminOnly: false },
  { key: "l", to: "/library", label: "topmenu.library", adminOnly: false },
  { key: "s", to: "/settings", label: "topmenu.settings", adminOnly: false },
  { key: "a", to: "/admin", label: "topmenu.adminarea", adminOnly: true },
  { key: "j", to: "/jobs", label: "topmenu.jobs", adminOnly: false },
];

/** The chords this user has. */
export function goToShortcuts(isAdmin: boolean): readonly GoToShortcut[] {
  return GO_TO_SHORTCUTS.filter(shortcut => isAdmin || !shortcut.adminOnly);
}

/** The chord that goes to `to`, for the hints next to menu items. */
export function shortcutFor(to: GoToPath): GoToShortcut | undefined {
  return GO_TO_SHORTCUTS.find(shortcut => shortcut.to === to);
}

type KeyPress = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat">;

/** What a key press does: start a chord, finish one, open the list, or nothing (which ends a chord). */
export type ChordStep = { kind: "start" } | { kind: "go"; to: GoToPath } | { kind: "help" } | { kind: "none" };

const NOTHING: ChordStep = { kind: "none" };

export function readKey(press: KeyPress, pending: boolean, isAdmin: boolean): ChordStep {
  // Browser and system shortcuts (Ctrl+G finds again) stay theirs; a held key is not a chord.
  if (press.ctrlKey || press.metaKey || press.altKey || press.repeat) {
    return NOTHING;
  }
  if (pending) {
    const key = press.key.toLowerCase();
    const shortcut = goToShortcuts(isAdmin).find(candidate => candidate.key === key);
    return shortcut ? { kind: "go", to: shortcut.to } : NOTHING;
  }
  if (press.key === CHORD_KEY) {
    return { kind: "start" };
  }
  return press.key === HELP_KEY ? { kind: "help" } : NOTHING;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Whether a key press belongs to something else: typing in a field, or an open dialog (the lightbox
 * has its own single keys, `g` among them, and a chord must not leave an edit dialog behind).
 */
export function belongsElsewhere(target: EventTarget | null, doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"][aria-modal="true"]')) {
    return true;
  }
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return TYPING_TAGS.has(target.tagName) || target.isContentEditable || target.closest('[role="dialog"]') !== null;
}
