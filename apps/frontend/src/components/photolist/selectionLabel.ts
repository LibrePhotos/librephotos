import type { TFunction } from "i18next";

export type SelectionCounts = Readonly<{
  /** Select all is on: the whole set counts, minus `excluded`. */
  selectAllMode: boolean;
  /** How many photos the whole set has. */
  total: number;
  /** In select-all mode, the photos taken out of it again. */
  excluded: number;
  /** Outside select-all mode, how many photos are picked. */
  selected: number;
}>;

/**
 * "5 selected", "All 120 selected" or "All 120 selected (3 excluded)": one translated sentence per
 * case, so the selection bar, its menus and the dialogs opened from it say the same thing.
 */
export function selectionLabel(t: TFunction, { selectAllMode, total, excluded, selected }: SelectionCounts): string {
  if (!selectAllMode) {
    return t("selectionbar.count", { count: selected });
  }
  if (excluded > 0) {
    return t("selectionbar.allexcluded", { total, count: excluded });
  }
  return t("selectionbar.allcount", { count: total });
}
