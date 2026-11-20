import { useCallback, useEffect, useRef, useState } from "react";
import { hub } from "./database";

export type LiveStore<T> = {
  use(key: string, tables: readonly string[] | null, load: () => Promise<T>): [T, () => void];
  clear(): void;
};

export function createLiveStore<T>(initial: T): LiveStore<T> {
  const cache = new Map<string, T>();

  function use(key: string, tables: readonly string[] | null, load: () => Promise<T>): [T, () => void] {
    const [value, setValue] = useState<T>(() => cache.get(key) ?? initial);
    const loadRef = useRef(load);
    loadRef.current = load;
    const seq = useRef(0);
    const run = useCallback(() => {
      const mine = ++seq.current;
      loadRef.current().then(
        v => {
          cache.set(key, v);
          if (mine === seq.current) setValue(v);
        },
        (e: unknown) => console.warn(`[live] ${key}:`, e),
      );
    }, [key]);
    const tableKey = tables === null ? null : tables.join(",");
    useEffect(() => {
      const cached = cache.get(key);
      if (cached !== undefined) setValue(cached);
      run();
      const watched = tableKey === null ? null : tableKey.split(",");
      return hub.watch(watched, run);
    }, [key, tableKey, run]);
    return [value, run];
  }

  return { use, clear: () => cache.clear() };
}
