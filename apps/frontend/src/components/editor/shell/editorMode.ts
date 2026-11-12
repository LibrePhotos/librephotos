import { z } from "zod";
import { STORAGE_KEYS, useStoredState } from "../../../util/storage";

/** The editor's two modes: Simple (nine sliders, looks, crop) and Advanced (every control). */
const EditorModeSchema = z.enum(["simple", "advanced"]);
export type EditorMode = z.infer<typeof EditorModeSchema>;

/** The mode the editor opens in: the one the user last chose. */
export function useEditorMode() {
  return useStoredState(STORAGE_KEYS.editorMode, EditorModeSchema, "simple");
}
