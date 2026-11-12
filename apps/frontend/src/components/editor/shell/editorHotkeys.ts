import { useHotkeys, type HotkeyItem } from "@mantine/hooks";
import { useEffect, useRef } from "react";

/** The before/after comparison key, held down. */
const COMPARE_KEY = "\\";

/** How a Ctrl (⌘ on Apple devices) shortcut is written in a label: "Ctrl+Z", "⌘Z". */
export function modShortcut(key: string): string {
  const isApple = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return isApple ? `⌘${key.replace("Shift+", "⇧")}` : `Ctrl+${key}`;
}

/** Inputs that take typed text; a radio (the Simple | Advanced switch) or a checkbox does not. */
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

/** A key typed into a field is the field's; one pressed on a switch or a button is the editor's. */
function typesText(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLElement && (target.isContentEditable || ["TEXTAREA", "SELECT"].includes(target.tagName));
}

/** A hotkey that leaves a text field's keys to it (its own undo, a typed Y): handled, and its default stopped, elsewhere. */
const outsideText = (keys: string, run: (event: KeyboardEvent) => void): HotkeyItem => [
  keys,
  event => {
    if (typesText(event.target)) return;
    event.preventDefault();
    run(event);
  },
  { preventDefault: false },
];

type Keys = Readonly<{
  undo: () => void;
  redo: () => void;
  /** The backslash is held down (true) or let go (false). */
  onCompare: (holding: boolean) => void;
  onEscape: (event: KeyboardEvent) => void;
  copy: () => void;
  paste: () => void;
  /** Y: the split view on or off. */
  toggleSplit: () => void;
}>;

/**
 * The editor's keys: Ctrl+Z (⌘Z) undoes, Ctrl+Shift+Z and Ctrl+Y redo, the backslash shows the
 * original while held, Y switches the split view, Ctrl+Shift+C and Ctrl+Shift+V copy and paste the
 * settings, Escape leaves (the caller decides what it leaves first). None act while a text field has
 * the focus.
 */
export function useEditorHotkeys({ undo, redo, onCompare, onEscape, copy, paste, toggleSplit }: Keys) {
  // Mantine skips every <input> by default, the Simple | Advanced radios too: typesText decides instead.
  useHotkeys(
    [
      outsideText("mod+Z", undo),
      outsideText("mod+shift+Z", redo),
      outsideText("mod+Y", redo),
      outsideText("mod+shift+C", copy),
      outsideText("mod+shift+V", paste),
      outsideText("Y", toggleSplit),
      outsideText("Escape", onEscape),
    ],
    []
  );
  const compare = useRef(onCompare);
  useEffect(() => {
    compare.current = onCompare;
  });
  useEffect(() => {
    let holding = false;
    const down = (event: KeyboardEvent) => {
      if (event.key !== COMPARE_KEY || event.repeat || typesText(event.target)) return;
      holding = true;
      compare.current(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key !== COMPARE_KEY || !holding) return;
      holding = false;
      compare.current(false);
    };
    const release = () => {
      if (!holding) return;
      holding = false;
      compare.current(false);
    };
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, []);
}
