import type { LightboxItem } from "./lightbox.types";

/**
 * The id to step to, or null when there is nothing there to show: a grid
 * placeholder for a page that has not loaded yet has a made-up id ("0",
 * "temp-0") and no image hash, so stepping onto it requested /photos/0/.
 */
export function navigableId(image: LightboxItem | undefined): string | null {
  if (!image || image.isTemp || !image.image_hash) return null;
  return typeof image.id === "string" && image.id.length ? image.id : null;
}

/** Where `id` sits in `items`, or -1. */
export function indexOfId(items: readonly LightboxItem[], id: string): number {
  return items.findIndex(item => item.id === id);
}

/**
 * The photo one step from `index` in `direction`, passing over the photos
 * trashed in this lightbox. Null at either end of the list, and at a
 * placeholder: the photos behind it are not known yet, so stepping past it
 * would skip them.
 */
export function neighbour(
  items: readonly LightboxItem[],
  index: number,
  direction: 1 | -1,
  removed: ReadonlySet<string>
): LightboxItem | null {
  if (index < 0) return null;
  for (let i = index + direction; i >= 0 && i < items.length; i += direction) {
    const item = items[i];
    if (item === undefined || removed.has(item.id)) continue;
    return navigableId(item) === null ? null : item;
  }
  return null;
}

type Position = { items: readonly LightboxItem[]; index: number };

/**
 * Whether the lightbox should step through a newer list `live` rather than
 * the one it has (`known`). The grid list behind the lightbox is rebuilt
 * after a photo action and refills a day at a time, with placeholders until
 * then. The newer list is taken once it holds the shown photo and loses no
 * neighbour the old one had; until then the lightbox keeps stepping through
 * the photos it already knew, instead of finding itself next to placeholders
 * (and closing on the next delete, or stepping onto one).
 */
export function adoptsLive(live: Position, known: Position | null, removed: ReadonlySet<string>): boolean {
  if (live.index === -1) return false;
  if (known === null || known.index === -1 || known.items === live.items) return true;
  return ([1, -1] as const).every(
    direction =>
      neighbour(known.items, known.index, direction, removed) === null ||
      neighbour(live.items, live.index, direction, removed) !== null
  );
}
