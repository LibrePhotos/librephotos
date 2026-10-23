/** The Places page's `?edit=<id>`: open the editor on that place (the place page's Edit place, #1365). */
export type PlacesSearch = { edit?: number };

export function validatePlacesSearch(search: Record<string, unknown>): PlacesSearch {
  const edit = Number(search.edit);
  return Number.isInteger(edit) && edit > 0 ? { edit } : {};
}
