import { SearchSort } from "@librephotos/api-client";
import { useStoredState } from "../../util/storage";
import type { StorageKey } from "../../util/storage";

export function usePhotoSort(storageKey: StorageKey, fallback: SearchSort) {
  const [stored, setStored] = useStoredState(storageKey, SearchSort.nullable(), null);
  const sort = stored ?? fallback;
  const setSort = (next: SearchSort) => setStored(() => (next === fallback ? null : next));
  const reset = () => setStored(() => null);
  return { sort, setSort, reset, explicit: stored !== null };
}
