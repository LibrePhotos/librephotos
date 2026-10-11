import { useCallback, useState } from "react";
import type { z } from "zod";

/**
 * Every key the app keeps in localStorage, and the only place localStorage is touched. A key is
 * `lp:<area>.<name>.v<N>`: the version goes up when the stored shape changes, and the value under
 * the previous key is moved across once (LEGACY_KEYS), so a user's saved state survives the rename.
 */
export const STORAGE_KEYS = {
  facesCollapsedPersons: "lp:faces.collapsedPersons.v1",
  facesTabScrollPositions: "lp:faces.tabScrollPositions.v1",
  recentlyTaggedPeople: "lp:people.recentlyTagged.v1",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** The bare key each value was written under before it was prefixed and versioned. */
const LEGACY_KEYS: Partial<Record<StorageKey, string>> = {
  [STORAGE_KEYS.facesCollapsedPersons]: "faceCollapsedPersons",
  [STORAGE_KEYS.facesTabScrollPositions]: "faceTabScrollPositions",
  [STORAGE_KEYS.recentlyTaggedPeople]: "recentlyTaggedPeople",
};

type Listener = () => void;
const listeners = new Map<StorageKey, Set<Listener>>();

/**
 * The raw text stored under `key`, or null. A value still under the legacy key is moved to the
 * new key and removed from the old one here, so the move happens once; a value the browser refuses
 * to move is read from where it is.
 */
function readRaw(key: StorageKey): string | null {
  const current = localStorage.getItem(key);
  if (current !== null) return current;
  const legacyKey = LEGACY_KEYS[key];
  if (legacyKey === undefined) return null;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy === null) return null;
  try {
    localStorage.setItem(key, legacy);
    localStorage.removeItem(legacyKey);
  } catch {
    // Storage that refuses a write (full, or disabled) still gives back the value it holds.
  }
  return legacy;
}

/**
 * Reads a stored value without trusting it. Nothing stored, storage that cannot be read, text that
 * is not JSON and a value the schema rejects all give `fallback`; the schema may also salvage
 * part of a value itself, through its own `.catch()`.
 */
export function readStored<T>(key: StorageKey, schema: z.ZodType<T>, fallback: T): T {
  try {
    const saved = readRaw(key);
    if (!saved) return fallback;
    const parsed: unknown = JSON.parse(saved);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : fallback;
  } catch (e) {
    console.error(`Error reading ${key} from localStorage:`, e);
    return fallback;
  }
}

/** Stores `value` under `key` and tells the subscribers of `key`. A write that fails is logged, not thrown. */
export function writeStored(key: StorageKey, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    const legacyKey = LEGACY_KEYS[key];
    if (legacyKey !== undefined) localStorage.removeItem(legacyKey);
  } catch (e) {
    console.error(`Error saving ${key} to localStorage:`, e);
  }
  listeners.get(key)?.forEach(listener => listener());
}

/** Calls `listener` after each write to `key` made through writeStored or useStoredState. */
export function subscribeStored(key: StorageKey, listener: Listener): () => void {
  const subscribers = listeners.get(key) ?? new Set<Listener>();
  subscribers.add(listener);
  listeners.set(key, subscribers);
  return () => {
    subscribers.delete(listener);
  };
}

/**
 * React state that is kept in localStorage. The value is read once, when the component mounts;
 * each update is written back in the same step as the state change.
 */
export function useStoredState<T>(
  key: StorageKey,
  schema: z.ZodType<T>,
  fallback: T
): [T, (change: (previous: T) => T) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, schema, fallback));
  const update = useCallback(
    (change: (previous: T) => T) => {
      setValue(previous => {
        const next = change(previous);
        writeStored(key, next);
        return next;
      });
    },
    [key]
  );
  return [value, update];
}
