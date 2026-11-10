import { useCallback, useState } from "react";

type Keyed<T> = { key: string; value: T };

/**
 * State that belongs to one item, such as the photo the lightbox shows or the video being played.
 * When `key` changes, the value starts over at `initial()` in that same render, adjusted while
 * rendering as React documents for state derived from props: a reset effect would first render the
 * last item's state against the new one. An update made through a setter of an older key (a request
 * answering after the user moved on) changes nothing.
 */
export function useKeyedState<T>(key: string, initial: () => T) {
  const [stored, setStored] = useState<Keyed<T>>(() => ({ key, value: initial() }));
  let current = stored;
  if (stored.key !== key) {
    current = { key, value: initial() };
    setStored(current);
  }
  const update = useCallback(
    (next: (previous: T) => T) => setStored(prev => (prev.key === key ? { key, value: next(prev.value) } : prev)),
    [key]
  );
  return [current.value, update] as const;
}
