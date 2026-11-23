import { useEditor } from "../EditorContext";
import type { Recipe } from "../engine/recipe";
import {
  appliedFilter,
  blendFilter,
  EDIT_FILTERS,
  filterStrength,
  ORIGINAL_FILTER,
  type EditFilter,
  type FilterId,
} from "./filters";

/** A look's id, or Original (the photo as it was before the looks). */
export type FilterChoice = FilterId | typeof ORIGINAL_FILTER;

/** The strength slider's scale: percent, at 100 by default. */
export const STRENGTH_SPEC = { min: 0, max: 100, origin: 100, step: 1, decimals: 0, bipolar: false } as const;

/**
 * The looks as the Filters tab and the presets section both use them: which one is applied, the
 * photo before it, picking one (one `preset` step that replaces the look before it) and the
 * strength of the applied one (live while dragged, one step when let go).
 */
export function useFilterChoice() {
  const { session, commands } = useEditor();
  const { id: activeId, base } = appliedFilter(session.history, session.cursor, session.committed);
  const active: EditFilter | undefined = EDIT_FILTERS.find(filter => filter.id === activeId);
  const blended = (filter: EditFilter, percent: number): Recipe => blendFilter(base, filter.values, percent / 100);
  return {
    base,
    activeId,
    active,
    /** Original was picked last (a look was taken off). */
    showsOriginal: activeId === null && session.history[session.cursor]?.value === ORIGINAL_FILTER,
    choose: (id: FilterChoice) => {
      const filter = EDIT_FILTERS.find(candidate => candidate.id === id);
      commands.apply("preset", filter ? blendFilter(base, filter.values, 1) : base, id);
    },
    /** The ValueSlider props of the applied look's strength; null without one. */
    strength: active
      ? {
          value: Math.round(filterStrength(base, active.values, session.recipe) * 100),
          onLive: (percent: number) => commands.liveApply("preset", blended(active, percent), active.id),
          onCommit: commands.commit,
          onSet: (percent: number) => commands.apply("preset", blended(active, percent), active.id),
          onReset: () => commands.apply("preset", blended(active, 100), active.id),
        }
      : null,
  };
}
