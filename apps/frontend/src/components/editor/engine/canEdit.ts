/** Whether this browser can run the editor's preview, probed once with a throwaway canvas. */

/** The parts of a WebGL2 context the probe uses. */
export type ProbedContext = Readonly<{
  getExtension: (name: string) => unknown;
}>;

function canLoseContext(extension: unknown): extension is { loseContext: () => void } {
  return (
    typeof extension === "object" &&
    extension !== null &&
    "loseContext" in extension &&
    typeof extension.loseContext === "function"
  );
}

/**
 * Whether a context opener gives a WebGL2 context that renders into half-float targets
 * (EXT_color_buffer_float, or EXT_color_buffer_half_float). The context is dropped again.
 */
export function probeEditing(open: () => ProbedContext | null): boolean {
  try {
    const context = open();
    if (context === null) return false;
    const floats =
      context.getExtension("EXT_color_buffer_float") !== null ||
      context.getExtension("EXT_color_buffer_half_float") !== null;
    const lose = context.getExtension("WEBGL_lose_context");
    if (canLoseContext(lose)) lose.loseContext();
    return floats;
  } catch {
    return false;
  }
}

let editingSupport: boolean | undefined;

/** Whether the editor can run here: WebGL2 with float render targets. Cheap after the first call. */
export function canEdit(): boolean {
  editingSupport ??= probeEditing(() => document.createElement("canvas").getContext("webgl2"));
  return editingSupport;
}
