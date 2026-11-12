/**
 * Copy settings and Paste settings: a photo's look is its recipe without the geometry (turns,
 * flips, straighten, crop and aspect lock belong to the photo they were made for), so pasting it
 * onto another photo keeps that photo's own framing.
 */
import { EditRecipe } from "@librephotos/api-client";
import { DEFAULT_RECIPE, toDense, toSparse, type Recipe } from "../engine/recipe";

/** What is stored between photos: a look, or nothing copied yet. */
export const CopiedLookSchema = EditRecipe.nullable();

/** The look of a recipe: everything except its geometry, sparse. */
export function lookOf(recipe: Recipe): EditRecipe {
  return toSparse({ ...recipe, geometry: DEFAULT_RECIPE.geometry });
}

/** `target` with a copied look: the look's values everywhere, `target`'s geometry kept. */
export function pasteLook(target: Recipe, look: EditRecipe): Recipe {
  const { geometry: _ignored, ...settings } = look;
  return { ...toDense(settings), geometry: target.geometry };
}
