import { useMemo } from "react";
import { useStoredState } from "../../util/storage";
import { AlbumSort, sortAlbums } from "./albumSort";
import type { AlbumSortConfig, AlbumSortOption } from "./albumSort";

export type AlbumSortMenuState = Readonly<{
  options: readonly Pick<AlbumSortOption<unknown>, "key" | "label">[];
  sort: AlbumSort;
  defaultSort: AlbumSort;
  onChange: (sort: AlbumSort) => void;
}>;

/**
 * A page's album list in the order the user picked (#620), and the state of its sort menu.
 *
 * The order is read from storage when the page mounts, so the first render is already sorted:
 * coming Back to a list restores its scroll position over the same order (#377). A stored key the
 * page does not offer (an older build, or a field this server does not send) falls back to the
 * page's default without overwriting what is stored.
 */
export function useAlbumSort<T>(
  config: AlbumSortConfig<T>,
  items: readonly T[]
): Readonly<{ sorted: T[]; orderKey: string; menu: AlbumSortMenuState }> {
  const [stored, setStored] = useStoredState(config.storageKey, AlbumSort, config.defaultSort);
  const options = useMemo(
    () => config.options.filter(option => option.isAvailable?.(items) ?? true),
    [config.options, items]
  );
  const sort = options.some(option => option.key === stored.key) ? stored : config.defaultSort;
  const sorted = useMemo(() => sortAlbums(items, options, sort), [items, options, sort]);
  return {
    sorted,
    // For TileGrid, which goes back to the top when the order changes
    orderKey: `${sort.key}-${sort.direction}`,
    menu: {
      options,
      sort,
      defaultSort: config.defaultSort,
      onChange: next => setStored(() => next),
    },
  };
}
