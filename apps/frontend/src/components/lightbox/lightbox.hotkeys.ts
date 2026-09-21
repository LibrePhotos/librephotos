/**
 * Hotkey strings, spelled the way Mantine's parser reads them.
 *
 * `parseHotkey` splits on "+" and trims each part, so a literal " " arrives as
 * an empty key and matches nothing at all -- which is how play/pause came to be
 * listed in the documentation while never once firing. The name it understands
 * for that key is "space".
 *
 * They live in their own module so the tests that check them against Mantine's
 * own matcher do not have to mount the lightbox: a binding that silently never
 * fires looks exactly like a binding that works, so the spelling is worth
 * pinning down on its own.
 */
export const PLAY_PAUSE_KEY = "space";
export const SEEK_BACK_KEY = "shift+ArrowLeft";
export const SEEK_FORWARD_KEY = "shift+ArrowRight";

/**
 * The long jump, borrowed from VLC: Shift for the short one, Ctrl for the
 * long one. Ctrl is the least bad of the modifiers left -- Alt with the
 * arrows is browser back/forward on Windows and Linux, and Cmd with them is
 * back/forward on macOS. Ctrl costs Mac users running several desktops the
 * key to Mission Control, which claims it before the page ever sees it.
 */
export const SEEK_LONG_BACK_KEY = "ctrl+ArrowLeft";
export const SEEK_LONG_FORWARD_KEY = "ctrl+ArrowRight";
export const PREVIOUS_KEY = "ArrowLeft";
export const NEXT_KEY = "ArrowRight";

/**
 * Copy the photo to the clipboard. "mod" is Ctrl on Windows and Linux and
 * Cmd on macOS, the key people already press to copy. The handler steps
 * aside when text is selected (live text, the sidebar) so the browser's own
 * copy keeps working; see ContentViewer.
 */
export const COPY_KEY = "mod+c";

/** How the copy shortcut is written in tooltips and docs on this platform. */
export function copyKeyLabel(): string {
  const isApple = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return isApple ? "⌘C" : "Ctrl+C";
}
