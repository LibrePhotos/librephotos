import type { TFunction } from "i18next";
import type { PhotoRef, Selected } from "./photoListSelection";

/**
 * "5 selected", "All 120 selected" or "All 120 selected (3 excluded)": one translated sentence per
 * case, so the selection bar, its menus and the dialogs opened from it say the same thing.
 */
export function selectionLabel(t: TFunction, selected: Selected<PhotoRef>): string {
  if (selected.kind === "some") {
    return t("selectionbar.count", { count: selected.items.length });
  }
  if (selected.excluded.length > 0) {
    return t("selectionbar.allexcluded", { total: selected.total, count: selected.excluded.length });
  }
  return t("selectionbar.allcount", { count: selected.total });
}
