import { useHotkeys } from "@mantine/hooks";
import { useEffect, useRef } from "react";

/** The before/after comparison key, held down. */
const COMPARE_KEY = "\\";

/** How a Ctrl (⌘ on Apple devices) shortcut is written in a label: "Ctrl+Z", "⌘Z". */
export function modShortcut(key: string): string {
  const isApple = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return isApple ? `⌘${key.replace("Shift+", "⇧")}` : `Ctrl+${key}`;
}

/** A key typed into a field is the field's. */
function typesText(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

type Keys = Readonly<{
  undo: () => void;
  redo: () => void;
  /** The backslash is held down (true) or let go (false). */
  onCompare: (holding: boolean) => void;
  onEscape: (event: KeyboardEvent) => void;
}>;

/**
 * The editor's keys: Ctrl+Z (⌘Z) undoes, Ctrl+Shift+Z and Ctrl+Y redo, the backslash shows the
 * original while held, Escape leaves (the caller decides what it leaves first). None act while a
 * text field has the focus.
 */
export function useEditorHotkeys({ undo, redo, onCompare, onEscape }: Keys) {
  useHotkeys([
    ["mod+Z", undo],
    ["mod+shift+Z", redo],
    ["mod+Y", redo],
    ["Escape", onEscape],
  ]);
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
