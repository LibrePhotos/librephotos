/**
 * What the editor's panels work with, by context: the session and its commands, the source's size,
 * whether the crop tool is up, and the preview (for a histogram). A panel the advanced mode adds
 * reads everything from `useEditor()`.
 */
import { createContext, useContext } from "react";
import type { PreviewRenderer } from "./editorServices";
import type { EditSource } from "./engine/editSource";
import type { Size } from "./engine/geometry";
import type { EditSession } from "./state/session";
import type { SessionCommands } from "./state/useEditSession";

/** The preview as drawn: the renderer, and a signal after each frame it drew. */
export type PreviewHandle = Readonly<{
  /** The renderer, once the canvas has one; null before and after. */
  renderer: () => PreviewRenderer | null;
  /** Called after every frame the preview draws; returns the unsubscribe. Read the histogram throttled. */
  onFrame: (listener: () => void) => () => void;
}>;

export type EditorApi = Readonly<{
  session: EditSession;
  commands: SessionCommands;
  /** The photo's edit source (the presets panel draws its thumbnails from it). */
  source: EditSource;
  /** The preview has drawn its first frame: work off the critical path may start. */
  ready: boolean;
  /** The edit source's size (upright, in its own pixels): the crop tool's geometry is in these. */
  sourceSize: Size;
  /** The crop tool is up: the canvas shows the full frame with the crop's frame over it. */
  cropActive: boolean;
  setCropActive: (active: boolean) => void;
  preview: PreviewHandle;
}>;

export const EditorContext = createContext<EditorApi | null>(null);

/** The editor around a panel; throws outside one (a panel is only ever rendered inside). */
export function useEditor(): EditorApi {
  const editor = useContext(EditorContext);
  if (editor === null) throw new Error("useEditor outside the photo editor");
  return editor;
}
