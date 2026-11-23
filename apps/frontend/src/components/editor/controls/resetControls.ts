/** A panel section's Reset: its controls back to their defaults, as one step. */
import { numberControl, readNumber, withControl, type NumberControlPath } from "../engine/controls";
import { DEFAULT_RECIPE, type Recipe } from "../engine/recipe";

/** The recipe with these number controls at their defaults. */
export function withDefaults(recipe: Recipe, paths: readonly NumberControlPath[]): Recipe {
  return paths.reduce((next, path) => withControl(next, path, numberControl(path).default), recipe);
}

/** Whether any of these controls differs from its default. */
export function anyChanged(recipe: Recipe, paths: readonly NumberControlPath[]): boolean {
  return paths.some(path => readNumber(recipe, path) !== numberControl(path).default);
}

/** The recipe with its geometry (turns, flips, straighten, crop, aspect lock) as it came. */
export function withDefaultGeometry(recipe: Recipe): Recipe {
  return { ...recipe, geometry: DEFAULT_RECIPE.geometry };
}
