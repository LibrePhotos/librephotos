/**
 * What a history step's label says, without words: the UI maps it to translated text (labels are
 * built when shown, never stored).
 */
import type { EditHistoryStep } from "@librephotos/api-client";
import { isControlPath, type ControlPath } from "../engine/controls";

export type StepLabel =
  /** One control set: its path (`light.exposure`), its group (`light`) and its new value when scalar. */
  | Readonly<{ kind: "set"; control: ControlPath; group: string; value: number | boolean | string | null }>
  | Readonly<{ kind: "crop" }>
  /** A preset applied, by its id. */
  | Readonly<{ kind: "preset"; preset: string | null }>
  | Readonly<{ kind: "auto" }>
  | Readonly<{ kind: "paste" }>
  | Readonly<{ kind: "reset" }>
  | Readonly<{ kind: "import" }>
  /** A step this client cannot name (a control from a newer server). */
  | Readonly<{ kind: "unknown" }>;

/** The label of a history step. */
export function stepLabel(step: EditHistoryStep): StepLabel {
  switch (step.action) {
    case "set": {
      const control = step.control;
      if (!isControlPath(control)) return { kind: "unknown" };
      return { kind: "set", control, group: control.split(".")[0] ?? control, value: step.value ?? null };
    }
    case "preset":
      return { kind: "preset", preset: typeof step.value === "string" ? step.value : null };
    case "crop":
    case "auto":
    case "paste":
    case "reset":
    case "import":
      return { kind: step.action };
  }
}
