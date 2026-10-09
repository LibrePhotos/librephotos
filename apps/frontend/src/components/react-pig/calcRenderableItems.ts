import type { ImageItem, LaidOutGroup, LaidOutTile, PigLayout, PigSettings } from "./types";

export type ScrollDirection = "up" | "down";

type CalcRenderableItemsParams<T extends ImageItem> = {
  /** Null until Pig has measured its container; counts as 0. */
  containerOffsetTop: number | null;
  scrollDirection: ScrollDirection;
  settings: Pick<PigSettings, "primaryImageBufferHeight" | "secondaryImageBufferHeight">;
  latestYOffset: number;
  layout: PigLayout<T>;
  windowHeight: number;
  updateGroups: (groups: LaidOutGroup<T>[]) => void;
  updateItems: (items: LaidOutTile<T>[]) => void;
};

/** The part of the layout within the scroll buffers, which is what Pig renders. */
export default function calcRenderableItems<T extends ImageItem>({
  containerOffsetTop,
  scrollDirection,
  settings,
  latestYOffset,
  layout,
  windowHeight,
  updateGroups,
  updateItems,
}: CalcRenderableItemsParams<T>): PigLayout<T> {
  // Get the top and bottom buffers heights
  const bufferTop = scrollDirection === "up" ? settings.primaryImageBufferHeight : settings.secondaryImageBufferHeight;
  const bufferBottom =
    scrollDirection === "down" ? settings.primaryImageBufferHeight : settings.secondaryImageBufferHeight;

  // Now we compute the location of the top and bottom buffers
  // that is the top of the top buffer. If the bottom of an image is above that line, it will be removed.
  const minTranslateYPlusHeight = latestYOffset - (containerOffsetTop ?? 0) - bufferTop;

  // that is the bottom of the bottom buffer.  If the top of an image is
  // below that line, it will be removed.
  const maxTranslateY = latestYOffset + windowHeight + bufferBottom;

  if (layout.grouped) {
    // Here, we loop over every image, determine if it is inside our buffers
    const arrOfGroups: LaidOutGroup<T>[] = [];
    layout.groups.forEach(g => {
      // If the group is not within the buffer then remove it
      if (g.groupTranslateY + g.height < minTranslateYPlusHeight || g.groupTranslateY > maxTranslateY) {
        return;
      }
      arrOfGroups.push(g);
    });
    const arrOfGroupsWithOnlyVisibleItems: LaidOutGroup<T>[] = [];
    arrOfGroups.forEach(g => {
      const arrOfItems: LaidOutTile<T>[] = [];
      g.items.forEach(i => {
        // If the item is not within the buffer then remove it
        if (i.style.translateY + i.style.height < minTranslateYPlusHeight || i.style.translateY > maxTranslateY) {
          return;
        }
        arrOfItems.push(i);
      });
      if (arrOfItems.length > 0) {
        arrOfGroupsWithOnlyVisibleItems.push({
          ...g,
          items: arrOfItems,
        });
      }
    });
    // function to update visible groups
    updateGroups(arrOfGroupsWithOnlyVisibleItems);
    return { grouped: true, groups: arrOfGroupsWithOnlyVisibleItems };
  }
  const visibleItems = layout.tiles.filter(
    img => !(img.style.translateY + img.style.height < minTranslateYPlusHeight || img.style.translateY > maxTranslateY)
  );
  // function to update visible items
  updateItems(visibleItems);
  return { grouped: false, tiles: visibleItems };
}
